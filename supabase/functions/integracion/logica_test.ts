// Pruebas de las reglas de la integración (sin red ni base de datos).
// Se corren con:  deno test supabase/functions/integracion/logica_test.ts
// Este archivo NO se despliega: es solo para comprobar la lógica.
// deno-lint-ignore-file require-await
import { assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import type { Cierre, EstadoGuardado, InfoPedido, Juego, Reclamo, Repo } from './logica.ts';
import { actualizarSaldo, catalogoProveedor, entregarPedido, limpiarNickname, probarIntegracion, revisarPedido, validarJugador } from './logica.ts';
import { crearProveedor, type PedidoRecarga, type Proveedor, type ResultadoPedido } from './proveedor.ts';

const ADMIN = '00000000-0000-4000-8000-0000000000aa';
const CLIENTE = '00000000-0000-4000-8000-0000000000bb';
const OTRO = '00000000-0000-4000-8000-0000000000cc';
const PEDIDO = '11111111-1111-4111-8111-111111111111';
const MINUTO = 60 * 1000;

function juegoBase(extra: Partial<Juego> = {}): Juego {
  return { slug: 'free-fire', activo: true, validar_auto: true, entrega_auto: true, patron_id: '^[0-9]{5,15}$', usa_zona: false, ...extra };
}

const ESTADO_FINAL: Record<Cierre, string> = { entregado: 'auto_entregado', fallo: 'auto_fallo', revisar: 'auto_revisar', confirmando: 'auto_confirmando' };

/** Repo en memoria que imita las garantías de la base de datos (reclamar una sola vez, transiciones de estado, etc.). */
function crearRepoFalso(inicial: { juego?: Juego | null; pedido?: Partial<InfoPedido> | null; admins?: string[]; permitir?: boolean; conexion?: boolean } = {}) {
  const estado = {
    juego: inicial.juego === undefined ? juegoBase() : inicial.juego,
    pedido: inicial.pedido === null ? null : {
      id: PEDIDO, usuario_id: CLIENTE, tipo: 'compra_diamantes', estado: 'confirmado', entrega: 'auto_pendiente',
      entrega_at: null, id_jugador: '123456789', paquete_id: 7, juego: 'free-fire', intentos: 0, ...inicial.pedido,
    } as InfoPedido,
    admins: inicial.admins ?? [ADMIN],
    cache: new Map<string, { nickname: string; consultado_at: string }>(),
    logs: [] as Array<{ tipo: string; ok: boolean; detalle: string }>,
    cierres: [] as Array<{ resultado: string; ref: string | null; detalle: string | null; simulado: boolean }>,
    reclamos: 0,
    manualizados: 0,
    falloAlManualizar: false,
    consultasPermitidas: inicial.permitir ?? true,
    consultasGastadas: 0,
    conexion: inicial.conexion ?? true,
    estadoGuardado: null as EstadoGuardado | null,
    usos: [] as Array<{ saldo: number | null; restantes: number | null }>,
    fallosAlCerrar: 0,
  };
  const repo: Repo = {
    obtenerJuego: async () => estado.juego,
    obtenerCache: async (j, id, z) => estado.cache.get(`${j}|${id}|${z}`) ?? null,
    guardarCache: async (j, id, z, nickname) => { estado.cache.set(`${j}|${id}|${z}`, { nickname, consultado_at: new Date().toISOString() }); },
    permitirConsulta: async () => { estado.consultasGastadas++; return estado.consultasPermitidas; },
    log: async (tipo, _j, _p, _u, ok, detalle) => { estado.logs.push({ tipo, ok, detalle }); },
    esAdmin: async (u) => estado.admins.includes(u),
    infoPedido: async () => (estado.pedido ? { ...estado.pedido } : null),
    reclamarEntrega: async (_id, forzar) => {
      const p = estado.pedido;
      if (!p || p.tipo !== 'compra_diamantes' || p.estado !== 'confirmado') return null;
      const ok = p.entrega === 'auto_pendiente' || (forzar && ['auto_fallo', 'auto_revisar', 'auto_en_proceso'].includes(p.entrega));
      if (!ok) return null;
      p.entrega = 'auto_en_proceso';
      p.entrega_at = new Date().toISOString();
      p.intentos++;
      estado.reclamos++;
      return { pedido_id: p.id, id_jugador: p.id_jugador ?? '', juego: p.juego, codigo: '341 Diamantes', nombre_paquete: '341 Diamantes', cantidad: 341, intentos: p.intentos } as Reclamo;
    },
    pasarAManual: async () => {
      if (estado.falloAlManualizar) throw new Error('base de datos caída');
      const p = estado.pedido;
      if (p && p.tipo === 'compra_diamantes' && p.estado === 'confirmado' && p.entrega === 'auto_pendiente') {
        p.entrega = 'manual';
        estado.manualizados++;
      }
    },
    // Igual que entrega_cerrar en la base: solo desde ciertos estados, y repetir el mismo cierre no es un error.
    cerrarEntrega: async (_id, resultado, ref, detalle, simulado) => {
      if (estado.fallosAlCerrar > 0) { estado.fallosAlCerrar--; throw new Error('base de datos caída'); }
      const p = estado.pedido;
      const destino = ESTADO_FINAL[resultado];
      const origenes = resultado === 'revisar' ? ['auto_en_proceso', 'auto_confirmando']
        : resultado === 'confirmando' ? ['auto_en_proceso', 'auto_revisar']
        : ['auto_en_proceso', 'auto_confirmando', 'auto_revisar'];
      if (p && p.estado === 'confirmado' && origenes.includes(p.entrega)) {
        p.entrega = destino;
        p.entrega_at = new Date().toISOString();
        if (resultado === 'entregado' && !simulado) p.estado = 'completado';
      } else if (!(p && p.entrega === destino)) {
        throw new Error('El pedido no está en proceso de entrega');
      }
      estado.cierres.push({ resultado, ref, detalle, simulado });
    },
    guardarEstado: async (e) => { estado.estadoGuardado = e; if (!e.listo) estado.conexion = false; },
    conexionLista: async () => estado.conexion,
    actualizarUso: async (saldo, restantes) => { estado.usos.push({ saldo, restantes }); },
  };
  return { repo, estado };
}

function env(valores: Record<string, string>) { return (k: string) => valores[k]; }
const simulado = () => crearProveedor(env({ PROVEEDOR_MODO: 'simulado' }));
const sinEsperas = { esperar: async () => {} };

/** Un proveedor "real" de mentira (sin red), para probar las reglas de logica.ts con respuestas a medida. */
function proveedorRealFalso(extra: Partial<Proveedor> = {}): Proveedor {
  return {
    ...simulado(),
    modo: () => 'real',
    listo: () => true,
    nicknameDisponible: () => true,
    diagnostico: () => ({ modo: 'real', adaptador_implementado: true, tiene_url: true, tiene_llave: true, nickname_disponible: true }),
    consultarSaldo: () => Promise.resolve({ ok: true, saldo: 42.85, moneda: 'USDT', detalle: 'Conexión correcta' }),
    consultarPedido: () => Promise.resolve({ estado: 'desconocido', interno: 'sin respuesta preparada en la prueba' }),
    ...extra,
  };
}
const hace = (ms: number) => new Date(Date.now() - ms).toISOString();

// ----------------------------------------------------------------- limpieza
Deno.test('limpiarNickname quita controles y recorta', () => {
  assertEquals(limpiarNickname('  Juan\u0000\u001f Pérez  '), 'Juan Pérez');
  assertEquals(limpiarNickname('x'.repeat(100)).length, 60);
  assertEquals(limpiarNickname(null), '');
});

// ------------------------------------------------------------ validarJugador
Deno.test('validar: apagado o real sin credenciales → no_configurado (la web sigue como siempre y no sale a internet)', async () => {
  const { repo, estado } = crearRepoFalso();
  let salidas = 0;
  const http: typeof fetch = () => { salidas++; return Promise.reject(new Error('no debe llamarse')); };
  const casos: Array<Record<string, string>> = [{}, { PROVEEDOR_MODO: 'apagado', PROVEEDOR_URL: 'https://x.test', PROVEEDOR_API_KEY: 'k' }, { PROVEEDOR_MODO: 'real', PROVEEDOR_URL: 'https://x.test' }];
  for (const valores of casos) {
    const r = await validarJugador({ repo, proveedor: crearProveedor(env(valores), http) }, CLIENTE, { juego: 'free-fire', id_jugador: '123456789' });
    assertEquals(r, { ok: false, motivo: 'no_configurado' });
  }
  assertEquals(salidas, 0);
  assertEquals(estado.consultasGastadas, 0);
});

Deno.test('validar: juego inexistente, inactivo o con la validación apagada', async () => {
  const entrada = { juego: 'free-fire', id_jugador: '123456789' };
  assertEquals(await validarJugador({ repo: crearRepoFalso({ juego: null }).repo, proveedor: simulado() }, CLIENTE, entrada), { ok: false, motivo: 'juego_invalido' });
  assertEquals(await validarJugador({ repo: crearRepoFalso({ juego: juegoBase({ activo: false }) }).repo, proveedor: simulado() }, CLIENTE, entrada), { ok: false, motivo: 'juego_invalido' });
  assertEquals(await validarJugador({ repo: crearRepoFalso({ juego: juegoBase({ validar_auto: false }) }).repo, proveedor: simulado() }, CLIENTE, entrada), { ok: false, motivo: 'no_configurado' });
});

Deno.test('validar: ID con formato inválido nunca llega al proveedor', async () => {
  const { repo } = crearRepoFalso();
  let llamadas = 0;
  const proveedor: Proveedor = { ...simulado(), consultarJugador: async () => { llamadas++; return { ok: true, nickname: 'x' }; } };
  for (const id of ['abc', '12', '1234567890123456', "1' OR '1'='1", '../../etc', '']) {
    assertEquals(await validarJugador({ repo, proveedor }, CLIENTE, { juego: 'free-fire', id_jugador: id }), { ok: false, motivo: 'id_invalido' });
  }
  assertEquals(llamadas, 0);
});

Deno.test('validar: encuentra el nickname, lo guarda en caché y la segunda vez no llama al proveedor', async () => {
  const { repo, estado } = crearRepoFalso();
  let llamadas = 0;
  const base = simulado();
  const proveedor: Proveedor = { ...base, consultarJugador: async (c) => { llamadas++; return base.consultarJugador(c); } };
  const r1 = await validarJugador({ repo, proveedor }, CLIENTE, { juego: 'free-fire', id_jugador: '123456789' });
  assertEquals(r1, { ok: true, nickname: 'Jugador6789', cache: false });
  const r2 = await validarJugador({ repo, proveedor }, OTRO, { juego: 'free-fire', id_jugador: '123456789' });
  assertEquals(r2, { ok: true, nickname: 'Jugador6789', cache: true });
  assertEquals(llamadas, 1);
  assertEquals(estado.logs.at(-1)?.detalle.includes('123456789'), false, 'el ID completo no debe quedar en los registros');
});

Deno.test('validar: caché vencida (más de 24 h) vuelve a consultar', async () => {
  const { repo, estado } = crearRepoFalso();
  estado.cache.set('free-fire|123456789|', { nickname: 'Viejo', consultado_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() });
  const r = await validarJugador({ repo, proveedor: simulado() }, CLIENTE, { juego: 'free-fire', id_jugador: '123456789' });
  assertEquals(r, { ok: true, nickname: 'Jugador6789', cache: false });
});

Deno.test('validar: no encontrado, proveedor caído, error inesperado y límite de consultas', async () => {
  const { repo } = crearRepoFalso();
  assertEquals(await validarJugador({ repo, proveedor: simulado() }, CLIENTE, { juego: 'free-fire', id_jugador: '123456000' }), { ok: false, motivo: 'no_encontrado' });
  assertEquals(await validarJugador({ repo, proveedor: simulado() }, CLIENTE, { juego: 'free-fire', id_jugador: '123456111' }), { ok: false, motivo: 'no_disponible' });
  const roto: Proveedor = { ...simulado(), consultarJugador: async () => { throw new Error('boom'); } };
  assertEquals(await validarJugador({ repo, proveedor: roto }, CLIENTE, { juego: 'free-fire', id_jugador: '123456789' }), { ok: false, motivo: 'no_disponible' });
  const limitado = crearRepoFalso({ permitir: false });
  assertEquals(await validarJugador({ repo: limitado.repo, proveedor: simulado() }, CLIENTE, { juego: 'free-fire', id_jugador: '123456789' }), { ok: false, motivo: 'limite' });
});

Deno.test('validar: el proveedor responde con nickname vacío o raro', async () => {
  const { repo } = crearRepoFalso();
  const vacio: Proveedor = { ...simulado(), consultarJugador: async () => ({ ok: true, nickname: '   ' }) };
  assertEquals(await validarJugador({ repo, proveedor: vacio }, CLIENTE, { juego: 'free-fire', id_jugador: '123456789' }), { ok: false, motivo: 'no_disponible' });
  const raro: Proveedor = { ...simulado(), consultarJugador: async () => ({ ok: true, nickname: '<b>Hola</b>\n' }) };
  const r = await validarJugador({ repo: crearRepoFalso().repo, proveedor: raro }, CLIENTE, { juego: 'free-fire', id_jugador: '123456789' });
  assertEquals(r, { ok: true, nickname: '<b>Hola</b>', cache: false }); // el HTML se escapa en la web, aquí solo se limpian controles
});

Deno.test('validar: juego con zona exige zona válida', async () => {
  const { repo } = crearRepoFalso({ juego: juegoBase({ usa_zona: true }) });
  assertEquals(await validarJugador({ repo, proveedor: simulado() }, CLIENTE, { juego: 'free-fire', id_jugador: '123456789' }), { ok: false, motivo: 'id_invalido' });
  assertEquals((await validarJugador({ repo, proveedor: simulado() }, CLIENTE, { juego: 'free-fire', id_jugador: '123456789', zona: '2001' })).ok, true);
});

Deno.test('validar: si el proveedor no ofrece nickname para ese juego, no se gasta ningún intento ni consulta', async () => {
  const { repo, estado } = crearRepoFalso();
  let consultas = 0;
  const proveedor = proveedorRealFalso({
    nicknameDisponible: () => false,
    consultarJugador: () => { consultas++; return Promise.resolve({ ok: true as const, nickname: 'x' }); },
  });
  assertEquals(await validarJugador({ repo, proveedor }, CLIENTE, { juego: 'free-fire', id_jugador: '123456789' }), { ok: false, motivo: 'no_configurado' });
  assertEquals(consultas, 0);
  assertEquals(estado.logs.length, 0);
  assertEquals(estado.consultasGastadas, 0);
});

Deno.test('validar (real): otro juego que no sea Free Fire no sale a internet aunque tenga la validación activa', async () => {
  const { repo, estado } = crearRepoFalso({ juego: juegoBase({ slug: 'mobile-legends' }) });
  let salidas = 0;
  const http: typeof fetch = () => { salidas++; return Promise.reject(new Error('no debe llamarse')); };
  const proveedor = crearProveedor(env({ PROVEEDOR_MODO: 'real', PROVEEDOR_URL: 'https://x.test', PROVEEDOR_API_KEY: 'k' }), http);
  assertEquals(await validarJugador({ repo, proveedor }, CLIENTE, { juego: 'mobile-legends', id_jugador: '123456789' }), { ok: false, motivo: 'no_configurado' });
  assertEquals(salidas, 0);
  assertEquals(estado.consultasGastadas, 0);
});

Deno.test('validar (real): con la conexión apagada no se llama al proveedor, pero lo ya guardado en caché sí se usa', async () => {
  const { repo, estado } = crearRepoFalso({ conexion: false });
  let consultas = 0;
  const proveedor = proveedorRealFalso({ consultarJugador: () => { consultas++; return Promise.resolve({ ok: true as const, nickname: 'Nuevo' }); } });
  assertEquals(await validarJugador({ repo, proveedor }, CLIENTE, { juego: 'free-fire', id_jugador: '123456789' }), { ok: false, motivo: 'no_configurado' });
  assertEquals(consultas, 0);
  assertEquals(estado.consultasGastadas, 0, 'tampoco se gasta un intento por hora del usuario');

  estado.cache.set('free-fire|123456789|', { nickname: 'Guardado', consultado_at: new Date().toISOString() });
  assertEquals(await validarJugador({ repo, proveedor }, CLIENTE, { juego: 'free-fire', id_jugador: '123456789' }), { ok: true, nickname: 'Guardado', cache: true });
});

Deno.test('validar (real): anota lo que queda del cupo de consultas, en aciertos y en "no existe"', async () => {
  const { repo, estado } = crearRepoFalso();
  const hallado = proveedorRealFalso({ consultarJugador: () => Promise.resolve({ ok: true as const, nickname: 'Jugador', restantes: 487 }) });
  await validarJugador({ repo, proveedor: hallado }, CLIENTE, { juego: 'free-fire', id_jugador: '123456789' });
  const noExiste = proveedorRealFalso({ consultarJugador: () => Promise.resolve({ ok: false as const, motivo: 'no_encontrado' as const, restantes: 486 }) });
  assertEquals(await validarJugador({ repo, proveedor: noExiste }, CLIENTE, { juego: 'free-fire', id_jugador: '123456780' }), { ok: false, motivo: 'no_encontrado' });
  assertEquals(estado.usos, [{ saldo: null, restantes: 487 }, { saldo: null, restantes: 486 }]);
});

Deno.test('validar (real): sin cupo o con el validador caído, la compra sigue (no_disponible) y la conexión NO se apaga', async () => {
  const { repo, estado } = crearRepoFalso();
  const agotado = proveedorRealFalso({ consultarJugador: () => Promise.resolve({ ok: false as const, motivo: 'no_disponible' as const, interno: 'Se agotó el cupo de consultas de ID', restantes: 0 }) });
  assertEquals(await validarJugador({ repo, proveedor: agotado }, CLIENTE, { juego: 'free-fire', id_jugador: '123456789' }), { ok: false, motivo: 'no_disponible' });
  assertEquals(estado.conexion, true);
  assertEquals(estado.estadoGuardado, null);
  assertEquals(estado.logs.at(-1)?.detalle.includes('cupo'), true, 'el admin ve el motivo real');
});

Deno.test('validar (real): si la llave ya no sirve, la conexión se apaga y el nickname deja de consultarse', async () => {
  const { repo, estado } = crearRepoFalso();
  let consultas = 0;
  const vencida = proveedorRealFalso({
    consultarJugador: () => {
      consultas++;
      return Promise.resolve({ ok: false as const, motivo: 'no_disponible' as const, interno: 'El acceso a la API venció: pide que te lo renueven', credenciales: true });
    },
  });
  assertEquals(await validarJugador({ repo, proveedor: vencida }, CLIENTE, { juego: 'free-fire', id_jugador: '123456789' }), { ok: false, motivo: 'no_disponible' });
  assertEquals(estado.estadoGuardado?.listo, false);
  assertEquals(estado.estadoGuardado?.mensaje.includes('venció'), true);
  assertEquals(estado.estadoGuardado?.mensaje.includes('Probar conexión'), true);
  // la siguiente consulta ya no llega al proveedor
  assertEquals(await validarJugador({ repo, proveedor: vencida }, OTRO, { juego: 'free-fire', id_jugador: '987654321' }), { ok: false, motivo: 'no_configurado' });
  assertEquals(consultas, 1);
});

// ------------------------------------------------------------ entregarPedido
Deno.test('entregar: pedido inválido, inexistente o de otra persona', async () => {
  const { repo } = crearRepoFalso();
  assertEquals(await entregarPedido({ repo, proveedor: simulado(), ...sinEsperas }, CLIENTE, { pedido_id: 'no-es-uuid' }), { ok: false, motivo: 'pedido_invalido' });
  assertEquals(await entregarPedido({ repo: crearRepoFalso({ pedido: null }).repo, proveedor: simulado(), ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO }), { ok: false, motivo: 'no_encontrado' });
  assertEquals(await entregarPedido({ repo, proveedor: simulado(), ...sinEsperas }, OTRO, { pedido_id: PEDIDO }), { ok: false, motivo: 'sin_permiso' });
});

Deno.test('entregar: el cliente dueño entrega bien (modo simulado: se avisa que es de mentira)', async () => {
  const { repo, estado } = crearRepoFalso();
  const r = await entregarPedido({ repo, proveedor: simulado(), ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO });
  assertEquals(r, { ok: true, entrega: 'auto_entregado', mensaje: 'Simulado: no se entregó nada de verdad' });
  assertEquals(estado.cierres.length, 1);
  assertEquals(estado.cierres[0].simulado, true);
  assertEquals(estado.cierres[0].resultado, 'entregado');
  assertEquals(estado.pedido?.estado, 'confirmado', 'una entrega simulada NO completa el pedido');
});

Deno.test('entregar: en modo real el pedido entregado queda completado y se anota el saldo que queda', async () => {
  const { repo, estado } = crearRepoFalso();
  const proveedor = proveedorRealFalso({ crearRecarga: () => Promise.resolve({ estado: 'entregado' as const, ref: 'Proveedor: TXN-1', saldo: 10.36 }) });
  const r = await entregarPedido({ repo, proveedor, ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO });
  assertEquals(r, { ok: true, entrega: 'auto_entregado', mensaje: undefined });
  assertEquals(estado.pedido?.estado, 'completado');
  assertEquals(estado.cierres[0].ref, 'Proveedor: TXN-1');
  assertEquals(estado.usos, [{ saldo: 10.36, restantes: null }]);
});

Deno.test('entregar: dos llamadas a la vez entregan UNA sola vez', async () => {
  const { repo, estado } = crearRepoFalso();
  let enviadas = 0;
  const base = simulado();
  const proveedor: Proveedor = { ...base, crearRecarga: async (p) => { enviadas++; return base.crearRecarga(p); } };
  const [a, b] = await Promise.all([
    entregarPedido({ repo, proveedor, ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO }),
    entregarPedido({ repo, proveedor, ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO }),
  ]);
  assertEquals(enviadas, 1);
  assertEquals(estado.reclamos, 1);
  assertEquals([a.ok, b.ok].filter(Boolean).length >= 1, true);
});

Deno.test('entregar: lo ya entregado, manual, en proceso o pagado de otro tipo no se vuelve a enviar (ni forzando)', async () => {
  const sinEnviar = [
    { entrega: 'auto_entregado' }, { entrega: 'manual' }, { estado: 'completado' }, { tipo: 'recarga_saldo' },
    { entrega: 'auto_en_proceso' }, { entrega: 'auto_confirmando' }, { entrega: 'auto_revisar' },
  ];
  for (const forzar of [false, true]) {
    for (const pedido of sinEnviar) {
      const { repo, estado } = crearRepoFalso({ pedido });
      let enviadas = 0;
      const base = simulado();
      const proveedor: Proveedor = { ...base, crearRecarga: async (p) => { enviadas++; return base.crearRecarga(p); } };
      const r = await entregarPedido({ repo, proveedor, ...sinEsperas }, ADMIN, { pedido_id: PEDIDO, forzar });
      assertEquals(enviadas, 0, `${JSON.stringify(pedido)} forzar=${forzar}`);
      assertEquals(estado.reclamos, 0);
      assertEquals(r.ok, true);
    }
  }
});

Deno.test('entregar: sin conexión lista o con la automatización apagada, el pedido vuelve al flujo manual sin gastar intentos', async () => {
  const esperado = { ok: true, entrega: 'manual', mensaje: 'La entrega automática no está disponible: se hará a mano' };
  const a = crearRepoFalso();
  assertEquals(await entregarPedido({ repo: a.repo, proveedor: crearProveedor(env({})), ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO }), esperado);
  assertEquals(a.estado.reclamos, 0);
  assertEquals(a.estado.manualizados, 1);
  assertEquals(a.estado.pedido?.entrega, 'manual');
  const b = crearRepoFalso({ juego: juegoBase({ entrega_auto: false }) });
  assertEquals(await entregarPedido({ repo: b.repo, proveedor: simulado(), ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO }), esperado);
  assertEquals(b.estado.reclamos, 0);
  assertEquals(b.estado.manualizados, 1);
  // una segunda llamada ya no tiene nada que hacer
  assertEquals((await entregarPedido({ repo: b.repo, proveedor: simulado(), ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO })).entrega, 'manual');
  assertEquals(b.estado.manualizados, 1);
});

Deno.test('entregar: si la conexión se apagó después de crear el pedido (llave vencida, prueba fallida), el pedido va a mano', async () => {
  const { repo, estado } = crearRepoFalso({ conexion: false });
  let enviadas = 0;
  const proveedor = proveedorRealFalso({ crearRecarga: () => { enviadas++; return Promise.resolve({ estado: 'entregado' as const, ref: 'x' }); } });
  assertEquals(await entregarPedido({ repo, proveedor, ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO }), { ok: true, entrega: 'manual', mensaje: 'La entrega automática no está disponible: se hará a mano' });
  assertEquals(enviadas, 0);
  assertEquals(estado.reclamos, 0);
});

Deno.test('entregar: si no se puede pasar a manual, el pedido sigue pendiente y se avisa', async () => {
  const { repo, estado } = crearRepoFalso();
  estado.falloAlManualizar = true;
  assertEquals(await entregarPedido({ repo, proveedor: crearProveedor(env({})), ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO }), { ok: false, motivo: 'no_configurado', entrega: 'auto_pendiente' });
  assertEquals(estado.pedido?.entrega, 'auto_pendiente');
});

Deno.test('entregar: un reintento forzado por el admin con la conexión caída NO cambia un pedido ya intentado', async () => {
  const { repo, estado } = crearRepoFalso({ pedido: { entrega: 'auto_fallo' } });
  const r = await entregarPedido({ repo, proveedor: crearProveedor(env({})), ...sinEsperas }, ADMIN, { pedido_id: PEDIDO, forzar: true });
  assertEquals(r, { ok: false, motivo: 'no_configurado', entrega: 'auto_fallo' });
  assertEquals(estado.manualizados, 0);
  assertEquals(estado.pedido?.entrega, 'auto_fallo');
});

Deno.test('entregar: el proveedor rechaza (fallo) o no responde (revisar), sin reintentos solos', async () => {
  const fallo = crearRepoFalso({ pedido: { id_jugador: '123456999' } });
  const r1 = await entregarPedido({ repo: fallo.repo, proveedor: simulado(), ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO });
  assertEquals(r1.ok, false);
  assertEquals(fallo.estado.cierres[0].resultado, 'fallo');
  const dudoso = crearRepoFalso({ pedido: { id_jugador: '123456888' } });
  const r2 = await entregarPedido({ repo: dudoso.repo, proveedor: simulado(), ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO });
  assertEquals(r2.ok, false);
  assertEquals(dudoso.estado.cierres[0].resultado, 'revisar');
  assertEquals(dudoso.estado.pedido?.entrega, 'auto_revisar');
  // el cliente no puede reintentar por su cuenta, ni mandando "forzar": solo el admin
  const r3 = await entregarPedido({ repo: fallo.repo, proveedor: simulado(), ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO, forzar: true });
  assertEquals(fallo.estado.reclamos, 1, 'un cliente no puede forzar reintentos');
  assertEquals(r3, { ok: true, entrega: 'auto_fallo' });
});

Deno.test('entregar: una excepción del proveedor se trata como "revisar", nunca como entregado ni como fallo seguro', async () => {
  const { repo, estado } = crearRepoFalso();
  const roto: Proveedor = { ...simulado(), crearRecarga: async () => { throw new Error('socket cerrado'); } };
  const r = await entregarPedido({ repo, proveedor: roto, ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO });
  assertEquals(r.ok, false);
  assertEquals(estado.cierres[0].resultado, 'revisar');
});

Deno.test('entregar: el admin puede reintentar un fallo, y cada intento viaja con su número (clave propia en el proveedor)', async () => {
  const { repo, estado } = crearRepoFalso();
  const intentos: Array<number | undefined> = [];
  let respuestas = 0;
  const proveedor = proveedorRealFalso({
    crearRecarga: (p: PedidoRecarga) => {
      intentos.push(p.intento);
      return Promise.resolve(respuestas++ === 0
        ? { estado: 'fallo' as const, detalle: 'El proveedor no pudo procesar el paquete', interno: 'rechazada' }
        : { estado: 'entregado' as const, ref: 'ok' });
    },
  });
  const primero = await entregarPedido({ repo, proveedor, ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO });
  assertEquals(primero.entrega, 'auto_fallo');
  const segundo = await entregarPedido({ repo, proveedor, ...sinEsperas }, ADMIN, { pedido_id: PEDIDO, forzar: true });
  assertEquals(segundo.entrega, 'auto_entregado');
  assertEquals(intentos, [1, 2]);
  assertEquals(estado.reclamos, 2);
});

Deno.test('entregar: si guardar el resultado falla se reintenta; si sigue fallando se avisa para revisar', async () => {
  const a = crearRepoFalso();
  a.estado.fallosAlCerrar = 2;
  assertEquals((await entregarPedido({ repo: a.repo, proveedor: simulado(), ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO })).ok, true);
  const b = crearRepoFalso();
  b.estado.fallosAlCerrar = 99;
  const r = await entregarPedido({ repo: b.repo, proveedor: simulado(), ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO });
  assertEquals(r.ok, false);
  assertEquals(b.estado.logs.at(-1)?.detalle.includes('NO SE PUDO GUARDAR'), true);
});

Deno.test('entregar: el proveedor la está aplicando → se pregunta unas veces y, si termina, queda entregada', async () => {
  const { repo, estado } = crearRepoFalso();
  const pausas: number[] = [];
  let consultas = 0;
  const consultadas: Array<number | undefined> = [];
  const proveedor = proveedorRealFalso({
    crearRecarga: () => Promise.resolve({ estado: 'en_proceso' as const, detalle: 'El proveedor está aplicando la recarga (orden #1)', interno: 'pendiente_proveedor', saldo: 11.94 }),
    consultarPedido: (c) => {
      consultadas.push(c.intento);
      return Promise.resolve(++consultas < 3 ? { estado: 'en_proceso' as const } : { estado: 'entregado' as const, ref: 'Proveedor: TXN-9' });
    },
  });
  const r = await entregarPedido({ repo, proveedor, esperar: async (ms) => { pausas.push(ms); } }, CLIENTE, { pedido_id: PEDIDO });
  assertEquals(r.entrega, 'auto_entregado');
  assertEquals(estado.pedido?.estado, 'completado');
  assertEquals(estado.cierres.length, 1);
  assertEquals(estado.cierres[0].ref, 'Proveedor: TXN-9');
  assertEquals(consultas, 3);
  assertEquals(consultadas, [1, 1, 1], 'pregunta por la misma clave con la que compró');
  assertEquals(pausas, [3000, 3000, 3000]);
  assertEquals(estado.usos, [{ saldo: 11.94, restantes: null }]);
});

Deno.test('entregar: si el proveedor la rechaza después de aceptarla, queda como fallo (y su saldo ya volvió)', async () => {
  const { repo, estado } = crearRepoFalso();
  const proveedor = proveedorRealFalso({
    crearRecarga: () => Promise.resolve({ estado: 'en_proceso' as const, detalle: 'aplicando' }),
    consultarPedido: () => Promise.resolve({ estado: 'rechazado' as const, interno: 'Reembolsado: sin detalle' }),
  });
  const r = await entregarPedido({ repo, proveedor, ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO });
  assertEquals(r, { ok: false, entrega: 'auto_fallo', mensaje: undefined });
  assertEquals(estado.cierres[0].resultado, 'fallo');
  assertEquals(estado.logs.at(-1)?.detalle.includes('devolvió el saldo'), true);
});

Deno.test('entregar: si sigue en proceso tras unas preguntas, queda "confirmando" (sin avisar de problema) para consultarla después', async () => {
  const { repo, estado } = crearRepoFalso();
  let consultas = 0;
  const proveedor = proveedorRealFalso({
    crearRecarga: () => Promise.resolve({ estado: 'en_proceso' as const, detalle: 'El proveedor está aplicando la recarga (orden #7)' }),
    consultarPedido: () => { consultas++; return Promise.resolve({ estado: 'en_proceso' as const }); },
  });
  const r = await entregarPedido({ repo, proveedor, ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO });
  assertEquals(r, { ok: false, entrega: 'auto_confirmando', mensaje: undefined });
  assertEquals(consultas, 3);
  assertEquals(estado.cierres[0].resultado, 'confirmando');
  assertEquals(estado.cierres[0].detalle, 'El proveedor está aplicando la recarga (orden #7)');
  assertEquals(estado.pedido?.estado, 'confirmado');
});

Deno.test('entregar: si al preguntar el proveedor falla o se contradice, no se inventa nada: queda "confirmando"', async () => {
  for (const consulta of [
    () => Promise.reject(new Error('sin red')),
    () => Promise.resolve({ estado: 'desconocido' as const, interno: 'HTTP 500' }),
    () => Promise.resolve({ estado: 'no_existe' as const }),
  ] as Array<() => Promise<ResultadoPedido>>) {
    const { repo, estado } = crearRepoFalso();
    const proveedor = proveedorRealFalso({ crearRecarga: () => Promise.resolve({ estado: 'en_proceso' as const, detalle: 'aplicando' }), consultarPedido: consulta });
    const r = await entregarPedido({ repo, proveedor, ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO });
    assertEquals(r.entrega, 'auto_confirmando');
    assertEquals(estado.cierres.length, 1);
  }
});

// ----------------------------------------------------------- revisarPedido
/** Un pedido que quedó a medias, con el proveedor respondiendo lo que se diga. */
function pedidoA_Medias(entrega: string, edadMs: number, proveedorExtra: Partial<Proveedor> = {}, intentos = 1) {
  const repo = crearRepoFalso({ pedido: { entrega, entrega_at: hace(edadMs), intentos } });
  const proveedor = proveedorRealFalso(proveedorExtra);
  return { ...repo, proveedor };
}
const respondiendo = (r: ResultadoPedido) => ({ consultarPedido: () => Promise.resolve(r) });

Deno.test('revisar: pedido inválido, inexistente o de otra persona; el dueño y el admin sí pueden', async () => {
  const { repo, proveedor } = pedidoA_Medias('auto_confirmando', 5 * MINUTO, respondiendo({ estado: 'en_proceso' }));
  assertEquals(await revisarPedido({ repo, proveedor }, CLIENTE, { pedido_id: 'no-es-uuid' }), { ok: false, motivo: 'pedido_invalido' });
  assertEquals(await revisarPedido({ repo: crearRepoFalso({ pedido: null }).repo, proveedor }, CLIENTE, { pedido_id: PEDIDO }), { ok: false, motivo: 'no_encontrado' });
  assertEquals(await revisarPedido({ repo, proveedor }, OTRO, { pedido_id: PEDIDO }), { ok: false, motivo: 'sin_permiso' });
  assertEquals((await revisarPedido({ repo, proveedor }, CLIENTE, { pedido_id: PEDIDO })).entrega, 'auto_confirmando');
  assertEquals((await revisarPedido({ repo, proveedor }, ADMIN, { pedido_id: PEDIDO })).entrega, 'auto_confirmando');
});

Deno.test('revisar: solo se pregunta por entregas que quedaron a medias (no por manuales, terminadas ni recién empezadas)', async () => {
  for (const [pedido, nombre] of [
    [{ entrega: 'manual' }, 'manual'], [{ entrega: 'auto_pendiente' }, 'pendiente'], [{ entrega: 'auto_entregado' }, 'entregada'],
    [{ entrega: 'auto_fallo' }, 'fallida'], [{ entrega: 'auto_en_proceso', entrega_at: hace(30 * 1000) }, 'en proceso hace 30 s'],
    [{ estado: 'completado', entrega: 'auto_confirmando', entrega_at: hace(9 * MINUTO) }, 'ya completada a mano'],
    [{ estado: 'cancelado', entrega: 'auto_revisar', entrega_at: hace(9 * MINUTO) }, 'cancelada'],
    [{ tipo: 'recarga_saldo', entrega: 'auto_revisar', entrega_at: hace(9 * MINUTO) }, 'otro tipo'],
  ] as Array<[Partial<InfoPedido>, string]>) {
    const { repo, estado } = crearRepoFalso({ pedido });
    let preguntas = 0;
    const proveedor = proveedorRealFalso({ consultarPedido: () => { preguntas++; return Promise.resolve({ estado: 'entregado' as const, ref: 'x' }); } });
    const antes = estado.pedido?.entrega;
    const r = await revisarPedido({ repo, proveedor }, CLIENTE, { pedido_id: PEDIDO });
    assertEquals(r.ok, true, nombre);
    assertEquals(preguntas, 0, nombre);
    assertEquals(estado.pedido?.entrega, antes, nombre);
  }
});

Deno.test('revisar: el proveedor confirma la entrega → el pedido queda entregado y completado (y se pregunta por la clave del último intento)', async () => {
  for (const entrega of ['auto_confirmando', 'auto_revisar']) {
    const preguntadas: Array<{ intento?: number; referencia: string }> = [];
    const { repo, estado, proveedor } = pedidoA_Medias(entrega, 5 * MINUTO, {
      consultarPedido: (c) => { preguntadas.push({ intento: c.intento, referencia: c.referencia }); return Promise.resolve({ estado: 'entregado' as const, ref: 'Proveedor: TXN-4471203' }); },
    }, 3);
    const r = await revisarPedido({ repo, proveedor }, CLIENTE, { pedido_id: PEDIDO });
    assertEquals(r, { ok: true, entrega: 'auto_entregado', mensaje: undefined }, entrega);
    assertEquals(estado.pedido?.estado, 'completado', entrega);
    assertEquals(estado.cierres[0].ref, 'Proveedor: TXN-4471203', entrega);
    assertEquals(preguntadas, [{ intento: 3, referencia: PEDIDO }], entrega);
    assertEquals(estado.logs.at(-1)?.ok, true, entrega);
  }
});

Deno.test('revisar: una entrega "en proceso" que se quedó a medias (más de 3 minutos) también se resuelve', async () => {
  const { repo, estado, proveedor } = pedidoA_Medias('auto_en_proceso', 4 * MINUTO, respondiendo({ estado: 'entregado', ref: 'ORD-5' }));
  assertEquals((await revisarPedido({ repo, proveedor }, CLIENTE, { pedido_id: PEDIDO })).entrega, 'auto_entregado');
  assertEquals(estado.pedido?.estado, 'completado');
});

Deno.test('revisar: el proveedor la rechazó y devolvió el saldo → queda como fallo para que el admin la reintente o la haga a mano', async () => {
  const { repo, estado, proveedor } = pedidoA_Medias('auto_confirmando', 5 * MINUTO, respondiendo({ estado: 'rechazado', interno: 'Reembolsado: sin detalle' }));
  const r = await revisarPedido({ repo, proveedor }, ADMIN, { pedido_id: PEDIDO });
  assertEquals(r, { ok: false, entrega: 'auto_fallo' });
  assertEquals(estado.cierres[0].resultado, 'fallo');
  assertEquals(estado.pedido?.estado, 'confirmado');
  assertEquals(estado.logs.at(-1)?.detalle.includes('devolvió el saldo'), true);
});

Deno.test('revisar: el proveedor no tiene la orden → solo es seguro darla por no hecha pasado el tiempo máximo', async () => {
  const reciente = pedidoA_Medias('auto_revisar', 1 * MINUTO, respondiendo({ estado: 'no_existe' }));
  const r1 = await revisarPedido({ repo: reciente.repo, proveedor: reciente.proveedor }, CLIENTE, { pedido_id: PEDIDO });
  assertEquals(r1, { ok: true, entrega: 'auto_revisar', mensaje: 'Todavía no aparece en el proveedor' });
  assertEquals(reciente.estado.cierres.length, 0);

  const vieja = pedidoA_Medias('auto_revisar', 4 * MINUTO, respondiendo({ estado: 'no_existe' }));
  const r2 = await revisarPedido({ repo: vieja.repo, proveedor: vieja.proveedor }, CLIENTE, { pedido_id: PEDIDO });
  assertEquals(r2, { ok: false, entrega: 'auto_fallo' });
  assertEquals(vieja.estado.cierres[0].resultado, 'fallo');
  assertEquals(vieja.estado.cierres[0].detalle, 'El proveedor no recibió la orden: no se cobró');
  assertEquals(vieja.estado.pedido?.estado, 'confirmado');
});

Deno.test('revisar: si el proveedor ya había aceptado la orden y ahora dice que no la tiene, no se toca (algo raro: hay que preguntarle)', async () => {
  const { repo, estado, proveedor } = pedidoA_Medias('auto_confirmando', 60 * MINUTO, respondiendo({ estado: 'no_existe' }));
  const r = await revisarPedido({ repo, proveedor }, CLIENTE, { pedido_id: PEDIDO });
  assertEquals(r, { ok: false, motivo: 'proveedor_no_responde', entrega: 'auto_confirmando' });
  assertEquals(estado.cierres.length, 0);
  assertEquals(estado.logs.at(-1)?.ok, false);
});

Deno.test('revisar: sigue en proceso → pasa a "confirmando" (desde sin confirmar o a medias) o se queda igual', async () => {
  for (const [entrega, edad] of [['auto_revisar', 5 * MINUTO], ['auto_en_proceso', 5 * MINUTO]] as Array<[string, number]>) {
    const { repo, estado, proveedor } = pedidoA_Medias(entrega, edad, respondiendo({ estado: 'en_proceso', interno: 'Ya está en el proveedor y se está aplicando.' }));
    const r = await revisarPedido({ repo, proveedor }, CLIENTE, { pedido_id: PEDIDO });
    assertEquals(r.entrega, 'auto_confirmando', entrega);
    assertEquals(estado.cierres[0].resultado, 'confirmando', entrega);
  }
  const igual = pedidoA_Medias('auto_confirmando', 5 * MINUTO, respondiendo({ estado: 'en_proceso' }));
  const r = await revisarPedido({ repo: igual.repo, proveedor: igual.proveedor }, CLIENTE, { pedido_id: PEDIDO });
  assertEquals(r, { ok: false, entrega: 'auto_confirmando', mensaje: 'Sigue en proceso en el proveedor' });
  assertEquals(igual.estado.cierres.length, 0);
});

Deno.test('revisar: si no se puede saber (sin red, error) no se cambia nada; si la llave no sirve, se apaga la conexión', async () => {
  for (const consulta of [
    () => Promise.reject(new Error('sin red')),
    () => Promise.resolve({ estado: 'desconocido' as const, interno: 'HTTP 500' }),
  ] as Array<() => Promise<ResultadoPedido>>) {
    const { repo, estado, proveedor } = pedidoA_Medias('auto_revisar', 5 * MINUTO, { consultarPedido: consulta });
    const r = await revisarPedido({ repo, proveedor }, CLIENTE, { pedido_id: PEDIDO });
    assertEquals(r, { ok: false, motivo: 'proveedor_no_responde', entrega: 'auto_revisar' });
    assertEquals(estado.cierres.length, 0);
    assertEquals(estado.conexion, true);
  }
  const { repo, estado, proveedor } = pedidoA_Medias('auto_revisar', 5 * MINUTO, respondiendo({ estado: 'desconocido', interno: 'La llave no sirve', credenciales: true }));
  await revisarPedido({ repo, proveedor }, CLIENTE, { pedido_id: PEDIDO });
  assertEquals(estado.estadoGuardado?.listo, false);
  assertEquals(estado.pedido?.entrega, 'auto_revisar', 'el pedido no cambia por un problema de llave');
});

Deno.test('revisar: aunque la conexión esté apagada (API vencida), se puede consultar qué pasó con lo que ya se envió', async () => {
  const { repo, estado, proveedor } = pedidoA_Medias('auto_confirmando', 5 * MINUTO, respondiendo({ estado: 'entregado', ref: 'x' }));
  estado.conexion = false;
  assertEquals((await revisarPedido({ repo, proveedor }, CLIENTE, { pedido_id: PEDIDO })).entrega, 'auto_entregado');
});

Deno.test('revisar: sin llave ni URL (integración apagada) no sale a internet', async () => {
  const { repo } = pedidoA_Medias('auto_confirmando', 5 * MINUTO);
  const r = await revisarPedido({ repo, proveedor: crearProveedor(env({})) }, CLIENTE, { pedido_id: PEDIDO });
  assertEquals(r, { ok: false, motivo: 'no_configurado', entrega: 'auto_confirmando' });
});

Deno.test('revisar: dos consultas a la vez cierran UNA vez y ninguna falla (cerrar dos veces lo mismo no es un error)', async () => {
  const { repo, estado, proveedor } = pedidoA_Medias('auto_confirmando', 5 * MINUTO, respondiendo({ estado: 'entregado', ref: 'ORD-1' }));
  const [a, b] = await Promise.all([
    revisarPedido({ repo, proveedor }, CLIENTE, { pedido_id: PEDIDO }),
    revisarPedido({ repo, proveedor }, ADMIN, { pedido_id: PEDIDO }),
  ]);
  assertEquals(a.entrega, 'auto_entregado');
  assertEquals(b.entrega, 'auto_entregado');
  assertEquals(estado.pedido?.estado, 'completado');
  assertEquals(estado.logs.some((l) => l.detalle.includes('NO SE PUDO GUARDAR')), false);
});

Deno.test('revisar: si no se puede guardar el resultado se avisa y el pedido queda como estaba', async () => {
  const { repo, estado, proveedor } = pedidoA_Medias('auto_confirmando', 5 * MINUTO, respondiendo({ estado: 'entregado', ref: 'ORD-1' }));
  estado.fallosAlCerrar = 99;
  const r = await revisarPedido({ repo, proveedor, ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO });
  assertEquals(r.ok, false);
  assertEquals(estado.pedido?.entrega, 'auto_confirmando');
  assertEquals(estado.logs.some((l) => l.detalle.includes('NO SE PUDO GUARDAR')), true);
});

Deno.test('flujo simulado completo: queda en proceso (777) y 20 segundos después se entrega; (666) se rechaza; (555) nunca termina', async () => {
  const flujo = async (fin: string, despuesMs: number) => {
    const { repo, estado } = crearRepoFalso({ pedido: { id_jugador: `123456${fin}` } });
    const proveedor = simulado();
    const compra = await entregarPedido({ repo, proveedor, ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO });
    const luego = await revisarPedido({ repo, proveedor, ahora: () => Date.now() + despuesMs }, CLIENTE, { pedido_id: PEDIDO });
    return { compra: compra.entrega, luego: luego.entrega, estado: estado.pedido?.estado };
  };
  assertEquals(await flujo('777', 25000), { compra: 'auto_confirmando', luego: 'auto_entregado', estado: 'confirmado' }); // simulado: nunca se completa de verdad
  assertEquals(await flujo('666', 25000), { compra: 'auto_confirmando', luego: 'auto_fallo', estado: 'confirmado' });
  assertEquals(await flujo('555', 25000), { compra: 'auto_confirmando', luego: 'auto_confirmando', estado: 'confirmado' });
  // una consulta enseguida (menos de 20 s) todavía lo ve aplicándose
  assertEquals((await flujo('777', 1000)).luego, 'auto_confirmando');
});

// ----------------------------------------------------------- probarIntegracion
Deno.test('probar: solo el admin', async () => {
  const { repo } = crearRepoFalso();
  assertEquals(await probarIntegracion({ repo, proveedor: simulado() }, CLIENTE, {}), { ok: false, motivo: 'sin_permiso' });
});

Deno.test('probar: apagado, simulado y real sin llave', async () => {
  const a = crearRepoFalso();
  const apagado = await probarIntegracion({ repo: a.repo, proveedor: crearProveedor(env({})) }, ADMIN, {});
  assertEquals(apagado.listo, false);
  assertEquals(a.estado.estadoGuardado?.modo, 'apagado');

  const b = crearRepoFalso();
  const sim = await probarIntegracion({ repo: b.repo, proveedor: simulado() }, ADMIN, {});
  assertEquals(sim.listo, true);
  assertEquals(sim.mensaje?.includes('SIMULADO'), true);
  assertEquals(b.estado.estadoGuardado?.listo, true);

  // real con URL pero sin llave: no está listo, dice qué falta y no sale a internet
  const c = crearRepoFalso();
  let salidas = 0;
  const http: typeof fetch = () => { salidas++; return Promise.resolve(new Response('{}')); };
  const sinLlave = await probarIntegracion({ repo: c.repo, proveedor: crearProveedor(env({ PROVEEDOR_MODO: 'real', PROVEEDOR_URL: 'https://x.test/api' }), http) }, ADMIN, {});
  assertEquals(sinLlave.listo, false);
  assertEquals(sinLlave.mensaje?.includes('PROVEEDOR_API_KEY'), true);
  assertEquals(c.estado.estadoGuardado?.listo, false);
  assertEquals(salidas, 0);
});

Deno.test('probar: con un proveedor real que responde, guarda el saldo, el vencimiento y el cupo de consultas', async () => {
  const { repo, estado } = crearRepoFalso();
  const proveedor = proveedorRealFalso({
    consultarSaldo: () => Promise.resolve({ ok: true, saldo: 12.5, moneda: 'USDT', detalle: 'Conexión correcta', vence_en: '2026-11-14T22:03:20.615Z', consultas_limite: 800, consultas_usadas: 312 }),
  });
  const r = await probarIntegracion({ repo, proveedor }, ADMIN, {});
  assertEquals(r.listo, true);
  assertEquals(r.saldo, 12.5);
  assertEquals(r.moneda, 'USDT');
  assertEquals(r.vence_en, '2026-11-14T22:03:20.615Z');
  assertEquals(estado.estadoGuardado, {
    modo: 'real', listo: true, saldo: 12.5, moneda: 'USDT', mensaje: 'Conexión correcta',
    vence_at: '2026-11-14T22:03:20.615Z', consultas_limite: 800, consultas_usadas: 312,
  });
});

Deno.test('probar: si el proveedor rechaza la llave o se cae, queda como no listo y no guarda fechas ni cupo', async () => {
  const rechaza = crearRepoFalso();
  const r1 = await probarIntegracion({ repo: rechaza.repo, proveedor: proveedorRealFalso({ consultarSaldo: () => Promise.resolve({ ok: false, detalle: 'La llave fue rechazada', vence_en: '2026-11-14T22:03:20.615Z' }) }) }, ADMIN, {});
  assertEquals(r1.listo, false);
  assertEquals(r1.ok, false);
  assertEquals(rechaza.estado.estadoGuardado?.listo, false);
  assertEquals(rechaza.estado.estadoGuardado?.vence_at, null);
  assertEquals(r1.mensaje, 'La llave fue rechazada');

  const cae = crearRepoFalso();
  const r2 = await probarIntegracion({ repo: cae.repo, proveedor: proveedorRealFalso({ consultarSaldo: () => Promise.reject(new Error('sin red')) }) }, ADMIN, {});
  assertEquals(r2.listo, false);
  assertEquals(r2.mensaje?.includes('sin red'), true);
  assertEquals(cae.estado.estadoGuardado?.listo, false);
});

Deno.test('probar: "solo_config" no llama al proveedor ni guarda nada', async () => {
  const { repo, estado } = crearRepoFalso();
  const r = await probarIntegracion({ repo, proveedor: simulado() }, ADMIN, { solo_config: true });
  assertEquals(r.ok, true);
  assertEquals(estado.estadoGuardado, null);
  assertNotEquals(r.modo, undefined);
});

Deno.test('catálogo del proveedor: solo admin y solo con conexión lista', async () => {
  const { repo } = crearRepoFalso();
  assertEquals(await catalogoProveedor({ repo, proveedor: simulado() }, CLIENTE), { ok: false, motivo: 'sin_permiso' });
  const apagado = await catalogoProveedor({ repo, proveedor: crearProveedor(env({})) }, ADMIN);
  assertEquals(apagado.ok, false);
  assertEquals(apagado.motivo, 'no_configurado');
  const sim = await catalogoProveedor({ repo, proveedor: simulado() }, ADMIN);
  assertEquals(sim.ok, true);
  assertEquals(sim.paquetes?.[0], { codigo: 'SIM-100', precio: 0.7 });
});

Deno.test('catálogo del proveedor: trae el juego y si el paquete necesita zona', async () => {
  const { repo } = crearRepoFalso();
  const proveedor = proveedorRealFalso({
    catalogo: () => Promise.resolve({
      ok: true, saldo: 5, moneda: 'USDT', detalle: 'ok',
      paquetes: [{ codigo: '341 Diamantes', precio: 2.14, juego: 'Free Fire', tipo: 'diamantes' }, { codigo: 'Paquete Elite Semanal', precio: 0.8, juego: 'Mobile Legends', tipo: 'diamantes', requiere_zona: true }],
    }),
  });
  const r = await catalogoProveedor({ repo, proveedor }, ADMIN);
  assertEquals(r.paquetes?.[1], { codigo: 'Paquete Elite Semanal', precio: 0.8, juego: 'Mobile Legends', tipo: 'diamantes', requiere_zona: true });
});

// ----------------------------------------------------------- llave rechazada al entregar
Deno.test('entregar: si el proveedor rechaza la llave, la conexión se apaga y las compras nuevas irán a mano', async () => {
  const { repo, estado } = crearRepoFalso();
  const proveedor = proveedorRealFalso({
    crearRecarga: () => Promise.resolve({ estado: 'fallo' as const, detalle: 'El proveedor rechazó la solicitud', interno: 'El acceso a la API venció (o no incluye este juego): pide que te lo renueven', credenciales: true }),
  });
  const r = await entregarPedido({ repo, proveedor, ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO });
  assertEquals(r.ok, false);
  assertEquals(estado.cierres[0].resultado, 'fallo'); // este pedido queda para que el admin lo reintente
  assertEquals(estado.estadoGuardado?.listo, false);
  assertEquals(estado.estadoGuardado?.modo, 'real');
  assertEquals(estado.estadoGuardado?.mensaje.includes('venció'), true);
  assertEquals(estado.estadoGuardado?.mensaje.includes('Probar conexión'), true);
  assertEquals(estado.logs.some((l) => l.detalle.includes('pide que te lo renueven')), true);
  // y el siguiente pedido ya no se manda al proveedor: va a mano
  const siguiente = crearRepoFalso({ conexion: false });
  assertEquals((await entregarPedido({ repo: siguiente.repo, proveedor, ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO })).entrega, 'manual');
});

Deno.test('entregar: un rechazo normal (por ejemplo saldo insuficiente) NO apaga la conexión, pero sí pone al día el saldo', async () => {
  const { repo, estado } = crearRepoFalso();
  const proveedor = proveedorRealFalso({
    crearRecarga: () => Promise.resolve({ estado: 'fallo' as const, detalle: 'El proveedor no pudo procesar el paquete', interno: 'No hay saldo suficiente en el proveedor', saldo: 0.1 }),
  });
  await entregarPedido({ repo, proveedor, ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO });
  assertEquals(estado.estadoGuardado, null);
  assertEquals(estado.conexion, true);
  assertEquals(estado.usos, [{ saldo: 0.1, restantes: null }]);
});

Deno.test('entregar: el motivo real del rechazo va solo al registro, no al pedido', async () => {
  const { repo, estado } = crearRepoFalso();
  const base = simulado();
  const proveedor: Proveedor = { ...base, crearRecarga: () => Promise.resolve({ estado: 'fallo' as const, detalle: 'El proveedor no pudo procesar el paquete', interno: 'HTTP 400: Saldo insuficiente' }) };
  const r = await entregarPedido({ repo, proveedor, ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO });
  assertEquals(r.ok, false);
  assertEquals(estado.cierres[0].detalle, 'El proveedor no pudo procesar el paquete');
  assertEquals(estado.logs.at(-1)?.detalle.includes('Saldo insuficiente'), true);
  assertEquals(estado.cierres[0].detalle?.includes('Saldo'), false);
});

// ----------------------------------------------------------- actualizarSaldo
const saldoNuevo = () => proveedorRealFalso({
  consultarSaldo: () => Promise.resolve({ ok: true, saldo: 8, moneda: 'USDT', detalle: 'Conexión correcta: 49 paquetes en el catálogo', vence_en: '2026-11-15T00:53:31.620Z', consultas_limite: 800, consultas_usadas: 12 }),
});

Deno.test('actualizar saldo: solo el admin', async () => {
  const { repo, estado } = crearRepoFalso();
  assertEquals(await actualizarSaldo({ repo, proveedor: saldoNuevo() }, CLIENTE), { ok: false, motivo: 'sin_permiso' });
  assertEquals(estado.estadoGuardado, null);
});

Deno.test('actualizar saldo: guarda el saldo, el vencimiento y el cupo nuevos, sin dejar rastro en el registro', async () => {
  const { repo, estado } = crearRepoFalso();
  assertEquals(await actualizarSaldo({ repo, proveedor: saldoNuevo() }, ADMIN), { ok: true });
  assertEquals(estado.estadoGuardado, {
    modo: 'real', listo: true, saldo: 8, moneda: 'USDT', mensaje: 'Conexión correcta: 49 paquetes en el catálogo',
    vence_at: '2026-11-15T00:53:31.620Z', consultas_limite: 800, consultas_usadas: 12,
  });
  assertEquals(estado.logs.length, 0);
  assertEquals(estado.conexion, true);
});

Deno.test('actualizar saldo: sin conexión real y probada no llama al proveedor (apagado, simulado o conexión apagada)', async () => {
  const sinLlamar = (extra: Partial<Proveedor> = {}) => proveedorRealFalso({ consultarSaldo: () => { throw new Error('no debe llamarse'); }, ...extra });
  for (const [proveedor, conexion] of [
    [crearProveedor(env({})), true],
    [simulado(), true],
    [sinLlamar(), false], // la conexión se apagó (llave vencida, prueba fallida...): se vuelve a encender solo con "Probar conexión"
    [sinLlamar({ listo: () => false }), true],
  ] as Array<[Proveedor, boolean]>) {
    const { repo, estado } = crearRepoFalso({ conexion });
    assertEquals(await actualizarSaldo({ repo, proveedor }, ADMIN), { ok: false, motivo: 'no_configurado' });
    assertEquals(estado.estadoGuardado, null);
  }
});

Deno.test('actualizar saldo: si el proveedor falla o no responde NO se apaga nada y solo se avisa', async () => {
  for (const consultarSaldo of [
    () => Promise.resolve({ ok: false, detalle: 'No se pudo contactar al proveedor: no respondió a tiempo' }),
    () => Promise.resolve({ ok: false, detalle: 'El acceso a la API venció (o no incluye este juego): pide que te lo renueven.' }),
    () => Promise.reject(new Error('sin red')),
  ] as Array<Proveedor['consultarSaldo']>) {
    const { repo, estado } = crearRepoFalso();
    const r = await actualizarSaldo({ repo, proveedor: proveedorRealFalso({ consultarSaldo }) }, ADMIN);
    assertEquals(r.ok, false);
    assertEquals(typeof r.mensaje, 'string');
    assertEquals(estado.estadoGuardado, null, 'una falla pasajera no cambia el estado de la conexión');
    assertEquals(estado.conexion, true);
  }
});

Deno.test('actualizar saldo: si no se puede guardar, avisa sin romper nada', async () => {
  const { repo } = crearRepoFalso();
  repo.guardarEstado = () => Promise.reject(new Error('base de datos caída'));
  const r = await actualizarSaldo({ repo, proveedor: saldoNuevo() }, ADMIN);
  assertEquals(r.ok, false);
  assertEquals(r.mensaje?.includes('base de datos caída'), true);
});

// Pruebas de las reglas de la integración (sin red ni base de datos).
// Se corren con:  deno test supabase/functions/integracion/logica_test.ts
// Este archivo NO se despliega: es solo para comprobar la lógica.
// deno-lint-ignore-file require-await
import { assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import type { EstadoGuardado, InfoPedido, Juego, Reclamo, Repo } from './logica.ts';
import { catalogoProveedor, entregarPedido, limpiarNickname, probarIntegracion, validarJugador } from './logica.ts';
import { crearProveedor, type Proveedor } from './proveedor.ts';

const ADMIN = '00000000-0000-4000-8000-0000000000aa';
const CLIENTE = '00000000-0000-4000-8000-0000000000bb';
const OTRO = '00000000-0000-4000-8000-0000000000cc';
const PEDIDO = '11111111-1111-4111-8111-111111111111';

function juegoBase(extra: Partial<Juego> = {}): Juego {
  return { slug: 'free-fire', activo: true, validar_auto: true, entrega_auto: true, patron_id: '^[0-9]{5,15}$', usa_zona: false, ...extra };
}

/** Repo en memoria que imita las garantías de la base de datos (reclamar una sola vez, etc.). */
function crearRepoFalso(inicial: { juego?: Juego | null; pedido?: Partial<InfoPedido> | null; admins?: string[]; permitir?: boolean } = {}) {
  const estado = {
    juego: inicial.juego === undefined ? juegoBase() : inicial.juego,
    pedido: inicial.pedido === null ? null : {
      id: PEDIDO, usuario_id: CLIENTE, tipo: 'compra_diamantes', estado: 'confirmado', entrega: 'auto_pendiente',
      entrega_at: null, id_jugador: '123456789', paquete_id: 7, juego: 'free-fire', ...inicial.pedido,
    } as InfoPedido,
    admins: inicial.admins ?? [ADMIN],
    cache: new Map<string, { nickname: string; consultado_at: string }>(),
    logs: [] as Array<{ tipo: string; ok: boolean; detalle: string }>,
    cierres: [] as Array<{ resultado: string; ref: string | null; detalle: string | null; simulado: boolean }>,
    reclamos: 0,
    manualizados: 0,
    falloAlManualizar: false,
    consultasPermitidas: inicial.permitir ?? true,
    estadoGuardado: null as EstadoGuardado | null,
    fallosAlCerrar: 0,
  };
  const repo: Repo = {
    obtenerJuego: async () => estado.juego,
    obtenerCache: async (j, id, z) => estado.cache.get(`${j}|${id}|${z}`) ?? null,
    guardarCache: async (j, id, z, nickname) => { estado.cache.set(`${j}|${id}|${z}`, { nickname, consultado_at: new Date().toISOString() }); },
    permitirConsulta: async () => estado.consultasPermitidas,
    log: async (tipo, _j, _p, _u, ok, detalle) => { estado.logs.push({ tipo, ok, detalle }); },
    esAdmin: async (u) => estado.admins.includes(u),
    infoPedido: async () => (estado.pedido ? { ...estado.pedido } : null),
    reclamarEntrega: async (_id, forzar) => {
      const p = estado.pedido;
      if (!p || p.tipo !== 'compra_diamantes' || p.estado !== 'confirmado') return null;
      const ok = p.entrega === 'auto_pendiente' || (forzar && ['auto_fallo', 'auto_revisar', 'auto_en_proceso'].includes(p.entrega));
      if (!ok) return null;
      p.entrega = 'auto_en_proceso';
      estado.reclamos++;
      return { pedido_id: p.id, id_jugador: p.id_jugador ?? '', juego: p.juego, codigo: 'FF-100', nombre_paquete: '100 Diamantes', cantidad: 100, intentos: estado.reclamos } as Reclamo;
    },
    pasarAManual: async () => {
      if (estado.falloAlManualizar) throw new Error('base de datos caída');
      const p = estado.pedido;
      if (p && p.tipo === 'compra_diamantes' && p.estado === 'confirmado' && p.entrega === 'auto_pendiente') {
        p.entrega = 'manual';
        estado.manualizados++;
      }
    },
    cerrarEntrega: async (_id, resultado, ref, detalle, simulado) => {
      if (estado.fallosAlCerrar > 0) { estado.fallosAlCerrar--; throw new Error('base de datos caída'); }
      estado.cierres.push({ resultado, ref, detalle, simulado });
      if (estado.pedido) estado.pedido.entrega = resultado === 'entregado' ? 'auto_entregado' : resultado === 'fallo' ? 'auto_fallo' : 'auto_revisar';
    },
    guardarEstado: async (e) => { estado.estadoGuardado = e; },
  };
  return { repo, estado };
}

function env(valores: Record<string, string>) { return (k: string) => valores[k]; }
const simulado = () => crearProveedor(env({ PROVEEDOR_MODO: 'simulado' }));
const sinEsperas = { esperar: async () => {} };

// ----------------------------------------------------------------- limpieza
Deno.test('limpiarNickname quita controles y recorta', () => {
  assertEquals(limpiarNickname('  Juan\u0000\u001f Pérez  '), 'Juan Pérez');
  assertEquals(limpiarNickname('x'.repeat(100)).length, 60);
  assertEquals(limpiarNickname(null), '');
});

// ------------------------------------------------------------ validarJugador
Deno.test('validar: apagado o sin credenciales → no_configurado (la web sigue como siempre)', async () => {
  const { repo } = crearRepoFalso();
  for (const modo of ['', 'apagado', 'real']) { // "real" sin adaptador completo tampoco está listo
    const r = await validarJugador({ repo, proveedor: crearProveedor(env({ PROVEEDOR_MODO: modo, PROVEEDOR_URL: 'https://x.test', PROVEEDOR_API_KEY: 'k' })) }, CLIENTE, { juego: 'free-fire', id_jugador: '123456789' });
    assertEquals(r, { ok: false, motivo: 'no_configurado' });
  }
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

Deno.test('entregar: lo ya entregado, manual o pagado de otro tipo no se vuelve a enviar', async () => {
  for (const pedido of [{ entrega: 'auto_entregado' }, { entrega: 'manual' }, { estado: 'completado' }, { tipo: 'recarga_saldo' }, { entrega: 'auto_en_proceso' }]) {
    const { repo, estado } = crearRepoFalso({ pedido });
    let enviadas = 0;
    const base = simulado();
    const proveedor: Proveedor = { ...base, crearRecarga: async (p) => { enviadas++; return base.crearRecarga(p); } };
    const r = await entregarPedido({ repo, proveedor, ...sinEsperas }, CLIENTE, { pedido_id: PEDIDO });
    assertEquals(enviadas, 0, JSON.stringify(pedido));
    assertEquals(estado.reclamos, 0);
    assertEquals(r.ok, true);
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

Deno.test('entregar: el admin sí puede forzar un reintento', async () => {
  const { repo, estado } = crearRepoFalso({ pedido: { entrega: 'auto_fallo' } });
  const r = await entregarPedido({ repo, proveedor: simulado(), ...sinEsperas }, ADMIN, { pedido_id: PEDIDO, forzar: true });
  assertEquals(r.ok, true);
  assertEquals(estado.reclamos, 1);
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

// ----------------------------------------------------------- probarIntegracion
Deno.test('probar: solo el admin', async () => {
  const { repo } = crearRepoFalso();
  assertEquals(await probarIntegracion({ repo, proveedor: simulado() }, CLIENTE, {}), { ok: false, motivo: 'sin_permiso' });
});

Deno.test('probar: apagado, simulado y real con el adaptador sin completar', async () => {
  const a = crearRepoFalso();
  const apagado = await probarIntegracion({ repo: a.repo, proveedor: crearProveedor(env({})) }, ADMIN, {});
  assertEquals(apagado.listo, false);
  assertEquals(a.estado.estadoGuardado?.modo, 'apagado');

  const b = crearRepoFalso();
  const sim = await probarIntegracion({ repo: b.repo, proveedor: simulado() }, ADMIN, {});
  assertEquals(sim.listo, true);
  assertEquals(sim.mensaje?.includes('SIMULADO'), true);
  assertEquals(b.estado.estadoGuardado?.listo, true);

  // real con URL y llave, pero con el adaptador sin completar: no está listo y lo dice
  const c = crearRepoFalso();
  const real = await probarIntegracion({ repo: c.repo, proveedor: crearProveedor(env({ PROVEEDOR_MODO: 'real', PROVEEDOR_URL: 'https://x.test', PROVEEDOR_API_KEY: 'secreta' })) }, ADMIN, {});
  assertEquals(real.listo, false);
  assertEquals(real.mensaje?.includes('completar el adaptador'), true);
  assertEquals(JSON.stringify(real).includes('secreta'), false, 'la llave nunca debe salir en la respuesta');
});

/** Un proveedor "real" de mentira (sin red), para probar las reglas de logica.ts con respuestas a medida. */
function proveedorRealFalso(extra: Partial<Proveedor> = {}): Proveedor {
  return {
    ...simulado(),
    modo: () => 'real',
    listo: () => true,
    nicknameDisponible: () => true,
    diagnostico: () => ({ modo: 'real', adaptador_implementado: true, tiene_url: true, tiene_llave: true, nickname_disponible: true }),
    consultarSaldo: () => Promise.resolve({ ok: true, saldo: 42.85, moneda: 'USD', detalle: 'Conexión correcta' }),
    ...extra,
  };
}

Deno.test('probar: con un proveedor real que responde, guarda el saldo', async () => {
  const { repo, estado } = crearRepoFalso();
  const r = await probarIntegracion({ repo, proveedor: proveedorRealFalso() }, ADMIN, {});
  assertEquals(r.listo, true);
  assertEquals(r.saldo, 42.85);
  assertEquals(r.moneda, 'USD');
  assertEquals(estado.estadoGuardado?.listo, true);
  assertEquals(estado.estadoGuardado?.saldo, 42.85);
});

Deno.test('probar: si el proveedor rechaza la llave o se cae, queda como no listo', async () => {
  const rechaza = crearRepoFalso();
  const r1 = await probarIntegracion({ repo: rechaza.repo, proveedor: proveedorRealFalso({ consultarSaldo: () => Promise.resolve({ ok: false, detalle: 'La llave fue rechazada' }) }) }, ADMIN, {});
  assertEquals(r1.listo, false);
  assertEquals(r1.ok, false);
  assertEquals(rechaza.estado.estadoGuardado?.listo, false);
  assertEquals(r1.mensaje, 'La llave fue rechazada');

  const cae = crearRepoFalso();
  const r2 = await probarIntegracion({ repo: cae.repo, proveedor: proveedorRealFalso({ consultarSaldo: () => Promise.reject(new Error('sin red')) }) }, ADMIN, {});
  assertEquals(r2.listo, false);
  assertEquals(r2.mensaje?.includes('sin red'), true);
  assertEquals(cae.estado.estadoGuardado?.listo, false);
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

Deno.test('validar: si el proveedor no ofrece consulta de nickname, no se gasta ningún intento', async () => {
  const { repo, estado } = crearRepoFalso();
  let consultas = 0;
  const proveedor = proveedorRealFalso({
    nicknameDisponible: () => false,
    consultarJugador: () => { consultas++; return Promise.resolve({ ok: true as const, nickname: 'x' }); },
  });
  assertEquals(await validarJugador({ repo, proveedor }, CLIENTE, { juego: 'free-fire', id_jugador: '123456789' }), { ok: false, motivo: 'no_configurado' });
  assertEquals(consultas, 0);
  assertEquals(estado.logs.length, 0);
});

Deno.test('probar: "solo_config" no llama al proveedor ni guarda nada', async () => {
  const { repo, estado } = crearRepoFalso();
  const r = await probarIntegracion({ repo, proveedor: simulado() }, ADMIN, { solo_config: true });
  assertEquals(r.ok, true);
  assertEquals(estado.estadoGuardado, null);
  assertNotEquals(r.modo, undefined);
});

// Pruebas del adaptador (modos, configuración, modo real con un "fetch" de mentira y modo simulado). No sale a internet.
// Las respuestas del modo real son las que documenta el proveedor (ejemplos literales de su documentación).
// Se corren con:  deno test supabase/functions/integracion/
// Este archivo NO se despliega: es solo para comprobar la lógica.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { claveDeOrden, crearProveedor, JUEGOS_CON_NICKNAME, NICKNAME_REAL_IMPLEMENTADO, type PedidoRecarga } from './proveedor.ts';

const LLAVE = 'LLAVE-SECRETA-123';
const URL_API = 'https://proveedor.test/api';
const PEDIDO = '11111111-1111-4111-8111-111111111111';
const REAL = { PROVEEDOR_MODO: 'real', PROVEEDOR_URL: URL_API, PROVEEDOR_API_KEY: LLAVE };
const env = (valores: Record<string, string>) => (k: string) => valores[k];

interface Llamada { url: string; metodo: string; cabeceras: Record<string, string>; cuerpo: Record<string, unknown> }

/** Un fetch de mentira: anota cada llamada y responde lo que diga el "manejador" (o falla si el manejador lanza). */
function falso(manejador: (c: Llamada) => Response | Promise<Response>) {
  const llamadas: Llamada[] = [];
  const http = async (url: string, init: RequestInit): Promise<Response> => {
    const llamada: Llamada = {
      url,
      metodo: String(init.method),
      cabeceras: Object.fromEntries(new Headers(init.headers).entries()),
      cuerpo: JSON.parse(String(init.body)),
    };
    llamadas.push(llamada);
    return await manejador(llamada);
  };
  return { http, llamadas };
}

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

/** Un proveedor que nunca contesta, pero respeta el tiempo máximo (abortar). */
const colgada = (_url: string, init: RequestInit) => new Promise<Response>((_ok, mal) => {
  init.signal?.addEventListener('abort', () => mal(new DOMException('The signal has been aborted', 'AbortError')));
});

const pedido = (extra: Partial<PedidoRecarga> = {}): PedidoRecarga => ({ juego: 'free-fire', id: '2267632897', codigo: '341 Diamantes', referencia: PEDIDO, ...extra });
const real = (http: Parameters<typeof crearProveedor>[1], espera = 60) => crearProveedor(env(REAL), http, espera);
const sinLlave = (x: unknown) => assert(!JSON.stringify(x).includes(LLAVE), 'la llave nunca debe salir en un resultado');
const respuesta = (cuerpo: unknown, status = 200) => () => json(cuerpo, status);

// Errores de llave, tal como los documenta el proveedor (HTTP + código fijo)
const ERRORES_DE_LLAVE: Array<[string, number, string]> = [
  ['falta la llave', 401, 'missing_api_key'],
  ['llave inválida o reemplazada', 401, 'key_invalida'],
  ['API pausada', 403, 'cuenta_inactiva'],
  ['acceso vencido', 403, 'cuenta_vencida'],
];
const cuerpoDeError = (error: string, message = 'texto del proveedor') => ({ ok: false, error, message });

// ------------------------------------------------------------------ modos y configuración
Deno.test('modo: sin secret o con un valor raro queda apagado; se acepta mayúsculas y espacios', () => {
  assertEquals(crearProveedor(env({})).modo(), 'apagado');
  assertEquals(crearProveedor(env({ PROVEEDOR_MODO: 'cualquier-cosa' })).modo(), 'apagado');
  assertEquals(crearProveedor(env({ PROVEEDOR_MODO: ' Simulado ' })).modo(), 'simulado');
  assertEquals(crearProveedor(env({ PROVEEDOR_MODO: ' REAL ' })).modo(), 'real');
});

Deno.test('real: está listo solo con URL https y llave; el nickname solo existe para Free Fire', () => {
  const p = crearProveedor(env(REAL), (() => Promise.reject(new Error('no debe llamarse'))) as typeof fetch);
  assertEquals(p.listo(), true);
  assertEquals(NICKNAME_REAL_IMPLEMENTADO, true);
  assertEquals(JUEGOS_CON_NICKNAME, ['free-fire']);
  assertEquals(p.nicknameDisponible(), true);
  assertEquals(p.nicknameDisponible('free-fire'), true);
  assertEquals(p.nicknameDisponible('mobile-legends'), false);
  assertEquals(p.diagnostico(), { modo: 'real', adaptador_implementado: true, tiene_url: true, tiene_llave: true, nickname_disponible: true });

  assertEquals(crearProveedor(env({ ...REAL, PROVEEDOR_URL: 'http://proveedor.test/api' })).listo(), false, 'sin https no se usa');
  assertEquals(crearProveedor(env({ ...REAL, PROVEEDOR_URL: '' })).listo(), false);
  assertEquals(crearProveedor(env({ ...REAL, PROVEEDOR_API_KEY: '  ' })).listo(), false);
});

Deno.test('apagado y real sin credenciales: no están listos y no salen a la red', async () => {
  const { http, llamadas } = falso(() => json({ ok: true }));
  const sinCredenciales: Array<Record<string, string>> = [{}, { PROVEEDOR_MODO: 'real', PROVEEDOR_URL: URL_API }];
  for (const valores of sinCredenciales) {
    const p = crearProveedor(env(valores), http);
    assertEquals(p.listo(), false);
    assertEquals((await p.crearRecarga(pedido())).estado, 'fallo');
    assertEquals((await p.consultarPedido({ juego: 'free-fire', id: '2267632897', referencia: PEDIDO })).estado, 'desconocido');
    assertEquals(await p.consultarJugador({ juego: 'free-fire', id: '2267632897' }), { ok: false, motivo: 'no_configurado' });
    assertEquals((await p.consultarSaldo()).ok, false);
    assertEquals((await p.catalogo()).ok, false);
  }
  assertEquals(llamadas.length, 0);
});

Deno.test('claveDeOrden: cada intento tiene su propia clave (la primera es la de siempre)', () => {
  assertEquals(claveDeOrden(PEDIDO), `MZ-${PEDIDO}`);
  assertEquals(claveDeOrden(PEDIDO, 1), `MZ-${PEDIDO}`);
  assertEquals(claveDeOrden(PEDIDO, 2), `MZ-${PEDIDO}-2`);
  assertEquals(claveDeOrden(PEDIDO, 12), `MZ-${PEDIDO}-12`);
  assert(claveDeOrden(PEDIDO, 999).length <= 100, 'el proveedor acepta claves de hasta 100 caracteres');
});

// ------------------------------------------------------------------ saldo y catálogo
const SALDO_DOC = {
  ok: true,
  balance_usd: 12.5,
  vence_en: '2026-11-14T22:03:20.615682+00:00',
  dias_restantes: 15,
  consultas_id: { limite: 800, usadas: 312, restantes: 488 },
  paquetes: [
    { paquete: '341 Diamantes', juego: 'Free Fire', tipo: 'diamantes', precio_usd: 2.14, requiere_zone_id: false },
    { paquete: 'Tarjeta Semanal Básica (Instantánea)', juego: 'Free Fire', tipo: 'tarjeta', precio_usd: 0.8, requiere_zone_id: false },
    { paquete: 'Paquete Elite Semanal', juego: 'Mobile Legends', tipo: 'diamantes', precio_usd: 0.8, requiere_zone_id: true },
    { paquete: '', precio_usd: 1 },                         // sin nombre: se ignora
    { paquete: 'raro', precio_usd: 'no-es-un-numero' },     // precio inválido: se ignora
  ],
};

Deno.test('saldo: manda POST con la llave en X-API-Key y la acción "saldo", y entiende la respuesta documentada', async () => {
  const { http, llamadas } = falso(respuesta(SALDO_DOC));
  const p = real(http);
  const s = await p.consultarSaldo();
  assertEquals(s, {
    ok: true, saldo: 12.5, moneda: 'USDT', detalle: 'Conexión correcta: 3 paquetes en el catálogo',
    vence_en: '2026-11-14T22:03:20.615Z', consultas_limite: 800, consultas_usadas: 312,
  });
  assertEquals(llamadas.length, 1);
  assertEquals(llamadas[0].url, URL_API);
  assertEquals(llamadas[0].metodo, 'POST');
  assertEquals(llamadas[0].cabeceras['x-api-key'], LLAVE);
  assertEquals(llamadas[0].cuerpo, { accion: 'saldo' });

  const c = await p.catalogo();
  assertEquals(c.paquetes, [
    { codigo: '341 Diamantes', precio: 2.14, juego: 'Free Fire', tipo: 'diamantes' },
    { codigo: 'Tarjeta Semanal Básica (Instantánea)', precio: 0.8, juego: 'Free Fire', tipo: 'tarjeta' },
    { codigo: 'Paquete Elite Semanal', precio: 0.8, juego: 'Mobile Legends', tipo: 'diamantes', requiere_zona: true },
  ]);
  sinLlave(s); sinLlave(c);
});

Deno.test('saldo: acepta un saldo en cero, y funciona sin vencimiento ni cupo', async () => {
  const s = await real(falso(respuesta({ ok: true, balance_usd: 0, paquetes: [] })).http).consultarSaldo();
  assertEquals(s.ok, true);
  assertEquals(s.saldo, 0);
  assertEquals(s.vence_en, undefined);
  assertEquals(s.consultas_limite, undefined);
  const raro = await real(falso(respuesta({ ok: true, balance_usd: 3, vence_en: 'mañana', consultas_id: { limite: 'x' }, paquetes: [] })).http).consultarSaldo();
  assertEquals(raro.ok, true, 'un vencimiento ilegible no tumba la conexión');
  assertEquals(raro.vence_en, undefined);
});

Deno.test('saldo: errores de llave dicen qué hacer (renovar, activar, revisar la llave)', async () => {
  const esperado: Record<string, string> = {
    missing_api_key: 'PROVEEDOR_API_KEY',
    key_invalida: 'se generó otra nueva',
    cuenta_inactiva: 'pausada',
    cuenta_vencida: 'venció',
  };
  for (const [nombre, estado, codigo] of ERRORES_DE_LLAVE) {
    const s = await real(falso(respuesta(cuerpoDeError(codigo), estado)).http).consultarSaldo();
    assertEquals(s.ok, false, nombre);
    assertStringIncludes(s.detalle, esperado[codigo], nombre);
    sinLlave(s);
  }
});

Deno.test('saldo: todo lo demás que sale mal queda como "no listo" con un motivo claro (y sin la llave)', async () => {
  const casos: Array<[string, () => Response | Promise<Response>, string]> = [
    ['error del proveedor', respuesta(cuerpoDeError('internal_error', 'No se pudo consultar el estado.'), 500), 'HTTP 500: internal_error'],
    ['respuesta que no es JSON', () => new Response('<html>Bad gateway</html>', { status: 502 }), 'HTTP 502'],
    ['ok:false', respuesta(cuerpoDeError('accion_invalida'), 400), 'accion_invalida'],
    ['sin saldo en la respuesta', respuesta({ ok: true, paquetes: [], algo: 1 }), 'campos recibidos: ok, paquetes, algo'],
    ['se cae la red', () => { throw new TypeError('error sending request'); }, 'No se pudo contactar'],
  ];
  for (const [nombre, manejador, esperado] of casos) {
    const s = await real(falso(manejador).http).consultarSaldo();
    assertEquals(s.ok, false, nombre);
    assertStringIncludes(s.detalle, esperado, nombre);
    sinLlave(s);
  }
  const lento = await real(colgada as typeof fetch).consultarSaldo();
  assertEquals(lento.ok, false);
  assertStringIncludes(lento.detalle, 'a tiempo');
});

// ------------------------------------------------------------------ nickname (validar_id)
Deno.test('nickname: manda "validar_id" con el ID y entiende la respuesta documentada', async () => {
  const { http, llamadas } = falso(respuesta({ ok: true, nombre_usuario: 'JugadorEjemplo', id_jugador: '2267632897', nivel: '62', region: 'SAC', likes: '1234', consultas_restantes: 487 }));
  const r = await real(http).consultarJugador({ juego: 'free-fire', id: '2267632897' });
  assertEquals(r, { ok: true, nickname: 'JugadorEjemplo', extra: { region: 'SAC', nivel: '62', likes: '1234' }, restantes: 487 });
  assertEquals(llamadas[0].cuerpo, { accion: 'validar_id', id_juego: '2267632897' });
  assertEquals(llamadas[0].cabeceras['x-api-key'], LLAVE);
  sinLlave(r);
});

Deno.test('nickname: nivel, región y likes pueden venir vacíos; sin nickname no sirve', async () => {
  const vacio = await real(falso(respuesta({ ok: true, nombre_usuario: 'Solo Nick', id_jugador: '2267632897', nivel: null, region: null, likes: null, consultas_restantes: 10 })).http).consultarJugador({ juego: 'free-fire', id: '2267632897' });
  assertEquals(vacio, { ok: true, nickname: 'Solo Nick', extra: { region: null, nivel: null, likes: null }, restantes: 10 });
  const sinNick = await real(falso(respuesta({ ok: true, nombre_usuario: '  ', consultas_restantes: 9 })).http).consultarJugador({ juego: 'free-fire', id: '2267632897' });
  assertEquals(sinNick.ok, false);
  if (!sinNick.ok) { assertEquals(sinNick.motivo, 'no_disponible'); assertEquals(sinNick.restantes, 9); }
});

Deno.test('nickname: "no existe" es un resultado normal y trae lo que queda del cupo', async () => {
  const r = await real(falso(respuesta({ ok: false, error: 'id_no_encontrado', message: 'No se encontró ninguna cuenta con ese ID.', consultas_restantes: 486 }, 404)).http).consultarJugador({ juego: 'free-fire', id: '2267632897' });
  assertEquals(r, { ok: false, motivo: 'no_encontrado', restantes: 486 });
  // un ID rechazado sin consultar (muy corto o muy largo) también es "no existe", y no trae cupo
  const corto = await real(falso(respuesta(cuerpoDeError('id_no_encontrado'), 404)).http).consultarJugador({ juego: 'free-fire', id: '123456' });
  assertEquals(corto, { ok: false, motivo: 'no_encontrado' });
  const invalido = await real(falso(respuesta(cuerpoDeError('id_invalido'), 400)).http).consultarJugador({ juego: 'free-fire', id: '2267632897' });
  assertEquals(invalido, { ok: false, motivo: 'no_encontrado' });
});

Deno.test('nickname: sin cupo, validador ocupado o en mantenimiento NO es "no existe": la compra sigue sin nickname', async () => {
  const casos: Array<[string, number, string, string]> = [
    ['cupo agotado', 429, 'cupo_agotado', 'cupo'],
    ['muy ocupado', 429, 'muy_ocupado', 'ocupado'],
    ['mantenimiento', 503, 'mantenimiento', 'mantenimiento'],
    ['error interno', 500, 'internal_error', 'HTTP 500'],
  ];
  for (const [nombre, estado, codigo, enInterno] of casos) {
    const r = await real(falso(respuesta(cuerpoDeError(codigo), estado)).http).consultarJugador({ juego: 'free-fire', id: '2267632897' });
    assertEquals(r.ok, false, nombre);
    if (!r.ok) {
      assertEquals(r.motivo, 'no_disponible', nombre);
      assertStringIncludes(r.interno ?? '', enInterno, nombre);
      assertEquals(r.credenciales, undefined, nombre);
    }
  }
  const agotado = await real(falso(respuesta(cuerpoDeError('cupo_agotado'), 429)).http).consultarJugador({ juego: 'free-fire', id: '2267632897' });
  if (!agotado.ok) assertEquals(agotado.restantes, 0);
});

Deno.test('nickname: si la llave no sirve se avisa (credenciales) y no es "no existe"', async () => {
  for (const [nombre, estado, codigo] of ERRORES_DE_LLAVE) {
    const r = await real(falso(respuesta(cuerpoDeError(codigo), estado)).http).consultarJugador({ juego: 'free-fire', id: '2267632897' });
    assertEquals(r.ok, false, nombre);
    if (!r.ok) { assertEquals(r.motivo, 'no_disponible', nombre); assertEquals(r.credenciales, true, nombre); }
    sinLlave(r);
  }
});

Deno.test('nickname: otro juego no se consulta (el proveedor solo valida Free Fire) y sin red tampoco se inventa nada', async () => {
  const { http, llamadas } = falso(respuesta({ ok: true, nombre_usuario: 'x' }));
  assertEquals(await real(http).consultarJugador({ juego: 'mobile-legends', id: '123456789', zona: '2345' }), { ok: false, motivo: 'no_configurado' });
  assertEquals(llamadas.length, 0);

  const sinRed = await real(() => { throw new TypeError('connection reset'); }).consultarJugador({ juego: 'free-fire', id: '2267632897' });
  assertEquals(sinRed.ok, false);
  const lento = await real(colgada as typeof fetch).consultarJugador({ juego: 'free-fire', id: '2267632897' });
  assertEquals(lento.ok, false);
  if (!lento.ok) { assertEquals(lento.motivo, 'no_disponible'); assertStringIncludes(lento.interno ?? '', 'a tiempo'); }
});

// ------------------------------------------------------------------ comprar
const COMPRA_DOC = { ok: true, status: 'completado', message: 'Compra procesada.', delivery_code: 'Proveedor: TXN-4471203', balance_usd: 10.36, order_id: 15659 };

Deno.test('comprar: manda el paquete, el ID y la clave de NUESTRO pedido, y entiende la respuesta documentada', async () => {
  const { http, llamadas } = falso(respuesta(COMPRA_DOC));
  const r = await real(http).crearRecarga(pedido());
  assertEquals(r, { estado: 'entregado', ref: 'Proveedor: TXN-4471203', saldo: 10.36 });
  assertEquals(llamadas[0].cabeceras['x-api-key'], LLAVE);
  assertEquals(llamadas[0].cuerpo, { accion: 'comprar', id_juego: '2267632897', paquete: '341 Diamantes', partner_order_id: `MZ-${PEDIDO}` });
  sinLlave(r);

  const conZona = falso(respuesta({ ok: true, status: 'completado', order_id: 1 }));
  await real(conZona.http).crearRecarga(pedido({ zona: '2001' }));
  assertEquals(conZona.llamadas[0].cuerpo.zone_id, '2001');
});

Deno.test('comprar: cada intento usa su propia clave (un rechazo no se puede repetir con la misma)', async () => {
  const { http, llamadas } = falso(respuesta(COMPRA_DOC));
  const p = real(http);
  await p.crearRecarga(pedido({ intento: 1 }));
  await p.crearRecarga(pedido({ intento: 2 }));
  await p.crearRecarga(pedido({ intento: 3 }));
  assertEquals(llamadas.map((l) => l.cuerpo.partner_order_id), [`MZ-${PEDIDO}`, `MZ-${PEDIDO}-2`, `MZ-${PEDIDO}-3`]);
});

Deno.test('comprar: la referencia sale del código de entrega, o de la orden, o de la clave', async () => {
  assertEquals(await real(falso(respuesta({ ok: true, status: 'completado', order_id: 8842 })).http).crearRecarga(pedido()), { estado: 'entregado', ref: 'ORD-8842' });
  assertEquals(await real(falso(respuesta({ ok: true, status: 'completado' })).http).crearRecarga(pedido()), { estado: 'entregado', ref: `MZ-${PEDIDO}` });
  assertEquals(await real(falso(respuesta({ ok: true, status: 'completado' })).http).crearRecarga(pedido({ intento: 2 })), { estado: 'entregado', ref: `MZ-${PEDIDO}-2` });
});

Deno.test('comprar: "pendiente_proveedor" (en el proveedor o sin confirmar) queda EN PROCESO, nunca como entregado', async () => {
  const casos = [
    { ok: true, status: 'pendiente_proveedor', message: 'Tu recarga ya fue enviada al proveedor y se está aplicando. Suele llegar en unos minutos.', delivery_code: 'Proveedor: ⏳ En proceso — 12345', balance_usd: 11.94, order_id: 15660 },
    { ok: true, status: 'pendiente_proveedor', message: 'No pudimos confirmar la recarga con el proveedor; la estamos revisando.', delivery_code: 'Recarga automática sin confirmar, se revisará manualmente 🔧', balance_usd: 11.94, order_id: 15662 },
  ];
  for (const c of casos) {
    const r = await real(falso(respuesta(c)).http).crearRecarga(pedido());
    assertEquals(r.estado, 'en_proceso');
    if (r.estado === 'en_proceso') {
      assertStringIncludes(r.detalle, `#${c.order_id}`);
      assertStringIncludes(r.interno ?? '', c.delivery_code);
      assertEquals(r.saldo, 11.94);
    }
  }
});

Deno.test('comprar: un estado que no conocemos (o ninguno) NUNCA se da por entregado: queda para revisar', async () => {
  for (const status of ['pendiente_mantenimiento', 'pendiente', 'algo_nuevo', '']) {
    const r = await real(falso(respuesta({ ok: true, status, order_id: 8842, balance_usd: 40 })).http).crearRecarga(pedido());
    assertEquals(r.estado, 'desconocido', status);
    if (r.estado === 'desconocido') {
      assertStringIncludes(r.detalle, '#8842');
      assertStringIncludes(r.interno ?? '', `status=${status || 'vacío'}`);
    }
  }
});

Deno.test('comprar: los rechazos claros son "fallo", el motivo real no llega al cliente y el saldo se aprovecha', async () => {
  const casos: Array<[string, Response, string, number | undefined]> = [
    ['saldo insuficiente', json({ ok: false, status: 'error', message: 'Saldo insuficiente.', delivery_code: null, balance_usd: 0.1, order_id: null, error: 'saldo_insuficiente' }, 402), 'No hay saldo suficiente en el proveedor', 0.1],
    ['paquete que no existe', json({ ok: false, status: 'error', message: 'Ese paquete no está disponible por API.', balance_usd: 12.5, error: 'producto_no_disponible' }, 404), 'nombre exacto de su catálogo', 12.5],
    ['paquete sin precio', json({ ok: false, status: 'error', message: 'Este paquete no tiene precio configurado para tu cuenta.', balance_usd: 12.5, error: 'sin_precio' }, 400), 'no tiene precio', 12.5],
    ['falta la zona', json({ ok: false, status: 'error', message: 'Mobile Legends necesita el zone_id del jugador.', balance_usd: 12.5, error: 'falta_zone_id' }, 400), 'zona del jugador', 12.5],
    ['ID con formato inválido', json({ ok: false, status: 'error', message: 'El id_juego no es válido.', balance_usd: 12.5, error: 'id_invalido' }, 400), 'ID del jugador', 12.5],
    ['rechazada y reembolsada', json({ ok: false, status: 'error', message: 'El proveedor no pudo procesar la recarga (revisa el id_juego y el paquete). Se te devolvió el saldo automáticamente.', delivery_code: null, balance_usd: 12.5, order_id: 15663, error: 'recarga_rechazada' }, 422), 'devolvió el saldo', 12.5],
    ['solicitud incompleta', json(cuerpoDeError('missing_fields', "Faltan campos requeridos: 'id_juego' y 'paquete'."), 400), 'salió incompleta', undefined],
    ['método', json(cuerpoDeError('method_not_allowed', 'Usa POST.'), 405), 'mal armada', undefined],
  ];
  for (const [nombre, resp, enInterno, saldo] of casos) {
    const r = await real(falso(() => resp.clone()).http).crearRecarga(pedido());
    assertEquals(r.estado, 'fallo', nombre);
    if (r.estado === 'fallo') {
      assertStringIncludes(r.interno ?? '', enInterno, nombre);
      assertEquals(r.saldo, saldo, nombre);
      assertEquals(r.credenciales, undefined, `${nombre}: solo la llave rechazada apaga la conexión`);
      assert(!/saldo|api key|existe|precio|zona/i.test(r.detalle), `${nombre}: el detalle público no debe revelar el motivo (${r.detalle})`);
    }
    sinLlave(r);
  }
});

Deno.test('comprar: el rechazo reembolsado deja el texto del proveedor en el registro del admin', async () => {
  const r = await real(falso(respuesta({ ok: false, status: 'error', message: 'El proveedor rechazó la recarga (failed): cuenta inexistente. Se te devolvió el saldo automáticamente.', error: 'recarga_rechazada', balance_usd: 12.5, order_id: 15663 }, 422)).http).crearRecarga(pedido());
  assertEquals(r.estado, 'fallo');
  if (r.estado === 'fallo') assertStringIncludes(r.interno ?? '', 'cuenta inexistente');
});

Deno.test('comprar: si la llave no sirve (falta, inválida, pausada o vencida) es "fallo" con credenciales y dice qué hacer', async () => {
  for (const [nombre, estado, codigo] of ERRORES_DE_LLAVE) {
    const r = await real(falso(respuesta({ ok: false, status: 'error', message: 'texto', delivery_code: null, balance_usd: null, order_id: null, error: codigo }, estado)).http).crearRecarga(pedido());
    assertEquals(r.estado, 'fallo', nombre);
    if (r.estado === 'fallo') {
      assertEquals(r.credenciales, true, nombre);
      assertEquals(r.saldo, undefined, nombre);
      assertEquals(r.detalle, 'El proveedor rechazó la solicitud', nombre);
      assert((r.interno ?? '').length > 20, nombre);
    }
    sinLlave(r);
  }
});

Deno.test('comprar: ante la duda (5xx, no es JSON, sin red, sin respuesta, error que no conocemos) es "desconocido", nunca "fallo"', async () => {
  const casos: Array<[string, () => Response | Promise<Response>]> = [
    ['error 500 documentado', respuesta(cuerpoDeError('internal_error', 'No se pudo procesar la compra.'), 500)],
    ['bad gateway en HTML', () => new Response('<html>502</html>', { status: 502 })],
    ['200 que no es JSON', () => new Response('ok', { status: 200 })],
    ['error que no está en la documentación', respuesta(cuerpoDeError('algo_nuevo'), 409)],
    ['429 sin explicación', respuesta({ ok: false }, 429)],
    ['se cae la red', () => { throw new TypeError('connection reset'); }],
  ];
  for (const [nombre, manejador] of casos) {
    const r = await real(falso(manejador).http).crearRecarga(pedido());
    assertEquals(r.estado, 'desconocido', nombre);
    sinLlave(r);
  }
  const lento = await real(colgada as typeof fetch).crearRecarga(pedido());
  assertEquals(lento.estado, 'desconocido');
  if (lento.estado === 'desconocido') assertStringIncludes(lento.interno ?? '', 'a tiempo');
});

Deno.test('comprar: nunca reintenta por su cuenta (una sola llamada por intento)', async () => {
  const { http, llamadas } = falso(respuesta(cuerpoDeError('internal_error'), 500));
  await real(http).crearRecarga(pedido());
  assertEquals(llamadas.length, 1);
});

// ------------------------------------------------------------------ pedido (en qué quedó una orden)
Deno.test('pedido: pregunta por la clave de nuestro pedido y entiende "completado"', async () => {
  const { http, llamadas } = falso(respuesta({ ok: true, order_id: 15659, status: 'completado', message: 'Recarga entregada.', delivery_code: 'Proveedor: TXN-4471203', paquete: '341 Diamantes', id_juego: '2267632897', precio_usd: 2.14, creado_en: '2026-10-31T19:03:20.615682+00:00', balance_usd: 12.5 }));
  const r = await real(http).consultarPedido({ juego: 'free-fire', id: '2267632897', referencia: PEDIDO });
  assertEquals(r, { estado: 'entregado', ref: 'Proveedor: TXN-4471203' });
  assertEquals(llamadas[0].cuerpo, { accion: 'pedido', partner_order_id: `MZ-${PEDIDO}` });
  assertEquals(llamadas[0].cabeceras['x-api-key'], LLAVE);
  await real(http).consultarPedido({ juego: 'free-fire', id: '2267632897', referencia: PEDIDO, intento: 3 });
  assertEquals(llamadas[1].cuerpo.partner_order_id, `MZ-${PEDIDO}-3`);
});

Deno.test('pedido: "pendiente_proveedor" sigue en proceso; "rechazado" devolvió el saldo', async () => {
  const consulta = { juego: 'free-fire', id: '2267632897', referencia: PEDIDO };
  for (const message of ['Ya está en el proveedor y se está aplicando.', 'Pedido registrado, en revisión.']) {
    const r = await real(falso(respuesta({ ok: true, order_id: 15660, status: 'pendiente_proveedor', message, delivery_code: 'x' })).http).consultarPedido(consulta);
    assertEquals(r, { estado: 'en_proceso', interno: message });
  }
  const rechazado = await real(falso(respuesta({ ok: true, order_id: 15661, status: 'rechazado', message: 'El proveedor rechazó la recarga y tu saldo fue devuelto.', delivery_code: 'Reembolsado: El proveedor rechazó la recarga (failed): sin detalle' })).http).consultarPedido(consulta);
  assertEquals(rechazado.estado, 'rechazado');
  if (rechazado.estado === 'rechazado') assertStringIncludes(rechazado.interno ?? '', 'Reembolsado');
});

Deno.test('pedido: sin registro (404) es "no_existe"; la llave rechazada y cualquier duda son "desconocido"', async () => {
  const consulta = { juego: 'free-fire', id: '2267632897', referencia: PEDIDO };
  assertEquals(await real(falso(respuesta(cuerpoDeError('pedido_no_encontrado', 'No encontramos ese pedido en tu cuenta.'), 404)).http).consultarPedido(consulta), { estado: 'no_existe' });

  const llave = await real(falso(respuesta(cuerpoDeError('key_invalida'), 401)).http).consultarPedido(consulta);
  assertEquals(llave.estado, 'desconocido');
  if (llave.estado === 'desconocido') assertEquals(llave.credenciales, true);

  const dudas: Array<[string, () => Response | Promise<Response>]> = [
    ['error 500', respuesta(cuerpoDeError('internal_error'), 500)],
    ['no es JSON', () => new Response('<html>502</html>', { status: 502 })],
    ['un 404 distinto', respuesta(cuerpoDeError('otra_cosa'), 404)],
    ['estado desconocido', respuesta({ ok: true, status: 'algo_nuevo' })],
    ['se cae la red', () => { throw new TypeError('connection reset'); }],
  ];
  for (const [nombre, manejador] of dudas) {
    const r = await real(falso(manejador).http).consultarPedido(consulta);
    assertEquals(r.estado, 'desconocido', nombre);
    if (r.estado === 'desconocido') assertEquals(r.credenciales, undefined, nombre);
    sinLlave(r);
  }
  assertEquals((await real(colgada as typeof fetch).consultarPedido(consulta)).estado, 'desconocido');
});

// ------------------------------------------------------------------ simulado
Deno.test('simulado: saldo, catálogo y consulta de jugadores según el final del ID', async () => {
  const p = crearProveedor(env({ PROVEEDOR_MODO: 'simulado' }));
  assertEquals(p.listo(), true);
  assertEquals(p.nicknameDisponible(), true);
  assertEquals(p.nicknameDisponible('lo-que-sea'), true);
  assertEquals((await p.consultarSaldo()).saldo, 1000);
  const catalogo = await p.catalogo();
  assertEquals(catalogo.ok, true);
  assert(catalogo.paquetes.length > 0 && catalogo.paquetes.every((x) => x.codigo.length > 0 && x.precio > 0));

  assertEquals(await p.consultarJugador({ juego: 'free-fire', id: '123456000' }), { ok: false, motivo: 'no_encontrado' });
  const caido = await p.consultarJugador({ juego: 'free-fire', id: '123456111' });
  assertEquals(caido.ok === false && caido.motivo, 'no_disponible');
  const hallado = await p.consultarJugador({ juego: 'free-fire', id: '123456789' });
  assertEquals(hallado.ok && hallado.nickname, 'Jugador6789');
});

Deno.test('simulado: la recarga se entrega, se rechaza, queda sin respuesta o queda en proceso según el final del ID', async () => {
  const p = crearProveedor(env({ PROVEEDOR_MODO: 'simulado' }));
  const del = (id: string) => ({ juego: 'free-fire', id, codigo: 'SIM-100', referencia: PEDIDO });
  assertEquals(await p.crearRecarga(del('123456789')), { estado: 'entregado', ref: 'SIM-11111111' });
  assertEquals((await p.crearRecarga(del('123456999'))).estado, 'fallo');
  assertEquals((await p.crearRecarga(del('123456888'))).estado, 'desconocido');
  for (const fin of ['777', '666', '555']) assertEquals((await p.crearRecarga(del(`123456${fin}`))).estado, 'en_proceso', fin);
});

Deno.test('simulado: la consulta de una orden en proceso termina bien, mal o nunca, según el final del ID', async () => {
  const p = crearProveedor(env({ PROVEEDOR_MODO: 'simulado' }));
  const consultar = (fin: string, desdeMs: number) => p.consultarPedido({ juego: 'free-fire', id: `123456${fin}`, referencia: PEDIDO, desdeMs });
  assertEquals((await consultar('777', 1000)).estado, 'en_proceso');
  assertEquals(await consultar('777', 25000), { estado: 'entregado', ref: 'SIM-11111111' });
  assertEquals((await consultar('666', 1000)).estado, 'en_proceso');
  assertEquals((await consultar('666', 25000)).estado, 'rechazado');
  assertEquals((await consultar('555', 999999)).estado, 'en_proceso');
  assertEquals((await consultar('888', 999999)).estado, 'no_existe');
  assertEquals((await consultar('789', 0)).estado, 'entregado');
});

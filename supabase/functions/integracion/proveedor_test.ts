// Pruebas del adaptador (modos, configuración y modo simulado) sin red.
// Se corren con:  deno test supabase/functions/integracion/
// Este archivo NO se despliega: es solo para comprobar la lógica.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { ADAPTADOR_REAL_IMPLEMENTADO, crearProveedor, NICKNAME_REAL_IMPLEMENTADO } from './proveedor.ts';

const env = (valores: Record<string, string>) => (k: string) => valores[k];
const REAL = { PROVEEDOR_MODO: 'real', PROVEEDOR_URL: 'https://proveedor.test/api', PROVEEDOR_API_KEY: 'LLAVE-SECRETA-123' };

Deno.test('modo: sin secret o con un valor raro queda apagado; se acepta mayúsculas y espacios', () => {
  assertEquals(crearProveedor(env({})).modo(), 'apagado');
  assertEquals(crearProveedor(env({ PROVEEDOR_MODO: 'cualquier-cosa' })).modo(), 'apagado');
  assertEquals(crearProveedor(env({ PROVEEDOR_MODO: ' Simulado ' })).modo(), 'simulado');
  assertEquals(crearProveedor(env({ PROVEEDOR_MODO: ' REAL ' })).modo(), 'real');
});

Deno.test('real: la URL debe empezar con https:// y debe haber llave', () => {
  assertEquals(crearProveedor(env(REAL)).diagnostico().tiene_url, true);
  assertEquals(crearProveedor(env({ ...REAL, PROVEEDOR_URL: 'http://proveedor.test/api' })).diagnostico().tiene_url, false);
  assertEquals(crearProveedor(env({ ...REAL, PROVEEDOR_URL: '' })).diagnostico().tiene_url, false);
  assertEquals(crearProveedor(env({ ...REAL, PROVEEDOR_API_KEY: '  ' })).diagnostico().tiene_llave, false);
  // sin URL o sin llave nunca está listo, aunque el adaptador esté completo
  assertEquals(crearProveedor(env({ ...REAL, PROVEEDOR_URL: 'http://x' })).listo(), false);
  assertEquals(crearProveedor(env({ ...REAL, PROVEEDOR_API_KEY: '' })).listo(), false);
});

Deno.test({
  name: 'real: mientras el adaptador no esté completo, nunca está listo ni sale a la red',
  ignore: ADAPTADOR_REAL_IMPLEMENTADO,
  fn: async () => {
    let llamadas = 0;
    const http = () => { llamadas++; return Promise.resolve(new Response('{}')); };
    const p = crearProveedor(env(REAL), http);
    assertEquals(p.listo(), false);
    assertEquals(p.nicknameDisponible(), false);
    assertEquals(p.diagnostico().adaptador_implementado, false);
    assertEquals((await p.crearRecarga({ juego: 'free-fire', id: '123456789', codigo: 'X', referencia: 'r' })).estado, 'fallo');
    assertEquals((await p.consultarSaldo()).ok, false);
    assertEquals((await p.catalogo()).ok, false);
    assertEquals(await p.consultarJugador({ juego: 'free-fire', id: '123456789' }), { ok: false, motivo: 'no_configurado' });
    assertEquals(llamadas, 0);
  },
});

Deno.test({
  name: 'real: sin consulta de nickname completa, el nickname no está disponible',
  ignore: NICKNAME_REAL_IMPLEMENTADO,
  fn: () => assertEquals(crearProveedor(env(REAL)).nicknameDisponible(), false),
});

Deno.test('apagado: no está listo y no sale a la red', async () => {
  let llamadas = 0;
  const http = () => { llamadas++; return Promise.resolve(new Response('{}')); };
  const p = crearProveedor(env({}), http);
  assertEquals(p.listo(), false);
  assertEquals((await p.consultarSaldo()).ok, false);
  assertEquals(llamadas, 0);
});

Deno.test('simulado: saldo, catálogo y consulta de jugadores según el final del ID', async () => {
  const p = crearProveedor(env({ PROVEEDOR_MODO: 'simulado' }));
  assertEquals(p.listo(), true);
  assertEquals(p.nicknameDisponible(), true);
  assertEquals((await p.consultarSaldo()).saldo, 1000);
  const catalogo = await p.catalogo();
  assertEquals(catalogo.ok, true);
  assert(catalogo.paquetes.length > 0 && catalogo.paquetes.every((x) => x.codigo.length > 0 && x.precio > 0));

  assertEquals(await p.consultarJugador({ juego: 'free-fire', id: '123456000' }), { ok: false, motivo: 'no_encontrado' });
  assertEquals(await p.consultarJugador({ juego: 'free-fire', id: '123456111' }), { ok: false, motivo: 'no_disponible' });
  const hallado = await p.consultarJugador({ juego: 'free-fire', id: '123456789' });
  assertEquals(hallado.ok && hallado.nickname, 'Jugador6789');
});

Deno.test('simulado: la recarga se entrega, se rechaza o queda sin respuesta según el final del ID', async () => {
  const p = crearProveedor(env({ PROVEEDOR_MODO: 'simulado' }));
  const pedido = (id: string) => ({ juego: 'free-fire', id, codigo: 'SIM-100', referencia: '11111111-1111-4111-8111-111111111111' });
  assertEquals(await p.crearRecarga(pedido('123456789')), { estado: 'entregado', ref: 'SIM-11111111' });
  assertEquals((await p.crearRecarga(pedido('123456999'))).estado, 'fallo');
  assertEquals((await p.crearRecarga(pedido('123456888'))).estado, 'desconocido');
});

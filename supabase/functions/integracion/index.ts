// ============================================================================
// Función "integracion": el único punto por el que la web habla con el
// proveedor de recargas. La web manda { accion, ...datos } con la sesión del
// usuario; aquí se comprueba quién es y se aplican las reglas de logica.ts.
//
//   accion: 'validar_jugador'  { juego, id_jugador, zona? }  → nickname del jugador
//   accion: 'entregar_pedido'  { pedido_id, forzar? }        → entrega automática de un pedido pagado
//   accion: 'probar'           { solo_config? }              → solo admin: prueba la conexión
//   accion: 'catalogo'         {}                            → solo admin: productos del proveedor y su precio
//
// Secrets (Supabase → Edge Functions → Secrets):
//   PROVEEDOR_MODO      apagado | simulado | real      (sin él, queda apagado)
//   PROVEEDOR_URL       https://... (solo modo real)
//   PROVEEDOR_API_KEY   la llave de la API (solo modo real)
// ============================================================================
import { clienteServicio, cabecerasCors, repoSupabase, responder, usuarioDeLaPeticion } from './comun.ts';
import { catalogoProveedor, entregarPedido, probarIntegracion, validarJugador } from './logica.ts';
import { crearProveedor } from './proveedor.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cabecerasCors(req) });
  if (req.method !== 'POST') return responder(req, { ok: false, motivo: 'metodo' }, 405);

  try {
    const admin = clienteServicio();
    if (!admin) {
      console.error('Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en la función');
      return responder(req, { ok: false, motivo: 'no_configurado' }, 500);
    }

    const usuario = await usuarioDeLaPeticion(req, admin);
    if (!usuario) return responder(req, { ok: false, motivo: 'no_autorizado' }, 401);

    const texto = await req.text();
    if (texto.length > 4000) return responder(req, { ok: false, motivo: 'solicitud_grande' }, 413);
    let cuerpo: Record<string, unknown> | null = null;
    try { cuerpo = JSON.parse(texto); } catch { /* cuerpo inválido */ }
    if (!cuerpo || typeof cuerpo !== 'object') return responder(req, { ok: false, motivo: 'solicitud_invalida' }, 400);

    const deps = { repo: repoSupabase(admin), proveedor: crearProveedor() };

    switch (cuerpo.accion) {
      case 'validar_jugador':
        return responder(req, await validarJugador(deps, usuario.id, cuerpo));
      case 'entregar_pedido':
        return responder(req, await entregarPedido(deps, usuario.id, cuerpo));
      case 'probar':
        return responder(req, await probarIntegracion(deps, usuario.id, cuerpo));
      case 'catalogo':
        return responder(req, await catalogoProveedor(deps, usuario.id));
      default:
        return responder(req, { ok: false, motivo: 'accion_invalida' }, 400);
    }
  } catch (e) {
    // El detalle va al registro de la función; al navegador solo un aviso genérico.
    console.error('Error en la función integracion:', e instanceof Error ? e.message : String(e));
    return responder(req, { ok: false, motivo: 'error' }, 500);
  }
});

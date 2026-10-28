// ============================================================================
// Piezas comunes de la función: CORS, respuesta JSON, usuario que llama y el
// "Repo" que habla con la base de datos usando la llave de servicio.
// La llave de servicio solo existe en el servidor: nunca llega al navegador.
// ============================================================================
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { EstadoGuardado, InfoPedido, Juego, Reclamo, Repo } from './logica.ts';

// Páginas desde las que se puede llamar a esta función.
const ORIGENES_PERMITIDOS = [
  'https://mzrecargas.com',
  'https://www.mzrecargas.com',
  'https://carlosgabriel04190419-dot.github.io',
  'http://localhost:8843',
  'http://127.0.0.1:8843',
];

// Máximo de consultas de nickname por usuario y por hora.
const MAX_CONSULTAS_POR_HORA = 20;

export function cabecerasCors(req: Request): Record<string, string> {
  const origen = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ORIGENES_PERMITIDOS.includes(origen) ? origen : ORIGENES_PERMITIDOS[0],
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

export function responder(req: Request, cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...cabecerasCors(req), 'Content-Type': 'application/json' },
  });
}

export function clienteServicio(): SupabaseClient | null {
  const url = Deno.env.get('SUPABASE_URL');
  const llave = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !llave) return null;
  return createClient(url, llave, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Quién está llamando: se valida el token de sesión contra Supabase Auth. */
export async function usuarioDeLaPeticion(req: Request, admin: SupabaseClient): Promise<{ id: string } | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id };
}

/** Lo que ve el rol de servicio son solo tablas nuevas y funciones puntuales (ver el SQL). */
export function repoSupabase(admin: SupabaseClient): Repo {
  return {
    async obtenerJuego(slug: string): Promise<Juego | null> {
      const { data, error } = await admin.from('juegos').select('slug, activo, validar_auto, entrega_auto, patron_id, usa_zona').eq('slug', slug).maybeSingle();
      if (error) throw error;
      return data;
    },

    async obtenerCache(juego, id, zona) {
      const { data, error } = await admin.from('jugadores_cache').select('nickname, consultado_at')
        .eq('juego', juego).eq('id_jugador', id).eq('zona', zona).maybeSingle();
      if (error) throw error;
      return data;
    },

    async guardarCache(juego, id, zona, nickname, extra) {
      const { error } = await admin.from('jugadores_cache').upsert(
        { juego, id_jugador: id, zona, nickname, extra, consultado_at: new Date().toISOString() },
        { onConflict: 'juego,id_jugador,zona' },
      );
      if (error) throw error;
    },

    async permitirConsulta(usuarioId, juego) {
      const { data, error } = await admin.rpc('integracion_permitir_consulta', {
        p_usuario: usuarioId, p_juego: juego, p_max: MAX_CONSULTAS_POR_HORA, p_minutos: 60,
      });
      if (error) throw error;
      return data === true;
    },

    async log(tipo, juego, pedidoId, usuarioId, ok, detalle) {
      // Un fallo al escribir el registro nunca debe romper la operación principal.
      const { error } = await admin.rpc('integracion_log', {
        p_tipo: tipo, p_juego: juego, p_pedido: pedidoId, p_usuario: usuarioId, p_ok: ok, p_detalle: detalle,
      });
      if (error) console.error('No se pudo guardar el registro:', error.message);
    },

    async esAdmin(usuarioId) {
      const { data, error } = await admin.rpc('integracion_es_admin', { p_usuario: usuarioId });
      if (error) throw error;
      return data === true;
    },

    async infoPedido(id): Promise<InfoPedido | null> {
      const { data, error } = await admin.rpc('entrega_pedido_info', { p_pedido: id });
      if (error) throw error;
      return Array.isArray(data) && data.length ? data[0] : null;
    },

    async reclamarEntrega(id, forzar): Promise<Reclamo | null> {
      const { data, error } = await admin.rpc('entrega_reclamar', { p_pedido: id, p_forzar: forzar });
      if (error) throw error;
      return Array.isArray(data) && data.length ? data[0] : null;
    },

    async pasarAManual(id, detalle) {
      const { error } = await admin.rpc('entrega_pasar_a_manual', { p_pedido: id, p_detalle: detalle });
      if (error) throw error;
    },

    async cerrarEntrega(id, resultado, ref, detalle, simulado) {
      const { error } = await admin.rpc('entrega_cerrar', {
        p_pedido: id, p_resultado: resultado, p_ref: ref, p_detalle: detalle, p_simulado: simulado,
      });
      if (error) throw error;
    },

    async guardarEstado(e: EstadoGuardado) {
      const { error } = await admin.rpc('integracion_guardar_estado', {
        p_modo: e.modo, p_listo: e.listo, p_saldo: e.saldo, p_moneda: e.moneda, p_mensaje: e.mensaje,
      });
      if (error) throw error;
    },
  };
}

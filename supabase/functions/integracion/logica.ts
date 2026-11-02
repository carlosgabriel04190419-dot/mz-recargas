// ============================================================================
// REGLAS DE LA INTEGRACIÓN (sin Supabase ni HTTP: se prueban con datos falsos)
//   · validarJugador  → nickname a partir del ID
//   · entregarPedido  → entrega automática de un pedido ya pagado
//   · revisarPedido   → en qué quedó una entrega que no terminó (en proceso, sin confirmar...)
//   · probarIntegracion → comprueba la conexión (solo admin)
// Todo lo que toca la base de datos entra por "Repo" y todo lo que toca al
// proveedor por "Proveedor", así se pueden probar sin red.
// ============================================================================
import type { PaqueteProveedor, Proveedor, ResultadoPedido, ResultadoRecarga } from './proveedor.ts';

export interface Juego {
  slug: string;
  activo: boolean;
  validar_auto: boolean;
  entrega_auto: boolean;
  patron_id: string;
  usa_zona: boolean;
}
export interface InfoPedido {
  id: string;
  usuario_id: string;
  tipo: string;
  estado: string;
  entrega: string;
  entrega_at: string | null;
  id_jugador: string | null;
  paquete_id: number | null;
  juego: string;
  intentos: number;
}
export interface Reclamo {
  pedido_id: string;
  id_jugador: string;
  juego: string;
  codigo: string;
  nombre_paquete: string;
  cantidad: number;
  intentos: number;
}
export interface EstadoGuardado {
  modo: string;
  listo: boolean;
  saldo: number | null;
  moneda: string | null;
  mensaje: string;
  vence_at?: string | null;
  consultas_limite?: number | null;
  consultas_usadas?: number | null;
}

export type Cierre = 'entregado' | 'fallo' | 'revisar' | 'confirmando';

export interface Repo {
  obtenerJuego(slug: string): Promise<Juego | null>;
  obtenerCache(juego: string, id: string, zona: string): Promise<{ nickname: string; consultado_at: string } | null>;
  guardarCache(juego: string, id: string, zona: string, nickname: string, extra: unknown): Promise<void>;
  permitirConsulta(usuarioId: string, juego: string): Promise<boolean>;
  log(tipo: 'validar' | 'entregar' | 'probar', juego: string | null, pedidoId: string | null, usuarioId: string | null, ok: boolean, detalle: string): Promise<void>;
  esAdmin(usuarioId: string): Promise<boolean>;
  infoPedido(id: string): Promise<InfoPedido | null>;
  reclamarEntrega(id: string, forzar: boolean): Promise<Reclamo | null>;
  pasarAManual(id: string, detalle: string): Promise<void>;
  cerrarEntrega(id: string, resultado: Cierre, ref: string | null, detalle: string | null, simulado: boolean): Promise<void>;
  guardarEstado(e: EstadoGuardado): Promise<void>;
  /** ¿La última prueba de conexión salió bien (y no se apagó después)? */
  conexionLista(): Promise<boolean>;
  /** Pone al día el saldo y/o el cupo de consultas de ID con lo que dijo el proveedor en su última respuesta. */
  actualizarUso(saldo: number | null, consultasRestantes: number | null): Promise<void>;
}

export interface Deps {
  repo: Repo;
  proveedor: Proveedor;
  ahora?: () => number;
  esperar?: (ms: number) => Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL_CACHE_MS = 24 * 60 * 60 * 1000;
// El proveedor tarda como máximo ~75 s en responder una compra. Pasado este margen, una orden que no aparece en su
// sistema nunca llegó, y una entrega "en proceso" en nuestro lado se quedó a medias.
const PLAZO_SEGURO_MS = 3 * 60 * 1000;
// Cuánto se espera (y cuántas veces se pregunta) cuando el proveedor dice que "la está aplicando", antes de dejarla para después.
const PAUSA_SEGUIMIENTO_MS = 3000;
const CONSULTAS_DE_SEGUIMIENTO = 3;

/** Quita caracteres de control y limita el largo: lo que devuelve el proveedor nunca se confía a ciegas. */
export function limpiarNickname(v: unknown): string {
  // deno-lint-ignore no-control-regex
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
}

function ocultarId(id: string): string {
  return id.length <= 4 ? '****' : '****' + id.slice(-4);
}

function patronCumple(patron: string, valor: string): boolean {
  try { return new RegExp(patron).test(valor); } catch { return false; }
}

function mensajeError(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200);
}

const pausa = (d: Deps) => d.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

/** Guardar el saldo o el cupo es solo informativo: si falla, no debe romper la operación principal. */
async function guardarUso(d: Deps, saldo: number | null, restantes: number | null): Promise<void> {
  try {
    await d.repo.actualizarUso(saldo, restantes);
  } catch (e) {
    console.error('No se pudo guardar el saldo o el cupo de consultas:', mensajeError(e));
  }
}

/** Si la llave ya no sirve (venció, la pausaron o la cambiaron) se deja de intentar: la conexión queda "no lista". */
async function apagarConexion(d: Deps, usuarioId: string, tipo: 'validar' | 'entregar', juego: string | null, pedidoId: string | null, motivo?: string): Promise<void> {
  const mensaje = `${motivo ?? 'El proveedor rechazó la llave'}. Hasta que lo resuelvas y pulses Probar conexión, las compras nuevas se entregan a mano y el nickname no se muestra.`;
  try {
    await d.repo.guardarEstado({ modo: d.proveedor.modo(), listo: false, saldo: null, moneda: null, mensaje });
    await d.repo.log(tipo, juego, pedidoId, usuarioId, false, mensaje);
  } catch (e) {
    await d.repo.log(tipo, juego, pedidoId, usuarioId, false, `No se pudo apagar la conexión: ${mensajeError(e)}`);
  }
}

// ---------------------------------------------------------------------------
// 1) Nickname a partir del ID
// ---------------------------------------------------------------------------
export type RespuestaValidar =
  | { ok: true; nickname: string; cache: boolean }
  | { ok: false; motivo: 'no_configurado' | 'juego_invalido' | 'id_invalido' | 'no_encontrado' | 'no_disponible' | 'limite' };

export async function validarJugador(d: Deps, usuarioId: string, entrada: Record<string, unknown> | null): Promise<RespuestaValidar> {
  const slug = String(entrada?.juego ?? '').trim();
  const id = String(entrada?.id_jugador ?? '').trim();
  const zona = String(entrada?.zona ?? '').trim();
  const ahora = d.ahora ?? Date.now;

  // Sin conexión lista, o si el proveedor no ofrece nickname para este juego, la web acepta el ID como siempre
  // (y no se gasta ninguno de los intentos por hora del usuario ni de las consultas de la API).
  if (d.proveedor.modo() === 'apagado' || !d.proveedor.listo() || !d.proveedor.nicknameDisponible(slug)) return { ok: false, motivo: 'no_configurado' };

  const juego = slug ? await d.repo.obtenerJuego(slug) : null;
  if (!juego || !juego.activo) return { ok: false, motivo: 'juego_invalido' };
  if (!juego.validar_auto) return { ok: false, motivo: 'no_configurado' };

  if (!id || id.length > 30 || !patronCumple(juego.patron_id, id)) return { ok: false, motivo: 'id_invalido' };
  if (juego.usa_zona ? !/^[0-9A-Za-z-]{1,12}$/.test(zona) : zona !== '') return { ok: false, motivo: 'id_invalido' };

  const guardado = await d.repo.obtenerCache(slug, id, zona);
  if (guardado && ahora() - new Date(guardado.consultado_at).getTime() < TTL_CACHE_MS) {
    return { ok: true, nickname: guardado.nickname, cache: true };
  }

  // Si la última prueba falló o la llave se apagó, no se vuelve a llamar al proveedor hasta que el admin la pruebe de nuevo.
  const lista = await d.repo.conexionLista().catch(() => false);
  if (!lista) return { ok: false, motivo: 'no_configurado' };

  if (!(await d.repo.permitirConsulta(usuarioId, slug))) return { ok: false, motivo: 'limite' };

  let r;
  try {
    r = await d.proveedor.consultarJugador({ juego: slug, id, zona: zona || undefined });
  } catch (e) {
    await d.repo.log('validar', slug, null, usuarioId, false, `${ocultarId(id)} → error: ${mensajeError(e)}`);
    return { ok: false, motivo: 'no_disponible' };
  }
  if (r.restantes !== undefined) await guardarUso(d, null, r.restantes);

  if (r.ok) {
    const nickname = limpiarNickname(r.nickname);
    if (!nickname) {
      await d.repo.log('validar', slug, null, usuarioId, false, `${ocultarId(id)} → el proveedor respondió sin nickname`);
      return { ok: false, motivo: 'no_disponible' };
    }
    await d.repo.guardarCache(slug, id, zona, nickname, r.extra ?? null);
    await d.repo.log('validar', slug, null, usuarioId, true, `${ocultarId(id)} → encontrado`);
    return { ok: true, nickname, cache: false };
  }

  // "no_encontrado" es un resultado normal (el cliente escribió mal el ID); lo demás es un problema del proveedor.
  await d.repo.log('validar', slug, null, usuarioId, r.motivo === 'no_encontrado', `${ocultarId(id)} → ${r.interno ? `${r.motivo}: ${r.interno}` : r.motivo}`);
  if (r.credenciales) await apagarConexion(d, usuarioId, 'validar', slug, null, r.interno);
  if (r.motivo === 'no_encontrado') return { ok: false, motivo: 'no_encontrado' };
  return { ok: false, motivo: r.motivo === 'no_configurado' ? 'no_configurado' : 'no_disponible' };
}

// ---------------------------------------------------------------------------
// 2) Entrega automática de un pedido
// ---------------------------------------------------------------------------
export type RespuestaEntrega =
  | { ok: boolean; entrega: string; mensaje?: string }
  | { ok: false; motivo: 'pedido_invalido' | 'no_encontrado' | 'sin_permiso' | 'no_configurado' | 'automatizacion_apagada' | 'proveedor_no_responde'; entrega?: string };

interface CierreDeEntrega { resultado: Cierre; ref: string | null; detalle: string | null }

const ESTADO_DE_ENTREGA: Record<Cierre, string> = {
  entregado: 'auto_entregado',
  fallo: 'auto_fallo',
  revisar: 'auto_revisar',
  confirmando: 'auto_confirmando',
};

function cierreDe(r: ResultadoRecarga): CierreDeEntrega {
  switch (r.estado) {
    case 'entregado': return { resultado: 'entregado', ref: r.ref, detalle: null };
    case 'fallo': return { resultado: 'fallo', ref: null, detalle: r.detalle };
    case 'en_proceso': return { resultado: 'confirmando', ref: null, detalle: r.detalle };
    default: return { resultado: 'revisar', ref: null, detalle: r.detalle };
  }
}

/** Cerrar bien la entrega es crítico: si falla, se reintenta antes de rendirse. */
async function cerrarConReintentos(d: Deps, pedidoId: string, cierre: CierreDeEntrega, simulado: boolean): Promise<{ cerrado: boolean; ultimoError: string }> {
  let ultimoError = '';
  for (let intento = 1; intento <= 3; intento++) {
    try {
      await d.repo.cerrarEntrega(pedidoId, cierre.resultado, cierre.ref, cierre.detalle, simulado);
      return { cerrado: true, ultimoError: '' };
    } catch (e) {
      ultimoError = mensajeError(e);
      if (intento < 3) await pausa(d)(400 * intento);
    }
  }
  return { cerrado: false, ultimoError };
}

/** El proveedor dice que la está aplicando: se pregunta unas veces por si termina enseguida, y si no, se deja para después. */
async function seguirOrden(d: Deps, reclamo: Reclamo, inicial: ResultadoRecarga): Promise<ResultadoRecarga> {
  for (let i = 1; i <= CONSULTAS_DE_SEGUIMIENTO; i++) {
    await pausa(d)(PAUSA_SEGUIMIENTO_MS);
    let p: ResultadoPedido;
    try {
      p = await d.proveedor.consultarPedido({ juego: reclamo.juego, id: reclamo.id_jugador, referencia: reclamo.pedido_id, intento: reclamo.intentos, desdeMs: i * PAUSA_SEGUIMIENTO_MS });
    } catch {
      return inicial;
    }
    if (p.estado === 'entregado') return { estado: 'entregado', ref: p.ref };
    if (p.estado === 'rechazado') return { estado: 'fallo', detalle: 'El proveedor no pudo procesar el paquete', interno: `Rechazada por el proveedor, que devolvió el saldo${p.interno ? ` (${p.interno})` : ''}` };
    if (p.estado !== 'en_proceso') return inicial; // si ahora dice otra cosa, se queda como "en proceso" y se vuelve a preguntar después
  }
  return inicial;
}

export async function entregarPedido(d: Deps, usuarioId: string, entrada: Record<string, unknown> | null): Promise<RespuestaEntrega> {
  const pedidoId = String(entrada?.pedido_id ?? '').trim();
  if (!UUID.test(pedidoId)) return { ok: false, motivo: 'pedido_invalido' };

  const info = await d.repo.infoPedido(pedidoId);
  if (!info) return { ok: false, motivo: 'no_encontrado' };

  const esAdmin = await d.repo.esAdmin(usuarioId);
  if (info.usuario_id !== usuarioId && !esAdmin) return { ok: false, motivo: 'sin_permiso' };
  const forzar = esAdmin && entrada?.forzar === true;

  // Si no hay nada que entregar (o ya se procesó), solo se informa cómo está.
  if (info.tipo !== 'compra_diamantes' || info.estado !== 'confirmado') return { ok: true, entrega: info.entrega, mensaje: 'No hay nada que entregar' };
  // Un reintento solo se permite tras un fallo claro. Si quedó en proceso o sin confirmar, primero se consulta
  // su estado (revisarPedido): repetirla a ciegas podría entregarla dos veces.
  const reintentable = info.entrega === 'auto_pendiente' || (forzar && info.entrega === 'auto_fallo');
  if (!reintentable) return { ok: true, entrega: info.entrega };

  // Mejor no gastar un intento si la conexión no está lista o el juego tiene la entrega automática apagada.
  // Un pedido nuevo que quedó esperando la entrega automática vuelve al flujo manual de siempre.
  if (!d.proveedor.listo() || !(await d.repo.conexionLista().catch(() => false))) return await volverAManual(d, usuarioId, info, 'no_configurado');
  const juego = await d.repo.obtenerJuego(info.juego);
  if (!juego || !juego.activo || (!juego.entrega_auto && !forzar)) return await volverAManual(d, usuarioId, info, 'automatizacion_apagada');

  // Aquí se decide quién entrega: solo UNA llamada logra "reclamar" el pedido.
  const reclamo = await d.repo.reclamarEntrega(pedidoId, forzar);
  if (!reclamo) {
    const ahoraInfo = await d.repo.infoPedido(pedidoId);
    return { ok: true, entrega: ahoraInfo?.entrega ?? info.entrega, mensaje: 'Otra llamada ya lo está procesando' };
  }

  const simulado = d.proveedor.modo() === 'simulado';
  let resultado: ResultadoRecarga;
  try {
    // Cada intento lleva su propia clave en el proveedor (reclamo.intentos), así un reintento tras un rechazo no choca con el anterior.
    resultado = await d.proveedor.crearRecarga({ juego: reclamo.juego, id: reclamo.id_jugador, codigo: reclamo.codigo, referencia: pedidoId, intento: reclamo.intentos });
  } catch (e) {
    resultado = { estado: 'desconocido', detalle: `Error al llamar al proveedor: ${mensajeError(e)}` };
  }
  if (resultado.saldo !== undefined) await guardarUso(d, resultado.saldo, null);
  if (resultado.estado === 'en_proceso') resultado = await seguirOrden(d, reclamo, resultado);

  const cierre = cierreDe(resultado);
  const { cerrado, ultimoError } = await cerrarConReintentos(d, pedidoId, cierre, simulado);

  // En el pedido va el motivo "público"; en el registro del admin, el motivo real si el proveedor lo dio.
  const motivoRegistro = resultado.estado === 'entregado' ? '' : (resultado.interno ?? resultado.detalle);
  const resumen = `${reclamo.nombre_paquete} → ${resultado.estado}${motivoRegistro ? `: ${motivoRegistro}` : ''}${simulado ? ' (simulado)' : ''}${cerrado ? '' : ` | NO SE PUDO GUARDAR EL RESULTADO: ${ultimoError}`}`;
  await d.repo.log('entregar', reclamo.juego, pedidoId, usuarioId, resultado.estado === 'entregado' && cerrado, resumen);

  // Si la llave ya no sirve (venció, la pausaron...), no se sigue intentando: la conexión queda como "no lista"
  // y las compras nuevas se entregan a mano hasta que el admin lo resuelva y pulse "Probar conexión".
  if (resultado.estado === 'fallo' && resultado.credenciales) await apagarConexion(d, usuarioId, 'entregar', reclamo.juego, pedidoId, resultado.interno);

  if (!cerrado) return { ok: false, entrega: 'auto_en_proceso', mensaje: 'La entrega se hizo pero no se pudo guardar el resultado: revisa el pedido' };
  return { ok: cierre.resultado === 'entregado', entrega: ESTADO_DE_ENTREGA[cierre.resultado], mensaje: simulado ? 'Simulado: no se entregó nada de verdad' : undefined };
}

async function volverAManual(d: Deps, usuarioId: string, info: InfoPedido, motivo: 'no_configurado' | 'automatizacion_apagada'): Promise<RespuestaEntrega> {
  // Solo los pedidos que nunca se intentaron cambian de camino; los demás se quedan como están.
  if (info.entrega !== 'auto_pendiente') return { ok: false, motivo, entrega: info.entrega };
  const detalle = motivo === 'no_configurado' ? 'La conexión con el proveedor no estaba disponible: se entrega a mano' : 'La entrega automática estaba apagada: se entrega a mano';
  try {
    await d.repo.pasarAManual(info.id, detalle);
  } catch (e) {
    await d.repo.log('entregar', info.juego, info.id, usuarioId, false, `No se pudo pasar a manual: ${mensajeError(e)}`);
    return { ok: false, motivo, entrega: info.entrega };
  }
  await d.repo.log('entregar', info.juego, info.id, usuarioId, false, detalle);
  return { ok: true, entrega: 'manual', mensaje: 'La entrega automática no está disponible: se hará a mano' };
}

// ---------------------------------------------------------------------------
// 3) En qué quedó una entrega que no terminó
//    Sirve para las entregas "en proceso" (el proveedor las está aplicando), "sin confirmar" (no hubo respuesta)
//    o que se quedaron a medias. Solo PREGUNTA al proveedor (no cobra ni entrega nada) y cierra el pedido según
//    lo que diga. Lo puede pedir el dueño del pedido o el admin.
// ---------------------------------------------------------------------------
export async function revisarPedido(d: Deps, usuarioId: string, entrada: Record<string, unknown> | null): Promise<RespuestaEntrega> {
  const pedidoId = String(entrada?.pedido_id ?? '').trim();
  if (!UUID.test(pedidoId)) return { ok: false, motivo: 'pedido_invalido' };

  const info = await d.repo.infoPedido(pedidoId);
  if (!info) return { ok: false, motivo: 'no_encontrado' };
  const esAdmin = await d.repo.esAdmin(usuarioId);
  if (info.usuario_id !== usuarioId && !esAdmin) return { ok: false, motivo: 'sin_permiso' };

  if (info.tipo !== 'compra_diamantes' || info.estado !== 'confirmado') return { ok: true, entrega: info.entrega, mensaje: 'No hay nada que revisar' };
  const edad = info.entrega_at ? (d.ahora ?? Date.now)() - new Date(info.entrega_at).getTime() : Number.POSITIVE_INFINITY;
  // "En proceso" reciente = alguien la está entregando ahora mismo: no se toca.
  const porRevisar = info.entrega === 'auto_confirmando' || info.entrega === 'auto_revisar' || (info.entrega === 'auto_en_proceso' && edad >= PLAZO_SEGURO_MS);
  if (!porRevisar) return { ok: true, entrega: info.entrega };
  // Consultar una orden no exige que la API esté vigente, así que no importa si la conexión se apagó: solo hace falta la llave.
  if (!d.proveedor.listo()) return { ok: false, motivo: 'no_configurado', entrega: info.entrega };

  const simulado = d.proveedor.modo() === 'simulado';
  let r: ResultadoPedido;
  try {
    r = await d.proveedor.consultarPedido({ juego: info.juego, id: info.id_jugador ?? '', referencia: pedidoId, intento: Math.max(1, info.intentos), desdeMs: edad });
  } catch (e) {
    r = { estado: 'desconocido', interno: `Error al consultar: ${mensajeError(e)}` };
  }

  const registrar = (ok: boolean, texto: string) => d.repo.log('entregar', info.juego, pedidoId, usuarioId, ok, `Consulta de estado → ${texto}${simulado ? ' (simulado)' : ''}`);
  const cerrar = async (cierre: CierreDeEntrega): Promise<boolean> => {
    const { cerrado, ultimoError } = await cerrarConReintentos(d, pedidoId, cierre, simulado);
    if (!cerrado) await registrar(false, `NO SE PUDO GUARDAR EL RESULTADO: ${ultimoError}`);
    return cerrado;
  };

  switch (r.estado) {
    case 'entregado': {
      const cerrado = await cerrar({ resultado: 'entregado', ref: r.ref, detalle: null });
      if (cerrado) await registrar(true, `entregada (ref. ${r.ref})`);
      return cerrado
        ? { ok: true, entrega: 'auto_entregado', mensaje: simulado ? 'Simulado: no se entregó nada de verdad' : undefined }
        : { ok: false, entrega: info.entrega, mensaje: 'Se entregó pero no se pudo guardar el resultado: vuelve a consultar' };
    }
    case 'rechazado': {
      const cerrado = await cerrar({ resultado: 'fallo', ref: null, detalle: 'El proveedor no pudo procesar el paquete' });
      if (cerrado) await registrar(false, `rechazada por el proveedor, que devolvió el saldo${r.interno ? ` (${r.interno})` : ''}`);
      return { ok: false, entrega: cerrado ? 'auto_fallo' : info.entrega };
    }
    case 'no_existe': {
      // Si el proveedor ya la había aceptado, que ahora no la encuentre es raro: no se toca. Si nunca la aceptó y ya pasó
      // el tiempo máximo que tarda, es seguro decir que no llegó (y no se cobró).
      if (info.entrega === 'auto_confirmando' || edad < PLAZO_SEGURO_MS) {
        await registrar(false, info.entrega === 'auto_confirmando' ? 'el proveedor no encuentra una orden que antes aceptó: pregúntale' : 'todavía no aparece en el proveedor');
        return info.entrega === 'auto_confirmando'
          ? { ok: false, motivo: 'proveedor_no_responde', entrega: info.entrega }
          : { ok: true, entrega: info.entrega, mensaje: 'Todavía no aparece en el proveedor' };
      }
      const cerrado = await cerrar({ resultado: 'fallo', ref: null, detalle: 'El proveedor no recibió la orden: no se cobró' });
      if (cerrado) await registrar(false, 'el proveedor no tiene ninguna orden con esa clave (no se cobró): se puede reintentar');
      return { ok: false, entrega: cerrado ? 'auto_fallo' : info.entrega };
    }
    case 'en_proceso': {
      if (info.entrega === 'auto_confirmando') return { ok: false, entrega: 'auto_confirmando', mensaje: 'Sigue en proceso en el proveedor' };
      const cerrado = await cerrar({ resultado: 'confirmando', ref: null, detalle: 'El proveedor está aplicando la recarga' });
      if (cerrado) await registrar(true, `el proveedor la está aplicando${r.interno ? ` (${r.interno})` : ''}`);
      return { ok: false, entrega: cerrado ? 'auto_confirmando' : info.entrega, mensaje: 'Sigue en proceso en el proveedor' };
    }
    default: {
      await registrar(false, `no se pudo saber: ${r.interno}`);
      if (r.credenciales) await apagarConexion(d, usuarioId, 'entregar', info.juego, pedidoId, r.interno);
      return { ok: false, motivo: 'proveedor_no_responde', entrega: info.entrega };
    }
  }
}

// ---------------------------------------------------------------------------
// 4) Probar la conexión (solo admin)
// ---------------------------------------------------------------------------
export interface RespuestaProbar {
  ok: boolean;
  motivo?: 'sin_permiso';
  modo?: string;
  listo?: boolean;
  adaptador_implementado?: boolean;
  tiene_url?: boolean;
  tiene_llave?: boolean;
  saldo?: number | null;
  moneda?: string | null;
  vence_en?: string | null;
  consultas_limite?: number | null;
  consultas_usadas?: number | null;
  mensaje?: string;
}

export async function probarIntegracion(d: Deps, usuarioId: string, entrada: Record<string, unknown> | null): Promise<RespuestaProbar> {
  if (!(await d.repo.esAdmin(usuarioId))) return { ok: false, motivo: 'sin_permiso' };

  const diag = d.proveedor.diagnostico();
  const base = { modo: diag.modo, adaptador_implementado: diag.adaptador_implementado, tiene_url: diag.tiene_url, tiene_llave: diag.tiene_llave };

  // Solo mirar la configuración (sin llamar al proveedor ni guardar nada).
  if (entrada?.solo_config === true) return { ok: true, ...base, listo: d.proveedor.listo(), mensaje: configuracionTexto(diag) };

  let listo = false;
  let saldo: number | null = null;
  let moneda: string | null = null;
  let vence: string | null = null;
  let limite: number | null = null;
  let usadas: number | null = null;
  let mensaje = '';

  if (diag.modo === 'apagado') {
    mensaje = 'La integración está apagada: falta el secret PROVEEDOR_MODO (simulado o real).';
  } else if (!d.proveedor.listo()) {
    mensaje = configuracionTexto(diag);
  } else {
    try {
      const s = await d.proveedor.consultarSaldo();
      listo = s.ok;
      saldo = s.ok && typeof s.saldo === 'number' ? s.saldo : null;
      moneda = s.moneda ?? null;
      if (s.ok) { vence = s.vence_en ?? null; limite = s.consultas_limite ?? null; usadas = s.consultas_usadas ?? null; }
      mensaje = diag.modo === 'simulado' ? `MODO SIMULADO: ${s.detalle}. Nada de lo que pase es real.` : s.detalle;
    } catch (e) {
      mensaje = `No se pudo conectar con el proveedor: ${mensajeError(e)}`;
    }
  }

  await d.repo.guardarEstado({ modo: diag.modo, listo, saldo, moneda, mensaje, vence_at: vence, consultas_limite: limite, consultas_usadas: usadas });
  await d.repo.log('probar', null, null, usuarioId, listo, mensaje);
  return { ok: listo, ...base, listo, saldo, moneda, vence_en: vence, consultas_limite: limite, consultas_usadas: usadas, mensaje };
}

// ---------------------------------------------------------------------------
// 5) Catálogo del proveedor (solo admin): los nombres EXACTOS de sus paquetes, para copiarlos en el panel
// ---------------------------------------------------------------------------
export interface RespuestaCatalogo {
  ok: boolean;
  motivo?: 'sin_permiso' | 'no_configurado';
  paquetes?: PaqueteProveedor[];
  saldo?: number | null;
  moneda?: string | null;
  mensaje?: string;
}

export async function catalogoProveedor(d: Deps, usuarioId: string): Promise<RespuestaCatalogo> {
  if (!(await d.repo.esAdmin(usuarioId))) return { ok: false, motivo: 'sin_permiso' };
  if (!d.proveedor.listo()) return { ok: false, motivo: 'no_configurado', mensaje: configuracionTexto(d.proveedor.diagnostico()) };
  try {
    const c = await d.proveedor.catalogo();
    return { ok: c.ok, paquetes: c.paquetes, saldo: c.saldo ?? null, moneda: c.moneda ?? null, mensaje: c.detalle };
  } catch (e) {
    return { ok: false, paquetes: [], mensaje: `No se pudo leer el catálogo: ${mensajeError(e)}` };
  }
}

function configuracionTexto(diag: { modo: string; adaptador_implementado: boolean; tiene_url: boolean; tiene_llave: boolean }): string {
  if (diag.modo === 'apagado') return 'La integración está apagada: falta el secret PROVEEDOR_MODO (simulado o real).';
  if (diag.modo === 'simulado') return 'Modo simulado listo para probar (no se entrega nada de verdad).';
  const faltan: string[] = [];
  if (!diag.adaptador_implementado) faltan.push('completar el adaptador (proveedor.ts)');
  if (!diag.tiene_url) faltan.push('el secret PROVEEDOR_URL (que empiece con https://)');
  if (!diag.tiene_llave) faltan.push('el secret PROVEEDOR_API_KEY');
  return faltan.length ? `Modo real: falta ${faltan.join(', ')}.` : 'Modo real configurado.';
}

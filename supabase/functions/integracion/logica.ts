// ============================================================================
// REGLAS DE LA INTEGRACIÓN (sin Supabase ni HTTP: se prueban con datos falsos)
//   · validarJugador  → nickname a partir del ID
//   · entregarPedido  → entrega automática de un pedido ya pagado
//   · probarIntegracion → comprueba la conexión (solo admin)
// Todo lo que toca la base de datos entra por "Repo" y todo lo que toca al
// proveedor por "Proveedor", así se pueden probar sin red.
// ============================================================================
import type { PaqueteProveedor, Proveedor } from './proveedor.ts';

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
export interface EstadoGuardado { modo: string; listo: boolean; saldo: number | null; moneda: string | null; mensaje: string }

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
  cerrarEntrega(id: string, resultado: 'entregado' | 'fallo' | 'revisar', ref: string | null, detalle: string | null, simulado: boolean): Promise<void>;
  guardarEstado(e: EstadoGuardado): Promise<void>;
}

export interface Deps {
  repo: Repo;
  proveedor: Proveedor;
  ahora?: () => number;
  esperar?: (ms: number) => Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL_CACHE_MS = 24 * 60 * 60 * 1000;

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

  // Sin conexión lista, o si el proveedor aún no ofrece consulta de nickname, la web acepta el ID como siempre
  // (y no se gasta ninguno de los intentos por hora del usuario).
  if (d.proveedor.modo() === 'apagado' || !d.proveedor.listo() || !d.proveedor.nicknameDisponible()) return { ok: false, motivo: 'no_configurado' };

  const juego = slug ? await d.repo.obtenerJuego(slug) : null;
  if (!juego || !juego.activo) return { ok: false, motivo: 'juego_invalido' };
  if (!juego.validar_auto) return { ok: false, motivo: 'no_configurado' };

  if (!id || id.length > 30 || !patronCumple(juego.patron_id, id)) return { ok: false, motivo: 'id_invalido' };
  if (juego.usa_zona ? !/^[0-9A-Za-z-]{1,12}$/.test(zona) : zona !== '') return { ok: false, motivo: 'id_invalido' };

  const guardado = await d.repo.obtenerCache(slug, id, zona);
  if (guardado && ahora() - new Date(guardado.consultado_at).getTime() < TTL_CACHE_MS) {
    return { ok: true, nickname: guardado.nickname, cache: true };
  }

  if (!(await d.repo.permitirConsulta(usuarioId, slug))) return { ok: false, motivo: 'limite' };

  let r;
  try {
    r = await d.proveedor.consultarJugador({ juego: slug, id, zona: zona || undefined });
  } catch (e) {
    await d.repo.log('validar', slug, null, usuarioId, false, `${ocultarId(id)} → error: ${mensajeError(e)}`);
    return { ok: false, motivo: 'no_disponible' };
  }

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
  await d.repo.log('validar', slug, null, usuarioId, r.motivo === 'no_encontrado', `${ocultarId(id)} → ${r.motivo}`);
  if (r.motivo === 'no_encontrado') return { ok: false, motivo: 'no_encontrado' };
  return { ok: false, motivo: r.motivo === 'no_configurado' ? 'no_configurado' : 'no_disponible' };
}

// ---------------------------------------------------------------------------
// 2) Entrega automática de un pedido
// ---------------------------------------------------------------------------
export type RespuestaEntrega =
  | { ok: boolean; entrega: string; mensaje?: string }
  | { ok: false; motivo: 'pedido_invalido' | 'no_encontrado' | 'sin_permiso' | 'no_configurado' | 'automatizacion_apagada'; entrega?: string };

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
  const reintentable = info.entrega === 'auto_pendiente' || (forzar && ['auto_fallo', 'auto_revisar', 'auto_en_proceso'].includes(info.entrega));
  if (!reintentable) return { ok: true, entrega: info.entrega };

  // Mejor no gastar un intento si la conexión no está lista o el juego tiene la entrega automática apagada.
  // Un pedido nuevo que quedó esperando la entrega automática vuelve al flujo manual de siempre.
  if (!d.proveedor.listo()) return await volverAManual(d, usuarioId, info, 'no_configurado');
  const juego = await d.repo.obtenerJuego(info.juego);
  if (!juego || !juego.activo || (!juego.entrega_auto && !forzar)) return await volverAManual(d, usuarioId, info, 'automatizacion_apagada');

  // Aquí se decide quién entrega: solo UNA llamada logra "reclamar" el pedido.
  const reclamo = await d.repo.reclamarEntrega(pedidoId, forzar);
  if (!reclamo) {
    const ahoraInfo = await d.repo.infoPedido(pedidoId);
    return { ok: true, entrega: ahoraInfo?.entrega ?? info.entrega, mensaje: 'Otra llamada ya lo está procesando' };
  }

  const simulado = d.proveedor.modo() === 'simulado';
  let resultado;
  try {
    resultado = await d.proveedor.crearRecarga({ juego: reclamo.juego, id: reclamo.id_jugador, codigo: reclamo.codigo, referencia: pedidoId });
  } catch (e) {
    resultado = { estado: 'desconocido' as const, detalle: `Error al llamar al proveedor: ${mensajeError(e)}` };
  }

  const cierre = resultado.estado === 'entregado'
    ? { resultado: 'entregado' as const, ref: resultado.ref, detalle: null }
    : resultado.estado === 'fallo'
    ? { resultado: 'fallo' as const, ref: null, detalle: resultado.detalle }
    : { resultado: 'revisar' as const, ref: null, detalle: resultado.detalle };

  // Cerrar bien la entrega es crítico: si falla, se reintenta antes de rendirse.
  let cerrado = false;
  let ultimoError = '';
  const esperar = d.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let intento = 1; intento <= 3 && !cerrado; intento++) {
    try {
      await d.repo.cerrarEntrega(pedidoId, cierre.resultado, cierre.ref, cierre.detalle, simulado);
      cerrado = true;
    } catch (e) {
      ultimoError = mensajeError(e);
      if (intento < 3) await esperar(400 * intento);
    }
  }

  // En el pedido va el motivo "público"; en el registro del admin, el motivo real si el proveedor lo dio.
  const motivoRegistro = resultado.estado === 'entregado' ? '' : (resultado.interno ?? resultado.detalle);
  const resumen = `${reclamo.nombre_paquete} → ${resultado.estado}${motivoRegistro ? `: ${motivoRegistro}` : ''}${simulado ? ' (simulado)' : ''}${cerrado ? '' : ` | NO SE PUDO GUARDAR EL RESULTADO: ${ultimoError}`}`;
  await d.repo.log('entregar', reclamo.juego, pedidoId, usuarioId, resultado.estado === 'entregado' && cerrado, resumen);

  if (!cerrado) return { ok: false, entrega: 'auto_en_proceso', mensaje: 'La entrega se hizo pero no se pudo guardar el resultado: revisa el pedido' };
  const entrega = cierre.resultado === 'entregado' ? 'auto_entregado' : cierre.resultado === 'fallo' ? 'auto_fallo' : 'auto_revisar';
  return { ok: cierre.resultado === 'entregado', entrega, mensaje: simulado ? 'Simulado: no se entregó nada de verdad' : undefined };
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
// 3) Probar la conexión (solo admin)
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
      mensaje = diag.modo === 'simulado' ? `MODO SIMULADO: ${s.detalle}. Nada de lo que pase es real.` : s.detalle;
    } catch (e) {
      mensaje = `No se pudo conectar con el proveedor: ${mensajeError(e)}`;
    }
  }

  await d.repo.guardarEstado({ modo: diag.modo, listo, saldo, moneda, mensaje });
  await d.repo.log('probar', null, null, usuarioId, listo, mensaje);
  return { ok: listo, ...base, listo, saldo, moneda, mensaje };
}

// ---------------------------------------------------------------------------
// 4) Catálogo del proveedor (solo admin): los nombres EXACTOS de sus paquetes, para copiarlos en el panel
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

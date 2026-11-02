// ============================================================================
// ADAPTADOR DEL PROVEEDOR DE RECARGAS
// ----------------------------------------------------------------------------
// Este es el ÚNICO archivo que habla con la API del proveedor. Todo lo demás
// (validar el ID, entregar el pedido, el panel admin, la web) no cambia si el
// proveedor cambia: solo se ajusta la sección "MODO REAL" de abajo.
//
// Tiene 3 modos, que se eligen con el secret PROVEEDOR_MODO en Supabase:
//   · apagado  (por defecto, o si falta el secret): no se llama a nadie. La web
//              sigue como siempre: el ID se acepta sin nickname y la entrega es
//              a mano.
//   · simulado: respuestas inventadas para PROBAR todo el flujo sin gastar saldo
//              ni entregar nada de verdad (ver los finales de ID más abajo).
//   · real:    llama a la API del proveedor con PROVEEDOR_URL y PROVEEDOR_API_KEY
//              (saldo y catálogo, nickname, recarga y consulta de una orden).
//
// La llave NUNCA sale de aquí: se lee de los secrets del servidor y no se
// escribe en ningún log ni respuesta.
// ============================================================================

export type Modo = 'apagado' | 'simulado' | 'real';

export interface ConsultaJugador { juego: string; id: string; zona?: string }

// "interno" es el motivo real (solo lo ve el admin en el registro). "restantes" = consultas de ID que le quedan a la API.
export type ResultadoConsulta =
  | { ok: true; nickname: string; extra?: Record<string, unknown>; restantes?: number }
  | { ok: false; motivo: 'no_encontrado' | 'no_disponible' | 'no_configurado'; interno?: string; credenciales?: boolean; restantes?: number };

export interface PedidoRecarga {
  juego: string;
  id: string;           // ID del jugador
  zona?: string;
  codigo: string;       // código del producto en el proveedor (se pone por paquete en el panel)
  referencia: string;   // id de NUESTRO pedido
  intento?: number;     // 1 la primera vez; cada reintento usa su propia clave (ver claveDeOrden)
}

// "detalle" lo puede leer el dueño del pedido: mensajes cortos y sin datos internos.
// "interno" (opcional) es el motivo real, que solo ve el admin en el registro de actividad.
// "saldo" = lo que le queda en el proveedor, si lo dijo en su respuesta.
export type ResultadoRecarga =
  | { estado: 'entregado'; ref: string; saldo?: number }
  | { estado: 'en_proceso'; detalle: string; interno?: string; saldo?: number } // el proveedor la aceptó y la está aplicando: se confirma con consultarPedido
  | { estado: 'fallo'; detalle: string; interno?: string; credenciales?: boolean; saldo?: number } // se rechazó de forma definitiva y no quedó cobrada; credenciales = la llave no sirve (vencida, pausada o cambiada)
  | { estado: 'desconocido'; detalle: string; interno?: string; saldo?: number }; // no sabemos si la hizo (timeout, error 5xx, respuesta rara...): hay que consultar o revisar a mano

export interface ConsultaPedido {
  juego: string;
  id: string;           // ID del jugador (solo lo usa el modo simulado)
  referencia: string;
  intento?: number;
  desdeMs?: number;     // hace cuánto se hizo la orden (solo lo usa el modo simulado)
}

export type ResultadoPedido =
  | { estado: 'entregado'; ref: string }
  | { estado: 'en_proceso'; interno?: string }       // sigue aplicándose en el proveedor
  | { estado: 'rechazado'; interno?: string }        // el proveedor la rechazó y devolvió el saldo
  | { estado: 'no_existe' }                          // el proveedor no tiene ninguna orden con esa clave
  | { estado: 'desconocido'; interno: string; credenciales?: boolean }; // no se pudo saber (sin red, error, respuesta rara...)

export interface ResultadoSaldo {
  ok: boolean;
  saldo?: number;
  moneda?: string;
  detalle: string;
  vence_en?: string;           // cuándo vence el acceso a la API (fecha ISO en UTC)
  consultas_limite?: number;   // cupo de consultas de ID de esta vigencia
  consultas_usadas?: number;
}

export interface PaqueteProveedor { codigo: string; precio: number; juego?: string; tipo?: string; requiere_zona?: boolean }
export interface ResultadoCatalogo {
  ok: boolean;
  paquetes: PaqueteProveedor[];
  saldo?: number;
  moneda?: string;
  detalle: string;
  vence_en?: string;
  consultas_limite?: number;
  consultas_usadas?: number;
}

export interface Diagnostico {
  modo: Modo;
  adaptador_implementado: boolean;
  tiene_url: boolean;
  tiene_llave: boolean;
  nickname_disponible: boolean;
}

export interface Proveedor {
  modo(): Modo;
  /** ¿Se pueden hacer recargas de verdad ahora mismo? (simulado, o real con adaptador completo y credenciales) */
  listo(): boolean;
  /** ¿Se puede consultar el nickname de un ID? (no todos los juegos lo tienen: sin juego, pregunta en general) */
  nicknameDisponible(juego?: string): boolean;
  diagnostico(): Diagnostico;
  consultarJugador(c: ConsultaJugador): Promise<ResultadoConsulta>;
  crearRecarga(p: PedidoRecarga): Promise<ResultadoRecarga>;
  /** En qué quedó una recarga ya enviada (no cobra nada ni gasta cupo). */
  consultarPedido(c: ConsultaPedido): Promise<ResultadoPedido>;
  consultarSaldo(): Promise<ResultadoSaldo>;
  /** Productos del proveedor (para copiar sus códigos en el panel). Si no tiene catálogo: ok con lista vacía. */
  catalogo(): Promise<ResultadoCatalogo>;
}

type Entorno = (clave: string) => string | undefined;
type Http = (url: string, init: RequestInit) => Promise<Response>;

/** Todo el modo real está escrito (ver más abajo). Solo se usa con PROVEEDOR_MODO=real y sus secrets. */
export const ADAPTADOR_REAL_IMPLEMENTADO = true;

/** El proveedor ya ofrece la consulta de nickname... */
export const NICKNAME_REAL_IMPLEMENTADO = true;

/** ...pero solo para estos juegos. En los demás el ID se acepta sin nickname y no se gasta ninguna consulta. */
export const JUEGOS_CON_NICKNAME = ['free-fire'];

// Cuánto se espera al proveedor (milisegundos). Comprar puede tardar bastante más que consultar.
interface Tiempos { consulta: number; compra: number; nickname: number }
const TIEMPOS: Tiempos = { consulta: 15000, compra: 70000, nickname: 30000 };

export function leerModo(env: Entorno): Modo {
  const m = (env('PROVEEDOR_MODO') ?? '').trim().toLowerCase();
  return m === 'simulado' || m === 'real' ? m : 'apagado';
}

const esUrlSegura = (v: string | undefined) => /^https:\/\/\S+$/i.test((v ?? '').trim());
const hayTexto = (v: string | undefined) => (v ?? '').trim().length > 0;

/**
 * Clave que se manda al proveedor como partner_order_id: nuestro pedido + el número de intento.
 * El proveedor recuerda cada clave: repetirla NO vuelve a cobrar ni a entregar, y si esa orden fue
 * rechazada devuelve el mismo rechazo para siempre. Por eso cada reintento usa su propia clave.
 */
export function claveDeOrden(referencia: string, intento = 1): string {
  return intento > 1 ? `MZ-${referencia}-${intento}` : `MZ-${referencia}`;
}

/** `esperaMs` (solo para pruebas) fija el mismo tiempo máximo para todas las llamadas. */
export function crearProveedor(env: Entorno = (k) => Deno.env.get(k), http: Http = (u, i) => fetch(u, i), esperaMs?: number): Proveedor {
  const modo = leerModo(env);
  const tieneUrl = esUrlSegura(env('PROVEEDOR_URL'));
  const tieneLlave = hayTexto(env('PROVEEDOR_API_KEY'));
  const tiempos: Tiempos = esperaMs === undefined ? TIEMPOS : { consulta: esperaMs, compra: esperaMs, nickname: esperaMs };
  const api: Api = { env, http, tiempos };

  const listo = () =>
    modo === 'simulado' || (modo === 'real' && ADAPTADOR_REAL_IMPLEMENTADO && tieneUrl && tieneLlave);
  const nicknameDisponible = (juego?: string) =>
    modo === 'simulado' ||
    (modo === 'real' && listo() && NICKNAME_REAL_IMPLEMENTADO && (juego === undefined || JUEGOS_CON_NICKNAME.includes(juego)));

  return {
    modo: () => modo,
    listo,
    nicknameDisponible,
    diagnostico: () => ({ modo, adaptador_implementado: ADAPTADOR_REAL_IMPLEMENTADO, tiene_url: tieneUrl, tiene_llave: tieneLlave, nickname_disponible: nicknameDisponible() }),

    async consultarJugador(c) {
      if (!nicknameDisponible(c.juego)) return { ok: false, motivo: 'no_configurado' };
      return modo === 'simulado' ? simuladoConsultar(c) : await realConsultarJugador(api, c);
    },

    async crearRecarga(p) {
      if (!listo()) return { estado: 'fallo', detalle: 'La integración con el proveedor no está lista' };
      return modo === 'simulado' ? await simuladoRecarga(p) : await realCrearRecarga(api, p);
    },

    async consultarPedido(c) {
      if (!listo()) return { estado: 'desconocido', interno: 'La integración con el proveedor no está lista' };
      return modo === 'simulado' ? simuladoPedido(c) : await realConsultarPedido(api, c);
    },

    async consultarSaldo() {
      if (!listo()) return { ok: false, detalle: 'La integración con el proveedor no está lista' };
      if (modo === 'simulado') return simuladoSaldo();
      const c = await realLeerCatalogo(api);
      return { ok: c.ok, saldo: c.saldo, moneda: c.moneda, detalle: c.detalle, vence_en: c.vence_en, consultas_limite: c.consultas_limite, consultas_usadas: c.consultas_usadas };
    },

    async catalogo() {
      if (!listo()) return { ok: false, paquetes: [], detalle: 'La integración con el proveedor no está lista' };
      return modo === 'simulado' ? simuladoCatalogo() : await realLeerCatalogo(api);
    },
  };
}

// ============================================================================
// MODO SIMULADO — para probar el flujo completo sin tocar al proveedor.
//   ID que termina en 000 → "no existe"          ID que termina en 111 → proveedor caído
//   ID que termina en 999 → recarga rechazada     ID que termina en 888 → sin respuesta (revisar)
//   ID que termina en 777 → queda "en proceso" y a los 20 segundos se entrega
//   ID que termina en 666 → queda "en proceso" y a los 20 segundos el proveedor la rechaza
//   ID que termina en 555 → queda "en proceso" y nunca termina
//   cualquier otro        → nickname "Jugador####" y recarga "entregada" (de mentira)
// ============================================================================
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SIM_TARDA_MS = 20000;

function simuladoConsultar(c: ConsultaJugador): ResultadoConsulta {
  if (c.id.endsWith('000')) return { ok: false, motivo: 'no_encontrado' };
  if (c.id.endsWith('111')) return { ok: false, motivo: 'no_disponible', interno: 'Simulado: el validador no responde' };
  return { ok: true, nickname: `Jugador${c.id.slice(-4)}`, extra: { region: 'SIMULADO' } };
}

async function simuladoRecarga(p: PedidoRecarga): Promise<ResultadoRecarga> {
  await esperar(600);
  if (p.id.endsWith('999')) return { estado: 'fallo', detalle: 'Simulado: el proveedor rechazó la recarga' };
  if (p.id.endsWith('888')) return { estado: 'desconocido', detalle: 'Simulado: el proveedor no respondió' };
  if (/(777|666|555)$/.test(p.id)) return { estado: 'en_proceso', detalle: 'Simulado: el proveedor está aplicando la recarga' };
  return { estado: 'entregado', ref: `SIM-${p.referencia.slice(0, 8)}` };
}

function simuladoPedido(c: ConsultaPedido): ResultadoPedido {
  const sigueAplicandose = (c.desdeMs ?? 0) < SIM_TARDA_MS;
  if (c.id.endsWith('555')) return { estado: 'en_proceso' };
  if (c.id.endsWith('777')) return sigueAplicandose ? { estado: 'en_proceso' } : { estado: 'entregado', ref: `SIM-${c.referencia.slice(0, 8)}` };
  if (c.id.endsWith('666')) return sigueAplicandose ? { estado: 'en_proceso' } : { estado: 'rechazado', interno: 'Simulado: el proveedor la rechazó y devolvió el saldo' };
  if (c.id.endsWith('888')) return { estado: 'no_existe' };
  return { estado: 'entregado', ref: `SIM-${c.referencia.slice(0, 8)}` };
}

function simuladoSaldo(): ResultadoSaldo {
  return { ok: true, saldo: 1000, moneda: 'USD', detalle: 'Saldo simulado' };
}

function simuladoCatalogo(): ResultadoCatalogo {
  const paquetes = [
    { codigo: 'SIM-100', precio: 0.7 },
    { codigo: 'SIM-300', precio: 2.1 },
    { codigo: 'SIM-500', precio: 3.5 },
    { codigo: 'SIM-1000', precio: 7 },
  ];
  return { ok: true, paquetes, saldo: 1000, moneda: 'USD', detalle: 'Catálogo simulado (precios inventados)' };
}

// ============================================================================
// MODO REAL — API del proveedor (REST sobre JSON)
// ----------------------------------------------------------------------------
//   Un solo endpoint (PROVEEDOR_URL), siempre POST, con la llave en el header X-API-Key y la acción en el cuerpo:
//     { accion: 'saldo' }                       → saldo, vencimiento de la API, cupo de consultas de ID y catálogo con tus precios
//     { accion: 'validar_id', id_juego }        → nickname de un jugador (solo Free Fire; cada respuesta gasta 1 consulta del cupo)
//     { accion: 'comprar', id_juego, paquete, zone_id?, partner_order_id }
//     { accion: 'pedido', partner_order_id }    → en qué quedó una orden (sigue funcionando aunque la API esté vencida o pausada)
//   Saldo y precios en USDT (los campos se llaman balance_usd y precio_usd). "paquete" es el nombre tal cual lo
//   lista el catálogo. Todas las respuestas de error traen un código fijo en "error" y un texto en "message".
//   Cada respuesta se traduce a pocos resultados: "entregado" (el proveedor lo confirma), "en_proceso" (lo aceptó y lo está
//   aplicando), "fallo" (dice claramente que no lo hizo ni lo cobró) y "desconocido" (cualquier duda: timeout, error 5xx...).
//   "detalle" lo puede leer el dueño del pedido; el motivo real va en "interno" y solo lo ve el admin.
// ============================================================================
interface Api { env: Entorno; http: Http; tiempos: Tiempos }
interface RespuestaHttp { status: number; json: Record<string, unknown> | null }

function cabecerasDeAutenticacion(llave: string): Record<string, string> {
  return { 'X-API-Key': llave };
}

/** Llamada HTTP al proveedor, con tiempo máximo. Lanza error si no hay respuesta. */
async function llamarApi(api: Api, cuerpo: unknown, esperaMs: number): Promise<RespuestaHttp> {
  const url = (api.env('PROVEEDOR_URL') ?? '').trim();
  const llave = (api.env('PROVEEDOR_API_KEY') ?? '').trim();
  if (!esUrlSegura(url) || !llave) throw new Error('Faltan PROVEEDOR_URL (con https://) o PROVEEDOR_API_KEY');
  const ctl = new AbortController();
  const temporizador = setTimeout(() => ctl.abort(), esperaMs);
  try {
    const resp = await api.http(url, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', ...cabecerasDeAutenticacion(llave) },
      body: JSON.stringify(cuerpo),
      signal: ctl.signal,
    });
    const texto = (await resp.text()).slice(0, 50000);
    let json: Record<string, unknown> | null = null;
    try {
      const j = JSON.parse(texto);
      if (j && typeof j === 'object' && !Array.isArray(j)) json = j as Record<string, unknown>;
    } catch { /* no era JSON */ }
    return { status: resp.status, json };
  } finally {
    clearTimeout(temporizador);
  }
}

const texto = (v: unknown, max: number) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));

/** Código fijo del error (campo "error" de la respuesta), en minúsculas. */
function codigoDe(json: Record<string, unknown> | null): string {
  return json ? texto(json.error, 60).toLowerCase() : '';
}

/** Texto corto y de una línea de lo que dijo el proveedor (para el registro del admin, nunca para el cliente). */
function dicho(json: Record<string, unknown> | null): string {
  if (!json) return '';
  return [texto(json.error, 60), texto(json.message ?? json.mensaje, 140)].filter(Boolean).join(': ').replace(/\s+/g, ' ').slice(0, 170);
}

/** Por qué no hubo respuesta (tiempo agotado, red caída...). */
function sinRespuesta(e: unknown): string {
  if (e instanceof DOMException && e.name === 'AbortError') return 'no respondió a tiempo';
  return (e instanceof Error ? e.message : String(e)).slice(0, 140);
}

/** Nombres de los campos que llegaron (sin sus valores): ayuda a ver qué cambió si el proveedor responde distinto. */
function camposDe(json: Record<string, unknown> | null): string {
  return json ? Object.keys(json).slice(0, 12).join(', ') : 'ninguno';
}

/** Primer valor numérico entre varios nombres posibles de un mismo campo. */
function primerNumero(o: Record<string, unknown>, nombres: string[]): number {
  for (const n of nombres) {
    const v = o[n];
    if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return NaN;
}

const SALDO = ['balance_usd', 'balance_usdt', 'balance', 'saldo'];
const saldoDe = (json: Record<string, unknown> | null): number | undefined => {
  const n = json ? primerNumero(json, SALDO) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const enteroDe = (v: unknown): number | undefined => (v !== null && v !== undefined && v !== '' && Number.isInteger(Number(v)) ? Number(v) : undefined);

// Errores que significan "la llave no sirve". No se reintentan: hay que resolverlo con quien da la API.
const CODIGOS_DE_LLAVE = new Set(['missing_api_key', 'key_invalida', 'cuenta_inactiva', 'cuenta_vencida']);
const esErrorDeLlave = (status: number, codigo: string) => status === 401 || CODIGOS_DE_LLAVE.has(codigo);

function explicarLlave(codigo: string): string {
  switch (codigo) {
    case 'cuenta_vencida': return 'El acceso a la API venció (o no incluye este juego): pide que te lo renueven';
    case 'cuenta_inactiva': return 'La API está pausada o desactivada: pide que te la activen';
    case 'missing_api_key': return 'No se está enviando la llave: revisa el secret PROVEEDOR_API_KEY';
    default: return 'La llave no sirve (no existe, está desactivada o se generó otra nueva): revisa el secret PROVEEDOR_API_KEY';
  }
}

// Rechazos de "comprar" que dejan claro que NO se hizo ni se cobró (o que se cobró y se devolvió en el mismo momento).
const RECHAZOS_DE_COMPRA: Record<string, string> = {
  recarga_rechazada: 'El proveedor rechazó la recarga y devolvió el saldo (revisa el ID del jugador y el paquete)',
  saldo_insuficiente: 'No hay saldo suficiente en el proveedor: recárgalo y reintenta la entrega',
  producto_no_disponible: 'El proveedor no tiene ese paquete por API: revisa su código (debe ser el nombre exacto de su catálogo)',
  sin_precio: 'El paquete no tiene precio para tu cuenta en el proveedor',
  falta_zone_id: 'El paquete necesita la zona del jugador (Mobile Legends) y la web todavía no la pide',
  id_invalido: 'El proveedor no acepta el ID del jugador (formato inválido)',
  missing_fields: 'La solicitud al proveedor salió incompleta: avisa a quien mantiene la web',
  invalid_json: 'La solicitud al proveedor salió mal armada: avisa a quien mantiene la web',
  accion_invalida: 'La solicitud al proveedor salió mal armada: avisa a quien mantiene la web',
  method_not_allowed: 'La solicitud al proveedor salió mal armada: avisa a quien mantiene la web',
};

/** Saldo y catálogo (la acción "saldo" trae todo). Nunca compra nada. */
async function realLeerCatalogo(api: Api): Promise<ResultadoCatalogo> {
  const fallo = (detalle: string): ResultadoCatalogo => ({ ok: false, paquetes: [], detalle });
  let r: RespuestaHttp;
  try {
    r = await llamarApi(api, { accion: 'saldo' }, api.tiempos.consulta);
  } catch (e) {
    return fallo(`No se pudo contactar al proveedor: ${sinRespuesta(e)}`);
  }
  const codigo = codigoDe(r.json);
  if (esErrorDeLlave(r.status, codigo)) return fallo(`${explicarLlave(codigo)}.`);
  if (r.status !== 200 || !r.json || r.json.ok !== true) {
    const motivo = dicho(r.json);
    return fallo(`El proveedor respondió con error (HTTP ${r.status}${motivo ? `: ${motivo}` : ''})`);
  }
  const saldo = saldoDe(r.json);
  if (saldo === undefined) return fallo(`Respuesta inesperada del proveedor: no trae el saldo (campos recibidos: ${camposDe(r.json)})`);

  const paquetes: PaqueteProveedor[] = (Array.isArray(r.json.paquetes) ? r.json.paquetes : []).flatMap((p: unknown) => {
    const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
    const nombre = texto(o.paquete ?? o.nombre, 80);
    const precio = primerNumero(o, ['precio_usd', 'precio_usdt', 'precio']);
    if (!nombre || !Number.isFinite(precio)) return [];
    const paquete: PaqueteProveedor = { codigo: nombre, precio };
    const juego = texto(o.juego, 40), tipo = texto(o.tipo, 20);
    if (juego) paquete.juego = juego;
    if (tipo) paquete.tipo = tipo;
    if (o.requiere_zone_id === true) paquete.requiere_zona = true;
    return [paquete];
  });

  const resultado: ResultadoCatalogo = { ok: true, paquetes, saldo, moneda: 'USDT', detalle: `Conexión correcta: ${paquetes.length} ${paquetes.length === 1 ? 'paquete' : 'paquetes'} en el catálogo` };
  const vence = texto(r.json.vence_en, 40);
  if (vence && Number.isFinite(Date.parse(vence))) resultado.vence_en = new Date(vence).toISOString();
  const cupo = (r.json.consultas_id && typeof r.json.consultas_id === 'object' ? r.json.consultas_id : null) as Record<string, unknown> | null;
  const limite = cupo ? enteroDe(cupo.limite) : undefined, usadas = cupo ? enteroDe(cupo.usadas) : undefined;
  if (limite !== undefined && usadas !== undefined) { resultado.consultas_limite = limite; resultado.consultas_usadas = usadas; }
  return resultado;
}

async function realCrearRecarga(api: Api, p: PedidoRecarga): Promise<ResultadoRecarga> {
  const clave = claveDeOrden(p.referencia, p.intento);
  const cuerpo: Record<string, unknown> = { accion: 'comprar', id_juego: p.id, paquete: p.codigo, partner_order_id: clave };
  if (p.zona) cuerpo.zone_id = p.zona;

  let r: RespuestaHttp;
  try {
    r = await llamarApi(api, cuerpo, api.tiempos.compra);
  } catch (e) {
    // Puede que la orden haya llegado y la respuesta no: nunca se asume que falló.
    return { estado: 'desconocido', detalle: 'El proveedor no respondió: se confirmará su estado', interno: `Sin respuesta (${sinRespuesta(e)})` };
  }

  const codigo = codigoDe(r.json);
  const dijo = dicho(r.json);
  const saldo = saldoDe(r.json);
  const conSaldo = saldo === undefined ? {} : { saldo };

  if (esErrorDeLlave(r.status, codigo)) {
    return { estado: 'fallo', detalle: 'El proveedor rechazó la solicitud', interno: explicarLlave(codigo), credenciales: true, ...conSaldo };
  }
  if (RECHAZOS_DE_COMPRA[codigo]) {
    const detalleReal = codigo === 'recarga_rechazada' && dijo ? ` [${dijo}]` : '';
    return { estado: 'fallo', detalle: 'El proveedor no pudo procesar el paquete', interno: `${RECHAZOS_DE_COMPRA[codigo]}${detalleReal}`, ...conSaldo };
  }
  if (!r.json || r.status >= 500) {
    return { estado: 'desconocido', detalle: 'El proveedor respondió con un error: se confirmará su estado', interno: `HTTP ${r.status}${dijo ? `: ${dijo}` : ''}`, ...conSaldo };
  }
  if (r.json.ok !== true) {
    // Un rechazo que no conocemos: por prudencia no se da por "no hecho".
    return { estado: 'desconocido', detalle: 'El proveedor respondió algo inesperado: se confirmará su estado', interno: `HTTP ${r.status}${dijo ? `: ${dijo}` : ''}`, ...conSaldo };
  }

  const estado = texto(r.json.status, 60);
  const orden = texto(r.json.order_id, 40);
  const entrega = texto(r.json.delivery_code, 80);
  const referencia = entrega || (orden ? `ORD-${orden}` : clave);

  if (estado === 'completado') return { estado: 'entregado', ref: referencia, ...conSaldo };
  if (estado === 'pendiente_proveedor') {
    return { estado: 'en_proceso', detalle: `El proveedor está aplicando la recarga${orden ? ` (orden #${orden})` : ''}`, interno: `pendiente_proveedor${entrega ? `: ${entrega}` : ''}`, ...conSaldo };
  }
  // Aceptada (y quizá cobrada) pero con un estado que no conocemos.
  return { estado: 'desconocido', detalle: `El proveedor la aceptó con un estado que no conocemos (${estado || 'sin estado'}${orden ? `, orden #${orden}` : ''}): se confirmará`, interno: `status=${estado || 'vacío'}${dijo ? `: ${dijo}` : ''}`, ...conSaldo };
}

/** En qué quedó una orden ya enviada. No cobra nada y sigue funcionando aunque la API esté vencida o pausada. */
async function realConsultarPedido(api: Api, c: ConsultaPedido): Promise<ResultadoPedido> {
  const clave = claveDeOrden(c.referencia, c.intento);
  let r: RespuestaHttp;
  try {
    r = await llamarApi(api, { accion: 'pedido', partner_order_id: clave }, api.tiempos.consulta);
  } catch (e) {
    return { estado: 'desconocido', interno: `No se pudo consultar al proveedor (${sinRespuesta(e)})` };
  }
  const codigo = codigoDe(r.json);
  if (esErrorDeLlave(r.status, codigo)) return { estado: 'desconocido', interno: explicarLlave(codigo), credenciales: true };
  if (r.status === 404 && codigo === 'pedido_no_encontrado') return { estado: 'no_existe' };
  if (r.status !== 200 || !r.json || r.json.ok !== true) {
    const dijo = dicho(r.json);
    return { estado: 'desconocido', interno: `HTTP ${r.status}${dijo ? `: ${dijo}` : ''}` };
  }

  const estado = texto(r.json.status, 60);
  const entrega = texto(r.json.delivery_code, 80);
  const orden = texto(r.json.order_id, 40);
  const dijo = texto(r.json.message, 140);
  if (estado === 'completado') return { estado: 'entregado', ref: entrega || (orden ? `ORD-${orden}` : clave) };
  if (estado === 'pendiente_proveedor') return { estado: 'en_proceso', interno: dijo || undefined };
  if (estado === 'rechazado') return { estado: 'rechazado', interno: entrega || dijo || undefined };
  return { estado: 'desconocido', interno: `status=${estado || 'vacío'}${dijo ? `: ${dijo}` : ''}` };
}

/** Nickname (y nivel, región...) de un jugador de Free Fire. Cada respuesta definitiva gasta 1 consulta del cupo de la API. */
async function realConsultarJugador(api: Api, c: ConsultaJugador): Promise<ResultadoConsulta> {
  if (!JUEGOS_CON_NICKNAME.includes(c.juego)) return { ok: false, motivo: 'no_configurado' };
  let r: RespuestaHttp;
  try {
    r = await llamarApi(api, { accion: 'validar_id', id_juego: c.id }, api.tiempos.nickname);
  } catch (e) {
    return { ok: false, motivo: 'no_disponible', interno: `Sin respuesta (${sinRespuesta(e)})` };
  }

  const codigo = codigoDe(r.json);
  const restantes = enteroDe(r.json?.consultas_restantes);
  const conRestantes = restantes === undefined ? {} : { restantes };
  if (esErrorDeLlave(r.status, codigo)) return { ok: false, motivo: 'no_disponible', interno: explicarLlave(codigo), credenciales: true };

  if (r.status === 200 && r.json?.ok === true) {
    const nickname = texto(r.json.nombre_usuario, 60);
    if (!nickname) return { ok: false, motivo: 'no_disponible', interno: 'Respondió sin nickname', ...conRestantes };
    const extra = { region: texto(r.json.region, 20) || null, nivel: texto(r.json.nivel, 10) || null, likes: texto(r.json.likes, 12) || null };
    return { ok: true, nickname, extra, ...conRestantes };
  }

  switch (codigo) {
    case 'id_no_encontrado':
    case 'id_invalido':
      return { ok: false, motivo: 'no_encontrado', ...conRestantes };
    case 'cupo_agotado':
      return { ok: false, motivo: 'no_disponible', interno: 'Se agotó el cupo de consultas de ID de la API: pide que lo amplíen o lo renueven', restantes: 0 };
    case 'muy_ocupado':
      return { ok: false, motivo: 'no_disponible', interno: 'El validador de IDs está muy ocupado' };
    case 'mantenimiento':
      return { ok: false, motivo: 'no_disponible', interno: 'El validador de IDs está en mantenimiento' };
    default: {
      const dijo = dicho(r.json);
      return { ok: false, motivo: 'no_disponible', interno: `HTTP ${r.status}${dijo ? `: ${dijo}` : ''}` };
    }
  }
}

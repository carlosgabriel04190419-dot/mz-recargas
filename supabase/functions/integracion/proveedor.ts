// ============================================================================
// ADAPTADOR DEL PROVEEDOR DE RECARGAS
// ----------------------------------------------------------------------------
// Este es el ÚNICO archivo que habla con la API del proveedor. Todo lo demás
// (validar el ID, entregar el pedido, el panel admin, la web) ya está hecho y
// no cambia cuando llegue la API: solo hay que completar las 3 funciones de la
// sección "MODO REAL" de abajo con lo que diga la documentación.
//
// Tiene 3 modos, que se eligen con el secret PROVEEDOR_MODO en Supabase:
//   · apagado  (por defecto, o si falta el secret): no se llama a nadie. La web
//              sigue como siempre: el ID se acepta sin nickname y la entrega es
//              a mano.
//   · simulado: respuestas inventadas para PROBAR todo el flujo sin gastar saldo
//              ni entregar nada de verdad (ver los finales de ID más abajo).
//   · real:    llama a la API del proveedor con PROVEEDOR_URL y PROVEEDOR_API_KEY.
//              No funciona hasta completar el adaptador y poner
//              ADAPTADOR_REAL_IMPLEMENTADO = true.
//
// La llave NUNCA sale de aquí: se lee de los secrets del servidor y no se
// escribe en ningún log ni respuesta.
// ============================================================================

export type Modo = 'apagado' | 'simulado' | 'real';

export interface ConsultaJugador { juego: string; id: string; zona?: string }

export type ResultadoConsulta =
  | { ok: true; nickname: string; extra?: Record<string, unknown> }
  | { ok: false; motivo: 'no_encontrado' | 'no_disponible' | 'no_configurado' };

export interface PedidoRecarga {
  juego: string;
  id: string;           // ID del jugador
  zona?: string;
  codigo: string;       // código del producto en el proveedor (se pone por paquete en el panel)
  referencia: string;   // id de NUESTRO pedido: úsalo como clave de idempotencia si el proveedor la admite
}

// "detalle" lo puede ver el dueño del pedido: mensajes cortos y sin datos internos.
// "interno" (opcional) es el motivo real, que solo ve el admin en el registro de actividad.
export type ResultadoRecarga =
  | { estado: 'entregado'; ref: string }
  | { estado: 'fallo'; detalle: string; interno?: string }        // el proveedor la rechazó de forma definitiva (se puede reintentar o devolver el saldo)
  | { estado: 'desconocido'; detalle: string; interno?: string }; // no sabemos si la hizo (timeout, error 5xx, "en proceso"...): hay que revisar a mano

export interface ResultadoSaldo { ok: boolean; saldo?: number; moneda?: string; detalle: string }

export interface PaqueteProveedor { codigo: string; precio: number }
export interface ResultadoCatalogo { ok: boolean; paquetes: PaqueteProveedor[]; saldo?: number; moneda?: string; detalle: string }

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
  /** ¿Se puede consultar el nickname de un ID? (no todos los proveedores lo ofrecen) */
  nicknameDisponible(): boolean;
  diagnostico(): Diagnostico;
  consultarJugador(c: ConsultaJugador): Promise<ResultadoConsulta>;
  crearRecarga(p: PedidoRecarga): Promise<ResultadoRecarga>;
  consultarSaldo(): Promise<ResultadoSaldo>;
  /** Productos del proveedor (para copiar sus códigos en el panel). Si no tiene catálogo: ok con lista vacía. */
  catalogo(): Promise<ResultadoCatalogo>;
}

type Entorno = (clave: string) => string | undefined;
type Http = (url: string, init: RequestInit) => Promise<Response>;

/** Ponlo en true SOLO cuando saldo, catálogo y recarga de "MODO REAL" estén completos y probados. */
export const ADAPTADOR_REAL_IMPLEMENTADO = false;

/** Ponlo en true SOLO cuando realConsultarJugador esté completo (si el proveedor no ofrece nickname, déjalo en false). */
export const NICKNAME_REAL_IMPLEMENTADO = false;

const TIEMPO_ESPERA_MS = 15000;

export function leerModo(env: Entorno): Modo {
  const m = (env('PROVEEDOR_MODO') ?? '').trim().toLowerCase();
  return m === 'simulado' || m === 'real' ? m : 'apagado';
}

const esUrlSegura = (v: string | undefined) => /^https:\/\/\S+$/i.test((v ?? '').trim());
const hayTexto = (v: string | undefined) => (v ?? '').trim().length > 0;

export function crearProveedor(env: Entorno = (k) => Deno.env.get(k), http: Http = (u, i) => fetch(u, i), esperaMs = TIEMPO_ESPERA_MS): Proveedor {
  const modo = leerModo(env);
  const tieneUrl = esUrlSegura(env('PROVEEDOR_URL'));
  const tieneLlave = hayTexto(env('PROVEEDOR_API_KEY'));
  const api: Api = { env, http, esperaMs };

  const listo = () =>
    modo === 'simulado' || (modo === 'real' && ADAPTADOR_REAL_IMPLEMENTADO && tieneUrl && tieneLlave);
  const nicknameDisponible = () =>
    modo === 'simulado' || (modo === 'real' && listo() && NICKNAME_REAL_IMPLEMENTADO);

  return {
    modo: () => modo,
    listo,
    nicknameDisponible,
    diagnostico: () => ({ modo, adaptador_implementado: ADAPTADOR_REAL_IMPLEMENTADO, tiene_url: tieneUrl, tiene_llave: tieneLlave, nickname_disponible: nicknameDisponible() }),

    async consultarJugador(c) {
      if (!nicknameDisponible()) return { ok: false, motivo: 'no_configurado' };
      return modo === 'simulado' ? simuladoConsultar(c) : await realConsultarJugador(api, c);
    },

    async crearRecarga(p) {
      if (!listo()) return { estado: 'fallo', detalle: 'La integración con el proveedor no está lista' };
      return modo === 'simulado' ? await simuladoRecarga(p) : await realCrearRecarga(api, p);
    },

    async consultarSaldo() {
      if (!listo()) return { ok: false, detalle: 'La integración con el proveedor no está lista' };
      if (modo === 'simulado') return simuladoSaldo();
      const c = await realLeerCatalogo(api);
      return { ok: c.ok, saldo: c.saldo, moneda: c.moneda, detalle: c.detalle };
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
//   cualquier otro        → nickname "Jugador####" y recarga "entregada" (de mentira)
// ============================================================================
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

function simuladoConsultar(c: ConsultaJugador): ResultadoConsulta {
  if (c.id.endsWith('000')) return { ok: false, motivo: 'no_encontrado' };
  if (c.id.endsWith('111')) return { ok: false, motivo: 'no_disponible' };
  return { ok: true, nickname: `Jugador${c.id.slice(-4)}`, extra: { region: 'SIMULADO' } };
}

async function simuladoRecarga(p: PedidoRecarga): Promise<ResultadoRecarga> {
  await esperar(600);
  if (p.id.endsWith('999')) return { estado: 'fallo', detalle: 'Simulado: el proveedor rechazó la recarga' };
  if (p.id.endsWith('888')) return { estado: 'desconocido', detalle: 'Simulado: el proveedor no respondió' };
  return { estado: 'entregado', ref: `SIM-${p.referencia.slice(0, 8)}` };
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
// MODO REAL — COMPLETAR CUANDO LLEGUE LA DOCUMENTACIÓN DE LA API
// ----------------------------------------------------------------------------
// Pasos:
//   1) Ajusta cabecerasDeAutenticacion() a como pida la API la llave
//      (Authorization: Bearer ..., X-API-Key, llave + secreto, etc.).
//   2) Completa realLeerCatalogo (saldo y productos), realCrearRecarga y, si el proveedor
//      ofrece consulta de jugadores, realConsultarJugador.
//      Reglas importantes para realCrearRecarga:
//        · "entregado"   solo si el proveedor CONFIRMA la entrega.
//        · "fallo"       solo si el proveedor dice claramente que NO la hizo ni cobró
//                        (ID inválido, producto agotado, saldo insuficiente...).
//        · "desconocido" ante timeout, error de red, error 5xx o cualquier estado "pendiente" /
//                        "en proceso": NO sabemos si la hizo. Así nunca se entrega dos veces ni
//                        se devuelve saldo por error.
//      Si el proveedor acepta una clave de idempotencia, mándale p.referencia (el id de nuestro
//      pedido): así un reintento no cobra ni entrega dos veces.
//      "detalle" lo puede leer el dueño del pedido (mensajes cortos, sin datos internos); el motivo
//      real (por ejemplo "saldo insuficiente") va en "interno" y solo lo ve el admin.
//   3) Cambia ADAPTADOR_REAL_IMPLEMENTADO (y NICKNAME_REAL_IMPLEMENTADO) a true, vuelve a
//      desplegar la función y pon los secrets PROVEEDOR_MODO=real, PROVEEDOR_URL y PROVEEDOR_API_KEY.
//   4) En el panel admin → Integraciones, "Probar conexión" y haz una compra de prueba.
// ============================================================================
interface Api { env: Entorno; http: Http; esperaMs: number }
interface RespuestaHttp { status: number; json: Record<string, unknown> | null }

function cabecerasDeAutenticacion(llave: string): Record<string, string> {
  // ADAPTAR. Ejemplos (usa el que diga la documentación):
  //   return { 'Authorization': `Bearer ${llave}` };
  //   return { 'X-API-Key': llave };
  return { 'Authorization': `Bearer ${llave}` };
}

/** Llamada HTTP al proveedor, con tiempo máximo. Lanza error si no hay respuesta. */
async function llamarApi(api: Api, metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown): Promise<RespuestaHttp> {
  const base = (api.env('PROVEEDOR_URL') ?? '').trim().replace(/\/+$/, '');
  const llave = (api.env('PROVEEDOR_API_KEY') ?? '').trim();
  if (!esUrlSegura(base) || !llave) throw new Error('Faltan PROVEEDOR_URL (con https://) o PROVEEDOR_API_KEY');
  const ctl = new AbortController();
  const temporizador = setTimeout(() => ctl.abort(), api.esperaMs);
  try {
    const resp = await api.http(base + ruta, {
      method: metodo,
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', ...cabecerasDeAutenticacion(llave) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
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

/** Texto corto y de una línea de lo que dijo el proveedor (para el registro del admin, nunca para el cliente). */
function dicho(json: Record<string, unknown> | null): string {
  const v = json ? (json.error ?? json.message ?? json.mensaje) : null;
  return v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, 140);
}

/** Por qué no hubo respuesta (tiempo agotado, red caída...). */
function sinRespuesta(e: unknown): string {
  if (e instanceof DOMException && e.name === 'AbortError') return 'no respondió a tiempo';
  return (e instanceof Error ? e.message : String(e)).slice(0, 140);
}

// Evita "variable sin usar" mientras el adaptador real está sin completar.
void llamarApi;
void dicho;
void sinRespuesta;

// deno-lint-ignore require-await
async function realLeerCatalogo(_api: Api): Promise<ResultadoCatalogo> {
  // ADAPTAR. Sirve para "Probar conexión" (saldo) y para "Ver catálogo del proveedor".
  // Nunca debe comprar nada. Ejemplo (rutas y campos inventados; usa los de la documentación):
  //   try {
  //     const r = await llamarApi(_api, 'GET', '/saldo');
  //     if (r.status === 401) return { ok: false, paquetes: [], detalle: 'El proveedor rechazó la llave' };
  //     if (r.status !== 200 || !r.json) return { ok: false, paquetes: [], detalle: `El proveedor respondió HTTP ${r.status}: ${dicho(r.json)}` };
  //     return { ok: true, paquetes: [/* { codigo, precio } */], saldo: Number(r.json.saldo), moneda: String(r.json.moneda ?? 'USD'), detalle: 'Conexión correcta' };
  //   } catch (e) {
  //     return { ok: false, paquetes: [], detalle: `No se pudo contactar al proveedor: ${sinRespuesta(e)}` };
  //   }
  throw new Error('Adaptador real sin completar: realLeerCatalogo');
}

// deno-lint-ignore require-await
async function realCrearRecarga(_api: Api, _p: PedidoRecarga): Promise<ResultadoRecarga> {
  // ADAPTAR. Ejemplo (nombres inventados):
  //   try {
  //     const r = await llamarApi(_api, 'POST', '/recargas', { juego: _p.juego, id: _p.id, producto: _p.codigo, referencia: _p.referencia });
  //     if (r.status >= 200 && r.status < 300 && r.json?.estado === 'ok') return { estado: 'entregado', ref: String(r.json.orden ?? _p.referencia) };
  //     if (r.status >= 400 && r.status < 500) return { estado: 'fallo', detalle: 'El proveedor no pudo procesar el paquete', interno: `HTTP ${r.status}: ${dicho(r.json)}` };
  //     return { estado: 'desconocido', detalle: 'Sin confirmación del proveedor', interno: `HTTP ${r.status}: ${dicho(r.json)}` };
  //   } catch (e) {
  //     return { estado: 'desconocido', detalle: 'Sin respuesta del proveedor', interno: sinRespuesta(e) };
  //   }
  throw new Error('Adaptador real sin completar: realCrearRecarga');
}

// deno-lint-ignore require-await
async function realConsultarJugador(_api: Api, _c: ConsultaJugador): Promise<ResultadoConsulta> {
  // ADAPTAR (solo si el proveedor consulta jugadores; si usa otra URL o llave, agrega aquí sus secrets).
  // Ejemplo (rutas y campos inventados):
  //   const r = await llamarApi(_api, 'POST', '/jugador/consultar', { juego: _c.juego, id: _c.id, zona: _c.zona });
  //   if (r.status === 404) return { ok: false, motivo: 'no_encontrado' };
  //   if (r.status >= 500 || !r.json) return { ok: false, motivo: 'no_disponible' };
  //   return { ok: true, nickname: String(r.json.nickname ?? '') };
  throw new Error('Adaptador real sin completar: realConsultarJugador');
}

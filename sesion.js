// ==========================================
// sesion.js — Módulo compartido de sesión y datos del usuario
// MZ'Recargas
//
// CÓMO USARLO en cada página:
// 1. Incluir en el <head>, en este orden:
//      <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//      <script src="sesion.js"></script>
//      <script> ...tu código de la página... </script>
// 2. No vuelvas a declarar supabaseUrl/supabaseKey/supabaseClient en tu página.
// 3. Al inicio de tu window.onload:
//      const usuario = await verificarSesion();
//      if (!usuario) return; // ya mandó a login si hacía falta
//    Para páginas públicas (ej. index.html) usa: verificarSesion(false)
// 4. Para "Cerrar sesión" usa cerrarSesionSegura().
// ==========================================

// Dirección limpia: /catalogo en vez de /catalogo.html (y / en vez de /index.html).
// GitHub Pages sirve las dos formas; esto solo arregla lo que se ve en la barra del navegador
// cuando alguien entra con un enlace o favorito viejo que trae el ".html".
(function limpiarDireccion() {
    try {
        if (/^(localhost|127\.|\[::1\])/.test(location.hostname)) return;
        const limpia = location.pathname.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '');
        if (limpia !== location.pathname) history.replaceState(null, '', limpia + location.search + location.hash);
    } catch (e) { /* si no se puede, la página funciona igual */ }
})();

const supabaseUrl = 'https://bvfllkzcvrdzhkzpkryj.supabase.co';
const supabaseKey = 'sb_publishable_BDJh1MvR9C6YSA7q1Trluw_9Tx2EfGE';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

// Escapa texto antes de insertarlo con innerHTML (nickname, etc.) para que
// no se pueda inyectar HTML/JS con un dato que un usuario haya escrito.
function escHtml(v) { return (v === null || v === undefined) ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function formatearSoles(monto) {
    return 'S/ ' + Number(monto || 0).toFixed(2);
}

// Adónde volver después de iniciar sesión o crear la cuenta (?volver=catalogo%3Fcatalogo%3Dcuentas).
// Solo se aceptan páginas del propio sitio (nunca una dirección externa).
function destinoVolver(porDefecto) {
    const v = new URLSearchParams(location.search).get('volver') || '';
    return /^[a-z0-9-]+(\.html)?(\?[a-z0-9_=&-]*)?$/i.test(v) ? v : (porDefecto === undefined ? '/' : porDefecto);
}

// Pasa el "volver" de una pantalla de acceso a la otra (login ⇄ registro).
function conVolver(url) {
    const v = destinoVolver('');
    return v ? url + (url.includes('?') ? '&' : '?') + 'volver=' + encodeURIComponent(v) : url;
}

// ---------- ESTADO DE LOS CATÁLOGOS (visible / mantenimiento / sin stock) ----------
// Lo decide el admin en el panel (tabla catalogos_config) y también lo hace cumplir el servidor al comprar.
async function cargarConfigCatalogos() {
    const { data } = await supabaseClient.from('catalogos_config').select('categoria, visible, mantenimiento, sin_stock, mensaje');
    const mapa = {};
    (data || []).forEach(c => { mapa[c.categoria] = c; });
    return mapa;
}

// 'oculto' | 'mant' | 'stock' | 'ok'
function estadoVisualCatalogo(c) {
    if (!c) return 'ok';
    if (!c.visible) return 'oculto';
    if (c.mantenimiento) return 'mant';
    if (c.sin_stock) return 'stock';
    return 'ok';
}

// Pinta las tarjetas de catálogo (inicio y selector): quita las ocultas y marca las de
// mantenimiento / sin stock con su etiqueta y el mensaje del admin.
function aplicarEstadoTarjetas(mapa) {
    document.querySelectorAll('a.catalogo-card[href*="catalogo="]').forEach(a => {
        const cat = new URL(a.getAttribute('href'), location.href).searchParams.get('catalogo');
        const c = mapa[cat];
        const e = estadoVisualCatalogo(c);
        if (e === 'oculto') { a.remove(); return; }
        if (e === 'ok') return;
        a.classList.add('cat-' + e);
        a.insertAdjacentHTML('afterbegin', `<span class="cat-etiqueta"><span class="material-icons">${e === 'mant' ? 'build' : 'remove_shopping_cart'}</span>${e === 'mant' ? 'En mantenimiento' : 'Sin stock'}</span>`);
        if (c.mensaje) a.insertAdjacentHTML('beforeend', `<p class="cat-mensaje">${escHtml(c.mensaje)}</p>`);
    });
}

// ---------- INTEGRACIÓN CON EL PROVEEDOR (nickname por ID y entrega automática) ----------
// Todo pasa por la función "integracion" de Supabase: la llave del proveedor vive solo en el servidor
// y nunca llega al navegador. Devuelve siempre un objeto { ok, motivo?, ... }. Si no hay sesión, no hay
// red o la función tarda demasiado, responde { ok:false, motivo:'red' | 'tiempo' } y la página sigue
// con el flujo manual de siempre (nunca se queda colgada).
async function llamarIntegracion(accion, datos, esperaMs) {
    let temporizador;
    try {
        const espera = new Promise(resolve => { temporizador = setTimeout(() => resolve({ tiempo: true }), esperaMs || 20000); });
        const r = await Promise.race([
            supabaseClient.functions.invoke('integracion', { body: Object.assign({ accion: accion }, datos) }),
            espera
        ]);
        if (r.tiempo) return { ok: false, motivo: 'tiempo' };
        if (r.data && typeof r.data === 'object' && 'ok' in r.data) return r.data;
        // Errores HTTP (401, 500...): la función casi siempre devuelve igual un JSON con el motivo.
        if (r.error && r.error.context && typeof r.error.context.json === 'function') {
            try {
                const j = await r.error.context.json();
                if (j && typeof j === 'object' && 'ok' in j) return j;
            } catch (e) { /* sin cuerpo legible */ }
        }
        return { ok: false, motivo: 'red' };
    } catch (e) {
        return { ok: false, motivo: 'red' };
    } finally {
        clearTimeout(temporizador);
    }
}

// URL pública de una foto de cuenta (bucket "cuentas" de Supabase Storage).
// La base de datos solo guarda el nombre del archivo, no la URL completa.
function urlFotoCuenta(ruta) {
    return supabaseUrl + '/storage/v1/object/public/cuentas/' + encodeURIComponent(ruta);
}

/**
 * Verifica la sesión REAL de Supabase Auth (no localStorage) y trae el
 * perfil actual del usuario directo de la base de datos.
 *
 * @param {boolean} requerido - true (por defecto): si no hay sesión válida,
 *   redirige a login. false: devuelve null sin redirigir (páginas públicas).
 * @returns {Promise<object|null>} el usuario verificado o null.
 */
async function verificarSesion(requerido = true) {
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (!session) {
        if (requerido) window.location.href = '/login';
        return null;
    }

    const { data: usuario, error } = await supabaseClient
        .from('perfiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

    if (error || !usuario) {
        await supabaseClient.auth.signOut();
        if (requerido) window.location.href = '/login';
        return null;
    }

    usuario.correo = session.user.email;
    pintarNav(usuario);
    return usuario;
}

/** Cierra la sesión de verdad en Supabase y manda a la página de inicio. */
async function cerrarSesionSegura() {
    await supabaseClient.auth.signOut();
    window.location.href = '/';
}

/** Rellena los elementos comunes de la barra de navegación, si existen en la página. */
function pintarNav(usuario) {
    const saldoEls = document.querySelectorAll('[data-nav-saldo]');
    saldoEls.forEach(el => el.textContent = formatearSoles(usuario.saldo));

    const nickEls = document.querySelectorAll('[data-nav-nickname]');
    nickEls.forEach(el => el.textContent = usuario.nickname);

    const avatarEls = document.querySelectorAll('[data-nav-avatar]');
    avatarEls.forEach(el => el.textContent = (usuario.nickname || '?').charAt(0).toUpperCase());

    document.querySelectorAll('[data-nav-invitado]').forEach(el => el.style.display = 'none');
    document.querySelectorAll('[data-nav-conectado]').forEach(el => el.style.display = 'flex');
}

/** Muestra el estado de "invitado" en la nav para páginas públicas sin sesión. */
function pintarNavInvitado() {
    document.querySelectorAll('[data-nav-invitado]').forEach(el => el.style.display = '');
    document.querySelectorAll('[data-nav-conectado]').forEach(el => el.style.display = 'none');
}

// ==========================================
// TEMA CLARO / OSCURO — el sitio arranca siempre en oscuro; el claro es opcional.
// (La clave lleva _v2 para que quien había quedado en claro vuelva a oscuro una vez.)
// ==========================================
const CLAVE_TEMA = 'mzrecargas_tema_v2';

(function aplicarTemaGuardado() {
    try {
        const t = localStorage.getItem(CLAVE_TEMA);
        if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    } catch (e) { /* modo privado: seguimos en oscuro */ }
})();

function alternarTema() {
    const actual = document.documentElement.getAttribute('data-theme') || 'dark';
    const nuevo = actual === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nuevo);
    try { localStorage.setItem(CLAVE_TEMA, nuevo); } catch (e) { /* modo privado: no se guarda para la próxima */ }
}

// ==========================================
// MENÚ DE USUARIO (dropdown de la navbar)
// ==========================================
function alternarMenuUsuario() {
    const menu = document.getElementById('nav-dropdown');
    if (menu) menu.classList.toggle('abierto');
}
document.addEventListener('click', function (e) {
    const menu = document.getElementById('nav-dropdown');
    const btn = document.getElementById('nav-user-btn');
    if (menu && menu.classList.contains('abierto') && !menu.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
        menu.classList.remove('abierto');
    }
});

// ==========================================
// TICKER "COMPRAS EN VIVO" Y ASISTENTE — se inyectan solos en cuanto
// carga la página (no hace falta llamarlos desde cada archivo .html),
// salvo en admin.html o en páginas sin navbar (login, registro, 404).
// ==========================================
document.addEventListener('DOMContentLoaded', function () {
    // El pie de página trae el año escrito a mano (HTML estático); aquí se pone el vigente.
    document.querySelectorAll('[data-anio]').forEach(el => { el.textContent = new Date().getFullYear(); });

    if (document.querySelector('.navbar')) pintarMenuMovil();

    if (/\/admin(\.html)?$/.test(location.pathname)) return;
    if (!document.querySelector('.navbar')) return;
    medirAlturaBarra();
    pintarFondoVideo();
    pintarTickerCompras();
    pintarAsistente();
});

// Guarda el alto real de la barra en --nav-h para que la cinta de compras en
// vivo se pegue justo debajo (el alto cambia con el tamaño de pantalla y con
// el menú del celular abierto).
function medirAlturaBarra() {
    const nav = document.querySelector('.navbar');
    if (!nav) return;
    const poner = () => document.documentElement.style.setProperty('--nav-h', nav.offsetHeight + 'px');
    poner();
    if (window.ResizeObserver) new ResizeObserver(poner).observe(nav, { box: 'border-box' });
    window.addEventListener('resize', poner);
    window.addEventListener('load', poner);
}

// Menú de hamburguesa para mobile — el CSS ya escondía ".nav-links" debajo
// de 860px pero nunca existió el botón para volver a verlos. Se arma solo,
// clonando los links que ya existen en cada página (así no hay que tocar
// el HTML de cada una ni mantener la lista de páginas dos veces).
function pintarMenuMovil() {
    const nav = document.querySelector('.navbar');
    const navLinks = nav.querySelector('.nav-links');
    const navActions = nav.querySelector('.nav-actions');
    if (!navLinks || !navActions) return;

    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'nav-mobile-toggle';
    boton.setAttribute('aria-label', 'Abrir menú');
    boton.innerHTML = '<span class="material-icons">menu</span>';
    navActions.insertBefore(boton, navActions.firstChild);

    const panel = document.createElement('div');
    panel.className = 'nav-mobile-panel';
    panel.innerHTML = navLinks.innerHTML;
    nav.appendChild(panel);

    function cerrarMenuMovil() {
        panel.classList.remove('abierto');
        boton.querySelector('.material-icons').textContent = 'menu';
    }

    boton.addEventListener('click', function () {
        const abierto = panel.classList.toggle('abierto');
        boton.querySelector('.material-icons').textContent = abierto ? 'close' : 'menu';
    });
    panel.querySelectorAll('a').forEach(a => a.addEventListener('click', cerrarMenuMovil));
    document.addEventListener('click', function (e) {
        if (panel.classList.contains('abierto') && !panel.contains(e.target) && e.target !== boton && !boton.contains(e.target)) {
            cerrarMenuMovil();
        }
    });
}

// Mismo video de fondo del inicio, para que estas páginas no se vean
// "frías" al lado de index.html. Si la página ya trae el suyo (index.html
// lo trae hardcodeado), no se duplica. En catalogo.html, cuando se elige
// un catálogo, el fondo específico de esa categoría (mismo z-index, pero
// insertado después en el DOM) queda encima y lo tapa por completo.
function pintarFondoVideo() {
    if (document.querySelector('.site-bg-video')) return;
    document.body.insertAdjacentHTML('afterbegin', `
        <video class="site-bg-video" autoplay muted loop playsinline aria-hidden="true">
            <source src="login-bg.mp4" type="video/mp4">
        </video>
        <div class="site-bg-overlay"></div>
    `);
}

function tiempoRelativo(fechaIso) {
    const segundos = Math.floor((Date.now() - new Date(fechaIso).getTime()) / 1000);
    if (segundos < 60) return 'recién';
    const minutos = Math.floor(segundos / 60);
    if (minutos < 60) return `hace ${minutos} min`;
    const horas = Math.floor(minutos / 60);
    if (horas < 24) return `hace ${horas} h`;
    return `hace ${Math.floor(horas / 24)} d`;
}

async function pintarTickerCompras() {
    const { data, error } = await supabaseClient.rpc('compras_recientes', { p_limite: 10 });
    if (error || !data || data.length === 0) return;

    const items = data.map(c => `
        <span class="ticker-vivo-item">
            <span class="material-icons">bolt</span>
            <strong>${escHtml(c.nickname)}</strong> ${escHtml(c.texto)} · ${tiempoRelativo(c.creado_hace)}
        </span>
    `).join('');

    const html = `
    <div class="ticker-vivo">
        <div class="ticker-vivo-track">
            <span class="ticker-vivo-badge"><span class="material-icons" style="font-size:13px;">flash_on</span> Compras en vivo</span>
            ${items}
            <span class="ticker-vivo-badge"><span class="material-icons" style="font-size:13px;">flash_on</span> Compras en vivo</span>
            ${items}
        </div>
    </div>`;

    document.querySelector('.navbar').insertAdjacentHTML('afterend', html);
}

// ---------- ASISTENTE (respuestas predeterminadas, sin IA real) ----------
const ASISTENTE_FAQ = [
    { patrones: ['cuentas de free', 'cuenta de free', 'comprar cuenta', 'comprar una cuenta', 'venden cuenta', 'cuentas disponibles', 'cuentas free'], respuesta: 'Sí, vendemos cuentas de Free Fire ya armadas. Entra a "Recargar Diamantes" → "Cuentas Free Fire", elige la que te guste y cómprala con tu saldo. Apenas compras te llevamos a WhatsApp para pasarte los datos de acceso.' },
    { patrones: ['recargar', 'recarga', 'saldo', 'yape', 'plin'], respuesta: 'Para recargar saldo entra a "Recargar Diamantes", elige un monto y paga con Yape o Plin. En cuanto verificamos tu pago se acredita tu saldo.' },
    { patrones: ['demora', 'tiempo', 'entrega', 'cuando llega', 'cuánto tarda'], respuesta: 'La entrega es en menos de 5 minutos en promedio después de confirmada tu compra.' },
    { patrones: ['metodo', 'método', 'pago', 'como pago', 'cómo pago'], respuesta: 'Aceptamos Yape y Plin, verificados a mano antes de acreditar tu saldo.' },
    { patrones: ['id', 'jugador', 'equivoqu', 'mal escrit'], respuesta: 'Si te equivocaste de ID, escríbenos por WhatsApp apenas te des cuenta y antes de que se entregue el pedido, para poder corregirlo.' },
    { patrones: ['punto', 'puntos', 'ranking', 'premio'], respuesta: 'Ganas 1 punto por cada sol que recargas o gastas en la tienda. Revisa tu posición en la página de Ranking.' },
    { patrones: ['cuenta', 'registr', 'crear cuenta'], respuesta: 'Sí, necesitas una cuenta gratis — toma un minuto y así guardamos tu saldo y tu historial de pedidos.' },
    { patrones: ['catalogo', 'catálogo', 'diamante', 'fragmento', 'caja', 'token'], respuesta: 'Tenemos 4 catálogos: Recargas Ilimitadas, Promo Primera Vez, Cajas de Tokens y Tokens Evolutivos. Los ves todos en "Recargar Diamantes".' },
    { patrones: ['no llega', 'no recib', 'problema', 'reclamo'], respuesta: 'Si algo no llegó, escríbenos por WhatsApp con tu ID de jugador y el pedido, lo revisamos al toque.' }
];
const ASISTENTE_PREGUNTAS_SUGERIDAS = ['¿Cómo recargo saldo?', '¿Cuánto demora la entrega?', '¿Cómo gano puntos?'];

function pintarAsistente() {
    const html = `
    <button type="button" class="asistente-float" id="asistente-float-btn" aria-label="Abrir asistente" title="¿Tienes dudas? Pregúntame">
        <span class="material-icons">smart_toy</span>
    </button>
    <div class="asistente-panel" id="asistente-panel">
        <div class="asistente-panel-header">
            <div>
                <h4>Asistente MZ'Recargas</h4>
                <p>Respuestas rápidas, al toque</p>
            </div>
            <span class="material-icons" onclick="document.getElementById('asistente-panel').classList.remove('abierto')">close</span>
        </div>
        <div class="asistente-mensajes" id="asistente-mensajes">
            <div class="asistente-msg bot">¡Hola! 👋 Soy el asistente de MZ'Recargas. Elige una pregunta o escribe la tuya.</div>
        </div>
        <div class="asistente-chips" id="asistente-chips"></div>
        <div class="asistente-input-row">
            <input type="text" id="asistente-input" placeholder="Escribe tu pregunta..." onkeydown="if(event.key==='Enter') enviarPreguntaAsistente()">
            <button type="button" onclick="enviarPreguntaAsistente()"><span class="material-icons" style="font-size:18px;">send</span></button>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);

    document.getElementById('asistente-float-btn').addEventListener('click', function () {
        document.getElementById('asistente-panel').classList.toggle('abierto');
    });

    document.getElementById('asistente-chips').innerHTML = ASISTENTE_PREGUNTAS_SUGERIDAS
        .map(p => `<button type="button" class="asistente-chip" onclick="preguntarAsistente('${p.replace(/'/g, "\\'")}')">${escHtml(p)}</button>`)
        .join('');
}

function preguntarAsistente(texto) {
    document.getElementById('asistente-input').value = texto;
    enviarPreguntaAsistente();
}

function enviarPreguntaAsistente() {
    const input = document.getElementById('asistente-input');
    const texto = input.value.trim();
    if (!texto) return;
    input.value = '';

    const cont = document.getElementById('asistente-mensajes');
    cont.insertAdjacentHTML('beforeend', `<div class="asistente-msg usuario">${escHtml(texto)}</div>`);

    const normalizado = texto.toLowerCase();
    const match = ASISTENTE_FAQ.find(f => f.patrones.some(p => normalizado.includes(p)));
    const respuesta = match ? match.respuesta : 'No tengo una respuesta exacta para eso todavía — escríbenos por WhatsApp y te ayudamos directo. 💬';

    cont.insertAdjacentHTML('beforeend', `<div class="asistente-msg bot">${escHtml(respuesta)}</div>`);
    cont.scrollTop = cont.scrollHeight;
}

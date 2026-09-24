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

const supabaseUrl = 'https://bvfllkzcvrdzhkzpkryj.supabase.co';
const supabaseKey = 'sb_publishable_BDJh1MvR9C6YSA7q1Trluw_9Tx2EfGE';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

// Escapa texto antes de insertarlo con innerHTML (nickname, etc.) para que
// no se pueda inyectar HTML/JS con un dato que un usuario haya escrito.
function escHtml(v) { return (v === null || v === undefined) ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function formatearSoles(monto) {
    return 'S/ ' + Number(monto || 0).toFixed(2);
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
        if (requerido) window.location.href = 'login.html';
        return null;
    }

    const { data: usuario, error } = await supabaseClient
        .from('perfiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

    if (error || !usuario) {
        await supabaseClient.auth.signOut();
        if (requerido) window.location.href = 'login.html';
        return null;
    }

    usuario.correo = session.user.email;
    pintarNav(usuario);
    return usuario;
}

/** Cierra la sesión de verdad en Supabase y manda a la página de inicio. */
async function cerrarSesionSegura() {
    await supabaseClient.auth.signOut();
    window.location.href = 'index.html';
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
// TEMA CLARO / OSCURO
// ==========================================
const CLAVE_TEMA = 'mzrecargas_tema';

(function aplicarTemaGuardado() {
    try {
        const t = localStorage.getItem(CLAVE_TEMA);
        if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    } catch (e) { /* modo privado: seguimos con el tema automático del sistema */ }
})();

function alternarTema() {
    const actual = document.documentElement.getAttribute('data-theme') ||
        (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
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
    if (location.pathname.endsWith('admin.html')) return;
    if (!document.querySelector('.navbar')) return;
    pintarTickerCompras();
    pintarAsistente();
});

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

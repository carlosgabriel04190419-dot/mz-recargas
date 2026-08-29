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

// TODO: reemplaza estos dos valores por los de Settings → API del
// proyecto de Supabase de MZ'Recargas (Project URL y clave anon/publishable).
const supabaseUrl = 'TODO_SUPABASE_URL';
const supabaseKey = 'TODO_SUPABASE_ANON_KEY';
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

# MZ'Recargas

Tienda web de recargas de diamantes de Free Fire, con cuentas de usuario reales
(login/registro), saldo precargado e historial de pedidos — inspirada en
[skrecargasff.com](https://skrecargasff.com/), separada por completo del
proyecto CarzaD'Cross (repositorio y proyecto de Supabase distintos, sin
compartir usuarios ni datos).

## Stack

- **Frontend**: HTML + CSS + JavaScript sin build (igual que CarzaD'Cross), pensado para publicarse con **GitHub Pages**.
- **Backend**: [Supabase](https://supabase.com) — Auth (registro/login/recuperar contraseña) + Postgres (perfiles, catálogo, pedidos) con Row Level Security.

## Cómo está armado

- `sesion.js` — módulo compartido: crea el cliente de Supabase, verifica la sesión real en cada página, pinta el saldo/nickname en la barra de navegación y maneja el tema claro/oscuro.
- `supabase/schema.sql` — todo el esquema de base de datos (tablas, políticas RLS, triggers). Se pega **una sola vez** en el SQL Editor de Supabase.
- `style.css` — identidad visual propia de MZ'Recargas (paleta ámbar/rojo tipo "fuego"), sin nada reutilizado del diseño de CarzaD'Cross.

### Cómo funciona el saldo y los pedidos

1. El usuario recarga saldo (elige Yape o Plin) desde `catalogo.html` → queda un pedido `pendiente` y se abre WhatsApp con un mensaje ya armado para que te mande el monto y su captura de pago.
2. **Tú confirmas el pago a mano** en el Table Editor de Supabase (tabla `pedidos`, cambias `estado` a `confirmado`) — un trigger acredita el saldo automáticamente.
3. El usuario compra un paquete de diamantes con su saldo (desde el catálogo "Recargas Ilimitadas" o "Promo Primera Vez", según elija) → se descuenta al instante, el pedido queda `confirmado` (pagado), y también se abre WhatsApp avisándote qué paquete compró y su ID de Free Fire, a la espera de que entregues los diamantes en el juego.
4. Cuando ya entregaste los diamantes, marcas ese pedido como `completado` en el Table Editor.

No hay panel de administración todavía — la tabla de Supabase hace ese papel por ahora. Es un buen próximo paso si el volumen de pedidos crece.

## Puesta en marcha (una sola vez)

1. ✅ **Base de datos**: ya aplicado — `supabase/schema.sql` está corrido en el proyecto de Supabase de MZ'Recargas (tablas, RLS y triggers listos, con revisión de seguridad hecha con el Advisor de Supabase).
2. ✅ **Conectar el sitio a Supabase**: `sesion.js` ya tiene la Project URL y la clave publishable reales del proyecto.
3. **Configurar Auth** (pendiente, hazlo tú): en Supabase, Authentication → URL Configuration, agrega la URL donde publiques el sitio (la de GitHub Pages o tu dominio) en "Site URL" y "Redirect URLs" — si no, el enlace de "recuperar contraseña" no va a funcionar.
4. **Publicar con GitHub Pages**: en este repositorio, Settings → Pages → Source: "Deploy from a branch" → rama `main`, carpeta `/ (root)`.

## Pendiente antes de lanzarlo a clientes reales

- [x] **Datos de pago reales** — en `recargar-saldo.html`. Yape: 901 150 296, a nombre de "Raul Mu*" (apellido oculto a propósito, para que no lo usen en estafas). Plin: QR en `qr-plin.jpeg`.
- [x] **Número de WhatsApp real** — `wa.me/51901150296` en todas las páginas.
- [x] **Precios reales de los paquetes** — tabla `paquetes_ff` en Supabase, con dos catálogos (`categoria`: `ilimitada` / `promo`), mismos 6 tamaños de diamantes y precios distintos cada uno.
- [x] **Logo** — ícono de diamante propio (`logo.svg`) en navbar y favicon.
- [ ] **Dominio propio** (opcional) — si el cliente compra uno, agrega un archivo `CNAME` con el dominio y configúralo en el registrador (igual que se hizo con CarzaD'Cross).
- [ ] **Términos y Privacidad** (`terminos.html`, `privacidad.html`) — son una plantilla genérica marcada como tal en la propia página, conviene que las revise alguien con criterio legal antes de operar con pagos reales.
- [ ] **Anti-bots / captcha** en login y registro — no se incluyó en esta primera versión (CarzaD'Cross usa Cloudflare Turnstile, que requiere una cuenta de Cloudflare propia para este dominio). Se puede agregar después si empieza a haber spam de registros.

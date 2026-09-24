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
2. **Confirmas el pago** desde `admin.html` (pestaña Pedidos → "Confirmar pago") — un trigger acredita el saldo automáticamente.
3. El usuario compra un paquete con su saldo (desde cualquiera de los catálogos: "Recargas Ilimitadas", "Promo Primera Vez", "Cajas de Tokens" o "Tokens Evolutivos") → se descuenta al instante, el pedido queda `confirmado` (pagado), y también se abre WhatsApp avisándote qué paquete compró y su ID de Free Fire, a la espera de que entregues lo comprado en el juego.
4. Cuando ya entregaste los diamantes, lo marcas como `completado` desde `admin.html` ("Marcar entregado").

### Panel de administración (`admin.html`)

Solo lo puede abrir la cuenta marcada como admin (columna `es_admin` en `perfiles`; por ahora es la cuenta `mzrecargaspro@gmail.com`) — cualquier otra cuenta que entre a esa URL rebota a `index.html`. Tiene cuatro pestañas:
- **Resumen**: recargas pendientes, compras pagadas por entregar, usuarios registrados y saldo total en el sistema.
- **Pedidos**: todos los pedidos de todos los usuarios, con filtro por estado y botones para confirmar pago / marcar entregado / cancelar.
- **Paquetes**: editar precio, cantidad, destacado y activo/inactivo de cualquier paquete de los 4 catálogos, o crear uno nuevo — se refleja al instante en la web.
- **Usuarios**: nickname, correo, WhatsApp, saldo y fecha de registro de cada cuenta registrada.

Toda la lógica vive en funciones de Postgres (`admin_listar_pedidos`, `admin_actualizar_pedido`, `admin_listar_paquetes`, `admin_guardar_paquete`, `admin_listar_usuarios`, `admin_estadisticas`, `admin_obtener_promo`, `admin_guardar_promo`) que revisan `es_admin_actual()` antes de hacer nada — aunque alguien intente llamarlas directo a la API sin ser admin, las rechaza.

Para dar acceso de admin a otra cuenta más adelante: `update public.perfiles set es_admin = true where id = '<uuid de la cuenta>';` en el SQL Editor de Supabase.

### Ver el correo de un usuario

Ya no hace falta ir a Supabase: la pestaña **Usuarios** de `admin.html` lo muestra directo. (También sigue disponible en el panel de Supabase, en Authentication → Users o en la vista `perfiles_admin` del Table Editor, por si acaso.)

### Puntos, ranking, compras en vivo, promo del día y asistente

Ideas tomadas de CarzaD'Cross pero con estilo propio (nada de morado ni de sus textos):
- **Puntos**: cada usuario gana 1 punto por cada sol que recarga o gasta (columna `puntos` en `perfiles`, se suma sola en los mismos triggers que ya movían el saldo). Se ve en `perfil.html`.
- **Ranking** (`ranking.html`): página pública (no hace falta iniciar sesión) con podio top 3 y tabla de los que más puntos tienen, vía `obtener_ranking()`. Enlazada desde el pie de página y desde el perfil.
- **Compras en vivo**: franja debajo del navbar en todas las páginas (menos `admin.html`) con las últimas compras/recargas reales, nickname parcialmente oculto (`ad***`). Se inyecta sola desde `sesion.js`, vía `compras_recientes()` — si no hay compras todavía, simplemente no aparece.
- **Promo del día**: oferta con precio especial sobre un paquete de diamantes ya existente ("Recargas Ilimitadas" o "Promo Primera Vez"). La configuras tú desde `admin.html` → pestaña "Promo del día" (eliges el paquete, el precio y si está activa). Mientras esté activa, aparece como banner + popup (una vez al día por navegador) en ese catálogo — comprarla no crea un paquete nuevo, solo cobra el precio especial sobre el paquete real.
- **Asistente**: burbuja de chat flotante en todas las páginas (menos `admin.html`), con preguntas sugeridas y respuestas predeterminadas (no es IA de verdad, es un diccionario de palabras clave en `sesion.js` — `ASISTENTE_FAQ`) para no depender de ninguna API externa ni tener costo por uso. Si no reconoce la pregunta, invita a escribir por WhatsApp.

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
- [x] **Paquetes y precios de "Tokens Evolutivos"** — 8 niveles (200 a 900 Fragmentos), precios propios de MZ'Recargas inspirados en un sitio de referencia que mandó el cliente.
- [x] **Paquetes y precios de "Cajas de Tokens"** — 6 niveles (50 a 300 Cajas Evolutivas), precios propios de MZ'Recargas. También tiene un campo de "cantidad exacta" (S/ 0.48 por unidad, mínimo 20) para pedidos fuera de esos niveles fijos.
- [ ] **Dominio propio** (opcional) — si el cliente compra uno, agrega un archivo `CNAME` con el dominio y configúralo en el registrador (igual que se hizo con CarzaD'Cross).
- [ ] **Términos y Privacidad** (`terminos.html`, `privacidad.html`) — son una plantilla genérica marcada como tal en la propia página, conviene que las revise alguien con criterio legal antes de operar con pagos reales.
- [ ] **Anti-bots / captcha** en login y registro — no se incluyó en esta primera versión (CarzaD'Cross usa Cloudflare Turnstile, que requiere una cuenta de Cloudflare propia para este dominio). Se puede agregar después si empieza a haber spam de registros.
- [x] **Panel de administración** — `admin.html`, ver sección de arriba.

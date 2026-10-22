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

- `sesion.js` — módulo compartido: crea el cliente de Supabase, verifica la sesión real en cada página, pinta el saldo/nickname en la barra de navegación y maneja el tema (arranca siempre en oscuro; el claro es opcional con el botón de la barra).
- `supabase/schema.sql` — todo el esquema de base de datos (tablas, políticas RLS, triggers). Se pega **una sola vez** en el SQL Editor de Supabase.
- `style.css` — identidad visual propia de MZ'Recargas (paleta ámbar/rojo tipo "fuego"), sin nada reutilizado del diseño de CarzaD'Cross.

### Cómo funciona el saldo y los pedidos

1. El usuario recarga saldo (elige Yape o Plin) desde `catalogo.html` → queda un pedido `pendiente` y se abre WhatsApp con un mensaje ya armado para que te mande el monto y su captura de pago.
2. **Confirmas el pago** desde `admin.html` (pestaña Pedidos → "Confirmar pago") — un trigger acredita el saldo automáticamente.
3. El usuario compra un paquete con su saldo (desde cualquiera de los catálogos: "Recargas Ilimitadas", "Promo Primera Vez", "Cajas de Tokens" o "Tokens Evolutivos") → se descuenta al instante, el pedido queda `confirmado` (pagado), y también se abre WhatsApp avisándote qué paquete compró y su ID de Free Fire, a la espera de que entregues lo comprado en el juego.
4. Cuando ya entregaste los diamantes, lo marcas como `completado` desde `admin.html` ("Marcar entregado").
5. Si cancelas una compra que ya estaba cobrada (`confirmado`, aún sin entregar), el sistema le **devuelve el saldo** al cliente y le quita los puntos de esa compra. Un pedido `completado` o `cancelado` ya no se puede reabrir ni cambiar (así no se puede acreditar ni devolver dos veces).

**Los precios los valida el servidor**: aunque alguien manipule el navegador, la base de datos solo acepta una compra si el monto coincide con el precio real del paquete (o con el precio de la promo del día si está activa), o con S/ 0.48 × cantidad en las cajas de cantidad exacta. Si cambias un precio mientras un cliente tiene la página abierta, a ese cliente le sale un aviso y se actualiza la lista sola.

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

### Programa de referidos

Cada cuenta tiene un código corto propio (`perfiles.codigo_referido`, se genera solo al registrarse). En `perfil.html` hay una tarjeta "Invita y gana" con el link listo para copiar y compartir (`register.html?ref=CODIGO`). Si alguien se registra con ese link, queda guardado quién lo invitó (`perfiles.referido_por`), y la PRIMERA vez que esa persona tiene un pago de verdad (recarga confirmada o compra), tanto el invitado como quien invitó ganan 20 puntos cada uno — no se premia solo por registrarse, para que no se pueda inflar con cuentas falsas. La lógica vive en `otorgar_bono_referido()`, enganchada a los mismos triggers que ya movían el saldo y los puntos.

### Catálogo de cuentas de Free Fire

Quinto catálogo ("Cuentas Free Fire", banner `banner-cuentas.jpg`) para vender cuentas ya armadas. Se maneja desde `admin.html` → pestaña **Cuentas**: creas una cuenta con título, características (una por línea, salen con ✓ en la tarjeta), precio y estado (Disponible / Agotada); puedes editarla, marcarla agotada/disponible a mano o eliminarla (solo si nunca se vendió).

Cuando un cliente le da "Comprar", pasa todo en una sola operación (`comprar_cuenta()`): se descuenta el precio de su saldo, se crea un pedido `compra_cuenta` ya confirmado, la cuenta queda **Agotada** al instante (si dos personas compran a la vez, a la segunda le dice que ya no está disponible) y se abre WhatsApp con un mensaje armado ("Compré la cuenta X por S/ Y, pedido #...") para que le pases los datos de acceso. El pedido te aparece en la pestaña Pedidos como "Cuenta"; cuando ya le entregaste los datos, le das "Marcar entregado". El precio siempre sale de la base de datos, no del navegador.

Los datos de acceso de cada cuenta **no** se guardan en la web: se los pasas tú por WhatsApp.

**Fotos:** al crear o editar una cuenta puedes subir hasta 8 fotos (la primera es la portada; con la estrella eliges otra). Se reducen solas en el navegador (máx. 1600 px, WebP) y se suben a Supabase Storage (bucket público `cuentas`: cualquiera ve las fotos, solo el admin sube o borra). Las fotos nuevas recién se suben al darle "Guardar", y al quitar una foto o eliminar la cuenta también se borra del Storage. En el catálogo la tarjeta muestra la portada; al tocarla se abre el detalle con galería y un visor a pantalla completa (flechas, teclado y deslizar con el dedo). En la base de datos solo se guarda el nombre de cada archivo (`cuentas_ff.fotos`). No subas capturas que muestren contraseñas o datos de acceso.

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
- [ ] **Dominio propio e indexación en Google** (opcional) — ver la sección "Salir con dominio propio y aparecer en Google" más abajo; ya está todo preparado, es un solo comando.
- [~] **Términos y Privacidad** (`terminos.html`, `privacidad.html`) — reescritos (5 de octubre de 2026) para describir lo que el sitio hace de verdad y conforme a la Ley 29733 de Protección de Datos Personales y la normativa de consumo del Perú. **No son asesoría legal**: antes de operar a escala conviene que los revise un abogado peruano. Lo que falta, y que el texto no puede resolver solo:
  - **Libro de Reclamaciones virtual**: obligatorio para tiendas en línea que venden a consumidores en Perú (con enlace visible en el sitio). Aún no existe en la web.
  - **Identificar al titular del negocio** (nombre o razón social, RUC/DNI y domicilio). Hoy el sitio solo se presenta con el nombre comercial.
  - **Registro del banco de datos personales** ante la Autoridad Nacional de Protección de Datos Personales (trámite gratuito en línea).
  - Las cuentas ya registradas antes del 5/10/2026 no tienen constancia de consentimiento (`perfiles.acepto_terminos_at` es `null` para ellas).
  - Vender cuentas de Free Fire va contra los términos de Garena; los Términos de MZ'Recargas advierten ese riesgo al comprador.
  - Si cambias el fondo de los textos legales, sube `VERSION_LEGAL` en `register.html` para que quede registrado qué versión aceptó cada persona.
- [ ] **Anti-bots / captcha** en login y registro — no se incluyó en esta primera versión (CarzaD'Cross usa Cloudflare Turnstile, que requiere una cuenta de Cloudflare propia para este dominio). Se puede agregar después si empieza a haber spam de registros.
- [x] **Panel de administración** — `admin.html`, ver sección de arriba.

## Pie de página (una sola fuente)

El pie de página vive en `scripts/footer.html` y se copia, como HTML estático, a las 9 páginas que lo llevan (`index`, `catalogo`, `soporte`, `ranking`, `historial`, `perfil`, `recargar-saldo`, `terminos`, `privacidad`). **Para cambiarlo** (por ejemplo, agregar el enlace al Libro de Reclamaciones o las redes sociales) edita `scripts/footer.html` y corre:

```
python3 scripts/sincronizar-footer.py
```

No lo edites a mano en cada página: el script lo vuelve a pisar. Es HTML normal (no JavaScript), así que los buscadores ven sus enlaces legales; el año se actualiza solo.

## Salir con dominio propio y aparecer en Google

Qué ya está listo en el sitio:
- `robots.txt` y `sitemap.xml` (con las páginas que conviene indexar: inicio, el catálogo y cada uno de sus 5 catálogos, soporte, términos y privacidad).
- `<link rel="canonical">`, título, descripción y vista previa al compartir (Open Graph) en cada página pública, y datos estructurados (Organization y WebSite) en el inicio.
- Páginas privadas con `noindex` (admin, pedidos, perfil, recargar saldo, login, registro, nueva contraseña). `ranking.html` también va con `noindex` porque muestra nicknames de clientes.
- **El catálogo es público**: cualquiera ve los catálogos, paquetes, precios y cuentas sin iniciar sesión; el inicio de sesión se pide recién al darle "Comprar" (y después de entrar vuelve al mismo catálogo, con `?volver=`). Cada catálogo cambia su título, descripción y `canonical` solo (`SEO_CATALOGO` en `catalogo.html`).

Cuando tengas el dominio:
1. `python3 scripts/configurar-dominio.py https://www.tudominio.com` (agrega `--prueba` para ver qué cambiaría sin escribir nada). Cambia la dirección en canonical, og:url, og:image, datos estructurados, sitemap y robots, y crea el archivo `CNAME`.
2. En GitHub: Settings → Pages → Custom domain (el mismo dominio) y activa "Enforce HTTPS". En el registrador del dominio, apunta el DNS a GitHub Pages.
3. En Supabase: Authentication → URL Configuration → pon la nueva dirección en "Site URL" y en "Redirect URLs" (si no, fallan la confirmación de correo y "olvidé mi contraseña").
4. En [Google Search Console](https://search.google.com/search-console) agrega el sitio (verificación por DNS) y envía `https://www.tudominio.com/sitemap.xml`. Haz lo mismo en Bing Webmaster Tools si quieres.
5. Sube los cambios (`git push`).

Los paquetes y precios se cargan con JavaScript desde Supabase (Google los ve, pero tarda un poco más en procesarlos que el HTML fijo). Para saber cómo te ve Google, usa "Inspección de URL" en Search Console.


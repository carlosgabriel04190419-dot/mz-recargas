# MZ'Recargas

Tienda web de recargas de diamantes de Free Fire, con cuentas de usuario reales (login y registro), saldo precargado e historial de pedidos.

> 👋 **¿Eres el dueño y no programas?** Empieza por la [**Guía para el dueño**](GUIA-DEL-DUENO.md): te explica, paso a paso y sin palabras raras, cómo ver el código, cómo ver la tienda en tu computadora y cómo cambiar algo y publicarlo.
>
> Esta página (el README) explica **cómo funciona todo** por dentro.

## Contenido

- [La tienda en 2 minutos](#la-tienda-en-2-minutos)
- [Las piezas: qué es cada cosa y dónde vive](#las-piezas-qué-es-cada-cosa-y-dónde-vive)
- [Qué se cambia desde el panel (sin tocar código)](#qué-se-cambia-desde-el-panel-sin-tocar-código)
- [Qué se cambia en el código](#qué-se-cambia-en-el-código)
- [Mapa de archivos](#mapa-de-archivos)
- [Qué hay que renovar o vigilar](#qué-hay-que-renovar-o-vigilar)
- [Reglas de oro](#reglas-de-oro)
- [Referencia técnica (para quien programa)](#referencia-técnica-para-quien-programa)

## La tienda en 2 minutos

**Lo que hace un cliente:**
1. **Crea su cuenta** con su correo y su WhatsApp (el WhatsApp es obligatorio).
2. **Recarga saldo:** elige el monto, paga con Yape o Plin escaneando el QR y pulsa *Ya pagué*. Se abre WhatsApp con un mensaje listo para mandar la captura del pago.
3. **Tú confirmas el pago** en el panel y el saldo aparece en su cuenta al instante. Con un clic le avisas por WhatsApp que ya está listo.
4. **Compra diamantes con su saldo:** escribe su ID de Free Fire (la tienda le muestra su nickname para que confirme que es su cuenta), elige el paquete y compra. Si el paquete tiene **entrega automática**, los diamantes llegan solos en segundos. Si no, tú los entregas y marcas el pedido como *Entregado*.

También se venden **cuentas de Free Fire**, y hay promo del día, puntos, ranking y programa de referidos.

**Lo que haces tú:** entras a `mzrecargas.com/admin` con tu cuenta de administrador. Ahí confirmas pagos, entregas pedidos, corriges saldos, cambias precios y datos de pago, y ves cómo va el negocio. **Nada de eso requiere tocar código.**

## Las piezas: qué es cada cosa y dónde vive

```
 Cliente (celular o computadora)
      │  abre mzrecargas.com
      ▼
 GitHub Pages ─── publica las páginas (los archivos de este repositorio)
      │  desde el navegador, la página habla con...
      ▼
 Supabase ─── usuarios y contraseñas · saldos · pedidos · precios · datos de pago
      │
      └── Función "integracion" ──► Proveedor de recargas ──► diamantes en Free Fire
```

| Pieza | Qué es | Dónde se maneja |
|---|---|---|
| **Las páginas de la web** | Los archivos de este repositorio (HTML, CSS y JavaScript). Es lo que ve el cliente. | GitHub. Lo que se guarda en la rama `main` se publica solo (GitHub Pages). |
| **La base de datos y las cuentas** | Usuarios, contraseñas, saldos, pedidos, precios y medios de pago. **No están en el código.** | Supabase (supabase.com), proyecto de MZ'Recargas. |
| **La función de entrega automática** | Un programa pequeño que corre en Supabase y habla con el proveedor sin mostrar la llave. | `supabase/functions/integracion/` (el código) y Supabase → Edge Functions (donde corre). |
| **El proveedor de recargas** | Un servicio externo que entrega los diamantes. Se paga aparte (saldo en USDT) y su acceso vence cada cierto tiempo. | Panel → *Integraciones*. |
| **El dominio** | `mzrecargas.com` | Donde se compró el dominio. Apunta a GitHub Pages (archivo `CNAME`). |
| **WhatsApp** | Soporte y avisos a los clientes. Es manual: el panel deja el mensaje listo y tú le das enviar. | Número de contacto escrito en las páginas. |

## Qué se cambia desde el panel (sin tocar código)

Entra a `mzrecargas.com/admin`:

| Quiero… | Panel → sección |
|---|---|
| Confirmar que un cliente pagó su recarga | **Solicitudes** |
| Ver los pedidos por entregar, marcarlos como entregados o cancelarlos | **Pedidos** |
| Ver todo lo que pasó en la tienda | **Historial** |
| Poner o quitar saldo a un cliente (por ejemplo si se aceptó una recarga por error) | **Usuarios → Ajustar saldo** |
| Ver el correo y el WhatsApp de un cliente | **Usuarios** (el WhatsApp también sale en cada pedido) |
| Cambiar el precio o el nombre de un paquete, destacarlo, ocultarlo o marcarlo agotado | **Paquetes** |
| Ocultar un catálogo, ponerlo en mantenimiento o sin stock | **Catálogo** |
| Cambiar el nombre, el número o el QR de Yape o Plin | **Medios de pago** |
| Poner una oferta con precio especial por el día | **Promo del día** |
| Vender cuentas de Free Fire | **Cuentas** |
| Ver cuánto se vendió | **Resumen** y **Ventas** |
| Revisar la entrega automática, el saldo del proveedor y cuándo vence su acceso | **Integraciones** |

## Qué se cambia en el código

Esto sí se hace editando archivos (ver la [Guía para el dueño](GUIA-DEL-DUENO.md)):

| Quiero cambiar… | Dónde está |
|---|---|
| Los textos de la página de inicio | `index.html` |
| Las preguntas frecuentes | `index.html` y `soporte.html` (están en las dos) |
| Los Términos y la Política de privacidad | `terminos.html` y `privacidad.html`. Si cambias el fondo de esos textos, sube `VERSION_LEGAL` en `register.html`. |
| Los colores de la tienda | `style.css` (los colores principales están al comienzo, en `:root`) |
| El logo y el ícono | `logo.svg` y `favicon.svg` (reemplázalos con el mismo nombre) |
| Las imágenes de los catálogos | `banner-*.jpg` y `banner-promo.jpeg` (reemplázalas con el mismo nombre) |
| El **WhatsApp de contacto** (botón flotante, pie de página…) | Está escrito en unos 12 archivos. Usa "buscar y reemplazar en todo el proyecto" de Visual Studio Code con `51901150296` y `901 150 296`. **No** cambies `README.md` ni `supabase/schema.sql`. Los datos de Yape y Plin se cambian en el panel, no aquí. |
| Los enlaces del pie de página o las redes | `scripts/footer.html` y luego `python3 scripts/sincronizar-footer.py` |
| Las respuestas del asistente (la burbuja de chat) | `ASISTENTE_FAQ` en `sesion.js` |
| Los montos rápidos de recarga (10, 20, 50…) | `recargar-saldo.html` |
| El mensaje de WhatsApp que se arma al comprar o recargar | `catalogo.html` y `recargar-saldo.html` (busca `Vengo de MZ'Recargas`) |
| Los correos de "confirmar cuenta" y "recuperar contraseña" | `supabase/plantillas-correo/` y se pegan en Supabase → Authentication → Emails → Templates |

## Mapa de archivos

| Archivo | Qué es |
|---|---|
| `index.html` | Página de inicio. |
| `catalogo.html` | Catálogos y compra de paquetes y cuentas. |
| `recargar-saldo.html` + `recargar.css` | Asistente de 3 pasos para recargar saldo, y sus estilos. |
| `historial.html` | "Mis pedidos" del cliente. |
| `perfil.html` | Perfil del cliente: nickname, WhatsApp, contraseña, puntos y su enlace de referidos. |
| `login.html`, `register.html`, `restablecer-contrasena.html` | Entrar, crear cuenta y recuperar la contraseña. |
| `ranking.html` | Ranking público de puntos. |
| `soporte.html` | Ayuda y preguntas frecuentes. |
| `terminos.html`, `privacidad.html` | Textos legales. |
| `404.html` | Página "no encontrada". |
| `admin.html` + `admin.css` | Panel de administración. |
| `style.css` | Estilos generales de toda la tienda. |
| `sesion.js` | Código compartido por todas las páginas: conexión con Supabase, sesión, saldo en la barra, tema oscuro/claro, asistente, "compras en vivo" y la ventana que pide el WhatsApp. |
| `logo.svg`, `favicon.svg`, `banner-*`, `login-bg.mp4` | Logo, ícono, imágenes de los catálogos y video de fondo. |
| `qr-yape.jpeg`, `qr-plin.jpeg` | Los QR de siempre. Los nuevos que suba el dueño desde el panel se guardan en Supabase. |
| `robots.txt`, `sitemap.xml` | Le dicen a Google qué páginas mostrar. |
| `CNAME` | Le dice a GitHub que la web se llama `mzrecargas.com`. **No lo borres.** |
| `.nojekyll`, `.gitignore` | Archivos técnicos. No se tocan. |
| `scripts/` | Ayudas: abrir la tienda en tu computadora, subir el número de versión, sincronizar el pie de página y cambiar de dominio. |
| `supabase/schema.sql` | La descripción completa de la base de datos: tablas, reglas y funciones. Sirve de documentación y para reconstruirla si hiciera falta. |
| `supabase/functions/integracion/` | La función de entrega automática y de consulta de nickname (habla con el proveedor). |
| `supabase/plantillas-correo/` | El diseño de los correos que manda Supabase. |

## Qué hay que renovar o vigilar

- **El acceso a la API del proveedor** vence cada cierto tiempo. El panel (*Integraciones* y *Resumen*) lo avisa. Al renovar no cambia la llave: solo pulsa *Probar conexión*.
- **El saldo en el proveedor:** si llega a cero, las entregas automáticas fallan y quedan para reintentar. El panel lo avisa.
- **El dominio `mzrecargas.com`:** se renueva donde lo compraste (normalmente cada año).
- **Supabase:** revisa de vez en cuando que el proyecto esté activo y dentro de los límites de su plan.
- **Lo pendiente del día:** el *Resumen* del panel muestra cuántas solicitudes y pedidos esperan atención.

## Reglas de oro

1. **Lo que se guarda en `main` se publica solo**, en 1 o 2 minutos. No hay borrador: cambia una cosa a la vez y revisa.
2. **Los datos no están en el código.** Usuarios, saldos y pedidos viven en Supabase. Un error en el código puede hacer que la tienda se vea mal, pero no borra datos, y todo cambio en el código se puede deshacer.
3. **Abrir la tienda en tu computadora usa la base de datos real.** Una compra o un cambio hecho desde ahí es de verdad.
4. **Este repositorio es público**: cualquiera puede leer el código. Por eso aquí nunca se guardan llaves ni contraseñas (están en Supabase → Secrets).
5. **Los precios se cambian en el panel.** El servidor revisa cada compra contra el precio real, así que cambiar un número en el código no cambia lo que se cobra.
6. **Si dudas, pregunta antes de tocar.**

---

# Referencia técnica (para quien programa)

## Stack

- **Frontend**: HTML + CSS + JavaScript sin build, pensado para publicarse con **GitHub Pages**.
- **Backend**: [Supabase](https://supabase.com) — Auth (registro/login/recuperar contraseña) + Postgres (perfiles, catálogo, pedidos) con Row Level Security.

## Cómo está armado

- `sesion.js` — módulo compartido: crea el cliente de Supabase, verifica la sesión real en cada página, pinta el saldo/nickname en la barra de navegación y maneja el tema (arranca siempre en oscuro; el claro es opcional con el botón de la barra).
- `supabase/schema.sql` — todo el esquema de base de datos (tablas, políticas RLS, triggers). Se pega **una sola vez** en el SQL Editor de Supabase.
- `scripts/` — ayudas para quien edita: `servidor-local.py` (abrir la tienda en tu computadora; con doble clic: `abrir-en-mac.command` / `abrir-en-windows.bat`), `actualizar-version.py` (subir el número de versión antes de publicar estilos), `sincronizar-footer.py` + `footer.html` (pie de página) y `configurar-dominio.py` (cambiar de dominio).
- `supabase/plantillas-correo/` — el diseño de los correos que manda Supabase (confirmar cuenta y restablecer contraseña).
- `style.css` — identidad visual propia de MZ'Recargas (paleta ámbar/rojo tipo "fuego").

### Cómo funciona el saldo y los pedidos

1. El usuario recarga saldo desde `recargar-saldo.html`, un asistente de 3 pasos (monto → método → pago). En el último paso ve el QR, el titular y el número del método que eligió (si no hay foto de QR, solo el número), botones para copiar el monto y el número y para descargar el QR, y un campo opcional con el código de seguridad de 3 dígitos de Yape. Al darle "Ya pagué" queda un pedido `pendiente` y se abre WhatsApp con un mensaje ya armado (monto, método, usuario y ese código) para que mande su captura. Al lado ve el resumen (saldo ahora y después) y sus últimas recargas con su estado. El nombre, el número y la foto del QR de cada método los cambia el dueño cuando quiera desde el panel → **Medios de pago** (tabla `medios_pago`): la página los lee justo antes de mostrar el pago, así que un cambio se ve al instante y nadie paga a un dato viejo. Si un método está oculto o no tiene ni número ni QR, no se ofrece.
2. **Confirmas el pago** desde `admin.html` (pestaña Pedidos → "Confirmar pago") — un trigger acredita el saldo automáticamente.
3. El usuario compra un paquete con su saldo (desde cualquiera de los catálogos: "Recargas Ilimitadas", "Promo Primera Vez", "Cajas de Tokens" o "Tokens Evolutivos") → se descuenta al instante, el pedido queda `confirmado` (pagado), y también se abre WhatsApp avisándote qué paquete compró y su ID de Free Fire, a la espera de que entregues lo comprado en el juego.
4. Cuando ya entregaste los diamantes, lo marcas como `completado` desde `admin.html` ("Marcar entregado"). (Si conectas un proveedor de recargas, los paquetes con código lo hacen solos: ver "Integración con el proveedor de recargas" más abajo.)
5. **El WhatsApp del cliente es obligatorio** (Perú: 9 dígitos que empiezan con 9; se acepta con espacios, guiones o prefijo 51/+51). Se pide al crear la cuenta (`register.html`), no se puede dejar vacío en `perfil.html`, y a quien ya tenía cuenta sin número el sitio se lo pide en una ventana antes de recargar (`recargar-saldo.html`) o de comprar (`catalogo.html`) — es la función `exigirWhatsapp()` de `sesion.js`; los admin quedan fuera. La base lo refuerza: `normalizar_celular()` valida y ordena el número, `actualizar_mi_perfil()` no acepta uno inválido y el trigger `exigir_whatsapp_en_pedidos` no deja crear recargas ni compras a un cliente sin número.
6. **Aviso al cliente por WhatsApp**: en Solicitudes, al pulsar *Confirmar pago* se abre una ventana "¡Recarga acreditada!" con el mensaje ya escrito y un botón que abre el chat con el cliente (`wa.me/51<número>`): solo falta darle enviar. También hay un botón *Avisar por WhatsApp* en las recargas ya acreditadas (Historial) y el número de cada cliente aparece en sus tarjetas, para comparar con el chat de donde llegó su captura. Es un clic, no un envío automático: mandar mensajes solo desde el sistema requiere la API de WhatsApp Business (cuenta verificada de Meta, plantillas aprobadas y costo por mensaje).
7. Si cancelas una compra que ya estaba cobrada (`confirmado`, aún sin entregar), el sistema le **devuelve el saldo** al cliente y le quita los puntos de esa compra. Un pedido `completado` o `cancelado` ya no se puede reabrir ni cambiar (así no se puede acreditar ni devolver dos veces).

**La pantalla de compra** (`catalogo.html`, al abrir un catálogo de paquetes) tiene tres partes: arriba una guía de 4 pasos que marca en cuál va la persona (en el celular arranca cerrada), a la izquierda los pasos (1 ID del jugador, 2 paquete) y al costado el recuadro **Tu pedido**, que se queda fijo al bajar en pantalla grande. Ese recuadro muestra el paquete elegido, el jugador, si la entrega es automática o por WhatsApp, el total, el saldo que le quedaría y el botón de comprar (si falta saldo, el botón lleva a *Recargar saldo*; sin sesión, a iniciar sesión). Debajo van los avisos de entrega automática y de soporte. Todo lo dibuja `pintarResumen()`, que se vuelve a llamar cada vez que cambia el ID, el paquete, el catálogo o el saldo.

**Los precios los valida el servidor**: aunque alguien manipule el navegador, la base de datos solo acepta una compra si el monto coincide con el precio real del paquete (o con el precio de la promo del día si está activa), o con S/ 0.48 × cantidad en las cajas de cantidad exacta. Si cambias un precio mientras un cliente tiene la página abierta, a ese cliente le sale un aviso y se actualiza la lista sola.

### Panel de administración (`admin.html`)

Solo lo puede abrir la cuenta marcada como admin (columna `es_admin` en `perfiles`; por ahora es la cuenta `mzrecargaspro@gmail.com`) — cualquier otra cuenta que entre a esa URL rebota a `index.html`. Tiene barra lateral (en el celular se abre con el botón ☰), un buscador de secciones (tecla `/`) y estas secciones:

- **Resumen**: saludo del día, cuántas solicitudes y pedidos están por atender, usuarios, saldo de los clientes, ventas de hoy y del mes, última venta, el estado de cada catálogo y accesos rápidos.
- **Solicitudes**: recargas de saldo pendientes. Confirmas el pago y el saldo se acredita al instante.
- **Pedidos**: compras ya pagadas por entregar (con botón para copiar el ID de jugador). "Marcar entregado" o "Cancelar" (devuelve el saldo).
- **Historial**: todos los pedidos con filtro por estado.
- **Usuarios**: nickname, correo, WhatsApp (con enlace para escribirle), saldo y fecha de registro, con buscador. Cada fila tiene **Ajustar saldo**: se abre una ventana para **poner o quitar saldo a mano** (por ejemplo si aceptaste una recarga por error o diste saldo de más). Pide el monto y un motivo obligatorio (hay atajos como "Recarga aceptada por error"), muestra cómo quedará el saldo antes de guardar, pide confirmar y no deja el saldo por debajo de 0. Opcionalmente también ajusta los puntos del ranking (1 por cada S/ 1) para deshacer del todo una recarga aceptada por error. Cada ajuste queda anotado en la tabla `ajustes_saldo` (quién, cuándo, cuánto, saldo antes y después y motivo) y los últimos se ven en esa misma ventana. Al terminar se ofrece avisarle al cliente por WhatsApp.
- **Catálogo**: tarjeta de cada uno de los 5 catálogos con interruptores **Mostrar en la web**, **En mantenimiento** y **Sin stock**, y un mensaje opcional para el cliente (ver abajo).
- **Paquetes**: precio, cantidad, destacado, orden, y interruptores **Visible** y **Agotado** por paquete.
- **Medios de pago**: aquí el dueño cambia sin ayuda de nadie los datos que ven los clientes al recargar saldo, por separado para Yape y Plin: **nombre**, **número**, **foto del QR** (opcional: sin foto se muestra solo el número) e interruptor **Mostrar en la web**. Nada se guarda solo: al pulsar *Guardar cambios* se le muestra qué va a cambiar (por ejemplo "Número: 901 150 296 → 987 654 321") y recién ahí se aplica. La foto se reduce sola y se sube al bucket público `pagos` de Storage; la anterior se borra. Solo el admin puede escribir (función `admin_guardar_medio_pago`) y solo los clientes con sesión pueden leer la tabla (sin ver quién la editó); queda anotado quién y cuándo hizo el último cambio. Un método no se puede mostrar sin número ni QR.
- **Cuentas**, **Promo del día** y **Ventas** (ventas por día en una gráfica, y qué catálogos venden más).
- **Integraciones**: estado de la conexión con el proveedor de recargas, botón **Probar conexión**, interruptores por juego (mostrar nickname / entregar automático), registro de actividad y la guía para conectarlo. En **Paquetes → Editar** va el código de cada producto en el proveedor. En **Pedidos** cada compra muestra cómo va su entrega automática, con **Reintentar entrega** cuando falló.

Toda la lógica vive en funciones de Postgres (`admin_*`) que revisan `es_admin_actual()` antes de hacer nada — aunque alguien intente llamarlas directo a la API sin ser admin, las rechaza. El estilo del panel está en `admin.css`.

**Stock y mantenimiento (se aplica al instante, y el servidor también lo hace cumplir):**
- *Oculto*: el catálogo desaparece del inicio y de la lista de catálogos.
- *En mantenimiento*: se ve (con su etiqueta y tu mensaje) pero nadie puede comprar.
- *Sin stock*: igual, pero la portada se ve en blanco y negro.
- *Paquete agotado*: sigue a la vista pero con la marca "Agotado" y no se puede elegir. *Paquete no visible*: no aparece.
Si un cliente tiene la página abierta justo cuando lo cambias, al intentar comprar el servidor lo rechaza con un aviso claro. Las recargas de saldo no se afectan.

Para dar acceso de admin a otra cuenta más adelante: `update public.perfiles set es_admin = true where id = '<uuid de la cuenta>';` en el SQL Editor de Supabase.

### Ver el correo de un usuario

Ya no hace falta ir a Supabase: la sección **Usuarios** de `admin.html` lo muestra directo. (También sigue disponible en el panel de Supabase, en Authentication → Users o en la vista `perfiles_admin` del Table Editor, por si acaso.)

### Puntos, ranking, compras en vivo, promo del día y asistente

Funciones que le dan vida a la tienda:
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

### Integración con un proveedor de recargas (nickname por ID y entrega automática)

La web se conecta a la API de un proveedor de recargas, con **su llave**, para dos cosas:

1. **Nickname por ID**: al validar el ID, la web muestra una tarjeta del jugador con su nickname, su ID y los datos de su cuenta (nivel, servidor y likes, si el proveedor los da) para que el cliente confirme que es su cuenta, con un botón *Cambiar ID* (y si el ID no existe, no lo deja comprar). El proveedor solo ofrece esta consulta para **Free Fire**.
2. **Entrega automática**: al comprar, el pedido se entrega solo, sin que tú hagas nada, y pasa a `completado`.

**Estado actual: conectada y funcionando en modo real** (los *Secrets* ya están puestos en Supabase; el panel → *Integraciones* lo confirma al pulsar *Probar conexión*). Si esa conexión se apaga o nunca se puso, todo funciona igual que antes: el ID se acepta sin nickname y tú entregas a mano. El **adaptador** (`supabase/functions/integracion/proveedor.ts`, sección "MODO REAL") sigue la documentación del proveedor: acciones `saldo`, `validar_id`, `comprar` y `pedido`.

**Cómo está armado**
- La web **nunca** habla con el proveedor ni ve la llave. Todo pasa por una función de Supabase (Edge Function) llamada `integracion`, que exige sesión iniciada y valida quién llama. La llave solo existe en los *Secrets* de Supabase.
- `supabase/functions/integracion/`: `index.ts` (recibe las llamadas: `validar_jugador`, `entregar_pedido`, `revisar_pedido`, `probar`, `catalogo`), `logica.ts` (las reglas, sin red), `proveedor.ts` (**el único archivo que habla con la API**), `comun.ts` (CORS, quién llama, acceso a la base) y `logica_test.ts` / `proveedor_test.ts` (pruebas, no se despliegan).
- Base de datos (migraciones al final de `supabase/schema.sql`): tablas `juegos`, `paquetes_proveedor`, `integracion_estado` (modo, saldo, cuándo vence la API y cupo de consultas), `jugadores_cache`, `consultas_jugador` e `integracion_logs`; columnas nuevas en `pedidos` (`nickname_jugador`, `entrega`, `entrega_ref`, `entrega_detalle`, `entrega_intentos`, `entrega_at`) y en `paquetes_ff` (`juego`, `entrega_auto`).
- Estados de la entrega de un pedido (`pedidos.entrega`): `manual` (de siempre), `auto_pendiente`, `auto_en_proceso` (la función está hablando con el proveedor), `auto_confirmando` (el proveedor la aceptó y la está aplicando), `auto_entregado`, `auto_fallo` (el proveedor dejó claro que no la hizo ni la cobró) y `auto_revisar` (no hubo respuesta: no sabemos si la hizo).
- El adaptador traduce lo que responda el proveedor a pocos resultados: **entregado** (el proveedor lo confirma), **en proceso** (la aceptó y la está aplicando), **fallo** (dice claramente que no lo hizo ni cobró) y **desconocido** (cualquier duda: timeout, error 5xx, respuesta rara). Así nunca se da por entregado algo sin confirmar.
- El motivo real de un rechazo (por ejemplo "saldo insuficiente") va solo al **registro de actividad** del panel; el pedido guarda un texto genérico que sí puede leer el cliente.
- **Para publicar la función**: con la CLI de Supabase (`supabase functions deploy integracion`) o pegando sus 4 archivos (`index.ts`, `comun.ts`, `logica.ts`, `proveedor.ts`) en Supabase → Edge Functions. Debe quedar con *Verify JWT* activado.
- Cada intento de entrega viaja con su propia clave (`MZ-<pedido>`, `MZ-<pedido>-2`...): el proveedor la recuerda, repetirla no vuelve a cobrar ni a entregar, y una orden rechazada no se puede repetir con la misma clave.

**Garantías que ya cumple**
- **Nunca se entrega dos veces**: la función "reclama" el pedido de forma atómica en la base antes de llamar al proveedor (si dos llamadas llegan a la vez, solo una entrega) y cada intento lleva su clave de idempotencia.
- **Lo que queda a medias se consulta, no se repite.** Si el proveedor tarda, no responde o la deja "aplicándose", la función **pregunta** por esa orden (`revisar_pedido`, que no cobra nada): entregada → el pedido pasa a `completado`; rechazada (el proveedor devolvió el saldo) → `auto_fallo`; sigue en proceso → se queda como está; sin registro pasados 3 minutos → nunca llegó ni se cobró, `auto_fallo`. Se consulta sola cuando el cliente abre *Mis pedidos* y cuando el admin abre *Pedidos* (y con el botón *Consultar estado*). **Reintentar solo se permite tras un `auto_fallo`**, nunca sobre algo dudoso.
- Mientras el proveedor aplica una recarga (`auto_confirmando`) el admin **no puede cancelarla ni marcarla a mano** durante 30 minutos, para no entregarla dos veces ni devolver un saldo por algo que sí llegó.
- **El modo simulado nunca completa pedidos** ni entrega nada de verdad.
- **Si el proveedor rechaza la llave** (venció el acceso, la pausaron o generaron otra), la conexión se apaga sola: las compras nuevas se entregan a mano y el nickname deja de consultarse, el panel lo avisa, hasta que lo resuelvas y pulses *Probar conexión*. Un rechazo normal (saldo insuficiente, paquete mal escrito) no la apaga. Consultar el estado de lo ya enviado sigue funcionando aunque la API esté vencida.
- **Activar las opciones exige una conexión probada** (botón *Probar conexión*). Si la última prueba falló, los pedidos nuevos se entregan a mano, y si la integración deja de estar disponible justo antes de entregar, el pedido pasa solo al flujo manual: la web sigue vendiendo.
- Si el proveedor no responde al validar el ID (o se acabó su cupo de consultas), el cliente puede continuar igual (con un aviso); si el ID no existe, no puede comprar.
- Límite de 20 consultas de nickname por hora por usuario. Los nicknames consultados se guardan en caché (la consulta se repite pasadas 24 h; la caché y el registro de actividad se borran a los 30 días). El nickname del pedido se toma solo del servidor: el navegador no puede inventarlo.
- El panel muestra el **saldo** (se actualiza con cada compra), **cuándo vence la API** y **cuántas consultas de nickname quedan**, y avisa cuando falta poco. Renovar la API no cambia la llave: solo hay que pulsar *Probar conexión* para actualizar la fecha.

**Cómo conectarlo** (la misma guía está en el panel, sección Integraciones)
1. Pide al proveedor la URL de la API y tu llave. Si el acceso es por tiempo limitado, la fecha de vencimiento aparece en el panel al probar la conexión.
2. En Supabase → Edge Functions → Secrets crea `PROVEEDOR_URL` (la dirección) y `PROVEEDOR_API_KEY` (la llave). **Nunca** pegues la llave en la web, el código ni un chat.
3. Si quieres ensayar antes, usa `PROVEEDOR_MODO` = `simulado` y *Probar conexión* (ver abajo). Luego pon `PROVEEDOR_MODO` = `real` y pulsa *Probar conexión*: debe decir **Conectada** y mostrar tu saldo, cuándo vence la API y cuántas consultas de nickname te quedan. Esa prueba solo consulta datos; no compra nada.
4. Carga saldo en el proveedor (USDT): cada recarga automática se descuenta de ahí.
5. Con **Ver catálogo del proveedor** pulsa *Asignar los que coinciden por nombre* (los paquetes que se llaman exactamente igual en tu tienda y en el proveedor reciben su código solos) y completa a mano el resto en **Paquetes → Editar → Código en el proveedor**. Los paquetes sin código, o que el proveedor no vende por API, se siguen entregando a mano.
6. Activa *Mostrar el nickname* y *Entregar los pedidos automáticamente* en **Integraciones** y haz una compra pequeña con tu propio ID antes de abrirlo a todos.

**Probar sin proveedor (modo simulado)**: con `PROVEEDOR_MODO` = `simulado` las respuestas son inventadas. Según cómo termine el ID de jugador: `…000` no existe, `…111` proveedor caído, `…999` recarga rechazada (`auto_fallo`), `…888` sin respuesta (`auto_revisar`), `…777` queda aplicándose y a los 20 segundos se entrega, `…666` queda aplicándose y luego el proveedor la rechaza, `…555` queda aplicándose para siempre; cualquier otro funciona y el nickname sale como `Jugador####`. Un pedido "entregado" en simulado se queda `confirmado` y el panel y la web avisan que fue de mentira. **No dejes el modo simulado puesto con clientes reales** (el Resumen del panel te lo recuerda).

**Pruebas de la lógica**: `deno test supabase/functions/integracion/` (94 pruebas con datos falsos y un `fetch` de mentira que repite las respuestas que documenta el proveedor: validación, entrega única, cada respuesta y cada error posible, órdenes en proceso, consulta de estado, llave rechazada, permisos, modos y que la llave nunca salga en una respuesta).

**Límites conocidos**
- Por ahora solo juegos con un único ID (como Free Fire). Los que piden además servidor o zona (por ejemplo Mobile Legends) necesitan guardar esa zona en el pedido; la tabla `juegos` y el adaptador ya la contemplan, falta esa columna. Si un paquete de esos juegos llegara a tener código, el proveedor lo rechaza (`falta_zone_id`) y el pedido queda en `auto_fallo` con el motivo en el registro.
- Agregar otro juego = una fila en `juegos`, sus paquetes con `paquetes_ff.juego` y sus tarjetas de catálogo en la web (hoy solo existen las de Free Fire).
- **Nickname**: solo Free Fire (`JUEGOS_CON_NICKNAME` en `proveedor.ts`). El proveedor da un cupo de consultas por vigencia (por ejemplo 800 cada 15 días) y **cada consulta nueva gasta una**, aunque el ID no exista; la caché de 24 h y el límite por usuario ayudan a cuidarlo. Cuando se acaba, las compras siguen sin mostrar el nickname. El proveedor no pudo comprobar cuentas de otros servidores (Brasil, Asia...): un ID de otra región podría salir como "no existe".
- Si el saldo en el proveedor llega a cero, las entregas automáticas fallan (el panel lo marca en el Resumen y en Integraciones) y esos pedidos quedan para reintentar.
- Las órdenes que el proveedor no resuelve en más de 6 horas quedan para revisión manual de su lado (hay que escribirle con el número de orden).
- La regla de "Promo Primera Vez: una por ID" sigue sin hacerla cumplir el servidor.
- Garena no ofrece una API pública para consultar nicknames: esto depende de lo que permita y garantice el proveedor.

## Puesta en marcha (una sola vez)

1. ✅ **Base de datos**: ya aplicado — `supabase/schema.sql` está corrido en el proyecto de Supabase de MZ'Recargas (tablas, RLS y triggers listos, con revisión de seguridad hecha con el Advisor de Supabase).
2. ✅ **Conectar el sitio a Supabase**: `sesion.js` ya tiene la Project URL y la clave publishable reales del proyecto.
3. **Revisar Auth**: en Supabase, Authentication → URL Configuration, comprueba que la URL donde está publicado el sitio esté (la de GitHub Pages o tu dominio) en "Site URL" y "Redirect URLs" — si no, el enlace de "recuperar contraseña" no funciona. Los correos de confirmar cuenta y recuperar contraseña salen de `supabase/plantillas-correo/` (se pegan en Authentication → Emails → Templates).
4. **Publicar con GitHub Pages**: en este repositorio, Settings → Pages → Source: "Deploy from a branch" → rama `main`, carpeta `/ (root)`.

## Pendiente antes de lanzarlo a clientes reales

- [x] **Datos de pago reales** — ya no están en `recargar-saldo.html`: se editan desde el panel (**Medios de pago**) y viven en la tabla `medios_pago`. Valores iniciales: Yape 901 150 296 a nombre de "Raul Mu*" (apellido oculto a propósito, para que no lo usen en estafas) con `qr-yape.jpeg`; Plin solo con `qr-plin.jpeg`. Esos dos archivos siguen en el repo como los QR de siempre; las fotos que suba el dueño van a Storage.
- [x] **Número de WhatsApp real** — `wa.me/51901150296` en todas las páginas.
- [x] **Precios reales de los paquetes** — tabla `paquetes_ff` en Supabase, con dos catálogos (`categoria`: `ilimitada` / `promo`), mismos 6 tamaños de diamantes y precios distintos cada uno.
- [x] **Logo** — ícono de diamante propio (`logo.svg`) en navbar y favicon.
- [x] **Paquetes y precios de "Tokens Evolutivos"** — 8 niveles (200 a 900 Fragmentos), precios propios de MZ'Recargas inspirados en un sitio de referencia que mandó el cliente.
- [x] **Paquetes y precios de "Cajas de Tokens"** — 6 niveles (50 a 300 Cajas Evolutivas), precios propios de MZ'Recargas. También tiene un campo de "cantidad exacta" (S/ 0.48 por unidad, mínimo 20) para pedidos fuera de esos niveles fijos.
- [ ] **Dominio propio e indexación en Google** (opcional) — ver la sección "Salir con dominio propio y aparecer en Google" más abajo; ya está todo preparado, es un solo comando.
- [~] **Términos y Privacidad** (`terminos.html`, `privacidad.html`) — reescritos (5 de octubre de 2026; actualizados el 27 de octubre para la entrega automática y la consulta del nickname) para describir lo que el sitio hace de verdad y conforme a la Ley 29733 de Protección de Datos Personales y la normativa de consumo del Perú. **No son asesoría legal**: antes de operar a escala conviene que los revise un abogado peruano. Lo que falta, y que el texto no puede resolver solo:
  - **Libro de Reclamaciones virtual**: obligatorio para tiendas en línea que venden a consumidores en Perú (con enlace visible en el sitio). Aún no existe en la web.
  - **Identificar al titular del negocio** (nombre o razón social, RUC/DNI y domicilio). Hoy el sitio solo se presenta con el nombre comercial.
  - **Registro del banco de datos personales** ante la Autoridad Nacional de Protección de Datos Personales (trámite gratuito en línea).
  - Las cuentas ya registradas antes del 5/10/2026 no tienen constancia de consentimiento (`perfiles.acepto_terminos_at` es `null` para ellas).
  - Vender cuentas de Free Fire va contra los términos de Garena; los Términos de MZ'Recargas advierten ese riesgo al comprador.
  - Si cambias el fondo de los textos legales, sube `VERSION_LEGAL` en `register.html` para que quede registrado qué versión aceptó cada persona.
- [ ] **Anti-bots / captcha** en login y registro — no se incluyó en esta primera versión (Cloudflare Turnstile es una buena opción y requiere una cuenta de Cloudflare propia para este dominio). Se puede agregar después si empieza a haber spam de registros.
- [x] **Panel de administración** — `admin.html`, ver sección de arriba.

## Direcciones sin ".html"

Todos los enlaces del sitio son limpios: `mzrecargas.com/catalogo`, `/terminos`, `/login`, y el inicio es solo `mzrecargas.com/`. GitHub Pages sirve cada archivo `.html` también sin la extensión, así que no hay que configurar nada. Si alguien entra con un enlace o favorito viejo que trae `.html` (sigue funcionando), `sesion.js` le limpia la dirección en la barra. Al crear páginas nuevas, enlázalas sin `.html` (el inicio como `./`) y usa también la dirección limpia en el `canonical`, el `og:url` y `sitemap.xml`. Para probar en tu computadora con estas direcciones hace falta un servidor que las entienda (el `python3 -m http.server` común solo abre las que llevan `.html`): usa `scripts/servidor-local.py`, o los accesos con doble clic `scripts/abrir-en-mac.command` y `scripts/abrir-en-windows.bat`. Ojo: esa copia usa la base de datos real.

## Al cambiar estilos o scripts (`?v=`)

GitHub Pages deja los archivos en la caché del navegador unos 10 minutos. Si cambias un `.css` o `sesion.js` junto con el HTML que lo usa, quien ya tenía la copia vieja vería la página sin estilos o mezclada hasta que pase ese rato. Para evitarlo, cada página carga esos archivos con un número de versión (`style.css?v=…`, `admin.css?v=…`, `recargar.css?v=…`, `sesion.js?v=…`). **Cada vez que cambies uno de esos cuatro archivos, antes de publicar corre:**

```
python3 scripts/actualizar-version.py        (en Windows: py -3 scripts\actualizar-version.py)
```

Pone el mismo número nuevo (la fecha de hoy y una letra: `20261106a`, `20261106b`…) en todas las páginas y en `scripts/footer.html`. Con `--prueba` solo muestra qué cambiaría. Los cambios solo en HTML no lo necesitan.

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


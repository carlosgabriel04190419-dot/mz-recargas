# Guía para el dueño de MZ'Recargas

Esta guía es para ti, que no programas. Te explica, paso a paso y sin palabras raras, cómo:

1. **Ver el código** de tu tienda.
2. **Ver la tienda funcionando en tu computadora** (opcional).
3. **Cambiar algo y publicarlo.**

Para entender cómo funciona todo por dentro, lee el [README](README.md). Esta guía es la parte práctica.

---

## Lo más importante (léelo primero)

1. **Tu tienda tiene tres partes.** Las *páginas* (lo que ve el cliente) viven en **GitHub** y son este código. Los *datos* (usuarios, saldos, pedidos, precios) viven en **Supabase**. Las *recargas automáticas* las hace el **proveedor**. Este código es solo la primera parte: **los usuarios, saldos y pedidos no están aquí**.
2. **Lo del día a día no necesita código.** Precios, QR de Yape y Plin, ocultar un catálogo, poner una promo, corregir el saldo de un cliente… todo se hace desde el **panel** (`mzrecargas.com/admin`). Mira la tabla "Qué se cambia desde el panel" del [README](README.md).
3. **Lo que guardes en GitHub se publica solo**, en 1 o 2 minutos. No hay "borrador". Por eso: cambia **una cosa a la vez** y revisa cómo quedó.
4. **Los cambios en el código se pueden deshacer.** GitHub guarda todas las versiones anteriores.
5. **Si dudas, no lo toques y pregunta** a quien te armó la web.
6. **Nunca pegues contraseñas ni llaves dentro de los archivos.** Este código es público: cualquiera puede leerlo.

---

## Parte 1 · Recibir el código

Hay dos formas. Con cualquiera de las dos tienes lo mismo.

**A) Un archivo ZIP** (te lo pueden mandar por WhatsApp, correo o Drive).
- **Windows:** clic derecho sobre el ZIP → **Extraer todo…** → Extraer.
- **Mac:** doble clic sobre el ZIP.
- Te queda una carpeta llamada `mz-recargas`. Esa carpeta es todo el código.

**B) El enlace de GitHub:** <https://github.com/carlosgabriel04190419-dot/mz-recargas>
- Lo puedes ver sin tener cuenta.
- Para bajarlo: botón verde **Code** → **Download ZIP**, y lo extraes como arriba.

---

## Parte 2 · Mirar el código

**Sin instalar nada:** entra al enlace de GitHub y haz clic en cualquier archivo para leerlo. Con la tecla `t` puedes buscar un archivo por su nombre.

**Mejor, con Visual Studio Code** (gratis, de Microsoft):
1. Instálalo desde <https://code.visualstudio.com>.
2. Ábrelo y elige **Archivo → Abrir carpeta…** (en Mac: *File → Open Folder…*) y escoge la carpeta `mz-recargas`.
3. A la izquierda verás todos los archivos. Haz clic en uno para leerlo.
4. **Truco para encontrar cualquier cosa:** pulsa `Ctrl + Mayús + F` (en Mac: `Cmd + Mayús + F`) y escribe una frase que veas en la web. Te muestra en qué archivo está.

**Por dónde empezar:**
1. `README.md`: el mapa de todo.
2. `index.html`: la página de inicio. Se lee casi como texto normal. Lo que está entre `>` y `<` es lo que se ve en la página; lo demás son instrucciones.
3. `style.css`: los colores y el diseño. Los colores principales están al comienzo del archivo.
4. `sesion.js`: el código que comparten todas las páginas (la conexión con los datos, el saldo, el asistente…).

No necesitas entenderlo todo. La mayoría de los archivos de la tienda son páginas (`.html`) y se leen de arriba hacia abajo.

---

## Parte 3 · Ver la tienda en tu computadora (opcional)

**Para qué sirve:** ver cómo queda un cambio **antes** de publicarlo.

> ⚠️ **Importante:** la tienda de tu computadora usa la **base de datos real**, la misma de mzrecargas.com. Mirar es seguro, pero una compra, una recarga o un cambio hecho en el panel desde ahí **es de verdad**.

**1. Instala Python** (gratis). Es lo único que hace falta.
- **Windows:** entra a <https://www.python.org/downloads/>, descarga e instala. **En la primera pantalla del instalador marca la casilla "Add python.exe to PATH"** y luego pulsa *Install Now*.
- **Mac:** normalmente ya viene instalado. Si al abrirlo te pide instalar "herramientas de desarrollo", acepta. Si no funciona, instálalo desde la misma página de arriba.

**2. Abre la tienda.** En la carpeta `mz-recargas` entra a la carpeta `scripts` y haz doble clic en:
- **Windows:** `abrir-en-windows.bat`
- **Mac:** `abrir-en-mac.command` (la primera vez, si Mac no lo deja abrir: clic derecho sobre el archivo → **Abrir** → **Abrir**).

Se abre una ventana negra con un mensaje y, a los pocos segundos, tu navegador con la tienda en `http://localhost:8000`.

**3. Para cerrarla:** cierra la ventana negra.

**4. Cada vez que cambies un archivo:** guárdalo (`Ctrl + S`) y recarga la página en el navegador (`F5`). No hace falta cerrar nada.

*Si el doble clic no funciona,* abre una terminal dentro de la carpeta `mz-recargas` y escribe `python3 scripts/servidor-local.py` (en Windows: `py -3 scripts\servidor-local.py`).

---

## Parte 4 · Cambiar algo y publicarlo

**Antes de tocar código, pregúntate:** ¿esto se puede cambiar desde el panel? Si es un precio, un QR, un catálogo, una promo o un saldo, **sí**, y no necesitas nada de esta parte. Revisa la tabla "Qué se cambia desde el panel" del [README](README.md).

### Paso previo: tener acceso para guardar cambios

1. Crea una cuenta gratis en <https://github.com> (botón *Sign up*).
2. Dile tu **nombre de usuario de GitHub** a quien administra el código para que te invite (pasos en la Parte 6).
3. Te llega un correo de invitación: ábrelo y acepta.

> Si al intentar editar un archivo GitHub te dice **"fork this repository"**, todavía no tienes acceso: pide que te inviten.

### Camino A · Desde la página de GitHub (el más fácil, ideal para textos)

1. Entra a <https://github.com/carlosgabriel04190419-dot/mz-recargas> e inicia sesión.
2. Haz clic en el archivo que quieres cambiar (por ejemplo `index.html`).
3. Arriba a la derecha del contenido, haz clic en el **lápiz ✏️** (*Edit this file*).
4. Busca el texto con `Ctrl + F` y cámbialo.
   - Cambia **solo las palabras que se ven** en la página.
   - **No borres** símbolos como `<`, `>`, comillas `"`, ni palabras como `class=` o `onclick=`.
5. Pulsa el botón verde **Commit changes…**
6. Escribe una frase corta de lo que cambiaste (por ejemplo: *Cambio el título del inicio*). Deja marcada la opción **Commit directly to the main branch** y pulsa **Commit changes**.
7. **Espera 1 o 2 minutos** y abre mzrecargas.com. Si no ves el cambio, refresca con `Ctrl + F5` (en Mac: `Cmd + Mayús + R`).

**Para cambiar una imagen** (un banner, el logo): en la página principal del repositorio pulsa **Add file → Upload files**, arrastra la imagen nueva **con el mismo nombre** que la anterior y pulsa **Commit changes**.

### Camino B · Desde tu computadora con GitHub Desktop (para varios cambios o para probar antes)

1. Instala **GitHub Desktop** desde <https://desktop.github.com> e inicia sesión con tu cuenta.
2. **File → Clone repository…** → pestaña **URL** → pega `https://github.com/carlosgabriel04190419-dot/mz-recargas` → **Clone**.
3. Abre la carpeta en Visual Studio Code (en GitHub Desktop: menú **Repository → Open in Visual Studio Code**).
4. Haz tus cambios y guarda cada archivo (`Ctrl + S`).
5. Pruébalos con la tienda de tu computadora (Parte 3).
6. Vuelve a GitHub Desktop. A la izquierda aparecen los archivos que cambiaste: revísalos (verde = lo que agregaste, rojo = lo que quitaste).
7. Abajo, en **Summary**, escribe una frase corta de lo que hiciste y pulsa el botón azul **Commit to main**.
8. Pulsa **Push origin** (arriba). Ahí recién se publica.

Antes de empezar un día de trabajo, pulsa **Fetch origin** (y, si aparece, **Pull origin**) para traer lo último.

### Si cambiaste estilos o `sesion.js`

Los navegadores guardan los archivos de estilo unos 10 minutos. Para que nadie vea la tienda "a medias", antes de publicar corre este comando (Camino B), que sube un número de versión en todas las páginas:

- **Mac:** `python3 scripts/actualizar-version.py`
- **Windows:** `py -3 scripts\actualizar-version.py`

*(Si olvidas hacerlo no se rompe nada: durante unos minutos algunas personas podrían ver la tienda con estilos viejos, y se arregla refrescando la página.)*

### Cómo comprobar que se publicó

En la página del repositorio en GitHub, entra a la pestaña **Actions**. Verás una línea llamada *pages build and deployment*: cuando tiene el ✅ verde, ya está publicado. Si tiene una ❌ roja, algo salió mal (ver "Si algo sale mal").

### Cómo deshacer un cambio

- **Con GitHub Desktop:** pestaña **History** → clic derecho sobre tu cambio → **Revert changes in commit** → luego **Push origin**.
- **Desde GitHub:** abre el archivo → **History** → entra a la versión de antes → copia el contenido, vuelve al archivo actual, pega y guarda con **Commit changes**.
- O pide ayuda: cualquier versión anterior se recupera en un minuto.

---

## Parte 5 · Lo que NO se cambia desde aquí

| Cosa | Dónde se maneja |
|---|---|
| Usuarios, saldos, pedidos, precios (los datos) | El **panel** de la tienda. Las reglas de fondo, en **Supabase** (necesitas que te inviten al proyecto). |
| Las reglas de la base de datos | `supabase/schema.sql` las describe, pero **no se aplican solas**: se corren en Supabase. Pide ayuda para esto. |
| La entrega automática y las llaves del proveedor | Supabase → Edge Functions y Secrets. Las llaves **no** se ven ni van en el código. |
| El saldo y el acceso del proveedor | La web del proveedor. El panel → *Integraciones* te muestra cómo va. |
| El dominio `mzrecargas.com` | Donde lo compraste. |

---

## Parte 6 · Para quien administra el código (dar acceso a otra persona)

**Invitar a alguien a editar:**
1. Entra al repositorio en GitHub.
2. **Settings → Collaborators → Add people**.
3. Escribe su nombre de usuario de GitHub y elige su nombre en la lista.
4. La persona recibe un correo y debe aceptar la invitación.

**Recomendaciones:**
- Da acceso **solo a quien confíes**: quien puede guardar cambios puede cambiar lo que ven los clientes.
- Pídele que active la **verificación en dos pasos** en su cuenta de GitHub (en su cuenta: *Settings → Password and authentication*).
- **Si quieres revisar sus cambios antes de que se publiquen:** que haga una copia (botón **Fork**), cambie ahí y pulse **Contribute → Open pull request**. Tú revisas y pulsas **Merge** solo si estás de acuerdo. También puedes exigir esto a todos en *Settings → Branches* (o *Rules*), pidiendo que todo cambio pase por un *pull request*.

---

## Si algo sale mal

| Qué pasa | Qué hacer |
|---|---|
| Cambié algo y **no se ve** en la tienda | Espera 2 minutos y refresca con `Ctrl + F5`. Revisa la pestaña **Actions** (✅ o ❌). |
| La tienda se ve **sin estilos o rara** | Refresca con `Ctrl + F5`. Si sigue, deshaz tu último cambio (Parte 4). |
| La **ventana negra** de mi computadora dice que no encuentra Python | Instálalo (Parte 3, paso 1) y vuelve a abrir el archivo. En Windows, marca *Add python.exe to PATH*. |
| El navegador dice **"no se puede acceder a este sitio"** en `localhost` | La ventana negra se cerró. Ábrela otra vez (Parte 3). |
| **Mac no deja abrir** `abrir-en-mac.command` | Clic derecho sobre el archivo → **Abrir** → **Abrir**. |
| Rompí algo y **no sé cómo arreglarlo** | Deshaz el último cambio (Parte 4) o pide ayuda. Nada de lo que hagas en el código borra usuarios ni saldos: esos datos viven en Supabase. |

---

## Mini glosario

- **Repositorio (repo):** la carpeta con todo el código, guardada en GitHub con todas sus versiones.
- **Commit:** guardar un cambio con una frase que dice qué hiciste.
- **Push:** enviar tus cambios a GitHub (y así publicarlos).
- **Pull / Fetch:** traer a tu computadora los cambios que otros hicieron.
- **`main`:** la versión oficial. Lo que está en `main` es lo que ve el público.
- **GitHub Pages:** el servicio que publica las páginas de `main` en mzrecargas.com.
- **Supabase:** el servicio donde viven los usuarios, saldos y pedidos.
- **Panel / admin:** `mzrecargas.com/admin`, donde manejas la tienda sin tocar código.
- **Fork:** tu propia copia del repositorio, para probar sin tocar el original.
- **Pull request:** pedir que tus cambios de una copia se unan al original, para que alguien los revise.

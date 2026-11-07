#!/usr/bin/env python3
"""Abre la tienda en tu propia computadora, para verla y probar cambios antes de publicarlos.

Uso (funciona desde cualquier carpeta):
    Mac / Linux:   python3 scripts/servidor-local.py
    Windows:       py -3 scripts\\servidor-local.py
(o simplemente haz doble clic en scripts/abrir-en-mac.command o scripts/abrir-en-windows.bat)

Es un servidor pequeño que entiende las direcciones sin ".html" (/catalogo, /login...),
igual que GitHub Pages. Solo se puede abrir desde esta misma computadora.

OJO: la tienda de tu computadora usa la base de datos REAL, la misma de mzrecargas.com.
Mirar es seguro, pero una compra, una recarga o un cambio en el panel hechos desde aquí
son de verdad. Para cerrar la tienda de tu computadora, cierra la ventana o pulsa Ctrl+C.
"""
import argparse
import http.server
import os
import sys
import threading
import urllib.parse
import webbrowser

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Manejador(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=RAIZ, **kwargs)

    # /catalogo -> catalogo.html (como hace GitHub Pages)
    def _direccion_limpia(self):
        ruta, _, consulta = self.path.partition('?')
        limpia = ruta.rstrip('/') or '/'
        if limpia != '/' and not os.path.splitext(limpia)[1]:
            archivo = os.path.join(RAIZ, urllib.parse.unquote(limpia).lstrip('/') + '.html')
            if os.path.isfile(archivo):
                self.path = limpia + '.html' + ('?' + consulta if consulta else '')

    def do_GET(self):
        self._direccion_limpia()
        super().do_GET()

    def do_HEAD(self):
        self._direccion_limpia()
        super().do_HEAD()

    # Una página que no existe muestra 404.html, como en la tienda publicada.
    def send_error(self, code, message=None, explain=None):
        pagina = os.path.join(RAIZ, '404.html')
        if code == 404 and os.path.isfile(pagina):
            with open(pagina, 'rb') as f:
                cuerpo = f.read()
            self.send_response(404)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(cuerpo)))
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(cuerpo)
            return
        super().send_error(code, message, explain)

    # Sin caché: así ves tus cambios apenas guardas el archivo y recargas la página.
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, formato, *args):
        pass


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(line_buffering=True)  # que los mensajes salgan al instante
    if sys.version_info < (3, 7):
        print('Necesitas Python 3.7 o más nuevo (https://www.python.org/downloads/).')
        sys.exit(1)

    analizador = argparse.ArgumentParser(description='Abre la tienda en tu computadora.')
    analizador.add_argument('--puerto', type=int, default=8000, help='número de puerto (por defecto 8000)')
    analizador.add_argument('--sin-navegador', action='store_true', help='no abrir el navegador solo')
    opciones = analizador.parse_args()

    servidor = None
    for puerto in range(opciones.puerto, opciones.puerto + 20):
        try:
            servidor = http.server.ThreadingHTTPServer(('127.0.0.1', puerto), Manejador)
            break
        except OSError:
            continue  # ese puerto ya está ocupado: se prueba el siguiente
    if servidor is None:
        print('No se pudo abrir la tienda: los puertos %d a %d están ocupados.' % (opciones.puerto, opciones.puerto + 19))
        sys.exit(1)

    direccion = 'http://localhost:%d/' % puerto
    print('=' * 64)
    print(' La tienda está abierta en tu computadora:')
    print('   ' + direccion)
    print()
    print(' OJO: usa la base de datos REAL de mzrecargas.com.')
    print(' Mirar es seguro; comprar, recargar o cambiar cosas en el panel')
    print(' desde aquí es de verdad.')
    print()
    print(' Para cerrarla: cierra esta ventana o pulsa Ctrl+C.')
    print('=' * 64)

    if not opciones.sin_navegador:
        threading.Timer(0.8, lambda: webbrowser.open(direccion)).start()
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print('\nListo: cerraste la tienda de tu computadora.')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Cambia la dirección pública del sitio en todos los archivos que la usan
(canonical, og:url, og:image, JSON-LD, sitemap.xml y robots.txt) y crea el
archivo CNAME que pide GitHub Pages para un dominio propio.

Uso (desde la raíz del repo):
    python3 scripts/configurar-dominio.py https://www.tudominio.com
    python3 scripts/configurar-dominio.py https://www.tudominio.com --prueba   (solo muestra qué cambiaría)

La dirección actual se lee de la línea "Sitemap:" de robots.txt.
"""
import glob
import os
import re
import sys
from urllib.parse import urlparse

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    prueba = '--prueba' in sys.argv
    if len(args) != 1:
        sys.exit(__doc__)

    nuevo = args[0].strip().rstrip('/')
    u = urlparse(nuevo)
    if u.scheme != 'https' or not u.netloc or u.query or u.fragment:
        sys.exit('La dirección debe ser tipo https://www.tudominio.com (con https y sin parámetros).')

    ruta_robots = os.path.join(RAIZ, 'robots.txt')
    m = re.search(r'^Sitemap:\s*(\S+?)/sitemap\.xml\s*$', open(ruta_robots, encoding='utf-8').read(), re.M)
    if not m:
        sys.exit('No encontré la línea "Sitemap: .../sitemap.xml" en robots.txt.')
    viejo = m.group(1).rstrip('/')
    if viejo == nuevo:
        sys.exit('El sitio ya usa esa dirección: ' + nuevo)

    archivos = sorted(glob.glob(os.path.join(RAIZ, '*.html'))) + [os.path.join(RAIZ, 'sitemap.xml'), ruta_robots]
    total = 0
    for ruta in archivos:
        s = open(ruta, encoding='utf-8').read()
        n = s.count(viejo)
        if not n:
            continue
        total += n
        print(f'  {os.path.basename(ruta)}: {n} cambio(s)')
        if not prueba:
            open(ruta, 'w', encoding='utf-8').write(s.replace(viejo, nuevo))

    if not u.path:  # dominio propio en la raíz: GitHub Pages necesita el archivo CNAME
        print(f'  CNAME: {u.netloc}')
        if not prueba:
            open(os.path.join(RAIZ, 'CNAME'), 'w', encoding='utf-8').write(u.netloc + '\n')

    print(f'\n{viejo}  →  {nuevo}   ({total} cambio(s))' + ('   [PRUEBA: no se escribió nada]' if prueba else ''))
    if not prueba:
        print("""
Falta, además (ver README, sección "Salir con dominio propio"):
  1. GitHub: Settings → Pages → Custom domain y activar "Enforce HTTPS".
  2. DNS del dominio apuntando a GitHub Pages.
  3. Supabase: Authentication → URL Configuration → Site URL y Redirect URLs con la nueva dirección.
  4. Google Search Console: agregar el sitio y enviar """ + nuevo + """/sitemap.xml.""")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Copia scripts/footer.html (la única fuente del pie de página) a todas las
páginas del sitio, dentro de los marcadores FOOTER:INICIO / FOOTER:FIN.

Uso (desde la raíz del repo):   python3 scripts/sincronizar-footer.py

Así el pie de página es HTML estático en cada página (lo ven buscadores y
quien tenga JavaScript apagado) y para cambiarlo se edita UN solo archivo.
"""
import glob
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INICIO = '<!-- FOOTER:INICIO (generado: edita scripts/footer.html y corre scripts/sincronizar-footer.py) -->'
FIN = '<!-- FOOTER:FIN -->'

plantilla = open(os.path.join(RAIZ, 'scripts', 'footer.html'), encoding='utf-8').read().strip('\n')
bloque = INICIO + '\n' + '\n'.join(('    ' + l if l.strip() else l) for l in plantilla.split('\n')) + '\n    ' + FIN

# Función vieja que armaba el pie con JavaScript (ya no hace falta).
RE_FUNCION_JS = re.compile(r"[ \t]*function insertarFooter\(\) \{\s*document\.getElementById\('footer-slot'\)\.outerHTML = `.*?</footer>`;\s*\}\n?", re.S)
RE_LLAMADA_JS = re.compile(r"^[ \t]*insertarFooter\(\);[ \t]*\n", re.M)
RE_MARCADORES = re.compile(re.escape(INICIO.split(' (')[0]) + r'.*?' + re.escape(FIN), re.S)

cambiadas = []
for ruta in sorted(glob.glob(os.path.join(RAIZ, '*.html'))):
    s = open(ruta, encoding='utf-8').read()
    original = s

    if 'FOOTER:INICIO' in s:
        s = RE_MARCADORES.sub(lambda m: bloque.strip(), s, count=1)
    elif '<footer id="footer-slot"></footer>' in s:
        s = s.replace('<footer id="footer-slot"></footer>', bloque.strip(), 1)
        s = RE_FUNCION_JS.sub('', s)
        s = RE_LLAMADA_JS.sub('', s)
    elif re.search(r'<footer>.*?</footer>', s, re.S):
        s = re.sub(r'<footer>.*?</footer>', lambda m: bloque.strip(), s, count=1, flags=re.S)
    else:
        continue

    if s != original:
        open(ruta, 'w', encoding='utf-8').write(s)
        cambiadas.append(os.path.basename(ruta))

print('Pie de página actualizado en:', ', '.join(cambiadas) if cambiadas else '(nada que cambiar)')
sys.exit(0)

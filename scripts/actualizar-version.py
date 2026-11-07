#!/usr/bin/env python3
"""Sube el número de versión (?v=...) de los estilos y scripts en todas las páginas.

Cuándo usarlo: cada vez que cambies style.css, admin.css, recargar.css o sesion.js,
justo antes de publicar. GitHub Pages deja los archivos en la caché del navegador unos
10 minutos; con un número de versión nuevo, quien ya tenía la página abierta recibe
los archivos nuevos y no ve la tienda sin estilos o mezclada. Si solo cambiaste textos
de un .html, no hace falta.

Uso (funciona desde cualquier carpeta):
    Mac / Linux:   python3 scripts/actualizar-version.py
    Windows:       py -3 scripts\\actualizar-version.py
    Para solo ver qué cambiaría, sin escribir nada:   agrega --prueba
"""
import collections
import datetime
import glob
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATRON = re.compile(r'\?v=([0-9a-z]+)(?=")')


def archivos():
    lista = sorted(glob.glob(os.path.join(RAIZ, '*.html')))
    pie = os.path.join(RAIZ, 'scripts', 'footer.html')  # el pie de página también lleva una versión
    if os.path.isfile(pie):
        lista.append(pie)
    return lista


def main():
    solo_ver = '--prueba' in sys.argv[1:]
    contenidos = {}
    versiones = collections.Counter()
    for ruta in archivos():
        with open(ruta, encoding='utf-8', newline='') as f:  # newline='' respeta los saltos de línea del archivo
            texto = f.read()
        contenidos[ruta] = texto
        versiones.update(PATRON.findall(texto))
    if not versiones:
        print('No encontré ningún número de versión (?v=...) en las páginas.')
        sys.exit(1)

    actual = versiones.most_common(1)[0][0]
    hoy = datetime.date.today().strftime('%Y%m%d')
    coincidencia = re.fullmatch(r'(\d{8})([a-z])', actual)
    if coincidencia and coincidencia.group(1) == hoy and coincidencia.group(2) < 'z':
        nueva = hoy + chr(ord(coincidencia.group(2)) + 1)  # ya se subió hoy: a -> b -> c...
    else:
        nueva = hoy + 'a'
    if nueva == actual:
        print('La versión ya es %s y no puedo subirla más hoy. Inténtalo mañana.' % actual)
        sys.exit(1)

    cambios = 0
    paginas = 0
    for ruta, texto in contenidos.items():
        nuevo_texto, veces = PATRON.subn('?v=' + nueva, texto)
        if nuevo_texto != texto:
            paginas += 1
            cambios += veces
            if not solo_ver:
                with open(ruta, 'w', encoding='utf-8', newline='') as f:
                    f.write(nuevo_texto)

    verbo = 'Cambiaría' if solo_ver else 'Cambié'
    print('%s la versión %s por %s en %d lugares de %d archivos.' % (verbo, actual, nueva, cambios, paginas))
    if not solo_ver:
        print('Ahora ya puedes publicar tus cambios.')


if __name__ == '__main__':
    main()

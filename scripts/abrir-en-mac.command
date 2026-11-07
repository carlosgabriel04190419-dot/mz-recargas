#!/bin/bash
# Doble clic para abrir la tienda en tu computadora (Mac).
# La primera vez, si Mac dice que no puede abrirlo: clic derecho sobre este archivo > Abrir > Abrir.
cd "$(dirname "$0")/.." || exit 1
if command -v python3 >/dev/null 2>&1; then
    python3 scripts/servidor-local.py
else
    echo "No encontré Python en esta computadora."
    echo "Instálalo desde https://www.python.org/downloads/ y vuelve a abrir este archivo."
    echo
    read -n 1 -s -r -p "Pulsa cualquier tecla para cerrar."
fi

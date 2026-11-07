@echo off
rem Doble clic para abrir la tienda en tu computadora (Windows).
cd /d "%~dp0.."
where py >nul 2>nul
if not errorlevel 1 (
    py -3 scripts\servidor-local.py
    goto :eof
)
where python >nul 2>nul
if not errorlevel 1 (
    python scripts\servidor-local.py
    goto :eof
)
echo No encontre Python en esta computadora.
echo Instalalo desde https://www.python.org/downloads/
echo (en el instalador marca la casilla "Add python.exe to PATH")
echo y despues vuelve a abrir este archivo.
echo.
pause

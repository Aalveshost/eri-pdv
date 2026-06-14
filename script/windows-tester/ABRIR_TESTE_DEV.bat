@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo ERI TESTER - MODO DESENVOLVIMENTO
echo ========================================
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale o Node.js no Windows antes de abrir este teste.
  pause
  exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust/Cargo nao encontrado. Instale o Rust no Windows antes de abrir este teste.
  pause
  exit /b 1
)

echo Instalando dependencias do front...
call npm install
if errorlevel 1 (
  echo Falha ao instalar dependencias.
  pause
  exit /b 1
)

echo.
echo Abrindo o Tauri em modo dev...
call npm run tauri dev

echo.
echo O teste foi encerrado.
pause

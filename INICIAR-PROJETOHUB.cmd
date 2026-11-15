@echo off
setlocal
if exist "%~dp0node.exe" set "PATH=%~dp0;%PATH%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows.ps1" %*
if errorlevel 1 (
  echo.
  echo O ProjetoHUB nao iniciou. Veja o diagnostico acima.
  pause
  exit /b 1
)

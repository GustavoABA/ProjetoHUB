@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows.ps1" %*
if errorlevel 1 (
  echo.
  echo O ProjetoHUB nao iniciou. Veja o diagnostico acima.
  pause
  exit /b 1
)

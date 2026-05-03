@echo off
setlocal

cd /d "%~dp0"

if not exist "start-server-hidden.vbs" (
  echo Missing start-server-hidden.vbs
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$startup = [Environment]::GetFolderPath('Startup'); $shortcutPath = Join-Path $startup 'Simple Tools Server.lnk'; $ws = New-Object -ComObject WScript.Shell; $shortcut = $ws.CreateShortcut($shortcutPath); $shortcut.TargetPath = (Resolve-Path '.\start-server-hidden.vbs').Path; $shortcut.WorkingDirectory = (Resolve-Path '.').Path; $shortcut.Description = 'Start Simple Tools local server'; $shortcut.Save(); Write-Host ('Installed startup shortcut: ' + $shortcutPath)"

echo.
echo Done. After restart, open http://localhost:4173 in your browser.
echo You can also open it now after running start.bat once.
pause

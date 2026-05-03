@echo off
setlocal

powershell -NoProfile -ExecutionPolicy Bypass -Command "$shortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Simple Tools Server.lnk'; if (Test-Path $shortcutPath) { Remove-Item $shortcutPath; Write-Host ('Removed startup shortcut: ' + $shortcutPath) } else { Write-Host 'Startup shortcut was not found.' }"

echo.
echo Done.
pause

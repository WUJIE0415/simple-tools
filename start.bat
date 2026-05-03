@echo off
setlocal

cd /d "%~dp0"
set "PORT=4173"
set "TOOLS_DIR=%~dp0tools"
if not exist "%TOOLS_DIR%" set "TOOLS_DIR=%~dp0bin"
if exist "%TOOLS_DIR%" set "PATH=%TOOLS_DIR%;%PATH%"
if exist "%TOOLS_DIR%\yt-dlp.exe" set "YTDLP_PATH=%TOOLS_DIR%\yt-dlp.exe"
if exist "%TOOLS_DIR%\cookie.txt" set "YTDLP_COOKIE_PATH=%TOOLS_DIR%\cookie.txt"
if exist "%TOOLS_DIR%\ffmpeg.exe" set "FFMPEG_PATH=%TOOLS_DIR%\ffmpeg.exe"
if exist "%TOOLS_DIR%\ffmpeg.exe" set "FFMPEG_LOCATION=%TOOLS_DIR%"
if exist "%TOOLS_DIR%\instagram_provider.exe" set "INSTAGRAM_PROVIDER_PATH=%TOOLS_DIR%\instagram_provider.exe"
set "NODE_EXE=%TOOLS_DIR%\node.exe"

if not exist "%NODE_EXE%" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js is required to run this tool.
    echo This package is missing tools\node.exe, and Node.js is not installed.
    echo Please ask for a complete package or install Node.js from https://nodejs.org/.
    pause
    exit /b 1
  )

  set "NODE_EXE=node"
)

echo Simple Tools is starting...
echo Open http://localhost:%PORT% if the browser does not open automatically.
start "" "http://localhost:%PORT%"
"%NODE_EXE%" server.js
pause

@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js or run through Codex.
  pause
  exit /b 1
)
start "Personal Website Preview" /min node local-preview.cjs
start "Publication Manager" /min node publication-monitor\local-server.cjs
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:4190/
endlocal

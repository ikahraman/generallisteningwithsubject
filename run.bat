@echo off
title Academic English Studio - Dev Servers
cd /d "%~dp0"

echo Starting Vite dev server (http://localhost:5173) and the Edge-TTS companion server (http://localhost:5175)...
echo Press Ctrl+C in this window to stop both.
echo.

if not defined HUB_LAUNCH start "" cmd /c "timeout /t 3 >nul && start http://localhost:5173"

call npm run dev:all

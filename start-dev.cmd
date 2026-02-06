@echo off
setlocal

REM Starts backend + frontend in Windows Terminal tabs (single window).
REM Fallback: opens two cmd windows if Windows Terminal is unavailable.

where wt >nul 2>&1
if %ERRORLEVEL%==0 (
  wt -w 0 new-tab --title "Shopify Robot Backend" cmd /k "cd /d C:\Users\Alexander\lovable-shopify-robot-copy\server && npm install && node index.js" ^
    ; new-tab --title "Lovable Frontend" cmd /k "cd /d C:\Users\Alexander\lovable-shopify-robot-copy && npm install && npm run dev" ^
    ; new-tab --title "Cloudflared Tunnel" cmd /k "timeout /t 6 >nul && cloudflared tunnel run cartwheel"
  exit /b 0
)

start "Shopify Robot Backend" cmd /k "cd /d C:\Users\Alexander\lovable-shopify-robot-copy\server && npm install && node index.js"
start "Lovable Frontend" cmd /k "cd /d C:\Users\Alexander\lovable-shopify-robot-copy && npm install && npm run dev"
start "Cloudflared Tunnel" cmd /k "timeout /t 6 >nul && cloudflared tunnel run cartwheel"
endlocal

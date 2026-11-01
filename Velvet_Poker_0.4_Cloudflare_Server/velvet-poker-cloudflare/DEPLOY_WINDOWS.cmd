@echo off
setlocal
cd /d "%~dp0"
set WRANGLER_SEND_METRICS=false
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
echo Installing the pinned Cloudflare tools...
call npm ci --no-audit --no-fund
if errorlevel 1 goto failed
echo Sign in to YOUR Cloudflare account in the browser window.
call npx wrangler login
if errorlevel 1 goto failed
echo Deploying velvet-poker and its SQLite Durable Object...
call npx wrangler deploy
if errorlevel 1 goto failed
echo.
echo Open the workers.dev URL shown above, followed by /health.
echo Expected: ok=true, protocol=3, transport=websocket.
echo You can now close this window and turn off your laptop.
pause
exit /b 0
:failed
echo.
echo Deployment failed. Keep this window open and send the error text.
pause
exit /b 1

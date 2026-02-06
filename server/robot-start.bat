@echo off
setlocal EnableDelayedExpansion 

REM Always run from this folder
cd /d "%~dp0"

REM Load env vars from .env into this process (simple KEY=VALUE lines)
if exist ".env" (
  for /f "usebackq delims=" %%A in (".env") do (
    set "line=%%A"
    if not "!line!"=="" if "!line:~0,1!"=="#" (
      REM skip comments
    ) else (
      for /f "tokens=1,* delims==" %%K in ("%%A") do (
        set "%%K=%%L"
      )
    )
  )
)

REM Optional: force DEV_MODE off on startup (safer)
REM set DEV_MODE=false

REM Start the robot
node index.js


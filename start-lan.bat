@echo off
setlocal
cd /d "%~dp0"
title AI Study Coach - LAN Server

echo ============================================
echo   AI Study Coach  -  LAN Server
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 20+ first.
  echo.
  pause
  exit /b 1
)

if not exist ".next\BUILD_ID" (
  echo [1/2] Production build not found, building now...
  echo      This takes a few minutes on the first run.
  echo.
  call npm run build
  if errorlevel 1 (
    echo.
    echo [ERROR] Build failed. See the messages above.
    pause
    exit /b 1
  )
  echo.
)

echo [2/2] Starting server...
echo.
call npm run lan

echo.
echo Server stopped.
pause

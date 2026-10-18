@echo off
rem Same as start-lan.bat but without "pause" -- for Windows Task Scheduler autostart.
rem Logs go to .data\server.log so you can check what happened without a window.
setlocal
cd /d "%~dp0"
if not exist ".data" mkdir ".data"
if not exist ".next\BUILD_ID" (
  call npm run build >> ".data\server.log" 2>&1
)
call npm run lan >> ".data\server.log" 2>&1

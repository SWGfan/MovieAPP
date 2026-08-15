@echo off
title MovieAPP
cd /d "%~dp0apps\desktop"

where npm >nul 2>&1
if errorlevel 1 (
    echo.
    echo   Node.js isn't installed or this window can't see it yet.
    echo   Install it with:   winget install --id OpenJS.NodeJS.LTS -e --source winget
    echo   then close this window and double-click Start MovieAPP again.
    echo.
    pause
    exit /b 1
)

if not exist node_modules (
    echo Installing dependencies the first time this runs, please wait...
    call npm install
)

echo Starting MovieAPP...
call npm run dev
pause

@echo off
cd /d "%~dp0"
if exist "node\node.exe" (set "PATH=%~dp0node;%PATH%")
where node >nul 2>&1
if errorlevel 1 (
    echo Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)
node scripts/bootstrap.js
if errorlevel 1 (pause)

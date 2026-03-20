@echo off
cd /d "%~dp0"
echo Starting Daily Plan...

:: Check if port 8000 is already in use
netstat -ano | findstr ":8000 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo Port 8000 already in use, opening browser...
    start http://localhost:8000
    pause >nul
    exit /b
)

:: Install dependencies only if missing
pip show fastapi >nul 2>&1
if errorlevel 1 pip install -r requirements.txt -q

pip show uvicorn >nul 2>&1
if errorlevel 1 pip install -r requirements.txt -q

:: Start server in background
start /b uvicorn main:app --host 0.0.0.0 --port 8000

:: Wait for server (max 15 retries)
set RETRY=0
:wait
set /a RETRY+=1
if %RETRY% gtr 15 (
    echo Server failed to start. Please check for errors.
    pause
    exit /b 1
)
timeout /t 1 /nobreak >nul
curl -s http://localhost:8000/api/data >nul 2>&1
if errorlevel 1 goto wait

:: Open browser
start http://localhost:8000

echo Server is running. Close this window to stop.
pause >nul

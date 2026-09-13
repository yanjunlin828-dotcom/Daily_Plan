@echo off
cd /d "%~dp0"
echo Starting Daily Plan...

:: Check if port 8000 is already in use
netstat -ano | findstr ":8000 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    curl -fsS http://127.0.0.1:8000/api/health 2^>nul ^| findstr /C:"daily-plan" ^>nul
    if not errorlevel 1 (
        echo Daily Plan is already running, opening browser...
        start "" "http://localhost:8000/?desktop=%RANDOM%"
        exit /b 0
    )
    echo Port 8000 is occupied by another program. Daily Plan was not started.
    pause
    exit /b 1
)

:: Install dependencies only if missing
pip show fastapi >nul 2>&1
if errorlevel 1 pip install -r requirements.txt -q

pip show uvicorn >nul 2>&1
if errorlevel 1 pip install -r requirements.txt -q

:: Start server in background
start /b uvicorn main:app --host 127.0.0.1 --port 8000

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
curl -fsS http://127.0.0.1:8000/api/health 2>nul | findstr /C:"daily-plan" >nul
if errorlevel 1 goto wait

:: Open browser
start "" "http://localhost:8000/?desktop=%RANDOM%"

echo Server is running. Close this window to stop.
pause >nul

@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Pipeline Web App Launcher

REM =============================================================
REM  One-click launcher for the Pipeline Web App
REM  - Starts FastAPI + Socket.IO backend on http://localhost:8000
REM  - Starts React/Vite frontend on http://localhost:3000
REM  - Opens the webpage in your browser
REM =============================================================

cd /d "%~dp0"
set "ROOT=%~dp0"
set "BACKEND_DIR=%ROOT%backend"
set "FRONTEND_DIR=%ROOT%frontend"
set "APP_URL=http://localhost:3000"
set "BACKEND_URL=http://localhost:8000"

echo.
echo =============================================================
echo   Pipeline Web App Launcher
echo =============================================================
echo.

if not exist "%BACKEND_DIR%\main.py" (
    echo ERROR: backend\main.py not found.
    echo Make sure this RUN_WEB_APP.bat file is in the extracted project root.
    pause
    exit /b 1
)

if not exist "%FRONTEND_DIR%\package.json" (
    echo ERROR: frontend\package.json not found.
    echo Make sure this RUN_WEB_APP.bat file is in the extracted project root.
    pause
    exit /b 1
)

REM ---------- Find Python ----------
set "PY_CMD="
where py >nul 2>nul
if not errorlevel 1 (
    py -3.11 --version >nul 2>nul
    if not errorlevel 1 (
        set "PY_CMD=py -3.11"
    ) else (
        set "PY_CMD=py"
    )
) else (
    where python >nul 2>nul
    if not errorlevel 1 set "PY_CMD=python"
)

if "%PY_CMD%"=="" (
    echo ERROR: Python was not found.
    echo Install Python 3.11, tick "Add Python to PATH", then run this file again.
    echo Download: https://www.python.org/downloads/
    pause
    exit /b 1
)

REM ---------- Find Node/npm ----------
where npm >nul 2>nul
if errorlevel 1 (
    echo ERROR: npm was not found.
    echo Install Node.js LTS, then run this file again.
    echo Download: https://nodejs.org/
    pause
    exit /b 1
)

REM ---------- Display local network IP if available ----------
set "LOCAL_IP="
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /i "IPv4"') do (
    set "LOCAL_IP=%%A"
    set "LOCAL_IP=!LOCAL_IP: =!"
    goto got_ip
)
:got_ip

echo Python command : %PY_CMD%
echo Frontend URL   : %APP_URL%
if not "%LOCAL_IP%"=="" echo Network URL    : http://%LOCAL_IP%:3000
echo Backend URL    : %BACKEND_URL%
echo.
echo Two command windows will open:
echo   1. Backend Server
echo   2. Frontend Server
echo Do NOT close them while using the webpage.
echo.

REM ---------- Create temporary backend runner ----------
set "BACKEND_RUNNER=%TEMP%\pipeline_backend_runner_%RANDOM%.bat"
(
    echo @echo off
    echo title Backend Server - Pipeline Web App
    echo cd /d "%BACKEND_DIR%"
    echo echo.
    echo echo =============================================================
    echo echo   Backend Server - FastAPI + Socket.IO
    echo echo =============================================================
    echo echo.
    echo if not exist ".venv\Scripts\python.exe" ^(
    echo     echo Creating Python virtual environment...
    echo     %PY_CMD% -m venv .venv
    echo     if errorlevel 1 ^(
    echo         echo ERROR: Could not create Python virtual environment.
    echo         echo Use Python 3.11 if package installation fails.
    echo         pause
    echo         exit /b 1
    echo     ^)
    echo ^)
    echo echo Installing/checking backend packages...
    echo ".venv\Scripts\python.exe" -m pip install --upgrade pip
    echo ".venv\Scripts\python.exe" -m pip install -r requirements.txt
    echo if errorlevel 1 ^(
    echo     echo.
    echo     echo ERROR: Backend package installation failed.
    echo     echo Most likely cause: unsupported Python version.
    echo     echo Recommended: install Python 3.11 and run again.
    echo     pause
    echo     exit /b 1
    echo ^)
    echo echo.
    echo echo Backend starting at http://localhost:8000
    echo echo API docs: http://localhost:8000/docs
    echo echo.
    echo ".venv\Scripts\python.exe" -m uvicorn main:socket_app --reload --host 0.0.0.0 --port 8000
    echo pause
) > "%BACKEND_RUNNER%"

REM ---------- Create temporary frontend runner ----------
set "FRONTEND_RUNNER=%TEMP%\pipeline_frontend_runner_%RANDOM%.bat"
(
    echo @echo off
    echo title Frontend Server - Pipeline Web App
    echo cd /d "%FRONTEND_DIR%"
    echo echo.
    echo echo =============================================================
    echo echo   Frontend Server - React + Vite
    echo echo =============================================================
    echo echo.
    echo if not exist "node_modules" ^(
    echo     echo Installing frontend packages. First run may take a few minutes...
    echo     npm install
    echo     if errorlevel 1 ^(
    echo         echo ERROR: npm install failed.
    echo         echo Install Node.js LTS and run again.
    echo         pause
    echo         exit /b 1
    echo     ^)
    echo ^) else if not exist "node_modules\react-leaflet" ^(
    echo     echo Installing new map packages...
    echo     npm install
    echo     if errorlevel 1 ^(
    echo         echo ERROR: npm install failed.
    echo         echo Install Node.js LTS and run again.
    echo         pause
    echo         exit /b 1
    echo     ^)
    echo ^) else ^(
    echo     echo node_modules already exists. Skipping npm install.
    echo ^)
    echo echo.
    echo echo Frontend starting at http://localhost:3000
    echo echo.
    echo npm run dev -- --host 0.0.0.0 --port 3000
    echo pause
) > "%FRONTEND_RUNNER%"

REM ---------- Start servers ----------
start "Backend Server - DO NOT CLOSE" cmd /k call "%BACKEND_RUNNER%"
start "Frontend Server - DO NOT CLOSE" cmd /k call "%FRONTEND_RUNNER%"

echo Waiting for backend and frontend to become ready...

REM ---------- Wait for backend, then auto-start simulation ----------
for /l %%i in (1,1,90) do (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing '%BACKEND_URL%/health' -TimeoutSec 1 ^| Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
    if not errorlevel 1 (
        echo Backend is ready.
        powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-RestMethod -Method POST '%BACKEND_URL%/simulation/start' ^| Out-Null } catch { }" >nul 2>nul
        goto backend_ready
    )
    timeout /t 2 /nobreak >nul
)
echo WARNING: Backend did not respond yet. It may still be installing packages.
:backend_ready

REM ---------- Wait for frontend ----------
for /l %%i in (1,1,90) do (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing '%APP_URL%' -TimeoutSec 1 ^| Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
    if not errorlevel 1 (
        echo Frontend is ready.
        goto frontend_ready
    )
    timeout /t 2 /nobreak >nul
)
echo WARNING: Frontend did not respond yet. It may still be installing packages.
:frontend_ready

echo.
echo =============================================================
echo   Open this in your browser:
echo   %APP_URL%
if not "%LOCAL_IP%"=="" echo   Same Wi-Fi/LAN: http://%LOCAL_IP%:3000
echo =============================================================
echo.
echo Opening browser now...
start "" "%APP_URL%"
echo.
echo Keep this window open if you want to see the URLs.
echo Close the Backend and Frontend command windows to stop the app.
echo.
pause

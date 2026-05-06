@echo off
REM Kit dev : si decoupe.exe (build portable) est present, sinon Python / venv.
chcp 65001 >nul
cd /d "%~dp0"

if exist "%~dp0decoupe.exe" (
  "%~dp0decoupe.exe"
  goto :end
)

if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" "%~dp0split_e57_chunks.py"
  goto :end
)

py -3 "%~dp0split_e57_chunks.py" 2>nul
if errorlevel 1 python "%~dp0split_e57_chunks.py"

:end
echo.
pause

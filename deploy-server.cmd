@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\redeploy.ps1"
set "deploy_result=%errorlevel%"
echo.
pause
exit /b %deploy_result%

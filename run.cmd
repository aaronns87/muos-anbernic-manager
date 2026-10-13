@echo off
rem muOS Anbernic Manager for Windows: double-click to start, or run it in a terminal with the same options as run.sh.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
set "code=%errorlevel%"
if not "%code%"=="0" pause
exit /b %code%

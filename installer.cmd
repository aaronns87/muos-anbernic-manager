@echo off
rem muOS Anbernic Manager installer for Windows: double-click it, or run it in a terminal with the same options as installer.sh.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer.ps1" %*
set "code=%errorlevel%"
pause
exit /b %code%

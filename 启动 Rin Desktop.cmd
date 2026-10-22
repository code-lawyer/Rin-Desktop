@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0tools\project\launch.ps1" %*
exit /b %errorlevel%

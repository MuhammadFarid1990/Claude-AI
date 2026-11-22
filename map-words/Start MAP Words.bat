@echo off
setlocal
title MAP Words launcher
rem Opens the MAP Words slideshow locked full screen on the projector, and the control page on the laptop.
rem Close the projector slideshow with Alt+F4 (click on it first).

set "URL=https://map-words.vercel.app/"
set "PROFILE=%LOCALAPPDATA%\MAPWordsBrowser"

set "BROWSER="
for %%P in ("%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LocalAppData%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe") do (
  if not defined BROWSER if exist "%%~P" set "BROWSER=%%~P"
)
if not defined BROWSER (
  echo Could not find Google Chrome or Microsoft Edge on this computer.
  pause
  exit /b 1
)

rem Find the projector: the screen that is not the main laptop screen. Use a point in its middle.
set "PX=" & set "PY="
for /f "usebackq tokens=1,2" %%a in (`powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $s = [System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary } | Select-Object -First 1; if ($s) { '{0} {1}' -f ($s.Bounds.X + [int]($s.Bounds.Width / 2) - 200), ($s.Bounds.Y + [int]($s.Bounds.Height / 2) - 150) } else { 'none none' }"`) do (
  set "PX=%%a"
  set "PY=%%b"
)
if "%PX%"=="none" (
  echo.
  echo No projector found.
  echo Connect the projector, set Windows display to EXTEND ^(Windows key + P, choose Extend^), then run this again.
  echo.
  pause
  exit /b 1
)

echo Opening the slideshow on the projector...
start "" "%BROWSER%" --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --disable-session-crashed-bubble --noerrdialogs --window-position=%PX%,%PY% --window-size=400,300 --kiosk --app="%URL%?screen"
timeout /t 5 /nobreak >nul

echo Opening the control page on the laptop...
start "" "%BROWSER%" --user-data-dir="%PROFILE%" --new-window "%URL%"
exit /b 0

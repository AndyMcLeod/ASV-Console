@echo off
setlocal
title ASV Console - simulator

REM Launch the console in SIMULATOR mode. This is what the desktop shortcut runs.
REM
REM It locates the project from ITS OWN LOCATION (%~dp0), not a hardcoded path, so the
REM repo can be moved or cloned elsewhere and this still works - only the desktop
REM shortcut's target would need repointing.
cd /d "%~dp0"
if not exist "asv_console.py" goto :nofile

REM Go through PATH rather than a pinned interpreter. The Store build of Python lives
REM under a VERSION-STAMPED directory (...Python.3.11_qbz5n2kfra8p0...), so naming the
REM exe outright would break on the next Python upgrade; "python" keeps resolving.
REM "py" is the fallback for a standard python.org install without PATH set up.
where python >nul 2>&1 && (set PY=python) || (set PY=py)

echo  Starting the ASV console in SIMULATOR mode.
echo  The chart and controls windows will open in your browser.
echo.
echo  Leave this window open - it IS the console. Close it, or press
echo  Ctrl+C, to stop the simulator.
echo.
REM %* forwards anything passed through, so this one launcher also serves a variant
REM shortcut: add --vessel <id> for another hull, --port for a second console beside
REM this one, or --browser none to start headless. The desktop shortcut passes nothing.
%PY% asv_console.py --sim %*
goto :done

:nofile
echo  Could not find asv_console.py next to this script.
echo    looked in: %CD%
echo  If the project moved, move start_sim.bat with it.

:done
echo.
echo  The ASV console has stopped.
pause

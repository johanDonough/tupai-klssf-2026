@echo off
rem Starts the demo on this computer and opens it in the browser. Close this window to stop it.
cd /d "%~dp0"
start "" http://localhost:8026
python -m http.server 8026

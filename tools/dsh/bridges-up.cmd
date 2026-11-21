@echo off
rem bridges-up.cmd — portable launcher for the bridge supervisor (see tools/dsh/README.md)
rem Uses Node from PATH. For autostart via HKCU Run key + invisible.vbs, see README.
cd /d "%~dp0"
node register-all.js --watch >> "%USERPROFILE%\.cc-bridge\supervisor.out.log" 2>&1

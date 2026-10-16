@echo off
rem Start the merged bot with log capture (works from Task Scheduler too).
cd /d "%~dp0"
python -u run.py >> bot_stdout.log 2>> bot_stderr.log

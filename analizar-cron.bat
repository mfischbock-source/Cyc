@echo off
REM ── DASA C&C · Analisis automatico de llamadas (cron) ─────────────────────
REM Este .bat lo ejecuta el Programador de tareas de Windows cada X minutos.
REM Dejarlo en la MISMA carpeta que analizar_cron.php (la raiz del sitio CYC).

cd /d "%~dp0"
set CRON_BASE=http://127.0.0.1:10446

REM Si "php" no esta en el PATH, reemplazar por la ruta completa, ej:
REM   "C:\xampp\php\php.exe" analizar_cron.php
php analizar_cron.php >> cron-analisis.log 2>&1

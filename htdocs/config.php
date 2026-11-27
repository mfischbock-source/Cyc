<?php
/**
 * DASA — C&C Plataforma
 * Archivo de configuración del backend
 *
 * ⚠️  INSTRUCCIONES:
 * 1. Abrí este archivo en Hostinger → File Manager
 * 2. Completá cada campo marcado con  <-- COMPLETAR
 * 3. Guardá el archivo
 * 4. No compartas este archivo con nadie
 *
 * UBICACIÓN RECOMENDADA: mover este archivo FUERA del public_html
 * Por ejemplo: /home/usuario/config/dasa_config.php
 * Y actualizar el require_once en whatsapp.php y neotel_sql.php
 */

// ══════════════════════════════════════════════════════════════════════════
// SECRETOS — ya no viven hardcodeados en este archivo.
// Prioridad: 1) variable de entorno  2) ../secrets.local.php (fuera de htdocs)
// secrets.local.php NO se sube al server, NO se zipea, NO se comparte.
// En el server de DASA los valores pueden seguir en env vars o en su propio
// secrets.local.php un nivel arriba de la raíz del sitio.
// ══════════════════════════════════════════════════════════════════════════
$__DASA_SECRETS = @include __DIR__ . '/../secrets.local.php';
if (!is_array($__DASA_SECRETS)) { $__DASA_SECRETS = []; }
if (!function_exists('dasa_secret')) {
    function dasa_secret($key, $default = '') {
        $v = getenv($key);
        if ($v !== false && $v !== '') return $v;
        global $__DASA_SECRETS;
        return isset($__DASA_SECRETS[$key]) ? $__DASA_SECRETS[$key] : $default;
    }
}

// ══════════════════════════════════════════════════════════════════════════
// NEOTEL — CONEXIÓN A BASE DE DATOS SQL
// ══════════════════════════════════════════════════════════════════════════

// Modo de conexión a la base de Neotel. Define CÓMO se conecta el PHP:
//   'odbc_dsn'  → usa un DSN ODBC ya creado en el server (ASÍ CONECTA HOY EL SERVER DE DASA: DSN "NeotelDASA").
//   'odbc'      → ODBC sin DSN previo, armando la cadena desde host/puerto/base de abajo.
//   'sqlsrv'    → driver nativo de Microsoft (pdo_sqlsrv). Requiere la extensión instalada.
//   'mysql' | 'pgsql' | 'dblib' → conexión PDO estándar.
// (En dev local sobre VPN se fuerza 'dblib' por variable de entorno; en el server NO está esa env.)
define('NEOTEL_DB_DRIVER',  'odbc_dsn');                  // server DASA: mantiene la conexión original que ya funcionaba

// Para 'odbc_dsn': nombre EXACTO del DSN ODBC configurado en el server (el código original usaba "NeotelDASA").
define('NEOTEL_ODBC_DSN',   'NeotelDASA');                // <-- no cambiar salvo que el server use otro nombre de DSN

// Solo para 'odbc' (DSN-less): nombre del driver ODBC instalado en el server.
define('NEOTEL_ODBC_DRIVER', 'ODBC Driver 17 for SQL Server');

// Host o IP del servidor de base de datos de Neotel
define('NEOTEL_DB_HOST',    '192.168.0.202');      // <-- COMPLETAR

// Nombre de la base de datos
define('NEOTEL_DB_NAME',    'TEL_LOGS');    // <-- COMPLETAR

// Usuario de la base de datos
define('NEOTEL_DB_USER',    'SQLUSER');        // <-- COMPLETAR

// Contraseña de la base de datos (vive en secrets.local.php / env var)
define('NEOTEL_DB_PASS',    dasa_secret('NEOTEL_DB_PASS'));

// Puerto (3306 para MySQL, 1433 para SQL Server, 5432 para PostgreSQL)
define('NEOTEL_DB_PORT',    2133);                       // <-- COMPLETAR si es distinto

// ══════════════════════════════════════════════════════════════════════════
// ANTHROPIC (CLAUDE) — ANÁLISIS IA DE LLAMADAS (Speech Analytics)
// ══════════════════════════════════════════════════════════════════════════

// API key de Anthropic. NUNCA exponer al frontend. Vive en secrets.local.php / env var.
define('ANTHROPIC_API_KEY', dasa_secret('ANTHROPIC_API_KEY'));

// Modelo a usar. DEFAULT: 'claude-haiku-4-5' (barato). Para máxima calidad: 'claude-opus-4-8'
// (5x más caro). Intermedio: 'claude-sonnet-4-6'. El "Análisis profundo" del frontend usa Opus a pedido.
define('ANALISIS_MODELO', 'claude-haiku-4-5');

// ── Alerta automática de salud del cron ──────────────────────────────────────
// Si el cron pasa ALERTA_HORAS sin producir NINGÚN análisis válido, avisa por Telegram
// (esto habría avisado el corte del 1/9). El token/chat viven en Firestore configuracion/alertas
// (campos telegram_bot_token / telegram_chat_id — doc que el frontend NO lee), o en secrets.local.php:
//   define('TELEGRAM_BOT_TOKEN', '123456:ABC...');   define('TELEGRAM_CHAT_ID', '12345678');
//   ← sin token/chat, la alerta no se envía (solo queda en el log).
if (!defined('ALERTA_HORAS')) define('ALERTA_HORAS', 24);   // horas sin válidas antes de avisar

// API key de OpenAI para transcribir los audios con Whisper. Vive en secrets.local.php / env var.
define('OPENAI_API_KEY', dasa_secret('OPENAI_API_KEY'));

// Motor de transcripción: 'openai' (Whisper API, PAGO) | 'local' (whisper.cpp, GRATIS).
define('TRANSCRIPTOR', 'openai');
// Solo para 'local': ruta al binario whisper-cli y al modelo ggml (.bin).
define('WHISPER_BIN',   '/opt/homebrew/bin/whisper-cli');
define('WHISPER_MODEL', '/Users/ramirofischbock/Downloads/dasa-cyc/whisper-models/ggml-medium-q5_0.bin');   // ej: '/ruta/ggml-base.bin' (o small/medium para mejor calidad)

// ══════════════════════════════════════════════════════════════════════════
// RAPIWHA — ENVÍO DE WHATSAPP
// ══════════════════════════════════════════════════════════════════════════

// Tu API Key de RapiWha. Vive en secrets.local.php / env var.
define('RAPIWHA_API_KEY',   dasa_secret('RAPIWHA_API_KEY'));

// Endpoint de RapiWha (no cambiar salvo que RapiWha indique otro)
define('RAPIWHA_ENDPOINT',  'https://panel.rapiwha.com/send_message.php');

// ══════════════════════════════════════════════════════════════════════════
// SEGURIDAD
// ══════════════════════════════════════════════════════════════════════════

// Dominio de la plataforma (para CORS — no cambiar)
define('ALLOWED_ORIGIN',    'https://cyc.dasaargentina.com');

// ID del proyecto Firebase (no cambiar)
define('FIREBASE_PROJECT_ID', 'dasa-calidad');

// ── NEOTEL — RUTAS DE AUDIOS (NAS) ───────────────────────────────────────
// Carpeta con MP3 sueltos (grabaciones recientes)
define('NEOTEL_AUDIO_PATH',     '\\\\NAS-QNAP\\Public\\RESPALDOS\\NEOTEL\\MONITOREO');

// Carpeta con ZIPs (grabaciones históricas)
define('NEOTEL_AUDIO_ZIP_PATH', '\\\\NAS-QNAP\\Public\\RESPALDOS\\NEOTEL\\MONITOREO_ZIP');

// Token de seguridad para el endpoint de audio. Vive en secrets.local.php / env var.
// OJO: también está en index.html (el frontend lo necesita) — no es secreto frente al usuario final.
define('AUDIO_TOKEN', dasa_secret('AUDIO_TOKEN'));

// Token compartido para el endpoint neotel_sql.php (debe coincidir con NEOTEL_TOKEN en index.html).
// Cierra el acceso directo por curl/scripts desde la LAN. Vive en secrets.local.php / env var.
define('NEOTEL_API_TOKEN', dasa_secret('NEOTEL_API_TOKEN'));

define('FIREBASE_API_KEY', 'AIzaSyDfF_nq-LIxj-a-y5gYt1Dm3S3MH88lYyM');

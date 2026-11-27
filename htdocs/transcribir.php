<?php
/**
 * DASA — C&C  ·  Transcripción de llamadas (OpenAI Whisper)
 * ───────────────────────────────────────────────────────────────────────────
 * Recibe el nombre de la GRABACIÓN, lee el audio del NAS y lo manda a Whisper
 * para obtener el texto. El frontend guarda la transcripción en Firestore para
 * no volver a transcribir la misma llamada (Whisper se paga por minuto).
 */

require_once __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
$origin  = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = [ALLOWED_ORIGIN, 'https://cyc.dasaargentina.com', 'http://localhost', 'http://127.0.0.1', 'http://192.168.0.245'];
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowed) ? $origin : ALLOWED_ORIGIN));
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-DASA-Token');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Metodo no permitido']); exit;
}

$body = json_decode(file_get_contents('php://input'), true) ?? [];

require_once __DIR__ . '/cyc_auth.php';   // sesión de Firebase o cron local
cyc_requerir('usuario');
// Motor de transcripción: OpenAI (Whisper API) como PRINCIPAL por calidad y velocidad.
// Si OpenAI falla o se queda SIN CRÉDITO, cae automáticamente al motor LOCAL gratis
// (whisper.cpp, con el mejor modelo instalado en el server). Si el local no está
// instalado, se devuelve un mensaje claro para que lo instalen. Así el análisis nunca
// queda en cero por falta de crédito. (El 'motor' del frontend y TRANSCRIPTOR se ignoran:
// el flujo es siempre OpenAI→local.)
$tieneOpenAI = defined('OPENAI_API_KEY') && OPENAI_API_KEY !== '';

// ── Localizar el audio en el NAS ────────────────────────────────────────────
$file = $body['file'] ?? '';
if (!preg_match('/^[\w\-\.]+\.(wav|mp3)$/i', $file)) {
    http_response_code(400); echo json_encode(['error' => 'Nombre de archivo inválido']); exit;
}
$audioBase = getenv('DASA_AUDIO_PATH_LOCAL') ?: NEOTEL_AUDIO_PATH;
$path = $audioBase . '/' . $file;
$tmpExtraido = null;
if (!is_file($path)) {
    // No está suelto en MONITOREO → buscar en los ZIP archivados (como audio.php)
    $zipBase = getenv('DASA_AUDIO_PATH_LOCAL')
        ? str_replace('MONITOREO', 'MONITOREO_ZIP', getenv('DASA_AUDIO_PATH_LOCAL'))
        : NEOTEL_AUDIO_ZIP_PATH;
    $path = buscarEnZips($zipBase, $file);
    if (!$path) {
        http_response_code(404); echo json_encode(['error' => 'Audio no encontrado en el NAS (ni suelto ni en ZIP): ' . htmlspecialchars($file)]); exit;
    }
    $tmpExtraido = $path; // se borra después de enviarlo a Whisper
}

// ── 1) PRINCIPAL: Whisper API de OpenAI (multipart) ─────────────────────────
$openaiOk = false; $openaiMotivo = 'OpenAI no configurado'; $texto = '';
if ($tieneOpenAI) {
    $ext  = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    $mime = $ext === 'wav' ? 'audio/wav' : 'audio/mpeg';
    $post = [
        'file'            => new CURLFile($path, $mime, $file),
        'model'           => 'whisper-1',
        'language'        => 'es',                 // español → mejor precisión
        'response_format' => 'json',
        // Contexto de dominio → Whisper acierta mejor con el vocabulario de cobranzas.
        'prompt'          => 'Llamada de cobranzas del estudio DASA en representación de un banco (Santander, Galicia). Se habla de mora, deuda de tarjeta de crédito, quita, plan de pagos, cuotas, honorarios, CBU, compromiso de pago y validación de identidad con DNI.',
    ];
    $ch = curl_init('https://api.openai.com/v1/audio/transcriptions');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . OPENAI_API_KEY],
        CURLOPT_POSTFIELDS     => $post,
        CURLOPT_TIMEOUT        => 180,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $resp     = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr  = curl_error($ch);
    $data     = $resp ? json_decode($resp, true) : null;
    $openaiOk = !$curlErr && $httpCode >= 200 && $httpCode < 300 && !isset($data['error']);
    if ($openaiOk) {
        $texto = $data['text'] ?? '';
    } else {
        $openaiMotivo = $curlErr ?: ($data['error']['message'] ?? ('HTTP ' . $httpCode));
        error_log('[transcribir] OpenAI falló: ' . $openaiMotivo);
    }
}

// ── 2) FALLBACK gratis: whisper.cpp local (si OpenAI no anduvo / sin crédito) ─
$motor = 'openai';
if (!$openaiOk) {
    try {
        $texto = transcribirLocal($path);                     // usa el MEJOR modelo instalado
        $motor = 'whisper.cpp local (fallback)';
        error_log('[transcribir] OpenAI no disponible (' . $openaiMotivo . '), usé el motor local gratis.');
    } catch (Throwable $e) {
        if ($tmpExtraido) @unlink($tmpExtraido);
        $msg = $e->getMessage();
        http_response_code(502);
        if (stripos($msg, 'instalad') !== false) {
            // ni OpenAI ni el motor gratis: el local no está instalado en el server
            echo json_encode(['error' => 'No está instalado el modelo de transcripción gratis en el servidor. (OpenAI tampoco disponible: ' . $openaiMotivo . '.)']);
        } else {
            echo json_encode(['error' => 'OpenAI no disponible (' . $openaiMotivo . ') y el motor gratis falló al transcribir (' . $msg . ').']);
        }
        exit;
    }
}

if ($tmpExtraido) @unlink($tmpExtraido); // borrar el temp extraído del ZIP
echo json_encode([
    'ok'            => true,
    'transcripcion' => $texto,
    'archivo'       => $file,
    'motor'         => $motor,
], JSON_UNESCAPED_UNICODE);

// ── Buscar un audio dentro de los ZIP archivados (igual que audio.php) ──────
function buscarEnZips(string $zipDir, string $audioName): ?string {
    if (!is_dir($zipDir)) return null;
    preg_match('/(\d{8})\d{6}\.(wav|mp3)$/i', $audioName, $m);
    $fecha = $m[1] ?? null;
    // Filtrar por fecha DIRECTO en el patrón del glob → por SMB el server devuelve solo
    // los ZIP del día (no enumera los miles del archivo). Clave para que NO se cuelgue por VPN.
    if ($fecha) {
        $y = substr($fecha, 0, 4); $mo = substr($fecha, 4, 2); $d = substr($fecha, 6, 2);
        $zips = glob($zipDir . '/*' . $y.'_'.$mo.'_'.$d . '*.zip');
        if (!$zips) $zips = glob($zipDir . '/*' . $y.$mo.$d . '*.zip');
    } else {
        $zips = glob($zipDir . '/*.zip');
    }
    if (!$zips) return null;
    $tmpDir = sys_get_temp_dir() . '/dasa_trans_' . uniqid();
    @mkdir($tmpDir);
    foreach ($zips as $zipPath) {
        $zip = new ZipArchive();
        if ($zip->open($zipPath) !== true) continue;
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $entry = $zip->getNameIndex($i);
            if (basename($entry) === $audioName) {
                $zip->extractTo($tmpDir, $entry);
                $zip->close();
                $ex = $tmpDir . '/' . $entry;
                if (is_file($ex)) return $ex;
            }
        }
        $zip->close();
    }
    @rmdir($tmpDir);
    return null;
}

// ── Elegir el MEJOR modelo whisper.cpp instalado (large > medium > small > base > tiny) ──
function mejorModeloWhisper(): ?string {
    // 1) explícito por WHISPER_MODEL (env o config.php)
    $m = getenv('WHISPER_MODEL') ?: (defined('WHISPER_MODEL') ? WHISPER_MODEL : '');
    if ($m && is_file($m)) return $m;
    // 2) auto: buscar ggml-*.bin en carpetas conocidas y quedarse con el de mejor calidad
    $dirs = [];
    $d = getenv('WHISPER_MODEL_DIR') ?: (defined('WHISPER_MODEL_DIR') ? WHISPER_MODEL_DIR : '');
    if ($d) $dirs[] = $d;
    $dirs[] = __DIR__ . '/whisper-models';
    $dirs[] = dirname(__DIR__) . '/whisper-models';
    $dirs[] = 'C:/whisper/models';
    $dirs[] = '/opt/homebrew/share/whisper-cpp';
    $rank = ['large' => 5, 'medium' => 4, 'small' => 3, 'base' => 2, 'tiny' => 1];
    $best = null; $bestScore = -1;
    foreach ($dirs as $dir) {
        if (!is_dir($dir)) continue;
        foreach ((glob($dir . '/ggml-*.bin') ?: []) as $f) {
            $name = strtolower(basename($f));
            $score = 0.0;
            foreach ($rank as $k => $v) { if (strpos($name, $k) !== false) { $score = $v; break; } }
            if (strpos($name, '.en') !== false) $score -= 0.5;   // preferir multilingüe (español), no los .en
            if ($score > $bestScore) { $bestScore = $score; $best = $f; }
        }
    }
    return $best;
}

// ── Transcripción con whisper.cpp local (gratis) ────────────────────────────
function transcribirLocal(string $path): string {
    if (dasa_secret('WHISPER_LOCAL') !== 'si') throw new Exception('el respaldo Whisper local quedó desactivado');   // tumbaba la VM (24/11/2026)
    $bin = getenv('WHISPER_BIN') ?: (defined('WHISPER_BIN') ? WHISPER_BIN : '/opt/homebrew/bin/whisper-cli');
    if (!is_file($bin)) throw new Exception('whisper-cli no está instalado en el servidor (WHISPER_BIN: ' . $bin . ')');
    $model = mejorModeloWhisper();
    if (!$model) throw new Exception('no está instalado ningún modelo de transcripción gratis en el servidor (poné el ggml-*.bin en la carpeta whisper-models o definí WHISPER_MODEL)');

    // 1) convertir a 16kHz mono WAV (whisper.cpp lo necesita). afconvert (mac) o ffmpeg.
    $wav = sys_get_temp_dir() . '/dasa_w_' . uniqid() . '.wav';
    $ok = false;
    if (is_file('/usr/bin/afconvert')) {
        exec('/usr/bin/afconvert -f WAVE -d LEI16@16000 -c 1 ' . escapeshellarg($path) . ' ' . escapeshellarg($wav) . ' 2>&1', $o1, $rc1);
        $ok = ($rc1 === 0 && is_file($wav));
    }
    if (!$ok) {
        $ffmpeg = getenv('FFMPEG_BIN') ?: (defined('FFMPEG_BIN') ? FFMPEG_BIN : 'ffmpeg');
        exec(escapeshellarg($ffmpeg) . ' -y -i ' . escapeshellarg($path) . ' -ar 16000 -ac 1 ' . escapeshellarg($wav) . ' 2>&1', $o2, $rc2);
        $ok = ($rc2 === 0 && is_file($wav));
    }
    if (!$ok) throw new Exception('no se pudo convertir el audio a 16kHz (afconvert/ffmpeg)');

    // 2) whisper.cpp
    // -mc 0 (max-context 0): evita el loop de alucinacion de whisper.cpp (repite "(Celular)"/silencio) en
    // llamadas con tono o musica al inicio; cada ventana de 30s se decodifica sin arrastrar texto de la anterior.
    // Descartar stderr de forma CROSS-PLATFORM: en Windows es 2>nul, en Mac/Linux 2>/dev/null.
    // (Con 2>/dev/null en Windows, cmd falla al redirigir y whisper devuelve "codigo 1" sin correr.)
    $redir = (stripos(PHP_OS, 'WIN') === 0) ? '2>nul' : '2>/dev/null';
    exec(escapeshellarg($bin) . ' -m ' . escapeshellarg($model) . ' -f ' . escapeshellarg($wav) . ' -l es -nt -mc 0 ' . $redir, $out, $rc3);
    @unlink($wav);
    if ($rc3 !== 0) throw new Exception('whisper.cpp devolvió error (codigo ' . $rc3 . ')');

    return trim(implode(' ', array_map('trim', $out)));
}

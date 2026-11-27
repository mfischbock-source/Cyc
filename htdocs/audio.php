<?php
/**
 * DASA — Servidor de audios Neotel
 * Sirve las grabaciones (.wav / .mp3) desde el NAS como stream seguro.
 * URL: http://localhost/audio.php?file=1540351348-227425930-20260601194834.wav&token=TOKEN
 *
 * NOTA: las grabaciones del NAS (backup diario de Neotel) están en formato .wav
 * (GSM 6.10). Las del día en curso pueden figurar como .mp3 en la base hasta que
 * el backup nocturno las archiva. Por eso se aceptan ambas extensiones.
 */

require_once __DIR__ . '/config.php';

// ── SEGURIDAD ─────────────────────────────────────────────────────────────
// Antes: ?token= fijo (estaba en el JS público). Ahora: cookie de sesión (ver cyc_auth.php).
// El ?token= que todavía mande el front se ignora.
require_once __DIR__ . '/cyc_auth.php';
cyc_requerir('usuario');

$file = $_GET['file'] ?? '';

// Solo permitir nombres de archivo válidos (sin rutas, sin ..). Acepta .wav y .mp3.
if (!preg_match('/^[\w\-\.]+\.(wav|mp3)$/i', $file)) {
    http_response_code(400);
    die('Nombre de archivo inválido');
}

// ── BUSCAR EL ARCHIVO ─────────────────────────────────────────────────────
// DEV LOCAL: si está la env DASA_AUDIO_PATH_LOCAL (NAS montado en la Mac), se usa
// esa ruta. En producción la env no está → usa el UNC del config.
$audioBase = getenv('DASA_AUDIO_PATH_LOCAL') ?: NEOTEL_AUDIO_PATH;
// Primero en MONITOREO (archivos sueltos), luego buscar en ZIPs si no está
$path_monitoreo = $audioBase . '/' . $file;
$path_zip_dir   = NEOTEL_AUDIO_ZIP_PATH;

if (file_exists($path_monitoreo)) {
    // Archivo directo disponible
    servirAudio($path_monitoreo, $file);
} else {
    // Buscar en ZIPs — extraer el archivo al vuelo
    $audio = buscarEnZips($path_zip_dir, $file);
    if ($audio) {
        servirAudio($audio, $file, true); // true = borrar temp después
    } else {
        http_response_code(404);
        die('Audio no encontrado: ' . htmlspecialchars($file));
    }
}

// ── FUNCIONES ─────────────────────────────────────────────────────────────
function servirAudio(string $path, string $filename, bool $deleteAfter = false): void {
    $size = filesize($path);

    // Content-Type según la extensión real del archivo
    $ext  = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    $mime = $ext === 'wav' ? 'audio/wav' : 'audio/mpeg';

    // Soporte para range requests (permite adelantar en el reproductor)
    $start = 0;
    $end   = $size - 1;
    $length = $size;

    if (isset($_SERVER['HTTP_RANGE'])) {
        preg_match('/bytes=(\d+)-(\d*)/', $_SERVER['HTTP_RANGE'], $matches);
        $start  = (int)$matches[1];
        $end    = !empty($matches[2]) ? (int)$matches[2] : $size - 1;
        $length = $end - $start + 1;
        http_response_code(206);
        header("Content-Range: bytes $start-$end/$size");
    }

    header('Content-Type: ' . $mime);
    header('Content-Length: ' . $length);
    header('Accept-Ranges: bytes');
    header('Content-Disposition: inline; filename="' . $filename . '"');
    header('Cache-Control: no-cache');

    $fp = fopen($path, 'rb');
    fseek($fp, $start);
    $remaining = $length;
    while ($remaining > 0 && !feof($fp)) {
        $chunk = min(8192, $remaining);
        echo fread($fp, $chunk);
        $remaining -= $chunk;
        flush();
    }
    fclose($fp);

    if ($deleteAfter) @unlink($path);
    exit;
}

function buscarEnZips(string $zipDir, string $audioName): ?string {
    if (!is_dir($zipDir)) return null;

    // Extraer fecha del nombre para filtrar ZIPs del mismo día
    // formato: TELEFONO-IDLLAMADA-YYYYMMDDHHMMSS.(wav|mp3)
    preg_match('/(\d{8})\d{6}\.(wav|mp3)$/i', $audioName, $m);
    $fecha = $m[1] ?? null; // ej: 20260601

    // Filtrar por fecha DIRECTO en el patrón del glob → por SMB el server devuelve solo
    // los ZIP del día (no enumera los miles del archivo). Evita que se cuelgue por VPN.
    if ($fecha) {
        $year  = substr($fecha, 0, 4);
        $month = substr($fecha, 4, 2);
        $day   = substr($fecha, 6, 2);
        $zips = glob($zipDir . '/*' . $year.'_'.$month.'_'.$day . '*.zip');
        if (!$zips) $zips = glob($zipDir . '/*' . $year.$month.$day . '*.zip');
    } else {
        $zips = glob($zipDir . '/*.zip');
    }
    if (!$zips) return null;

    $tmpDir = sys_get_temp_dir() . '/dasa_audio_' . uniqid();
    mkdir($tmpDir);

    foreach ($zips as $zipPath) {
        $zip = new ZipArchive();
        if ($zip->open($zipPath) !== true) continue;

        for ($i = 0; $i < $zip->numFiles; $i++) {
            $entry = $zip->getNameIndex($i);
            if (basename($entry) === $audioName) {
                $zip->extractTo($tmpDir, $entry);
                $zip->close();
                $extracted = $tmpDir . '/' . $entry;
                if (file_exists($extracted)) return $extracted;
            }
        }
        $zip->close();
    }

    @rmdir($tmpDir);
    return null;
}

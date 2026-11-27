<?php
/**
 * DASA — C&C · lib_audio.php
 * ───────────────────────────────────────────────────────────────────────────
 * Localización de audios del NAS, compartida por audio.php (reproductor) y
 * transcribir.php (envío a Whisper). Antes cada uno tenía su propia copia de
 * "buscar en los ZIP" (duplicado); ahora es una sola función con cache de lo
 * extraído para no volver a golpear el ZIP por SMB en cada pedido de la misma
 * llamada (punto 14f de PLAN-MARIANA.md).
 *
 * Requiere config.php ya cargado (usa NEOTEL_AUDIO_PATH / NEOTEL_AUDIO_ZIP_PATH
 * si no hay override local).
 */

// Carpeta de cache de audios extraídos de ZIP. Se crea si no existe.
function _audioCacheDir(): string {
    $dir = sys_get_temp_dir() . '/dasa_audio_cache';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    return $dir;
}

// Borra del cache los archivos con más de $maxEdadSeg (default 24 h). Devuelve cuántos borró.
function limpiarAudioCacheViejo(string $cacheDir, int $maxEdadSeg = 86400): int {
    $borrados = 0;
    foreach ((glob($cacheDir . '/*') ?: []) as $f) {
        if (!is_file($f) || basename($f) === '.limpiado') continue;
        if ((time() - filemtime($f)) > $maxEdadSeg) { @unlink($f); $borrados++; }
    }
    return $borrados;
}

// TOPE DE TAMAÑO del cache (el server ya se quedó sin disco una vez): si se pasa de
// AUDIO_CACHE_MAX_MB (default 800 MB), borra los más viejos hasta quedar en el 80 %.
// Se llama después de cada extracción: la pasada profunda del cron extrae cientos de ZIP por día.
function limitarTamanoAudioCache(string $cacheDir, int $maxBytes = 0): int {
    if ($maxBytes <= 0) $maxBytes = (defined('AUDIO_CACHE_MAX_MB') ? (int) AUDIO_CACHE_MAX_MB : 800) * 1024 * 1024;
    $arch = []; $total = 0;
    foreach ((glob($cacheDir . '/*') ?: []) as $f) {
        if (!is_file($f) || basename($f) === '.limpiado') continue;
        $t = (int) @filesize($f); $total += $t; $arch[] = [$f, (int) @filemtime($f), $t];
    }
    if ($total <= $maxBytes) return 0;
    usort($arch, function ($a, $b) { return $a[1] - $b[1]; });   // más viejos primero
    $borrados = 0; $meta = (int) ($maxBytes * 0.8);
    foreach ($arch as $x) { if ($total <= $meta) break; if (@unlink($x[0])) { $total -= $x[2]; $borrados++; } }
    return $borrados;
}

// Limpia el cache "de vez en cuando" (como mucho 1 vez por hora): evita escanear la
// carpeta en CADA pedido de audio/transcripción, que son los más frecuentes del sitio.
function _audioCacheLimpiarSiCorresponde(string $cacheDir): void {
    $marker = $cacheDir . '/.limpiado';
    if (is_file($marker) && (time() - filemtime($marker)) < 3600) return;
    limpiarAudioCacheViejo($cacheDir);
    @touch($marker);
}

/**
 * Busca un audio por nombre de archivo y devuelve la ruta local lista para leer,
 * o null si no se encontró. Orden:
 *   1) Suelto en MONITOREO (o DASA_AUDIO_PATH_LOCAL en dev).
 *   2) Cache de extracciones previas del ZIP (<24 h) — evita re-extraer.
 *   3) ZIP del día (glob filtrado por fecha, como antes) con
 *      ZipArchive::locateName() en vez de recorrer los miles de entradas.
 * NO borra nada: el archivo cacheado se reutiliza; lo vieja se limpia aparte.
 */
function buscarAudio(string $file): ?string {
    // Defensivo: aunque los callers ya validan esto, nunca confiar en el nombre a ciegas.
    if (!preg_match('/^[\w\-\.]+\.(wav|mp3)$/i', $file)) return null;

    // 1) Suelto en MONITOREO
    $audioBase = getenv('DASA_AUDIO_PATH_LOCAL') ?: (defined('NEOTEL_AUDIO_PATH') ? NEOTEL_AUDIO_PATH : '');
    if ($audioBase !== '') {
        $suelto = $audioBase . '/' . $file;
        if (is_file($suelto)) return $suelto;
    }

    // 2) Cache de lo ya extraído (evita volver a tocar el ZIP por SMB)
    $cacheDir  = _audioCacheDir();
    _audioCacheLimpiarSiCorresponde($cacheDir);
    $cachePath = $cacheDir . '/' . $file;
    if (is_file($cachePath) && (time() - filemtime($cachePath)) < 86400) {
        return $cachePath;
    }

    // 3) ZIP del día
    $zipBase = getenv('DASA_AUDIO_PATH_LOCAL')
        ? str_replace('MONITOREO', 'MONITOREO_ZIP', getenv('DASA_AUDIO_PATH_LOCAL'))
        : (defined('NEOTEL_AUDIO_ZIP_PATH') ? NEOTEL_AUDIO_ZIP_PATH : '');
    if ($zipBase === '' || !is_dir($zipBase)) return null;

    // Filtrar por fecha DIRECTO en el patrón del glob → por SMB el server devuelve solo
    // los ZIP del día (no enumera los miles del archivo). Clave para que NO se cuelgue por VPN.
    preg_match('/(\d{8})\d{6}\.(wav|mp3)$/i', $file, $m);
    $fecha = $m[1] ?? null;
    if ($fecha) {
        $y = substr($fecha, 0, 4); $mo = substr($fecha, 4, 2); $d = substr($fecha, 6, 2);
        $zips = glob($zipBase . '/*' . $y . '_' . $mo . '_' . $d . '*.zip');
        if (!$zips) $zips = glob($zipBase . '/*' . $y . $mo . $d . '*.zip');
    } else {
        $zips = glob($zipBase . '/*.zip');
    }
    if (!$zips) return null;

    foreach ($zips as $zipPath) {
        $zip = new ZipArchive();
        if ($zip->open($zipPath) !== true) continue;
        // locateName en vez de recorrer numFiles a mano: el propio ZipArchive resuelve el
        // índice (y FL_NODIR ignora la carpeta del entry, por si el ZIP lo guardó en una subcarpeta).
        $idx = $zip->locateName($file, ZipArchive::FL_NODIR);
        if ($idx === false) { $zip->close(); continue; }
        $entry = $zip->getNameIndex($idx);
        $ok = $zip->extractTo($cacheDir, $entry);
        $zip->close();
        if (!$ok) continue;
        $extraido = $cacheDir . '/' . $entry;
        if (!is_file($extraido)) continue;
        if ($extraido !== $cachePath) { // el ZIP lo guardaba en una subcarpeta: aplanar al nombre plano
            @rename($extraido, $cachePath);
            if (is_file($cachePath)) { @touch($cachePath); limitarTamanoAudioCache($cacheDir); return is_file($cachePath) ? $cachePath : null; }
        }
        @touch($extraido); limitarTamanoAudioCache($cacheDir);
        return is_file($extraido) ? $extraido : null;
    }
    return null;
}

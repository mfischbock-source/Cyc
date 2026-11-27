<?php
/**
 * DASA — C&C · Desactiva el Whisper local como respaldo (tumbaba la VM). Se corre en el server, por consola:
 *
 *   php desactivar_whisper_local.php C:\xampp\htdocs            → muestra qué va a cambiar (no escribe)
 *   php desactivar_whisper_local.php C:\xampp\htdocs --aplicar  → hace backup y aplica
 *
 * Agrega UNA línea al principio de transcribirLocal(); no pisa el archivo. Si OpenAI falla, la llamada
 * queda sin transcribir y el cron la reintenta. Se puede volver a activar sin tocar código, con
 * 'WHISPER_LOCAL' => 'si' en secrets.local.php. Es idempotente.
 */
if (php_sapi_name() !== 'cli') { http_response_code(403); exit("Solo por línea de comandos.\n"); }

$dir = rtrim($argv[1] ?? '', '\\/');
$aplicar = in_array('--aplicar', $argv, true);
if ($dir === '' || !is_file("$dir/config.php")) exit("Uso: php desactivar_whisper_local.php <carpeta htdocs> [--aplicar]\n(no encontré config.php en '$dir')\n");

const MARCA = "dasa_secret('WHISPER_LOCAL')";
// OJO con el texto: analizar_cron.php DESCARTA para siempre si el error contiene "corta", "vac", "short",
// "empty" o "demasiado", y lo toma como audio faltante si contiene "nas" o "no encontrado".
const LINEA = "    if (" . MARCA . " !== 'si') throw new Exception('el respaldo Whisper local quedó desactivado');   // tumbaba la VM (24/11/2026)";
$patron = '/function\s+transcribirLocal\s*\([^)]*\)\s*(?::\s*\??\w+\s*)?\{/';

$encontrados = [];
foreach (array_merge(glob("$dir/*.php") ?: [], glob("$dir/v2/api/*.php") ?: []) as $ruta) {
    $src = file_get_contents($ruta);
    $n = preg_match_all($patron, $src);
    if ($n) $encontrados[] = [$ruta, $src, $n];
    foreach (explode("\n", $src) as $i => $l) {
        if (preg_match('/whisper-cli|WHISPER_BIN/i', $l) && basename($ruta) !== 'config.php') echo "  (info) " . basename($ruta) . ':' . ($i + 1) . "  usa Whisper local\n";
    }
}
if (count($encontrados) !== 1 || $encontrados[0][2] !== 1) {
    echo "\nNO SE CAMBIÓ NADA: esperaba una sola función transcribirLocal() y encontré " . array_sum(array_column($encontrados, 2)) . ".\nMandale esta salida a Ramiro.\n";
    exit(1);
}
[$ruta, $src] = $encontrados[0];
if (strpos($src, MARCA) !== false) { echo "\nYa estaba aplicado en " . basename($ruta) . ".\n"; exit(0); }
echo "\na cambiar   " . basename($ruta) . "\n";
if (!$aplicar) { echo "Todo en orden. Para aplicar: agregá --aplicar al final.\n"; exit(0); }

$eol = strpos($src, "\r\n") !== false ? "\r\n" : "\n";
$nuevo = preg_replace_callback($patron, function ($m) use ($eol) { return $m[0] . $eol . LINEA; }, $src, 1);
$bak = dirname($dir) . DIRECTORY_SEPARATOR . 'backup-whisper-' . date('Ymd-His');
@mkdir($bak, 0777, true);
$destBak = $bak . DIRECTORY_SEPARATOR . basename($ruta);
if (!copy($ruta, $destBak)) exit("No pude hacer el backup en $bak. No se cambió nada.\n");
if (file_put_contents($ruta, $nuevo) === false) exit("No pude escribir $ruta. No se cambió nada.\n");
$lint = (string) shell_exec('"' . PHP_BINARY . '" -l ' . escapeshellarg($ruta) . ' 2>&1');
if (strpos($lint, 'No syntax errors') === false) { copy($destBak, $ruta); exit("ERROR SINTAXIS: restauré el original. Mandale esto a Ramiro:\n$lint\n"); }
echo "aplicado    " . basename($ruta) . "\nListo. Backup del original en: $bak\n";

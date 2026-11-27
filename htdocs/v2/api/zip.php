<?php
/**
 * DASA — C&C v2 · api/zip.php
 * Descarga de grabaciones seleccionadas en un zip. PLAN-V2.md § 3.3.
 * {grabaciones:[string]} (máx 50) → application/zip, con FALTANTES.txt si alguna no se encontró.
 * Token por header X-DASA-Token o campo `token` del body (ya validado por _lib.php).
 */

require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/../../lib_audio.php';   // buscarAudio()

$grabaciones = $body['grabaciones'] ?? [];
if (!is_array($grabaciones) || !$grabaciones) {
    respond(['error' => 'Ingresá al menos una grabación.'], 400);
}
if (count($grabaciones) > 50) {
    respond(['error' => 'Demasiadas grabaciones (máximo 50 por pedido).'], 400);
}

$patron = '/^[\w\-\.]+\.(wav|mp3)$/i';
$encontradas = [];   // nombre => ruta local
$invalidas = [];
$faltantes = [];

foreach ($grabaciones as $nombre) {
    $nombre = (string) $nombre;
    if (!preg_match($patron, $nombre)) { $invalidas[] = $nombre; continue; }
    $ruta = buscarAudio($nombre);
    if ($ruta === null) { $faltantes[] = $nombre; continue; }
    $encontradas[$nombre] = $ruta;
}

if (!$encontradas) {
    respond(['error' => 'No se encontró ninguna de las grabaciones pedidas.', 'faltantes' => $faltantes, 'invalidas' => $invalidas], 404);
}

// Zip en archivo temporal (no en memoria: pueden ser muchos audios).
$tmpZip = tempnam(sys_get_temp_dir(), 'dasa_zip_');
if ($tmpZip === false) {
    respond(['error' => 'No se pudo crear el archivo temporal del zip.'], 500);
}
@rename($tmpZip, $tmpZip . '.zip');
$tmpZip .= '.zip';

$zip = new ZipArchive();
if ($zip->open($tmpZip, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
    @unlink($tmpZip);
    respond(['error' => 'No se pudo crear el zip.'], 500);
}
foreach ($encontradas as $nombre => $ruta) {
    $zip->addFile($ruta, $nombre);
}
if ($faltantes || $invalidas) {
    $txt = "Grabaciones que no se pudieron incluir:\n\n";
    foreach ($faltantes as $f) $txt .= "$f — no se encontró el audio (ni suelto ni en los ZIP históricos)\n";
    foreach ($invalidas as $f) $txt .= "$f — nombre de archivo inválido\n";
    $zip->addFromString('FALTANTES.txt', $txt);
}
$zip->close();

if (!is_file($tmpZip)) {
    respond(['error' => 'El zip no se generó correctamente.'], 500);
}

$nombreDescarga = 'grabaciones_' . date('Y-m-d_His') . '.zip';
header('Content-Type: application/zip');
header('Content-Disposition: attachment; filename="' . $nombreDescarga . '"');
header('Content-Length: ' . filesize($tmpZip));
header('X-Faltantes: ' . count($faltantes));
readfile($tmpZip);
@unlink($tmpZip);
exit;

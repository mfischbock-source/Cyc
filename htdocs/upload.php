<?php
/**
 * DASA — C&C  ·  Subida de material de capacitación (ON-PREMISE)
 * ───────────────────────────────────────────────────────────────────────────
 * Guarda los archivos en el SERVER de DASA (no en la nube). Token-gateado,
 * valida extensiones y bloquea ejecutables. La metadata (título, módulo, etc.)
 * la guarda el frontend en Firestore; acá solo se maneja el archivo.
 *
 * Carpeta destino y URL pública son configurables en config.php:
 *   CONTENIDO_UPLOAD_DIR  (default: <app>/uploads/capacitaciones)
 *   CONTENIDO_PUBLIC_BASE (default: /uploads/capacitaciones)
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

// ── Autenticación (mismo token que neotel_sql.php) ────────────────────────
require_once __DIR__ . '/cyc_auth.php';   // sesión de Firebase (subir material: solo supervisores)
cyc_requerir('super');

$BASE        = defined('CONTENIDO_UPLOAD_DIR')  ? CONTENIDO_UPLOAD_DIR  : (__DIR__ . '/uploads/capacitaciones');
$PUBLIC_BASE = defined('CONTENIDO_PUBLIC_BASE') ? CONTENIDO_PUBLIC_BASE : '/uploads/capacitaciones';
$action      = $_POST['action'] ?? 'upload';

// ── ELIMINAR ──────────────────────────────────────────────────────────────
if ($action === 'delete') {
    $rel = ltrim(str_replace('\\', '/', $_POST['path'] ?? ''), '/');
    if ($rel === '' || strpos($rel, '..') !== false) {
        http_response_code(400); echo json_encode(['error' => 'path invalido']); exit;
    }
    $full = $BASE . '/' . $rel;
    if (is_file($full)) @unlink($full);
    echo json_encode(['ok' => true]); exit;
}

// ── SUBIR ───────────────────────────────────────────────────────────────────
if (!isset($_FILES['file']) || ($_FILES['file']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
    $code = $_FILES['file']['error'] ?? 'sin archivo';
    $msg  = ($code === UPLOAD_ERR_INI_SIZE || $code === UPLOAD_ERR_FORM_SIZE)
        ? 'El archivo supera el máximo permitido por el server (subir upload_max_filesize / post_max_size en php.ini).'
        : 'Error de subida (' . $code . ').';
    http_response_code(400); echo json_encode(['error' => $msg]); exit;
}

$f        = $_FILES['file'];
$origName = $f['name'];
$ext      = strtolower(pathinfo($origName, PATHINFO_EXTENSION));

// Rechazar cualquier nombre con extensión ejecutable en CUALQUIER parte (ej "x.php.pdf").
if (preg_match('/\.(php\d*|phtml?|phar|pht|cgi|pl|sh|exe|htaccess)\b/i', $origName)) {
    http_response_code(400); echo json_encode(['error' => 'Tipo de archivo no permitido.']); exit;
}

// Whitelist de extensiones. NUNCA permitir php/ejecutables.
$permitidas = ['pdf','ppt','pptx','doc','docx','xls','xlsx','mp4','webm','mp3','wav','m4a','jpg','jpeg','png','gif'];
if (!in_array($ext, $permitidas, true)) {
    http_response_code(400); echo json_encode(['error' => 'Tipo de archivo no permitido: .' . $ext]); exit;
}

$subtipo = preg_replace('/[^a-z]/', '', strtolower($_POST['subtipo'] ?? 'inicial')) ?: 'inicial';
$cartera = preg_replace('/[^\w]/', '_', $_POST['cartera'] ?? 'General') ?: 'General';
$safe    = preg_replace('/[^\w\.\-]/', '_', $origName);

$dir = $BASE . '/' . $subtipo . '/' . $cartera;
if (!is_dir($dir) && !@mkdir($dir, 0775, true)) {
    http_response_code(500); echo json_encode(['error' => 'No se pudo crear la carpeta destino (permisos de escritura?).']); exit;
}

$fname = time() . '_' . $safe;
$dest  = $dir . '/' . $fname;
if (!move_uploaded_file($f['tmp_name'], $dest)) {
    http_response_code(500); echo json_encode(['error' => 'No se pudo guardar el archivo (permisos de escritura en uploads?).']); exit;
}

$rel = $subtipo . '/' . $cartera . '/' . $fname;
echo json_encode([
    'ok'       => true,
    'url'      => $PUBLIC_BASE . '/' . $rel,
    'path'     => $rel,
    'filename' => $origName,
    'size'     => (int) $f['size'],
]);

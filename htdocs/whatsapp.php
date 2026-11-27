<?php
/**
 * DASA — C&C Plataforma
 * Proxy RapiWha para envío de WhatsApp
 * URL: /api/whatsapp.php
 *
 * Este proxy guarda la API Key de RapiWha en el servidor,
 * nunca expuesta al frontend.
 */

require_once __DIR__ . '/config.php';

// ── CORS ──────────────────────────────────────────────────────────────────
header('Content-Type: application/json; charset=utf-8');
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = [ALLOWED_ORIGIN, 'https://cyc.dasaargentina.com', 'http://localhost'];
if (in_array($origin, $allowed)) {
    header('Access-Control-Allow-Origin: ' . $origin);
} else {
    header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Requested-With');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// 🔒 Antes este endpoint no pedía NINGÚN login. Ahora: sesión de supervisor/admin.
require_once __DIR__ . '/cyc_auth.php';
cyc_requerir('super');

// ── VALIDACIÓN ────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Método no permitido']);
    exit;
}

$body = json_decode(file_get_contents('php://input'), true);
if (json_last_error() !== JSON_ERROR_NONE) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'JSON inválido']);
    exit;
}

$numero_raw = isset($body['numero']) ? $body['numero'] : '';
// Limpiar — solo números
$numero = preg_replace('/[^0-9]/', '', $numero_raw);
// Argentina: asegurar que empiece con 549
if (substr($numero, 0, 2) === '54') {
    // Tiene 54 pero puede faltar el 9 (ej: 5411... → 54911...)
    if (substr($numero, 0, 3) !== '549') {
        $numero = '549' . substr($numero, 2);
    }
} elseif (substr($numero, 0, 1) === '0') {
    // Número local con 0 adelante → sacar el 0 y agregar 549
    $numero = '549' . substr($numero, 1);
} else {
    // Sin código de país → agregar 549
    $numero = '549' . $numero;
}
$mensaje = isset($body['mensaje']) ? trim($body['mensaje']) : '';

if (strlen($numero) < 12 || empty($mensaje)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Número o mensaje inválido']);
    exit;
}

if (strlen($mensaje) > 4096) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Mensaje demasiado largo (máx 4096 caracteres)']);
    exit;
}

// ── LLAMADA A RAPIWHA ─────────────────────────────────────────────────────
// RapiWha usa form-data, no JSON
$payload = http_build_query([
    'apikey' => RAPIWHA_API_KEY,
    'number' => $numero,
    'text'   => $mensaje   // RapiWha usa "text", no "message"
]);

$ch = curl_init(RAPIWHA_ENDPOINT);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded'],
    CURLOPT_POSTFIELDS     => $payload,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_SSL_VERIFYPEER => true,
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr  = curl_error($ch);
curl_close($ch);

// ── LOG (guardar en archivo para auditoría) ───────────────────────────────
$logEntry = date('Y-m-d H:i:s') . ' | ' . substr($numero, 0, 6) . '****' . ' | HTTP ' . $httpCode . ' | ' . ($curlErr ?: 'OK') . PHP_EOL;
@file_put_contents(__DIR__ . '/../logs/whatsapp.log', $logEntry, FILE_APPEND | LOCK_EX);

// ── RESPUESTA ─────────────────────────────────────────────────────────────
if ($curlErr) {
    http_response_code(503);
    echo json_encode(['success' => false, 'error' => 'Error de conexión con RapiWha: ' . $curlErr]);
    exit;
}

$data = json_decode($response, true);
http_response_code($httpCode >= 200 && $httpCode < 300 ? 200 : $httpCode);
echo json_encode([
    'success'  => $httpCode >= 200 && $httpCode < 300,
    'httpCode' => $httpCode,
    'response' => $data
]);

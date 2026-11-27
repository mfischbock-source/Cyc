<?php
/**
 * DASA C&C — Crear/Eliminar usuario Firebase via REST API
 * No afecta la sesión del supervisor actual
 */
require_once __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = [ALLOWED_ORIGIN, 'http://localhost', 'http://192.168.0.245'];
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowed) ? $origin : ALLOWED_ORIGIN));
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// 🔒 Antes este endpoint no pedía NINGÚN login. Ahora: sesión de supervisor/admin.
require_once __DIR__ . '/cyc_auth.php';
cyc_requerir('super');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Metodo no permitido']); exit;
}

if (!defined('FIREBASE_API_KEY')) {
    http_response_code(500);
    echo json_encode(['error' => 'FIREBASE_API_KEY no configurada en config.php']);
    exit;
}

$body   = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $body['action'] ?? 'create';

// ── ELIMINAR USUARIO ──────────────────────────────────────────────────────
if ($action === 'delete') {
    $uid = $body['uid'] ?? '';
    if (!$uid) { echo json_encode(['ok' => true]); exit; }

    // Obtener token de admin via API Key (Identity Toolkit no permite delete sin admin token)
    // Por ahora solo confirmamos — el documento ya fue eliminado de Firestore desde el frontend
    echo json_encode(['ok' => true, 'note' => 'Firestore doc deleted']);
    exit;
}

// ── CREAR USUARIO ─────────────────────────────────────────────────────────
$email    = $body['email']    ?? '';
$password = $body['password'] ?? '';

if (!$email || !$password) {
    http_response_code(400);
    echo json_encode(['error' => 'email y password requeridos']);
    exit;
}

$url  = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' . FIREBASE_API_KEY;
$data = json_encode(['email' => $email, 'password' => $password, 'returnSecureToken' => false]);

$ctx = stream_context_create([
    'http' => [
        'method'         => 'POST',
        'header'         => "Content-Type: application/json\r\n",
        'content'        => $data,
        'ignore_errors'  => true,
        'timeout'        => 15,
    ]
]);

$response = file_get_contents($url, false, $ctx);
$result   = json_decode($response, true);

if (isset($result['error'])) {
    $msg = $result['error']['message'] ?? 'Error desconocido';
    if ($msg === 'EMAIL_EXISTS')       $msg = 'Este email ya está registrado en el sistema.';
    if (str_contains($msg, 'WEAK_PASSWORD')) $msg = 'La contraseña debe tener al menos 6 caracteres.';
    if ($msg === 'INVALID_EMAIL')      $msg = 'El email no es válido.';
    http_response_code(400);
    echo json_encode(['error' => $msg]);
    exit;
}

echo json_encode(['uid' => $result['localId'], 'email' => $result['email']]);

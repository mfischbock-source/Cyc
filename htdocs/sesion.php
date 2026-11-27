<?php
/**
 * DASA — C&C · sesion.php
 * POST {idToken}      → valida el login de Firebase y deja la cookie de sesión (ver cyc_auth.php).
 * POST {salir: true}  → borra la cookie (cerrar sesión).
 * Solo mismo origen: lo llama cyc_sesion.jsx, nunca otro sitio.
 */
require_once __DIR__ . '/cyc_auth.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') cyc_fallar(405, 'Metodo no permitido');

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) cyc_fallar(400, 'JSON inválido');

if (!empty($body['salir'])) {
    cyc_set_cookie('', time() - 3600);
    echo json_encode(['ok' => true]);
    exit;
}

$idToken = (string) ($body['idToken'] ?? '');
if ($idToken === '' || strlen($idToken) > 4096) cyc_fallar(400, 'Falta idToken');

$claims = cyc_verificar_id_token($idToken);
if (!$claims) cyc_fallar(401, 'Login inválido o vencido');

$acceso = cyc_autorizar($claims, $idToken);
if (!$acceso) {
    error_log('[sesion] sin acceso: ' . ($claims['email'] ?? $claims['sub']));
    cyc_fallar(403, 'Tu usuario no tiene acceso a la plataforma');
}

$vence = time() + CYC_SESION_TTL;
cyc_set_cookie(cyc_sesion_firmar([
    'uid'   => $claims['sub'],
    'email' => (string) ($claims['email'] ?? ''),
    'nivel' => $acceso['nivel'],
    'exp'   => $vence,
]), $vence);
echo json_encode(['ok' => true, 'nivel' => $acceso['nivel'], 'vence' => $vence]);

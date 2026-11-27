<?php
/**
 * Tests de htdocs/cyc_auth.php — sin red y sin Firebase real.
 * Firma JWTs con una clave RSA generada acá y le inyecta el certificado al validador.
 * Correr:  php tests/test_cyc_auth.php   (sale 0 si todo pasa). Lo llama verificar.py.
 */
putenv('SESION_KEY=clave-de-prueba-solo-para-tests-0123456789');
putenv('NEOTEL_API_TOKEN=token-de-prueba-del-cron');
require __DIR__ . '/../htdocs/cyc_auth.php';

$fallas = 0;
function ok(bool $cond, string $nombre): void {
    global $fallas;
    echo ($cond ? "ok     " : "FALLA  ") . $nombre . "\n";
    if (!$cond) $fallas++;
}

// ── Clave y certificado de prueba ──────────────────────────────────────────────────────
$cfgSsl = [];
if (getenv('OPENSSL_CONF') === false && PHP_OS_FAMILY === 'Windows') {
    $cnf = dirname(PHP_BINARY) . '/extras/ssl/openssl.cnf';
    if (is_file($cnf)) $cfgSsl['config'] = $cnf;
}
$priv = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA] + $cfgSsl);
$csr = openssl_csr_new(['commonName' => 'test'], $priv, $cfgSsl);
$x509 = openssl_csr_sign($csr, null, $priv, 1, $cfgSsl);
openssl_x509_export($x509, $certPem);
$certs = ['kid1' => $certPem];

$otra = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA] + $cfgSsl);

function jwt(array $claims, $clave, string $kid = 'kid1', string $alg = 'RS256'): string {
    $h = cyc_b64url_enc(json_encode(['alg' => $alg, 'kid' => $kid, 'typ' => 'JWT']));
    $p = cyc_b64url_enc(json_encode($claims));
    openssl_sign("$h.$p", $firma, $clave, OPENSSL_ALGO_SHA256);
    return "$h.$p." . cyc_b64url_enc($firma);
}

$ahora = 1800000000;
$proj = cyc_proyecto();
$base = [
    'aud' => $proj, 'iss' => "https://securetoken.google.com/$proj", 'sub' => 'uid123',
    'iat' => $ahora - 60, 'exp' => $ahora + 3000, 'auth_time' => $ahora - 60,
    'email' => 'juan@dasaargentina.com', 'email_verified' => true,
    'firebase' => ['sign_in_provider' => 'google.com'],
];

// ── Validación del ID token ────────────────────────────────────────────────────────────
ok(is_array(cyc_verificar_id_token(jwt($base, $priv), $ahora, $certs)), 'token válido se acepta');
ok(cyc_verificar_id_token(jwt($base, $otra), $ahora, $certs) === null, 'firmado con otra clave se rechaza');
$t = explode('.', jwt($base, $priv));
$t[1] = cyc_b64url_enc(json_encode(['sub' => 'otro'] + $base));
ok(cyc_verificar_id_token(implode('.', $t), $ahora, $certs) === null, 'payload adulterado se rechaza');
ok(cyc_verificar_id_token(jwt(['exp' => $ahora - 1] + $base, $priv), $ahora, $certs) === null, 'vencido se rechaza');
ok(cyc_verificar_id_token(jwt(['aud' => 'otro-proyecto'] + $base, $priv), $ahora, $certs) === null, 'otro proyecto (aud) se rechaza');
ok(cyc_verificar_id_token(jwt(['iss' => 'https://evil'] + $base, $priv), $ahora, $certs) === null, 'otro emisor (iss) se rechaza');
ok(cyc_verificar_id_token(jwt(['iat' => $ahora + 3600] + $base, $priv), $ahora, $certs) === null, 'emitido en el futuro se rechaza');
ok(cyc_verificar_id_token(jwt(['sub' => ''] + $base, $priv), $ahora, $certs) === null, 'sin sub se rechaza');
$h = cyc_b64url_enc(json_encode(['alg' => 'none', 'kid' => 'kid1']));
ok(cyc_verificar_id_token($h . '.' . cyc_b64url_enc(json_encode($base)) . '.', $ahora, $certs) === null, 'alg=none se rechaza');
ok(cyc_verificar_id_token('basura', $ahora, $certs) === null, 'texto cualquiera se rechaza');

// ── Autorización (Firestore simulado) ──────────────────────────────────────────────────
function fsFalso(array $docs) {
    return function (string $ruta) use ($docs) { return array_key_exists($ruta, $docs) ? $docs[$ruta] : null; };
}
$g = $base;
ok(cyc_autorizar($g, 't', fsFalso(['usuarios_v2/uid123' => ['role' => 'supervisor']]))['nivel'] === 'super', 'google @dasa supervisor → super');
ok(cyc_autorizar($g, 't', fsFalso(['usuarios_v2/uid123' => ['role' => 'auditor']]))['nivel'] === 'usuario', 'google @dasa auditor → usuario');
ok(cyc_autorizar($g, 't', fsFalso(['usuarios_v2/uid123' => ['role' => 'pendiente']])) === null, 'google @dasa pendiente → sin acceso');
ok(cyc_autorizar($g, 't', fsFalso(['usuarios_v2/uid123' => ['role' => 'admin', 'estado' => 'inactivo']])) === null, 'inactivo → sin acceso');
ok(cyc_autorizar($g, 't', fsFalso(['usuarios_v2/uid123' => ['role' => 'owner']]))['nivel'] === 'super', 'owner en Firestore sin ser propietario → admin (super)');
ok(cyc_autorizar($g, 't', fsFalso([])) === null, 'google @dasa sin perfil → sin acceso');
ok(cyc_autorizar($g, 't', function () { return false; })['nivel'] === 'usuario', 'Firestore caído + google @dasa → usuario (mínimo)');
$gmail = ['email' => 'alguien@gmail.com'] + $g;
ok(cyc_autorizar($gmail, 't', fsFalso(['usuarios_v2/uid123' => ['role' => 'admin']])) === null, 'gmail con rol admin autoasignado y sin invitación → sin acceso');
ok(cyc_autorizar($gmail, 't', fsFalso(['usuarios_v2/uid123' => ['role' => 'auditor'], 'invitaciones_v2/alguien@gmail.com' => ['role' => 'auditor']]))['nivel'] === 'usuario', 'gmail invitado → acceso');
ok(cyc_autorizar($gmail, 't', function () { return false; }) === null, 'Firestore caído + gmail → sin acceso');
ok(cyc_autorizar(['email_verified' => false] + $g, 't', fsFalso(['usuarios_v2/uid123' => ['role' => 'admin']])) === null, 'mail @dasa NO verificado → sin acceso');
$prop = ['email' => 'rfischbock@dasaargentina.com'] + $g;
ok(cyc_autorizar($prop, 't', fsFalso([]))['nivel'] === 'super', 'propietario → super');
$pw = ['firebase' => ['sign_in_provider' => 'password'], 'email_verified' => false] + $g;
ok(cyc_autorizar($pw, 't', fsFalso(['usuarios/uid123' => ['role' => 'gestor']]))['nivel'] === 'usuario', 'cuenta vieja gestor → usuario');
ok(cyc_autorizar($pw, 't', fsFalso(['usuarios/uid123' => ['role' => 'supervisor']]))['nivel'] === 'super', 'cuenta vieja supervisor → super');
ok(cyc_autorizar($pw, 't', fsFalso([])) === null, 'cuenta vieja sin perfil → sin acceso');
ok(cyc_autorizar(['firebase' => ['sign_in_provider' => 'anonymous']] + $g, 't', fsFalso([])) === null, 'login anónimo → sin acceso');

// ── Cookie de sesión ───────────────────────────────────────────────────────────────────
$c = cyc_sesion_firmar(['uid' => 'u', 'nivel' => 'usuario', 'exp' => $ahora + 100]);
ok((cyc_sesion_leer($c, $ahora)['uid'] ?? '') === 'u', 'cookie válida se lee');
ok(cyc_sesion_leer($c, $ahora + 101) === null, 'cookie vencida se rechaza');
[$p] = explode('.', $c);
$falsa = cyc_b64url_enc(json_encode(['uid' => 'u', 'nivel' => 'super', 'exp' => $ahora + 100])) . '.' . explode('.', $c)[1];
ok(cyc_sesion_leer($falsa, $ahora) === null, 'cookie con nivel cambiado a mano se rechaza');
ok(cyc_sesion_leer('x.y', $ahora) === null && cyc_sesion_leer(null, $ahora) === null, 'cookie basura se rechaza');

// ── Cron ───────────────────────────────────────────────────────────────────────────────
$tokCron = defined('NEOTEL_API_TOKEN') ? (string) NEOTEL_API_TOKEN : '';
if ($tokCron !== '') {
    $_SERVER = ['HTTP_X_DASA_TOKEN' => $tokCron, 'REMOTE_ADDR' => '127.0.0.1', 'SERVER_ADDR' => '192.168.0.245'];
    ok(cyc_es_cron(), 'cron local con token → acepta');
    $_SERVER['HTTP_CF_CONNECTING_IP'] = '1.2.3.4';
    ok(!cyc_es_cron(), 'mismo token pero entrando por Cloudflare → rechaza');
    $_SERVER = ['HTTP_X_DASA_TOKEN' => $tokCron, 'REMOTE_ADDR' => '192.168.0.50', 'SERVER_ADDR' => '192.168.0.245'];
    ok(!cyc_es_cron(), 'token desde otra PC de la LAN → rechaza');
    $_SERVER = ['HTTP_X_DASA_TOKEN' => $tokCron, 'REMOTE_ADDR' => '192.168.0.245', 'SERVER_ADDR' => '192.168.0.245'];
    ok(cyc_es_cron(), 'cron por la IP del propio server → acepta');
}
$_SERVER = ['HTTP_X_DASA_TOKEN' => 'cualquiera', 'REMOTE_ADDR' => '127.0.0.1'];
ok(!cyc_es_cron(), 'token incorrecto → rechaza');

echo "\n" . ($fallas ? "$fallas falla(s)." : "Todo bien.") . "\n";
exit($fallas ? 1 : 0);

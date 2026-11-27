<?php
/**
 * DASA — C&C · cyc_auth.php — autenticación común de TODOS los endpoints.
 *
 * Antes: cada endpoint pedía un token fijo (X-DASA-Token / ?token=) que estaba escrito en el
 * JavaScript público → cualquiera en internet podía consultar Neotel, bajar audios o gastar IA.
 *
 * Ahora hay dos caminos, y nada más:
 *   1. Navegador: el front manda el ID token de Firebase a sesion.php UNA vez; acá se valida la
 *      firma con las claves públicas de Google y se emite una cookie de sesión propia
 *      (HttpOnly, firmada con HMAC, 12 h). Todos los endpoints (y <audio src>) la leen.
 *   2. Cron (analizar_cron.php): sigue mandando X-DASA-Token, pero SOLO se acepta si el pedido
 *      sale del mismo servidor (loopback o la IP del server) y NO viene por Cloudflare.
 *
 * Sin dependencias: stdlib + openssl + curl (los dos ya los usa el resto del backend).
 */
require_once __DIR__ . '/config.php';

const CYC_COOKIE         = 'cyc_sesion';
const CYC_SESION_TTL     = 43200;                 // 12 h
const CYC_DOMINIO        = 'dasaargentina.com';
const CYC_PROPIETARIOS   = ['rfischbock@dasaargentina.com'];   // igual que V2.config.propietarios
const CYC_ROLES_SUPER    = ['owner', 'admin', 'supervisor'];     // pueden mandar WhatsApp / crear usuarios
const CYC_ROLES_V2       = ['owner', 'admin', 'supervisor', 'auditor'];
const CYC_CERTS_URL      = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

function cyc_proyecto(): string {
    return defined('FIREBASE_PROJECT_ID') ? FIREBASE_PROJECT_ID : 'dasa-calidad';
}

function cyc_fallar(int $code, string $msg): void {
    if (!headers_sent()) {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode(['error' => $msg, 'sesion' => false]);
    exit;
}

function cyc_b64url_dec(string $s) {
    return base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true);
}

function cyc_b64url_enc(string $s): string {
    return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
}

// ── Clave para firmar la cookie ─────────────────────────────────────────────────────────
// Ideal: SESION_KEY en secrets.local.php. Si no está, se deriva de secretos que solo existen
// en el server (nunca del código), así el deploy no depende de editar secretos.
function cyc_clave_sesion(): string {
    $k = (string) dasa_secret('SESION_KEY');
    if ($k !== '') return $k;
    $base = (defined('NEOTEL_DB_PASS') ? NEOTEL_DB_PASS : '') . '|'
          . (defined('ANTHROPIC_API_KEY') ? ANTHROPIC_API_KEY : '') . '|'
          . (defined('NEOTEL_API_TOKEN') ? NEOTEL_API_TOKEN : '');
    if (strlen($base) < 24) cyc_fallar(500, 'Falta SESION_KEY en secrets.local.php');
    return hash('sha256', 'cyc-sesion|' . $base);
}

// ── HTTP saliente ───────────────────────────────────────────────────────────────────────
function cyc_http_get(string $url, array $headers = []): array {
    $ch = curl_init($url);
    $respHeaders = [];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_HEADERFUNCTION => function ($ch, $h) use (&$respHeaders) {
            $p = explode(':', $h, 2);
            if (count($p) === 2) $respHeaders[strtolower(trim($p[0]))] = trim($p[1]);
            return strlen($h);
        },
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, $body === false ? '' : $body, $respHeaders];
}

// ── Claves públicas de Google (cacheadas en disco según Cache-Control) ──────────────────
function cyc_certs_google(bool $forzar = false): array {
    $cache = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'cyc_firebase_certs.json';
    if (!$forzar && is_file($cache)) {
        $c = json_decode((string) @file_get_contents($cache), true);
        if (is_array($c) && ($c['vence'] ?? 0) > time() && is_array($c['certs'] ?? null)) return $c['certs'];
    }
    [$code, $body, $h] = cyc_http_get(CYC_CERTS_URL);
    $certs = json_decode($body, true);
    if ($code !== 200 || !is_array($certs) || !$certs) {
        error_log('[cyc_auth] no se pudieron bajar las claves públicas de Google (HTTP ' . $code . ')');
        return [];
    }
    $maxAge = 3600;
    if (preg_match('/max-age=(\d+)/', $h['cache-control'] ?? '', $m)) $maxAge = (int) $m[1];
    @file_put_contents($cache, json_encode(['vence' => time() + $maxAge, 'certs' => $certs]), LOCK_EX);
    return $certs;
}

/**
 * Valida un ID token de Firebase (JWT RS256) según la documentación oficial:
 * firma con la clave pública `kid`, aud = proyecto, iss = securetoken, exp/iat/auth_time, sub.
 * Devuelve los claims o null.
 */
function cyc_verificar_id_token(string $jwt, ?int $ahora = null, ?array $certs = null): ?array {
    $ahora = $ahora ?? time();
    $partes = explode('.', $jwt);
    if (count($partes) !== 3) return null;
    $head = json_decode((string) cyc_b64url_dec($partes[0]), true);
    $claims = json_decode((string) cyc_b64url_dec($partes[1]), true);
    $firma = cyc_b64url_dec($partes[2]);
    if (!is_array($head) || !is_array($claims) || $firma === false) return null;
    if (($head['alg'] ?? '') !== 'RS256' || !is_string($head['kid'] ?? null)) return null;

    $certs = $certs ?? cyc_certs_google();
    if (!isset($certs[$head['kid']])) {                      // Google rotó las claves
        $certs = cyc_certs_google(true);
        if (!isset($certs[$head['kid']])) return null;
    }
    $pub = openssl_pkey_get_public($certs[$head['kid']]);
    if ($pub === false) return null;
    if (openssl_verify($partes[0] . '.' . $partes[1], $firma, $pub, OPENSSL_ALGO_SHA256) !== 1) return null;

    $proj = cyc_proyecto();
    $sub = $claims['sub'] ?? '';
    if (($claims['aud'] ?? '') !== $proj) return null;
    if (($claims['iss'] ?? '') !== 'https://securetoken.google.com/' . $proj) return null;
    if (!is_int($claims['exp'] ?? null) || $claims['exp'] <= $ahora) return null;
    if (!is_int($claims['iat'] ?? null) || $claims['iat'] > $ahora + 300) return null;
    if (isset($claims['auth_time']) && $claims['auth_time'] > $ahora + 300) return null;
    if (!is_string($sub) || $sub === '' || strlen($sub) > 128) return null;
    return $claims;
}

// ── Firestore REST con el token del propio usuario (respeta las reglas de seguridad) ────
// Devuelve: array de campos planos | null (no existe) | false (error / cuota agotada).
function cyc_fs_doc(string $ruta, string $idToken) {
    $url = 'https://firestore.googleapis.com/v1/projects/' . cyc_proyecto()
         . '/databases/(default)/documents/' . implode('/', array_map('rawurlencode', explode('/', $ruta)));
    [$code, $body] = cyc_http_get($url, ['Authorization: Bearer ' . $idToken]);
    if ($code === 404) return null;
    if ($code !== 200) return false;
    $d = json_decode($body, true);
    $out = [];
    foreach (($d['fields'] ?? []) as $k => $v) {
        $out[$k] = $v['stringValue'] ?? $v['booleanValue'] ?? $v['integerValue'] ?? null;
    }
    return $out;
}

/**
 * Decide si un usuario ya autenticado por Firebase tiene acceso, y con qué nivel.
 * Replica las reglas de ingreso de las dos apps, pero del lado del servidor:
 *  - v2: cuenta Google con mail @dasaargentina.com verificado, propietario, o invitación;
 *        rol en usuarios_v2 (owner/admin/supervisor/auditor) y no inactivo.
 *  - app anterior: cuenta usuario/contraseña con perfil en `usuarios` y no inactivo.
 * Devuelve ['nivel' => 'super'|'usuario'] o null.
 * $fs permite inyectar la lectura de Firestore en los tests.
 */
function cyc_autorizar(array $c, string $idToken, ?callable $fs = null): ?array {
    $fs = $fs ?? 'cyc_fs_doc';
    $uid = $c['sub'];
    $email = strtolower((string) ($c['email'] ?? ''));
    $verificado = !empty($c['email_verified']);
    $proveedor = (string) ($c['firebase']['sign_in_provider'] ?? '');
    $esProp = $verificado && in_array($email, CYC_PROPIETARIOS, true);
    $googleDasa = $proveedor === 'google.com' && $verificado
               && substr($email, -strlen('@' . CYC_DOMINIO)) === '@' . CYC_DOMINIO;

    if ($esProp) return ['nivel' => 'super'];

    if ($proveedor === 'google.com') {
        $v2 = $fs('usuarios_v2/' . $uid, $idToken);
        if ($v2 === false) return $googleDasa ? ['nivel' => 'usuario'] : null;   // Firestore caído: mínimo
        $invitado = false;
        if (!$googleDasa && $verificado && $email !== '') {
            $inv = $fs('invitaciones_v2/' . $email, $idToken);
            $invitado = is_array($inv) && in_array($inv['role'] ?? '', CYC_ROLES_V2, true) && ($inv['role'] ?? '') !== 'owner';
        }
        if (!$googleDasa && !$invitado) return null;
        if (!is_array($v2) || ($v2['estado'] ?? '') === 'inactivo') return null;
        $rol = (string) ($v2['role'] ?? '');
        if ($rol === 'owner') $rol = 'admin';                 // "owner" solo vale por la lista de propietarios
        if (!in_array($rol, CYC_ROLES_V2, true)) return null; // pendiente / sin rol
        return ['nivel' => in_array($rol, CYC_ROLES_SUPER, true) ? 'super' : 'usuario'];
    }

    if ($proveedor === 'password') {
        $u = $fs('usuarios/' . $uid, $idToken);
        if (!is_array($u) || ($u['estado'] ?? '') === 'inactivo') return null;
        $rol = (string) ($u['role'] ?? 'gestor');
        return ['nivel' => in_array($rol, ['supervisor', 'admin'], true) ? 'super' : 'usuario'];
    }
    return null;
}

// ── Cookie de sesión ────────────────────────────────────────────────────────────────────
function cyc_sesion_firmar(array $datos): string {
    $p = cyc_b64url_enc(json_encode($datos));
    return $p . '.' . cyc_b64url_enc(hash_hmac('sha256', $p, cyc_clave_sesion(), true));
}

function cyc_sesion_leer(?string $valor, ?int $ahora = null): ?array {
    if (!is_string($valor) || strpos($valor, '.') === false) return null;
    [$p, $f] = explode('.', $valor, 2);
    $esperada = cyc_b64url_enc(hash_hmac('sha256', $p, cyc_clave_sesion(), true));
    if (!hash_equals($esperada, $f)) return null;
    $d = json_decode((string) cyc_b64url_dec($p), true);
    if (!is_array($d) || ($d['exp'] ?? 0) <= ($ahora ?? time())) return null;
    return $d;
}

function cyc_es_https(): bool {
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') return true;
    if (strtolower($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') return true;
    return strpos($_SERVER['HTTP_CF_VISITOR'] ?? '', 'https') !== false;
}

function cyc_set_cookie(string $valor, int $vence): void {
    setcookie(CYC_COOKIE, $valor, [
        'expires'  => $vence,
        'path'     => '/',
        'secure'   => cyc_es_https(),   // por IP de la LAN (http) también tiene que andar
        'httponly' => true,             // el JavaScript no la puede leer
        'samesite' => 'Lax',
    ]);
}

// ── Cron: token interno, solo desde el mismo servidor y nunca por Cloudflare ────────────
function cyc_es_cron(): bool {
    $tok = (string) ($_SERVER['HTTP_X_DASA_TOKEN'] ?? '');
    if ($tok === '' || !defined('NEOTEL_API_TOKEN') || NEOTEL_API_TOKEN === '') return false;
    if (!hash_equals((string) NEOTEL_API_TOKEN, $tok)) return false;
    if (!empty($_SERVER['HTTP_CF_CONNECTING_IP']) || !empty($_SERVER['HTTP_CF_RAY'])) return false;
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    return in_array($ip, ['127.0.0.1', '::1'], true) || ($ip !== '' && $ip === ($_SERVER['SERVER_ADDR'] ?? ''));
}

// Alerta por mail si la IA se queda sin crédito (solo actúa en transcribir.php y analizar.php).
function cyc_avisar_si_falta_credito(): void {
    if (!is_file(__DIR__ . '/alerta_credito.php')) return;
    require_once __DIR__ . '/alerta_credito.php';
    cyc_vigilar_credito(basename($_SERVER['SCRIPT_NAME'] ?? ''));
}

/**
 * Llamar al principio de cada endpoint. $nivel: 'usuario' (cualquiera con acceso) o 'super'.
 * Corta con 401/403 si no corresponde. Devuelve quién es.
 */
function cyc_requerir(string $nivel = 'usuario'): array {
    if (cyc_es_cron()) {
        cyc_avisar_si_falta_credito();
        return ['uid' => 'cron', 'email' => '', 'nivel' => 'super', 'cron' => true];
    }
    $s = cyc_sesion_leer($_COOKIE[CYC_COOKIE] ?? null);
    if (!$s) cyc_fallar(401, 'No autorizado');
    if ($nivel === 'super' && ($s['nivel'] ?? '') !== 'super') cyc_fallar(403, 'Sin permiso');
    cyc_avisar_si_falta_credito();
    return ['uid' => $s['uid'], 'email' => $s['email'] ?? '', 'nivel' => $s['nivel'], 'cron' => false];
}

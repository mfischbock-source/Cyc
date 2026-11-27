<?php
/**
 * DASA — C&C · Alerta por mail cuando la IA se queda sin crédito (o la API key deja de servir).
 *
 * Igual que en las apps de pagos: mail al equipo, como mucho uno cada 3 h por problema.
 * No toca transcribir.php ni analizar.php: cyc_requerir() (cyc_auth.php) llama a
 * cyc_vigilar_credito(), que mira la respuesta JSON del endpoint cuando termina.
 *
 * Mira SOLO 'error', 'codigo' y 'motor'. Nunca la transcripción: en las llamadas se habla
 * de crédito y de saldo todo el tiempo.
 *
 * Secretos (secrets.local.php): ALERTA_GMAIL_USER, ALERTA_GMAIL_PASS (contraseña de aplicación).
 * Probar en el server:  php alerta_credito.php --probar
 */
const CYC_ALERTA_DESTINOS = ['rfischbock@dasaargentina.com', 'egimenez@dasaargentina.com', 'gvazquez@dasaargentina.com'];
const CYC_ALERTA_CADA_SEG = 3 * 3600;
const CYC_ALERTA_REINTENTO_SEG = 600;   // si el mail no salió

/** Qué problema muestra la respuesta de un endpoint. null = ninguno. */
function cyc_detectar_credito(string $endpoint, $resp, string $motorPedido = ''): ?array {
    if (!is_array($resp)) return null;
    $prov   = $endpoint === 'analizar.php' ? 'Anthropic' : 'OpenAI';
    $codigo = is_string($resp['codigo'] ?? null) ? $resp['codigo'] : '';
    $error  = is_string($resp['error'] ?? null) ? $resp['error'] : '';
    $motor  = is_string($resp['motor'] ?? null) ? $resp['motor'] : '';

    $tipo = '';
    if ($codigo === 'openai_sin_credito')         { $prov = 'OpenAI';    $tipo = 'sin_credito'; }
    elseif ($codigo === 'anthropic_sin_credito')  { $prov = 'Anthropic'; $tipo = 'sin_credito'; }
    elseif (preg_match('/credit balance|exceeded your current quota|insufficient_quota|billing.hard.limit|sin cr[eé]dito/iu', $error)) $tipo = 'sin_credito';
    elseif (preg_match('/invalid x-api-key|authentication_error|incorrect api key|invalid_api_key/i', $error)) $tipo = 'key';
    elseif ($endpoint === 'transcribir.php' && $motorPedido !== 'local' && preg_match('/whisper\.cpp|local/i', $motor)) $tipo = 'respaldo';
    elseif ($codigo === 'sin_motor') $tipo = 'sin_motor';   // falló OpenAI y no hay respaldo local
    if ($tipo === '') return null;

    $motivos = ['sin_credito' => "SIN CRÉDITO en la cuenta de $prov",
                'key'         => "API KEY de $prov inválida o revocada",
                'sin_motor'   => 'OpenAI no responde y no hay otro motor de transcripción',
                'respaldo'    => 'OpenAI no responde: se está usando el Whisper local'];
    return ['proveedor' => $prov, 'tipo' => $tipo, 'motivo' => $motivos[$tipo], 'detalle' => mb_substr($error, 0, 400)];
}

/** Corre $enviar como mucho una vez cada 3 h por archivo, aunque haya pedidos en paralelo. */
function cyc_alerta_con_tope(string $archivo, int $ahora, callable $enviar): bool {
    $fh = @fopen($archivo, 'c+');
    if (!$fh) { error_log("[alerta_credito] no pude abrir $archivo"); return false; }
    if (!flock($fh, LOCK_EX | LOCK_NB)) { fclose($fh); return false; }   // otro pedido la está mandando
    $proxima = (int) stream_get_contents($fh);
    $ok = false;
    if ($ahora >= $proxima) {
        $ok = (bool) $enviar();
        ftruncate($fh, 0); rewind($fh);
        fwrite($fh, (string) ($ahora + ($ok ? CYC_ALERTA_CADA_SEG : CYC_ALERTA_REINTENTO_SEG)));
    }
    flock($fh, LOCK_UN); fclose($fh);
    return $ok;
}

function cyc_alerta_mail(string $asunto, string $cuerpo): bool {
    $user = (string) dasa_secret('ALERTA_GMAIL_USER');
    $pass = str_replace(' ', '', (string) dasa_secret('ALERTA_GMAIL_PASS'));
    if ($user === '' || $pass === '') {
        error_log("[alerta_credito] faltan ALERTA_GMAIL_USER / ALERTA_GMAIL_PASS en secrets.local.php. Aviso no enviado: $asunto");
        return false;
    }
    $msg = "From: DASA C&C <$user>\r\nTo: " . implode(', ', CYC_ALERTA_DESTINOS) . "\r\n"
         . 'Subject: =?UTF-8?B?' . base64_encode($asunto) . "?=\r\nDate: " . date('r') . "\r\nMIME-Version: 1.0\r\n"
         . "Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($cuerpo));
    $fh = fopen('php://temp', 'r+'); fwrite($fh, $msg); rewind($fh);
    $ch = curl_init('smtp://smtp.gmail.com:587');
    curl_setopt_array($ch, [
        CURLOPT_USE_SSL => CURLUSESSL_ALL, CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_USERNAME => $user, CURLOPT_PASSWORD => $pass,
        CURLOPT_MAIL_FROM => "<$user>",
        CURLOPT_MAIL_RCPT => array_map(function ($d) { return "<$d>"; }, CYC_ALERTA_DESTINOS),
        CURLOPT_UPLOAD => true, CURLOPT_INFILE => $fh, CURLOPT_INFILESIZE => strlen($msg),
        CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_TIMEOUT => 15,
    ]);
    $ok = curl_exec($ch) !== false;
    if (!$ok) error_log('[alerta_credito] no salió el mail: ' . curl_error($ch));
    fclose($fh);
    return $ok;
}

function cyc_alerta_texto(array $p): array {
    $que = $p['proveedor'] === 'Anthropic'
        ? 'Las llamadas se transcriben pero NO se analizan.'
        : 'Las llamadas no se transcriben con OpenAI. Quedan pendientes y el cron las retoma cuando vuelva, salvo que el Whisper local esté activo (puede sobrecargar la VM).';
    $donde = $p['proveedor'] === 'Anthropic' ? 'https://console.anthropic.com' : 'https://platform.openai.com/settings/organization/billing';
    return ["⚠ DASA C&C: {$p['motivo']}",
        "Calidad y Capacitación (cyc.dasaargentina.com)\n\nMotivo: {$p['motivo']}\n\n$que\n\nRevisar saldo / API key en $donde\n"
        . ($p['detalle'] !== '' ? "\nDetalle que devolvió el servicio:\n{$p['detalle']}\n" : '')
        . "\nEste aviso se manda como mucho una vez cada 3 horas mientras siga el problema.\n"];
}

/** La llama cyc_requerir(). Solo hace algo en transcribir.php y analizar.php. */
function cyc_vigilar_credito(string $endpoint): void {
    if (!in_array($endpoint, ['transcribir.php', 'analizar.php'], true)) return;
    ob_start();
    register_shutdown_function(function () use ($endpoint) {
        $salida = ob_get_level() ? (string) ob_get_flush() : '';   // primero se contesta, después se avisa
        flush();
        try {
            $pedido = json_decode((string) file_get_contents('php://input'), true);
            $motor  = is_array($pedido) && is_string($pedido['motor'] ?? null) ? $pedido['motor'] : '';
            $p = cyc_detectar_credito($endpoint, json_decode($salida, true), $motor);
            if (!$p) return;
            $clave = strtolower($p['proveedor'] . '_' . $p['tipo']);
            cyc_alerta_con_tope(sys_get_temp_dir() . "/dasa_alerta_$clave.txt", time(), function () use ($p) {
                return cyc_alerta_mail(...cyc_alerta_texto($p));
            });
        } catch (Throwable $e) { error_log('[alerta_credito] ' . $e->getMessage()); }
    });
}

if (PHP_SAPI === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    if (($argv[1] ?? '') !== '--probar') exit("Uso: php alerta_credito.php --probar   (manda un mail de prueba)\n");
    require_once __DIR__ . '/config.php';
    ini_set('log_errors', '1'); ini_set('error_log', '');   // los errores, a la pantalla
    $ok = cyc_alerta_mail('PRUEBA - Alerta de crédito de DASA C&C', "Es una prueba: la alerta de crédito de C&C quedó configurada.\n");
    echo $ok ? 'OK: mail enviado a ' . implode(', ', CYC_ALERTA_DESTINOS) . "\n" : "FALLO: el mail no salió (ver el error de arriba)\n";
    exit($ok ? 0 : 1);
}

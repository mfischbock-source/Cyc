<?php
/**
 * DASA — C&C · Análisis AUTOMÁTICO de llamadas (tarea programada / cron)
 * ─────────────────────────────────────────────────────────────────────────
 * Corre por línea de comandos (Task Scheduler en el server). En cada corrida:
 *   1) busca en Neotel las llamadas atendidas de los últimos días, por gestor
 *   2) para cada una que TODAVÍA NO esté analizada, la transcribe + analiza con IA
 *   3) la guarda en Firestore (analisis_llamadas) — igual que "Analizar todo el equipo"
 * Así quedan SIEMPRE analizadas, sin que nadie abra la app.
 *
 * Reusa los mismos endpoints locales (neotel_sql / transcribir / analizar) y la
 * misma rúbrica por cartera (Agentes IA). No modifica Neotel (solo lectura).
 *
 * Programar cada X minutos:  php  C:\ruta\al\sitio\analizar_cron.php
 * Config necesaria en config.php / secrets.local.php:
 *   CRON_USER_EMAIL, CRON_USER_PASSWORD  → usuario dedicado (Firebase Auth) para escribir en Firestore
 *   (opcional) CRON_DIAS (default 2), CRON_BASE (default http://127.0.0.1)
 */

if (php_sapi_name() !== 'cli') { http_response_code(403); exit('Este script se corre por línea de comandos, no por web.'); }
require_once __DIR__ . '/config.php';

date_default_timezone_set('America/Argentina/Buenos_Aires');
$LOG = function ($m) { fwrite(STDOUT, '[' . date('Y-m-d H:i:s') . '] ' . $m . "\n"); };

// ── candado: no correr dos veces en paralelo ────────────────────────────────
$lock = sys_get_temp_dir() . '/dasa_analizar_cron.lock';
$fh = fopen($lock, 'c');
if (!$fh || !flock($fh, LOCK_EX | LOCK_NB)) { $LOG('Ya hay otra corrida en curso — salgo.'); exit(0); }

// ── parámetros / config ─────────────────────────────────────────────────────
$DIAS    = intval(getenv('CRON_DIAS') ?: (defined('CRON_DIAS') ? CRON_DIAS : 2));
// Ventana grande forzada (ej: la tarea programada o alguien a mano con "set CRON_DIAS=40"): NO se recorre entera en
// una corrida (serían horas de escaneo por corrida y días sin mirar el día en curso). Se parte en dos: la ventana
// NORMAL queda en 2 días (ayer + anteayer, prioridad diaria) y el resto se hace como pasada PROFUNDA por chunks
// con cursor, hasta esa profundidad, y sin esperar 7 días entre pasadas (porque se pidió expresamente).
$DIAS_SEMANAL = intval(getenv('CRON_DIAS_SEMANAL') ?: (defined('CRON_DIAS_SEMANAL') ? CRON_DIAS_SEMANAL : 40));
$DIAS_FORZADO = ($DIAS > 3);
$PROFUNDIDAD  = $DIAS_FORZADO ? max($DIAS, $DIAS_SEMANAL) : $DIAS_SEMANAL;   // hasta dónde llega la pasada profunda
if ($DIAS_FORZADO) $DIAS = 2;
$BASE    = rtrim(getenv('CRON_BASE') ?: (defined('CRON_BASE') ? CRON_BASE : 'http://127.0.0.1'), '/');
$DRY     = (bool)(getenv('CRON_DRYRUN'));                 // no analiza ni guarda; solo dice qué haría
$MAX     = intval(getenv('CRON_MAX') ?: 0);               // tope de análisis por corrida (0 = sin tope)
$PROJECT = defined('FIREBASE_PROJECT_ID') ? FIREBASE_PROJECT_ID : 'dasa-calidad';
$KEY     = defined('FIREBASE_API_KEY') ? FIREBASE_API_KEY : '';
$TOKEN   = defined('NEOTEL_API_TOKEN') ? NEOTEL_API_TOKEN : '';
$FS      = "https://firestore.googleapis.com/v1/projects/$PROJECT/databases/(default)/documents";
$EMAIL   = defined('CRON_USER_EMAIL') ? CRON_USER_EMAIL : (getenv('CRON_USER_EMAIL') ?: '');
$PASS    = defined('CRON_USER_PASSWORD') ? CRON_USER_PASSWORD : (getenv('CRON_USER_PASSWORD') ?: '');

if (!$KEY)   { $LOG('FALTA FIREBASE_API_KEY en config.php'); exit(1); }
if (!$EMAIL || !$PASS) { $LOG('FALTA CRON_USER_EMAIL / CRON_USER_PASSWORD (usuario dedicado) en secrets.local.php'); exit(1); }

// ── helpers HTTP ────────────────────────────────────────────────────────────
function httpJson($method, $url, $body = null, $headers = []) {
    $ch = curl_init($url);
    $h = array_merge(['Content-Type: application/json'], $headers);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $h, CURLOPT_TIMEOUT => 180, CURLOPT_SSL_VERIFYPEER => true,
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    $r = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_error($ch);
    return [$code, $err ? ['error' => $err] : (json_decode($r, true) ?? [])];
}

// ── Firestore: typed values <-> PHP ─────────────────────────────────────────
function toFsVal($v) {
    if (is_null($v))  return ['nullValue' => null];
    if (is_bool($v))  return ['booleanValue' => $v];
    if (is_int($v))   return ['integerValue' => (string)$v];
    if (is_float($v)) return ['doubleValue' => $v];
    if (is_string($v))return ['stringValue' => $v];
    if (is_array($v)) {
        if (count($v) === 0) return ['arrayValue' => ['values' => []]];   // vacío → lista vacía (no mapa; evita el 400 de Firestore)
        $isList = array_keys($v) === range(0, count($v) - 1);
        if ($isList) return ['arrayValue' => ['values' => array_map('toFsVal', $v)]];
        $f = new stdClass(); foreach ($v as $k => $vv) $f->$k = toFsVal($vv);   // objeto para que serialice como mapa JSON
        return ['mapValue' => ['fields' => $f]];
    }
    return ['stringValue' => (string)$v];
}
function toFsFields($a) { $f = []; foreach ($a as $k => $v) $f[$k] = toFsVal($v); return $f; }
function fsDecodeVal($v) {
    if (isset($v['stringValue']))  return $v['stringValue'];
    if (isset($v['integerValue'])) return intval($v['integerValue']);
    if (isset($v['doubleValue']))  return floatval($v['doubleValue']);
    if (isset($v['booleanValue'])) return $v['booleanValue'];
    if (array_key_exists('nullValue', $v)) return null;
    if (isset($v['arrayValue']))   { $o = []; foreach (($v['arrayValue']['values'] ?? []) as $x) $o[] = fsDecodeVal($x); return $o; }
    if (isset($v['mapValue']))     { $o = []; foreach (($v['mapValue']['fields'] ?? []) as $k => $x) $o[$k] = fsDecodeVal($x); return $o; }
    return null;
}
function fsDecodeFields($fields) { $o = []; foreach (($fields ?? []) as $k => $v) $o[$k] = fsDecodeVal($v); return $o; }

// ── RESUMEN periódico por Telegram: arma el texto ───────────────────────────
// $acum = [fecha_de_llamada => [nuevas, validas, descartadas, sinAudio, errores, recuperadas, cruceFallo]] acumulado entre corridas.
function resumenTexto($desdeTs, $hastaTs, $acum, $corridas, $prof, $nGestores, $diasSemanal) {
    $tz  = new DateTimeZone('America/Argentina/Buenos_Aires');
    $fh  = function ($ts) use ($tz) { $d = new DateTime('@' . intval($ts)); $d->setTimezone($tz); return $d->format('d/m H:i'); };
    $fmt = function ($n) { return number_format(intval($n), 0, ',', '.'); };
    $tN = 0; $tV = 0; $tD = 0; $tS = 0; $tE = 0; $tR = 0; $tC = 0; $lineas = [];
    $fechas = array_keys(is_array($acum) ? $acum : []); rsort($fechas);
    foreach ($fechas as $fd) {
        $c = is_array($acum[$fd]) ? $acum[$fd] : [];
        $n = intval($c['nuevas'] ?? 0); $v = intval($c['validas'] ?? 0); $d = intval($c['descartadas'] ?? 0); $sa = intval($c['sinAudio'] ?? 0);
        $e = intval($c['errores'] ?? 0); $r = intval($c['recuperadas'] ?? 0); $cf = intval($c['cruceFallo'] ?? 0);
        $tN += $n; $tV += $v; $tD += $d; $tS += $sa; $tE += $e; $tR += $r; $tC += $cf;
        if ($n + $d + $sa + $e + $r + $cf === 0) continue;
        $fdShow = preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', (string)$fd, $m) ? "$m[3]/$m[2]" : (string)$fd;
        $extra  = ($sa ? " · sin audio $sa" : '') . ($e ? " · errores $e" : '') . ($r ? " · recuperadas $r" : '') . ($cf ? " · cruce CRM falló $cf" : '');
        $lineas[] = "  $fdShow: " . $fmt($n) . " analizadas (" . $fmt($v) . " válidas) · " . $fmt($d) . " descartadas" . $extra;
    }
    $t  = "📊 DASA C&C · resumen " . $fh($desdeTs) . " → " . $fh($hastaTs) . "\n";
    $t .= "Corridas del cron: " . intval($corridas) . "\n";
    $t .= "Analizadas con IA: " . $fmt($tN) . " (válidas " . $fmt($tV) . " · no aptas " . $fmt($tN - $tV) . ")\n";
    $t .= "Descartadas sin transcribir (CRM / audio vacío): " . $fmt($tD) . "\n";
    if ($tS || $tE || $tC || $tR) $t .= "Sin audio en NAS: " . $fmt($tS) . " · errores: " . $fmt($tE) . " · cruce CRM falló: " . $fmt($tC) . " · recuperadas: " . $fmt($tR) . "\n";
    $t .= $lineas ? "Por fecha de llamada:\n" . implode("\n", $lineas) . "\n" : "Sin llamadas nuevas para procesar en este período.\n";
    $est = (string)($prof['estado'] ?? '');
    if ($est === 'en_curso') {
        $dc = intval($prof['diaCursor'] ?? 0);
        $t .= "Pasada profunda: en curso · día $dc/$diasSemanal (" . date('d/m', strtotime("-$dc day")) . ") · gestor " . intval($prof['gestorCursor'] ?? 0) . "/" . intval($nGestores);
    } elseif ($est === 'completa') {
        $u = intval($prof['ultimaPasadaProfundaTs'] ?? 0);
        $t .= "Pasada profunda: completa el " . $fh($u) . " · la próxima arranca en " . max(0, 7 - intdiv(max(0, time() - $u), 86400)) . " días";
    } else $t .= "Pasada profunda: todavía no arrancó";
    return $t;
}

// ── auth (usuario dedicado) → idToken para leer/escribir Firestore ──────────
list($c, $auth) = httpJson('POST', "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$KEY",
    ['email' => $EMAIL, 'password' => $PASS, 'returnSecureToken' => true]);
if (empty($auth['idToken'])) { $LOG('Auth falló: ' . json_encode($auth['error'] ?? $auth)); exit(1); }
$AUTH = ['Authorization: Bearer ' . $auth['idToken']];

$fsList = function ($coll) use ($FS, $AUTH) {
    $docs = []; $page = '';
    do {
        list($c, $d) = httpJson('GET', "$FS/$coll?pageSize=300" . ($page ? "&pageToken=$page" : ''), null, $AUTH);
        foreach (($d['documents'] ?? []) as $doc) $docs[] = fsDecodeFields($doc['fields'] ?? []);
        $page = $d['nextPageToken'] ?? '';
    } while ($page);
    return $docs;
};
$fsExists = function ($path) use ($FS, $AUTH) {
    list($c, ) = httpJson('GET', "$FS/$path", null, $AUTH); return $c === 200;
};
$fsSet = function ($path, $assoc) use ($FS, $AUTH) {
    $fields = toFsFields($assoc);
    $fields['createdAt'] = ['timestampValue' => gmdate('Y-m-d\TH:i:s\Z')];
    return httpJson('PATCH', "$FS/$path", ['fields' => $fields], $AUTH);
};

// ── catálogos ───────────────────────────────────────────────────────────────
$CARTERA = getenv('CRON_CARTERA') ?: '';   // opcional: procesar SOLO una cartera (ej "Santander"). Vacío = todas.
$gestores = array_values(array_filter($fsList('usuarios'), function ($u) use ($CARTERA) {
    if (empty($u['neotelId']) || trim($u['neotelId']) === '') return false;
    if ($CARTERA !== '' && mb_stripos((string)($u['cliente'] ?? ''), $CARTERA) === false) return false;   // filtro por cartera
    return true;
}));
if (!$gestores) { $LOG('No hay gestores con Nº Neotel cargado.'); exit(0); }
$agentes = $fsList('agentes_ia');
list($c, $sysDoc) = httpJson('GET', "$FS/configuracion/sistema", null, $AUTH);
$sistema = fsDecodeFields($sysDoc['fields'] ?? []);
$MOTOR  = $sistema['transcriptor'] ?? 'openai';
$MODELO = $sistema['modelo'] ?? 'claude-haiku-4-5';
list($c, $tipDoc) = httpJson('GET', "$FS/configuracion/tipificaciones", null, $AUTH);   // override manual de qué se descarta
$_tipCfg = fsDecodeFields($tipDoc['fields'] ?? []);
$REGLAS = $_tipCfg['reglas'] ?? [];
if (!is_array($REGLAS)) $REGLAS = [];
// Regla de una tipificación: exacta primero y, si no hay, por texto normalizado (acentos rotos de
// Neotel). Antes se comparaba solo el texto exacto y se descartaban llamadas de PAGO (~220 entre el
// 10 y el 20/11/2026). Ver reglaTipif() en lib_comun.php y tests/test_reglas_tipif.php.
require_once __DIR__ . '/lib_comun.php';
$_indiceReglas = indiceReglasTipif($REGLAS);
$reglaDe = function ($tipif) use ($_indiceReglas) { return reglaTipif($_indiceReglas, $tipif); };
$MODO   = $_tipCfg['modo'] ?? 'blacklist';   // whitelist = analiza SOLO lo marcado "analizar" (pago); el resto se descarta
$TIP_UPDATE = $tipDoc['updateTime'] ?? '';   // cuándo cambió Mariana las tipificaciones por última vez (para el barrido de recuperación)
$rubricaDe = function ($cart) use ($agentes) {
    $c = mb_strtolower((string)$cart);
    foreach ($agentes as $a) { $n = mb_strtolower((string)($a['nombre'] ?? '')); if ($n && mb_strpos($c, $n) !== false) return (string)($a['prompt'] ?? ''); }
    return ''; // vacío → analizar.php usa su rúbrica por defecto
};
// ── Cruce de tipificaciones del CRM (por cartera+fecha, cacheado) → descartar ANTES de transcribir ──
$tipCache = [];
$tipDe = function ($crm, $fd) use (&$tipCache, $BASE, $TOKEN) {
    if ($crm <= 0) return ['map' => [], 'sinCRM' => true, 'error' => false];   // sin CRM → no cruzable → no descartar
    $key = $crm . '|' . $fd;
    if (isset($tipCache[$key])) return $tipCache[$key];
    $res = ['map' => [], 'sinCRM' => false, 'error' => false];
    list($c, $tp) = httpJson('POST', "$BASE/neotel_sql.php", ['action' => 'tipificaciones', 'crm' => $crm, 'desde' => $fd, 'hasta' => $fd], ['X-DASA-Token: ' . $TOKEN]);
    if (!empty($tp['sinCRM']))                                              $res['sinCRM'] = true;
    elseif (isset($tp['tipificaciones']) && is_array($tp['tipificaciones'])) $res['map'] = $tp['tipificaciones'];
    else                                                                    $res['error'] = true;
    $tipCache[$key] = $res;
    return $res;
};

// ── Pasada PROFUNDA semanal, por CHUNKS ─────────────────────────────────────
// 1 vez por semana revisa CRON_DIAS_SEMANAL días atrás (default 40) para recuperar cualquier llamada que
// quedó pendiente (audio que llegó tarde, cron caído, server sin acceso al NAS, etc.) y que NO se acumule backlog.
// NO se hace en una sola corrida: a ~45 s por llamada, 40 días serían DÍAS enteros sin mirar el día en curso.
//   · cada corrida procesa PRIMERO la ventana normal (ayer + anteayer) y DESPUÉS, como máximo CRON_BACKLOG_MIN
//     minutos (default 45) de backlog, del día más reciente al más viejo, guardando el cursor en Firestore
//     (configuracion/cron_profundo: estado, diaCursor, gestorCursor).
//   · si la corrida se corta (reinicio del server, tope de la tarea programada), la siguiente retoma del cursor.
//   · se marca "completa" recién cuando terminó los 40 días; la próxima pasada arranca 7 días después.
// Es idempotente: saltea lo ya analizado, así que solo trabaja sobre lo realmente pendiente.
$PROF = null;   // estado de la pasada profunda en curso (null = en esta corrida no se hace backlog)
$DIAS_SEMANAL = $PROFUNDIDAD;   // (calculado arriba: 40 por default, o la ventana forzada si es mayor)
$BACKLOG_MIN  = (getenv('CRON_BACKLOG_MIN') !== false) ? intval(getenv('CRON_BACKLOG_MIN')) : (defined('CRON_BACKLOG_MIN') ? intval(CRON_BACKLOG_MIN) : 45);
$guardarProf = function ($p) use ($FS, $AUTH, $DRY, $LOG) {
    if ($DRY) { $LOG("  (dry-run) guardaría cron_profundo: " . json_encode($p)); return; }
    list($pc, $pb) = httpJson('PATCH', "$FS/configuracion/cron_profundo", ['fields' => toFsFields($p)], $AUTH);
    if ($pc < 200 || $pc >= 300) $LOG("  ⚠ no pude guardar el cursor de la pasada profunda (HTTP $pc): " . json_encode($pb['error'] ?? $pb));
};
// Se evalúa SIEMPRE, venga la ventana por default o seteada por la tarea programada / a mano (ver $DIAS_FORZADO arriba).
if ($DIAS_SEMANAL > 0) {
    list($cp, $cpDoc) = httpJson('GET', "$FS/configuracion/cron_profundo", null, $AUTH);
    if ($cp === 200 || $cp === 404) {   // solo si pude leer (o el doc no existe aún); si el read falló, no toco la pasada
        $prof = ($cp === 200) ? fsDecodeFields($cpDoc['fields'] ?? []) : [];
        $ultProf = intval($prof['ultimaPasadaProfundaTs'] ?? 0);
        if (($prof['estado'] ?? '') === 'en_curso') {
            $PROF = $prof;                                      // hay una pasada a medio hacer → se retoma del cursor
        } elseif (($prof['estado'] ?? '') !== 'completa' || $DIAS_FORZADO || (time() - $ultProf) >= 7 * 86400) {
            // nunca completó una / la última fue hace 7+ días / se forzó ventana grande → arranca una nueva, del día 3 hacia atrás
            $PROF = ['estado' => 'en_curso', 'diaCursor' => $DIAS + 1, 'gestorCursor' => 0, 'iniciadaTs' => time(), 'ultimaPasadaProfundaTs' => $ultProf];
            $LOG("Pasada PROFUNDA: arranca una nueva (hasta $DIAS_SEMANAL días atrás, en chunks de $BACKLOG_MIN min por corrida).");
            $guardarProf($PROF);
        }
    }
}

// ── fechas a revisar (ayer + DIAS-1 atrás) ─────────────────────────────────
// Arranca en AYER a propósito (fix de Euge): los audios del día en curso todavía
// no están en el NAS (llegan con el backup nocturno), así que intentarlos solo
// genera errores y consume la corrida al pedo.
$fechas = [];
for ($i = 1; $i <= max(1, $DIAS); $i++) $fechas[] = date('Y-m-d', strtotime("-$i day"));

$LOG("Inicio · gestores=" . count($gestores) . " · fechas=" . implode(',', $fechas) . ($DIAS_FORZADO ? " · ventana forzada de $PROFUNDIDAD días → normal 2 + profunda por chunks" : '') . " · motor=$MOTOR · modelo=$MODELO");
$nuevas = 0; $saltadas = 0; $errores = 0; $intentos = 0; $descartadas = 0; $sinAudio = 0; $cruceFallo = 0; $validas = 0;
$porFecha = [];   // contadores por FECHA DE LLAMADA de esta corrida → se acumulan en cron_estado para el resumen periódico por Telegram
$cnt = function ($fd, $k) use (&$porFecha) { $porFecha[$fd][$k] = intval($porFecha[$fd][$k] ?? 0) + 1; };

// ── BARRIDO DE RECUPERACIÓN ──────────────────────────────────────────────────
// Si Mariana cambió las tipificaciones desde el último barrido, re-analiza las llamadas
// del MES EN CURSO que se habían descartado y AHORA corresponden "analizar". Así, al marcar
// una tipificación, las de ese mes aparecen solas (no quedan pegadas como descartadas).
$recuperadas = 0;
if (!$DRY && $TIP_UPDATE !== '') {
    list($cb, $barDoc) = httpJson('GET', "$FS/configuracion/cron_barrido", null, $AUTH);
    $ultimoBarrido = (string)(fsDecodeFields($barDoc['fields'] ?? [])['ultimoBarrido'] ?? '');
    if ($TIP_UPDATE > $ultimoBarrido) {
        $mesIni = date('Y-m-01');
        $LOG("Tipificaciones cambiaron ($TIP_UPDATE) — barrido de recuperación desde $mesIni…");
        $offset = 0;
        do {
            $q = ['structuredQuery' => [
                'from'    => [['collectionId' => 'analisis_llamadas']],
                'where'   => ['fieldFilter' => ['field' => ['fieldPath' => 'fecha'], 'op' => 'GREATER_THAN_OR_EQUAL', 'value' => ['stringValue' => $mesIni]]],
                'orderBy' => [['field' => ['fieldPath' => 'fecha'], 'direction' => 'ASCENDING']],
                'offset'  => $offset, 'limit' => 300,
            ]];
            list($cq, $qr) = httpJson('POST', "$FS:runQuery", $q, $AUTH);
            $n = 0;
            foreach ((is_array($qr) ? $qr : []) as $row) {
                if (!isset($row['document'])) continue;
                $n++;
                $f = fsDecodeFields($row['document']['fields'] ?? []);
                if (($f['origen'] ?? '') !== 'auto-descarte') continue;             // solo descartes automáticos
                if ($reglaDe((string)($f['tipif'] ?? '')) !== 'analizar') continue;   // sigue sin ser de pago → se queda descartada
                $grab2 = (string)($f['grabacion'] ?? ''); if ($grab2 === '') continue;
                $cart2 = (string)($f['cliente'] ?? '');
                list($ct, $tr2) = httpJson('POST', "$BASE/transcribir.php", ['file' => $grab2, 'motor' => $MOTOR], ['X-DASA-Token: ' . $TOKEN]);
                if (empty($tr2['ok'])) continue;                                     // sin audio todavía → otra corrida
                list($ca2, $an2) = httpJson('POST', "$BASE/analizar.php", ['transcripcion' => $tr2['transcripcion'], 'prompt' => $rubricaDe($cart2), 'cliente' => $cart2, 'modelo' => $MODELO], ['X-DASA-Token: ' . $TOKEN]);
                if (empty($an2['ok'])) continue;
                $doc2 = array_merge($an2['analisis'], [
                    'transcripcion' => $tr2['transcripcion'], 'idLlamada' => (string)($f['idLlamada'] ?? ''), 'grabacion' => $grab2,
                    'fecha' => (string)($f['fecha'] ?? ''), 'neotelId' => (string)($f['neotelId'] ?? ''), 'gestor' => (string)($f['gestor'] ?? ''),
                    'cliente' => $cart2, 'modelo' => (string)($an2['modelo'] ?? $MODELO), 'origen' => 'auto-recuperada',
                    'dni' => (string)($f['dni'] ?? ''), 'tipif' => (string)($f['tipif'] ?? ''),
                ]);
                $fsSet('analisis_llamadas/' . rawurlencode($grab2), $doc2);
                $recuperadas++; $cnt((string)($f['fecha'] ?? '?'), 'recuperadas');
                if (($doc2['es_valida'] ?? false) === true) { $validas++; $cnt((string)($f['fecha'] ?? '?'), 'validas'); }   // el barrido también cuenta para el latido de la alerta
            }
            $offset += 300;
        } while ($n === 300 && $offset < 30000);
        $LOG("Barrido: $recuperadas recuperadas (descartadas que ahora son de pago).");
        httpJson('PATCH', "$FS/configuracion/cron_barrido", ['fields' => ['ultimoBarrido' => ['stringValue' => gmdate('Y-m-d\TH:i:s\Z')]]], $AUTH);
    }
}

// ── Procesar UN día (todos los gestores desde $gDesde) ──────────────────────
// Devuelve ['completo'=>bool, 'gestorCursor'=>int, 'tope'=>bool]. Con $deadline (pasada profunda), si se vence
// corta ANTES de la próxima transcripción y devuelve completo=false con el gestor donde quedó: la próxima corrida
// retoma de ese gestor (lo que ya hizo de él se saltea por fsExists, sin gastar nada).
$procesarDia = function ($fd, $gDesde, $deadline) use (&$nuevas, &$saltadas, &$errores, &$intentos, &$descartadas, &$sinAudio, &$cruceFallo, &$validas,
                                                       $gestores, $BASE, $TOKEN, $fsExists, $fsSet, $tipDe, $reglaDe, $MODO, $MAX, $DRY, $MOTOR, $MODELO, $rubricaDe, $LOG, $cnt) {
    $nG = count($gestores);
    for ($gi = max(0, (int)$gDesde); $gi < $nG; $gi++) {
        $g = $gestores[$gi];
        if ($deadline !== null && time() >= $deadline) return ['completo' => false, 'gestorCursor' => $gi, 'tope' => false];
        list($c, $cr) = httpJson('POST', "$BASE/neotel_sql.php", ['action' => 'calls', 'usuario' => $g['neotelId'], 'fecha' => $fd], ['X-DASA-Token: ' . $TOKEN]);
        $calls = $cr['calls'] ?? [];
        foreach ($calls as $x) {
            if (($x['estado'] ?? '') !== 'ANSWER') continue;
            $grab = $x['grabacion'] ?? '';
            if (!$grab || $grab === 'NULL' || (intval($x['duracionSeg'] ?? 0)) < 20) continue;
            $path = 'analisis_llamadas/' . rawurlencode($grab);
            if ($fsExists($path)) { $saltadas++; continue; }              // ya estaba analizada → no re-hace
            // GATE CRM: descartar la no-gestión ANTES de transcribir (así NO se paga Whisper por el ~95% que se tira).
            $cartera = ($g['cliente'] ?? '') ?: ($x['campana'] ?? '');
            $idll = (string)($x['idLlamada'] ?? '');
            $tp = $tipDe((int)($x['crm'] ?? 0), $fd);
            $desc = false;
            if ($tp['error']) {                                          // el cruce con el CRM FALLÓ (Neotel no respondió / la query dio error):
                $cruceFallo++; $cnt($fd, 'cruceFallo');                  // NO descartar — podría ser una llamada de PAGO. Se saltea y se
                continue;                                                // reintenta la próxima corrida (igual que "sin audio"), en vez de
            }                                                            // pegarla como descartada para siempre por un problema transitorio.
            if (!$tp['sinCRM']) {
                if (isset($tp['map'][$idll])) {                          // override manual del supervisor > patrón auto
                    $regla = $reglaDe((string)($tp['map'][$idll]['tipif'] ?? ''));   // exacta, o normalizada si hay acentos rotos
                    if ($regla !== '')             $desc = ($regla === 'descartar');
                    elseif ($MODO === 'whitelist') $desc = true;         // lista blanca: sin regla "analizar" → se descarta (solo pago)
                    else                           $desc = !empty($tp['map'][$idll]['descartar']);
                } else { $desc = true; }                                 // sin tipificación (con CRM ok) = no-gestión
            }
            elseif ($MODO === 'whitelist') { $desc = true; }             // sinCRM (crm=0, no cruzable) → en modo solo-pago, se descarta
            if ($desc) {
                // Guardamos la TIPIFICACIÓN en el descarte → así, si Mariana la marca "analizar" más adelante,
                // el barrido de recuperación sabe cuáles re-analizar (ver barridoRecuperacion()).
                if (!$DRY) $fsSet($path, ['es_valida' => false, 'score' => 0, 'motivo' => 'descarte CRM', 'idLlamada' => $idll, 'grabacion' => $grab, 'fecha' => $fd, 'neotelId' => (string)$g['neotelId'], 'gestor' => (string)($g['name'] ?? $g['user'] ?? ''), 'cliente' => (string)$cartera, 'origen' => 'auto-descarte',
                    'tipif' => (isset($tp['map'][$idll]['tipif']) ? (string)$tp['map'][$idll]['tipif'] : ''),
                    'dni'   => (isset($tp['map'][$idll]['dni'])   ? (string)$tp['map'][$idll]['dni']   : ''),
                    'crm'   => (int)($x['crm'] ?? 0),
                    'durSeg' => (int)($x['duracionSeg'] ?? 0)]);   // para diagnosticar descartes "sin tipificación" largos
                $descartadas++; $cnt($fd, 'descartadas');
                continue;   // NO transcribe → NO gasta Whisper
            }
            if ($MAX > 0 && $intentos >= $MAX) { $LOG("Tope CRON_MAX=$MAX (intentos) alcanzado — corto."); return ['completo' => false, 'gestorCursor' => $gi, 'tope' => true]; }
            if ($deadline !== null && time() >= $deadline) return ['completo' => false, 'gestorCursor' => $gi, 'tope' => false];   // chunk de backlog agotado → retoma acá la próxima
            $intentos++;                                                    // el tope cuenta INTENTOS, no solo éxitos (evita disparadas con errores)
            if ($DRY) { $nuevas++; $cnt($fd, 'nuevas'); $LOG("  (dry-run) analizaría $fd · " . ($g['name'] ?? $g['neotelId']) . " · $grab"); continue; }
            list($c, $tr) = httpJson('POST', "$BASE/transcribir.php", ['file' => $grab, 'motor' => $MOTOR], ['X-DASA-Token: ' . $TOKEN]);
            if (empty($tr['ok'])) {
                $msg = (string)($tr['error'] ?? '?');
                // "audio no encontrado" no es error nuestro: la grabación todavía no llegó al NAS (fix de Euge).
                // No cuenta como intento (no consume CRON_MAX) ni como error; se reintenta la próxima corrida.
                if (stripos($msg, 'no encontrado') !== false || stripos($msg, 'NAS') !== false) {
                    $intentos--; $sinAudio++; $cnt($fd, 'sinAudio'); $LOG("  · sin audio en el NAS (se reintenta la próxima): $grab");
                } elseif (stripos($msg,'short')!==false || stripos($msg,'corta')!==false || stripos($msg,'vac')!==false || stripos($msg,'empty')!==false || stripos($msg,'demasiado')!==false) {
                    // grabación vacía / corrupta / demasiado corta → NO es error nuestro (pedido de Euge). Se marca
                    // DESCARTADA para que no reintente cada corrida ni ensucie el log como "error".
                    if (!$DRY) $fsSet($path, ['es_valida'=>false,'score'=>0,'motivo'=>'audio vacío o muy corto','idLlamada'=>$idll,'grabacion'=>$grab,'fecha'=>$fd,'neotelId'=>(string)$g['neotelId'],'gestor'=>(string)($g['name']??$g['user']??''),'cliente'=>(string)$cartera,'origen'=>'auto-descarte']);
                    $descartadas++; $cnt($fd, 'descartadas'); $LOG("  · descartada (audio vacío/corto): $grab");
                } else {
                    $errores++; $cnt($fd, 'errores'); $LOG("  ⚠ transcribir $grab: " . $msg);
                }
                continue;
            }
            list($c, $an) = httpJson('POST', "$BASE/analizar.php", ['transcripcion' => $tr['transcripcion'], 'prompt' => $rubricaDe($cartera), 'cliente' => $cartera, 'modelo' => $MODELO], ['X-DASA-Token: ' . $TOKEN]);
            if (empty($an['ok'])) {
                $amsg = (string)($an['error'] ?? '?');
                if (stripos($amsg,'transcrip')!==false || stripos($amsg,'corta')!==false || stripos($amsg,'vac')!==false) {
                    // sin transcripción usable → descartar (no reintentar cada corrida)
                    if (!$DRY) $fsSet($path, ['es_valida'=>false,'score'=>0,'motivo'=>'sin transcripción usable','idLlamada'=>$idll,'grabacion'=>$grab,'fecha'=>$fd,'neotelId'=>(string)$g['neotelId'],'gestor'=>(string)($g['name']??$g['user']??''),'cliente'=>(string)$cartera,'origen'=>'auto-descarte']);
                    $descartadas++; $cnt($fd, 'descartadas'); $LOG("  · descartada (sin transcripción): $grab");
                } else { $errores++; $cnt($fd, 'errores'); $LOG("  ⚠ analizar $grab: " . $amsg); }
                continue;
            }
            $_map = (isset($tp['map'][$idll]) && is_array($tp['map'][$idll])) ? $tp['map'][$idll] : [];   // DNI + tipificación del cruce CRM
            $doc = array_merge($an['analisis'], [
                'transcripcion' => $tr['transcripcion'], 'idLlamada' => (string)($x['idLlamada'] ?? ''), 'grabacion' => $grab,
                'fecha' => $fd, 'neotelId' => (string)$g['neotelId'], 'gestor' => (string)($g['name'] ?? $g['user'] ?? ''),
                'cliente' => (string)$cartera, 'campana' => (string)($x['campana'] ?? ''), 'modelo' => (string)($an['modelo'] ?? $MODELO), 'origen' => 'auto',
                // Datos de la llamada (antes NO se guardaban en el cron → por eso las auto no tenían DNI en Auditorías):
                'dni' => (string)($_map['dni'] ?? ''), 'tipif' => (string)($_map['tipif'] ?? ''),
                'telefono' => (preg_match('/^(\d{6,})-/', $grab, $mm) ? $mm[1] : ''),
                'hora' => (string)($x['hora'] ?? ''), 'dur' => (string)($x['dur'] ?? ''), 'durSeg' => (int)($x['duracionSeg'] ?? 0),
            ]);
            list($sc, $sb) = $fsSet($path, $doc);
            if ($sc >= 200 && $sc < 300) { $nuevas++; $cnt($fd, 'nuevas'); if (($doc['es_valida'] ?? false) === true) { $validas++; $cnt($fd, 'validas'); } $LOG("  ✓ $fd · " . ($g['name'] ?? $g['neotelId']) . " · score=" . ($an['analisis']['score'] ?? '?')); }
            else { $errores++; $cnt($fd, 'errores'); $LOG("  ⚠ guardar $grab: HTTP $sc · " . json_encode($sb['error'] ?? $sb)); }
        }
    }
    return ['completo' => true, 'gestorCursor' => 0, 'tope' => false];
};

// ── 1) VENTANA NORMAL (ayer + anteayer): SIEMPRE primero y sin límite de tiempo ─
$tope = false;
foreach ($fechas as $fd) { $r = $procesarDia($fd, 0, null); if ($r['tope']) { $tope = true; break; } }

// ── 2) PASADA PROFUNDA por chunks: del día 3 al 40 hacia atrás, hasta CRON_BACKLOG_MIN minutos ─
if ($PROF !== null && !$tope) {
    $deadline = time() + $BACKLOG_MIN * 60;
    $dia  = max($DIAS + 1, intval($PROF['diaCursor'] ?? ($DIAS + 1)));
    $gCur = max(0, intval($PROF['gestorCursor'] ?? 0));
    $LOG("Pasada PROFUNDA: retoma en día $dia/$DIAS_SEMANAL (" . date('Y-m-d', strtotime("-$dia day")) . "), gestor $gCur · máx $BACKLOG_MIN min en esta corrida");
    while ($dia <= $DIAS_SEMANAL && time() < $deadline) {
        $fd = date('Y-m-d', strtotime("-$dia day"));
        $r = $procesarDia($fd, $gCur, $deadline);
        if ($r['tope']) { $tope = true; break; }
        if ($r['completo']) { $dia++; $gCur = 0; } else { $gCur = $r['gestorCursor']; }
        $PROF['diaCursor'] = $dia; $PROF['gestorCursor'] = $gCur;
        $guardarProf($PROF);   // cursor persistido: si la corrida se corta, la próxima retoma acá
    }
    if ($dia > $DIAS_SEMANAL) {
        $PROF = ['estado' => 'completa', 'diaCursor' => $dia, 'gestorCursor' => 0, 'iniciadaTs' => intval($PROF['iniciadaTs'] ?? 0), 'ultimaPasadaProfundaTs' => time()];
        $guardarProf($PROF);
        $LOG("Pasada PROFUNDA: COMPLETA ($DIAS_SEMANAL días revisados). La próxima arranca en 7 días.");
    } else {
        $LOG("Pasada PROFUNDA: pausa en día $dia (" . date('Y-m-d', strtotime("-$dia day")) . "), gestor $gCur · sigue en la próxima corrida.");
    }
}
$LOG("LISTO — nuevas analizadas: $nuevas · recuperadas (tipif marcada después): $recuperadas · descartadas (no-gestión CRM, sin gastar Whisper): $descartadas · ya estaban: $saltadas · sin audio en el NAS: $sinAudio · cruce CRM falló (se reintenta, NO descartadas): $cruceFallo · errores: $errores");
if ($cruceFallo > 0) $LOG("⚠ OJO: $cruceFallo llamadas no se pudieron cruzar con el CRM (Neotel). Si el número es alto, revisar la conexión a las bases ECRM en el server — el cruce funciona (probado), así que un error masivo es de conexión, no de datos.");

// ── ALERTA DE SALUD: avisar si el cron dejó de producir análisis válidos ─────
// Latido: guarda cuándo fue la última válida. Si el cron PROCESA llamadas pero produce 0 válidas
// por más de ALERTA_HORAS, avisa por Telegram (1 vez por umbral, no spamea). Habría avisado el 1/9.
// NO alerta en días quietos (sin llamadas que procesar) → evita falsos positivos de fin de semana.
if (!$DRY) {
    $ALERTA_HORAS = intval(getenv('ALERTA_HORAS') ?: (defined('ALERTA_HORAS') ? ALERTA_HORAS : 24));
    // token/chat de un doc DEDICADO (configuracion/alertas) que el frontend NO lee → el token no se expone.
    // Prioridad: env > config.php/secrets.local.php > Firestore configuracion/alertas.
    list($ca, $alDoc) = httpJson('GET', "$FS/configuracion/alertas", null, $AUTH);
    $al = ($ca === 200) ? fsDecodeFields($alDoc['fields'] ?? []) : [];
    $TG_TOKEN = getenv('TELEGRAM_BOT_TOKEN') ?: (defined('TELEGRAM_BOT_TOKEN') ? TELEGRAM_BOT_TOKEN : ($al['telegram_bot_token'] ?? ''));
    $TG_CHAT  = getenv('TELEGRAM_CHAT_ID')   ?: (defined('TELEGRAM_CHAT_ID') ? TELEGRAM_CHAT_ID : ($al['telegram_chat_id'] ?? ''));
    $nowTs = time();
    list($ce, $estDoc) = httpJson('GET', "$FS/configuracion/cron_estado", null, $AUTH);
    if ($ce !== 200 && $ce !== 404) {                       // read transitorio de Firestore falló → NO toco nada (no piso el latido)
        $LOG("· alerta: no pude leer cron_estado (HTTP $ce), salteo esta corrida");
    } else {
        $estado = fsDecodeFields($estDoc['fields'] ?? []);
        $primera = !array_key_exists('ultimaValidaTs', $estado);   // arranque genuino (el doc no existía / sin baseline)
        $ultimaValida = intval($estado['ultimaValidaTs'] ?? 0);
        $ultimaAlerta = intval($estado['ultimaAlertaTs'] ?? 0);
        $procesadas = $nuevas + $descartadas + $sinAudio;          // trabajo REAL de esta corrida (llamadas NUEVAS que tocó)
        // El latido avanza si: hubo válidas / es el 1er arranque / fue una corrida quieta (poco que procesar).
        // Si procesó muchas y 0 válidas → NO avanza → el gap crece → alerta (ese fue el corte del 1/9).
        if ($validas > 0 || $primera || $procesadas < 15) $ultimaValida = $nowTs;
        $horasSin = ($nowTs - $ultimaValida) / 3600;
        if ($horasSin >= $ALERTA_HORAS && ($nowTs - $ultimaAlerta) >= $ALERTA_HORAS * 3600) {
            $hint = ($sinAudio > 5) ? "No están llegando los audios al NAS (el cron no los encuentra)." : "Revisar audios del NAS / crédito de OpenAI / cron.";
            $msg = "⚠️ DASA C&C: el sistema NO analiza llamadas hace " . round($horasSin) . " horas (última válida: " . gmdate('d/m H:i', $ultimaValida) . " UTC). " . $hint . " (aviso automático)";
            if ($TG_TOKEN !== '' && $TG_CHAT !== '') {
                list($wc, ) = httpJson('POST', "https://api.telegram.org/bot$TG_TOKEN/sendMessage", ['chat_id' => $TG_CHAT, 'text' => $msg]);
                if ($wc >= 200 && $wc < 300) { $ultimaAlerta = $nowTs; $LOG("🔔 ALERTA Telegram enviada: " . round($horasSin) . "h sin válidas"); }
                else { $LOG("⚠ ALERTA: falló el envío a Telegram (HTTP $wc) — se reintenta la próxima corrida"); }   // no consumo la ventana anti-spam si no salió
            } else {
                $LOG("⚠ Hace " . round($horasSin) . "h sin válidas, pero falta TELEGRAM_BOT_TOKEN/CHAT_ID (configuracion/alertas o secrets.local.php).");
            }
        }
        // ── RESUMEN periódico por Telegram (cada RESUMEN_HORAS, default 6) ──────────
        // Acumula los contadores por fecha de llamada entre corridas (en cron_estado) y, cuando pasaron
        // RESUMEN_HORAS desde el último resumen, manda UN mensaje y resetea. Si Telegram falla, sigue acumulando
        // y reintenta la próxima corrida. Se manda aunque no haya habido nada (sirve de "sigue vivo").
        $RESUMEN_HORAS = intval(getenv('RESUMEN_HORAS') ?: (defined('RESUMEN_HORAS') ? RESUMEN_HORAS : 6));
        $acum = is_array($estado['resumenAcum'] ?? null) ? $estado['resumenAcum'] : [];
        foreach ($porFecha as $fd => $cc) foreach ($cc as $k => $v) $acum[$fd][$k] = intval($acum[$fd][$k] ?? 0) + intval($v);
        $corridas = intval($estado['resumenCorridas'] ?? 0) + 1;
        $ultimoResumen = intval($estado['ultimoResumenTs'] ?? 0);
        if ($ultimoResumen === 0) $ultimoResumen = $nowTs;                                   // primer arranque: el período empieza ahora
        if ($RESUMEN_HORAS > 0 && ($nowTs - $ultimoResumen) >= $RESUMEN_HORAS * 3600) {
            if ($TG_TOKEN !== '' && $TG_CHAT !== '') {
                list($cpr, $prDoc) = httpJson('GET', "$FS/configuracion/cron_profundo", null, $AUTH);
                $profNow = ($cpr === 200) ? fsDecodeFields($prDoc['fields'] ?? []) : [];
                $texto = resumenTexto($ultimoResumen, $nowTs, $acum, $corridas, $profNow, count($gestores), $DIAS_SEMANAL);
                list($wr, ) = httpJson('POST', "https://api.telegram.org/bot$TG_TOKEN/sendMessage", ['chat_id' => $TG_CHAT, 'text' => $texto]);
                if ($wr >= 200 && $wr < 300) { $LOG("📊 Resumen Telegram enviado ($corridas corridas acumuladas)"); $ultimoResumen = $nowTs; $acum = []; $corridas = 0; }
                else $LOG("⚠ Resumen: falló el envío a Telegram (HTTP $wr) — sigue acumulando, reintenta la próxima corrida");
            } else { $LOG("⚠ Resumen: falta TELEGRAM_BOT_TOKEN/CHAT_ID (configuracion/alertas) — no se manda"); $ultimoResumen = $nowTs; $acum = []; $corridas = 0; }
        }
        $fsSet('configuracion/cron_estado', ['ultimaValidaTs' => $ultimaValida, 'ultimaAlertaTs' => $ultimaAlerta, 'ultimoRun' => $nowTs, 'validasUltimoRun' => $validas, 'procesadasUltimoRun' => $procesadas,
            'resumenAcum' => $acum, 'resumenCorridas' => $corridas, 'ultimoResumenTs' => $ultimoResumen]);
    }
}
flock($fh, LOCK_UN); fclose($fh);

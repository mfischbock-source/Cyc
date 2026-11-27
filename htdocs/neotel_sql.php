<?php
/**
 * DASA — C&C Plataforma
 * Proxy SQL Neotel — queries con estructura real de TEL_LOGS
 */

require_once __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = [ALLOWED_ORIGIN, 'https://cyc.dasaargentina.com', 'http://localhost', 'http://192.168.0.245'];
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowed) ? $origin : ALLOWED_ORIGIN));
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-DASA-Token');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Metodo no permitido']); exit;
}

$body   = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $body['action'] ?? '';

// 🔒 Autenticación: el endpoint exige un token compartido (header X-DASA-Token o body.token).
// CORS no protege contra curl/scripts; esto sí. Sin token válido no se consulta nada.
// (desde 11/2026: sesión de Firebase validada en el server o cron local — ver cyc_auth.php)
require_once __DIR__ . '/cyc_auth.php';
cyc_requerir('usuario');

// Función para sanitizar encoding antes de json_encode
function sanitizeUTF8($data) {
    if (is_array($data)) {
        return array_map('sanitizeUTF8', $data);
    }
    if (is_string($data)) {
        return mb_convert_encoding($data, 'UTF-8', 'Windows-1252');
    }
    return $data;
}

function respond(array $data, int $code = 200): void {
    http_response_code($code);
    $clean = sanitizeUTF8($data);
    $json = json_encode($clean, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    if ($json === false) {
        echo '{"error":"JSON encoding failed: ' . addslashes(json_last_error_msg()) . '"}';
    } else {
        echo $json;
    }
    exit;
}

// Valida que la fecha sea estrictamente YYYY-MM-DD. El nombre de tabla (TKyyyymmdd)
// se interpola directo en el SQL (los nombres de tabla no se pueden parametrizar),
// así que esto es la barrera anti-inyección: sin esto, una fecha maliciosa rompe el SQL.
function fechaValida(string $fecha): bool {
    return (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha);
}

function tablaTK(string $fecha): string {
    return 'TK' . str_replace('-', '', substr($fecha, 0, 10));
}

function getDB(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;

    // Permite forzar el driver por entorno (útil en dev local sobre VPN: dblib).
    // En producción la env no está seteada → usa el de config.php (o 'auto' por defecto).
    $driver = getenv('NEOTEL_DB_DRIVER') ?: (defined('NEOTEL_DB_DRIVER') ? NEOTEL_DB_DRIVER : 'auto');
    $host   = NEOTEL_DB_HOST;
    $port   = NEOTEL_DB_PORT;
    $dbname = NEOTEL_DB_NAME;

    // Arma la cadena DSN para un modo puntual
    $build = function(string $d) use ($host, $port, $dbname): string {
        switch ($d) {
            case 'sqlsrv':   return "sqlsrv:Server={$host},{$port};Database={$dbname}";
            case 'odbc_dsn': return 'odbc:' . (defined('NEOTEL_ODBC_DSN') ? NEOTEL_ODBC_DSN : $dbname);
            case 'odbc':
                $drv = defined('NEOTEL_ODBC_DRIVER') ? NEOTEL_ODBC_DRIVER : 'ODBC Driver 17 for SQL Server';
                return "odbc:Driver={{$drv}};Server={$host},{$port};Database={$dbname};TrustServerCertificate=yes";
            case 'mysql':    return "mysql:host={$host};port={$port};dbname={$dbname};charset=utf8mb4";
            case 'pgsql':    return "pgsql:host={$host};port={$port};dbname={$dbname}";
            case 'dblib':    return "dblib:host={$host}:{$port};dbname={$dbname}";
            default:         throw new RuntimeException("NEOTEL_DB_DRIVER desconocido: {$d}");
        }
    };

    // Lista de intentos. El driver configurado va primero; después, si es un entorno
    // SQL Server (no mysql/pgsql/dblib), se prueban automáticamente los drivers ODBC
    // que vienen en Windows y sqlsrv. El primero que conecta gana. Así no depende de
    // que exista un DSN ODBC pre-creado en el server.
    $candidatos = [];
    if ($driver === 'auto') {
        $candidatos[] = "odbc:Driver={ODBC Driver 18 for SQL Server};Server={$host},{$port};Database={$dbname};TrustServerCertificate=yes";
        $candidatos[] = "odbc:Driver={ODBC Driver 17 for SQL Server};Server={$host},{$port};Database={$dbname};TrustServerCertificate=yes";
        $candidatos[] = "odbc:Driver={SQL Server Native Client 11.0};Server={$host},{$port};Database={$dbname}";
        $candidatos[] = "odbc:Driver={SQL Server};Server={$host},{$port};Database={$dbname}";
        $candidatos[] = "sqlsrv:Server={$host},{$port};Database={$dbname}";
        if (defined('NEOTEL_ODBC_DSN')) $candidatos[] = 'odbc:' . NEOTEL_ODBC_DSN;
    } else {
        $candidatos[] = $build($driver);
        // belt & suspenders: si el modo configurado falla y es SQL Server, probar fallbacks
        if (!in_array($driver, ['mysql', 'pgsql', 'dblib'], true)) {
            $candidatos[] = "odbc:Driver={ODBC Driver 18 for SQL Server};Server={$host},{$port};Database={$dbname};TrustServerCertificate=yes";
            $candidatos[] = "odbc:Driver={ODBC Driver 17 for SQL Server};Server={$host},{$port};Database={$dbname};TrustServerCertificate=yes";
            $candidatos[] = "odbc:Driver={SQL Server};Server={$host},{$port};Database={$dbname}";
            $candidatos[] = "sqlsrv:Server={$host},{$port};Database={$dbname}";
        }
    }

    $errores = [];
    foreach (array_values(array_unique(array_filter($candidatos))) as $dsn) {
        try {
            $pdo = new PDO(
                $dsn,
                NEOTEL_DB_USER,
                NEOTEL_DB_PASS,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
            );
            return $pdo;
        } catch (Throwable $e) {
            $errores[] = explode(':', $dsn, 2)[0] . ' → ' . $e->getMessage();
        }
    }
    throw new RuntimeException('No se pudo conectar a Neotel por ningun metodo. ' . implode(' || ', $errores));
}

// 🔒 Candado de solo-lectura: TODA consulta a Neotel pasa por consultar().
require_once __DIR__ . '/neotel_guard.php';

try {
    $db = getDB();
} catch (Exception $e) {
    error_log('[neotel_sql] conexion: ' . $e->getMessage());
    respond(['error' => 'Sin conexion a Neotel. Revisa la VPN / conexion con el servidor telefonico.'], 503);
}

// NO-GESTIÓN (no se habló con el titular) → descartar. Patrón por DEFECTO; el supervisor puede overridear
// tipificación por tipificación desde la app (configuracion/tipificaciones en Firestore, lo aplican el frontend/cron).
function noGestionTip($tip) {
    return (bool) preg_match('/NO CONTESTA|CONTESTADOR|MENSAJE.*CONTESTAD|BUZ[OÓ]N|OCUPAD|SE CORTA|CORTAD|TIMEOUT|VOLVER A LLAMAR|RELLAMAR|INUBICABLE|EQUIVOCAD|ABONADO EN SERVICIO|FUERA DE SERVICIO|NO CONCRETADA|\bMCA\b|\bFAX\b|NO ATIENDE|SIN RESPUESTA|BUSQUEDA DE DATOS|B[UÚ]SQUEDA DE DATOS|GESTION WP|GESTI[OÓ]N WP|WP ?\/ ?MAIL|\bMAIL\b|WSP|WHATS|EN NEGOCIACI[OÓ]N POR (MAIL|WSP)/iu', mb_strtoupper((string) $tip));
}

switch ($action) {

    // Cruce con el CRM de gestión (bases ECRM, una por cartera): por cada IDLLAMADA trae
    // la TIPIFICACIÓN (Promesa de pago, No contesta, etc.) y el DNI. Sirve para mostrar,
    // filtrar/ordenar y DESCARTAR las no-gestión antes de transcribir (ahorra IA).
    case 'tipificaciones': {
        $cartera = trim($body['cartera'] ?? '');
        $desde   = $body['desde'] ?? date('Y-m-d');
        $hasta   = $body['hasta'] ?? $desde;
        if (!fechaValida($desde) || !fechaValida($hasta)) respond(['error' => 'fecha invalida (YYYY-MM-DD)'], 400);

        // Base ECRM: se deriva del NÚMERO de CRM que trae cada llamada (crm) → ECRM_{crm}. Es un ENTERO
        // validado (nunca sale texto del body a la SQL): anti-inyección. Funciona para CUALQUIER cartera.
        // Fallback: whitelist por nombre de cartera (compatibilidad con el modo viejo).
        $ECRM = ['Banco Galicia' => 'ECRM_0008', 'Banco Santander' => 'ECRM_0028', 'QIDA' => 'ECRM_0031'];
        $crm = isset($body['crm']) ? (int) $body['crm'] : 0;
        if ($crm > 0 && $crm <= 9999) {
            $ecrm = 'ECRM_' . str_pad((string) $crm, 4, '0', STR_PAD_LEFT);
        } elseif ($cartera !== '' && isset($ECRM[$cartera])) {
            $ecrm = $ECRM[$cartera];
        } else {
            respond(['ok' => true, 'cartera' => $cartera, 'crm' => $crm, 'sinCRM' => true, 'total' => 0, 'tipificaciones' => (object) []]);
        }
        $hastaExcl = date('Y-m-d', strtotime($hasta . ' +1 day'));

        // El descarte automático (default) lo da noGestionTip(); el supervisor puede overridear por tipificación desde la app.
        // Cross-database, read-only vía consultar(). El JOIN a CONTACTOS (para el DNI) se intenta primero;
        // si esa base tiene otra estructura, se reintenta SIN DNI (la tipificación es lo esencial).
        $selBase = "SELECT d.IDLLAMADA AS idLlamada, s.DESCRIPCION AS tipificacion, %DNI% AS docu, d.TS AS ts
            FROM [$ecrm].[dbo].[CONTACTOS_DETALLE] d
            JOIN [$ecrm].[dbo].[SUBCATEGORIAS] s ON s.SUBCATEGORIA = d.SUBCATEGORIA
            %CONT%
            WHERE d.FECHA >= ? AND d.FECHA < ? AND d.IDLLAMADA > 0
            ORDER BY d.IDLLAMADA, d.TS";
        $rows = null;
        try {
            $sql = str_replace(['%DNI%', '%CONT%'], ['c.TXTCUITCUIL', "LEFT JOIN [$ecrm].[dbo].[CONTACTOS] c ON c.IDINTERNO = d.IDINTERNO"], $selBase);
            $rows = consultar($db, $sql, [$desde, $hastaExcl]);
        } catch (Throwable $e1) {
            try {
                $sql = str_replace(['%DNI%', '%CONT%'], ["''", ''], $selBase);
                $rows = consultar($db, $sql, [$desde, $hastaExcl]);
            } catch (Throwable $e2) {
                error_log('[neotel_sql] tipificaciones ' . $ecrm . ': ' . $e2->getMessage());
                respond(['ok' => true, 'cartera' => $cartera, 'crm' => $crm, 'ecrm' => $ecrm, 'sinCRM' => true, 'total' => 0, 'tipificaciones' => (object) []]);
            }
        }

        $out = [];
        foreach ($rows as $r) {                       // ORDER BY TS → la última gestión de cada llamada gana
            $id  = (string) $r['idLlamada'];
            $tip = trim((string) $r['tipificacion']);            // el ECRM ya devuelve UTF-8 (a diferencia de TEL_LOGS)
            $dig = preg_replace('/\D/', '', (string) ($r['docu'] ?? ''));
            if (strlen($dig) === 11) $dig = substr($dig, 2, 8);   // CUIT → DNI (8 del medio)
            $out[$id] = ['tipif' => $tip, 'dni' => $dig, 'descartar' => noGestionTip($tip)];
        }
        // El ECRM ya devuelve UTF-8 → NO pasar por sanitizeUTF8 (rompería los acentos). Salida directa.
        http_response_code(200);
        echo json_encode(['ok' => true, 'cartera' => $cartera, 'crm' => $crm, 'ecrm' => $ecrm, 'total' => count($out), 'tipificaciones' => (object) $out], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
        exit;
    }

    case 'calls':
        $usuario  = $body['usuario'] ?? '';
        $fecha    = $body['fecha']   ?? date('Y-m-d');
        if (!$usuario) respond(['error' => 'usuario requerido'], 400);
        if (!fechaValida($fecha)) respond(['error' => 'fecha invalida (formato YYYY-MM-DD)'], 400);

        $tabla    = tablaTK($fecha);
        $fechaInt = (int) str_replace('-', '', substr($fecha, 0, 10));

        try {
            $calls = consultar($db, "
                SELECT
                    CAST(IDLLAMADA AS varchar)       AS idLlamada,
                    USUARIO                          AS usuario,
                    ESTADO                           AS estado,
                    CONVERT(varchar(19), INICIO, 120) AS inicio,
                    CONVERT(varchar(19), FIN,    120) AS fin,
                    CASE WHEN ESTADO='ANSWER' AND CONEXION > '2001-01-01'
                         THEN DATEDIFF(second, CONEXION, FIN)
                         ELSE 0 END                 AS duracionSeg,
                    ISNULL(GRABACION,'')             AS grabacion,
                    ISNULL(APLICACION,'')            AS campana,
                    ISNULL(DIRECCION,'')             AS direccion,
                    ISNULL(CRM,0)                    AS crm,
                    ISNULL(IDCONTACTO,0)             AS idContacto
                FROM [TEL_LOGS].[dbo].[$tabla]
                WHERE USUARIO = ?
                  AND FECHA   = ?
                  AND ESTADO  IN ('ANSWER','NOANSWER','BUSY','CONGESTION')
                ORDER BY INICIO ASC
            ", [$usuario, $fechaInt]);

            $total      = count($calls);
            $conectadas = 0; $conAudio = 0; $durTotal = 0;
            foreach ($calls as $c) {
                if ($c['estado'] === 'ANSWER') $conectadas++;
                if (!empty($c['grabacion'])) $conAudio++;
                $durTotal += max(0, (int)$c['duracionSeg']);
            }

            respond([
                'calls'   => $calls,
                'resumen' => [
                    'total'       => $total,
                    'conectadas'  => $conectadas,
                    'noAnswer'    => $total - $conectadas,
                    'conAudio'    => $conAudio,
                    'tasa'        => $total > 0 ? round($conectadas / $total * 100, 1) : 0,
                    'duracionProm'=> $conectadas > 0 ? round($durTotal / $conectadas) : 0,
                ]
            ]);
        } catch (Exception $e) {
            error_log('[neotel_sql] calls: ' . $e->getMessage()); respond(['error' => 'Error consultando las llamadas en Neotel.'], 500);
        }
        break;

    case 'productivity':
        $usuario = $body['usuario'] ?? '';
        $desde   = $body['desde']   ?? date('Y-m-01');
        $hasta   = $body['hasta']   ?? date('Y-m-d');
        if (!$usuario) respond(['error' => 'usuario requerido'], 400);
        if (!fechaValida($desde) || !fechaValida($hasta)) respond(['error' => 'fecha invalida (YYYY-MM-DD)'], 400);
        // marcadas = total de llamadas del usuario ese día; conectadas = las atendidas (ANSWER). Se cuenta de las
        // tablas diarias TKyyyymmdd (la fuente REAL): _PRODUCTIVIDAD_DIARIA_USUARIO daba AGENT/DIALING que NO
        // representan marcadas/conectadas (tasas imposibles como 188%). Con la TK, conectadas <= marcadas SIEMPRE.
        $out = [];
        $d = strtotime($desde); $fin = strtotime($hasta); $g = 0;
        while ($d <= $fin && $g++ < 400) {
            $fd = date('Y-m-d', $d);
            $d  = strtotime('+1 day', $d);
            if (!fechaValida($fd)) continue;
            $tabla = tablaTK($fd);
            try {
                $r = consultar($db, "SELECT COUNT(*) AS marcadas,
                        SUM(CASE WHEN ESTADO='ANSWER' THEN 1 ELSE 0 END) AS conectadas,
                        SUM(CASE WHEN ESTADO='ANSWER' AND CONEXION > '2001-01-01' THEN DATEDIFF(second, CONEXION, FIN) ELSE 0 END) AS tiempoConexionSeg
                    FROM [TEL_LOGS].[dbo].[$tabla] WHERE USUARIO = ?", [$usuario]);
            } catch (Throwable $e) { continue; }   // ese día no tiene tabla → se saltea
            $m = (int) ($r[0]['marcadas'] ?? 0);
            if ($m <= 0) continue;
            $out[] = ['dia' => $fd, 'marcadas' => $m, 'conectadas' => (int) ($r[0]['conectadas'] ?? 0), 'tiempoConexionSeg' => (int) ($r[0]['tiempoConexionSeg'] ?? 0)];
        }
        respond(['productividad' => $out]);
        break;

    case 'team_productivity':
        $fecha = $body['fecha'] ?? date('Y-m-d');
        if (!fechaValida($fecha)) respond(['error' => 'fecha invalida (YYYY-MM-DD)'], 400);
        try {
            $rows = consultar($db, "
                SELECT
                    USUARIO AS usuario,
                    SUM(AGENT)   AS marcadas,
                    SUM(DIALING) AS conectadas,
                    SUM(AGENT_TIME) AS tiempoSeg
                FROM [TEL_LOGS].[dbo].[_PRODUCTIVIDAD_DIARIA_USUARIO]
                WHERE FECHA = ? AND DIRECCION = 'SALIENTE'
                GROUP BY USUARIO ORDER BY marcadas DESC
            ", [$fecha]);
            respond(['equipo' => $rows]);
        } catch (Exception $e) {
            error_log('[neotel_sql] ' . $action . ': ' . $e->getMessage()); respond(['error' => 'Error de base de datos en Neotel.'], 500);
        }
        break;

    case 'logins':
        $fecha   = $body['fecha']   ?? date('Y-m-d');
        $usuario = $body['usuario'] ?? '';
        if (!fechaValida($fecha)) respond(['error' => 'fecha invalida (YYYY-MM-DD)'], 400);
        try {
            $sql = "SELECT USUARIO AS usuario,
                    CONVERT(varchar(19),FECHA,120) AS entrada,
                    CONVERT(varchar(19),FECHA_FIN,120) AS salida,
                    TIPO AS tipo, ISNULL(DEVICE,'') AS dispositivo,
                    DATEDIFF(minute,FECHA,FECHA_FIN) AS duracionMin
                FROM [TEL_LOGS].[dbo].[_LOGIN]
                WHERE CONVERT(date,FECHA)=? AND TIPO='Login'";
            $params = [$fecha];
            if ($usuario) { $sql .= " AND USUARIO=?"; $params[] = $usuario; }
            $sql .= " ORDER BY FECHA ASC";
            respond(['logins' => consultar($db, $sql, $params)]);
        } catch (Exception $e) {
            error_log('[neotel_sql] ' . $action . ': ' . $e->getMessage()); respond(['error' => 'Error de base de datos en Neotel.'], 500);
        }
        break;

    case 'subcategorias': {
        // Todas las tipificaciones (DESCRIPCION) de los CRM activos + el descarte sugerido por defecto.
        // Para la pantalla donde el supervisor elige cuáles se analizan y cuáles no.
        $crms = [];
        for ($i = 0; $i <= 7; $i++) {
            $tb = 'TK' . date('Ymd', strtotime("-$i day"));
            try { $r = consultar($db, "SELECT DISTINCT CRM FROM [TEL_LOGS].[dbo].[$tb] WHERE CRM > 0"); if ($r) { foreach ($r as $x) $crms[(int)$x['CRM']] = true; break; } } catch (Throwable $e) {}
        }
        // Nombre legible por CRM (para agrupar por cartera en la pantalla). Los que no estén acá salen "Cartera N".
        // CRM reales de las carteras que gestionamos (verificado cruzando Neotel 09/2026). Solo estas se muestran;
        // los demás CRM activos (campañas ajenas) no aparecen en la pantalla de Tipificaciones.
        $NOMBRE_CRM = [28=>'Banco Santander', 8=>'Banco Galicia', 31=>'QIDA', 30=>'Edenor / Edesur', 2=>'Edenor / Edesur', 33=>'Crediexpress', 83=>'AYSA'];
        $tips = []; // tipif => ['descartarAuto'=>bool, 'carteras'=>set de nombres]
        foreach (array_keys($crms) as $crm) {
            if ($crm <= 0 || $crm > 9999) continue;
            if (!isset($NOMBRE_CRM[$crm])) continue;   // solo carteras conocidas/usadas (con nombre); el resto no se muestra
            $ecrm = 'ECRM_' . str_pad((string) $crm, 4, '0', STR_PAD_LEFT);
            $nombre = $NOMBRE_CRM[$crm] ?? ('Cartera ' . $crm);
            try {
                $r = consultar($db, "SELECT DISTINCT DESCRIPCION AS d FROM [$ecrm].[dbo].[SUBCATEGORIAS] WHERE DESCRIPCION IS NOT NULL");
                foreach ($r as $x) {
                    $t = trim((string) $x['d']);
                    if ($t === '') continue;
                    if (!isset($tips[$t])) $tips[$t] = ['descartarAuto' => noGestionTip($t), 'carteras' => []];
                    $tips[$t]['carteras'][$nombre] = true;
                }
            } catch (Throwable $e) {}
        }
        $out = [];
        foreach ($tips as $t => $info) $out[] = ['tipif' => $t, 'descartarAuto' => $info['descartarAuto'], 'carteras' => array_keys($info['carteras'])];
        usort($out, function ($a, $b) { return strcmp($a['tipif'], $b['tipif']); });
        http_response_code(200);
        echo json_encode(['ok' => true, 'total' => count($out), 'tipificaciones' => $out], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
        exit;
    }

    // Buscar el AUDIO de una llamada por DNI o TELÉFONO + fecha, SIN depender de que el operador esté cargado
    // en la nómina ni de que la llamada ya esté analizada. Todo SELECT (read-only).
    //  - por TELÉFONO: directo en TEL_LOGS (el nombre de grabación arranca con el teléfono). No depende del CRM.
    //  - por DNI: en el CRM (ECRM) se busca ese DNI ese día → IDLLAMADA(s); con la IDLLAMADA, TEL_LOGS da la grabación.
    case 'buscar_audio': {
        $dni   = preg_replace('/\D/', '', (string) ($body['dni'] ?? ''));
        $tel   = preg_replace('/\D/', '', (string) ($body['telefono'] ?? ''));
        $fecha = $body['fecha'] ?? '';
        if (strlen($dni) < 6 && strlen($tel) < 8) respond(['error' => 'Ingresá DNI (6+ dígitos) o teléfono (8+ dígitos)'], 400);
        if (!fechaValida($fecha))                 respond(['error' => 'fecha invalida (YYYY-MM-DD)'], 400);
        $tabla = tablaTK($fecha);
        $selTK = "SELECT CAST(IDLLAMADA AS varchar) AS idLlamada, USUARIO AS usuario, ISNULL(GRABACION,'') AS grabacion,
                     CONVERT(varchar(19), INICIO, 120) AS inicio, ISNULL(CRM,0) AS crm,
                     CASE WHEN ESTADO='ANSWER' AND CONEXION > '2001-01-01' THEN DATEDIFF(second, CONEXION, FIN) ELSE 0 END AS durSeg";
        $res = [];
        // A) Por TELÉFONO (últimos 8 dígitos en el nombre de grabación)
        if (strlen($tel) >= 8) {
            try {
                $r = consultar($db, "$selTK FROM [TEL_LOGS].[dbo].[$tabla]
                    WHERE GRABACION LIKE ? AND GRABACION IS NOT NULL AND GRABACION <> '' AND GRABACION <> 'NULL'", ['%' . substr($tel, -8) . '%']);
                foreach ($r as $t) $res[] = ['idLlamada' => (string)$t['idLlamada'], 'grabacion' => (string)$t['grabacion'], 'usuario' => (string)$t['usuario'], 'inicio' => (string)$t['inicio'], 'durSeg' => (int)$t['durSeg'], 'tipif' => '', 'crm' => (int)$t['crm'], 'via' => 'telefono'];
            } catch (Throwable $e) {}
        }
        // B) Por DNI (vía CRM)
        if (strlen($dni) >= 6) {
            $crmIn = isset($body['crm']) ? (int) $body['crm'] : 0;
            $CRMS  = ($crmIn > 0 && $crmIn <= 9999) ? [$crmIn] : [28, 8, 31, 30, 2, 33, 83];
            $hastaExcl = date('Y-m-d', strtotime($fecha . ' +1 day'));
            foreach ($CRMS as $c) {
                if ($c <= 0 || $c > 9999) continue;
                $ecrm = 'ECRM_' . str_pad((string) $c, 4, '0', STR_PAD_LEFT);
                try {
                    $rows = consultar($db, "SELECT DISTINCT d.IDLLAMADA AS idLlamada, s.DESCRIPCION AS tipif
                        FROM [$ecrm].[dbo].[CONTACTOS_DETALLE] d
                        JOIN [$ecrm].[dbo].[CONTACTOS] c ON c.IDINTERNO = d.IDINTERNO
                        LEFT JOIN [$ecrm].[dbo].[SUBCATEGORIAS] s ON s.SUBCATEGORIA = d.SUBCATEGORIA
                        WHERE d.FECHA >= ? AND d.FECHA < ? AND d.IDLLAMADA > 0 AND c.TXTCUITCUIL LIKE ?", [$fecha, $hastaExcl, '%' . $dni . '%']);
                } catch (Throwable $e) { continue; }
                if (!$rows) continue;
                $tips = [];
                foreach ($rows as $r) $tips[(string) $r['idLlamada']] = trim((string) $r['tipif']);
                if (!$tips) continue;
                $idList = implode(',', array_map('intval', array_keys($tips)));
                try {
                    $trows = consultar($db, "$selTK FROM [TEL_LOGS].[dbo].[$tabla]
                        WHERE IDLLAMADA IN ($idList) AND GRABACION IS NOT NULL AND GRABACION <> '' AND GRABACION <> 'NULL'");
                } catch (Throwable $e) { continue; }
                foreach ($trows as $t) {
                    $idl = (string) $t['idLlamada'];
                    $res[] = ['idLlamada' => $idl, 'grabacion' => (string)$t['grabacion'], 'usuario' => (string)$t['usuario'], 'inicio' => (string)$t['inicio'], 'durSeg' => (int)$t['durSeg'], 'tipif' => $tips[$idl] ?? '', 'crm' => $c, 'via' => 'dni'];
                }
            }
        }
        respond(['ok' => true, 'dni' => $dni, 'telefono' => $tel, 'fecha' => $fecha, 'total' => count($res), 'resultados' => $res]);
    }

    // Buscar una llamada DIRECTO en Neotel por NÚMERO (ID de llamada, ID de contacto o teléfono),
    // en un rango de fechas. NO depende de que la llamada esté analizada. Todo SELECT (read-only).
    // Neotel guarda por día (tablas TKyyyymmdd): se arma UN solo UNION sobre las tablas que existen en el rango.
    case 'buscar_numero': {
        // Busca DIRECTO en Neotel por número(s). Enruta CADA número por su LARGO y arma consultas por lotes (IN)
        // → búsqueda MASIVA rápida (una sola vuelta a la base por tipo). 9 díg = ID de llamada · 7-8 = DNI ·
        // 10-13 = teléfono · 4-6 = operador/contacto. Todo SELECT (read-only).
        $raw = $body['numeros'] ?? $body['numero'] ?? '';
        $lista = is_array($raw) ? $raw : preg_split('/[\s,;]+/', (string) $raw);
        $set = [];
        foreach ($lista as $x) { $x = preg_replace('/\D/', '', (string) $x); if ($x !== '') $set[$x] = true; }
        $nums = array_keys($set);
        $desde = (string) ($body['desde'] ?? '');
        $hasta = (string) ($body['hasta'] ?? $desde);
        if (!$nums)                                        respond(['error' => 'Ingresá al menos un número.'], 400);
        if (count($nums) > 300)                            respond(['error' => 'Demasiados números (máximo 300).'], 400);
        if (!fechaValida($desde) || !fechaValida($hasta))  respond(['error' => 'Rango de fechas inválido (YYYY-MM-DD).'], 400);
        $d0 = strtotime(substr($desde, 0, 10)); $d1 = strtotime(substr($hasta, 0, 10));
        if ($d1 < $d0) { $tmp = $d0; $d0 = $d1; $d1 = $tmp; }
        if (($d1 - $d0) / 86400 > 45)                      respond(['error' => 'El rango no puede superar los 45 días.'], 400);
        $tkDesde = 'TK' . date('Ymd', $d0); $tkHasta = 'TK' . date('Ymd', $d1);
        try {
            $tabs = consultar($db, "SELECT name FROM [TEL_LOGS].sys.tables WHERE name LIKE 'TK________' AND name >= ? AND name <= ? ORDER BY name", [$tkDesde, $tkHasta]);
        } catch (Throwable $e) { respond(['error' => 'No se pudieron listar las tablas de Neotel: ' . $e->getMessage()], 500); }
        $tablas = [];
        foreach ($tabs as $t) { $nm = (string) $t['name']; if (preg_match('/^TK\d{8}$/', $nm)) $tablas[] = $nm; }
        if (!$tablas) respond(['ok' => true, 'total' => 0, 'resultados' => [], 'notas' => []]);
        // Clasificar por largo
        $callIds = []; $dnis = []; $phones = []; $shorts = []; $notas = [];
        foreach ($nums as $n) {
            $L = strlen($n);
            if ($L === 9)                    $callIds[] = $n;
            elseif ($L >= 10 && $L <= 13)    $phones[]  = $n;
            elseif ($L >= 7 && $L <= 8)      $dnis[]    = $n;
            elseif ($L >= 4 && $L <= 6)      $shorts[]  = $n;   // operador o contacto
            else                             $notas[$n] = 'largo inválido (' . $L . ' díg.): no es ID de llamada (9), DNI (7-8), teléfono (10-13) ni operador/contacto (4-6)';
        }
        $sel  = "SELECT CAST(IDLLAMADA AS varchar) AS idLlamada, ISNULL(IDCONTACTO,0) AS idContacto, USUARIO AS usuario, ISNULL(GRABACION,'') AS grabacion, CONVERT(varchar(19),INICIO,120) AS inicio, ESTADO AS estado, ISNULL(CRM,0) AS crm, CASE WHEN ESTADO='ANSWER' AND CONEXION>'2001-01-01' THEN DATEDIFF(second,CONEXION,FIN) ELSE 0 END AS durSeg";
        $cond = "GRABACION IS NOT NULL AND GRABACION <> '' AND GRABACION <> 'NULL'";
        $res = [];
        $addRows = function ($rows) use (&$res) {
            foreach ($rows as $r) $res[] = ['idLlamada'=>(string)$r['idLlamada'],'idContacto'=>(string)$r['idContacto'],'usuario'=>(string)$r['usuario'],'grabacion'=>(string)$r['grabacion'],'inicio'=>(string)$r['inicio'],'estado'=>(string)$r['estado'],'crm'=>(int)$r['crm'],'durSeg'=>(int)$r['durSeg']];
        };
        $unionSobreTablas = function ($whereFrag) use ($tablas, $sel, $cond) {
            $parts = []; foreach ($tablas as $tk) $parts[] = "$sel FROM [TEL_LOGS].[dbo].[$tk] WHERE ($whereFrag) AND $cond";
            return "SELECT TOP 1000 * FROM (\n" . implode("\nUNION ALL\n", $parts) . "\n) q";
        };
        // ID de llamada (9): IDLLAMADA IN (…)  — trae exactamente esas llamadas
        if ($callIds) {
            $in = implode(',', array_map('intval', $callIds));
            try { $addRows(consultar($db, $unionSobreTablas("IDLLAMADA IN ($in)"))); } catch (Throwable $e) {}
        }
        // Operador / contacto (4-6): USUARIO IN (…) OR IDCONTACTO IN (…)
        if ($shorts) {
            $in = implode(',', array_map('intval', $shorts));
            try { $addRows(consultar($db, $unionSobreTablas("USUARIO IN ($in) OR IDCONTACTO IN ($in)"))); } catch (Throwable $e) {}
        }
        // Teléfono (10-13): GRABACION LIKE 'p%' OR …
        if ($phones) {
            $ors = []; foreach ($phones as $ph) $ors[] = "GRABACION LIKE '" . $ph . "%'";
            try { $addRows(consultar($db, $unionSobreTablas(implode(' OR ', $ors)))); } catch (Throwable $e) {}
        }
        // DNI (7-8): vía CRM (ECRM por cartera), día por día → IDLLAMADA(s) → TK para la grabación
        if ($dnis) {
            $CRMS = [28, 8, 31, 30, 2, 33, 83];
            $ids = [];
            $dniOr = []; foreach ($dnis as $dn) $dniOr[] = "c.TXTCUITCUIL LIKE '%" . $dn . "%'";
            $dniWhere = '(' . implode(' OR ', $dniOr) . ')';
            foreach ($tablas as $tk) {
                $fecha = substr($tk, 2, 4) . '-' . substr($tk, 6, 2) . '-' . substr($tk, 8, 2);
                $hastaExcl = date('Y-m-d', strtotime($fecha . ' +1 day'));
                foreach ($CRMS as $c) {
                    $ecrm = 'ECRM_' . str_pad((string) $c, 4, '0', STR_PAD_LEFT);
                    try {
                        $rows = consultar($db, "SELECT DISTINCT d.IDLLAMADA AS idLlamada FROM [$ecrm].[dbo].[CONTACTOS_DETALLE] d JOIN [$ecrm].[dbo].[CONTACTOS] c ON c.IDINTERNO = d.IDINTERNO WHERE d.FECHA >= ? AND d.FECHA < ? AND d.IDLLAMADA > 0 AND $dniWhere", [$fecha, $hastaExcl]);
                    } catch (Throwable $e) { continue; }
                    foreach ($rows as $r) { $ids[$tk][] = (int) $r['idLlamada']; }
                }
            }
            $parts = [];
            foreach ($ids as $tk => $lst) { if ($lst) $parts[] = "$sel FROM [TEL_LOGS].[dbo].[$tk] WHERE IDLLAMADA IN (" . implode(',', array_unique($lst)) . ") AND $cond"; }
            if ($parts) { try { $addRows(consultar($db, "SELECT TOP 1000 * FROM (\n" . implode("\nUNION ALL\n", $parts) . "\n) q")); } catch (Throwable $e) {} }
        }
        // Dedup por grabación y ordenar por fecha desc
        $uniq = [];
        foreach ($res as $r) { $k = $r['grabacion'] !== '' ? $r['grabacion'] : $r['idLlamada']; $uniq[$k] = $r; }
        $res = array_values($uniq);
        usort($res, function ($a, $b) { return strcmp($b['inicio'], $a['inicio']); });
        // Qué números de la ENTRADA matchearon (para avisar los que no aparecieron)
        $encontrados = [];
        foreach ($res as $r) {
            $encontrados[$r['idLlamada']] = true;
            $encontrados[(string) $r['idContacto']] = true;
            $encontrados[(string) $r['usuario']] = true;
            if (preg_match('/^(\d+)-/', $r['grabacion'], $mm)) $encontrados[$mm[1]] = true;
        }
        $noEnc = [];
        foreach ($nums as $n) { if (empty($encontrados[$n]) && empty($notas[$n])) $noEnc[] = $n; }
        respond(['ok' => true, 'desde' => $desde, 'hasta' => $hasta, 'total' => count($res), 'resultados' => $res, 'noEncontradas' => $noEnc, 'notas' => $notas]);
    }


    default:
        respond(['error' => 'Accion desconocida: ' . htmlspecialchars($action)], 400);
}

<?php
/**
 * DASA — C&C v2 · api/_lib.php
 * ───────────────────────────────────────────────────────────────────────────
 * Librería común de los 3 endpoints del v2 (buscar.php, catalogo.php, zip.php).
 * NO se incluye neotel_sql.php (ejecuta su switch de acciones al cargarse) — lo
 * de acá está COPIADO de neotel_sql.php (probado contra Neotel real) donde se
 * indica, más los helpers nuevos del contrato v2 (PLAN-V2.md § 3).
 * Solo lectura: TODO SQL contra Neotel pasa por consultar() (neotel_guard.php).
 */

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/../../neotel_guard.php';   // 🔒 consultar()/assertSoloLectura
require_once __DIR__ . '/../../lib_comun.php';      // normTip, tipoLlamadaDe, sanitizarUtf8

set_time_limit(0);

// ── CORS + método — copiado de neotel_sql.php (probado) ─────────────────────
header('Content-Type: application/json; charset=utf-8');
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = [ALLOWED_ORIGIN, 'https://cyc.dasaargentina.com', 'http://localhost', 'http://192.168.0.245'];
header('Access-Control-Allow-Origin: ' . (in_array($origin, $allowed) ? $origin : ALLOWED_ORIGIN));
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-DASA-Token');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// respond() — copiado de neotel_sql.php (probado): UTF-8 saneado + JSON_UNESCAPED_UNICODE.
function respond(array $data, int $code = 200): void {
    http_response_code($code);
    $clean = sanitizarUtf8($data);
    $json = json_encode($clean, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    if ($json === false) {
        echo '{"error":"JSON encoding failed: ' . addslashes(json_last_error_msg()) . '"}';
    } else {
        echo $json;
    }
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(['error' => 'Metodo no permitido'], 405);
}

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) $body = [];

// Autenticación — copiado de neotel_sql.php (probado): header X-DASA-Token (o body.token), hash_equals.
// (desde 11/2026: sesión de Firebase validada en el server — ver cyc_auth.php)
require_once __DIR__ . '/../../cyc_auth.php';
cyc_requerir('usuario');

// fechaValida() — copiado de neotel_sql.php (probado). El nombre de tabla (TKyyyymmdd) se
// interpola directo en el SQL: esta es la barrera anti-inyección (no debilitar).
function fechaValida(string $fecha): bool {
    return (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha);
}

function tablaTK(string $fecha): string {
    return 'TK' . str_replace('-', '', substr($fecha, 0, 10));
}

// getDB() — copiado de neotel_sql.php (probado contra Neotel real).
function getDB(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;

    $driver = getenv('NEOTEL_DB_DRIVER') ?: (defined('NEOTEL_DB_DRIVER') ? NEOTEL_DB_DRIVER : 'auto');
    $host   = NEOTEL_DB_HOST;
    $port   = NEOTEL_DB_PORT;
    $dbname = NEOTEL_DB_NAME;

    $build = function (string $d) use ($host, $port, $dbname): string {
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

    // Chequeo rápido de red ANTES de probar drivers (solo v2): si el servidor de Neotel no contesta,
    // se avisa en ~3 s en vez de esperar el timeout de cada driver en cadena (medido: 88 s con la VPN caída).
    if (in_array($driver, ['auto', 'dblib', 'sqlsrv', 'odbc'], true) && is_string($host) && $host !== '') {
        $errno = 0; $errstr = '';
        $sock = @fsockopen($host, (int) $port, $errno, $errstr, 3);
        if (!$sock) throw new RuntimeException('Neotel no responde en ' . $host . ':' . $port . ' (' . $errstr . ')');
        fclose($sock);
    }

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

// ── Mapa ÚNICO cliente → carteras (PLAN-V2.md § 3.1). Nombres de cliente IGUALES
// a usuarios.cliente / agentes_ia.nombre. Los que no tienen CRM confirmado quedan
// con carteras:[] hasta que se confirmen (NO inventar números de CRM).
function mapaClientes(): array {
    return [
        'Banco Santander'   => [['crm' => 28, 'nombre' => 'Santander']],
        'Banco Galicia'     => [['crm' => 8,  'nombre' => 'Galicia']],
        'QIDA'              => [['crm' => 31, 'nombre' => 'QIDA']],
        'Edenor'            => [['crm' => 30, 'nombre' => 'Edenor'], ['crm' => 2, 'nombre' => 'Edenor 2']],
        'Edesur'            => [],
        'AYSA'              => [['crm' => 83, 'nombre' => 'AYSA']],
        'CREDIPEXPRESS'     => [['crm' => 33, 'nombre' => 'Crediexpress']],
        'Argenpesos'        => [],
        'Banco Hipotecario' => [],
    ];
}

// Lista plana de todos los CRM conocidos (con cartera confirmada). Se usa como whitelist
// anti-inyección (todo crm que llegue del body se valida contra esta lista) y como default
// cuando la búsqueda no especifica clientes ni crms ("todas").
function carterasConocidas(): array {
    $out = [];
    foreach (mapaClientes() as $carteras) {
        foreach ($carteras as $c) $out[] = (int) $c['crm'];
    }
    return $out;
}

// crm → {cliente, cartera}. Para rellenar esos dos campos en cada fila de resultado.
function crmNombre(int $crm): array {
    static $rev = null;
    if ($rev === null) {
        $rev = [];
        foreach (mapaClientes() as $cliente => $carteras) {
            foreach ($carteras as $c) $rev[(int) $c['crm']] = ['cliente' => $cliente, 'cartera' => $c['nombre']];
        }
    }
    return $rev[$crm] ?? ['cliente' => '', 'cartera' => ''];
}

// Titular + Nº de cuenta/póliza por cartera — copiado de neotel_sql.php (probado, pedido de
// Mariana / rastreo Edenor). null = esa cartera no tiene ese dato cargado en el CRM.
function crmCamposMap(): array {
    return [
        30 => ['titular' => 'TXTDEUDOR', 'cuenta' => 'TXTPOLIZA',    'label' => 'Póliza'],     // Edenor
        2  => ['titular' => 'TXTDEUDOR', 'cuenta' => 'TXTPOLIZA',    'label' => 'Póliza'],     // Edenor 2
        83 => ['titular' => 'TXTDEUDOR', 'cuenta' => 'INTCONTRATO',  'label' => 'Contrato'],   // AYSA
        31 => ['titular' => null,        'cuenta' => 'TXTCUENTA',    'label' => 'Cuenta'],     // QIDA
        33 => ['titular' => null,        'cuenta' => 'TXTIDCLIENTE', 'label' => 'ID cliente'], // Crediexpress
        28 => ['titular' => null,        'cuenta' => null,           'label' => ''],           // Santander
        8  => ['titular' => null,        'cuenta' => null,           'label' => ''],           // Galicia
    ];
}

function nombreEcrm(int $crm): string {
    return 'ECRM_' . str_pad((string) $crm, 4, '0', STR_PAD_LEFT);
}

// Intento del discador sin procesar (NO es una gestión real) — mismo patrón que buscar_numero.
function esIntentoDiscador(string $tipif): bool {
    return (bool) preg_match('/not processed|processing|rejected|discador/i', $tipif);
}

function soloDigitos($s): string {
    return preg_replace('/\D/', '', (string) $s);
}

function clampInt($v, int $min, int $max, int $default): int {
    $v = (int) $v;
    if ($v <= 0) return $default;
    return max($min, min($max, $v));
}

// Tablas TKyyyymmdd que EXISTEN de verdad en el rango — copiado del patrón de buscar_numero
// (SELECT name FROM sys.tables): evita interpolar nombres de tabla que no fueron confirmados
// por el propio server (anti-inyección) y evita pegarle a días sin tabla.
function tablasEnRango(PDO $db, string $desde, string $hasta): array {
    $tkDesde = tablaTK($desde);
    $tkHasta = tablaTK($hasta);
    $tabs = consultar($db, "SELECT name FROM [TEL_LOGS].sys.tables WHERE name LIKE 'TK________' AND name >= ? AND name <= ? ORDER BY name", [$tkDesde, $tkHasta]);
    $tablas = [];
    foreach ($tabs as $t) {
        $nm = (string) $t['name'];
        if (preg_match('/^TK\d{8}$/', $nm)) $tablas[] = $nm;
    }
    return $tablas;
}

// Enriquecimiento CRM (punto 3 del plan): completa tipif/dni/titular/cuenta/cuentaLabel de filas
// que ya tienen idLlamada (>0), cruzando CONTACTOS_DETALLE+CONTACTOS+SUBCATEGORIAS de cada ECRM
// de las carteras dadas ($crms — a diferencia del enriquecerDesdeCRM de neotel_sql.php, acá SÍ se
// restringe a las carteras en juego en la búsqueda, no a las 7 conocidas siempre). Reglas:
//   - Solo consulta lo que FALTA (no repite trabajo si la fila ya trae el dato).
//   - NUNCA pisa un valor no vacío que la fila ya traiga ($rows por REFERENCIA).
//   - IN en tandas de ≤500 ids.
function enriquecerCRM(PDO $db, array &$rows, array $crms, string $desde, string $hasta): void {
    $idsFaltan = [];
    foreach ($rows as $r) {
        $idl = (int) ($r['idLlamada'] ?? 0);
        if ($idl <= 0) continue;
        $faltaAlgo = empty($r['tipif']) || empty($r['dni']) || (empty($r['titular']) && empty($r['cuenta']));
        if ($faltaAlgo) $idsFaltan[$idl] = true;
    }
    if (!$idsFaltan) return;

    $ids       = array_keys($idsFaltan);
    $hastaExcl = date('Y-m-d', strtotime($hasta . ' +1 day'));
    $CAMPOS    = crmCamposMap();
    $info      = [];   // idLlamada(string) => ['tipif','dni','titular','cuenta','cuentaLabel']

    foreach ($crms as $c) {
        $ecrm   = nombreEcrm($c);
        $campos = $CAMPOS[$c] ?? ['titular' => null, 'cuenta' => null, 'label' => ''];
        $selTit = $campos['titular'] ? ('c.' . $campos['titular']) : "''";
        $selCta = $campos['cuenta']  ? ('CAST(c.' . $campos['cuenta'] . ' AS varchar)') : "''";
        foreach (array_chunk($ids, 500) as $tanda) {
            $inList = implode(',', array_map('intval', $tanda));
            try {
                $rows2 = consultar($db, "SELECT d.IDLLAMADA AS idLlamada, s.DESCRIPCION AS tipif, c.TXTCUITCUIL AS docu, $selTit AS titular, $selCta AS cuenta
                    FROM [$ecrm].[dbo].[CONTACTOS_DETALLE] d
                    JOIN [$ecrm].[dbo].[CONTACTOS] c ON c.IDINTERNO = d.IDINTERNO
                    LEFT JOIN [$ecrm].[dbo].[SUBCATEGORIAS] s ON s.SUBCATEGORIA = d.SUBCATEGORIA
                    WHERE d.FECHA >= ? AND d.FECHA < ? AND d.IDLLAMADA IN ($inList)
                    ORDER BY d.TS", [$desde, $hastaExcl]);
            } catch (Throwable $e) { continue; }
            foreach ($rows2 as $rr) {
                $idl = (string) $rr['idLlamada'];
                $tip = trim((string) ($rr['tipif'] ?? ''));
                $dig = preg_replace('/\D/', '', (string) ($rr['docu'] ?? ''));
                if (strlen($dig) === 11) $dig = substr($dig, 2, 8);   // CUIT → DNI (8 del medio)
                $tit = trim((string) ($rr['titular'] ?? ''));
                if ($tit !== '' && (strpos($tit, '#') !== false || strpos($tit, '¿') !== false)) $tit = '';
                $cta = trim((string) ($rr['cuenta'] ?? ''));
                if ($tip === '' && $dig === '' && $tit === '' && $cta === '') continue;
                $prev = $info[$idl] ?? [];
                $info[$idl] = [
                    'tipif'       => $tip !== '' ? $tip : ($prev['tipif'] ?? ''),
                    'dni'         => $dig !== '' ? $dig : ($prev['dni'] ?? ''),
                    'titular'     => $tit !== '' ? $tit : ($prev['titular'] ?? ''),
                    'cuenta'      => $cta !== '' ? $cta : ($prev['cuenta'] ?? ''),
                    'cuentaLabel' => $cta !== '' ? $campos['label'] : ($prev['cuentaLabel'] ?? ''),
                ];
            }
        }
    }

    foreach ($rows as $k => $r) {
        $idl = (string) (int) ($r['idLlamada'] ?? 0);
        if ($idl === '0' || !isset($info[$idl])) continue;
        if (empty($rows[$k]['tipif']))   $rows[$k]['tipif']   = $info[$idl]['tipif'];
        if (empty($rows[$k]['dni']))     $rows[$k]['dni']     = $info[$idl]['dni'];
        if (empty($rows[$k]['titular'])) $rows[$k]['titular'] = $info[$idl]['titular'];
        if (empty($rows[$k]['cuenta']))  { $rows[$k]['cuenta'] = $info[$idl]['cuenta']; $rows[$k]['cuentaLabel'] = $info[$idl]['cuentaLabel']; }
    }
}

<?php
/**
 * DASA — C&C  ·  MOCK LOCAL de Neotel
 * ───────────────────────────────────────────────────────────────────────────
 * Devuelve datos REALISTAS con la MISMA forma que neotel_sql.php, para poder
 * desarrollar y ver la UI andando sin acceso a la red interna de DASA.
 *
 * ⚠️  Esto NO se usa en producción: el frontend solo apunta acá cuando corre
 *     en localhost (ver index.html). En el server de DASA se usa neotel_sql.php.
 *
 * Genera datos deterministas a partir de (usuario + fecha) para que cada vez
 * que cargás la misma fecha veas los mismos números (no cambian al refrescar).
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$body   = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $body['action'] ?? '';

// Semilla determinista a partir de un texto
function seed(string $s): int { return (int) (crc32($s) & 0x7fffffff); }
// PRNG determinista simple (LCG) a partir de una semilla
function rng(int &$state): float {
    $state = ($state * 1103515245 + 12345) & 0x7fffffff;
    return $state / 0x7fffffff;
}
function ri(int &$state, int $min, int $max): int {
    return $min + (int) floor(rng($state) * ($max - $min + 1));
}

function respond(array $data): void {
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

switch ($action) {

    // ── LLAMADAS de un gestor en una fecha ────────────────────────────────
    case 'calls': {
        $usuario = $body['usuario'] ?? '1041';
        $fecha   = $body['fecha']   ?? date('Y-m-d');
        $fechaC  = str_replace('-', '', substr($fecha, 0, 10)); // YYYYMMDD
        $st = seed($usuario . $fecha);

        $totalGen = ri($st, 35, 60);              // entre 35 y 60 llamadas
        $estados  = ['ANSWER','ANSWER','ANSWER','NOANSWER','BUSY','CONGESTION'];
        $camps    = ['BG_MORA_TEMPRANA','BG_PREVENTIVO','SANTANDER_RECUPERO','BG_GESTION'];
        $calls = []; $conectadas = 0; $conAudio = 0; $durTotal = 0;
        $hora = 9 * 3600; // arranca 09:00

        for ($i = 0; $i < $totalGen; $i++) {
            $estado = $estados[ri($st, 0, count($estados) - 1)];
            $hora  += ri($st, 40, 280); // segundos hasta la próxima llamada
            $hh = str_pad((string) intdiv($hora, 3600), 2, '0', STR_PAD_LEFT);
            $mm = str_pad((string) intdiv($hora % 3600, 60), 2, '0', STR_PAD_LEFT);
            $ss = str_pad((string) ($hora % 60), 2, '0', STR_PAD_LEFT);
            $inicio = "$fecha $hh:$mm:$ss";

            $dur = $estado === 'ANSWER' ? ri($st, 25, 360) : 0;
            $finSec = $hora + $dur;
            $fin = sprintf('%s %02d:%02d:%02d', $fecha, intdiv($finSec, 3600), intdiv($finSec % 3600, 60), $finSec % 60);

            $idLlamada = (string) (1500000000 + seed($usuario . $i . $fecha) % 90000000);
            $tel = '11' . ri($st, 30000000, 69999999);
            // graba solo algunas ANSWER
            $grabacion = ($estado === 'ANSWER' && rng($st) > 0.25)
                ? "{$tel}-{$idLlamada}-{$fechaC}{$hh}{$mm}{$ss}.mp3"
                : '';

            if ($estado === 'ANSWER') $conectadas++;
            if ($grabacion) $conAudio++;
            $durTotal += $dur;

            $calls[] = [
                'idLlamada'   => $idLlamada,
                'usuario'     => $usuario,
                'estado'      => $estado,
                'inicio'      => $inicio,
                'fin'         => $fin,
                'duracionSeg' => $dur,
                'grabacion'   => $grabacion,
                'campana'     => $camps[ri($st, 0, count($camps) - 1)],
                'direccion'   => 'SALIENTE',
            ];
        }

        $total = count($calls);
        respond([
            'calls'   => $calls,
            'resumen' => [
                'total'        => $total,
                'conectadas'   => $conectadas,
                'noAnswer'     => $total - $conectadas,
                'conAudio'     => $conAudio,
                'tasa'         => $total > 0 ? round($conectadas / $total * 100, 1) : 0,
                'duracionProm' => $conectadas > 0 ? round($durTotal / $conectadas) : 0,
            ],
        ]);
    }

    // ── PRODUCTIVIDAD día a día de un gestor ──────────────────────────────
    case 'productivity': {
        $usuario = $body['usuario'] ?? '1041';
        $desde   = $body['desde']   ?? date('Y-m-01');
        $hasta   = $body['hasta']   ?? date('Y-m-d');
        $out = [];
        $ts = strtotime($desde);
        $te = strtotime($hasta);
        for (; $ts <= $te; $ts = strtotime('+1 day', $ts)) {
            $dia = date('Y-m-d', $ts);
            $dow = (int) date('N', $ts);
            if ($dow >= 6) continue; // sin fines de semana (días no trabajados)
            $st = seed($usuario . $dia);
            $marcadas   = ri($st, 40, 80);
            $conectadas = ri($st, 30, 95);            // incluye entrantes → puede superar marcadas
            $out[] = [
                'dia'               => $dia,
                'conectadas'        => $conectadas,
                'marcadas'          => $marcadas,
                'tiempoConexionSeg' => ri($st, 9000, 21000),  // 2.5–5.8 h
                'tiempoMarcadoSeg'  => ri($st, 1200, 4000),
            ];
        }
        respond(['productividad' => $out]);
    }

    // ── PRODUCTIVIDAD del equipo en una fecha ─────────────────────────────
    case 'team_productivity': {
        $fecha = $body['fecha'] ?? date('Y-m-d');
        $gestores = ['1041','1566','1280','1015','1099','1342','1188'];
        $eq = [];
        foreach ($gestores as $g) {
            $st = seed($g . $fecha);
            $eq[] = [
                'usuario'    => $g,
                'conectadas' => ri($st, 30, 95),
                'marcadas'   => ri($st, 40, 80),
                'tiempoSeg'  => ri($st, 9000, 21000),
            ];
        }
        usort($eq, fn($a, $b) => $b['conectadas'] <=> $a['conectadas']);
        respond(['equipo' => $eq]);
    }

    // ── LOGUEOS del día ───────────────────────────────────────────────────
    case 'logins': {
        $fecha   = $body['fecha']   ?? date('Y-m-d');
        $usuario = $body['usuario'] ?? '';
        $gestores = ['1041','1566','1280','1015','1099','1342','1188','1015'];
        $devices  = ['CALLCENTER029','CALLCENTER012','CALLCENTER007','CALLCENTER033'];
        $hoy = date('Y-m-d');
        $logins = [];
        foreach ($gestores as $idx => $g) {
            if ($usuario && $g !== $usuario) continue;
            $st = seed($g . $fecha . $idx);
            $h  = ri($st, 8, 10); $m = ri($st, 0, 59);
            $entrada = sprintf('%s %02d:%02d:00', $fecha, $h, $m);
            // En el día de hoy, algunos siguen "en línea" (salida 2000-01-01 = activo)
            $activo = ($fecha === $hoy) && (rng($st) > 0.5);
            if ($activo) {
                $salida = '2000-01-01 00:00:00';
                $durMin = 0;
            } else {
                $durMin = ri($st, 180, 540);
                $salida = date('Y-m-d H:i:s', strtotime($entrada) + $durMin * 60);
            }
            $logins[] = [
                'usuario'     => $g,
                'entrada'     => $entrada,
                'salida'      => $salida,
                'tipo'        => 'Login',
                'dispositivo' => $devices[ri($st, 0, count($devices) - 1)],
                'duracionMin' => $durMin,
            ];
        }
        respond(['logins' => $logins]);
    }

    default:
        respond(['error' => 'Accion desconocida (mock): ' . htmlspecialchars($action)]);
}

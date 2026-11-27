<?php
/**
 * DASA — C&C v2 · api/buscar.php
 * ───────────────────────────────────────────────────────────────────────────
 * Búsqueda unificada con filtros combinables (AND) + paginado. PLAN-V2.md § 3.2.
 *
 * Diseño (documentado acá porque no es trivial — probado y corregido contra Neotel real,
 * ver REPORTE final por los detalles):
 *   - clientes/crms/fechas acotan las CARTERAS y el RANGO.
 *   - Dos grupos de filtros, combinados entre sí con AND:
 *     1) IDENTIFICACIÓN — "qué llamada/persona busco": idLlamada, telefono, dni (campo suelto
 *        o masivo) y los números del `numeros` masivo clasificados por largo (reusa buscar_numero).
 *        Entre ELLOS se combinan con OR ("busco cualquiera de estos números/personas") — probado
 *        con VPN real: un masivo mixto (ej. un ID de una llamada + el DNI de OTRA persona) con AND
 *        estricto entre tipos devolvía 0 resultados para el ID, porque exigía que la MISMA fila
 *        fuera ambas cosas a la vez. dni se resuelve en el CRM (una consulta por cartera, todo el
 *        rango — optimizado antes: 143 s → 5 s).
 *     2) ACOTAMIENTO — "qué tipo de llamada": tipifs y deudor, resueltos en el CRM (misma
 *        consulta por cartera, con tipifs/deudor combinados con AND entre sí ahí adentro).
 *   - sinGrabacion/explicaciones: solo cuando se buscó por ID o DNI (no en listados por
 *     cartera/tipif/deudor), igual que buscar_numero/buscar_audio de neotel_sql.php.
 */

require_once __DIR__ . '/_lib.php';
require_once __DIR__ . '/_buscar_helpers.php';

$t0 = microtime(true);
$avisos = [];
$explicaciones = [];

// ── 1. Fechas ────────────────────────────────────────────────────────────────
$desde = (string) ($body['desde'] ?? '');
$hasta = (string) ($body['hasta'] ?? '');
if (!fechaValida($desde) || !fechaValida($hasta)) respond(['error' => 'Fecha inválida (YYYY-MM-DD).'], 400);
if (strtotime($hasta) < strtotime($desde)) { $tmp = $desde; $desde = $hasta; $hasta = $tmp; }
$dias = (strtotime($hasta) - strtotime($desde)) / 86400;
if ($dias > 45) respond(['error' => 'El rango no puede superar los 45 días.'], 400);
$hastaExcl = date('Y-m-d', strtotime($hasta . ' +1 day'));

// ── 2. Paginado ──────────────────────────────────────────────────────────────
$pagina    = clampInt($body['pagina'] ?? 1, 1, 100000, 1);
$porPagina = clampInt($body['porPagina'] ?? 200, 1, 500, 200);

// ── 3. Carteras (crms explícitos, o los de los clientes pedidos, o todas) ────
$conocidas = carterasConocidas();
$crms = [];
if (!empty($body['crms']) && is_array($body['crms'])) {
    foreach ($body['crms'] as $c) { $c = (int) $c; if (in_array($c, $conocidas, true)) $crms[] = $c; }
}
$filtroCarteraExplicito = (!empty($body['crms']) && is_array($body['crms'])) || (!empty($body['clientes']) && is_array($body['clientes']));
if (!$crms && !empty($body['clientes']) && is_array($body['clientes'])) {
    $mapa = mapaClientes();
    foreach ($body['clientes'] as $cli) {
        $cli = trim((string) $cli);
        if ($cli === '') continue;
        if (!array_key_exists($cli, $mapa)) { $avisos[] = "Cliente '" . $cli . "' no reconocido."; continue; }
        if (!$mapa[$cli]) { $avisos[] = 'El cliente ' . $cli . ' todavía no tiene carteras cargadas: pedilo por CRM o esperá a que se confirme.'; continue; }
        foreach ($mapa[$cli] as $c) $crms[] = (int) $c['crm'];
    }
}
$crms = array_values(array_unique($crms));
if (!$crms) {
    if ($filtroCarteraExplicito) {
        // Se pidió cliente/cartera explícito y ninguno resolvió: NO buscar en todas (sería
        // incorrecto), devolver vacío con el aviso ya cargado arriba.
        respond(['ok' => true, 'total' => 0, 'topeAlcanzado' => false, 'pagina' => $pagina, 'porPagina' => $porPagina,
            'hayMas' => false, 'ms' => (int) round((microtime(true) - $t0) * 1000), 'filas' => [],
            'avisos' => $avisos ?: ['No se encontró ninguna cartera válida para buscar.'], 'explicaciones' => (object) []]);
    }
    $crms = $conocidas;   // sin filtro de cartera → todas las conocidas
}

// ── 4. Filtros CRM (tipifs, deudor) + campo dni suelto ───────────────────────
$tipifsReq = [];
if (!empty($body['tipifs']) && is_array($body['tipifs'])) {
    foreach ($body['tipifs'] as $t) { $t = trim((string) $t); if ($t !== '') $tipifsReq[] = $t; }
}
$deudorReq = trim((string) ($body['deudor'] ?? ''));
if ($deudorReq !== '' && mb_strlen($deudorReq) < 3) respond(['error' => 'El nombre del deudor debe tener al menos 3 letras.'], 400);

// ── 5. Números: idLlamada/dni/telefono sueltos + numeros[] masivo, todos por la
//      MISMA clasificación por largo (reusa la lógica de buscar_numero). Los campos
//      sueltos van directo a su bolsa (no dependen del largo: el nombre del campo ya dice
//      qué es); el masivo se clasifica por largo como siempre.
$idLlamadaRaw = soloDigitos($body['idLlamada'] ?? '');
if (($body['idLlamada'] ?? '') !== '' && $idLlamadaRaw === '') respond(['error' => 'idLlamada inválido: solo dígitos.'], 400);
$dniRaw = soloDigitos($body['dni'] ?? '');
if (($body['dni'] ?? '') !== '' && ($dniRaw === '' || strlen($dniRaw) < 6)) respond(['error' => 'El DNI debe tener al menos 6 dígitos.'], 400);
$telRaw = soloDigitos($body['telefono'] ?? '');
if (($body['telefono'] ?? '') !== '' && ($telRaw === '' || strlen($telRaw) < 8)) respond(['error' => 'El teléfono debe tener al menos 8 dígitos.'], 400);

$numerosRaw = $body['numeros'] ?? [];
if (!is_array($numerosRaw)) $numerosRaw = preg_split('/[\s,;]+/', (string) $numerosRaw) ?: [];
if (count($numerosRaw) > 300) respond(['error' => 'Demasiados números (máximo 300).'], 400);

$clasif = v2ClasificarNumeros($numerosRaw);
$idsExactos      = array_values(array_unique(array_filter(array_merge($idLlamadaRaw !== '' ? [$idLlamadaRaw] : [], $clasif['ids']))));
$dnisBuscar      = array_values(array_unique(array_filter(array_merge($dniRaw !== '' ? [$dniRaw] : [], $clasif['dnis']))));
$telefonosBuscar = array_values(array_unique(array_filter(array_merge($telRaw !== '' ? [$telRaw] : [], $clasif['telefonos']))));
$operadores      = $clasif['operadores'];
$notasLargo      = $clasif['notas'];

$necesitaAnd = (bool) ($tipifsReq || $deudorReq !== '');                                  // grupo ACOTAMIENTO
$tieneOr     = (bool) ($idsExactos || $telefonosBuscar || $operadores || $dnisBuscar);     // grupo IDENTIFICACIÓN
$puedeExplicar = (bool) ($idsExactos || $dnisBuscar);   // sinGrabacion/explicaciones: solo ID o DNI

// ── 6. Conexión ──────────────────────────────────────────────────────────────
try {
    $db = getDB();
} catch (Throwable $e) {
    error_log('[v2/buscar] conexion: ' . $e->getMessage());
    respond(['error' => 'Sin conexión a Neotel. Revisá la VPN / conexión con el servidor telefónico.'], 503);
}

try {
    $tablas = tablasEnRango($db, $desde, $hasta);
} catch (Throwable $e) {
    error_log('[v2/buscar] tablas: ' . $e->getMessage());
    error_log('[v2/buscar] tablas: ' . $e->getMessage()); respond(['error' => 'No se pudieron listar las tablas de Neotel.'], 500);
}

// ── 7a. ACOTAMIENTO — tipifs/deudor. UNA consulta por cartera, todo el rango. Combina tipifs
// (SQL IN, nombres exactos del catálogo) y deudor (LIKE) con AND entre sí (v2BuildCrmPrefiltroSql).
$idsAndPorTabla = [];   // tabla TKyyyymmdd => set de idLlamada
$gestionesAnd   = [];   // lista de ['idLlamada','tipif','fecha'] — para precargar el tipif que matcheó (ver 7c)
$tipifsNorm     = array_map('normTip', $tipifsReq);
$CAMPOS         = crmCamposMap();

if ($necesitaAnd) {
    foreach ($crms as $crm) {
        $campos = $CAMPOS[$crm] ?? ['titular' => null, 'cuenta' => null, 'label' => ''];
        if ($deudorReq !== '' && !$campos['titular']) {
            $info = crmNombre($crm);
            $avisos[] = 'La cartera ' . ($info['cartera'] ?: $crm) . ' no tiene nombre de deudor cargado: buscá por DNI.';
            continue;
        }
        $ecrm = nombreEcrm($crm);
        $q = v2BuildCrmPrefiltroSql($ecrm, [], $tipifsReq, $campos['titular'], $deudorReq, $desde, $hastaExcl);
        if ($q === null) continue;
        try {
            $rows = consultar($db, $q['sql'], $q['params']);
        } catch (Throwable $e) {
            $info = crmNombre($crm);
            $avisos[] = 'No se pudo leer el CRM de ' . ($info['cartera'] ?: $crm) . '.';
            continue;
        }
        foreach ($rows as $r) {
            $tip = trim((string) ($r['tipif'] ?? ''));
            if (esIntentoDiscador($tip)) continue;   // intento del discador: no es gestión
            if ($tipifsReq && !in_array(normTip($tip), $tipifsNorm, true)) continue;   // tolera encoding, pero confirma el match

            $idl = (int) ($r['idLlamada'] ?? 0);
            $fecha = (string) ($r['fecha'] ?? '');
            $gestionesAnd[] = ['idLlamada' => $idl, 'tipif' => $tip, 'fecha' => $fecha];
            if ($idl > 0 && $fecha !== '') {
                $tk = tablaTK($fecha);
                if (in_array($tk, $tablas, true)) $idsAndPorTabla[$tk][$idl] = true;
            }
        }
    }
    foreach ($idsAndPorTabla as $tk => $set) $idsAndPorTabla[$tk] = array_keys($set);
}

// ── 7b. IDENTIFICACIÓN — dni (campo suelto o masivo). UNA consulta por cartera, todo el rango.
// Separado del prefiltro de arriba a propósito (ver cabecera del archivo): dni se OR-ea con
// idLlamada/telefono/operador, NO se AND-ea con ellos.
$idsDniPorTabla = [];
$gestionesDni   = [];   // lista de ['idLlamada','tipif','dni','crm','fecha','dnMatch'] — para explicaciones

if ($dnisBuscar) {
    foreach ($crms as $crm) {
        $ecrm = nombreEcrm($crm);
        $q = v2BuildCrmPrefiltroSql($ecrm, $dnisBuscar, [], null, '', $desde, $hastaExcl);
        if ($q === null) continue;
        try {
            $rows = consultar($db, $q['sql'], $q['params']);
        } catch (Throwable $e) {
            $info = crmNombre($crm);
            $avisos[] = 'No se pudo leer el CRM de ' . ($info['cartera'] ?: $crm) . '.';
            continue;
        }
        foreach ($rows as $r) {
            $tip = trim((string) ($r['tipif'] ?? ''));
            if (esIntentoDiscador($tip)) continue;

            $idl = (int) ($r['idLlamada'] ?? 0);
            $fecha = (string) ($r['fecha'] ?? '');
            $dig = soloDigitos($r['docu'] ?? '');
            if (strlen($dig) === 11) $dig = substr($dig, 2, 8);   // CUIT → DNI

            $dnMatch = null;
            foreach ($dnisBuscar as $dn) { if (strpos($dig, $dn) !== false) { $dnMatch = $dn; break; } }
            if ($dnMatch === null) continue;   // no matcheó ninguno de los dni pedidos (LIKE trajo de más)

            $gestionesDni[] = ['idLlamada' => $idl, 'tipif' => $tip, 'dni' => $dig, 'crm' => $crm, 'fecha' => $fecha, 'dnMatch' => $dnMatch];
            if ($idl > 0 && $fecha !== '') {
                $tk = tablaTK($fecha);
                if (in_array($tk, $tablas, true)) $idsDniPorTabla[$tk][$idl] = true;
            }
        }
    }
    foreach ($idsDniPorTabla as $tk => $set) $idsDniPorTabla[$tk] = array_keys($set);
}

// ── 7c. Precargar el tipif que efectivamente matcheó el filtro, ANTES de enriquecer ─────────
// DESVÍO encontrado probando con VPN real: una llamada puede tener VARIAS gestiones a lo largo
// del tiempo (se re-tipifica). El prefiltro de 7a ya garantiza que la fila matcheó tipifsReq en
// ALGUNA gestión, pero enriquecerCRM() (paso 11) trae la tipificación MÁS RECIENTE — que puede
// ser OTRA. Sin esto, una búsqueda por tipif="Categorización por Timeout" podía devolver filas
// mostrando otro tipif distinto (el de la última gestión), confundiendo al usuario.
$tipifQueMatcheo = [];
if ($tipifsReq) {
    foreach ($gestionesAnd as $g) { if ($g['idLlamada'] > 0) $tipifQueMatcheo[(string) $g['idLlamada']] = $g['tipif']; }
}

// Si el grupo ACOTAMIENTO era necesario y no dio NINGÚN id, el resultado final es vacío (AND):
// no hace falta ni consultar TK.
$sinResultadosPorAnd = $necesitaAnd && !$idsAndPorTabla;

// ── 8. Búsqueda en TK (Neotel) — tabla por tabla, de la más reciente a la más vieja, cortando
// apenas se junta el tope de 5000 (ver comentario en v2BuildTkTableSql: es correcto porque cada
// tabla es un día exacto, así que ninguna tabla más vieja puede ganarle en fecha a lo ya juntado).
// Medido con VPN real: evita el ~28 s que salía con un único UNION ALL + ORDER BY global.
$filasAll = [];
$corteAnticipado = false;
if (!$sinResultadosPorAnd && $tablas) {
    foreach (array_reverse($tablas) as $tk) {
        if (count($filasAll) >= 5000) { $corteAnticipado = true; break; }
        $idsAndAca = $necesitaAnd ? ($idsAndPorTabla[$tk] ?? []) : [];
        if ($necesitaAnd && !$idsAndAca) continue;
        $idsDniAca = $dnisBuscar ? ($idsDniPorTabla[$tk] ?? []) : [];
        $sql = v2BuildTkTableSql($tk, $crms, $idsAndAca, $necesitaAnd, $idsExactos, $telefonosBuscar, $operadores, $idsDniAca, $tieneOr, false);
        if ($sql === '') continue;
        try {
            $rowsTabla = consultar($db, $sql);
        } catch (Throwable $e) {
            error_log('[v2/buscar] tk (' . $tk . '): ' . $e->getMessage());
            continue;   // esa tabla falló (ej. no existe realmente pese a figurar en sys.tables): se saltea, no aborta toda la búsqueda
        }
        foreach ($rowsTabla as $rw) $filasAll[] = $rw;
    }
}

// ── 9. sinGrabacion / explicaciones — SOLO si se buscó por ID o DNI ──────────
if ($puedeExplicar) {
    $idsEncontrados = [];
    foreach ($filasAll as $r) $idsEncontrados[(string) $r['idLlamada']] = true;

    // (a) IDs exactos que no aparecieron
    $idsFaltan = array_values(array_diff($idsExactos, array_keys($idsEncontrados)));
    if ($idsFaltan) {
        try {
            $sqlSinGrab = v2BuildTkUnionSql($tablas, $crms, [], $idsFaltan, [], [], false, true);
            $rowsSG = $sqlSinGrab !== '' ? consultar($db, $sqlSinGrab) : [];
        } catch (Throwable $e) { $rowsSG = []; }
        $vistos = [];
        foreach ($rowsSG as $r) {
            $idl = (string) $r['idLlamada'];
            $vistos[$idl] = true;
            $r['sinGrabacion'] = true; $r['tipif'] = ''; $r['dni'] = ''; $r['titular'] = ''; $r['cuenta'] = ''; $r['cuentaLabel'] = '';
            $filasAll[] = $r;
        }
        foreach ($idsFaltan as $id) {
            $explicaciones[$id] = isset($vistos[$id])
                ? 'La llamada existe pero Neotel no guardó grabación.'
                : ('No hay ninguna llamada con ese ID entre ' . $desde . ' y ' . $hasta . '.');
        }
    }

    // (b) DNIs que no aparecieron — se apoya en lo que YA trajo el prefiltro CRM (sin re-consultar).
    // Un dni se considera "encontrado" si ALGUNA de sus gestiones ya tiene fila con grabación en
    // $filasAll (igual criterio que buscar_numero: no importa cuántas gestiones tenga, con una que
    // haya salido con audio alcanza para no mostrar explicación).
    if ($dnisBuscar) {
        $idsConGrabacion = [];
        foreach ($filasAll as $r) if (!empty($r['grabacion'])) $idsConGrabacion[(string) $r['idLlamada']] = true;

        $dniFound = [];
        foreach ($gestionesDni as $g) {
            if ($g['dnMatch'] !== null && $g['idLlamada'] > 0 && isset($idsConGrabacion[(string) $g['idLlamada']])) {
                $dniFound[$g['dnMatch']] = true;
            }
        }

        $tallySinGrab = []; $tallySolo = []; $yaAgregado = [];
        foreach ($gestionesDni as $g) {
            $dn = $g['dnMatch'];
            if ($dn === null || !empty($dniFound[$dn])) continue;   // ese dni ya salió con grabación: no hace falta explicar
            $clave = $g['idLlamada'] . '|' . $g['fecha'] . '|' . $g['tipif'];
            if (isset($yaAgregado[$clave])) continue;
            $yaAgregado[$clave] = true;
            if ($g['idLlamada'] > 0) {
                $tallySinGrab[$dn] = ($tallySinGrab[$dn] ?? 0) + 1;
                $filasAll[] = ['idLlamada' => (string) $g['idLlamada'], 'idContacto' => '', 'usuario' => '', 'grabacion' => '',
                    'inicio' => $g['fecha'] . ' 00:00:00', 'estado' => '', 'crm' => $g['crm'], 'durSeg' => 0, 'direccion' => '',
                    'tipif' => $g['tipif'], 'dni' => $g['dni'], 'titular' => '', 'cuenta' => '', 'cuentaLabel' => '',
                    'sinGrabacion' => true, 'fecha' => $g['fecha']];
            } else {
                $tallySolo[$dn] = ($tallySolo[$dn] ?? 0) + 1;
                $filasAll[] = ['idLlamada' => '0', 'idContacto' => '', 'usuario' => '', 'grabacion' => '', 'inicio' => $g['fecha'] . ' 00:00:00',
                    'estado' => '', 'crm' => $g['crm'], 'durSeg' => 0, 'direccion' => '', 'tipif' => $g['tipif'], 'dni' => $g['dni'],
                    'titular' => '', 'cuenta' => '', 'cuentaLabel' => '', 'soloGestion' => true, 'fecha' => $g['fecha']];
            }
        }
        foreach ($dnisBuscar as $dn) {
            if (!empty($dniFound[$dn])) continue;
            if (!empty($tallySinGrab[$dn]))      $explicaciones[$dn] = 'La llamada existe pero Neotel no guardó grabación.';
            elseif (!empty($tallySolo[$dn]))     $explicaciones[$dn] = 'Hay ' . $tallySolo[$dn] . ' gestión(es) en el CRM sin llamada grabada.';
            else                                 $explicaciones[$dn] = 'No hay llamadas ni gestiones con ese DNI entre ' . $desde . ' y ' . $hasta . '.';
        }
    }
}

// Números del masivo con largo inválido → explicación directa (no se buscaron)
foreach ($notasLargo as $n => $txt) $explicaciones[$n] = $txt;

// ── 10. Orden, tope, paginado ────────────────────────────────────────────────
usort($filasAll, function ($a, $b) { return strcmp((string) $b['inicio'], (string) $a['inicio']); });
if (count($filasAll) > 5000) { $filasAll = array_slice($filasAll, 0, 5000); $corteAnticipado = true; }
$total = count($filasAll);
$topeAlcanzado = $corteAnticipado;
if ($topeAlcanzado) $avisos[] = 'Se alcanzó el tope de 5000 llamadas: hay más resultados de los que se muestran. Achicá el rango o agregá filtros.';

// ── 10b. Conteos para el panel de filtros (sobre TODO el resultado, antes de paginar) ─────────
// clientes: sale del crm de cada fila. tipifs: la ÚLTIMA gestión de cada llamada (así los conteos
// suman el total). Si ya se filtró por tipificación se usa lo que matcheó; si no, una consulta por
// cartera con presupuesto de ~5 s: si se pasa, tipifs = null y se avisa.
$conteos = ['clientes' => [], 'tipifs' => []];
$idsPorCrm = [];
foreach ($filasAll as $r) {
    $cn = crmNombre((int) ($r['crm'] ?? 0));
    $cli = $cn['cliente'] !== '' ? $cn['cliente'] : 'Sin cliente';
    $conteos['clientes'][$cli] = ($conteos['clientes'][$cli] ?? 0) + 1;
    $idl = (int) ($r['idLlamada'] ?? 0);
    if ($idl > 0) $idsPorCrm[(int) ($r['crm'] ?? 0)][$idl] = true;
}
if ($tipifQueMatcheo) {
    foreach ($filasAll as $r) {
        $id = (string) ($r['idLlamada'] ?? '');
        $t = $tipifQueMatcheo[$id] ?? '';
        $k = $t !== '' ? $t : 'Sin tipificación';
        $conteos['tipifs'][$k] = ($conteos['tipifs'][$k] ?? 0) + 1;
    }
} elseif ($filasAll) {
    $tCont = microtime(true); $ultima = []; $excedido = false;
    $hastaExclC = date('Y-m-d', strtotime($hasta . ' +1 day'));
    foreach ($idsPorCrm as $c => $set) {
        if (!in_array($c, $crms, true)) continue;
        $ecrm = nombreEcrm($c);
        foreach (array_chunk(array_keys($set), 500) as $tanda) {
            if (microtime(true) - $tCont > 5) { $excedido = true; break 2; }
            try {
                $rowsC = consultar($db, "SELECT d.IDLLAMADA AS idLlamada, s.DESCRIPCION AS tipif
                    FROM [$ecrm].[dbo].[CONTACTOS_DETALLE] d
                    LEFT JOIN [$ecrm].[dbo].[SUBCATEGORIAS] s ON s.SUBCATEGORIA = d.SUBCATEGORIA
                    WHERE d.FECHA >= ? AND d.FECHA < ? AND d.IDLLAMADA IN (" . implode(',', array_map('intval', $tanda)) . ")
                    ORDER BY d.TS", [$desde, $hastaExclC]);
            } catch (Throwable $e) { continue; }
            foreach ($rowsC as $rc) { $t = trim((string) ($rc['tipif'] ?? '')); if ($t !== '') $ultima[(string) $rc['idLlamada']] = $t; }   // ORDER BY TS → gana la última
        }
    }
    if ($excedido) {
        $conteos['tipifs'] = null;
        $avisos[] = 'Conteo por tipificación no disponible para esta búsqueda (demasiadas llamadas). Achicá el rango o elegí un cliente.';
    } else {
        foreach ($filasAll as $r) {
            $k = $ultima[(string) ($r['idLlamada'] ?? '')] ?? 'Sin tipificación';
            $conteos['tipifs'][$k] = ($conteos['tipifs'][$k] ?? 0) + 1;
        }
    }
}
if (is_array($conteos['tipifs'])) arsort($conteos['tipifs']);
arsort($conteos['clientes']);
if (!$filtroCarteraExplicito && !empty($dnisBuscar)) $avisos[] = 'Buscaste un DNI en todas las carteras: elegí el cliente para que la búsqueda sea más rápida.';

list($pageRows, $hayMas) = v2Paginar($filasAll, $pagina, $porPagina);

// ── 11. Enriquecimiento CRM — SOLO la página pedida ──────────────────────────
if ($tipifQueMatcheo) {
    foreach ($pageRows as $k => $r) {
        $id = (string) ($r['idLlamada'] ?? '');
        if ($id !== '' && $id !== '0' && isset($tipifQueMatcheo[$id])) $pageRows[$k]['tipif'] = $tipifQueMatcheo[$id];
    }
}
enriquecerCRM($db, $pageRows, $crms, $desde, $hasta);

// ── 12. Armado final de filas (contrato § 3.2) ───────────────────────────────
$filas = [];
foreach ($pageRows as $r) {
    $inicio = (string) ($r['inicio'] ?? '');
    $fecha = $r['fecha'] ?? ($inicio !== '' ? substr($inicio, 0, 10) : '');
    $hora  = $inicio !== '' ? substr($inicio, 11, 8) : '';
    $tel = '';
    if (preg_match('/^(\d+)-/', (string) ($r['grabacion'] ?? ''), $mm)) $tel = $mm[1];
    $crm = (int) ($r['crm'] ?? 0);
    $cn = crmNombre($crm);
    $dir = (string) ($r['direccion'] ?? '');
    $filas[] = [
        'idLlamada'   => (string) ($r['idLlamada'] ?? '0'),
        'grabacion'   => (string) ($r['grabacion'] ?? ''),
        'inicio'      => $inicio,
        'fecha'       => $fecha,
        'hora'        => $hora,
        'durSeg'      => (int) ($r['durSeg'] ?? 0),
        'estado'      => (string) ($r['estado'] ?? ''),
        'usuario'     => (string) ($r['usuario'] ?? ''),
        'crm'         => $crm,
        'cartera'     => $cn['cartera'],
        'cliente'     => $cn['cliente'],
        'tipif'       => (string) ($r['tipif'] ?? ''),
        'dni'         => (string) ($r['dni'] ?? ''),
        'titular'     => (string) ($r['titular'] ?? ''),
        'cuenta'      => (string) ($r['cuenta'] ?? ''),
        'cuentaLabel' => (string) ($r['cuentaLabel'] ?? ''),
        'telefono'    => $tel,
        'idContacto'  => (string) ($r['idContacto'] ?? ''),
        'tipoLlamada' => tipoLlamadaDe($dir)['tipoLlamada'],
        'sinGrabacion'=> !empty($r['sinGrabacion']),
    ];
}

respond([
    'ok' => true,
    'total' => $total,
    'topeAlcanzado' => $topeAlcanzado,
    'pagina' => $pagina,
    'porPagina' => $porPagina,
    'hayMas' => $hayMas,
    'ms' => (int) round((microtime(true) - $t0) * 1000),
    'filas' => $filas,
    'avisos' => $avisos,
    'explicaciones' => (object) $explicaciones,
    'conteos' => ['clientes' => (object) $conteos['clientes'], 'tipifs' => ($conteos['tipifs'] === null ? null : (object) $conteos['tipifs'])],
]);

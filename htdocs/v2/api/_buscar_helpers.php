<?php
/**
 * DASA — C&C v2 · api/_buscar_helpers.php
 * ───────────────────────────────────────────────────────────────────────────
 * Funciones PURAS (sin DB, sin config, sin side-effects) del armado de la
 * búsqueda unificada de buscar.php. Separadas a propósito para poder testear
 * el ENRUTAMIENTO y el SQL generado sin VPN (con un `php` suelto en CLI).
 *
 * No requiere _lib.php ni config.php — standalone. Solo define funciones (nunca
 * consulta nada ni imprime nada por sí solo), pero si alguien lo pide DIRECTO por
 * URL (Apache/php -S sirviendo htdocs/v2/api/_buscar_helpers.php) cortamos con 403
 * en vez de dejar que devuelva una respuesta vacía silenciosa.
 */
if (realpath(__FILE__) === realpath($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo '{"error":"No autorizado"}';
    exit;
}

// Enruta números mixtos (masivo + campos sueltos dni/telefono/idLlamada) por LARGO,
// igual que buscar_numero de neotel_sql.php (probado): 9 díg = ID de llamada · 7-8 = DNI ·
// 10-13 = teléfono · 4-6 = operador/contacto. Devuelve sets (sin duplicados, orden estable).
function v2ClasificarNumeros(array $numeros): array {
    $ids = []; $dnis = []; $telefonos = []; $operadores = []; $notas = [];
    foreach ($numeros as $x) {
        $x = preg_replace('/\D/', '', (string) $x);
        if ($x === '') continue;
        $L = strlen($x);
        if ($L === 9)                 $ids[$x] = true;
        elseif ($L >= 10 && $L <= 13) $telefonos[$x] = true;
        elseif ($L >= 7 && $L <= 8)   $dnis[$x] = true;
        elseif ($L >= 4 && $L <= 6)   $operadores[$x] = true;
        else                          $notas[$x] = 'largo inválido (' . $L . ' díg.): no es ID de llamada (9), DNI (7-8), teléfono (10-13) ni operador/contacto (4-6)';
    }
    return [
        'ids'        => array_keys($ids),
        'dnis'       => array_keys($dnis),
        'telefonos'  => array_keys($telefonos),
        'operadores' => array_keys($operadores),
        'notas'      => $notas,
    ];
}

// Arma el SQL del "prefiltro CRM" (una cartera, todo el rango) que resuelve dni/tipifs/deudor
// a un set de IDLLAMADA. Combina TODOS los filtros activos con AND en la MISMA consulta (así
// "DNI 12345678 y tipificación Promesa de pago" se resuelve en una sola vuelta a la base, y
// además es más rápido que traer todo y filtrar en PHP). PLAN-V2.md § 3.2.
//   $titularCol = null si esa cartera no tiene columna de titular (crmCamposMap()['titular']).
// Devuelve null si deudor fue pedido y la cartera no tiene titular (el caller debe avisar y
// no consultar esa cartera). Si no hay NINGÚN filtro CRM activo, igual arma la consulta (sin
// más condición que el rango de fechas) — el caller decide si hace falta llamarla.
function v2BuildCrmPrefiltroSql(string $ecrm, array $dnisBuscar, array $tipifsReq, ?string $titularCol, string $deudorReq, string $desde, string $hastaExcl): ?array {
    if ($deudorReq !== '' && !$titularCol) return null;   // cartera sin titular: no se puede buscar por deudor ahí

    $selTit = $titularCol ? ('c.' . $titularCol) : "''";
    $sql = "SELECT d.IDLLAMADA AS idLlamada, CONVERT(varchar(10), d.FECHA, 120) AS fecha, s.DESCRIPCION AS tipif, c.TXTCUITCUIL AS docu, $selTit AS titular
        FROM [$ecrm].[dbo].[CONTACTOS_DETALLE] d
        JOIN [$ecrm].[dbo].[CONTACTOS] c ON c.IDINTERNO = d.IDINTERNO
        LEFT JOIN [$ecrm].[dbo].[SUBCATEGORIAS] s ON s.SUBCATEGORIA = d.SUBCATEGORIA
        WHERE d.FECHA >= ? AND d.FECHA < ?";
    $params = [$desde, $hastaExcl];

    if ($dnisBuscar) {
        $ors = [];
        foreach ($dnisBuscar as $dn) { $ors[] = 'c.TXTCUITCUIL LIKE ?'; $params[] = '%' . $dn . '%'; }
        $sql .= ' AND (' . implode(' OR ', $ors) . ')';
    }
    if ($tipifsReq) {
        $ph = implode(',', array_fill(0, count($tipifsReq), '?'));
        $sql .= " AND s.DESCRIPCION IN ($ph)";
        foreach ($tipifsReq as $t) $params[] = $t;
    }
    if ($deudorReq !== '') {
        $sql .= " AND $selTit LIKE ?";
        $params[] = '%' . $deudorReq . '%';
    }
    return ['sql' => $sql, 'params' => $params];
}

// Arma el SELECT de UNA sola tabla TKyyyymmdd. Dos grupos de filtros TK-level, combinados entre
// sí con AND, pero con semántica DISTINTA adentro de cada uno (bug real encontrado probando con
// VPN — ver REPORTE):
//   - "ACOTAMIENTO" (tipifs/deudor, resueltos antes a un set de IDLLAMADA por cartera): entre
//     ellos ya vinieron combinados con AND en la consulta CRM (v2BuildCrmPrefiltroSql). Acá es
//     UNA sola condición: IDLLAMADA IN ($idsAndTabla).
//   - "IDENTIFICACIÓN" (idLlamada exacto, teléfono, operador/contacto, dni resuelto por CRM): se
//     combinan entre sí con OR ("busco CUALQUIERA de estos números/personas"), igual que
//     buscar_numero de neotel_sql.php. ANTES estaban con AND entre sí, y una búsqueda masiva que
//     mezclaba, por ej., un ID de llamada y un DNI de OTRA llamada exigía que la MISMA fila fuera
//     ambas cosas a la vez → 0 resultados para el ID (probado: caso "masivo mixto" del enunciado).
// $necesitaAnd=true sin $idsAndTabla → tabla no aporta nada (return ''). $tieneOr=true pero
// ningún miembro del OR aporta nada en ESTA tabla → tampoco aporta nada (return '').
function v2BuildTkTableSql(string $tabla, array $crms, array $idsAndTabla, bool $necesitaAnd, array $idsExactos, array $telefonosBuscar, array $operadores, array $idsDniTabla, bool $tieneOr, bool $sinGrabacion = false): string {
    if ($necesitaAnd && !$idsAndTabla) return '';

    $sel = "SELECT CAST(IDLLAMADA AS varchar) AS idLlamada, ISNULL(IDCONTACTO,0) AS idContacto, USUARIO AS usuario,
        ISNULL(GRABACION,'') AS grabacion, CONVERT(varchar(19), INICIO, 120) AS inicio, ESTADO AS estado,
        ISNULL(CRM,0) AS crm, ISNULL(DIRECCION,'') AS direccion,
        CASE WHEN ESTADO='ANSWER' AND CONEXION > '2001-01-01' THEN DATEDIFF(second, CONEXION, FIN) ELSE 0 END AS durSeg";
    $crmIn = implode(',', array_map('intval', $crms));
    $condGrab = $sinGrabacion ? '1=1' : "(GRABACION IS NOT NULL AND GRABACION <> '' AND GRABACION <> 'NULL')";

    $cond = ["CRM IN ($crmIn)", $condGrab];
    if ($necesitaAnd) $cond[] = 'IDLLAMADA IN (' . implode(',', array_map('intval', $idsAndTabla)) . ')';

    if ($tieneOr) {
        $ors = [];
        if ($idsExactos) $ors[] = 'IDLLAMADA IN (' . implode(',', array_map('intval', $idsExactos)) . ')';
        if ($telefonosBuscar) foreach ($telefonosBuscar as $t) $ors[] = "GRABACION LIKE '" . preg_replace('/\D/', '', (string) $t) . "%'";
        if ($operadores) { $in = implode(',', array_map('intval', $operadores)); $ors[] = "(USUARIO IN ($in) OR IDCONTACTO IN ($in))"; }
        if ($idsDniTabla) $ors[] = 'IDLLAMADA IN (' . implode(',', array_map('intval', $idsDniTabla)) . ')';
        if (!$ors) return '';   // se pidió identificación pero ningún tipo aporta nada en esta tabla
        $cond[] = '(' . implode(' OR ', $ors) . ')';
    }
    return "$sel FROM [TEL_LOGS].[dbo].[$tabla] WHERE " . implode(' AND ', $cond);
}

// Arma el UNION ALL sobre VARIAS tablas — se usa SOLO para la 2ª pasada (sinGrabacion /
// explicaciones), que ya viene acotada a un puñado de IDs puntuales (no un listado completo), así
// que el costo de un único UNION + ORDER BY ahí es insignificante (ver v2BuildTkTableSql arriba
// para el listado general, que SÍ necesita ir tabla por tabla).
function v2BuildTkUnionSql(array $tablas, array $crms, array $idsCrmPorTabla, array $idsExactos, array $telefonosBuscar, array $operadores, bool $necesitaCrm, bool $sinGrabacion = false): string {
    $sel = "SELECT CAST(IDLLAMADA AS varchar) AS idLlamada, ISNULL(IDCONTACTO,0) AS idContacto, USUARIO AS usuario,
        ISNULL(GRABACION,'') AS grabacion, CONVERT(varchar(19), INICIO, 120) AS inicio, ESTADO AS estado,
        ISNULL(CRM,0) AS crm, ISNULL(DIRECCION,'') AS direccion,
        CASE WHEN ESTADO='ANSWER' AND CONEXION > '2001-01-01' THEN DATEDIFF(second, CONEXION, FIN) ELSE 0 END AS durSeg";
    $crmIn = implode(',', array_map('intval', $crms));
    $condGrab = $sinGrabacion ? '1=1' : "(GRABACION IS NOT NULL AND GRABACION <> '' AND GRABACION <> 'NULL')";

    $parts = [];
    foreach ($tablas as $tk) {
        $cond = ["CRM IN ($crmIn)", $condGrab];
        if ($necesitaCrm) {
            $idsAca = $idsCrmPorTabla[$tk] ?? [];
            if (!$idsAca) continue;   // el prefiltro CRM no dio ningún ID para esta tabla → no aporta filas
            $cond[] = 'IDLLAMADA IN (' . implode(',', array_map('intval', $idsAca)) . ')';
        }
        if ($idsExactos) {
            $cond[] = 'IDLLAMADA IN (' . implode(',', array_map('intval', $idsExactos)) . ')';
        }
        if ($telefonosBuscar) {
            $ors = [];
            foreach ($telefonosBuscar as $t) $ors[] = "GRABACION LIKE '" . preg_replace('/\D/', '', (string) $t) . "%'";
            $cond[] = '(' . implode(' OR ', $ors) . ')';
        }
        if ($operadores) {
            $in = implode(',', array_map('intval', $operadores));
            $cond[] = "(USUARIO IN ($in) OR IDCONTACTO IN ($in))";
        }
        $parts[] = "$sel FROM [TEL_LOGS].[dbo].[$tk] WHERE " . implode(' AND ', $cond);
    }
    if (!$parts) return '';
    return "SELECT TOP 5000 * FROM (\n" . implode("\nUNION ALL\n", $parts) . "\n) q ORDER BY inicio DESC";
}

// Paginado en PHP sobre el array ya ordenado (tope 5000 filas). Devuelve [pageRows, hayMas].
function v2Paginar(array $filas, int $pagina, int $porPagina): array {
    $offset = ($pagina - 1) * $porPagina;
    $page = array_slice($filas, $offset, $porPagina);
    $hayMas = ($offset + count($page)) < count($filas);
    return [$page, $hayMas];
}

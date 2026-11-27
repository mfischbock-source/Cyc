<?php
/**
 * DASA — C&C v2 · api/catalogo.php
 * Acciones: clientes (cliente→carteras) · tipificaciones (por crms+rango, para el filtro) ·
 * descubrir (bases ECRM_% del server, para completar el mapa — no la usa el front). PLAN-V2.md § 3.1.
 */

require_once __DIR__ . '/_lib.php';

$accion = (string) ($body['accion'] ?? '');

switch ($accion) {

    // {accion:"clientes"} → {ok, clientes:[{cliente, carteras:[{crm,nombre}]}]}
    case 'clientes': {
        $out = [];
        foreach (mapaClientes() as $cliente => $carteras) {
            $out[] = ['cliente' => $cliente, 'carteras' => $carteras];
        }
        respond(['ok' => true, 'clientes' => $out]);
    }

    // {accion:"tipificaciones", crms:[int], desde, hasta} → {ok, tipificaciones:[{tipif,cantidad}]}
    // Ordenadas por cantidad desc. Sin crms = todas las carteras conocidas.
    case 'tipificaciones': {
        $conocidas = carterasConocidas();
        $crmsIn = [];
        if (!empty($body['crms']) && is_array($body['crms'])) {
            foreach ($body['crms'] as $c) { $c = (int) $c; if (in_array($c, $conocidas, true)) $crmsIn[] = $c; }
            $crmsIn = array_values(array_unique($crmsIn));
        }
        if (!$crmsIn) $crmsIn = $conocidas;

        $desde = (string) ($body['desde'] ?? date('Y-m-01'));
        $hasta = (string) ($body['hasta'] ?? date('Y-m-d'));
        if (!fechaValida($desde) || !fechaValida($hasta)) respond(['error' => 'Fecha inválida (YYYY-MM-DD).'], 400);
        if (strtotime($hasta) < strtotime($desde)) { $tmp = $desde; $desde = $hasta; $hasta = $tmp; }
        $hastaExcl = date('Y-m-d', strtotime($hasta . ' +1 day'));

        try {
            $db = getDB();
        } catch (Throwable $e) {
            error_log('[v2/catalogo] conexion: ' . $e->getMessage());
            respond(['error' => 'Sin conexión a Neotel. Revisá la VPN / conexión con el servidor telefónico.'], 503);
        }

        $acum = []; // tipif => cantidad (sumado entre las carteras pedidas)
        $avisos = [];
        foreach ($crmsIn as $crm) {
            $ecrm = nombreEcrm($crm);
            try {
                $rows = consultar($db, "SELECT s.DESCRIPCION AS tipif, COUNT(*) AS cantidad
                    FROM [$ecrm].[dbo].[CONTACTOS_DETALLE] d
                    JOIN [$ecrm].[dbo].[SUBCATEGORIAS] s ON s.SUBCATEGORIA = d.SUBCATEGORIA
                    WHERE d.FECHA >= ? AND d.FECHA < ?
                    GROUP BY s.DESCRIPCION", [$desde, $hastaExcl]);
            } catch (Throwable $e) {
                $info = crmNombre($crm);
                $avisos[] = 'No se pudo leer el CRM de ' . ($info['cartera'] ?: ('cartera ' . $crm)) . '.';
                continue;
            }
            foreach ($rows as $r) {
                $t = trim((string) ($r['tipif'] ?? ''));
                if ($t === '') continue;
                $acum[$t] = ($acum[$t] ?? 0) + (int) $r['cantidad'];
            }
        }

        $out = [];
        foreach ($acum as $tipif => $cantidad) $out[] = ['tipif' => $tipif, 'cantidad' => $cantidad];
        usort($out, function ($a, $b) { return $b['cantidad'] <=> $a['cantidad']; });

        respond(['ok' => true, 'desde' => $desde, 'hasta' => $hasta, 'crms' => $crmsIn, 'tipificaciones' => $out, 'avisos' => $avisos]);
    }

    // {accion:"descubrir"} → bases ECRM_% del server (para completar el mapa; no la usa el front).
    case 'descubrir': {
        try {
            $db = getDB();
        } catch (Throwable $e) {
            error_log('[v2/catalogo] conexion: ' . $e->getMessage());
            respond(['error' => 'Sin conexión a Neotel. Revisá la VPN / conexión con el servidor telefónico.'], 503);
        }
        try {
            $rows = consultar($db, "SELECT name FROM sys.databases WHERE name LIKE 'ECRM[_]%' ORDER BY name");
        } catch (Throwable $e) {
            error_log('[v2/catalogo] descubrir: ' . $e->getMessage());
            respond(['error' => 'Error listando bases en Neotel.'], 500);
        }
        $bases = [];
        foreach ($rows as $r) $bases[] = (string) $r['name'];
        respond(['ok' => true, 'bases' => $bases]);
    }

    default:
        respond(['error' => 'Acción desconocida: ' . $accion], 400);
}

<?php
/**
 * DASA — C&C · Funciones comunes al backend de Neotel (neotel_sql.php, analizar_cron.php)
 * ───────────────────────────────────────────────────────────────────────────────────────
 * normTip() tiene que dar EXACTAMENTE el mismo resultado que la versión JS de index.html
 * (línea ~281): así una tipificación comparada en el front y en el cron matchea igual,
 * venga rota por encoding o no ("PAGÓ" y "PAG<EF><BF><BD>" → "PAG").
 */

// Normaliza una tipificación para comparar (JS gemela en index.html, NO reordenar los pasos):
// 1) borra todo byte fuera de [\x20-\x7E] (saca acentos Y bytes rotos de un encoding mezclado)
// 2) mayúsculas
// 3) colapsa todo lo no alfanumérico (espacios, puntuación) a un solo espacio
// 4) trim
function normTip($s) {
    $s = (string) ($s === null ? '' : $s);
    $s = preg_replace('/[^\x20-\x7E]/', '', $s);
    $s = strtoupper($s);
    $s = preg_replace('/[^A-Z0-9]+/', ' ', $s);
    return trim($s);
}

// Reglas de tipificación (configuracion/tipificaciones.reglas: {TIPIF: "analizar"|"descartar"}).
// reglaTipif() busca PRIMERO la regla exacta (mayúsculas + trim, como siempre) y, si no hay, la del
// texto normalizado con normTip(). Neotel devuelve algunas tipificaciones con los acentos rotos y la
// regla está bien escrita (o al revés): comparando solo el texto exacto se descartaban llamadas de PAGO.
// Exacta primero a propósito: "OCUPADO SE CORTA" (descartar) y "OCUPADO/SE CORTA" (analizar) normalizan
// igual. En el fallback, si dos reglas normalizan igual y una es "analizar", gana "analizar".
// Gemela JS: reglaDe() en index.html.
function indiceReglasTipif($reglas) {
    $exactas = []; $norm = [];
    foreach ((is_array($reglas) ? $reglas : []) as $k => $v) {
        $exactas[mb_strtoupper(trim((string) $k))] = (string) $v;
        $n = normTip($k);
        if ($n !== '' && (!isset($norm[$n]) || $v === 'analizar')) $norm[$n] = (string) $v;
    }
    return ['exactas' => $exactas, 'norm' => $norm];
}
function reglaTipif($indice, $tipif) {
    $k = mb_strtoupper(trim((string) $tipif));
    if ($k === '') return '';
    if (isset($indice['exactas'][$k])) return $indice['exactas'][$k];
    $n = normTip($tipif);
    return ($n !== '' && isset($indice['norm'][$n])) ? $indice['norm'][$n] : '';
}

// Clasifica el sentido de la llamada a partir de TK.DIRECCION. No hay VPN en esta máquina para
// ver los valores reales que devuelve Neotel, así que mapea por PREFIJO de texto (tolera
// "SALIENTE"/"S"/"OUT"/"O", "ENTRANTE"/"E"/"IN"/"I", may/minúsculas) y, si viene numérico,
// aplica una SUPOSICIÓN documentada que hay que confirmar con VPN (ver reporte final):
//   DIRECCION = '1' → Saliente (la mayoría de la gestión de cobranzas es marcador saliente)
//   DIRECCION = '0' → Entrante
//   cualquier otro número → no se traduce, se devuelve tal cual (crudo)
// Devuelve ['tipoLlamada' => 'Saliente'|'Entrante'|<crudo>, 'direccion' => <crudo original>].
function tipoLlamadaDe($direccion) {
    $raw = (string) ($direccion === null ? '' : $direccion);
    $d = trim($raw);
    if ($d === '') return ['tipoLlamada' => '', 'direccion' => $raw];

    if (preg_match('/^(o|out|s|sal)/i', $d)) return ['tipoLlamada' => 'Saliente', 'direccion' => $raw];
    if (preg_match('/^(i|in|e|ent)/i', $d))  return ['tipoLlamada' => 'Entrante', 'direccion' => $raw];

    if (preg_match('/^\d+$/', $d)) {
        // SUPOSICIÓN sin confirmar (no hay VPN acá) — ajustar cuando se vea un valor real de Neotel.
        if ($d === '1') return ['tipoLlamada' => 'Saliente', 'direccion' => $raw];
        if ($d === '0') return ['tipoLlamada' => 'Entrante', 'direccion' => $raw];
        return ['tipoLlamada' => $raw, 'direccion' => $raw];
    }
    // Valor no reconocido (crudo): se muestra tal cual en vez de esconderlo.
    return ['tipoLlamada' => $raw, 'direccion' => $raw];
}

// Sanitizador de encoding compartido. Neotel (TEL_LOGS) manda Windows-1252 SIEMPRE; las bases
// ECRM en cambio suelen venir ya en UTF-8 correcto pero a veces traen bytes sueltos rotos
// (import viejo, copy-paste, etc.). Por eso NO se asume un encoding fijo: si el string YA es
// UTF-8 válido se deja intacto (evita mojibake en acentos que ya estaban bien); si NO es UTF-8
// válido, se asume Windows-1252 (como TEL_LOGS) y se convierte. Antes, tipificaciones/subcategorias
// no pasaban por ningún sanitizador y esos bytes rotos salían como "�" (H5).
function sanitizarUtf8($data) {
    if (is_array($data)) {
        return array_map('sanitizarUtf8', $data);
    }
    if (is_string($data)) {
        if (mb_check_encoding($data, 'UTF-8')) return $data;
        return mb_convert_encoding($data, 'UTF-8', 'Windows-1252');
    }
    return $data;
}

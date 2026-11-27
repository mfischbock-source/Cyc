<?php
/**
 * DASA — C&C · aplicar_seguridad.php  (se corre UNA vez en el server, por línea de comandos)
 *
 *   php aplicar_seguridad.php C:\ruta\a\htdocs            → muestra qué va a cambiar (no escribe)
 *   php aplicar_seguridad.php C:\ruta\a\htdocs --aplicar  → hace backup y aplica
 *
 * Reemplaza SOLO el bloque de autenticación de cada endpoint (token fijo) por la sesión nueva
 * (cyc_auth.php). No pisa el resto del archivo: sirve aunque la versión del server sea más nueva
 * que la de git. Si algún archivo no tiene el bloque esperado, NO escribe nada y avisa.
 * Es idempotente: si un archivo ya tiene cyc_requerir(), lo saltea.
 */
if (php_sapi_name() !== 'cli') { http_response_code(403); exit("Solo por línea de comandos.\n"); }

$dir = rtrim($argv[1] ?? '', '\\/');
$aplicar = in_array('--aplicar', $argv, true);
if ($dir === '' || !is_file("$dir/config.php")) exit("Uso: php aplicar_seguridad.php <carpeta htdocs> [--aplicar]\n(no encontré config.php en '$dir')\n");
foreach (['cyc_auth.php', 'sesion.php', 'cyc_sesion.jsx'] as $nuevo) {
    if (!is_file("$dir/$nuevo")) exit("Falta $dir/$nuevo: copiá primero los archivos nuevos del zip.\n");
}

$TOKEN_BLOQUE = '\$(?:tokenRecibido|tok)\s*=\s*\$_SERVER\[\'HTTP_X_DASA_TOKEN\'\][^;]*;\s*'
              . 'if\s*\(\s*!defined\(\'NEOTEL_API_TOKEN\'\)[^{]*\{[^}]*\}';
$OPTIONS = '(if\s*\(\s*\$_SERVER\[\'REQUEST_METHOD\'\]\s*===\s*\'OPTIONS\'\s*\)\s*\{\s*http_response_code\(204\);\s*exit;\s*\})';

// Texto literal → regex que tolera diferencias de espacios/indentación.
function lit($s) { return '/' . preg_replace('/\\\\?\s+/', '\s+', preg_quote($s, '/')) . '/'; }

// Cada archivo: lista de [patrón, reemplazo] (cada patrón tiene que aparecer UNA vez) y una "marca"
// que indica que ya está aplicado (idempotente).
$MARCA_AUTH = 'cyc_requerir(';
$cambios = [
    // ── Arreglo del cron (20/11/2026): reglas de tipificación con acentos rotos → se descartaban pagos.
    'analizar_cron.php' => ['marca' => 'reglaTipif(', 'reemplazos' => [
        [lit('if (!is_array($REGLAS)) $REGLAS = [];'),
         "if (!is_array(\$REGLAS)) \$REGLAS = [];\n// Regla de una tipificación: exacta primero y, si no hay, por texto normalizado (acentos rotos de\n// Neotel). Antes se comparaba solo el texto exacto y se descartaban llamadas de PAGO (~220 entre el\n// 10 y el 20/11/2026). Ver reglaTipif() en lib_comun.php y tests/test_reglas_tipif.php.\nrequire_once __DIR__ . '/lib_comun.php';\n\$_indiceReglas = indiceReglasTipif(\$REGLAS);\n\$reglaDe = function (\$tipif) use (\$_indiceReglas) { return reglaTipif(\$_indiceReglas, \$tipif); };"],
        ['/\$tt = mb_strtoupper\(trim\(\(string\)\(\$f\[\'tipif\'\] \?\? \'\'\)\)\);\s*if \(\$tt === \'\' \|\| \(\$REGLAS\[\$tt\] \?\? \'\'\) !== \'analizar\'\) continue;[ \t]*/',
         "if (\$reglaDe((string)(\$f['tipif'] ?? '')) !== 'analizar') continue;   "],
        [lit('$tipDe, $REGLAS, $MODO,'), '$tipDe, $reglaDe, $MODO,'],
        ['/\$tt = mb_strtoupper\(trim\(\(string\)\(\$tp\[\'map\'\]\[\$idll\]\[\'tipif\'\] \?\? \'\'\)\)\);(\s*)if \(isset\(\$REGLAS\[\$tt\]\)\)\s*\$desc = \(\$REGLAS\[\$tt\] === \'descartar\'\);/',
         "\$regla = \$reglaDe((string)(\$tp['map'][\$idll]['tipif'] ?? ''));   // exacta, o normalizada si hay acentos rotos\$1if (\$regla !== '')             \$desc = (\$regla === 'descartar');"],
        ['/(\s*)\'crm\'\s*=>\s*\(int\)\(\$x\[\'crm\'\] \?\? 0\)\]\);/',
         "\$1'crm'   => (int)(\$x['crm'] ?? 0),\$1'durSeg' => (int)(\$x['duracionSeg'] ?? 0)]);   // para diagnosticar descartes \"sin tipificación\" largos"],
    ]],
    'neotel_sql.php'  => ["/$TOKEN_BLOQUE/","// (desde 11/2026: sesión de Firebase validada en el server o cron local — ver cyc_auth.php)\nrequire_once __DIR__ . '/cyc_auth.php';\ncyc_requerir('usuario');"],
    'v2/api/_lib.php' => ["/$TOKEN_BLOQUE/", "// (desde 11/2026: sesión de Firebase validada en el server — ver cyc_auth.php)\nrequire_once __DIR__ . '/../../cyc_auth.php';\ncyc_requerir('usuario');"],
    'analizar.php'    => ["/$TOKEN_BLOQUE/", "require_once __DIR__ . '/cyc_auth.php';   // sesión de Firebase o cron local\ncyc_requerir('usuario');"],
    'transcribir.php' => ["/$TOKEN_BLOQUE/", "require_once __DIR__ . '/cyc_auth.php';   // sesión de Firebase o cron local\ncyc_requerir('usuario');"],
    'upload.php'      => ["/$TOKEN_BLOQUE/", "require_once __DIR__ . '/cyc_auth.php';   // sesión de Firebase (subir material: solo supervisores)\ncyc_requerir('super');"],
    'audio.php'       => ['/\/\/ Token simple[^\n]*\n\s*\$token\s*=\s*\$_GET\[\'token\'\][^;]*;\s*if\s*\(\s*!hash_equals\(\s*\(string\)\s*AUDIO_TOKEN[^{]*\{[^}]*\}/',
                          "// Antes: ?token= fijo (estaba en el JS público). Ahora: cookie de sesión (ver cyc_auth.php).\n// El ?token= que todavía mande el front se ignora.\nrequire_once __DIR__ . '/cyc_auth.php';\ncyc_requerir('usuario');"],
    'whatsapp.php'    => ["/$OPTIONS/", "\$1\n\n// 🔒 Antes este endpoint no pedía NINGÚN login. Ahora: sesión de supervisor/admin.\nrequire_once __DIR__ . '/cyc_auth.php';\ncyc_requerir('super');"],
    'create_user.php' => ["/$OPTIONS/", "\$1\n\n// 🔒 Antes este endpoint no pedía NINGÚN login. Ahora: sesión de supervisor/admin.\nrequire_once __DIR__ . '/cyc_auth.php';\ncyc_requerir('super');"],
];

$nuevos = []; $errores = [];
foreach ($cambios as $rel => $def) {
    if (!isset($def['reemplazos'])) $def = ['marca' => $MARCA_AUTH, 'reemplazos' => [$def]];   // endpoints: un solo bloque
    $ruta = "$dir/$rel";
    if (!is_file($ruta)) { $errores[] = "$rel: no existe"; continue; }
    $src = file_get_contents($ruta);
    if (strpos($src, $def['marca']) !== false) { echo "ya estaba   $rel\n"; continue; }
    $eol = strpos($src, "\r\n") !== false ? "\r\n" : "\n";
    $nuevo = $src; $ok = true;
    foreach ($def['reemplazos'] as $i => [$patron, $reemplazo]) {
        $n = preg_match_all($patron, $nuevo);
        if ($n !== 1) { $errores[] = "$rel: el cambio " . ($i + 1) . " encontró $n lugares (esperaba 1)"; $ok = false; break; }
        $nuevo = preg_replace($patron, str_replace("\n", $eol, $reemplazo), $nuevo, 1);
    }
    if (!$ok) continue;
    $nuevos[$rel] = $nuevo;
    echo "a cambiar   $rel\n";
}

if ($errores) {
    echo "\nNO SE CAMBIÓ NADA. Problemas:\n  - " . implode("\n  - ", $errores) . "\nMandale esta salida a Ramiro.\n";
    exit(1);
}
if (!$aplicar) { echo "\nTodo en orden. Para aplicar: agregá --aplicar al final.\n"; exit(0); }

$bak = dirname($dir) . DIRECTORY_SEPARATOR . 'backup-seguridad-' . date('Ymd-His');
foreach ($nuevos as $rel => $contenido) {
    $destBak = "$bak/$rel";
    @mkdir(dirname($destBak), 0777, true);
    if (!copy("$dir/$rel", $destBak)) exit("No pude hacer backup de $rel en $bak. No se cambió $rel ni los siguientes.\n");
    file_put_contents("$dir/$rel", $contenido);
    $lint = shell_exec('"' . PHP_BINARY . '" -l ' . escapeshellarg("$dir/$rel") . ' 2>&1');
    $ok = strpos((string) $lint, 'No syntax errors') !== false;
    echo ($ok ? "aplicado    " : "ERROR SINTAXIS ") . "$rel\n";
    if (!$ok) { copy($destBak, "$dir/$rel"); exit("Restauré $rel desde el backup. Mandale esto a Ramiro:\n$lint\n"); }
}
echo "\nListo. Backup de los originales en: $bak\n";

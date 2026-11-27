<?php
/** Tests de alerta_credito.php. No manda mails. Correr: php tests/test_alerta_credito.php */
require __DIR__ . '/../htdocs/alerta_credito.php';
$fallas = 0;
function ok($c, $n) { global $fallas; echo ($c ? 'ok     ' : 'FALLA  ') . $n . "\n"; if (!$c) $fallas++; }
function tipo($e, $r, $m = '') { $p = cyc_detectar_credito($e, $r, $m); return $p ? $p['proveedor'] . ':' . $p['tipo'] : null; }
$T = 'transcribir.php'; $A = 'analizar.php';
ok(tipo($A, ['error' => 'Claude: Your credit balance is too low to access the Anthropic API.']) === 'Anthropic:sin_credito', 'Anthropic sin credito');
ok(tipo($A, ['error' => 'Claude: invalid x-api-key']) === 'Anthropic:key', 'Anthropic key invalida');
ok(tipo($T, ['error' => 'OpenAI no disponible (You exceeded your current quota, please check your plan) y el motor gratis falló']) === 'OpenAI:sin_credito', 'OpenAI sin credito y sin local');
ok(tipo($T, ['ok' => true, 'codigo' => 'openai_sin_credito', 'motor' => 'local']) === 'OpenAI:sin_credito', 'codigo de produccion');
ok(tipo($T, ['ok' => true, 'motor' => 'whisper.cpp local (fallback)'], 'openai') === 'OpenAI:respaldo', 'cayo al local');
ok(tipo($T, ['ok' => true, 'motor' => 'local'], 'local') === null, 'local pedido a proposito');
ok(tipo($T, ['ok' => true, 'motor' => 'openai', 'transcripcion' => 'me quedé sin crédito, insufficient_quota']) === null, 'la transcripcion no dispara');
ok(tipo($A, ['ok' => true, 'analisis' => ['analisis' => 'sin crédito, credit balance']]) === null, 'el analisis no dispara');
ok(tipo($T, ['error' => 'No hay motor', 'codigo' => 'sin_motor']) === 'OpenAI:sin_motor', 'sin motor');
// El mensaje del respaldo apagado: avisa, y no cae en las palabras con las que el cron descarta para siempre.
$fuente = file_get_contents(__DIR__ . '/../htdocs/transcribir.php');
ok(preg_match("/WHISPER_LOCAL'\\) !== 'si'\\) throw new Exception\\('([^']+)'/", $fuente, $mm) === 1, 'Whisper local apagado en transcribir.php');
$err = 'OpenAI no disponible (You exceeded your current quota, please check your plan and billing details.) y el motor gratis falló al transcribir (' . ($mm[1] ?? '') . ').';
ok(!preg_match('/short|corta|vac|empty|demasiado|no encontrado|nas/i', $err), 'el cron no la descarta: la reintenta');
ok(tipo($T, ['error' => $err]) === 'OpenAI:sin_credito', 'y manda la alerta');
ok(tipo($T, ['error' => 'Audio no encontrado en el NAS']) === null, 'audio faltante no dispara');
ok(tipo($A, ['error' => 'Claude: rate_limit_error']) === null, 'rate limit no dispara');
ok(tipo($A, null) === null, 'respuesta no JSON');
$f = tempnam(sys_get_temp_dir(), 'alc'); $n = 0;
$si = function () use (&$n) { $n++; return true; }; $no = function () use (&$n) { $n++; return false; };
$h3 = 3 * 3600;
cyc_alerta_con_tope($f, 1000, $si); cyc_alerta_con_tope($f, 1000 + $h3 - 1, $si); ok($n === 1, 'una sola en 3 h');
cyc_alerta_con_tope($f, 1000 + $h3, $no); ok($n === 2, 'a las 3 h vuelve a avisar');
cyc_alerta_con_tope($f, 1000 + $h3 + 599, $si); ok($n === 2, 'si fallo espera 10 min');
cyc_alerta_con_tope($f, 1000 + $h3 + 600, $si); ok($n === 3, 'y reintenta');
exit($fallas ? 1 : 0);

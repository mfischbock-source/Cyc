<?php
/**
 * Tests de reglaTipif() (htdocs/lib_comun.php): qué regla le toca a una tipificación de Neotel.
 * Casos sacados de los datos reales de noviembre 2026 (Firestore configuracion/tipificaciones).
 * Correr: php tests/test_reglas_tipif.php   (sale 0 si todo pasa). Lo llama verificar.py.
 */
require __DIR__ . '/../htdocs/lib_comun.php';

$fallas = 0;
function ok($cond, $nombre) { global $fallas; echo ($cond ? "ok     " : "FALLA  ") . $nombre . "\n"; if (!$cond) $fallas++; }

$R = "\u{FFFD}";   // lo que deja Neotel cuando la base no viene en UTF-8
$reglas = [
    'CANCELACIÓN SIN CUPON'     => 'analizar',
    'PLAN DE PAGO CUPÓN MAC'    => 'analizar',
    'PAG' . $R                  => 'analizar',     // regla guardada con el acento roto
    'OCUPADO/SE CORTA'          => 'analizar',
    'OCUPADO SE CORTA'          => 'descartar',
    'NO CONTESTA'               => 'descartar',
    'CONTACTO SIN INTER' . $R . 'S' => 'analizar',
];
$idx = indiceReglasTipif($reglas);

ok(reglaTipif($idx, 'CANCELACIÓN SIN CUPON') === 'analizar', 'exacta bien escrita');
ok(reglaTipif($idx, 'Cancelaci' . $R . 'n SIN CUPON') === 'analizar', 'Neotel con acento roto encuentra la regla bien escrita (el bug)');
ok(reglaTipif($idx, 'Plan de pago Cup' . $R . 'n Mac') === 'analizar', 'otra de pago con acento roto');
ok(reglaTipif($idx, 'PAGÓ') === 'analizar', 'al revés: regla rota, Neotel bien escrito');
ok(reglaTipif($idx, 'Ocupado se corta') === 'descartar', 'colisión: la exacta "descartar" gana (no analizar ocupados)');
ok(reglaTipif($idx, 'OCUPADO/SE CORTA') === 'analizar', 'colisión: la otra exacta respeta su regla');
ok(reglaTipif($idx, '  no contesta ') === 'descartar', 'mayúsculas y espacios');
ok(reglaTipif($idx, 'CONTACTO SIN INTERÉS') === 'analizar', 'regla rota, tipificación bien escrita');
ok(reglaTipif($idx, 'TIPIFICACION NUEVA') === '', 'sin regla → "" (el cron aplica el modo whitelist/blacklist)');
ok(reglaTipif($idx, '') === '', 'vacía → ""');
ok(reglaTipif(indiceReglasTipif(null), 'PAGO') === '', 'sin reglas cargadas no rompe');
ok(normTip('Cancelaci' . $R . 'n') === normTip('CANCELACIÓN'), 'normTip iguala acento roto y bien escrito');

echo "\n" . ($fallas ? "$fallas falla(s)." : "Todo bien.") . "\n";
exit($fallas ? 1 : 0);

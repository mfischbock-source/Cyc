<?php
/**
 * DASA — C&C  ·  🔒 CANDADO DE SOLO-LECTURA PARA NEOTEL
 * ───────────────────────────────────────────────────────────────────────────
 * Neotel es la base de PRODUCCIÓN del call center. Esta plataforma JAMÁS debe
 * escribir en ella. TODA consulta a Neotel pasa obligatoriamente por consultar();
 * si el SQL no es un SELECT puro, se aborta ANTES de tocar la base.
 *
 * No agregar ningún camino que ejecute SQL contra Neotel sin pasar por acá.
 */

function assertSoloLectura(string $sql): void {
    // Sacar comentarios para inspeccionar el SQL real (evita ocultar verbos)
    $limpio = preg_replace('/--.*$/m', '', $sql);
    $limpio = preg_replace('#/\*.*?\*/#s', '', $limpio ?? '');
    $limpio = trim($limpio ?? '');

    // Debe empezar con SELECT (o WITH para CTEs de solo lectura)
    if (!preg_match('/^\(*\s*(WITH\b|SELECT\b)/i', $limpio)) {
        throw new RuntimeException('BLOQUEADO: solo se permiten consultas SELECT contra Neotel');
    }
    // Una sola sentencia (evita "stacked queries": SELECT ... ; DELETE ...)
    if (strpos(rtrim($limpio, "; \t\n\r"), ';') !== false) {
        throw new RuntimeException('BLOQUEADO: no se permiten múltiples sentencias');
    }
    // Verbos de escritura / DDL / ejecución de procedimientos: prohibidos.
    // (REPLACE NO se bloquea: REPLACE() es función de string de solo lectura en T-SQL.)
    $prohibidas = '/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|MERGE|GRANT|REVOKE|DENY|BACKUP|RESTORE|EXEC|EXECUTE|INTO|OPENROWSET|OPENQUERY|OPENDATASOURCE|BULK|WAITFOR|SHUTDOWN|RECONFIGURE)\b|(\bsp_|\bxp_)/i';
    if (preg_match($prohibidas, $limpio)) {
        throw new RuntimeException('BLOQUEADO: la consulta contiene una operación no permitida (solo lectura)');
    }
}

function consultar(PDO $db, string $sql, array $params = []): array {
    assertSoloLectura($sql);          // candado: aborta si no es SELECT puro
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetchAll();
}

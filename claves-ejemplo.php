<?php
// PLANTILLA. Copiala como "secrets.local.php" en esta misma carpeta (al lado de htdocs, NUNCA adentro)
// y completá solo lo que necesites. Las claves se las pedís a Ramiro. Nunca van en el código ni en un zip.
return [
    'SESION_KEY'        => '',   // inventada, 40+ caracteres; en tu PC puede ser cualquiera
    'NEOTEL_API_TOKEN'  => '',   // inventada; interna de la app (cron)
    'AUDIO_TOKEN'       => '',   // inventada; interna de la app
    'NEOTEL_DB_PASS'    => '',   // contraseña del SQL de Neotel (solo sirve con la VPN de DASA)
    'ANTHROPIC_API_KEY' => '',   // análisis con IA (gasta crédito real)
    'OPENAI_API_KEY'    => '',   // transcripción (gasta crédito real)
    'RAPIWHA_API_KEY'   => '',   // WhatsApp: dejala vacía, manda mensajes reales
    'ALERTA_GMAIL_USER' => '',   // alerta de crédito
    'ALERTA_GMAIL_PASS' => '',
];

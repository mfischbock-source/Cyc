# DASA Calidad & Capacitación — contexto para Claude Code

> Plataforma interna del call center de cobranzas de DASA: dashboards de gestores/supervisores, speech analytics con IA sobre grabaciones (Whisper + Claude), capacitación y evaluaciones. SPA React en un solo `index.html` + backend PHP plano. Corre en un server interno de la empresa (LAN, `http://192.168.0.245` / `cyc.dasaargentina.com`). Se desarrolla local y se sube a mano.

> **Leé también `LEEME-PRIMERO.md`**: mapa de archivos, cómo correrlo, reglas y estado.

## Arquitectura

- **Frontend**: `htdocs/index.html` — TODO el frontend (~4.500 líneas de JSX) en un `<script type="text/babel">`. React 18.3.1 + Chart.js + xlsx + **Babel Standalone 7.24.7 por CDN, transpilado en el browser**. Sin build, sin node_modules, sin router (navegación por estado). **No actualizar Babel de 7.24.7** — "latest" rompía la app (pantalla en blanco).
- **Backend**: PHP plano, un script por endpoint, todos con `require_once config.php`. Prod: Apache/XAMPP en el server interno. Dev: `php -S`.
- **Datos repartidos**: Neotel SQL Server (`TEL_LOGS`, 192.168.0.202:2133) = telefonía/productividad SOLO LECTURA · Firestore (proyecto `dasa-calidad`) = calidad/capacitación/evaluaciones/config · NAS QNAP = audios · Whisper + Claude = IA. Material de capacitación va **on-premise** vía `upload.php` (decisión explícita: NO Firebase Storage).
- Los comentarios de "Hostinger/public_html" en `config.php` son plantilla vieja — el deploy real es el server interno.

## Módulos (htdocs/)

- `neotel_sql.php` — proxy read-only a Neotel: acciones `calls` (tabla diaria `TKyyyymmdd`), `productivity`, `team_productivity`, `logins`. Convierte Windows-1252→UTF-8.
- `neotel_guard.php` — **candado crítico**: `consultar()` es el único camino a Neotel y `assertSoloLectura()` aborta todo lo que no sea SELECT/WITH puro. Protege la DB de producción del telefónico. No debilitar.
- `neotel_mock.php` — datos sintéticos deterministas (PRNG por usuario+fecha), misma forma que el real. Solo se activa en localhost con `?mock=1` — **el default local es el SQL real vía VPN**.
- `audio.php` — streamea .wav/.mp3 del NAS con range requests; busca en MONITOREO y extrae de ZIPs históricos. Pide sesión (`cyc_requerir`).
- `transcribir.php` — audio → texto. OpenAI Whisper API (`whisper-1`). El respaldo whisper.cpp local está APAGADO (tumbaba la VM; se prende con `WHISPER_LOCAL`=`si`). El texto de sus errores importa: `analizar_cron.php` descarta para siempre si contiene "corta", "vac", "short"…
- `analizar.php` — transcripción + rúbrica → Claude (`ANALISIS_MODELO`, hoy claude-haiku-4-5; opus solo a pedido en "Análisis profundo", json_schema). Pre-filtro `esNoLlamada()` descarta buzones/IVR/silencios SIN gastar tokens. Usa prompt caching.
- `whatsapp.php` — proxy RapiWha, normaliza números AR a 549… Pide sesión de supervisor.
- `alerta_credito.php` — mail al equipo si OpenAI/Anthropic se quedan sin crédito (cada 3 h como mucho). Lo engancha `cyc_requerir()` en transcribir.php y analizar.php. Mira solo error/codigo/motor, nunca la transcripción.
- `upload.php` — material de capacitación a `uploads/capacitaciones/<subtipo>/<cartera>/`, whitelist de extensiones, soporta delete.
- `create_user.php` — alta en Firebase Auth vía REST sin tocar la sesión del supervisor. El `delete` es stub (el doc Firestore se borra desde el frontend).
- Flujo IA (función `analizar()` en index.html ~2926): Neotel lista llamadas → `audio.php` reproduce → `transcribir.php` → `analizar.php` → resultado cacheado en Firestore `analisis_llamadas/<grabacion>` para no re-pagar APIs.

## Desarrollo local

Ver `LEEME-PRIMERO.md` (los `*.sh` son scripts viejos de Mac y pueden no estar).

Comportamiento local se controla por env vars, NO tocando config.php: `NEOTEL_DB_DRIVER=dblib` (FreeTDS en Mac), `DASA_AUDIO_PATH_LOCAL` (NAS montado, reemplaza el UNC `\\NAS-QNAP\...`), `TRANSCRIPTOR=local`, `WHISPER_BIN`, `WHISPER_MODEL`.

- Con `?mock=1` en la URL → `neotel_mock.php` (sin VPN).
- Sin Firebase configurado → login demo con array `USERS`, solo en localhost y sin contraseña.

**¿Rompí algo?** → `python verificar.py` (sale 0/1). Sin PHP en la PC de Windows: los chequeos son estáticos (candado Neotel, secretos, referencias y llaves de la v2).

## Autenticación del backend (desde 20/11/2026) — NO volver a tokens en el JS

Todo endpoint arranca con `cyc_requerir('usuario'|'super')` (`htdocs/cyc_auth.php`). Dos caminos:
1. **Navegador**: `cyc_sesion.jsx` (lo cargan index.html, capacitacion.html y v2) parchea `fetch`/XHR: antes del primer pedido a un `.php` manda el ID token de Firebase a `sesion.php`, que valida la firma RS256 con las claves públicas de Google, autoriza (ver abajo) y deja la cookie `cyc_sesion` (HMAC con `SESION_KEY`, HttpOnly, 12 h). Ante un 401 renueva y reintenta una vez. Al cerrar sesión en Firebase borra la cookie.
2. **Cron**: `X-DASA-Token` = `NEOTEL_API_TOKEN`, aceptado SOLO desde loopback/IP del server y sin headers de Cloudflare (`analizar-cron.bat` usa `http://127.0.0.1:10446`).

Autorización (`cyc_autorizar`): propietario → super; Google con mail @dasaargentina.com verificado (o invitado en `invitaciones_v2`) + rol en `usuarios_v2` → owner/admin/supervisor = super, auditor = usuario; cuenta usuario/contraseña con perfil en `usuarios` → supervisor/admin = super, resto = usuario. `upload.php`, `whatsapp.php`, `create_user.php` piden super.
- Los tokens viejos (`dasa-neotel-…`, `dasa-audio-…`) fueron públicos: `verificar.py` falla si vuelven a aparecer.
- Tests: `php tests/test_cyc_auth.php` (35 casos, sin red). `verificar.py` los corre si hay `php` en PATH o `PHP_BIN`.
- Deploy a un server con PHP más nuevo que git: `server-tools/aplicar_seguridad.php` parchea solo el bloque de auth de cada endpoint (backup + lint, aborta sin escribir si algo no coincide).
- **Riesgo residual**: la autorización lee `usuarios`/`usuarios_v2` con el token del propio usuario, así que depende de las reglas de Firestore (no están en el repo). Si las reglas dejan que cualquiera escriba su propio perfil, una cuenta creada por la API pública de Firebase podría darse acceso de app vieja. Revisar las reglas en la consola de Firebase.
- Firestore está en plan Spark: cuando se agota la cuota diaria (`RESOURCE_EXHAUSTED`) la app carga vacía. Ver `COMO-ACTIVAR-BLAZE.txt`.

## App nueva `/v2/` (en producción desde 02/10/2026)

Pedido de Matías (mail 28/09): barra Audios (Buscar y analizar · Control interno) / Capacitación / Configuración (Métodos de análisis con título+prompt, Usuarios). Un buscador único (cliente, cartera, DNI, teléfono, tipificación, ID, Excel masivo, fechas) → grilla → seleccionar → elegir método → score con popup → descargar grabaciones en zip.
- `htdocs/v2/` (index.html + `js/*.jsx` compilados en el navegador por Babel standalone; van como `.jsx` para que Gmail no bloquee el adjunto) + `v2/api/*.php`. Login solo con Google, entrar por `https://cyc.dasaargentina.com/v2/` (por IP no anda).
- Usa `htdocs/lib_audio.php` y `lib_comun.php` (raíz, solo los usa v2). Requiere `extension=zip` en php.ini.
- **Control interno** (`v2/js/control.jsx`, 11/2026): reemplaza "Calidad de gestión". Lee `analisis_llamadas` vía un resumen mensual cacheado en `control_resumen/{YYYY-MM}` (por gestor y día: `[suma, n]` + no aptas). Un mes son ~16.000 docs / 6 MB: NUNCA leer el mes entero en cada apertura (el plan Spark da 50.000 lecturas/día). Se refrescan solo los últimos 3 días, como mucho cada 30 min; "Recalcular mes" rehace todo. El detalle de un gestor lee `where neotelId ==` (no hace falta índice compuesto). Objetivo en `configuracion/objetivo`.
- **Capacitación** (`v2/js/capacitacion.jsx`): Cursos (crear/editar con material, examen y "revisar cada X días" → Vence pronto/Vencido) y Seguimiento, portados de `capacitacion.html` con las mismas colecciones `cap2_*`. Los gestores no entran a la v2: siguen haciendo los cursos en la app anterior (`capacitacion.html`).
- `V2.ModalScore` (de buscar.jsx) se reusa en Control interno.
- **Parámetros de análisis por cliente** (`v2/js/parametros.jsx`, 27/11/2026): un prompt por cliente en `parametros_cliente/{V2.slugCliente(cliente)}` = `{cliente, prompt, actualizadoPor, actualizadoEn}`. Menú Configuración, permiso `metodos`. En Buscar y analizar el selector de método tiene dos opciones nuevas (además de los métodos guardados): **"Según parámetro del cliente"** (`__cliente`, la opción por defecto: cada llamada usa el prompt de SU cliente; resultados en `analisis_v2/<grabacion>__param-<slug>`) y **"Análisis a medida"** (`__medida`: prompt escrito en el momento, borrador en localStorage; resultados en `<grabacion>__medida-<V2.hashTexto(prompt)>`, así el mismo texto reusa lo ya analizado). Ambos guardan `modo` y `promptUsado` en el resultado y el popup del score lo muestra. No cambia ningún `.php`: `analizar.php` ya recibe el prompt del navegador.
- **Buscar y analizar, flujo desde 27/11/2026**: filtros → Buscar → grilla ordenable (click en el título de cada columna, asc/desc; ordena las filas de la página cargada, 100 por página; vacíos al final). No hay selector de método arriba: "Analizar" (en la fila, o "Analizar N…" con varias tildadas) abre `ModalElegirAnalisis`, donde se elige **Parámetro de análisis por cliente** o **A medida** (prompt en el momento). La columna Análisis muestra el último análisis de la llamada de CUALQUIER tipo (se leen con `analisis_v2 where grabacion in [≤10]`); "+N" abre el popup con un selector entre todos. Si ya existe el mismo id con el mismo `promptUsado`, la cola no lo vuelve a pagar.
- **"Métodos de análisis" se sacó (27/11/2026)**: `v2/js/metodos.jsx` ya no se carga en `v2/index.html` (el archivo queda) y Buscar y analizar solo ofrece "Según parámetro del cliente" y "Análisis a medida". La colección `metodos_analisis` queda como está; Parámetros solo la lee para "Copiar de un método anterior". Los resultados viejos hechos con un método guardado siguen en `analisis_v2` y se ven en la grilla (la columna muestra todos los tipos).
- El grupo del menú "Audios" pasó a llamarse **"Calidad de audios"** (`GRUPOS` en app.jsx + `grupo` en buscar.jsx y control.jsx).
- **Reglas de tipificación** (`configuracion/tipificaciones`: `modo` whitelist/blacklist + `reglas` {TIPIF: analizar|descartar}): comparar SIEMPRE con `reglaTipif()` (lib_comun.php) / `reglaDe()` (index.html): exacta primero, después `normTip()`. Neotel devuelve algunas tipificaciones con acentos rotos (U+FFFD, `JSON_INVALID_UTF8_SUBSTITUTE` en neotel_sql.php) y con el texto exacto el cron descartaba pagos. Exacta primero porque "OCUPADO SE CORTA" (descartar) y "OCUPADO/SE CORTA" (analizar) normalizan igual. Tests: `tests/test_reglas_tipif.php`.
- El cron descarta ~97% de lo atendido: whitelist (solo pagos/promesas/contacto) + "sin tipificación en el CRM para ese IDLLAMADA = no-gestión" (~36% de los descartes, sin verificar con VPN). Desde 20/11 el descarte guarda `durSeg` para diagnosticarlo.
- La app vieja lee `analisis_llamadas` ENTERA en varias pantallas (index.html ~3054 y ~3529): es lo que agota la cuota de Firestore.
- La v2 se desarrolló fuera de git; se incorporó desde el zip `DASA-CYC2026-10-05-v2.zip` (verificado idéntico a producción el 20/11/2026, salvo los .php que no se pueden bajar).

## Deploy (manual, sin git ni CI)

Backup → copiar los `.php` / `index.html` / `.htaccess` a la raíz del sitio. **`config.php` NO se sube** — se conserva el del server (Neotel real, rutas NAS, claves). Las carpetas `deploy-*` y `.zip` de la raíz son paquetes armados a mano. Flujo documentado en los `LEEME-DEPLOY.txt`.

## Config (`config.php`, protegido por .htaccess Deny all)

Neotel: `NEOTEL_DB_DRIVER/ODBC_DSN/DB_HOST/DB_NAME/DB_USER/DB_PASS/DB_PORT` · IA: `ANTHROPIC_API_KEY`, `ANALISIS_MODELO`, `OPENAI_API_KEY`, `TRANSCRIPTOR`, `WHISPER_BIN/MODEL` · WhatsApp: `RAPIWHA_API_KEY/ENDPOINT` · Otros: `ALLOWED_ORIGIN`, `FIREBASE_PROJECT_ID/API_KEY`, `NEOTEL_AUDIO_PATH/ZIP_PATH`, `AUDIO_TOKEN`, `NEOTEL_API_TOKEN`.

**Secretos (desde 2026-07-05)**: los valores reales viven en `../secrets.local.php` (fuera de htdocs, chmod 600) y `../secrets.local.sh` (credenciales SMB del NAS para `arrancar-GRATIS.sh`). `config.php` los carga con `dasa_secret()` — prioridad: env var > secrets.local.php. **Esos dos archivos NO se suben, NO se zipean, NO se comparten.** Los zips y carpetas de deploy ya no incluyen config.php con valores.

**⚠️ Pendiente de rotación**: las keys (Anthropic, OpenAI, RapiWha, pass Neotel, SMB del NAS) estuvieron expuestas en copias/zips — rotarlas cuando se pueda. Los tokens ya no están en el JS: el navegador usa la sesión de `cyc_auth.php`.

## Gotchas

- **Encoding**: Neotel devuelve Windows-1252; si se rompe la conversión aparecen acentos corruptos o `{"error":"JSON encoding failed"}`. El mock no la aplica (datos ya limpios).
- **Tablas diarias `TKyyyymmdd` interpoladas en el SQL** (nombres de tabla no se parametrizan): `fechaValida()` (regex YYYY-MM-DD) es la ÚNICA barrera anti-inyección — no debilitarla.
- **Driver SQL variable**: prod usa DSN ODBC `NeotelDASA` (Windows); dev usa dblib. `getDB()` tiene fallback en cadena — frágil si faltan drivers.
- **`uploads/.htaccess` desactiva PHP solo bajo Apache** — con `php -S` o nginx no aplica (la whitelist de extensiones mitiga).
- **Whisper transcribe silencio como basura** ("subtítulos por amara.org") — el pre-filtro de `analizar.php` los caza; patrones nuevos se agregan a mano.
- **`config-CORREGIDO.php`** documenta un bug ya resuelto (doble `define('NEOTEL_DB_DRIVER')` — PHP toma el primero). Verificar que el server use la versión con `odbc_dsn` primero.
- UI: regla DASA de **máxima visibilidad** — errores inline (no alerts), contadores, filas salteadas visibles.

## Mock vs real hoy

Real: Neotel, audios NAS, Whisper, Claude, WhatsApp, upload, Firebase Auth+Firestore. Mock/demo: `neotel_mock.php` (solo `?mock=1`), array `USERS` y bloques `MOCK DATA` de index.html (fallback visual sin Firebase), `_sample_audio.wav`, `default.php` (placeholder muerto de Hostinger).

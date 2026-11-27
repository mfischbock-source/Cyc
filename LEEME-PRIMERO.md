# DASA Calidad & Capacitación: proyecto completo (24/11/2026)

Descomprimí la carpeta, abrila con Claude y pedile lo que quieras. Claude lee `CLAUDE.md` solo; si no lo hace, decile:
"leé CLAUDE.md y LEEME-PRIMERO.md antes de tocar nada".

## Instrucciones para Claude

### Mapa rápido
| Para cambiar... | Tocá |
|---|---|
| Buscar y analizar (audios) | `htdocs/v2/js/buscar.jsx` + `htdocs/v2/api/buscar.php`, `catalogo.php`, `zip.php` |
| Control interno | `htdocs/v2/js/control.jsx` |
| Capacitación (cursos y seguimiento) | `htdocs/v2/js/capacitacion.jsx` (los gestores la hacen en `htdocs/capacitacion.html`) |
| Métodos de análisis (prompts) | Sacado del menú el 27/11/2026: `htdocs/v2/js/metodos.jsx` queda sin cargar |
| Parámetros de análisis por cliente | `htdocs/v2/js/parametros.jsx` (se usan en `buscar.jsx`) |
| Usuarios e invitaciones / ingresos | `htdocs/v2/js/usuarios.jsx`, `ingresos.jsx` |
| Menú, login, permisos por pantalla | `htdocs/v2/js/app.jsx`, `nucleo.jsx` |
| Estilos | `htdocs/v2/css/estilos.css` |
| App anterior (`/anterior/`) | `htdocs/index.html` |
| Login del backend | `htdocs/cyc_auth.php`, `sesion.php`, `cyc_sesion.jsx` |
| Transcripción / análisis IA | `htdocs/transcribir.php`, `analizar.php` |
| Análisis automático nocturno | `htdocs/analizar_cron.php` |

### Cómo correrlo
1. Solo ver pantallas (Python): `python -m http.server 8091 --directory htdocs` y abrir `http://localhost:8091/v2/`.
   Se entra con Google @dasaargentina.com. Lo que sale de Firestore anda; lo que llama a un `.php`, no.
2. Con backend (PHP 8 con curl, openssl, mbstring y zip): copiar `claves-ejemplo.php` como `secrets.local.php`,
   completar al menos `SESION_KEY`, y `php -S localhost:8093 -t htdocs`. Abrir `http://localhost:8093/v2/`.
   Neotel y audios solo andan con la VPN de DASA; la IA, con sus claves. El `.htaccess` no aplica con `php -S`
   (por eso `/anterior/` no existe en local: usar `/index.html`).

### Reglas
- **Los datos son los reales**: al loguearte, Firestore es el de producción. No crear, editar ni borrar cursos,
  usuarios o análisis para probar, ni mandar WhatsApp. Preguntá antes de guardar cualquier cosa.
- **Los `.php` del server pueden ser más nuevos que estos** (salvo `cyc_auth.php`, `sesion.php`, `lib_comun.php` y
  `alerta_credito.php`). Si cambiás otro `.php`, anotá exactamente qué líneas: en el server se aplican con un script
  que parchea (modelo: `server-tools/aplicar_seguridad.php`), sin pisar el archivo. Los `.jsx`, el `.css`,
  `v2/index.html`, `index.html` y `capacitacion.html` sí se pueden reemplazar.
- Claves: solo en `secrets.local.php`, nunca en el código ni en un zip.
- Neotel es solo lectura: no tocar `neotel_guard.php`. No sacar `cyc_requerir()` de ningún endpoint.
- No leer `analisis_llamadas` completa: agota la cuota de Firestore.
- Al cambiar un `.jsx` o `.css` de la v2, subir su `?v=` en `v2/index.html`. No hay build: lo compila el navegador, así
  que no usar `import`/`npm`. No cambiar la versión de Babel.
- No borrar archivos.
- Antes de entregar: `python verificar.py` (tiene que decir "Todo bien") y mirar la pantalla en el navegador.

### Estado al 24/11/2026
En producción: v2 como página principal, login validado en el server, botón Buscar fijo. Entregado o por entregar a
IT, sin confirmar: alerta de crédito, Whisper local apagado, contraseñas al azar (`index.html`).
Pendiente: pasar Firestore a Blaze (`COMO-ACTIVAR-BLAZE.txt`), cambiar las claves de las cuentas con contraseña por
defecto, definir si se apaga el acceso con usuario y contraseña.

## Para devolver los cambios
Mandale a Ramiro la carpeta en un zip (sin `secrets.local.php`) y la lista de archivos modificados. Ramiro los compara
y arma la entrega para IT. No instalar directo en el server.

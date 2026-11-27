// ═══════════════════════════════════════════════════════════════════════════════════════
// SHELL de la app v2 (login + menú + ruteo) — dueño: workstream B.
// Diseño: maqueta aprobada "A + B · Combinada" (vistaD) — clases de estilos.css.
// Reglas de sintaxis (Babel 7.24.7 en el navegador): var + function(){}, SIN ?. ni ??
// ═══════════════════════════════════════════════════════════════════════════════════════

var LOGO_URL = "https://dasaargentina.com/wp-content/uploads/2022/06/Logo-Dasa.png";
var APP_ANTERIOR = "/anterior/";
var LS_PANTALLA = "v2_pantalla_activa";

// ── Pantallas "Próximamente" que arma el shell (NO son V2.registrar: no existen todavía). ──
// (Control interno y Capacitación ya existen: control.jsx y capacitacion.jsx, 11/2026.)
var PLACEHOLDERS = [];
var GRUPOS = ["Calidad de audios", "Capacitación", "Configuración"];

// Permiso que pide cada pantalla (V2.puede). Las que no figuran acá las ve cualquier rol con acceso.
var PERMISO_PANTALLA = { buscar: "ver", "control-interno": "ver", "cap-cursos": "ver", "cap-seguimiento": "ver", parametros: "metodos", metodos: "metodos", usuarios: "usuarios", ingresos: "ingresos" };
function visiblePorRol(p) { return !PERMISO_PANTALLA[p.id] || V2.puede(PERMISO_PANTALLA[p.id]); }

function itemsPorGrupo(grupo) {
  var registrados = V2.pantallas.filter(function (p) { return p.grupo === grupo && visiblePorRol(p); }).slice().sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); });
  var extras = PLACEHOLDERS.filter(function (p) { return p.grupo === grupo; });
  return registrados.concat(extras);
}
function todosLosItems() {
  var out = [];
  GRUPOS.forEach(function (g) { out = out.concat(itemsPorGrupo(g)); });
  return out;
}
function primerItemId() {
  var t = todosLosItems();
  return t.length ? t[0].id : "";
}
function idValido(id) {
  var t = todosLosItems();
  for (var i = 0; i < t.length; i++) { if (t[i].id === id) return true; }
  return false;
}
function leerUltimaPantalla() {
  try { return window.localStorage.getItem(LS_PANTALLA) || ""; } catch (e) { return ""; }
}
function guardarUltimaPantalla(id) {
  try { window.localStorage.setItem(LS_PANTALLA, id); } catch (e) { /* localStorage no disponible: no rompe la app */ }
}

// ── Pantalla de carga (mientras se resuelve la sesión) ──────────────────────────────────
function PantallaCarga() {
  return <div className="v2-carga"><div className="v2-pantalla-mensaje-texto">Cargando…</div></div>;
}

// ── Mensaje a pantalla completa (error de inicio, sin perfil, acceso denegado) ──────────
function PantallaMensaje(props) {
  return <div className="v2-pantalla-mensaje">
    <div className="v2-pantalla-mensaje-caja">
      <div className="v2-pantalla-mensaje-titulo">{props.titulo}</div>
      <div className="v2-pantalla-mensaje-texto">{props.mensaje}</div>
      {props.linkAppActual && <div style={{ marginBottom: 14 }}><a href={APP_ANTERIOR}>Ir a la aplicación actual</a></div>}
      {props.botonTexto && <V2.Boton tipo="secundario" onClick={props.onBoton}>{props.botonTexto}</V2.Boton>}
    </div>
  </div>;
}

// ── Cuenta creada pero sin rol: espera que un admin la apruebe ──────────────────────────
function PantallaPendiente(props) {
  var u = props.usuario || {};
  return <div className="v2-pantalla-mensaje">
    <div className="v2-pantalla-mensaje-caja">
      <div className="v2-pantalla-mensaje-titulo">Esperando aprobación</div>
      <div className="v2-pantalla-mensaje-texto">Tu cuenta <b>{u.email || ""}</b> ya está registrada, pero todavía no tiene un rol asignado. Avisale a un administrador para que te habilite y después tocá "Revisar de nuevo".</div>
      <div style={{ display: "flex", gap: 8 }}>
        <V2.Boton tipo="primario" onClick={props.onRevisar}>Revisar de nuevo</V2.Boton>
        <V2.Boton tipo="secundario" onClick={function () { V2.auth.signOut(); }}>Cerrar sesión</V2.Boton>
      </div>
    </div>
  </div>;
}

// ── Login: Google (solo mails del dominio de DASA). Contraseña = acceso alternativo colapsado. ──
function Login(props) {
  var stU = useState(""), usuario = stU[0], setUsuario = stU[1];
  var stP = useState(""), clave = stP[0], setClave = stP[1];
  var stErr = useState(props.errorInicial || ""), error = stErr[0], setError = stErr[1];
  var stCarg = useState(false), cargando = stCarg[0], setCargando = stCarg[1];
  var stClave = useState(false), verClave = stClave[0], setVerClave = stClave[1];

  var mensajeError = function (e) {
    var codigo = e && e.code;
    if (codigo === "auth/wrong-password" || codigo === "auth/user-not-found" || codigo === "auth/invalid-credential" || codigo === "auth/invalid-email") return "Usuario o contraseña incorrectos.";
    if (codigo === "auth/too-many-requests") return "Demasiados intentos. Esperá unos minutos y probá de nuevo.";
    if (codigo === "auth/network-request-failed") return "Sin conexión con el servidor de autenticación.";
    if (codigo === "auth/popup-closed-by-user" || codigo === "auth/cancelled-popup-request") return "Se cerró la ventana de Google antes de terminar. Probá de nuevo.";
    if (codigo === "auth/popup-blocked") return "El navegador bloqueó la ventana de Google. Permití los pop-ups para este sitio.";
    if (codigo === "auth/unauthorized-domain") return "Este sitio (" + location.hostname + ") no está autorizado en Firebase para iniciar sesión con Google. Un administrador debe agregarlo en Authentication → Settings → Authorized domains.";
    if (codigo === "auth/operation-not-allowed") return "El inicio de sesión con Google no está habilitado en Firebase (Authentication → Sign-in method).";
    return "No se pudo iniciar sesión (" + (codigo || (e && e.message) || "error desconocido") + ").";
  };

  var conGoogle = function () {
    if (cargando) return;
    setError(""); setCargando(true);
    var prov = new firebase.auth.GoogleAuthProvider();
    prov.setCustomParameters({ prompt: "select_account" });
    V2.auth.signInWithPopup(prov).catch(function (e) { setError(mensajeError(e)); setCargando(false); });
    // Si sale bien, Raiz (onAuthStateChanged) toma la posta y desmonta este Login.
  };

  var conClave = function () {
    if (cargando) return;
    var u = usuario.trim();
    if (!u || !clave) { setError("Completá usuario y contraseña."); return; }
    setError(""); setCargando(true);
    var email = u.indexOf("@") >= 0 ? u : (u + "@" + V2.config.dominio);
    V2.auth.signInWithEmailAndPassword(email, clave).catch(function (e) { setError(mensajeError(e)); setCargando(false); });
  };
  var onKey = function (e) { if (e.key === "Enter") conClave(); };

  return <div className="v2-login-fondo">
    <div className="v2-login-caja">
      <div className="v2-login-header">
        <img className="v2-login-logo" src={LOGO_URL} alt="DASA" />
        <div className="v2-login-sub">Plataforma interna</div>
      </div>
      <div className="v2-login-body">
        <button type="button" className="v2-btn-google" onClick={conGoogle} disabled={cargando}>
          <svg width="24" height="24" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
          <span>{cargando ? "Verificando…" : "Acceder con Google"}</span>
        </button>
        {error && <V2.Aviso tipo="error">{error}</V2.Aviso>}
        <div className="v2-login-pie">Acceso restringido · Solo personal DASA</div>
        <div style={{ marginTop: 14, textAlign: "center" }}>
          <a onClick={function () { setVerClave(!verClave); }} style={{ cursor: "pointer", fontSize: 12 }}>{verClave ? "Ocultar" : "Acceso con usuario y contraseña (cuentas anteriores)"}</a>
        </div>
        {verClave && <div style={{ marginTop: 10 }}>
          <V2.Campo etiqueta="Usuario">
            <input value={usuario} onChange={function (e) { setUsuario(e.target.value); }} onKeyDown={onKey}
              placeholder="ej: juan.garcia" disabled={cargando} style={{ width: "100%" }} />
          </V2.Campo>
          <div style={{ height: 10 }} />
          <V2.Campo etiqueta="Contraseña">
            <input type="password" value={clave} onChange={function (e) { setClave(e.target.value); }} onKeyDown={onKey}
              placeholder="••••••••" disabled={cargando} style={{ width: "100%" }} />
          </V2.Campo>
          <V2.Boton tipo="secundario" onClick={conClave} disabled={cargando} style={{ width: "100%", marginTop: 12 }}>Ingresar</V2.Boton>
        </div>}
      </div>
    </div>
  </div>;
}

// ── Resuelve el perfil del logueado en usuarios_v2. Devuelve {estado, perfil?, mensaje?} ────
//   estado: "ok" | "pendiente" | "inactivo" | "dominio"
// Rol: propietario (por mail) > rol ya asignado > invitación del propietario > supervisor del sistema anterior > pendiente.
// Cada ingreso queda registrado en ingresos_v2 (una vez por sesión del navegador y resultado).
function resolverPerfil(fbUser) {
  var email = String(fbUser.email || "").toLowerCase();
  var col = V2.config.col;
  var esProp = V2.config.propietarios.indexOf(email) >= 0;
  var dominioOk = email.slice(-(V2.config.dominio.length + 1)) === "@" + V2.config.dominio;
  var ahora = new Date().toISOString();
  var ref = V2.db.collection(col.accesos).doc(fbUser.uid);
  var rolValido = function (r) { return !!V2.ROLES[r] && r !== "owner"; };
  var armar = function (d, role) {
    return { uid: fbUser.uid, email: fbUser.email, nombre: d.nombre || fbUser.displayName || fbUser.email, role: role, cliente: d.cliente || "" };
  };
  var proveedor = (fbUser.providerData && fbUser.providerData[0] && fbUser.providerData[0].providerId === "google.com") ? "Google" : "Contraseña";
  var registrar = function (resultado, role) {
    try { var k = "v2_ing_" + fbUser.uid; if (window.sessionStorage.getItem(k) === resultado) return; window.sessionStorage.setItem(k, resultado); } catch (e) {}
    V2.db.collection(col.ingresos).add({ uid: fbUser.uid, email: email, nombre: fbUser.displayName || "", role: role || "", resultado: resultado, metodo: proveedor, en: ahora }).catch(function () {});
  };
  var resp = function (estado, perfil, mensaje, rol) { registrar(estado === "ok" ? "ok" : estado === "dominio" ? "rechazado" : estado, rol); return { estado: estado, perfil: perfil, mensaje: mensaje }; };

  return Promise.all([ref.get(), V2.db.collection(col.invitaciones).doc(email).get().catch(function () { return null; })]).then(function (rs) {
    var doc = rs[0], inv = rs[1] && rs[1].exists ? (rs[1].data() || {}) : null;
    var invRol = inv && rolValido(inv.role) ? inv.role : "";
    var usarInvitacion = function () { if (inv && !inv.usadoEn) V2.db.collection(col.invitaciones).doc(email).update({ usadoEn: ahora, usadoPor: fbUser.uid }).catch(function () {}); };

    if (!dominioOk && !esProp && !invRol) {
      return resp("dominio", null, "Solo pueden ingresar cuentas @" + V2.config.dominio + " o mails habilitados por el propietario. Ingresaste con " + (email || "otra cuenta") + ".", "");
    }
    if (doc.exists) {
      var d = doc.data() || {};
      var rol = d.role, cambios = { ultimoIngreso: ahora };
      if (esProp) { if (rol !== "owner") { rol = "owner"; cambios.role = "owner"; } }
      else if (rol === "owner") { rol = "admin"; }                                       // "owner" en Firestore sin estar en la lista de propietarios: no vale
      else if (!rolValido(rol) && invRol) { rol = invRol; cambios.role = invRol; cambios.origen = "invitacion"; usarInvitacion(); }
      ref.update(cambios).catch(function () {});
      if (d.estado === "inactivo" && !esProp) return resp("inactivo", null, "Tu acceso está desactivado. Contactá a un administrador.", rol);
      if (!V2.ROLES[rol]) return resp("pendiente", armar(d, rol), "", "");
      return resp("ok", armar(d, rol), "", rol);
    }
    // Primer ingreso. ¿Sistema anterior? (para supervisores que ya existían)
    return V2.db.collection(col.usuarios).doc(fbUser.uid).get().catch(function () { return null; }).then(function (viejo) {
      var vd = viejo && viejo.exists ? (viejo.data() || {}) : null;
      var role = esProp ? "owner" : (invRol || (vd && vd.role === "supervisor" ? "supervisor" : "pendiente"));
      var nuevo = {
        email: email, nombre: (vd && (vd.name || vd.nombre)) || fbUser.displayName || email, role: role, estado: "activo",
        origen: esProp ? "propietario" : (invRol ? "invitacion" : (role === "supervisor" ? "sistema_anterior" : "autoalta")),
        cliente: (vd && vd.cliente) || "", creadoEn: ahora, ultimoIngreso: ahora
      };
      if (invRol && !esProp) usarInvitacion();
      return ref.set(nuevo).then(function () {
        return role === "pendiente" ? resp("pendiente", armar(nuevo, role), "", "") : resp("ok", armar(nuevo, role), "", role);
      });
    });
  });
}

// ── Contenido de una pantalla "próximamente" (Control interno, Capacitación) ────────────
function PantallaProximamente(props) {
  var item = props.item;
  return <V2.Tarjeta titulo={item.icono + "  " + item.titulo}>
    <span className="v2-sub">Próximamente.</span>
    {item.linkVersionAnterior && <div style={{ marginTop: 10 }}><V2.Boton tipo="secundario" onClick={function () { window.location.href = APP_ANTERIOR; }}>Abrir en la versión anterior</V2.Boton></div>}
  </V2.Tarjeta>;
}

function ContenidoPantalla(props) {
  var item = props.item;
  if (!item) return <V2.Tarjeta titulo="Sin pantallas">Todavía no hay pantallas disponibles.</V2.Tarjeta>;
  if (item.esPlaceholder) return <PantallaProximamente item={item} />;
  var Comp = item.componente;
  return Comp ? <Comp /> : <V2.Tarjeta titulo={item.titulo}>Esta pantalla no tiene contenido.</V2.Tarjeta>;
}

// ── Shell: menú lateral + encabezado + contenido. Solo se monta con V2.usuario cargado. ──
function Shell(props) {
  var usuario = props.usuario;
  var stAct = useState(function () { var g = leerUltimaPantalla(); return (g && idValido(g)) ? g : primerItemId(); });
  var activo = stAct[0], setActivo = stAct[1];
  var stMenu = useState(false), menuAbierto = stMenu[0], setMenuAbierto = stMenu[1];

  var ir = function (id) { setActivo(id); guardarUltimaPantalla(id); setMenuAbierto(false); };
  V2._navegar = ir;   // V2.irA(id, datos) navega desde cualquier pantalla
  var cerrarSesion = function () { V2.auth.signOut(); };

  var itemActivo = null;
  var todos = todosLosItems();
  for (var i = 0; i < todos.length; i++) { if (todos[i].id === activo) { itemActivo = todos[i]; break; } }

  return <div className={"v2-shell" + (menuAbierto ? " v2-menu-abierto" : "")}>
    <div className="v2-overlay" onClick={function () { setMenuAbierto(false); }}></div>
    <nav className="v2-nav">
      <div className="v2-nav-logo">
        <img src={LOGO_URL} alt="DASA" style={{ height: 22, filter: "brightness(0) invert(1)" }} />
      </div>
      {GRUPOS.map(function (grupo) {
        var items = itemsPorGrupo(grupo);
        if (!items.length) return null;
        return <div key={grupo}>
          <div className="v2-nav-grupo">{grupo}</div>
          {items.map(function (it) {
            var clase = "v2-nav-item" + (it.id === activo ? " v2-nav-item-activa" : "") + (it.esPlaceholder ? " v2-nav-item-prox" : "");
            return <button key={it.id} type="button" className={clase} onClick={function () { ir(it.id); }}>
              <span>{it.icono} {it.titulo}</span>
              {it.esPlaceholder && <span className="v2-nav-item-prox-etq">próximamente</span>}
            </button>;
          })}
        </div>;
      })}
      <div className="v2-nav-pie">
        <div>
          <div className="v2-nav-usuario-nombre">{(usuario && usuario.nombre) || "—"}</div>
          <div className="v2-nav-usuario-email">{(usuario && usuario.email) || ""}</div>
          <div className="v2-nav-usuario-email">{(usuario && V2.ROLES[usuario.role] && V2.ROLES[usuario.role].etiqueta) || ""}</div>
        </div>
        <a href={APP_ANTERIOR}>Versión anterior ↗</a>
        <button type="button" onClick={cerrarSesion}>Cerrar sesión</button>
      </div>
    </nav>
    <div className="v2-contenido">
      <div className="v2-cab">
        <button className="v2-hamburguesa" onClick={function () { setMenuAbierto(!menuAbierto); }} aria-label="Abrir menú" title="Abrir menú">☰</button>
        <h2>{itemActivo ? (itemActivo.icono + " " + itemActivo.titulo) : "DASA · Calidad"}</h2>
      </div>
      <main className="v2-main">
        <V2.ErrorBoundary key={activo}>
          <ContenidoPantalla item={itemActivo} />
        </V2.ErrorBoundary>
      </main>
    </div>
  </div>;
}

// ── Raíz: resuelve sesión (Firebase) y perfil (Firestore) ANTES de montar el Shell. ──────
function Raiz() {
  var stVista = useState("cargando"), vista = stVista[0], setVista = stVista[1];
  var stUsuario = useState(null), usuario = stUsuario[0], setUsuarioLocal = stUsuario[1];
  var stMsg = useState(""), mensaje = stMsg[0], setMensaje = stMsg[1];

  useEffect(function () {
    if (V2.errorInicio) { setMensaje(V2.errorInicio); setVista("errorInicio"); return; }
    if (!V2.auth || !V2.db) { setMensaje("No se pudo iniciar la conexión con el sistema."); setVista("errorInicio"); return; }

    var unsub = V2.auth.onAuthStateChanged(function (fbUser) {
      if (!fbUser) {
        V2.usuario = null;
        setUsuarioLocal(null);
        // No pisar una pantalla de bloqueo (sinPerfil/denegado) que ya cerró sesión sola.
        setVista(function (v) { return (v === "dominio" || v === "inactivo") ? v : "login"; });
        return;
      }
      resolverPerfil(fbUser).then(function (r) {
        if (r.estado === "ok") {
          V2.usuario = r.perfil; // seteado ANTES de montar el Shell (y cualquier pantalla)
          setUsuarioLocal(r.perfil);
          setVista("app");
        } else if (r.estado === "pendiente") {
          V2.usuario = null; setUsuarioLocal(r.perfil);
          setVista("pendiente");
        } else {
          setMensaje(r.mensaje);
          setVista(r.estado === "dominio" ? "dominio" : "inactivo");
          V2.auth.signOut();
        }
      }).catch(function (e) {
        setMensaje("No se pudo cargar tu perfil (" + ((e && e.message) || "error desconocido") + ").");
        setVista("errorPerfil");
      });
    });
    return function () { unsub(); };
  }, []);

  if (vista === "cargando") return <PantallaCarga />;
  if (vista === "errorInicio") return <PantallaMensaje titulo="No se pudo conectar" mensaje={mensaje} />;
  if (vista === "errorPerfil") return <PantallaMensaje titulo="Error al cargar tu perfil" mensaje={mensaje} botonTexto="Volver al inicio de sesión" onBoton={function () { setVista("login"); }} />;
  if (vista === "dominio") return <PantallaMensaje titulo="Cuenta no permitida" mensaje={mensaje} botonTexto="Volver al inicio de sesión" onBoton={function () { setVista("login"); }} />;
  if (vista === "inactivo") return <PantallaMensaje titulo="Acceso desactivado" mensaje={mensaje} botonTexto="Volver al inicio de sesión" onBoton={function () { setVista("login"); }} />;
  if (vista === "pendiente") return <PantallaPendiente usuario={usuario} onRevisar={function () { setVista("cargando"); var u = V2.auth.currentUser; if (u) { resolverPerfil(u).then(function (r) { if (r.estado === "ok") { V2.usuario = r.perfil; setUsuarioLocal(r.perfil); setVista("app"); } else { setVista("pendiente"); } }).catch(function () { setVista("pendiente"); }); } else setVista("login"); }} />;
  if (vista === "app") return <Shell usuario={usuario} />;
  return <Login />;
}

ReactDOM.createRoot(document.getElementById("root")).render(<Raiz />);

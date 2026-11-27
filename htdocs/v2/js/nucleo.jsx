// ═══════════════════════════════════════════════════════════════════════════════════════
// NÚCLEO del frontend v2 — lo usan TODAS las pantallas. Contrato en PLAN-V2.md (sección 4).
// Dueño: workstream B (shell). Las demás pantallas lo USAN, no lo editan.
// Reglas de sintaxis (Babel 7.24.7 en el navegador): var + function(){}, SIN ?. ni ??
// ═══════════════════════════════════════════════════════════════════════════════════════
var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef, useMemo = React.useMemo;

var V2 = window.V2 = window.V2 || {};
V2.version = "1";

// ── Configuración ──────────────────────────────────────────────────────────────────────
V2.config = {
  firebase: {
    apiKey: "AIzaSyDfF_nq-LIxj-a-y5gYt1Dm3S3MH88lYyM",
    authDomain: "dasa-calidad.firebaseapp.com",
    projectId: "dasa-calidad",
    storageBucket: "dasa-calidad.firebasestorage.app",
    messagingSenderId: "941746170537",
    appId: "1:941746170537:web:001753bf4bc471cd3e17b8"
  },
  token: "",                  // ya no se usa: el backend pide sesión (/cyc_sesion.jsx)
  audioToken: "",
  // Endpoints: los NUEVOS viven en v2/api/; los que se reusan del backend actual, en la raíz.
  api: {
    buscar: "api/buscar.php",
    catalogo: "api/catalogo.php",
    zip: "api/zip.php",
    transcribir: "../transcribir.php",
    analizar: "../analizar.php",
    audio: "../audio.php"
  },
  // Colecciones de Firestore del v2 (NUEVAS: no tocan las del frontend anterior ni del cron)
  col: {
    metodos: "metodos_analisis",   // métodos de análisis (título + prompt)
    resultados: "analisis_v2",     // un doc por grabación × método: id = <grabacion>__<metodoId>
    usuarios: "usuarios",          // solo lectura (nombres de operadores, perfil del logueado)
    agentesViejos: "agentes_ia",   // solo lectura (importar rúbricas al crear métodos)
    analisisViejos: "analisis_llamadas", // solo lectura (reusar transcripciones ya pagadas)
    accesos: "usuarios_v2",        // perfiles del v2: {email, nombre, role, estado} (los administra el admin)
    invitaciones: "invitaciones_v2", // mails habilitados de antemano por el propietario: id = mail, {role, creadoPor, usadoEn?}
    ingresos: "ingresos_v2",       // registro de ingresos (quién entró y cuándo): solo lo ve el propietario
    parametros: "parametros_cliente" // prompt de análisis por cliente: id = V2.slugCliente(cliente), {cliente, prompt, actualizadoPor, actualizadoEn}
  },
  // Login: entran los mails de este dominio y los que el propietario habilita a mano (Configuración → Usuarios).
  dominio: "dasaargentina.com",
  // Propietarios: rol "owner" (único que ve el registro de ingresos y habilita mails). Se decide por mail, no por Firestore.
  propietarios: ["rfischbock@dasaargentina.com"]
};

// ── Roles y permisos ─────────────────────────────────────────────────────────────────────
// ver = buscar/escuchar/ver scores · analizar = gasta API · descargar = zip de grabaciones
// metodos = crear/editar métodos · usuarios = gestionar accesos. "pendiente" = sin acceso hasta que lo apruebe un admin.
V2.ROLES = {
  owner:      { etiqueta: "Propietario",   permisos: { ver: 1, analizar: 1, descargar: 1, metodos: 1, usuarios: 1, invitar: 1, ingresos: 1, capacitacion: 1 } },
  admin:      { etiqueta: "Administrador", permisos: { ver: 1, analizar: 1, descargar: 1, metodos: 1, usuarios: 1, capacitacion: 1 } },
  supervisor: { etiqueta: "Supervisor",    permisos: { ver: 1, analizar: 1, descargar: 1, capacitacion: 1 } },
  auditor:    { etiqueta: "Auditor",       permisos: { ver: 1, descargar: 1 } }
};
V2.puede = function (permiso) {
  var r = V2.usuario && V2.ROLES[V2.usuario.role];
  return !!(r && r.permisos[permiso]);
};

try {
  if (!firebase.apps.length) firebase.initializeApp(V2.config.firebase);
  V2.db = firebase.firestore();
  V2.auth = firebase.auth();
} catch (e) { V2.errorInicio = "No se pudo iniciar Firebase: " + ((e && e.message) || e); }

// ── Colores / estilos base (paleta DASA, maqueta "A+B · Combinada" aprobada) ─────────────
// Mismos valores que las variables CSS de estilos.css (:root). Mismas claves de siempre +
// las nuevas de la maqueta (verdeMed, tinta3, warnBg, dangerBg, infoBg, ok, okBg).
var C = V2.C = {
  dark: "#1e3320", green: "#437540", verdeMed: "#2d5a2b", light: "#2f8f4e",
  pale: "#e8f1e4", paleB: "#cfe0c7", white: "#ffffff", bg: "#f3f6f1",
  text: "#17241a", muted: "#4d6250", tinta3: "#7b8f7d", border: "#dde7d8",
  warn: "#b7791f", warnBg: "#fbf1dc", danger: "#c0392b", dangerBg: "#fbe9e7",
  info: "#2463a6", infoBg: "#e7f0fa", ok: "#2f8f4e", okBg: "#e6f4ea"
};

// ── Formato ──────────────────────────────────────────────────────────────────────────────
V2.fmtDur = function (seg) { seg = parseInt(seg, 10) || 0; return Math.floor(seg / 60) + ":" + ("0" + (seg % 60)).slice(-2); };
V2.hoy = function () { var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; }; return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };
V2.primeroDeMes = function () { return V2.hoy().slice(0, 8) + "01"; };
V2.fmtFecha = function (iso) { var s = String(iso || ""); return s.length >= 10 ? (s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4)) : "—"; };
V2.scoreColor = function (s) { return s >= 90 ? C.green : s >= 80 ? C.light : s >= 70 ? C.warn : C.danger; };
V2.scoreLabel = function (s) { return s >= 90 ? "Excelente" : s >= 80 ? "Muy bueno" : s >= 70 ? "Bueno" : "Regular"; };
V2.urlAudio = function (grabacion) { return V2.config.api.audio + "?file=" + encodeURIComponent(grabacion) + "&token=" + V2.config.audioToken; };
V2.idResultado = function (grabacion, metodoId) { return String(grabacion) + "__" + String(metodoId); };
// Id estable de un cliente (doc de parametros_cliente y metodoId "param-<slug>" de sus resultados).
V2.slugCliente = function (cliente) {
  return String(cliente || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "sin-cliente";
};
// ── Parámetro de análisis por cliente: tabla de temas + contexto → prompt para la IA ───────
// temas: [{tema, detalle, peso}] · contexto: texto libre que afina el análisis.
// La IA devuelve un criterio por tema con puntaje 100 (cumple) o 0 (no cumple): el % de
// cumplimiento es el promedio ponderado por peso (calcularScore en buscar.jsx).
V2.temasValidos = function (temas) {
  return (temas || []).filter(function (t) { return t && String(t.tema || "").trim(); });
};
V2.armarPromptCliente = function (cliente, temas, contexto) {
  var lista = V2.temasValidos(temas);
  var txt = "Sos auditor de calidad de un call center de cobranzas. Cliente: " + cliente + ".\n\n";
  if (String(contexto || "").trim()) txt += "CONTEXTO DEL CLIENTE Y CRITERIOS PARA AFINAR EL ANÁLISIS:\n" + String(contexto).trim() + "\n\n";
  if (lista.length) {
    txt += "TEMAS QUE HAY QUE REVISAR EN LA LLAMADA (devolvé un criterio por tema, con este mismo nombre y peso, en este orden):\n";
    lista.forEach(function (t, i) {
      txt += (i + 1) + ". " + String(t.tema).trim() + (String(t.detalle || "").trim() ? (": " + String(t.detalle).trim()) : "") + " (peso " + (parseInt(t.peso, 10) > 0 ? parseInt(t.peso, 10) : 1) + ")\n";
    });
    txt += "\nPara cada tema: puntaje 100 si el gestor lo cumple y 0 si no lo cumple (no uses valores intermedios). "
      + "En 'comentario' justificá en una oración, citando entre comillas lo que se dijo en la llamada o aclarando qué faltó. "
      + "En 'analisis' resumí en 2-3 oraciones por qué la llamada obtiene ese nivel de cumplimiento.";
  }
  return txt;
};

// ── Calificación del audio: niveles según el % de cumplimiento de los temas ───────────────
// Se configura en Configuración → Calificación del audio (configuracion/calificacion).
// Cada nivel va desde su "desde" (%) hasta el "desde" del siguiente menos 1.
V2.COLORES_NIVEL = { rojo: "#c0392b", amarillo: "#b7791f", verde: "#2f8f4e", azul: "#2463a6", gris: "#7b8f7d" };
V2.NIVELES_DEFECTO = [
  { nombre: "Malo", desde: 0, color: "rojo" },
  { nombre: "Bueno", desde: 60, color: "amarillo" },
  { nombre: "Muy bueno", desde: 81, color: "verde" }
];
V2.ordenarNiveles = function (niveles) {
  return (niveles && niveles.length ? niveles : V2.NIVELES_DEFECTO).slice().sort(function (a, b) { return (+a.desde || 0) - (+b.desde || 0); });
};
// {nombre, color(hex), desde, hasta} para un % (0-100), o null si no hay score.
V2.calificar = function (score, niveles) {
  if (typeof score !== "number" || isNaN(score)) return null;
  var s = Math.round(score), lista = V2.ordenarNiveles(niveles || V2.niveles), elegido = lista[0];
  lista.forEach(function (n) { if (s >= (+n.desde || 0)) elegido = n; });
  var i = lista.indexOf(elegido), sig = lista[i + 1];
  return { nombre: elegido.nombre, color: V2.COLORES_NIVEL[elegido.color] || elegido.color || V2.C.muted, desde: +elegido.desde || 0, hasta: sig ? (+sig.desde - 1) : 100 };
};
V2.niveles = V2.NIVELES_DEFECTO;
V2._nivSubs = []; V2._nivUnsub = null;
// Hook: niveles vigentes (se escuchan en vivo; un solo listener para toda la app).
V2.useNiveles = function () {
  var st = useState(V2.niveles); var niv = st[0], setNiv = st[1];
  useEffect(function () {
    V2._nivSubs.push(setNiv);
    if (!V2._nivUnsub && V2.db) {
      V2._nivUnsub = V2.db.collection("configuracion").doc("calificacion").onSnapshot(function (d) {
        var x = d && d.exists ? d.data() : null;
        V2.niveles = (x && x.niveles && x.niveles.length) ? x.niveles : V2.NIVELES_DEFECTO;
        V2._nivSubs.forEach(function (f) { f(V2.niveles); });
      }, function () {});
    }
    return function () { V2._nivSubs = V2._nivSubs.filter(function (f) { return f !== setNiv; }); };
  }, []);
  return niv;
};

// Hash corto de un texto (identifica un prompt "a medida": mismo texto = mismos resultados guardados).
V2.hashTexto = function (t) {
  var h = 5381, s = String(t || "");
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

// ── API (POST JSON con token). Devuelve el JSON; lanza Error con mensaje legible si falla. ──
V2.api = function (url, body, timeoutMs) {
  var ctrl = new AbortController();
  var to = setTimeout(function () { ctrl.abort(); }, timeoutMs || 120000);
  return fetch(url, {
    method: "POST", signal: ctrl.signal,
    headers: { "Content-Type": "application/json", "X-DASA-Token": V2.config.token },
    body: JSON.stringify(body || {})
  }).then(function (r) {
    return r.text().then(function (t) {
      var d = null; try { d = JSON.parse(t); } catch (e) {}
      if (!d) throw new Error("Respuesta inválida del servidor (HTTP " + r.status + ")");
      if (d.error) { var err = new Error(d.error); err.codigo = d.codigo || ""; err.datos = d; throw err; }
      return d;
    });
  }).catch(function (e) {
    if (e && e.name === "AbortError") throw new Error("Tardó demasiado en responder. Probá con un rango más chico.");
    throw e;
  }).finally(function () { clearTimeout(to); });
};

// ── Operadores: neotelId → {nombre, cliente}. Lee "usuarios" una vez por sesión. ─────────
V2._opsP = null;
V2.cargarOperadores = function () {
  if (V2._opsP) return V2._opsP;
  V2._opsP = V2.db.collection(V2.config.col.usuarios).get().then(function (sn) {
    var m = {};
    sn.docs.forEach(function (d) { var u = d.data() || {}; var id = String(u.neotelId || "").trim(); if (id) m[id] = { nombre: u.name || u.nombre || u.user || ("Operador " + id), cliente: u.cliente || "" }; });
    return m;
  }).catch(function () { V2._opsP = null; return {}; });
  return V2._opsP;
};
V2.useOperadores = function () {
  var st = useState({}); var mapa = st[0], setMapa = st[1];
  useEffect(function () { var vivo = true; V2.cargarOperadores().then(function (m) { if (vivo) setMapa(m); }); return function () { vivo = false; }; }, []);
  return mapa;
};
V2.nombreOperador = function (mapa, id) { var k = String(id == null ? "" : id).trim(); return (mapa && mapa[k]) ? mapa[k].nombre : (k ? ("Operador " + k) : "—"); };

// ── Registro de pantallas: cada archivo de pantalla se registra acá; la app arma el menú. ──
// V2.registrar({id, titulo, grupo, icono, orden, componente})   grupo: "Calidad de audios" | "Capacitación" | "Configuración"
V2.pantallas = V2.pantallas || [];
// Navegar a otra pantalla llevando datos (ej: Control interno → Buscar con el gestor y el mes cargados).
// La pantalla destino los toma UNA vez al montarse con V2.tomarPedido(id). El shell define V2._navegar.
V2.irA = function (id, datos) { V2.pedidoPantalla = { id: id, datos: datos || null }; if (V2._navegar) V2._navegar(id); };
V2.tomarPedido = function (id) { var p = V2.pedidoPantalla; if (p && p.id === id) { V2.pedidoPantalla = null; return p.datos; } return null; };
V2.registrar = function (p) { V2.pantallas = V2.pantallas.filter(function (x) { return x.id !== p.id; }).concat([p]); };

// ── Componentes base (la app nueva los usa en TODAS las pantallas) ────────────────────────
// Firmas estables: el dueño del núcleo puede mejorar el estilo, NO cambiar las props.
// Estilo: clases CSS de estilos.css (lenguaje visual de la maqueta aprobada), no inline.
V2.Boton = function (props) {
  var tipo = props.tipo || "primario"; // primario | secundario | peligro | link
  var dis = !!props.disabled;
  var claseTipo = tipo === "primario" ? "v2-btn-primario" : tipo === "peligro" ? "v2-btn-peligro" : tipo === "link" ? "v2-btn-link" : "v2-btn-secundario";
  var clase = "v2-btn " + claseTipo + (props.chico ? " v2-btn-chico" : "");
  return <button type={props.submit ? "submit" : "button"} className={clase} title={props.title} disabled={dis} onClick={props.onClick} style={props.style || {}}>{props.children}</button>;
};
V2.Tarjeta = function (props) {
  return <div className="v2-tarjeta" style={props.style || {}}>
    {props.titulo && <div className="v2-tarjeta-titulo">{props.titulo}</div>}
    {props.children}
  </div>;
};
V2.Campo = function (props) { // {etiqueta, children}
  return <label className="v2-campo" style={{ minWidth: props.ancho || 0 }}>
    <span>{props.etiqueta}</span>{props.children}
  </label>;
};
V2.estiloInput = { fontSize: 13, padding: "6px 9px", border: "1px solid " + C.border, borderRadius: 7, background: C.white, color: C.text };
V2.Aviso = function (props) { // {tipo: error|ok|info|alerta, onCerrar, children}
  var t = props.tipo || "info";
  var clase = "v2-aviso v2-aviso-" + (t === "error" ? "error" : t === "ok" ? "ok" : t === "alerta" ? "alerta" : "info");
  return <div className={clase}>
    <span style={{ flex: 1 }}>{props.children}</span>
    {props.onCerrar && <span className="v2-aviso-cerrar" onClick={props.onCerrar}>✕</span>}
  </div>;
};
V2.Chip = function (props) {
  var col = props.color;
  var estilo = col ? { color: col, background: col + "14", borderColor: col + "44" } : {};
  return <span className="v2-chip" data-clickable={props.onClick ? "true" : "false"} title={props.title} onClick={props.onClick} style={estilo}>{props.children}</span>;
};
V2.Cargando = function (props) { return <div className="v2-cargando">⏳ {props.texto || "Cargando…"}</div>; };
V2.Modal = function (props) { // {titulo, onCerrar, ancho, children}
  var cajaRef = useRef(null);
  useEffect(function () {
    var previo = document.activeElement;
    var enfocables = function () {
      var c = cajaRef.current; if (!c) return [];
      return Array.prototype.slice.call(c.querySelectorAll('button, [href], input, select, textarea, audio[controls], [tabindex]:not([tabindex="-1"])'))
        .filter(function (el) { return !el.disabled && el.offsetParent !== null; });
    };
    // Foco inicial dentro del modal y trampa de Tab/Shift+Tab: el teclado no se escapa a la pantalla de atrás.
    var lista = enfocables(); if (lista.length) lista[0].focus(); else if (cajaRef.current) cajaRef.current.focus();
    var f = function (e) {
      if (e.key === "Escape" && props.onCerrar) { props.onCerrar(); return; }
      if (e.key !== "Tab") return;
      var els = enfocables(); if (!els.length) { e.preventDefault(); return; }
      var primero = els[0], ultimo = els[els.length - 1];
      if (e.shiftKey && (document.activeElement === primero || !cajaRef.current.contains(document.activeElement))) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && (document.activeElement === ultimo || !cajaRef.current.contains(document.activeElement))) { e.preventDefault(); primero.focus(); }
    };
    window.addEventListener("keydown", f);
    return function () { window.removeEventListener("keydown", f); if (previo && previo.focus) { try { previo.focus(); } catch (e) {} } };
  }, []);
  return <div className="v2-modal-velo" onClick={props.onCerrar}>
    <div className="v2-modal" ref={cajaRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={typeof props.titulo === "string" ? props.titulo : undefined} onClick={function (e) { e.stopPropagation(); }} style={{ maxWidth: props.ancho || 820 }}>
      <div className="v2-modal-header">
        <div className="v2-modal-titulo">{props.titulo}</div>
        <button type="button" className="v2-modal-cerrar" onClick={props.onCerrar} aria-label="Cerrar">✕</button>
      </div>
      <div className="v2-modal-cuerpo">{props.children}</div>
    </div>
  </div>;
};

// ── Límite de errores: envuelve una pantalla para que un error de React no tumbe toda la app. ──
// Nuevo (no existía en el contrato): sin props además de children; no cambia ningún componente existente.
function ErrorBoundaryV2(props) { React.Component.call(this, props); this.state = { error: null }; }
ErrorBoundaryV2.prototype = Object.create(React.Component.prototype);
ErrorBoundaryV2.prototype.constructor = ErrorBoundaryV2;
ErrorBoundaryV2.getDerivedStateFromError = function (error) { return { error: error }; };
ErrorBoundaryV2.prototype.componentDidCatch = function (error, info) {
  console.error("[V2] Error en pantalla:", error, info && info.componentStack);
};
ErrorBoundaryV2.prototype.render = function () {
  if (this.state.error) {
    var detalle = (this.state.error && (this.state.error.message || String(this.state.error))) || "Error desconocido";
    return <V2.Tarjeta titulo="⚠️ Esta pantalla tuvo un error">
      <V2.Aviso tipo="error">{detalle}</V2.Aviso>
      <V2.Boton onClick={function () { window.location.reload(); }}>Recargar</V2.Boton>
    </V2.Tarjeta>;
  }
  return this.props.children || null;
};
V2.ErrorBoundary = ErrorBoundaryV2;

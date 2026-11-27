// ═══════════════════════════════════════════════════════════════════════════════════════
// PANTALLA "Parámetros de análisis por cliente" (Configuración). 11/2026.
// Un prompt por cliente: es el que usa "Buscar y analizar" cuando se elige
// "Según parámetro del cliente" (cada llamada se analiza con el prompt de SU cliente).
// Firestore: V2.config.col.parametros ("parametros_cliente"), id = V2.slugCliente(cliente).
// Sintaxis: var + function(){}, SIN ?. ni ??  (Babel 7.24.7 en el navegador).
// ═══════════════════════════════════════════════════════════════════════════════════════
(function () {
  // Respaldo si catalogo.php no responde (misma lista que metodos.jsx).
  var CLIENTES_RESPALDO = ["Banco Galicia", "Banco Santander", "QIDA", "Edenor", "Edesur", "AYSA", "CREDIPEXPRESS", "Argenpesos", "Banco Hipotecario"];

  function usuarioActual() {
    if (V2.usuario && V2.usuario.nombre) return V2.usuario.nombre;
    if (V2.auth && V2.auth.currentUser && V2.auth.currentUser.email) return V2.auth.currentUser.email;
    return "—";
  }
  function fmtFechaHora(iso) {
    var s = String(iso || "");
    if (s.length < 10) return "—";
    return V2.fmtFecha(s) + (s.length >= 16 ? (" " + s.slice(11, 16)) : "");
  }

  // ── Editor del prompt de un cliente ──────────────────────────────────────────────────
  function EditorParametro(props) { // {cliente, doc, metodos, onGuardado}
    var base = props.doc || {};
    var stP = useState(base.prompt || ""); var prompt = stP[0], setPrompt = stP[1];
    var stG = useState(false); var guardando = stG[0], setGuardando = stG[1];
    var stM = useState(null); var msg = stM[0], setMsg = stM[1];

    var cambiado = prompt !== (base.prompt || "");
    var metodosCliente = props.metodos.filter(function (m) { return m.cliente === props.cliente; });
    var otrosMetodos = props.metodos.filter(function (m) { return m.cliente !== props.cliente; });

    var cargarDeMetodo = function (id) {
      var m = props.metodos.filter(function (x) { return x.id === id; })[0];
      if (!m) return;
      setPrompt(m.prompt || "");
      setMsg({ tipo: "info", texto: "Se copió el prompt de “" + m.titulo + "”. Revisalo y tocá Guardar." });
    };

    var guardar = function () {
      if (!prompt.trim()) { setMsg({ tipo: "error", texto: "El prompt no puede estar vacío." }); return; }
      setGuardando(true); setMsg(null);
      var datos = { cliente: props.cliente, prompt: prompt, actualizadoPor: usuarioActual(), actualizadoEn: new Date().toISOString() };
      V2.db.collection(V2.config.col.parametros).doc(V2.slugCliente(props.cliente)).set(datos, { merge: true })
        .then(function () { setGuardando(false); setMsg({ tipo: "ok", texto: "Guardado. Desde ahora las llamadas de " + props.cliente + " se analizan con este prompt." }); if (props.onGuardado) props.onGuardado(); })
        .catch(function (e) { setGuardando(false); setMsg({ tipo: "error", texto: "No se pudo guardar: " + ((e && e.message) || e) }); });
    };

    return <V2.Tarjeta titulo={"Parámetro de análisis · " + props.cliente}>
      <div className="v2-sub" style={{ marginBottom: 10, lineHeight: 1.5 }}>
        Escribí las instrucciones para la IA: qué criterios evaluar, cuánto pesa cada uno y qué frases son obligatorias o prohibidas para este cliente.
        Se usan en <b>Buscar y analizar</b> al elegir <b>“Según parámetro del cliente”</b>.
      </div>

      {(metodosCliente.length > 0 || otrosMetodos.length > 0) && <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10, fontSize: 13 }}>
        <label htmlFor="param-copiar" className="v2-sub">Copiar desde un método guardado:</label>
        <select id="param-copiar" value="" onChange={function (e) { cargarDeMetodo(e.target.value); }} style={V2.estiloInput}>
          <option value="">Elegir…</option>
          {metodosCliente.length > 0 && <optgroup label={"De " + props.cliente}>
            {metodosCliente.map(function (m) { return <option key={m.id} value={m.id}>{m.titulo}</option>; })}
          </optgroup>}
          {otrosMetodos.length > 0 && <optgroup label="Otros">
            {otrosMetodos.map(function (m) { return <option key={m.id} value={m.id}>{m.titulo}{m.cliente ? (" (" + m.cliente + ")") : ""}</option>; })}
          </optgroup>}
        </select>
      </div>}

      <textarea id="param-prompt" value={prompt} onChange={function (e) { setPrompt(e.target.value); setMsg(null); }} rows={14}
        placeholder={"Ejemplo:\nSos auditor de calidad de cobranzas para " + props.cliente + ". Evaluá la llamada con estos criterios (peso):\n1. Saludo y presentación (10)\n2. Validación de identidad del titular (15)\n3. Información de la deuda (20)\n4. Negociación y propuesta de pago (25)\n5. Cierre con compromiso concreto (20)\n6. Trato y tono (10)"}
        style={Object.assign({}, V2.estiloInput, { width: "100%", boxSizing: "border-box", fontFamily: "inherit", lineHeight: 1.5, resize: "vertical" })} />

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <V2.Boton onClick={guardar} disabled={guardando || !cambiado}>{guardando ? "Guardando…" : "Guardar"}</V2.Boton>
        {cambiado && !guardando && <V2.Boton tipo="secundario" onClick={function () { setPrompt(base.prompt || ""); setMsg(null); }}>Descartar cambios</V2.Boton>}
        <span className="v2-sub v2-num">{prompt.length} caracteres</span>
        {base.actualizadoEn && <span className="v2-sub" style={{ marginLeft: "auto" }}>Última modificación: {fmtFechaHora(base.actualizadoEn)} · {base.actualizadoPor || "—"}</span>}
      </div>
      {msg && <div style={{ marginTop: 10 }}><V2.Aviso tipo={msg.tipo} onCerrar={function () { setMsg(null); }}>{msg.texto}</V2.Aviso></div>}
    </V2.Tarjeta>;
  }

  // ── Pantalla ─────────────────────────────────────────────────────────────────────────
  function PantallaParametros() {
    var stC = useState(null); var clientes = stC[0], setClientes = stC[1];
    var stD = useState(null); var docs = stD[0], setDocs = stD[1];        // cliente -> doc
    var stMe = useState([]); var metodos = stMe[0], setMetodos = stMe[1];
    var stS = useState(""); var sel = stS[0], setSel = stS[1];
    var stE = useState(""); var err = stE[0], setErr = stE[1];

    useEffect(function () {
      V2.api(V2.config.api.catalogo, { accion: "clientes" })
        .then(function (d) { var l = (d.clientes || []).map(function (c) { return c.cliente; }); setClientes(l.length ? l : CLIENTES_RESPALDO); })
        .catch(function () { setClientes(CLIENTES_RESPALDO); });
      V2.db.collection(V2.config.col.metodos).get()
        .then(function (sn) { setMetodos(sn.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).filter(function (m) { return m.prompt; })
          .sort(function (a, b) { return String(a.titulo || "").localeCompare(String(b.titulo || ""), "es"); })); })
        .catch(function () { setMetodos([]); });
      return V2.db.collection(V2.config.col.parametros).onSnapshot(function (sn) {
        var m = {}; sn.docs.forEach(function (d) { var x = d.data() || {}; if (x.cliente) m[x.cliente] = x; });
        setDocs(m); setErr("");
      }, function (e) { setDocs({}); setErr("No se pudieron cargar los parámetros: " + ((e && e.message) || e)); });
    }, []);

    if (!clientes || !docs) return <V2.Cargando texto="Cargando clientes…" />;

    // Clientes del catálogo + los que ya tienen parámetro guardado aunque no estén en el catálogo.
    var todos = clientes.slice();
    Object.keys(docs).forEach(function (c) { if (todos.indexOf(c) < 0) todos.push(c); });
    var configurados = todos.filter(function (c) { return docs[c] && docs[c].prompt; }).length;

    return <div>
      {err && <V2.Aviso tipo="error">{err}</V2.Aviso>}
      <div className="v2-sub" style={{ marginBottom: 12 }}>
        <b className="v2-num">{configurados}</b> de <b className="v2-num">{todos.length}</b> clientes con parámetro definido. Elegí un cliente en el desplegable para ver o cambiar su prompt.
      </div>

      <V2.Tarjeta style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label htmlFor="param-cliente" style={{ fontWeight: 700, fontSize: 13 }}>Cliente</label>
          <select id="param-cliente" value={sel} onChange={function (e) { setSel(e.target.value); }}
            style={Object.assign({}, V2.estiloInput, { minWidth: 260, maxWidth: "100%", fontSize: 14 })}>
            <option value="">Elegir cliente…</option>
            {todos.map(function (c) {
              var ok = docs[c] && docs[c].prompt;
              return <option key={c} value={c}>{c}{ok ? "" : " · sin parámetro"}</option>;
            })}
          </select>
          {sel && (docs[sel] && docs[sel].prompt
            ? <V2.Chip color={V2.C.ok}>Definido</V2.Chip>
            : <V2.Chip color={V2.C.warn}>Sin parámetro</V2.Chip>)}
        </div>
      </V2.Tarjeta>

      {sel
        ? <EditorParametro key={sel} cliente={sel} doc={docs[sel]} metodos={metodos} />
        : <div className="v2-tarjeta" style={{ textAlign: "center", padding: "36px 20px" }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Elegí un cliente en el desplegable</div>
            <div className="v2-sub">Se abre el prompt con el que la IA analiza sus llamadas.</div>
          </div>}
    </div>;
  }

  V2.registrar({ id: "parametros", titulo: "Parámetros de análisis por cliente", grupo: "Configuración", icono: "🎯", orden: 0, componente: PantallaParametros });
})();

// ═══════════════════════════════════════════════════════════════════════════════════════
// PANTALLA "Parámetros de análisis por cliente" (Configuración). 11/2026.
// Por cliente: tabla de temas a revisar + contexto; con eso se arma el prompt que usa
// "Buscar y analizar" al elegir "Parámetro de análisis por cliente".
// Firestore: V2.config.col.parametros ("parametros_cliente"), id = V2.slugCliente(cliente):
//   {cliente, temas:[{tema, detalle, peso}], contexto, prompt (armado con V2.armarPromptCliente), actualizadoPor, actualizadoEn}
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

  var TEMAS_EJEMPLO = [
    { tema: "Saludo y presentación", detalle: "Se presenta con nombre y dice que llama de DASA en representación del cliente.", peso: 1 },
    { tema: "Validación de identidad", detalle: "Confirma que habla con el titular (nombre completo o DNI) antes de hablar de la deuda.", peso: 1 },
    { tema: "Información de la deuda", detalle: "Informa monto y antigüedad de la deuda de forma clara.", peso: 1 },
    { tema: "Propuesta de pago", detalle: "Ofrece al menos una alternativa de pago concreta (plan, quita o fecha).", peso: 1 },
    { tema: "Cierre con compromiso", detalle: "Cierra con fecha y monto del pago confirmados por el titular.", peso: 1 },
    { tema: "Trato cordial", detalle: "Mantiene un tono respetuoso, sin amenazas ni presión indebida.", peso: 1 }
  ];
  function temaVacio() { return { tema: "", detalle: "", peso: 1 }; }
  function copiaTemas(t) { return (t || []).map(function (x) { return { tema: x.tema || "", detalle: x.detalle || "", peso: parseInt(x.peso, 10) > 0 ? parseInt(x.peso, 10) : 1 }; }); }
  // Docs viejos (solo prompt): el prompt pasa a ser el contexto y la tabla arranca vacía.
  function inicialDe(doc) {
    var d = doc || {};
    var temas = Array.isArray(d.temas) ? copiaTemas(d.temas) : [];
    var contexto = typeof d.contexto === "string" ? d.contexto : (d.temas ? "" : (d.prompt || ""));
    return { temas: temas, contexto: contexto };
  }

  // ── Editor del parámetro de un cliente: tabla de temas + contexto ─────────────────────
  function EditorParametro(props) { // {cliente, doc, metodos}
    var ini = inicialDe(props.doc);
    var stT = useState(ini.temas.length ? ini.temas : [temaVacio()]); var temas = stT[0], setTemas = stT[1];
    var stC = useState(ini.contexto); var contexto = stC[0], setContexto = stC[1];
    var stG = useState(false); var guardando = stG[0], setGuardando = stG[1];
    var stM = useState(null); var msg = stM[0], setMsg = stM[1];
    var base = props.doc || {};

    var validos = V2.temasValidos(temas);
    var firma = function (ts, c) { return JSON.stringify([copiaTemas(V2.temasValidos(ts)), String(c || "").trim()]); };
    var cambiado = firma(temas, contexto) !== firma(ini.temas, ini.contexto);
    var pesoTotal = validos.reduce(function (a, t) { return a + (parseInt(t.peso, 10) > 0 ? parseInt(t.peso, 10) : 1); }, 0);
    var promptFinal = V2.armarPromptCliente(props.cliente, temas, contexto);

    var cambiarTema = function (i, patch) { setMsg(null); setTemas(temas.map(function (t, k) { return k === i ? Object.assign({}, t, patch) : t; })); };
    var quitarTema = function (i) { setMsg(null); var n = temas.filter(function (t, k) { return k !== i; }); setTemas(n.length ? n : [temaVacio()]); };
    var moverTema = function (i, d) { var j = i + d; if (j < 0 || j >= temas.length) return; var n = temas.slice(); var x = n[i]; n[i] = n[j]; n[j] = x; setTemas(n); };

    var metodosCliente = props.metodos.filter(function (m) { return m.cliente === props.cliente; });
    var otrosMetodos = props.metodos.filter(function (m) { return m.cliente !== props.cliente; });
    var cargarDeMetodo = function (id) {
      var m = props.metodos.filter(function (x) { return x.id === id; })[0];
      if (!m) return;
      setContexto(m.prompt || "");
      setMsg({ tipo: "info", texto: "Se copió el texto de “" + m.titulo + "” en el contexto. Pasá a la tabla los temas que tenga y tocá Guardar." });
    };

    var guardar = function () {
      if (!validos.length) { setMsg({ tipo: "error", texto: "Cargá al menos un tema para revisar en la llamada." }); return; }
      setGuardando(true); setMsg(null);
      var datos = { cliente: props.cliente, temas: copiaTemas(validos), contexto: String(contexto || "").trim(), prompt: promptFinal,
        actualizadoPor: usuarioActual(), actualizadoEn: new Date().toISOString() };
      V2.db.collection(V2.config.col.parametros).doc(V2.slugCliente(props.cliente)).set(datos, { merge: true })
        .then(function () { setGuardando(false); setMsg({ tipo: "ok", texto: "Guardado. Las llamadas de " + props.cliente + " se analizan revisando estos " + validos.length + " temas." }); })
        .catch(function (e) { setGuardando(false); setMsg({ tipo: "error", texto: "No se pudo guardar: " + ((e && e.message) || e) }); });
    };

    var celda = { padding: "6px 6px", verticalAlign: "top" };
    var input = Object.assign({}, V2.estiloInput, { width: "100%", boxSizing: "border-box", font: "inherit", fontSize: 13 });

    return <V2.Tarjeta titulo={"Parámetro de análisis · " + props.cliente}>
      <div className="v2-sub" style={{ marginBottom: 12, lineHeight: 1.5 }}>
        <b>1. Temas a revisar:</b> lo que la IA tiene que verificar en cada llamada. Cada tema se marca como cumplido o no, y el % de cumplimiento define la calificación
        (ver <a style={{ cursor: "pointer" }} onClick={function () { V2.irA("calificacion"); }}>Configuración → Calificación del audio</a>).
        <br /><b>2. Contexto:</b> texto libre para que la IA entienda el cliente y afine el criterio.
      </div>

      <div className="v2-tabla-caja" style={{ marginBottom: 8 }}>
        <table className="v2-tabla" style={{ minWidth: 560 }}>
          <thead><tr>
            <th style={{ width: 28 }}>#</th>
            <th style={{ width: "28%" }}>Tema</th>
            <th>Qué revisar en el audio</th>
            <th style={{ width: 70 }} title="Cuánto cuenta este tema en el %. Si todos valen igual, dejá 1.">Peso</th>
            <th style={{ width: 92 }}></th>
          </tr></thead>
          <tbody>
            {temas.map(function (t, i) {
              return <tr key={i}>
                <td style={celda} className="v2-num">{i + 1}</td>
                <td style={celda}><input aria-label={"Tema " + (i + 1)} value={t.tema} placeholder="Ej: Validación de identidad" onChange={function (e) { cambiarTema(i, { tema: e.target.value }); }} style={input} /></td>
                <td style={celda}><textarea aria-label={"Qué revisar, tema " + (i + 1)} value={t.detalle} rows={2} placeholder="Ej: Confirma DNI o nombre completo del titular antes de hablar de la deuda."
                  onChange={function (e) { cambiarTema(i, { detalle: e.target.value }); }} style={Object.assign({}, input, { resize: "vertical", lineHeight: 1.4 })} /></td>
                <td style={celda}><input aria-label={"Peso, tema " + (i + 1)} type="number" min="1" max="100" value={t.peso} onChange={function (e) { cambiarTema(i, { peso: Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1)) }); }} style={input} /></td>
                <td style={Object.assign({}, celda, { whiteSpace: "nowrap" })}>
                  <V2.Boton tipo="link" chico title="Subir" disabled={i === 0} onClick={function () { moverTema(i, -1); }}>↑</V2.Boton>
                  <V2.Boton tipo="link" chico title="Bajar" disabled={i === temas.length - 1} onClick={function () { moverTema(i, 1); }}>↓</V2.Boton>
                  <V2.Boton tipo="link" chico title="Quitar tema" onClick={function () { quitarTema(i); }}>✕</V2.Boton>
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <V2.Boton tipo="secundario" chico onClick={function () { setTemas(temas.concat([temaVacio()])); }}>+ Agregar tema</V2.Boton>
        {!validos.length && <V2.Boton tipo="secundario" chico onClick={function () { setTemas(copiaTemas(TEMAS_EJEMPLO)); setMsg({ tipo: "info", texto: "Se cargaron temas de ejemplo. Adaptalos al cliente y tocá Guardar." }); }}>Cargar temas de ejemplo</V2.Boton>}
        <span className="v2-sub">{validos.length} tema{validos.length === 1 ? "" : "s"}{validos.length ? (" · cada uno vale " + (pesoTotal === validos.length ? "lo mismo" : "según su peso (total " + pesoTotal + ")")) : ""}</span>
      </div>

      <label htmlFor="param-contexto" style={{ display: "block", fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Contexto para afinar el análisis</label>
      {(metodosCliente.length > 0 || otrosMetodos.length > 0) && <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6, fontSize: 13 }}>
        <label htmlFor="param-copiar" className="v2-sub">Copiar de un método anterior:</label>
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
      <textarea id="param-contexto" value={contexto} onChange={function (e) { setContexto(e.target.value); setMsg(null); }} rows={5}
        placeholder={"Ejemplo: " + props.cliente + " es una cartera de mora temprana. El gestor debe ofrecer primero el pago total y recién después un plan en cuotas. No se considera cierre si el titular dice \"veo\" o \"te aviso\"."}
        style={Object.assign({}, V2.estiloInput, { width: "100%", boxSizing: "border-box", fontFamily: "inherit", lineHeight: 1.5, resize: "vertical" })} />

      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, color: V2.C.info, fontWeight: 600 }}>Ver el prompt que recibe la IA</summary>
        <div style={{ fontSize: 12, lineHeight: 1.55, marginTop: 6, background: V2.C.bg, borderRadius: 8, padding: "10px 12px", whiteSpace: "pre-wrap", maxHeight: 260, overflowY: "auto" }}>{promptFinal}</div>
      </details>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
        <V2.Boton onClick={guardar} disabled={guardando || !cambiado}>{guardando ? "Guardando…" : "Guardar"}</V2.Boton>
        {cambiado && !guardando && <V2.Boton tipo="secundario" onClick={function () { setTemas(ini.temas.length ? ini.temas : [temaVacio()]); setContexto(ini.contexto); setMsg(null); }}>Descartar cambios</V2.Boton>}
        {base.actualizadoEn && <span className="v2-sub" style={{ marginLeft: "auto" }}>Última modificación: {fmtFechaHora(base.actualizadoEn)} · {base.actualizadoPor || "—"}</span>}
      </div>
      {base.prompt && !Array.isArray(base.temas) && <div style={{ marginTop: 10 }}><V2.Aviso tipo="alerta">Este cliente tenía solo un prompt de texto: quedó en el contexto. Cargá los temas en la tabla para que la calificación use el % de cumplimiento.</V2.Aviso></div>}
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
        <b className="v2-num">{configurados}</b> de <b className="v2-num">{todos.length}</b> clientes con parámetro definido. Elegí un cliente para ver o cambiar los temas que se revisan en sus llamadas.
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
            <div className="v2-sub">Se abre la tabla de temas y el contexto con los que la IA analiza sus llamadas.</div>
          </div>}
    </div>;
  }

  V2.registrar({ id: "parametros", titulo: "Parámetros de análisis por cliente", grupo: "Configuración", icono: "🎯", orden: 0, componente: PantallaParametros });
})();

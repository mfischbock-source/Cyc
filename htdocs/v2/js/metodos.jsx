// ═══════════════════════════════════════════════════════════════════════════════════════
// PANTALLA "Métodos de análisis" (Configuración) — dueño: workstream D. Contrato: PLAN-V2.md sec. 4.
// Firestore: V2.config.col.metodos ("metodos_analisis"). Solo lectura: V2.config.col.agentesViejos ("agentes_ia").
// ═══════════════════════════════════════════════════════════════════════════════════════
(function () {

  var CLIENTES = ["Banco Galicia", "Banco Santander", "QIDA", "Edenor", "Edesur", "AYSA", "CREDIPEXPRESS", "Argenpesos", "Banco Hipotecario"];

  function usuarioActual() {
    if (V2.usuario && V2.usuario.nombre) return V2.usuario.nombre;
    if (V2.auth && V2.auth.currentUser && V2.auth.currentUser.email) return V2.auth.currentUser.email;
    return "—";
  }

  // Id nuevo para un doc de metodos_analisis. En modo prueba (window.__V2_PREFIJO_PRUEBA) el id
  // arranca con ese prefijo, para poder identificar y borrar después todo lo creado en una prueba.
  function nuevoId() {
    var base = V2.db.collection(V2.config.col.metodos).doc().id;
    var pref = window.__V2_PREFIJO_PRUEBA || "";
    return pref ? (pref + base) : base;
  }

  function tituloNormalizado(t) { return String(t || "").trim().toLowerCase(); }

  function fmtFechaHora(iso) {
    var s = String(iso || "");
    if (s.length < 10) return "—";
    var hora = s.length >= 16 ? s.slice(11, 16) : "";
    return hora ? (V2.fmtFecha(s) + " " + hora) : V2.fmtFecha(s);
  }

  // ── Switch on/off (no hay uno genérico en el núcleo: clase propia, scope .v2m-switch) ──
  function Switch(props) { // {activo, onClick, disabled, title}
    var activo = !!props.activo, dis = !!props.disabled;
    return <div className={"v2m-switch " + (activo ? "on" : "off")} data-disabled={dis ? "true" : "false"}
      onClick={dis ? undefined : props.onClick} title={props.title || (activo ? "Click para desactivar" : "Click para activar")}>
      <div className="bola" />
    </div>;
  }

  // ── Modal crear / editar ───────────────────────────────────────────────────────────────
  function ModalMetodo(props) { // {existente: doc|null, lista, onCerrar, onGuardado}
    var editando = !!props.existente;
    var base = props.existente || {};
    var st1 = useState(base.titulo || ""); var titulo = st1[0], setTitulo = st1[1];
    var st2 = useState(base.descripcion || ""); var descripcion = st2[0], setDescripcion = st2[1];
    var st3 = useState(base.cliente || ""); var cliente = st3[0], setCliente = st3[1];
    var st4 = useState(base.prompt || ""); var prompt = st4[0], setPrompt = st4[1];
    var st5 = useState(base.activo !== false); var activo = st5[0], setActivo = st5[1]; // default activo al crear
    var st6 = useState(""); var error = st6[0], setError = st6[1];
    var st7 = useState(false); var guardando = st7[0], setGuardando = st7[1];

    function validar() {
      var t = titulo.trim();
      if (!t) return "El título es obligatorio.";
      if (!prompt.trim()) return "El prompt no puede estar vacío.";
      var dup = (props.lista || []).some(function (m) { return m.id !== base.id && tituloNormalizado(m.titulo) === tituloNormalizado(t); });
      if (dup) return "Ya existe un método con ese título.";
      return "";
    }

    function guardar() {
      var err = validar();
      if (err) { setError(err); return; }
      setError(""); setGuardando(true);
      var ahora = new Date().toISOString();
      var quien = usuarioActual();
      var datos = { titulo: titulo.trim(), descripcion: descripcion.trim(), cliente: cliente, prompt: prompt, activo: activo, actualizadoPor: quien, actualizadoEn: ahora };
      var promesa;
      if (editando) {
        promesa = V2.db.collection(V2.config.col.metodos).doc(base.id).set(datos, { merge: true });
      } else {
        datos.creadoPor = quien; datos.creadoEn = ahora;
        promesa = V2.db.collection(V2.config.col.metodos).doc(nuevoId()).set(datos);
      }
      promesa.then(function () { setGuardando(false); props.onGuardado(); })
        .catch(function (e) { setGuardando(false); setError("No se pudo guardar: " + ((e && e.message) || e)); });
    }

    return <V2.Modal titulo={editando ? "Editar método" : "Nuevo método de análisis"} onCerrar={props.onCerrar} ancho={680}>
      {error && <V2.Aviso tipo="error" onCerrar={function () { setError(""); }}>{error}</V2.Aviso>}
      <V2.Aviso tipo="info">
        💡 El prompt tiene que decir QUÉ evaluar (criterios con su peso) y QUÉ devolver (score 0-100 o escala del banco 1-2-3).
        Para Banco Santander el sistema siempre evalúa los 11 lineamientos oficiales.
      </V2.Aviso>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <V2.Campo etiqueta="Título *">
          <input value={titulo} onChange={function (e) { setTitulo(e.target.value); }} placeholder="ej: Banco Santander" style={{ width: "100%" }} />
        </V2.Campo>
        <V2.Campo etiqueta="Cliente por defecto">
          <select value={cliente} onChange={function (e) { setCliente(e.target.value); }} style={{ width: "100%" }}>
            <option value="">Cualquiera</option>
            {CLIENTES.map(function (c) { return <option key={c} value={c}>{c}</option>; })}
          </select>
        </V2.Campo>
      </div>
      <V2.Campo etiqueta="Descripción corta">
        <input value={descripcion} onChange={function (e) { setDescripcion(e.target.value); }} placeholder="Para qué se usa este método" style={{ width: "100%" }} />
      </V2.Campo>
      <V2.Campo etiqueta={"Prompt * (" + prompt.length + " caracteres)"}>
        <textarea value={prompt} onChange={function (e) { setPrompt(e.target.value); }} rows={16}
          style={{ width: "100%", fontFamily: "var(--mono)", lineHeight: 1.6, resize: "vertical" }} />
      </V2.Campo>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={activo} onChange={function (e) { setActivo(e.target.checked); }} /> Activo (aparece en el desplegable de Buscar y analizar)
      </label>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, borderTop: "1px solid var(--linea)", paddingTop: 14 }}>
        <V2.Boton tipo="secundario" onClick={props.onCerrar} disabled={guardando}>Cancelar</V2.Boton>
        <V2.Boton tipo="primario" onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</V2.Boton>
      </div>
    </V2.Modal>;
  }

  // ── Modal confirmar borrado (inline, nunca window.confirm) ────────────────────────────
  function ModalBorrar(props) { // {metodo, onCerrar, onConfirmado}
    var st1 = useState(false); var borrando = st1[0], setBorrando = st1[1];
    var st2 = useState(""); var error = st2[0], setError = st2[1];
    function confirmar() {
      setBorrando(true); setError("");
      V2.db.collection(V2.config.col.metodos).doc(props.metodo.id).delete()
        .then(function () { setBorrando(false); props.onConfirmado(); })
        .catch(function (e) { setBorrando(false); setError("No se pudo eliminar: " + ((e && e.message) || e)); });
    }
    return <V2.Modal titulo="Eliminar método" onCerrar={props.onCerrar} ancho={460}>
      {error && <V2.Aviso tipo="error">{error}</V2.Aviso>}
      <div>¿Eliminar "{props.metodo.titulo}"? Los análisis ya hechos con este método se conservan.</div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <V2.Boton tipo="secundario" onClick={props.onCerrar} disabled={borrando}>Cancelar</V2.Boton>
        <V2.Boton tipo="peligro" onClick={confirmar} disabled={borrando}>{borrando ? "Eliminando…" : "Eliminar"}</V2.Boton>
      </div>
    </V2.Modal>;
  }

  // ── Pantalla principal ─────────────────────────────────────────────────────────────────
  function PantallaMetodos() {
    var st1 = useState(null); var lista = st1[0], setLista = st1[1]; // null = cargando
    var st2 = useState(""); var errorCarga = st2[0], setErrorCarga = st2[1];
    var st3 = useState(""); var busqueda = st3[0], setBusqueda = st3[1];
    var st4 = useState(null); var modal = st4[0], setModal = st4[1]; // {tipo:"crear"|"editar", metodo}
    var st5 = useState(null); var borrarMetodo = st5[0], setBorrarMetodo = st5[1];
    var st6 = useState({}); var accionEnCurso = st6[0], setAccionEnCurso = st6[1]; // id -> true
    var st7 = useState({}); var accionError = st7[0], setAccionError = st7[1]; // id -> mensaje
    var st8 = useState(false); var importando = st8[0], setImportando = st8[1];
    var st9 = useState(null); var resultadoImportar = st9[0], setResultadoImportar = st9[1];
    var st10 = useState(""); var errorImportar = st10[0], setErrorImportar = st10[1];

    useEffect(function () {
      var unsub = V2.db.collection(V2.config.col.metodos).onSnapshot(function (snap) {
        var arr = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
        setLista(arr); setErrorCarga("");
      }, function (e) {
        setLista([]); setErrorCarga("No se pudieron cargar los métodos: " + ((e && e.message) || e));
      });
      return function () { unsub(); };
    }, []);

    function quitar(mapa, id) { var n = Object.assign({}, mapa); delete n[id]; return n; }

    function marcarAccion(id, fn) {
      setAccionEnCurso(function (p) { var n = Object.assign({}, p); n[id] = true; return n; });
      setAccionError(function (p) { return quitar(p, id); });
      fn().then(function () {
        setAccionEnCurso(function (p) { return quitar(p, id); });
      }).catch(function (e) {
        setAccionEnCurso(function (p) { return quitar(p, id); });
        setAccionError(function (p) { var n = Object.assign({}, p); n[id] = (e && e.message) || String(e); return n; });
      });
    }

    function toggleActivo(m) {
      marcarAccion(m.id, function () {
        return V2.db.collection(V2.config.col.metodos).doc(m.id).set({ activo: !m.activo, actualizadoPor: usuarioActual(), actualizadoEn: new Date().toISOString() }, { merge: true });
      });
    }

    function duplicar(m) {
      marcarAccion(m.id, function () {
        var ahora = new Date().toISOString(); var quien = usuarioActual();
        return V2.db.collection(V2.config.col.metodos).doc(nuevoId()).set({
          titulo: "Copia de " + m.titulo, descripcion: m.descripcion || "", cliente: m.cliente || "", prompt: m.prompt || "",
          activo: false, creadoPor: quien, creadoEn: ahora, actualizadoPor: quien, actualizadoEn: ahora
        });
      });
    }

    // Importa, de agentes_ia (solo lectura), un método titulado con el nombre del cliente por cada agente con
    // prompt no vacío que todavía no tenga un método con origenAgenteId == su id.
    function importar() {
      setImportando(true); setErrorImportar(""); setResultadoImportar(null);
      V2.db.collection(V2.config.col.agentesViejos).get().then(function (snap) {
        var importados = 0, yaExistian = 0, sinPrompt = 0;
        var batch = V2.db.batch(); var quien = usuarioActual(); var ahora = new Date().toISOString();
        snap.docs.forEach(function (d) {
          var data = d.data() || {}; var agenteId = d.id; var nombre = data.nombre || ("Agente " + agenteId);
          var prompt = String(data.prompt || "");
          if (!prompt.trim()) { sinPrompt++; return; }
          var yaImportado = (lista || []).some(function (x) { return x.origenAgenteId === agenteId; });
          if (yaImportado) { yaExistian++; return; }
          var ref = V2.db.collection(V2.config.col.metodos).doc(nuevoId());
          batch.set(ref, {
            titulo: nombre, descripcion: "Importado de la configuración anterior de rúbricas.",
            cliente: nombre, prompt: prompt, activo: true, origenAgenteId: agenteId,
            creadoPor: quien, creadoEn: ahora, actualizadoPor: quien, actualizadoEn: ahora
          });
          importados++;
        });
        if (importados === 0) { setImportando(false); setResultadoImportar({ n: 0, m: yaExistian, k: sinPrompt }); return; }
        batch.commit().then(function () {
          setImportando(false); setResultadoImportar({ n: importados, m: yaExistian, k: sinPrompt });
        }).catch(function (e) {
          setImportando(false); setErrorImportar("No se pudo importar: " + ((e && e.message) || e));
        });
      }).catch(function (e) {
        setImportando(false); setErrorImportar("No se pudieron leer las rúbricas actuales: " + ((e && e.message) || e));
      });
    }

    var cargando = lista === null;
    var total = (lista || []).length;
    var activos = (lista || []).filter(function (x) { return x.activo; }).length;
    var filtro = busqueda.trim().toLowerCase();
    var visibles = (lista || []).filter(function (m) { return !filtro || String(m.titulo || "").toLowerCase().indexOf(filtro) !== -1; })
      .sort(function (a, b) {
        if (!!a.activo !== !!b.activo) return a.activo ? -1 : 1;
        return String(a.titulo || "").localeCompare(String(b.titulo || ""), "es");
      });

    return <div>
      <style>{".v2m-switch{width:38px;height:20px;border-radius:20px;position:relative;flex-shrink:0;cursor:pointer;transition:background .15s}.v2m-switch.on{background:var(--verde)}.v2m-switch.off{background:#c9d4c5}.v2m-switch[data-disabled=\"true\"]{cursor:not-allowed;opacity:.6}.v2m-switch .bola{position:absolute;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:left .12s}.v2m-switch.on .bola{left:20px}.v2m-switch.off .bola{left:2px}"}</style>

      {errorCarga && <V2.Aviso tipo="error">{errorCarga}</V2.Aviso>}
      {errorImportar && <V2.Aviso tipo="error" onCerrar={function () { setErrorImportar(""); }}>{errorImportar}</V2.Aviso>}
      {resultadoImportar && <V2.Aviso tipo={resultadoImportar.n ? "ok" : "info"} onCerrar={function () { setResultadoImportar(null); }}>
        Se importaron {resultadoImportar.n} · {resultadoImportar.m} ya existían · {resultadoImportar.k} sin prompt
      </V2.Aviso>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <span className="v2-sub">
          {cargando ? "Cargando…" : <span><b className="v2-num">{total}</b> en total · <b className="v2-num">{activos}</b> activo{activos === 1 ? "" : "s"}{filtro ? (" · mostrando " + visibles.length) : ""}</span>}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <V2.Boton tipo="secundario" onClick={importar} disabled={importando}>{importando ? "Importando…" : "⇩ Importar rúbricas actuales"}</V2.Boton>
          <V2.Boton tipo="primario" onClick={function () { setModal({ tipo: "crear" }); }}>+ Nuevo método</V2.Boton>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <input value={busqueda} onChange={function (e) { setBusqueda(e.target.value); }} placeholder="Buscar por título…"
          style={Object.assign({}, V2.estiloInput, { width: "100%", maxWidth: 320 })} />
      </div>

      {cargando && <V2.Cargando texto="Cargando métodos…" />}

      {!cargando && total === 0 && !errorCarga && <div style={{ textAlign: "center", padding: "40px 20px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Todavía no hay métodos</div>
        <div className="v2-sub" style={{ marginBottom: 16 }}>Importá las rúbricas actuales o creá uno.</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <V2.Boton tipo="secundario" onClick={importar} disabled={importando}>{importando ? "Importando…" : "⇩ Importar rúbricas actuales"}</V2.Boton>
          <V2.Boton tipo="primario" onClick={function () { setModal({ tipo: "crear" }); }}>+ Crear método</V2.Boton>
        </div>
      </div>}

      {!cargando && total > 0 && visibles.length === 0 && <div className="v2-sub" style={{ padding: 20 }}>Ningún método coincide con "{busqueda}".</div>}

      {!cargando && visibles.length > 0 && <div className="v2-tabla-caja">
        <table className="v2-tabla v2-tarjetas">
          <thead>
            <tr>
              <th>Método</th>
              <th>Cliente</th>
              <th>Prompt</th>
              <th>Última modificación</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibles.map(function (m) {
              var enCurso = !!accionEnCurso[m.id];
              return <React.Fragment key={m.id}>
                <tr className={m.activo ? "" : "v2-fila-sin"}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{m.titulo}</div>
                    {m.descripcion && <span className="v2-sub">{m.descripcion}</span>}
                    {m.origenAgenteId && <div style={{ marginTop: 4 }}><V2.Chip color={V2.C.info}>Importado</V2.Chip></div>}
                  </td>
                  <td data-label="Cliente"><V2.Chip>{m.cliente || "Cualquiera"}</V2.Chip></td>
                  <td data-label="Prompt" className="v2-num">{String(m.prompt || "").length} caracteres</td>
                  <td data-label="Modificado">{fmtFechaHora(m.actualizadoEn)}<span className="v2-sub">{m.actualizadoPor || "—"}</span></td>
                  <td data-label="Estado"><Switch activo={!!m.activo} disabled={enCurso} onClick={function () { toggleActivo(m); }} /></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <V2.Boton tipo="link" chico onClick={function () { setModal({ tipo: "editar", metodo: m }); }}>Editar</V2.Boton>{" · "}
                    <V2.Boton tipo="link" chico onClick={function () { duplicar(m); }} disabled={enCurso}>Duplicar</V2.Boton>{" · "}
                    <V2.Boton tipo="link" chico onClick={function () { setBorrarMetodo(m); }}>Eliminar</V2.Boton>
                  </td>
                </tr>
                {accionError[m.id] && <tr><td colSpan={6} style={{ padding: "0 10px 10px" }}>
                  <V2.Aviso tipo="error" onCerrar={function () { setAccionError(function (p) { return quitar(p, m.id); }); }}>{accionError[m.id]}</V2.Aviso>
                </td></tr>}
              </React.Fragment>;
            })}
          </tbody>
        </table>
      </div>}

      {modal && <ModalMetodo existente={modal.tipo === "editar" ? modal.metodo : null} lista={lista || []}
        onCerrar={function () { setModal(null); }} onGuardado={function () { setModal(null); }} />}

      {borrarMetodo && <ModalBorrar metodo={borrarMetodo} onCerrar={function () { setBorrarMetodo(null); }} onConfirmado={function () { setBorrarMetodo(null); }} />}
    </div>;
  }

  V2.registrar({ id: "metodos", titulo: "Métodos de análisis", grupo: "Configuración", icono: "🧪", orden: 1, componente: PantallaMetodos });
})();

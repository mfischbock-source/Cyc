// PANTALLA "Buscar y analizar" — dueño: workstream C. Contrato: PLAN-V2.md secciones 3 y 4.
// Diseño: maqueta aprobada "A + B · Combinada" (vistaD) — clases de estilos.css + V2.C para lo inline.
// Sintaxis: var + function(){}, SIN ?. ni ??  (Babel 7.24.7 en el navegador).
(function () {
  var LS_METODO = "dasa_v2_buscar_metodo";
  var LS_PROMPT_MEDIDA = "dasa_v2_buscar_prompt_medida";
  // Opciones especiales del selector de método (no son docs de metodos_analisis).
  var MODO_CLIENTE = "__cliente";   // prompt de parametros_cliente según el cliente de cada llamada
  var MODO_MEDIDA = "__medida";     // prompt escrito en el momento
  var POR_PAGINA = 100;
  var NOTA_LABEL = { 1: "Deficiente", 2: "Regular", 3: "Bueno" };

  // ── Helpers puros (probados contra la lógica del frontend viejo) ───────────────────────
  function parseNumerosMasivo(texto) {
    var tokens = String(texto || "").split(/[\s,;]+/);
    var out = [], vistos = {};
    tokens.forEach(function (t) {
      var d = String(t == null ? "" : t).replace(/\D/g, "");
      if (d.length >= 4 && d.length <= 13 && !vistos[d]) { vistos[d] = 1; out.push(d); }
    });
    return out.slice(0, 300);
  }
  function diffDias(desde, hasta) {
    var a = new Date(desde + "T12:00:00"), b = new Date(hasta + "T12:00:00");
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }
  function fmtFechaHora(inicio) {
    var s = String(inicio || "");
    if (s.length < 16) return s || "—";
    return s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) + " " + s.slice(11, 16);
  }
  function esReciente24h(inicio) {
    var t = new Date(String(inicio || "").replace(" ", "T")).getTime();
    if (isNaN(t)) return false;
    return (Date.now() - t) < 24 * 3600 * 1000;
  }
  // Score = Σ peso·nota/3 ÷ Σ peso de los que aplican (escala 1-3) · promedio ponderado de puntajes 0-100 (escala 100).
  function calcularScore(an) {
    var cr = Array.isArray(an && an.criterios) ? an.criterios : [];
    var escala13 = an && an.escala === "1-3";
    var sp = 0, sw = 0;
    cr.forEach(function (c) {
      if (!c || c.aplica === false || typeof c.peso !== "number") return;
      if (escala13 && typeof c.nota === "number") { sp += c.peso * c.nota / 3; sw += c.peso; }
      else if (!escala13 && typeof c.puntaje === "number") { sp += c.peso * c.puntaje / 100; sw += c.peso; }
    });
    if (!sw) return null;
    return Math.round(sp / sw * 10000) / 100;
  }
  function normNombreArchivo(nombre) { return /\.(xlsx|xls)$/i.test(String(nombre || "").toLowerCase()); }
  function leerArchivoNumeros(file, cb) {
    if (!file) return;
    var esExcel = normNombreArchivo(file.name);
    var terminar = function (nums) {
      if (!nums.length) { cb(null, "⚠️ No se encontraron números válidos (4 a 13 dígitos) en el archivo."); return; }
      var extra = nums.length > 300 ? " · se usan los primeros 300" : "";
      cb(nums.slice(0, 300).join("\n"), "✓ " + nums.length + " número" + (nums.length === 1 ? "" : "s") + " cargado" + (nums.length === 1 ? "" : "s") + " desde " + (file.name || "archivo") + extra + ".");
    };
    var reader = new FileReader();
    reader.onerror = function () { cb(null, "⚠️ No se pudo leer el archivo."); };
    if (esExcel) {
      if (!window.XLSX) { cb(null, "⚠️ No se pudo cargar el lector de Excel (revisá la conexión)."); return; }
      reader.onload = function (ev) {
        try {
          var wb = window.XLSX.read(new Uint8Array(ev.target.result), { type: "array" });
          var tokens = [];
          wb.SheetNames.forEach(function (sn) {
            var arr = window.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: "", blankrows: false });
            arr.forEach(function (fila) { (fila || []).forEach(function (celda) { tokens.push(celda); }); });
          });
          terminar(parseNumerosMasivo(tokens.join(" ")));
        } catch (e) { cb(null, "⚠️ No se pudo leer el Excel: " + ((e && e.message) || e)); }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = function (ev) { terminar(parseNumerosMasivo(String(ev.target.result || ""))); };
      reader.readAsText(file);
    }
  }
  function filtrosIniciales() {
    return { desde: V2.primeroDeMes(), hasta: V2.hoy(), clientes: [], crms: [], tipifs: [], buscarAlguien: "", deudor: "" };
  }
  // Carteras disponibles para el panel: si hay clientes tildados, solo las suyas; si no, todas (con su cliente dueño).
  function carterasDisponibles(catalogo, clientesSel) {
    var fuente = clientesSel.length ? catalogo.filter(function (c) { return clientesSel.indexOf(c.cliente) >= 0; }) : catalogo;
    var out = [];
    fuente.forEach(function (c) { (c.carteras || []).forEach(function (ct) { out.push({ crm: ct.crm, nombre: ct.nombre, cliente: c.cliente }); }); });
    return out;
  }
  // Bracket visual (maqueta): ok >=80 · av (aviso) >=70 · mal <70 · na = no evaluable.
  // Calificación según la escala de Configuración → Calificación del audio (V2.calificar en nucleo.jsx).
  function claseScore(r) {
    if (!r || r.es_valida === false || typeof r.score !== "number") return "v2-score v2-score-na";
    return "v2-score";
  }
  function estiloNivel(score) {
    var n = V2.calificar(score);
    return n ? { background: n.color + "14", color: n.color, borderColor: n.color + "55" } : {};
  }
  function colorScore(s) { var n = V2.calificar(s); return n ? n.color : V2.C.muted; }
  function nombreNivel(s) { var n = V2.calificar(s); return n ? n.nombre : "Sin calificación"; }
  // ¿Los criterios vienen como cumple / no cumple (100 / 0)? (parámetros con tabla de temas)
  function esBinario(an) {
    var cr = Array.isArray(an && an.criterios) ? an.criterios : [];
    return cr.length > 0 && cr.every(function (c) { return !c || c.aplica === false || c.puntaje === 0 || c.puntaje === 100; });
  }

  // ═══════════════════════════ Sub-componentes de filtros ═══════════════════════════════

  function ListaConTilde(props) { // {items:[{key,label,count}], seleccion:[key], onChange, vacio}
    var items = props.items || [], sel = props.seleccion || [];
    var toggle = function (k) { var n = sel.indexOf(k) >= 0 ? sel.filter(function (x) { return x !== k; }) : sel.concat([k]); props.onChange(n); };
    if (!items.length) return <div className="v2-sub">{props.vacio || "Sin opciones."}</div>;
    return <div className="v2-facetas-lista" style={props.maxH ? { maxHeight: props.maxH, overflowY: "auto" } : {}}>
      {items.map(function (it) {
        var on = sel.indexOf(it.key) >= 0;
        return <label key={it.key} style={on ? { background: V2.C.pale, borderRadius: 6 } : {}}>
          <span><input type="checkbox" checked={on} onChange={function () { toggle(it.key); }} style={{ marginRight: 6, accentColor: V2.C.green }} />{it.label}</span>
          {typeof it.count === "number" && <span>{it.count}</span>}
        </label>;
      })}
    </div>;
  }

  // Desplegable con tildes (varios a la vez). Se cierra con click afuera o Escape.
  function DesplegableMulti(props) { // {id, items:[{key,label,count}], seleccion:[key], onChange, todos, vacio}
    var stA = useState(false); var abierto = stA[0], setAbierto = stA[1];
    var cajaRef = useRef(null);
    useEffect(function () {
      if (!abierto) return;
      var fuera = function (e) { if (cajaRef.current && !cajaRef.current.contains(e.target)) setAbierto(false); };
      var esc = function (e) { if (e.key === "Escape") setAbierto(false); };
      document.addEventListener("mousedown", fuera); document.addEventListener("keydown", esc);
      return function () { document.removeEventListener("mousedown", fuera); document.removeEventListener("keydown", esc); };
    }, [abierto]);
    var sel = props.seleccion || [], items = props.items || [];
    var texto = !items.length ? (props.vacio || "Sin opciones")
      : !sel.length ? (props.todos || "Todos")
      : sel.length === 1 ? sel[0]
      : (sel.length + " seleccionados");
    return <div ref={cajaRef} style={{ position: "relative", marginTop: 6 }}>
      <button type="button" id={props.id} aria-haspopup="listbox" aria-expanded={abierto} disabled={!items.length}
        onClick={function () { setAbierto(!abierto); }}
        style={Object.assign({}, V2.estiloInput, { width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: items.length ? "pointer" : "default", textAlign: "left", font: "inherit", fontSize: 13 })}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: sel.length ? 600 : 400 }}>{texto}</span>
        <span aria-hidden="true" style={{ fontSize: 10, color: V2.C.muted }}>{abierto ? "▲" : "▼"}</span>
      </button>
      {abierto && <div role="listbox" aria-multiselectable="true"
        style={{ position: "absolute", zIndex: 20, left: 0, right: 0, top: "calc(100% + 4px)", background: V2.C.white, border: "1px solid " + V2.C.border, borderRadius: 8, boxShadow: "0 6px 18px rgba(0,0,0,.12)", padding: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, marginBottom: 6 }}>
          <a style={{ cursor: "pointer" }} onClick={function () { props.onChange(items.map(function (it) { return it.key; })); }}>Marcar todos</a>
          <a style={{ cursor: "pointer" }} onClick={function () { props.onChange([]); }}>Ninguno</a>
        </div>
        <ListaConTilde maxH={280} items={items} seleccion={sel} onChange={props.onChange} />
      </div>}
    </div>;
  }

  function PanelFiltros(props) {
    var f = props.filtros, setF = props.setFiltros;
    var clientesItems = (props.catalogo || []).map(function (c) { return { key: c.cliente, label: c.cliente, count: props.conteosClientes ? props.conteosClientes[c.cliente] : undefined }; });
    var stTipifQ = useState(""); var tipifQ = stTipifQ[0], setTipifQ = stTipifQ[1];
    var tipifqn = tipifQ.trim().toLowerCase();
    var tipifItems = (props.tipifsCat || []).filter(function (o) { return !tipifqn || String(o.tipif || "").toLowerCase().indexOf(tipifqn) >= 0; })
      .map(function (o) { return { key: o.tipif, label: o.tipif, count: o.cantidad }; });
    var stMasivoAbierto = useState(false); var masivoAbierto = stMasivoAbierto[0], setMasivoAbierto = stMasivoAbierto[1];
    var fileRef = useRef(null);
    var errDias = diffDias(f.desde, f.hasta) > 45 ? ("El rango no puede superar 45 días (hoy: " + diffDias(f.desde, f.hasta) + ").") : "";
    var errDeudor = f.deudor && f.deudor.trim().length > 0 && f.deudor.trim().length < 3 ? "El nombre del deudor necesita al menos 3 letras." : "";

    return <aside className="v2-facetas" aria-label="Filtros">
      <div>
        <h3>Período</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
          <V2.Campo etiqueta="Desde"><input type="date" value={f.desde} max={f.hasta} onChange={function (e) { setF(Object.assign({}, f, { desde: e.target.value })); }} /></V2.Campo>
          <V2.Campo etiqueta="Hasta"><input type="date" value={f.hasta} min={f.desde} onChange={function (e) { setF(Object.assign({}, f, { hasta: e.target.value })); }} /></V2.Campo>
        </div>
        {errDias && <V2.Aviso tipo="error">{errDias}</V2.Aviso>}
      </div>

      <div>
        <h3><label htmlFor="buscar-clientes">Cliente</label></h3>
        <DesplegableMulti id="buscar-clientes" items={clientesItems} seleccion={f.clientes} todos="Todos los clientes" vacio="Cargando clientes…"
          onChange={function (n) { setF(Object.assign({}, f, { clientes: n })); }} />
      </div>

      <div>
        <h3>Tipificación</h3>
        <input placeholder="Buscar tipificación…" value={tipifQ} onChange={function (e) { setTipifQ(e.target.value); }} style={Object.assign({}, V2.estiloInput, { width: "100%", margin: "6px 0 4px" })} />
        {props.cargandoTipifs ? <div className="v2-sub">Cargando…</div>
          : <ListaConTilde maxH={260} items={tipifItems} seleccion={f.tipifs} vacio="Sin tipificaciones para el filtro elegido."
            onChange={function (n) { setF(Object.assign({}, f, { tipifs: n })); }} />}
      </div>

      <div>
        <h3>Buscar a alguien</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
          <V2.Campo etiqueta="DNI, teléfono o ID de llamada">
            <input placeholder="Uno o varios" value={f.buscarAlguien} onChange={function (e) { setF(Object.assign({}, f, { buscarAlguien: e.target.value })); }} />
          </V2.Campo>
          <V2.Campo etiqueta="Deudor">
            <input placeholder="Nombre del titular" value={f.deudor} onChange={function (e) { setF(Object.assign({}, f, { deudor: e.target.value })); }} />
          </V2.Campo>
          {errDeudor && <V2.Aviso tipo="error">{errDeudor}</V2.Aviso>}
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.txt,.csv" style={{ display: "none" }}
            onChange={function (e) { var f2 = e.target.files && e.target.files[0]; if (f2) props.onCargarArchivo(f2); if (fileRef.current) fileRef.current.value = ""; }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <V2.Boton tipo="secundario" onClick={function () { if (fileRef.current) fileRef.current.click(); }}>Cargar Excel o TXT</V2.Boton>
            <span onClick={function () { setMasivoAbierto(!masivoAbierto); }} className="v2-sub" style={{ cursor: "pointer" }}>{masivoAbierto ? "Ocultar lista" : "✎ Pegar números"}</span>
          </div>
          {masivoAbierto && <textarea value={props.numerosTexto} onChange={function (e) { props.setNumerosTexto(e.target.value); }} placeholder="Un número por línea…"
            style={Object.assign({}, V2.estiloInput, { width: "100%", height: 70, fontFamily: "var(--mono)", fontSize: 11 })} />}
          {parseNumerosMasivo(props.numerosTexto).length > 0 && <span className="v2-sub">{parseNumerosMasivo(props.numerosTexto).length} número(s) listos</span>}
          {props.msgCarga && <span className="v2-sub">{props.msgCarga}</span>}
        </div>
      </div>

      <div className="v2-facetas-acciones">
        <V2.Boton onClick={props.onBuscar} disabled={!!errDias || !!errDeudor || props.buscando} style={{ flex: 1 }}>{props.buscando ? "Buscando…" : "Buscar"}</V2.Boton>
        <V2.Boton tipo="secundario" onClick={props.onLimpiar}>Limpiar</V2.Boton>
      </div>
    </aside>;
  }

  function ChipsFiltros(props) { // {filtros, numerosTexto, carterasIndex, onQuitar, onLimpiar}
    var f = props.filtros, chips = [];
    chips.push({ k: "fechas", label: "Fechas", val: (f.desde || "?") + " → " + (f.hasta || "?"), fijo: true });
    f.clientes.forEach(function (c) { chips.push({ k: "cliente:" + c, label: "Cliente", val: c }); });
    f.crms.forEach(function (id) { var ct = props.carterasIndex[id]; chips.push({ k: "crm:" + id, label: "Cartera", val: ct ? ct.nombre : id }); });
    f.tipifs.forEach(function (t) { chips.push({ k: "tipif:" + t, label: "Tipificación", val: t }); });
    if (f.buscarAlguien) chips.push({ k: "buscarAlguien", label: "Buscar", val: f.buscarAlguien });
    if (f.deudor) chips.push({ k: "deudor", label: "Deudor", val: f.deudor });
    var nums = parseNumerosMasivo(props.numerosTexto);
    if (nums.length) chips.push({ k: "numeros", label: "Masivo", val: nums.length + " número(s)" });
    return <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "2px 0 10px" }}>
      <span className="v2-sub">Filtros activos:</span>
      {chips.map(function (c) {
        return <V2.Chip key={c.k} onClick={c.fijo ? null : function () { props.onQuitar(c.k); }}><b>{c.label}</b> {c.val}{!c.fijo ? " ✕" : ""}</V2.Chip>;
      })}
      {chips.length > 1 && <V2.Boton tipo="secundario" chico onClick={props.onLimpiar}>Limpiar</V2.Boton>}
    </div>;
  }

  // Resultados guardados de una llamada (analisis_v2), del más nuevo al más viejo.
  function resultadosDe(resultadosMap, grabacion) {
    var out = [];
    Object.keys(resultadosMap).forEach(function (id) { var r = resultadosMap[id]; if (r && r.grabacion === grabacion) out.push(r); });
    out.sort(function (a, b) { return String(b.analizadoEn || "").localeCompare(String(a.analizadoEn || "")); });
    return out;
  }

  function IndicadoresBusqueda(props) { // {total, filas, resultadosMap}
    var ultimos = [];
    (props.filas || []).forEach(function (f) {
      if (f.sinGrabacion) return;
      var lista = resultadosDe(props.resultadosMap, f.grabacion);
      if (lista.length) ultimos.push(lista[0]);
    });
    var conScore = ultimos.filter(function (r) { return r.es_valida !== false && typeof r.score === "number"; });
    var prom = conScore.length ? Math.round(conScore.reduce(function (s, r) { return s + r.score; }, 0) / conScore.length) : null;
    var niveles = V2.ordenarNiveles(V2.niveles), bajo = niveles[0];
    var riesgo = conScore.filter(function (r) { var n = V2.calificar(r.score); return n && n.nombre === bajo.nombre; }).length;
    var item = function (val, label, title) {
      return <div className="v2-kpi" title={title}><b>{val === null ? "—" : val}</b><span>{label}</span></div>;
    };
    return <div className="v2-kpis">
      {item(props.total, "llamadas encontradas")}
      {item(ultimos.length, "ya analizadas", "En esta página, con cualquier tipo de análisis")}
      {item(prom === null ? null : (prom + "%"), "cumplimiento promedio", "Promedio del último análisis de cada llamada, en esta página")}
      {item(riesgo, "calificadas “" + bajo.nombre + "”", "De las analizadas en esta página")}
    </div>;
  }

  // ═══════════════════════════ Grilla ═══════════════════════════════════════════════════

  function BotonPlay(props) { // {activo, onClick}
    return <button type="button" onClick={props.onClick} title="Escuchar"
      style={{ width: 26, height: 26, borderRadius: "50%", border: "1px solid " + V2.C.border, background: V2.C.white, cursor: "pointer", display: "inline-grid", placeItems: "center", color: V2.C.green, padding: 0 }}>
      {props.activo ? "▼" : "▶"}
    </button>;
  }

  function MiniPlayer(props) { // {fila}
    var st = useState(""); var err = st[0], setErr = st[1];
    var reciente = esReciente24h(props.fila.inicio);
    return <div style={{ background: V2.C.bg, borderRadius: 8, padding: "8px 10px", margin: "4px 0" }}>
      {reciente && <V2.Aviso tipo="alerta">🕐 Llamada de las últimas 24 h: puede que todavía no se haya copiado al NAS.</V2.Aviso>}
      <audio controls preload="metadata" style={{ width: "100%" }} src={V2.urlAudio(props.fila.grabacion)}
        onError={function () {
          if (props.onFalta) props.onFalta();
          var local = location.hostname === "127.0.0.1" || location.hostname === "localhost";
          setErr(local
            ? "No se pudo cargar el audio. En local la Mac no ve el NAS: arrancá el server con dev-router.php (pide el audio a producción) y con la VPN conectada."
            : "No se pudo cargar el audio (puede no estar en el NAS todavía).");
        }} />
      {err && <V2.Aviso tipo="error">{err}</V2.Aviso>}
    </div>;
  }

  function ChipResultado(props) { // {resultado, onClick}
    var r = props.resultado;
    var tit = (r.metodoTitulo || "") + (r.analizadoEn ? (" · " + V2.fmtFecha(r.analizadoEn)) : "");
    if (r.es_valida === false) {
      var motivo = (r.analisis && (r.analisis.motivo_invalida || r.analisis.motivo)) || "sin motivo";
      return <button type="button" className={claseScore(r)} title={tit + " · " + motivo} onClick={props.onClick}>No apta</button>;
    }
    var s = typeof r.score === "number" ? r.score : null;
    if (s === null) return <button type="button" className={claseScore(r)} title={tit} onClick={props.onClick}>Sin score</button>;
    return <button type="button" className={claseScore(r)} style={estiloNivel(s)} title={tit + " · " + Math.round(s) + "% de cumplimiento"} onClick={props.onClick}>{nombreNivel(s)} · {Math.round(s)}%</button>;
  }

  var estiloBotonAnalizar = { font: "inherit", fontSize: 12, fontWeight: 600, color: V2.C.green, background: "none", border: "1px dashed " + V2.C.paleB, borderRadius: 6, padding: "3px 9px", cursor: "pointer" };

  function CeldaAnalisis(props) { // {fila, resultados, procesando, errorFila, onAnalizar, onReintentar, onAbrirModal}
    var f = props.fila;
    if (f.sinGrabacion) return <span className="v2-sub">—</span>;
    if (props.procesando) return <span style={{ fontSize: 11, color: V2.C.info }}>{props.procesando}</span>;
    if (props.audioFaltante) return <span style={{ fontSize: 11, color: V2.C.danger }} title="El servidor no encontró la grabación (ni suelta ni en los ZIP del NAS). Las llamadas del día se copian al NAS de noche.">🔇 Sin audio en el NAS <a onClick={props.onAudioRevisar} style={{ cursor: "pointer" }}>Revisar de nuevo</a></span>;
    if (props.errorFila) return <span style={{ fontSize: 11, color: V2.C.danger }}>{props.errorFila} <a onClick={props.onReintentar} style={{ cursor: "pointer" }}>Reintentar</a></span>;
    var lista = props.resultados || [];
    var puede = V2.puede("analizar");
    if (lista.length) {
      var r = lista[0];
      return <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <ChipResultado resultado={r} onClick={function () { props.onAbrirModal(r, f, lista); }} />
        {lista.length > 1 && <a className="v2-sub" style={{ cursor: "pointer", margin: 0 }} title="Ver todos los análisis de esta llamada" onClick={function () { props.onAbrirModal(r, f, lista); }}>+{lista.length - 1}</a>}
        {puede && <a style={{ cursor: "pointer", fontSize: 11 }} title="Hacer otro análisis de esta llamada" onClick={props.onAnalizar}>Analizar</a>}
      </span>;
    }
    if (!puede) return <span className="v2-sub" title="Tu rol no puede disparar análisis">—</span>;
    return <button type="button" onClick={props.onAnalizar} style={estiloBotonAnalizar}>Analizar</button>;
  }

  function FilaResultado(props) {
    var f = props.fila, sel = props.seleccionada, exp = props.expandida;
    var claseFila = (sel ? "v2-fila-sel " : "") + (f.sinGrabacion ? "v2-fila-sin" : "");
    return <React.Fragment>
      <tr className={claseFila.trim() || undefined}>
        <td>{!f.sinGrabacion && <input type="checkbox" checked={!!sel} disabled={!!props.audioFaltante} onChange={props.onToggleSel} style={{ accentColor: V2.C.green }} />}</td>
        <td>{f.sinGrabacion ? <span className="v2-sub" title="No hay grabación para esta llamada">sin grabación</span>
          : <BotonPlay activo={exp} onClick={props.onTogglePlay} />}</td>
        <td>{f.cliente || "—"}{f.cartera ? <span className="v2-sub">{f.cartera}</span> : null}</td>
        <td data-label="Fecha" className="v2-num">{fmtFechaHora(f.inicio)}<span className="v2-sub v2-num">ID {f.idLlamada || "—"}</span></td>
        <td data-label="Duración" className="v2-num">{V2.fmtDur(f.durSeg)}</td>
        <td data-label="Tipificación">{f.tipif ? <span className="v2-tip">{f.tipif}</span> : <span className="v2-sub">—</span>}</td>
        <td data-label="Deudor" title={"DNI " + (f.dni || "—") + (f.cuentaLabel ? (" · " + f.cuentaLabel) : "")}>
          {f.titular || ("DNI " + (f.dni || "—"))}
          {(f.cuentaLabel || f.cuenta) ? <span className="v2-sub">{f.cuentaLabel || f.cuenta}</span> : null}
        </td>
        <td data-label="Gestor">{V2.nombreOperador(props.mapaOps, f.usuario)}</td>
        <td data-label="Análisis">
          <CeldaAnalisis fila={f} resultados={props.resultados}
            procesando={props.procesando} errorFila={props.errorFila} audioFaltante={props.audioFaltante} onAudioRevisar={props.onAudioRevisar}
            onAnalizar={props.onAnalizarUna} onReintentar={props.onReintentarUna} onAbrirModal={props.onAbrirModal} />
        </td>
      </tr>
      {exp && !f.sinGrabacion && <tr className="v2-fila-player"><td colSpan={9} style={{ padding: "0 8px 8px" }}><MiniPlayer fila={f} onFalta={props.onAudioFaltante} /></td></tr>}
    </React.Fragment>;
  }

  // Columnas ordenables: clave → valor de una fila para comparar.
  var COLUMNAS = [
    { k: "cliente", t: "Cliente" }, { k: "inicio", t: "Fecha y hora" }, { k: "durSeg", t: "Duración" },
    { k: "tipif", t: "Tipificación" }, { k: "deudor", t: "Deudor" }, { k: "gestor", t: "Gestor" }, { k: "analisis", t: "Análisis" }
  ];
  function valorOrden(f, col, ctx) {
    if (col === "cliente") return String(f.cliente || "").toLowerCase();
    if (col === "inicio") return String(f.inicio || "");
    if (col === "durSeg") return +f.durSeg || 0;
    if (col === "tipif") return String(f.tipif || "").toLowerCase();
    if (col === "deudor") return String(f.titular || f.dni || "").toLowerCase();
    if (col === "gestor") return V2.nombreOperador(ctx.mapaOps, f.usuario).toLowerCase();
    if (col === "analisis") { var l = resultadosDe(ctx.resultadosMap, f.grabacion); var r = l[0]; return r && r.es_valida !== false && typeof r.score === "number" ? r.score : null; }
    return "";
  }
  // Orden estable; los vacíos (sin análisis, sin tipificación…) siempre al final.
  function ordenarFilas(filas, orden, ctx) {
    if (!orden || !orden.col) return filas;
    var signo = orden.dir === "asc" ? 1 : -1;
    return filas.map(function (f, i) { return { f: f, i: i, v: valorOrden(f, orden.col, ctx) }; }).sort(function (a, b) {
      var va = a.v, vb = b.v, vaVacio = va === null || va === "", vbVacio = vb === null || vb === "";
      if (vaVacio !== vbVacio) return vaVacio ? 1 : -1;
      if (!vaVacio && va !== vb) return (va < vb ? -1 : 1) * signo;
      return a.i - b.i;
    }).map(function (x) { return x.f; });
  }

  function EncabezadoOrden(props) { // {col, titulo, orden, onOrden}
    var activa = props.orden && props.orden.col === props.col;
    var flecha = activa ? (props.orden.dir === "asc" ? "▲" : "▼") : "↕";
    var sig = activa && props.orden.dir === "asc" ? "desc" : (activa ? "asc" : (props.col === "inicio" || props.col === "durSeg" || props.col === "analisis" ? "desc" : "asc"));
    return <th aria-sort={activa ? (props.orden.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={function () { props.onOrden({ col: props.col, dir: sig }); }}
        title={"Ordenar por " + props.titulo.toLowerCase() + (sig === "asc" ? " (ascendente)" : " (descendente)")}
        style={{ font: "inherit", color: "inherit", letterSpacing: "inherit", textTransform: "inherit", background: "none", border: 0, padding: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
        {props.titulo}<span aria-hidden="true" style={{ fontSize: 9, opacity: activa ? 1 : 0.45 }}>{flecha}</span>
      </button>
    </th>;
  }

  function TablaResultados(props) {
    var filas = props.filas || [];
    var seleccionables = filas.filter(function (f) { return !f.sinGrabacion && !props.audioFaltante[f.grabacion]; });
    var todasMarcadas = seleccionables.length > 0 && seleccionables.every(function (f) { return !!props.seleccion[f.grabacion]; });
    return <div className="v2-tabla-caja">
      <table className="v2-tabla v2-tarjetas v2-tabla-res">
        <thead><tr>
          <th><input type="checkbox" aria-label="Tildar todas las de esta página" checked={todasMarcadas} onChange={function () { props.onToggleTodasPagina(seleccionables, !todasMarcadas); }} style={{ accentColor: V2.C.green }} /></th>
          <th></th>
          {COLUMNAS.map(function (c) { return <EncabezadoOrden key={c.k} col={c.k} titulo={c.t} orden={props.orden} onOrden={props.onOrden} />; })}
        </tr></thead>
        <tbody>
          {filas.map(function (f) {
            return <FilaResultado key={f.grabacion || f.idLlamada} fila={f} mapaOps={props.mapaOps}
              seleccionada={props.seleccion[f.grabacion]} onToggleSel={function () { props.onToggleSel(f); }}
              expandida={props.filaExpandida === f.grabacion} onTogglePlay={function () { props.onTogglePlay(f.grabacion); }}
              resultados={f.sinGrabacion ? [] : resultadosDe(props.resultadosMap, f.grabacion)}
              procesando={props.procesandoFila[f.grabacion]} errorFila={props.erroresFila[f.grabacion]}
              audioFaltante={props.audioFaltante[f.grabacion]} onAudioFaltante={function () { props.onAudioFaltante(f.grabacion); }} onAudioRevisar={function () { props.onAudioRevisar(f.grabacion); }}
              onAnalizarUna={function () { props.onAnalizarUna(f); }} onReintentarUna={function () { props.onReintentarUna(f); }}
              onAbrirModal={props.onAbrirModal} />;
          })}
          {!filas.length && <tr><td colSpan={9} className="v2-sub" style={{ padding: 20, textAlign: "center" }}>Sin resultados. Ajustá los filtros y volvé a buscar.</td></tr>}
        </tbody>
      </table>
    </div>;
  }

  function BarraAcciones(props) {
    var n = props.seleccionCount;
    if (!n && !props.colaActiva) return null;
    return <div className="v2-acciones" role="region" aria-label="Acciones sobre las tildadas">
      <span className="v2-cuenta">{n} tildada{n === 1 ? "" : "s"}</span>
      {V2.puede("analizar") && n > 0 && <V2.Boton disabled={props.colaActiva} onClick={props.onPedirAnalizar}>Analizar {n}…</V2.Boton>}
      {n > 0 && <V2.Boton tipo="secundario" onClick={props.onDescargar}>Descargar grabaciones ({n})</V2.Boton>}
      {n > 0 && <V2.Boton tipo="secundario" onClick={props.onDestildar}>Destildar</V2.Boton>}
      {props.colaActiva && <span style={{ marginLeft: "auto", fontSize: 12, color: "rgba(255,255,255,.75)" }}>
        {"Analizando " + props.progreso.hechas + "/" + props.progreso.total + "… "}
        <a onClick={props.onCancelarCola} style={{ cursor: "pointer", color: "#fff", textDecoration: "underline" }}>Cancelar</a>
      </span>}
    </div>;
  }

  // ── Elegir el tipo de análisis (una llamada o varias tildadas) ─────────────────────────
  function ModalElegirAnalisis(props) { // {filas, params, modo, setModo, promptMedida, setPromptMedida, onConfirmar, onCerrar}
    var filas = props.filas || [];
    var n = filas.length;
    var estMin = Math.max(1, Math.round(n * 30 / 60));
    var porCliente = {};
    filas.forEach(function (f) { var c = f.cliente || "Sin cliente"; porCliente[c] = (porCliente[c] || 0) + 1; });
    var clientes = Object.keys(porCliente).sort();
    var tieneParam = function (c) { var p = props.params[c]; return !!(p && String(p.prompt || "").trim()); };
    var analizablesCliente = filas.filter(function (f) { return tieneParam(f.cliente); }).length;
    var esCliente = props.modo === MODO_CLIENTE;
    var listo = esCliente ? analizablesCliente > 0 : !!props.promptMedida.trim();
    var cantidad = esCliente ? analizablesCliente : n;
    var opcion = function (valor, titulo, texto) {
      var on = props.modo === valor;
      return <label style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", border: "1px solid " + (on ? V2.C.green : V2.C.border), background: on ? V2.C.pale : V2.C.white, borderRadius: 8, cursor: "pointer" }}>
        <input type="radio" name="tipo-analisis" checked={on} onChange={function () { props.setModo(valor); }} style={{ marginTop: 3, accentColor: V2.C.green }} />
        <span><b style={{ fontSize: 14 }}>{titulo}</b><span className="v2-sub" style={{ display: "block" }}>{texto}</span></span>
      </label>;
    };
    return <V2.Modal titulo={n === 1 ? "Analizar llamada" : ("Analizar " + n + " llamadas")} onCerrar={props.onCerrar} ancho={620}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="v2-sub">Elegí con qué prompt se analiza{n === 1 ? " la llamada" : "n las llamadas"}.</div>
        {opcion(MODO_CLIENTE, "Parámetro de análisis por cliente", "Cada llamada se revisa con la tabla de temas y el contexto de su cliente, y se califica según el % de temas cumplidos.")}
        {esCliente && <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, padding: "0 4px" }}>
          {clientes.map(function (c) {
            var ok = tieneParam(c);
            return <div key={c} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <span>{c} <span className="v2-sub" style={{ display: "inline" }}>({porCliente[c]})</span></span>
              {ok ? <V2.Chip color={V2.C.ok}>Con parámetro</V2.Chip> : <V2.Chip color={V2.C.warn}>Sin parámetro: no se analiza</V2.Chip>}
            </div>;
          })}
          {clientes.some(function (c) { return !tieneParam(c); }) && <div className="v2-sub" style={{ marginTop: 2 }}>
            {V2.puede("metodos") ? <span>Podés definirlo en <a style={{ cursor: "pointer" }} onClick={function () { props.onCerrar(); V2.irA("parametros"); }}>Configuración → Parámetros de análisis por cliente</a>.</span> : "Pedile a un administrador que lo defina."}
          </div>}
        </div>}
        {opcion(MODO_MEDIDA, "Análisis a medida", "Escribís ahora qué revisar; se usa para todas las llamadas elegidas y se califica igual, por % cumplido.")}
        {!esCliente && <div>
          <textarea id="buscar-prompt-medida" aria-label="Prompt del análisis a medida" value={props.promptMedida} onChange={function (e) { props.setPromptMedida(e.target.value); }} rows={6} autoFocus
            placeholder={"Ejemplo: Evaluá si el gestor ofreció el plan de 6 cuotas sin interés (peso 50) y si confirmó el mail del titular (peso 50)."}
            style={Object.assign({}, V2.estiloInput, { width: "100%", boxSizing: "border-box", fontFamily: "inherit", lineHeight: 1.5, resize: "vertical" })} />
          <div className="v2-sub">El texto queda guardado en este navegador para la próxima vez.</div>
        </div>}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", borderTop: "1px solid " + V2.C.border, paddingTop: 12, marginTop: 2 }}>
          <V2.Boton disabled={!listo} onClick={props.onConfirmar}>Analizar {cantidad === 1 ? "1 llamada" : (cantidad + " llamadas")}</V2.Boton>
          <V2.Boton tipo="secundario" onClick={props.onCerrar}>Cancelar</V2.Boton>
          <span className="v2-sub" style={{ marginLeft: "auto" }}>≈ {estMin} min · usa crédito de OpenAI y Anthropic · si ya se hizo el mismo análisis, no se repite</span>
        </div>
      </div>
    </V2.Modal>;
  }

  // ═══════════════════════════ Modal de score ═══════════════════════════════════════════

  function TablaCriterios(props) { // {analisis}
    var an = props.analisis || {};
    var cr = Array.isArray(an.criterios) ? an.criterios : [];
    var escala13 = an.escala === "1-3";
    var binario = esBinario(an);
    if (!cr.length) return <div className="v2-sub">Este análisis no tiene detalle por criterio.</div>;
    var pill = function (par, txt) { return <span className="v2-num" style={{ background: par.bg, color: par.fg, padding: "1px 7px", borderRadius: 5, whiteSpace: "nowrap" }}>{txt}</span>; };
    var colorNota = function (n) { return n === 3 ? { bg: V2.C.okBg, fg: V2.C.ok } : n === 2 ? { bg: V2.C.warnBg, fg: V2.C.warn } : { bg: V2.C.dangerBg, fg: V2.C.danger }; };
    var colorPuntaje = function (p) { return p >= 80 ? { bg: V2.C.okBg, fg: V2.C.ok } : p >= 70 ? { bg: V2.C.warnBg, fg: V2.C.warn } : { bg: V2.C.dangerBg, fg: V2.C.danger }; };
    return <div className="v2-tabla-caja"><table className="v2-tabla v2-tarjetas">
      <thead><tr><th>{binario ? "Tema" : "Criterio"}</th><th>Peso</th><th>{binario ? "Resultado" : "Nota"}</th><th>Comentario / evidencia</th></tr></thead>
      <tbody>
        {cr.map(function (c, i) {
          if (c && c.aplica === false) return <tr key={i}>
            <td style={{ fontWeight: 600 }}>{c.nombre || c.criterio || ("Criterio " + (i + 1))}</td>
            <td data-label="Peso" className="v2-num">{c.peso}</td>
            <td data-label="Nota" colSpan={2}><span className="v2-sub">N/A — {c.comentario || c.evidencia || "no aplica"}</span></td>
          </tr>;
          var celdaNota = "—";
          if (escala13 && typeof c.nota === "number") celdaNota = pill(colorNota(c.nota), c.nota + "/3 " + (NOTA_LABEL[c.nota] || ""));
          else if (!escala13 && typeof c.puntaje === "number" && binario) celdaNota = pill(c.puntaje === 100 ? { bg: V2.C.okBg, fg: V2.C.ok } : { bg: V2.C.dangerBg, fg: V2.C.danger }, c.puntaje === 100 ? "✓ Cumple" : "✗ No cumple");
          else if (!escala13 && typeof c.puntaje === "number") celdaNota = pill(colorPuntaje(c.puntaje), c.puntaje);
          return <tr key={i}>
            <td style={{ fontWeight: 600 }}>{c.nombre || c.criterio || ("Criterio " + (i + 1))}</td>
            <td data-label="Peso" className="v2-num">{typeof c.peso === "number" ? c.peso : "—"}</td>
            <td data-label="Nota">{celdaNota}</td>
            <td data-label="Detalle">{c.comentario || c.evidencia || "—"}</td>
          </tr>;
        })}
      </tbody>
    </table></div>;
  }

  // Llamada "no apta" (es_valida false, no reintentar): modal simple, no hay score que explicar.
  function ModalNoApta(props) { // {resultado, onCerrar}
    var r = props.resultado;
    var motivo = (r.analisis && (r.analisis.motivo_invalida || r.analisis.motivo)) || "sin motivo informado";
    return <V2.Modal titulo="Llamada no apta para evaluar" onCerrar={props.onCerrar} ancho={460}>
      <div style={{ background: "#f7faf5", border: "1px solid " + V2.C.border, borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 1.6 }}>
        <b>Motivo:</b> {motivo}. La IA no puntúa llamadas sin conversación real con el titular, para no bajar el score del gestor.
      </div>
      {r.grabacion && <div style={{ marginTop: 12 }}><BotonDescargarDetalle resultado={r} fila={props.fila} mapaOps={props.mapaOps} /></div>}
    </V2.Modal>;
  }

  // ── Descarga individual: zip con el audio + detalle.txt que justifica la calificación ──
  function textoDetalle(r, f, mapaOps) {
    var an = r.analisis || {}, s = typeof r.score === "number" ? r.score : null;
    var L = [], linea = function (t) { L.push(t === undefined ? "" : t); };
    var cr = Array.isArray(an.criterios) ? an.criterios : [], bin = esBinario(an);
    linea("DASA · Calidad de audios · Detalle de la calificación");
    linea("======================================================");
    if (r.es_valida === false) linea("Calificación: NO APTA (" + ((an.motivo_invalida || an.motivo) || "sin motivo") + ")");
    else linea("Calificación: " + nombreNivel(s) + (s !== null ? (" (" + Math.round(s) + "% de cumplimiento de los temas)") : ""));
    linea("Análisis: " + (r.metodoTitulo || "—") + " · " + V2.fmtFecha(r.analizadoEn) + (r.analizadoPor ? (" · por " + r.analizadoPor) : ""));
    linea();
    linea("LLAMADA");
    linea("  Cliente: " + (r.cliente || f.cliente || "—") + ((r.cartera || f.cartera) ? (" · " + (r.cartera || f.cartera)) : ""));
    linea("  Fecha y hora: " + (fmtFechaHora(f.inicio) !== "—" ? fmtFechaHora(f.inicio) : (r.fecha || "—")));
    linea("  ID de llamada: " + (r.idLlamada || f.idLlamada || "—"));
    linea("  Gestor: " + V2.nombreOperador(mapaOps, r.usuario || f.usuario));
    linea("  Deudor: " + (r.titular || f.titular || "—") + " · DNI " + (r.dni || f.dni || "—"));
    if (f.telefono) linea("  Teléfono: " + f.telefono);
    linea("  Duración: " + V2.fmtDur(r.durSeg || f.durSeg));
    linea("  Tipificación: " + (r.tipif || f.tipif || "—"));
    linea("  Grabación: " + (r.grabacion || f.grabacion || "—"));
    linea();
    if (an.analisis) { linea("POR QUÉ ESTA CALIFICACIÓN"); linea("  " + an.analisis); linea(); }
    if (cr.length) {
      linea(bin ? "TEMAS REVISADOS" : "CRITERIOS");
      cr.forEach(function (c) {
        if (!c) return;
        var nom = c.nombre || c.criterio || "—";
        var res = c.aplica === false ? "N/A" : bin ? (c.puntaje === 100 ? "✓ Cumple" : "✗ No cumple") : (typeof c.puntaje === "number" ? (c.puntaje + "/100") : (typeof c.nota === "number" ? (c.nota + "/3") : "—"));
        linea("  " + res + " · " + nom + (typeof c.peso === "number" ? (" (peso " + c.peso + ")") : ""));
        if (c.comentario || c.evidencia) linea("      " + (c.comentario || c.evidencia));
      });
      linea();
    }
    if (an.recomendacion) { linea("RECOMENDACIÓN"); linea("  " + an.recomendacion); linea(); }
    return L.join("\r\n");
  }
  function nombreSeguro(t) { return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "x"; }
  function descargarConDetalle(r, f, mapaOps) {
    if (!window.JSZip) return Promise.reject(new Error("No se pudo cargar el compresor de archivos (revisá la conexión)."));
    var grab = r.grabacion || f.grabacion;
    if (!grab) return Promise.reject(new Error("Esta llamada no tiene grabación."));
    return fetch(V2.urlAudio(grab), { credentials: "same-origin" }).then(function (resp) {
      var ct = resp.headers.get("content-type") || "";
      if (!resp.ok || ct.indexOf("json") >= 0 || ct.indexOf("html") >= 0) throw new Error("No se pudo traer el audio del servidor (puede no estar en el NAS todavía).");
      return resp.blob();
    }).then(function (audio) {
      var zip = new window.JSZip();
      var nomAudio = String(grab).split(/[\\/]/).pop() || "grabacion.wav";
      if (!/\.(wav|mp3|gsm|ogg)$/i.test(nomAudio)) nomAudio += (audio.type.indexOf("mpeg") >= 0 ? ".mp3" : ".wav");
      zip.file(nomAudio, audio);
      zip.file("detalle.txt", "\ufeff" + textoDetalle(r, f, mapaOps));
      return zip.generateAsync({ type: "blob" });
    }).then(function (blob) {
      var nivel = r.es_valida === false ? "no_apta" : nombreNivel(r.score);
      var url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = "llamada_" + nombreSeguro(r.idLlamada || f.idLlamada || grab) + "_" + nombreSeguro(nivel) + ".zip";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    });
  }
  function BotonDescargarDetalle(props) { // {resultado, fila, mapaOps}
    var st = useState(""); var estado = st[0], setEstado = st[1];
    if (!V2.puede("descargar")) return null;
    var ir = function () {
      setEstado("…");
      descargarConDetalle(props.resultado, props.fila || {}, props.mapaOps).then(function () { setEstado("ok"); }, function (e) { setEstado((e && e.message) || "No se pudo descargar."); });
    };
    return <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <V2.Boton tipo="secundario" chico disabled={estado === "…"} onClick={ir} title="Baja un .zip con la grabación y un detalle.txt que justifica la calificación">{estado === "…" ? "Preparando…" : "⬇ Descargar audio con detalle"}</V2.Boton>
      {estado === "ok" && <span className="v2-sub" style={{ display: "inline" }}>Listo.</span>}
      {estado && estado !== "…" && estado !== "ok" && <span style={{ fontSize: 12, color: V2.C.danger }}>{estado}</span>}
    </span>;
  }

  function ModalScore(props) { // {resultado, fila, onCerrar, lista?, onElegir?, mapaOps}
    V2.useNiveles();
    var r = props.resultado, f = props.fila || {};
    if (r.es_valida === false) return <ModalNoApta resultado={r} fila={f} mapaOps={props.mapaOps} onCerrar={props.onCerrar} />;
    var an = r.analisis || {};
    var s = typeof r.score === "number" ? r.score : null;
    var formula = an.escala === "1-3" ? "Score = Σ peso × nota/3 ÷ Σ peso de los que aplican"
      : esBinario(an) ? "Cumplimiento = Σ peso de los temas cumplidos ÷ Σ peso de todos los temas"
      : "Score = promedio ponderado de puntajes (0-100) de los criterios que aplican";
    var fechaAn = r.analizadoEn ? String(r.analizadoEn).slice(0, 10).split("-").reverse().join("/") : "—";
    var dato = function (etiqueta, valor) { return <div><span className="v2-sub" style={{ textTransform: "uppercase", letterSpacing: ".06em" }}>{etiqueta}</span>{valor}</div>; };
    return <V2.Modal titulo="Cómo se llegó a esta calificación" onCerrar={props.onCerrar} ancho={820}>
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <span className="v2-num" style={{ fontSize: 30, fontWeight: 500, color: colorScore(s) }}>{s !== null ? (Math.round(s) + "%") : "—"}</span>
        <div>
          <div style={{ fontWeight: 700, color: colorScore(s) }}>{s !== null ? nombreNivel(s) : "Sin calificación"}<span className="v2-sub" style={{ display: "inline", fontWeight: 400 }}>{s !== null ? (esBinario(an) ? " · cumplimiento de los temas" : " · puntaje") : ""}</span></div>
          <span className="v2-sub">{r.metodoTitulo || "—"} · analizado el {fechaAn}{r.analizadoPor ? (" por " + r.analizadoPor) : ""}</span>
        </div>
        {props.lista && props.lista.length > 1 && props.onElegir && <label style={{ marginLeft: "auto", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <span className="v2-sub" style={{ display: "inline" }}>{props.lista.length} análisis de esta llamada:</span>
          <select value={props.lista.indexOf(r)} onChange={function (e) { props.onElegir(props.lista[+e.target.value]); }} style={V2.estiloInput}>
            {props.lista.map(function (x, i) {
              return <option key={i} value={i}>{(x.metodoTitulo || "—") + " · " + V2.fmtFecha(x.analizadoEn) + (typeof x.score === "number" && x.es_valida !== false ? (" · " + Math.round(x.score)) : " · no apta")}</option>;
            })}
          </select>
        </label>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: "8px 16px", fontSize: 12.5 }}>
        {dato("Deudor", r.titular || f.titular || ("DNI " + (r.dni || f.dni || "—")))}
        {dato("Gestor", V2.nombreOperador(props.mapaOps, r.usuario || f.usuario))}
        {dato("Cliente", (r.cliente || f.cliente || "—") + (r.cartera || f.cartera ? (" · " + (r.cartera || f.cartera)) : ""))}
        {dato("Fecha", fmtFechaHora(f.inicio) !== "—" ? fmtFechaHora(f.inicio) : (r.fecha || "—"))}
        {dato("Duración", V2.fmtDur(r.durSeg || f.durSeg))}
        {dato("Tipificación", r.tipif || f.tipif || "—")}
        {dato("DNI", r.dni || f.dni || "—")}
        {dato("ID de llamada", r.idLlamada || f.idLlamada || "—")}
        {dato("Teléfono", f.telefono || "—")}
      </div>

      {an.analisis && <div style={{ background: "#f7faf5", border: "1px solid " + V2.C.border, borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 1.6 }}>
        <b>Por qué esta calificación.</b> {an.analisis}
      </div>}

      <TablaCriterios analisis={an} />
      <div className="v2-num" style={{ color: V2.C.muted }}>{formula}</div>

      {an.recomendacion && <div style={{ background: V2.C.infoBg, border: "1px solid #c7dbf1", borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 1.6 }}>
        <b>Recomendación.</b> {an.recomendacion}
      </div>}

      {r.grabacion && <div><BotonDescargarDetalle resultado={r} fila={f} mapaOps={props.mapaOps} /></div>}
      {r.grabacion && <div style={{ background: V2.C.dark, borderRadius: 8, padding: "9px 12px" }}>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,.55)", marginBottom: 6 }}>Audio de la llamada</div>
        <audio controls preload="none" src={V2.urlAudio(r.grabacion)} style={{ width: "100%" }} />
      </div>}
      {r.promptUsado && <details>
        <summary style={{ cursor: "pointer", fontWeight: 700, color: V2.C.info, fontSize: 13 }}>Ver prompt usado ({r.modo === "medida" ? "a medida" : "parámetro del cliente"})</summary>
        <div style={{ fontSize: 12, lineHeight: 1.6, marginTop: 6, background: V2.C.bg, borderRadius: 8, padding: "10px 12px", whiteSpace: "pre-wrap", maxHeight: 220, overflowY: "auto" }}>{r.promptUsado}</div>
      </details>}
      {r.transcripcion && <details>
        <summary style={{ cursor: "pointer", fontWeight: 700, color: V2.C.info, fontSize: 13 }}>Ver transcripción</summary>
        <div style={{ fontSize: 12, lineHeight: 1.6, marginTop: 6, background: V2.C.bg, borderRadius: 8, padding: "10px 12px", whiteSpace: "pre-wrap", maxHeight: 260, overflowY: "auto" }}>{r.transcripcion}</div>
      </details>}
    </V2.Modal>;
  }

  // ═══════════════════════════ Componente principal ═══════════════════════════════════════

  function PantallaBuscar() {
    var mapaOps = V2.useOperadores();
    V2.useNiveles();   // re-pinta las calificaciones si cambian en Configuración

    // Pedido de otra pantalla (Control interno → "Buscar sus llamadas"): {numeros, desde, hasta, etiqueta}.
    var pedidoRef = useRef(V2.tomarPedido("buscar"));
    var pedido = pedidoRef.current;
    var stF = useState(function () { return pedido ? Object.assign(filtrosIniciales(), { desde: pedido.desde || V2.primeroDeMes(), hasta: pedido.hasta || V2.hoy() }) : filtrosIniciales(); });
    var filtros = stF[0], setFiltros = stF[1];
    var stNum = useState(pedido && pedido.numeros ? pedido.numeros.join("\n") : ""); var numerosTexto = stNum[0], setNumerosTexto = stNum[1];
    var stMsgCarga = useState(""); var msgCarga = stMsgCarga[0], setMsgCarga = stMsgCarga[1];

    var stCat = useState([]); var catalogoClientes = stCat[0], setCatalogoClientes = stCat[1];
    var stTip = useState([]); var tipifsCat = stTip[0], setTipifsCat = stTip[1];
    var stCargTip = useState(false); var cargandoTipifs = stCargTip[0], setCargandoTipifs = stCargTip[1];

    var stBusc = useState(null); var resultado = stBusc[0], setResultado = stBusc[1];
    var stBuscando = useState(false); var buscando = stBuscando[0], setBuscando = stBuscando[1];
    var stErrBusq = useState(""); var errBusq = stErrBusq[0], setErrBusq = stErrBusq[1];

    var stSel = useState({}); var seleccion = stSel[0], setSeleccion = stSel[1];
    var stExp = useState(""); var filaExpandida = stExp[0], setFilaExpandida = stExp[1];

    // Tipo de análisis que se elige al tocar "Analizar": por cliente o a medida (se recuerda el último).
    var stModo = useState(function () { var v = ""; try { v = localStorage.getItem(LS_METODO) || ""; } catch (e) {} return v === MODO_MEDIDA ? MODO_MEDIDA : MODO_CLIENTE; });
    var modoAnalisis = stModo[0], setModoRaw = stModo[1];
    var setModoAnalisis = function (m) { setModoRaw(m); try { localStorage.setItem(LS_METODO, m); } catch (e) {} };
    var stElegir = useState(null); var elegir = stElegir[0], setElegir = stElegir[1];   // filas para las que se está eligiendo el tipo de análisis
    var stOrden = useState({ col: "inicio", dir: "desc" }); var orden = stOrden[0], setOrden = stOrden[1];
    var stParams = useState({}); var paramsCliente = stParams[0], setParamsCliente = stParams[1];   // cliente -> {prompt,…}
    var stPM = useState(function () { try { return localStorage.getItem(LS_PROMPT_MEDIDA) || ""; } catch (e) { return ""; } });
    var promptMedida = stPM[0], setPromptMedidaRaw = stPM[1];
    var setPromptMedida = function (t) { setPromptMedidaRaw(t); try { localStorage.setItem(LS_PROMPT_MEDIDA, t); } catch (e) {} };

    var stResMap = useState({}); var resultadosMap = stResMap[0], setResultadosMap = stResMap[1];
    var resultadosRef = useRef({}); resultadosRef.current = resultadosMap;   // la cola corre con closures viejas
    var stProcFila = useState({}); var procesandoFila = stProcFila[0], setProcesandoFila = stProcFila[1];
    var stErrFila = useState({}); var erroresFila = stErrFila[0], setErroresFila = stErrFila[1];
    var stAudioF = useState({}); var audioFaltante = stAudioF[0], setAudioFaltante = stAudioF[1];
    var faltanteRef = useRef({});   // espejo síncrono de audioFaltante (la cola corre con closures viejas)
    var stProgreso = useState(null); var progreso = stProgreso[0], setProgreso = stProgreso[1];
    var stAvisoGeneral = useState(""); var avisoGeneral = stAvisoGeneral[0], setAvisoGeneral = stAvisoGeneral[1];
    var pausaRef = useRef(false);
    var enCursoRef = useRef({});   // grabaciones en proceso (lock contra análisis duplicados)

    var stModal = useState(null); var modal = stModal[0], setModal = stModal[1];
    var stDescargando = useState(null); var descargando = stDescargando[0], setDescargando = stDescargando[1];

    useEffect(function () {
      V2.api(V2.config.api.catalogo, { accion: "clientes" }).then(function (d) { setCatalogoClientes(d.clientes || []); })
        .catch(function (e) { setErrBusq("No se pudo cargar el catálogo de clientes: " + ((e && e.message) || e)); });
    }, []);

    // Parámetros de análisis por cliente (colección chica: un doc por cliente).
    useEffect(function () {
      return V2.db.collection(V2.config.col.parametros).onSnapshot(
        function (sn) { var m = {}; sn.docs.forEach(function (d) { var x = d.data() || {}; if (x.cliente) m[x.cliente] = x; }); setParamsCliente(m); },
        function (e) { setParamsCliente({}); setErrBusq("No se pudieron cargar los parámetros por cliente: " + ((e && e.message) || e)); });
    }, []);

    // Tipificaciones del catálogo, según cliente(s)/cartera(s)/fechas elegidos.
    useEffect(function () {
      if (diffDias(filtros.desde, filtros.hasta) > 45 || !filtros.desde || !filtros.hasta) return;
      var crms = filtros.crms.length ? filtros.crms
        : carterasDisponibles(catalogoClientes, filtros.clientes).map(function (c) { return c.crm; });
      setCargandoTipifs(true);
      var vivo = true;
      var to = setTimeout(function () {
        V2.api(V2.config.api.catalogo, { accion: "tipificaciones", crms: crms, desde: filtros.desde, hasta: filtros.hasta })
          .then(function (d) { if (vivo) setTipifsCat(d.tipificaciones || []); })
          .catch(function () { if (vivo) setTipifsCat([]); })
          .finally(function () { if (vivo) setCargandoTipifs(false); });
      }, 350);
      return function () { vivo = false; clearTimeout(to); };
    }, [filtros.clientes, filtros.crms, filtros.desde, filtros.hasta, catalogoClientes]);

    // Si buscar.php trajo conteos de tipificaciones sobre el resultado actual, priorizarlos para mostrar (más precisos).
    var tipifsParaMostrar = (resultado && resultado.conteos && resultado.conteos.tipifs)
      ? tipifsCat.map(function (o) { var c = resultado.conteos.tipifs[o.tipif]; return typeof c === "number" ? Object.assign({}, o, { cantidad: c }) : o; })
      : tipifsCat;
    var conteosClientes = (resultado && resultado.conteos && resultado.conteos.clientes) || null;
    var carterasIndex = {}; carterasDisponibles(catalogoClientes, []).forEach(function (c) { carterasIndex[c.crm] = c; });

    var armarBody = function (pagina) {
      var numerosFinal = parseNumerosMasivo((numerosTexto || "") + " " + (filtros.buscarAlguien || ""));
      return {
        clientes: filtros.clientes, crms: filtros.crms,
        desde: filtros.desde, hasta: filtros.hasta,
        tipifs: filtros.tipifs.length ? filtros.tipifs : undefined,
        deudor: filtros.deudor.trim() || undefined,
        numeros: numerosFinal.length ? numerosFinal : undefined,
        pagina: pagina || 1, porPagina: POR_PAGINA
      };
    };

    // Trae TODOS los análisis guardados de las llamadas de la página (cualquier tipo), de a 10 grabaciones.
    var cargarResultadosDePagina = function (filas) {
      if (!filas || !filas.length) return;
      var grabs = filas.filter(function (f) { return !f.sinGrabacion && f.grabacion; }).map(function (f) { return f.grabacion; });
      var lotes = []; for (var i = 0; i < grabs.length; i += 10) lotes.push(grabs.slice(i, i + 10));
      lotes.forEach(function (lote) {
        if (!lote.length) return;
        V2.db.collection(V2.config.col.resultados).where("grabacion", "in", lote).get()
          .then(function (sn) { var n = {}; sn.docs.forEach(function (d) { n[d.id] = d.data(); }); setResultadosMap(function (prev) { return Object.assign({}, prev, n); }); })
          .catch(function () {});
      });
    };

    var ejecutarBusqueda = function (pagina) {
      setErrBusq(""); setBuscando(true);
      var body = armarBody(pagina);
      V2.api(V2.config.api.buscar, body, 60000).then(function (d) {
        setResultado(d); setBuscando(false);
        cargarResultadosDePagina(d.filas || []);
      }).catch(function (e) { setBuscando(false); setErrBusq((e && e.message) || "Error buscando."); });
    };

    var onBuscar = function () { ejecutarBusqueda(1); };
    // Si vino un pedido de otra pantalla, buscar apenas se monta (los filtros ya están cargados).
    useEffect(function () { if (pedidoRef.current) ejecutarBusqueda(1); }, []);
    var onLimpiar = function () { setFiltros(filtrosIniciales()); setNumerosTexto(""); setMsgCarga(""); setResultado(null); setErrBusq(""); };
    var onQuitarChip = function (k) {
      if (k.indexOf("cliente:") === 0) { var c = k.slice(8); setFiltros(Object.assign({}, filtros, { clientes: filtros.clientes.filter(function (x) { return x !== c; }) })); }
      else if (k.indexOf("crm:") === 0) { var id = parseInt(k.slice(4), 10); setFiltros(Object.assign({}, filtros, { crms: filtros.crms.filter(function (x) { return x !== id; }) })); }
      else if (k.indexOf("tipif:") === 0) { var t = k.slice(6); setFiltros(Object.assign({}, filtros, { tipifs: filtros.tipifs.filter(function (x) { return x !== t; }) })); }
      else if (k === "buscarAlguien") setFiltros(Object.assign({}, filtros, { buscarAlguien: "" }));
      else if (k === "deudor") setFiltros(Object.assign({}, filtros, { deudor: "" }));
      else if (k === "numeros") { setNumerosTexto(""); setMsgCarga(""); }
    };
    var onCargarArchivo = function (file) { leerArchivoNumeros(file, function (texto, msg) { if (texto !== null) setNumerosTexto(texto); setMsgCarga(msg); }); };

    var onToggleSel = function (f) { setSeleccion(function (prev) { var n = Object.assign({}, prev); if (n[f.grabacion]) delete n[f.grabacion]; else n[f.grabacion] = true; return n; }); };
    var onToggleTodasPagina = function (seleccionables, marcar) {
      setSeleccion(function (prev) { var n = Object.assign({}, prev); seleccionables.forEach(function (f) { if (marcar) n[f.grabacion] = true; else delete n[f.grabacion]; }); return n; });
    };
    var seleccionCount = Object.keys(seleccion).length;
    var onDestildar = function () { setSeleccion({}); };
    var onTogglePlay = function (grab) { setFilaExpandida(function (prev) { return prev === grab ? "" : grab; }); };

    // Audio que el servidor no encuentra: la fila deja de poder analizarse (y se destilda) hasta "Revisar de nuevo".
    var marcarAudioFaltante = function (grab) {
      faltanteRef.current[grab] = true;
      setAudioFaltante(function (p) { var n = Object.assign({}, p); n[grab] = true; return n; });
      setSeleccion(function (p) { if (!p[grab]) return p; var n = Object.assign({}, p); delete n[grab]; return n; });
    };
    var revisarAudio = function (grab) {
      delete faltanteRef.current[grab];
      setAudioFaltante(function (p) { var n = Object.assign({}, p); delete n[grab]; return n; });
    };

    // Qué prompt corresponde a cada llamada según el tipo de análisis elegido. Devuelve
    // {id, titulo, prompt, cliente, modo} o {falta, ayuda} si no se puede analizar.
    var resolverMetodo = function (fila, modo) {
      if (modo === MODO_CLIENTE) {
        var p = paramsCliente[fila.cliente];
        if (!p || !String(p.prompt || "").trim()) return { falta: "Sin parámetro para " + (fila.cliente || "este cliente"), ayuda: "Definilo en Configuración → Parámetros de análisis por cliente." };
        return { id: "param-" + V2.slugCliente(fila.cliente), titulo: "Parámetro " + fila.cliente, prompt: p.prompt, cliente: fila.cliente, modo: "cliente" };
      }
      if (modo === MODO_MEDIDA) {
        if (!promptMedida.trim()) return { falta: "Falta el prompt a medida" };
        var pm = promptMedida.trim() + "\n\nSepará lo pedido en temas concretos y devolvé un criterio por tema (peso 1 salvo que se indique otro), con puntaje 100 si el gestor lo cumple y 0 si no lo cumple. En 'comentario' justificá citando lo que se dijo en la llamada.";
        return { id: "medida-" + V2.hashTexto(promptMedida.trim()), titulo: "A medida", prompt: pm, cliente: fila.cliente, modo: "medida" };
      }
      return { falta: "Elegí el tipo de análisis" };
    };

    // El contrato manda {error, codigo} con HTTP 4xx/5xx — V2.api ya lo convierte en excepción con .codigo.
    // Por eso el chequeo de crédito agotado va en el catch() de analizarFilaSegura, no sobre una respuesta "ok".
    var obtenerTranscripcion = function (fila) {
      return V2.db.collection(V2.config.col.analisisViejos).doc(fila.grabacion).get().then(function (doc) {
        if (doc.exists && doc.data().transcripcion) return { transcripcion: doc.data().transcripcion, motor: doc.data().motorTranscripcion || "reuso" };
        return V2.db.collection(V2.config.col.resultados).where("grabacion", "==", fila.grabacion).limit(1).get().then(function (sn) {
          var conTexto = sn.docs.filter(function (d) { return d.data().transcripcion; })[0];
          if (conTexto) return { transcripcion: conTexto.data().transcripcion, motor: conTexto.data().motorTranscripcion || "reuso" };
          return V2.api(V2.config.api.transcribir, { file: fila.grabacion, motor: "openai" }, 240000).then(function (dt) {
            if (dt.codigo === "openai_sin_credito") setAvisoGeneral("⚠ OpenAI sin crédito: esta llamada se transcribió con el modelo gratis del servidor (más lento y de menor calidad). Recargá el crédito de OpenAI.");
            if (dt.calidad && dt.calidad.valida === false) { var err = new Error(dt.calidad.motivo || "motivo desconocido"); err.defectuosa = true; throw err; }
            return { transcripcion: dt.transcripcion, motor: dt.motor || "openai" };
          });
        });
      });
    };

    var analizarConTranscripcion = function (fila, metodo, transcripcion) {
      return V2.api(V2.config.api.analizar, { transcripcion: transcripcion, prompt: metodo.prompt, cliente: metodo.cliente || fila.cliente }, 180000).then(function (da) {
        if (da.analisis && da.analisis.reintentar === true) { var err = new Error(da.analisis.motivo_invalida || "motivo desconocido"); err.defectuosa = true; throw err; }
        return da.analisis;
      });
    };

    var guardarResultado = function (fila, metodo, transcripcion, motorTranscripcion, analisisObj) {
      var score = calcularScore(analisisObj);
      var doc = {
        grabacion: fila.grabacion, idLlamada: fila.idLlamada || "", metodoId: metodo.id, metodoTitulo: metodo.titulo || "",
        cliente: fila.cliente || "", cartera: fila.cartera || "", fecha: fila.fecha || String(fila.inicio || "").slice(0, 10),
        usuario: fila.usuario || "", dni: fila.dni || "", titular: fila.titular || "", tipif: fila.tipif || "", durSeg: fila.durSeg || 0,
        transcripcion: transcripcion, motorTranscripcion: motorTranscripcion || "",
        analisis: analisisObj, score: score, scoreExacto: score, escala: analisisObj.escala || "",
        etiqueta: (typeof score === "number") ? nombreNivel(score) : "", es_valida: analisisObj.es_valida !== false,
        calificacion: (typeof score === "number" && analisisObj.es_valida !== false) ? nombreNivel(score) : "", cumplimiento: score,
        analizadoPor: (V2.usuario && (V2.usuario.nombre || V2.usuario.email)) || "", analizadoEn: new Date().toISOString()
      };
      if (metodo.modo === "cliente" || metodo.modo === "medida") { doc.modo = metodo.modo; doc.promptUsado = metodo.prompt; }
      var id = V2.idResultado(fila.grabacion, metodo.id);
      return V2.db.collection(V2.config.col.resultados).doc(id).set(doc).then(function () {
        setResultadosMap(function (prev) { var n = Object.assign({}, prev); n[id] = doc; return n; });
      });
    };

    var analizarFilaSegura = function (fila, metodo) {
      // Lock por grabación: un doble click o una fila que ya está en la cola no dispara otra
      // transcripción/análisis (son llamadas pagas). Ref síncrono: el estado de React llega un tick tarde.
      if (enCursoRef.current[fila.grabacion] || faltanteRef.current[fila.grabacion]) return Promise.resolve();
      enCursoRef.current[fila.grabacion] = true;
      setErroresFila(function (p) { var n = Object.assign({}, p); delete n[fila.grabacion]; return n; });
      setProcesandoFila(function (p) { var n = Object.assign({}, p); n[fila.grabacion] = "🎙 Transcribiendo…"; return n; });
      return obtenerTranscripcion(fila).then(function (t) {
        setProcesandoFila(function (p) { var n = Object.assign({}, p); n[fila.grabacion] = "🤖 Analizando…"; return n; });
        return analizarConTranscripcion(fila, metodo, t.transcripcion).then(function (analisisObj) {
          return guardarResultado(fila, metodo, t.transcripcion, t.motor, analisisObj);
        });
      }).catch(function (e) {
        if (e && (e.codigo === "openai_sin_credito" || e.codigo === "anthropic_sin_credito" || e.codigo === "sin_motor")) {
          setAvisoGeneral("⏸ " + (e.codigo === "anthropic_sin_credito" ? "Anthropic sin crédito" : (e.codigo === "sin_motor" ? "No hay motor de transcripción disponible (OpenAI sin crédito y el modelo gratis no respondió)" : "OpenAI sin crédito")) + ": " + e.message + ". Se pausó el análisis.");
          pausaRef.current = true;
          setErroresFila(function (p) { var n = Object.assign({}, p); n[fila.grabacion] = "⏸ Pausado por falta de crédito."; return n; });
          return;
        }
        if (e && e.codigo === "audio_no_encontrado") { marcarAudioFaltante(fila.grabacion); return; }
        var msg = e && e.defectuosa ? ("⚠ Transcripción defectuosa (" + e.message + ")") : ("⚠️ " + ((e && e.message) || "error"));
        setErroresFila(function (p) { var n = Object.assign({}, p); n[fila.grabacion] = msg; return n; });
      }).finally(function () {
        delete enCursoRef.current[fila.grabacion];
        setProcesandoFila(function (p) { var n = Object.assign({}, p); delete n[fila.grabacion]; return n; });
      });
    };

    var ejecutarCola = function (filas, resolver) {
      if (!resolver || !filas.length) return;
      pausaRef.current = false;
      var pendientes = filas.slice(), total = pendientes.length, hechas = 0;
      setProgreso({ hechas: 0, total: total });
      var worker = function () {
        var siguiente = function () {
          if (pausaRef.current) return Promise.resolve();
          var f = pendientes.shift();
          if (!f) return Promise.resolve();
          var metodo = resolver(f);
          if (!metodo || !metodo.id) {
            setErroresFila(function (p) { var n = Object.assign({}, p); n[f.grabacion] = "⚠ " + ((metodo && metodo.falta) || "Sin tipo de análisis"); return n; });
            hechas++; setProgreso({ hechas: hechas, total: total }); return siguiente();
          }
          // Mismo análisis ya hecho con el mismo prompt: no se vuelve a pagar.
          var previo = resultadosRef.current[V2.idResultado(f.grabacion, metodo.id)];
          if (previo && previo.promptUsado === metodo.prompt) { hechas++; setProgreso({ hechas: hechas, total: total }); return siguiente(); }
          return analizarFilaSegura(f, metodo).then(function () { hechas++; setProgreso({ hechas: hechas, total: total }); return siguiente(); });
        };
        return siguiente();
      };
      return Promise.all([worker(), worker()]).then(function () { setProgreso(null); });
    };

    // "Analizar" (una fila o las tildadas) abre la ventana para elegir el tipo de análisis.
    var onAnalizarUna = function (fila) { if (!faltanteRef.current[fila.grabacion]) setElegir([fila]); };
    var onReintentarUna = function (fila) { setElegir([fila]); };
    var onPedirAnalizar = function () {
      var filasSel = (resultado && resultado.filas || []).filter(function (f) { return seleccion[f.grabacion] && !f.sinGrabacion && !faltanteRef.current[f.grabacion]; });
      if (filasSel.length) setElegir(filasSel);
    };
    var onConfirmarElegir = function () {
      var filasA = elegir || [], modo = modoAnalisis;
      setElegir(null);
      ejecutarCola(filasA, function (f) { return resolverMetodo(f, modo); });
    };
    var onCancelarCola = function () { pausaRef.current = true; };
    var onAbrirModal = function (r, f, lista) { setModal({ resultado: r, fila: f, lista: lista || null }); };

    var onDescargar = function () {
      var filas = (resultado && resultado.filas || []).filter(function (f) { return seleccion[f.grabacion] && !f.sinGrabacion; });
      var grabs = filas.map(function (f) { return f.grabacion; });
      var omitidas = seleccionCount - grabs.length;
      if (!grabs.length) { setDescargando({ parte: 0, total: 0, errores: ["Ninguna de las tildadas tiene grabación disponible."] }); return; }
      var lotes = []; for (var i = 0; i < grabs.length; i += 50) lotes.push(grabs.slice(i, i + 50));
      setDescargando({ parte: 0, total: lotes.length, errores: omitidas > 0 ? [omitidas + " llamada(s) sin grabación: no se incluyen."] : [] });
      var procesarLote = function (idx) {
        if (idx >= lotes.length) return;
        fetch(V2.config.api.zip, { method: "POST", headers: { "Content-Type": "application/json", "X-DASA-Token": V2.config.token }, body: JSON.stringify({ grabaciones: lotes[idx] }) })
          .then(function (r) {
            var ct = r.headers.get("content-type") || "";
            if (ct.indexOf("json") >= 0) return r.json().then(function (d) { throw new Error((d && d.error) || "Error generando el zip"); });
            return r.blob().then(function (blob) {
              var url = URL.createObjectURL(blob), a = document.createElement("a");
              a.href = url; a.download = "grabaciones_" + V2.hoy() + "_parte" + (idx + 1) + ".zip";
              document.body.appendChild(a); a.click(); document.body.removeChild(a);
              setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
            });
          }).catch(function (e) {
            setDescargando(function (p) { return Object.assign({}, p, { errores: (p ? p.errores : []).concat(["Parte " + (idx + 1) + ": " + ((e && e.message) || e)]) }); });
          }).finally(function () { setDescargando(function (p) { return Object.assign({}, p, { parte: idx + 1 }); }); procesarLote(idx + 1); });
      };
      procesarLote(0);
    };

    var filas = (resultado && resultado.filas) || [];
    var desdeN = resultado ? ((resultado.pagina - 1) * resultado.porPagina + (filas.length ? 1 : 0)) : 0;
    var hastaN = resultado ? ((resultado.pagina - 1) * resultado.porPagina + filas.length) : 0;

    return <div>
      <div className="v2-dos">
        <PanelFiltros filtros={filtros} setFiltros={setFiltros} catalogo={catalogoClientes} conteosClientes={conteosClientes}
          tipifsCat={tipifsParaMostrar} cargandoTipifs={cargandoTipifs}
          numerosTexto={numerosTexto} setNumerosTexto={setNumerosTexto} onCargarArchivo={onCargarArchivo} msgCarga={msgCarga}
          onBuscar={onBuscar} onLimpiar={onLimpiar} buscando={buscando} />

        <div style={{ minWidth: 0 }}>
          {pedido && pedido.etiqueta && <V2.Aviso tipo="info">Llamadas de <b>{pedido.etiqueta}</b> buscadas directo en Neotel: están todas, las haya analizado o no el cron. Tocá “Analizar” en las que quieras.</V2.Aviso>}
          {errBusq && <V2.Aviso tipo="error" onCerrar={function () { setErrBusq(""); }}>{errBusq}</V2.Aviso>}
          {avisoGeneral && <V2.Aviso tipo="alerta" onCerrar={function () { setAvisoGeneral(""); pausaRef.current = false; }}>{avisoGeneral}</V2.Aviso>}

          <ChipsFiltros filtros={filtros} numerosTexto={numerosTexto} carterasIndex={carterasIndex} onQuitar={onQuitarChip} onLimpiar={onLimpiar} />

          {resultado && <IndicadoresBusqueda total={resultado.total} filas={filas} resultadosMap={resultadosMap} />}

          <BarraAcciones seleccionCount={seleccionCount} onPedirAnalizar={onPedirAnalizar}
            colaActiva={!!progreso} progreso={progreso || { hechas: 0, total: 0 }} onCancelarCola={onCancelarCola}
            onDescargar={onDescargar} onDestildar={onDestildar} />

          {buscando && <V2.Cargando texto="Buscando llamadas…" />}

          {resultado && !buscando && <div>
            {(resultado.avisos || []).map(function (a, i) { return <V2.Aviso key={i} tipo="alerta">{a}</V2.Aviso>; })}
            {resultado.topeAlcanzado && <V2.Aviso tipo="alerta">Se alcanzó el tope de 5000 resultados: refiná los filtros para ver el resto.</V2.Aviso>}
            {resultado.explicaciones && Object.keys(resultado.explicaciones).length > 0 && <V2.Aviso tipo="info">
              Sin resultados para: {Object.keys(resultado.explicaciones).map(function (n) { return n + " (" + resultado.explicaciones[n] + ")"; }).join(" · ")}
            </V2.Aviso>}

            <TablaResultados filas={ordenarFilas(filas, orden, { mapaOps: mapaOps, resultadosMap: resultadosMap })} orden={orden} onOrden={setOrden}
              mapaOps={mapaOps} seleccion={seleccion} onToggleSel={onToggleSel} onToggleTodasPagina={onToggleTodasPagina}
              filaExpandida={filaExpandida} onTogglePlay={onTogglePlay} resultadosMap={resultadosMap}
              procesandoFila={procesandoFila} erroresFila={erroresFila} audioFaltante={audioFaltante} onAudioFaltante={marcarAudioFaltante} onAudioRevisar={revisarAudio} onAnalizarUna={onAnalizarUna} onReintentarUna={onReintentarUna} onAbrirModal={onAbrirModal} />

            <div className="v2-sub" style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 2px", flexWrap: "wrap" }}>
              <span>Mostrando {desdeN}–{hastaN} de {resultado.total} · búsqueda en {resultado.ms} ms{resultado.total > filas.length ? " · tocá el título de una columna para ordenar esta página" : " · tocá el título de una columna para ordenar"}</span>
              <span>
                <V2.Boton tipo="secundario" chico disabled={resultado.pagina <= 1} onClick={function () { ejecutarBusqueda(resultado.pagina - 1); }}>Anterior</V2.Boton>{" "}
                <V2.Boton tipo="secundario" chico disabled={!resultado.hayMas} onClick={function () { ejecutarBusqueda(resultado.pagina + 1); }}>Siguiente</V2.Boton>
              </span>
            </div>
          </div>}

          {descargando && <V2.Tarjeta titulo="Descarga de grabaciones">
            <div className="v2-sub">{descargando.total ? ("Parte " + Math.min(descargando.parte, descargando.total) + " de " + descargando.total) : "Nada para descargar."}</div>
            {(descargando.errores || []).map(function (e, i) { return <V2.Aviso key={i} tipo="error">{e}</V2.Aviso>; })}
            {descargando.total > 0 && descargando.parte >= descargando.total && <V2.Aviso tipo="ok">Listo.</V2.Aviso>}
            <V2.Boton tipo="link" onClick={function () { setDescargando(null); }}>Cerrar</V2.Boton>
          </V2.Tarjeta>}
        </div>
      </div>

      {modal && <ModalScore resultado={modal.resultado} fila={modal.fila} lista={modal.lista} onElegir={function (r) { setModal(Object.assign({}, modal, { resultado: r })); }} mapaOps={mapaOps} onCerrar={function () { setModal(null); }} />}
      {elegir && <ModalElegirAnalisis filas={elegir} params={paramsCliente} modo={modoAnalisis} setModo={setModoAnalisis}
        promptMedida={promptMedida} setPromptMedida={setPromptMedida} onConfirmar={onConfirmarElegir} onCerrar={function () { setElegir(null); }} />}
    </div>;
  }

  V2.ModalScore = ModalScore;   // lo reusa Control interno (control.jsx)
  V2.registrar({ id: "buscar", titulo: "Buscar y analizar", grupo: "Calidad de audios", icono: "🔎", orden: 1, componente: PantallaBuscar });
})();

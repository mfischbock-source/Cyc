// ═══════════════════════════════════════════════════════════════════════════════════════
// PANTALLA "Control interno" (reemplaza "Calidad de gestión" de la app anterior).
// Pedido de Matías (mail 28/09): Audios → Control interno. Mismos datos que la app anterior:
// analisis_llamadas (lo escribe el cron cada noche + los análisis manuales), objetivo en
// configuracion/objetivo. Lee SOLO el mes elegido (la app anterior leía la colección entera
// y eso agota la cuota diaria de Firestore).
// Sintaxis: var + function(){}, SIN ?. ni ??  (Babel 7.24.7 en el navegador).
// ═══════════════════════════════════════════════════════════════════════════════════════
(function () {
  var MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

  function mesActual() { return V2.hoy().slice(0, 7); }
  function etiquetaMes(ym) { var p = String(ym).split("-"); return MESES[(+p[1] || 1) - 1] + " " + p[0]; }
  function ultimosMeses(n) {
    var out = [], d = new Date(); d.setDate(1);
    for (var i = 0; i < n; i++) {
      out.push(d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2));
      d.setMonth(d.getMonth() - 1);
    }
    return out;
  }
  function diasDelMes(ym) {
    var p = ym.split("-"), n = new Date(+p[0], +p[1], 0).getDate(), out = [];
    for (var i = 1; i <= n; i++) out.push(ym + "-" + ("0" + i).slice(-2));
    return out;
  }
  function promedio(arr) { return arr.length ? Math.round(arr.reduce(function (a, b) { return a + b; }, 0) / arr.length) : null; }
  function esValida(d) { return d.es_valida !== false && typeof d.score === "number"; }

  // ── Resumen mensual cacheado ───────────────────────────────────────────────────────────
  // Un mes son ~16.000 análisis (6 MB con transcripciones). Leerlos cada vez que se abre la
  // pantalla gasta 16.000 lecturas (el plan gratis da 50.000/día). Por eso se guarda un
  // resumen por mes en control_resumen/{YYYY-MM}:
  //   { gestores: { neotelId: { nombre, cartera, noAptas: {fecha:n}, dias: {fecha:[suma,n]} } },
  //     hastaDia, actualizado }
  // y en cada apertura solo se recalculan los últimos DIAS_REFRESCO días (el cron re-analiza
  // los últimos 2 días cada noche). "Recalcular mes" rehace todo.
  var COL_RESUMEN = "control_resumen";
  var DIAS_REFRESCO = 3;
  var MIN_ENTRE_REFRESCOS = 30;   // si el resumen se actualizó hace menos, no se vuelve a leer nada

  function sumarDias(iso, n) {
    var d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n);
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  // Agrega docs de analisis_llamadas sobre un resumen (pisa los días que aparecen en los docs).
  function agregar(resumen, docs, desdeDia) {
    var gs = resumen.gestores = resumen.gestores || {};
    // Los días desde `desdeDia` se recalculan de cero (los re-analiza el cron).
    if (desdeDia) Object.keys(gs).forEach(function (k) {
      Object.keys(gs[k].dias || {}).forEach(function (f) { if (f >= desdeDia) delete gs[k].dias[f]; });
      Object.keys(gs[k].noAptas || {}).forEach(function (f) { if (f >= desdeDia) delete gs[k].noAptas[f]; });
    });
    docs.forEach(function (d) {
      var id = String(d.neotelId || "").trim() || ("?" + (d.gestor || "sin-id"));
      var f = d.fecha || "";
      if (!f) return;
      var g = gs[id] || (gs[id] = { nombre: "", cartera: "", dias: {}, noAptas: {} });
      if (!g.nombre && d.gestor) g.nombre = d.gestor;
      if (!g.cartera && d.cliente) g.cartera = d.cliente;
      if (!esValida(d)) { g.noAptas[f] = (g.noAptas[f] || 0) + 1; return; }
      var x = g.dias[f] || (g.dias[f] = [0, 0]);
      x[0] += d.score; x[1] += 1;
    });
    return resumen;
  }

  function filasDesdeResumen(resumen, mapaOps, objetivo) {
    var gs = (resumen && resumen.gestores) || {};
    return Object.keys(gs).map(function (id) {
      var g = gs[id];
      var dias = Object.keys(g.dias || {}).sort();
      var suma = 0, n = 0, porDia = {};
      dias.forEach(function (f) { suma += g.dias[f][0]; n += g.dias[f][1]; porDia[f] = g.dias[f]; });
      var prom = function (lista) { var s = 0, c = 0; lista.forEach(function (f) { s += g.dias[f][0]; c += g.dias[f][1]; }); return c ? Math.round(s / c) : null; };
      var pU = prom(dias.slice(-5)), pP = prom(dias.slice(-10, -5));
      var score = n ? Math.round(suma / n) : null;
      var noAptas = Object.keys(g.noAptas || {}).reduce(function (a, f) { return a + g.noAptas[f]; }, 0);
      return {
        id: id, neotelId: id.charAt(0) === "?" ? "" : id,
        nombre: (mapaOps[id] && mapaOps[id].nombre) || g.nombre || ("Operador " + id),
        cartera: g.cartera || (mapaOps[id] && mapaOps[id].cliente) || "",
        porDia: porDia, score: score, llamadas: n, noAptas: noAptas,
        tendencia: (pU !== null && pP !== null) ? pU - pP : null,
        bajoObjetivo: n > 0 && score < objetivo
      };
    });
  }

  function leerAnalisis(desde, hasta) {
    return V2.db.collection("analisis_llamadas").where("fecha", ">=", desde).where("fecha", "<=", hasta).get()
      .then(function (sn) { return sn.docs.map(function (d) { return d.data(); }); });
  }

  // Devuelve {resumen, origen, aviso}. forzar = recalcular el mes entero.
  function cargarResumen(ym, forzar) {
    var ref = V2.db.collection(COL_RESUMEN).doc(ym);
    var hoy = V2.hoy();
    var finMes = ym + "-31";
    var esMesPasado = ym < hoy.slice(0, 7);
    return ref.get().catch(function () { return null; }).then(function (doc) {
      var previo = doc && doc.exists ? doc.data() : null;
      var minutos = previo && previo.actualizado ? (Date.now() - Date.parse(previo.actualizado)) / 60000 : 1e9;
      // Mes cerrado ya resumido, o resumen recién hecho: no se lee nada más.
      if (previo && !forzar && (minutos < MIN_ENTRE_REFRESCOS || previo.cerrado)) {
        return { resumen: previo, origen: "cache" };
      }
      var desde = (!previo || forzar) ? (ym + "-01") : sumarDias(previo.hastaDia || (ym + "-01"), -DIAS_REFRESCO);
      if (desde < ym + "-01") desde = ym + "-01";
      return leerAnalisis(desde, finMes).then(function (docs) {
        var base = (!previo || forzar) ? { gestores: {} } : JSON.parse(JSON.stringify(previo));
        var res = agregar(base, docs, (!previo || forzar) ? null : desde);
        res.hastaDia = hoy < finMes ? hoy : finMes;
        res.actualizado = new Date().toISOString();
        res.cerrado = esMesPasado;
        return ref.set(res).then(function () { return { resumen: res, origen: (!previo || forzar) ? "completo" : "incremental", leidos: docs.length }; },
          function (e) { return { resumen: res, origen: "sin-guardar", leidos: docs.length, aviso: "No se pudo guardar el resumen (" + ((e && e.code) || e) + "): cada apertura va a leer el mes entero." }; });
      });
    });
  }

  // ── Piezas visuales ─────────────────────────────────────────────────────────────────────
  function ChipScore(props) {
    var s = props.score;
    if (s === null || s === undefined) return <span className="v2-sub">—</span>;
    var col = V2.scoreColor(s);
    return <span className="v2-num" style={{ fontWeight: 700, color: col, background: col + "14", border: "1px solid " + col + "44", borderRadius: 10, padding: "1px 8px", whiteSpace: "nowrap" }}>
      {s}{props.conEtiqueta ? (" · " + V2.scoreLabel(s)) : ""}
    </span>;
  }

  function Tendencia(props) {
    var t = props.valor;
    if (t === null || t === undefined) return <span className="v2-sub">—</span>;
    var col = t > 2 ? V2.C.ok : t < -2 ? V2.C.danger : V2.C.muted;
    return <span className="v2-num" style={{ color: col, fontWeight: 600 }} title="Promedio de los últimos 5 días con análisis contra los 5 anteriores">
      {t > 2 ? "▲" : t < -2 ? "▼" : "▬"} {t > 0 ? "+" : ""}{t}
    </span>;
  }

  // Barras por día del mes (CSS puro, sin librerías). La línea punteada es el objetivo.
  function BarrasDias(props) { // {ym, porDia:{fecha:[suma, n]}, objetivo, alto}
    var alto = props.alto || 120;
    var dias = diasDelMes(props.ym);
    return <div style={{ position: "relative", height: alto + 18, padding: "0 2px" }}>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 18 + alto * props.objetivo / 100, borderTop: "1px dashed " + V2.C.warn }} title={"Objetivo " + props.objetivo} />
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: alto }}>
        {dias.map(function (f) {
          var x = props.porDia[f];
          var p = x && x[1] ? Math.round(x[0] / x[1]) : null;
          return <div key={f} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}
            title={V2.fmtFecha(f) + (p !== null ? (" · score " + p + " · " + x[1] + " llamada(s)") : " · sin análisis")}>
            <div style={{ height: p !== null ? Math.max(3, alto * p / 100) : 2, background: p !== null ? V2.scoreColor(p) : V2.C.border, borderRadius: "3px 3px 0 0" }} />
          </div>;
        })}
      </div>
      <div style={{ display: "flex", gap: 2, fontSize: 9, color: V2.C.tinta3, marginTop: 3 }}>
        {dias.map(function (f, i) { return <div key={f} style={{ flex: 1, textAlign: "center" }}>{(i === 0 || (i + 1) % 5 === 0) ? (i + 1) : ""}</div>; })}
      </div>
    </div>;
  }

  function Indicador(props) {
    return <div className="v2-tarjeta" style={{ flex: "1 1 160px", margin: 0, padding: "12px 14px" }}>
      <div className="v2-sub" style={{ textTransform: "uppercase", letterSpacing: ".06em" }}>{props.titulo}</div>
      <div className="v2-num" style={{ fontSize: 24, fontWeight: 600, color: props.color || V2.C.text }}>{props.valor}</div>
      {props.pie && <div className="v2-sub">{props.pie}</div>}
    </div>;
  }

  // ── Detalle de un gestor ────────────────────────────────────────────────────────────────
  function DetalleGestor(props) { // {fila, ym, objetivo, onVolver, mapaOps}
    var g = props.fila;
    var st = useState(null); var abierto = st[0], setAbierto = st[1];
    var stF = useState("todas"); var filtro = stF[0], setFiltro = stF[1];
    var stDocs = useState(null); var docs = stDocs[0], setDocs = stDocs[1];
    var stErr = useState(""); var err = stErr[0], setErr = stErr[1];
    useEffect(function () {
      var vivo = true;
      if (!g.neotelId) { setDocs([]); return; }
      // Sus análisis (filtro simple por neotelId: no necesita índice compuesto) y el mes se recorta acá.
      V2.db.collection("analisis_llamadas").where("neotelId", "==", String(g.neotelId)).get().then(function (sn) {
        if (!vivo) return;
        setDocs(sn.docs.map(function (d) { return d.data(); }).filter(function (d) { return String(d.fecha || "").slice(0, 7) === props.ym; }));
      }).catch(function (e) { if (vivo) { setErr("No se pudieron cargar las llamadas: " + ((e && e.message) || e)); setDocs([]); } });
      return function () { vivo = false; };
    }, [g.neotelId, props.ym]);
    var validas = (docs || []).filter(esValida);
    var lista = validas.slice().sort(function (a, b) { return a.score - b.score; });
    if (filtro === "bajo") lista = lista.filter(function (d) { return d.score < props.objetivo; });
    var aResultado = function (d) { // formato que espera V2.ModalScore (el de analisis_v2)
      var cuando = d.analizadoEn || (d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : "") || d.fecha;
      return Object.assign({}, d, { analisis: d, analizadoEn: cuando, metodoTitulo: d.origen === "auto" ? "Análisis automático (cron nocturno)" : "Análisis manual", usuario: d.neotelId });
    };
    return <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <V2.Boton tipo="secundario" chico onClick={props.onVolver}>← Equipo</V2.Boton>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{g.nombre}</div>
        <span className="v2-sub">{g.cartera || "—"} · Neotel {g.neotelId || "—"}</span>
        {(function () {
          // Buscar toma 4 a 6 dígitos como ID de operador (ver _buscar_helpers.php).
          var idOk = /^\d{4,6}$/.test(String(g.neotelId || ""));
          var finMes = diasDelMes(props.ym).slice(-1)[0];
          var hasta = finMes < V2.hoy() ? finMes : V2.hoy();
          return <span style={{ marginLeft: "auto" }}>
            <V2.Boton tipo="secundario" chico disabled={!idOk}
              title={idOk ? "Trae de Neotel TODAS sus llamadas del mes (también las que el cron descartó o todavía no pasó) para analizarlas a pedido" : "Este gestor no tiene un ID de Neotel de 4 a 6 dígitos"}
              onClick={function () { V2.irA("buscar", { numeros: [String(g.neotelId)], desde: props.ym + "-01", hasta: hasta, etiqueta: g.nombre + " · " + etiquetaMes(props.ym) }); }}>
              🔎 Buscar todas sus llamadas en Neotel
            </V2.Boton>
          </span>;
        })()}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <Indicador titulo={"Score " + etiquetaMes(props.ym)} valor={g.score !== null ? g.score : "—"} color={g.score !== null ? V2.scoreColor(g.score) : null} pie={g.score !== null ? V2.scoreLabel(g.score) : "sin análisis"} />
        <Indicador titulo="Llamadas evaluadas" valor={g.llamadas} pie={g.noAptas ? (g.noAptas + " descartadas (por tipificación del CRM o sin conversación real)") : ""} />
        <Indicador titulo="Bajo objetivo" valor={docs === null ? "…" : validas.filter(function (d) { return d.score < props.objetivo; }).length} pie={"llamadas con menos de " + props.objetivo} />
        <Indicador titulo="Tendencia" valor={<Tendencia valor={g.tendencia} />} pie="últimos 5 días vs 5 anteriores" />
      </div>
      <V2.Tarjeta titulo="Score día a día">
        <BarrasDias ym={props.ym} porDia={g.porDia} objetivo={props.objetivo} />
      </V2.Tarjeta>
      {err && <V2.Aviso tipo="error">{err}</V2.Aviso>}
      {docs === null ? <V2.Cargando texto="Cargando llamadas del gestor…" /> :
      <V2.Tarjeta titulo={"Llamadas evaluadas (" + lista.length + ") — de menor a mayor score, para hacer coaching"}>
        <div style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
          <select value={filtro} onChange={function (e) { setFiltro(e.target.value); }} style={V2.estiloInput}>
            <option value="todas">Todas</option>
            <option value="bajo">Solo bajo objetivo</option>
          </select>
        </div>
        <div className="v2-tabla-caja"><table className="v2-tabla v2-tarjetas">
          <thead><tr><th>Fecha</th><th>Duración</th><th>Tipificación</th><th>DNI</th><th>Score</th><th></th></tr></thead>
          <tbody>
            {lista.map(function (d) {
              return <tr key={d.grabacion || d.idLlamada}>
                <td data-label="Fecha" className="v2-num">{V2.fmtFecha(d.fecha)} {d.hora || ""}<span className="v2-sub v2-num">ID {d.idLlamada || "—"}</span></td>
                <td data-label="Duración" className="v2-num">{d.dur || V2.fmtDur(d.durSeg)}</td>
                <td data-label="Tipificación">{d.tipif ? <span className="v2-tip">{d.tipif}</span> : <span className="v2-sub">—</span>}</td>
                <td data-label="DNI" className="v2-num">{d.dni || "—"}</td>
                <td data-label="Score"><ChipScore score={d.score} /></td>
                <td><V2.Boton tipo="link" chico onClick={function () { setAbierto(d); }}>Ver por qué</V2.Boton></td>
              </tr>;
            })}
            {!lista.length && <tr><td colSpan={6} className="v2-sub" style={{ padding: 18, textAlign: "center" }}>Sin llamadas para este filtro.</td></tr>}
          </tbody>
        </table></div>
      </V2.Tarjeta>}
      {abierto && V2.ModalScore && <V2.ModalScore resultado={aResultado(abierto)} fila={{ telefono: abierto.telefono }}mapaOps={props.mapaOps} onCerrar={function () { setAbierto(null); }} />}
    </div>;
  }

  // ── Pantalla ────────────────────────────────────────────────────────────────────────────
  function PantallaControl() {
    var mapaOps = V2.useOperadores();
    var stMes = useState(mesActual()); var ym = stMes[0], setYm = stMes[1];
    var stRes = useState(null); var res = stRes[0], setRes = stRes[1];
    var stRecalc = useState(0); var recalc = stRecalc[0], setRecalc = stRecalc[1];
    var stErr = useState(""); var err = stErr[0], setErr = stErr[1];
    var stObj = useState(85); var objetivo = stObj[0], setObjetivo = stObj[1];
    var stCart = useState("todas"); var cartera = stCart[0], setCartera = stCart[1];
    var stQ = useState(""); var q = stQ[0], setQ = stQ[1];
    var stOrden = useState("score"); var orden = stOrden[0], setOrden = stOrden[1];
    var stSel = useState(null); var selId = stSel[0], setSelId = stSel[1];
    var stEditObj = useState(false); var editObj = stEditObj[0], setEditObj = stEditObj[1];

    useEffect(function () {
      V2.db.collection("configuracion").doc("objetivo").get().then(function (d) {
        if (d.exists && typeof d.data().score === "number") setObjetivo(d.data().score);
      }).catch(function () {});
    }, []);

    useEffect(function () {
      var vivo = true;
      setRes(null); setErr("");
      cargarResumen(ym, recalc > 0)
        .then(function (r) { if (!vivo) return; setRes(r); if (r.aviso) setErr(r.aviso); })
        .catch(function (e) {
          if (!vivo) return;
          var m = String((e && e.message) || e);
          setErr(/quota|exhausted/i.test(m) ? "Firestore agotó la cuota diaria del plan gratis: no se pueden leer los análisis hasta mañana (o hasta pasar a Blaze)." : ("No se pudieron cargar los análisis: " + m));
          setRes({ resumen: { gestores: {} }, origen: "error" });
        });
      return function () { vivo = false; };
    }, [ym, recalc]);

    var guardarObjetivo = function (v) {
      var n = Math.max(1, Math.min(100, parseInt(v, 10) || 85));
      setObjetivo(n); setEditObj(false);
      V2.db.collection("configuracion").doc("objetivo").set({ score: n }, { merge: true }).catch(function (e) { setErr("No se pudo guardar el objetivo: " + ((e && e.message) || e)); });
    };

    if (res === null) return <V2.Cargando texto={"Cargando análisis de " + etiquetaMes(ym) + "… (la primera vez en el mes puede tardar ~20 s)"} />;

    var filas = filasDesdeResumen(res.resumen, mapaOps, objetivo);
    var hayDatos = filas.length > 0;
    var carteras = filas.map(function (f) { return f.cartera; }).filter(function (c, i, a) { return c && a.indexOf(c) === i; }).sort();
    var filtradas = filas.filter(function (f) {
      if (cartera !== "todas" && f.cartera !== cartera) return false;
      if (q && (f.nombre + " " + f.neotelId).toLowerCase().indexOf(q.toLowerCase()) < 0) return false;
      return true;
    }).sort(function (a, b) {
      if (orden === "nombre") return a.nombre.localeCompare(b.nombre);
      if (orden === "llamadas") return b.llamadas - a.llamadas;
      var sa = a.score === null ? 999 : a.score, sb = b.score === null ? 999 : b.score;
      return sa - sb;                                         // peor primero: a quién hay que acompañar
    });

    var sel = null;
    for (var i = 0; i < filas.length; i++) { if (filas[i].id === selId) sel = filas[i]; }
    if (sel) return <DetalleGestor fila={sel} ym={ym} objetivo={objetivo} mapaOps={mapaOps} onVolver={function () { setSelId(null); }} />;

    var porDiaEquipo = {}, sumaEq = 0, nEq = 0;
    filtradas.forEach(function (f) {
      Object.keys(f.porDia).forEach(function (d) {
        var x = porDiaEquipo[d] || (porDiaEquipo[d] = [0, 0]);
        x[0] += f.porDia[d][0]; x[1] += f.porDia[d][1]; sumaEq += f.porDia[d][0]; nEq += f.porDia[d][1];
      });
    });
    var scoreEquipo = nEq ? Math.round(sumaEq / nEq) : null;
    var bajo = filtradas.filter(function (f) { return f.bajoObjetivo; }).length;
    var noAptas = filtradas.reduce(function (a, f) { return a + f.noAptas; }, 0);

    var exportar = function () {
      var rows = filtradas.map(function (f) {
        return { Gestor: f.nombre, "Neotel ID": f.neotelId, Cartera: f.cartera, Score: f.score === null ? "" : f.score, "Llamadas evaluadas": f.llamadas, "No aptas": f.noAptas, Tendencia: f.tendencia === null ? "" : f.tendencia, "Bajo objetivo": f.bajoObjetivo ? "Sí" : "" };
      });
      var ws = XLSX.utils.json_to_sheet(rows), wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Control interno");
      XLSX.writeFile(wb, "control-interno-" + ym + ".xlsx");
    };

    return <div>
      {err && <V2.Aviso tipo="error" onCerrar={function () { setErr(""); }}>{err}</V2.Aviso>}
      <div className="v2-tarjeta" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <V2.Campo etiqueta="Mes">
          <select value={ym} onChange={function (e) { setYm(e.target.value); }} style={V2.estiloInput}>
            {ultimosMeses(12).map(function (m) { return <option key={m} value={m}>{etiquetaMes(m)}</option>; })}
          </select>
        </V2.Campo>
        <V2.Campo etiqueta="Cartera">
          <select value={cartera} onChange={function (e) { setCartera(e.target.value); }} style={V2.estiloInput}>
            <option value="todas">Todas</option>
            {carteras.map(function (c) { return <option key={c} value={c}>{c}</option>; })}
          </select>
        </V2.Campo>
        <V2.Campo etiqueta="Gestor">
          <input value={q} onChange={function (e) { setQ(e.target.value); }} placeholder="Nombre o ID de Neotel" style={V2.estiloInput} />
        </V2.Campo>
        <V2.Campo etiqueta="Ordenar">
          <select value={orden} onChange={function (e) { setOrden(e.target.value); }} style={V2.estiloInput}>
            <option value="score">Peor score primero</option>
            <option value="llamadas">Más llamadas</option>
            <option value="nombre">Nombre</option>
          </select>
        </V2.Campo>
        <V2.Campo etiqueta="Objetivo">
          {editObj && V2.puede("metodos")
            ? <input type="number" min="1" max="100" defaultValue={objetivo} autoFocus style={Object.assign({}, V2.estiloInput, { width: 70 })}
              onBlur={function (e) { guardarObjetivo(e.target.value); }} onKeyDown={function (e) { if (e.key === "Enter") guardarObjetivo(e.target.value); }} />
            : <span style={{ display: "inline-flex", gap: 6, alignItems: "center", height: 31 }}>
              <b className="v2-num">{objetivo}</b>
              {V2.puede("metodos") && <V2.Boton tipo="link" chico onClick={function () { setEditObj(true); }}>cambiar</V2.Boton>}
            </span>}
        </V2.Campo>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {V2.puede("metodos") && <V2.Boton tipo="secundario" chico title="Vuelve a leer todos los análisis del mes (~16.000 lecturas de Firestore). Usar solo si los números no cierran." onClick={function () { if (window.confirm("¿Recalcular " + etiquetaMes(ym) + " desde cero? Lee todos los análisis del mes (tarda ~20 s y gasta cuota de Firestore).")) setRecalc(recalc + 1); }}>↻ Recalcular mes</V2.Boton>}
          <V2.Boton tipo="secundario" chico disabled={!filtradas.length} onClick={exportar}>⬇ Excel</V2.Boton>
        </span>
      </div>
      {res.resumen.actualizado && <div className="v2-sub" style={{ margin: "-4px 0 10px" }}>Datos al {new Date(res.resumen.actualizado).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · se actualiza solo con lo que analiza el cron cada noche.</div>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <Indicador titulo="Score del equipo" valor={scoreEquipo !== null ? scoreEquipo : "—"} color={scoreEquipo !== null ? V2.scoreColor(scoreEquipo) : null} pie={scoreEquipo !== null ? V2.scoreLabel(scoreEquipo) : "sin análisis este mes"} />
        <Indicador titulo="Llamadas evaluadas" valor={nEq} pie={noAptas ? (noAptas + " descartadas (tipificación o sin conversación)") : ""} />
        <Indicador titulo="Gestores" valor={filtradas.length} pie={bajo ? (bajo + " bajo objetivo") : "todos en objetivo"} color={bajo ? V2.C.danger : null} />
      </div>

      {nEq > 0 && <V2.Tarjeta titulo={"Score del equipo día a día — " + etiquetaMes(ym)}>
        <BarrasDias ym={ym} porDia={porDiaEquipo} objetivo={objetivo} alto={90} />
      </V2.Tarjeta>}

      <V2.Tarjeta titulo="Gestores">
        <div className="v2-tabla-caja"><table className="v2-tabla v2-tarjetas">
          <thead><tr><th>Gestor</th><th>Cartera</th><th>Score</th><th>Llamadas</th><th>Tendencia</th><th></th></tr></thead>
          <tbody>
            {filtradas.map(function (f) {
              return <tr key={f.id} style={{ cursor: "pointer" }} onClick={function () { setSelId(f.id); }}>
                <td style={{ fontWeight: 600 }}>{f.nombre}{f.bajoObjetivo && <span title="Bajo objetivo" style={{ color: V2.C.danger }}> ●</span>}<span className="v2-sub v2-num">Neotel {f.neotelId || "—"}</span></td>
                <td data-label="Cartera">{f.cartera || "—"}</td>
                <td data-label="Score"><ChipScore score={f.score} conEtiqueta /></td>
                <td data-label="Llamadas" className="v2-num">{f.llamadas}{f.noAptas ? <span className="v2-sub">+{f.noAptas} descartadas</span> : null}</td>
                <td data-label="Tendencia"><Tendencia valor={f.tendencia} /></td>
                <td><V2.Boton tipo="link" chico>Ver detalle →</V2.Boton></td>
              </tr>;
            })}
            {!filtradas.length && <tr><td colSpan={6} className="v2-sub" style={{ padding: 20, textAlign: "center" }}>
              {hayDatos ? "Ningún gestor coincide con el filtro." : ("No hay llamadas analizadas en " + etiquetaMes(ym) + ". El análisis automático corre cada noche.")}
            </td></tr>}
          </tbody>
        </table></div>
      </V2.Tarjeta>
    </div>;
  }

  V2.registrar({ id: "control-interno", titulo: "Control interno", grupo: "Calidad de audios", icono: "🛡️", orden: 2, componente: PantallaControl });
  V2._controlInterno = { agregar: agregar, filasDesdeResumen: filasDesdeResumen, diasDelMes: diasDelMes, cargarResumen: cargarResumen };   // para probar desde la consola
})();

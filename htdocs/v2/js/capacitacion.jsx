// ═══════════════════════════════════════════════════════════════════════════════════════
// PANTALLAS "Capacitación" de la v2 — lado supervisor: Cursos (crear/editar) y Seguimiento.
// Portado de capacitacion.html (Cursos, CursoEditor, Seguimiento) con los MISMOS datos:
// cap2_cursos / cap2_progreso / cap2_intentos / usuarios. Los gestores siguen haciendo sus
// cursos en la app anterior (/anterior/ → Capacitación): lo que se carga acá les aparece allá.
// Suma lo de Mariana (29/07): material con "revisar cada X días" → Vence pronto / Vencido.
// Sintaxis: var + function(){}, SIN ?. ni ??  (Babel 7.24.7 en el navegador).
// ═══════════════════════════════════════════════════════════════════════════════════════
(function () {
  var COL = { cursos: "cap2_cursos", progreso: "cap2_progreso", intentos: "cap2_intentos" };
  var URL_UPLOAD = "../upload.php";
  var DIAS_AVISO = 15;   // "vence pronto" cuando faltan menos de esto

  var AUDIENCIAS = [
    { v: "induccion", label: "Inducción", desc: "Gestores que ingresan", icon: "🌱" },
    { v: "continua", label: "Continua", desc: "Gestores en actividad", icon: "📈" },
    { v: "cartera", label: "Por cartera", desc: "Solo una cartera", icon: "🏦" }
  ];
  function audInfo(v) { for (var i = 0; i < AUDIENCIAS.length; i++) if (AUDIENCIAS[i].v === v) return AUDIENCIAS[i]; return AUDIENCIAS[1]; }
  var ICONO_TIPO = { pdf: "📄", video: "🎬", audio: "🎧", imagen: "🖼️", doc: "📊", youtube: "▶️", link: "🔗", archivo: "📎" };

  function tipoDe(nombre) {
    var s = String(nombre || "").toLowerCase();
    if (/youtube\.com|youtu\.be/.test(s)) return "youtube";
    if (/^https?:\/\//.test(s)) return "link";
    var e = s.split(".").pop();
    if (e === "pdf") return "pdf";
    if (["mp4", "webm", "mov"].indexOf(e) >= 0) return "video";
    if (["mp3", "wav", "m4a", "ogg"].indexOf(e) >= 0) return "audio";
    if (["jpg", "jpeg", "png", "gif", "webp"].indexOf(e) >= 0) return "imagen";
    if (["ppt", "pptx", "doc", "docx", "xls", "xlsx"].indexOf(e) >= 0) return "doc";
    return "archivo";
  }
  function fmtSeg(s) { s = Math.round(+s || 0); var m = Math.floor(s / 60); return m > 0 ? (m + "m " + (s % 60) + "s") : (s + "s"); }
  function idCorto() { return "m" + Math.random().toString(36).slice(2, 9); }
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function copia(o) { return JSON.parse(JSON.stringify(o)); }

  // ── Vencimiento de material (pedido de Mariana: "revisar cada X días") ────────────────
  function estadoMaterial(mat, hoyIso) {
    var dias = +mat.revisarCadaDias || 0;
    if (!dias || !mat.actualizadoEn) return { estado: "ok" };
    var vence = new Date(mat.actualizadoEn + "T00:00:00");
    vence.setDate(vence.getDate() + dias);
    var hoy = new Date((hoyIso || V2.hoy()) + "T00:00:00");
    var faltan = Math.round((vence - hoy) / 86400000);
    var venceIso = vence.getFullYear() + "-" + ("0" + (vence.getMonth() + 1)).slice(-2) + "-" + ("0" + vence.getDate()).slice(-2);
    if (faltan < 0) return { estado: "vencido", vence: venceIso, faltan: faltan };
    if (faltan <= DIAS_AVISO) return { estado: "pronto", vence: venceIso, faltan: faltan };
    return { estado: "ok", vence: venceIso, faltan: faltan };
  }
  function ChipVence(props) {
    var e = props.estado;
    if (e.estado === "vencido") return <V2.Chip color={V2.C.danger} title={"Venció el " + V2.fmtFecha(e.vence)}>Vencido</V2.Chip>;
    if (e.estado === "pronto") return <V2.Chip color={V2.C.warn} title={"Vence el " + V2.fmtFecha(e.vence)}>Vence pronto ({e.faltan} d)</V2.Chip>;
    return null;
  }

  // ── Progreso (misma cuenta que capacitacion.html, para que coincidan los números) ──────
  function materialesDe(curso) { if (curso.materiales) return curso.materiales; return [].concat.apply([], (curso.modulos || []).map(function (m) { return m.materiales || []; })); }
  function progresoCurso(curso, prog) {
    var mats = materialesDe(curso);
    var pc = (prog && prog.cursos && prog.cursos[curso.id]) || { materiales: {}, examen: {} };
    var pm = pc.materiales || {};
    var vistos = mats.filter(function (m) { return pm[m.id] && pm[m.id].visto; }).length;
    var total = mats.length;
    var examOk = !curso.evaluacion || !!(pc.examen && pc.examen.aprobado);
    var sospechoso = mats.some(function (m) { var x = pm[m.id]; return x && x.visto && (x.segundos || 0) < 15; });
    var pct = total ? Math.round(vistos / total * 100) : (examOk ? 100 : 0);
    var segundos = mats.reduce(function (a, m) { return a + ((pm[m.id] && pm[m.id].segundos) || 0); }, 0);
    return { vistos: vistos, total: total, pct: pct, completo: (total === 0 || vistos === total) && examOk, examOk: examOk, sospechoso: sospechoso, segundos: segundos, examen: pc.examen || null };
  }
  function cursoVisible(curso, u) {
    if (!curso.activo) return false;
    var uid = u.uid;
    if (Array.isArray(curso.asignadosA) && curso.asignadosA.indexOf(uid) >= 0) return true;
    if (curso.audiencia === "induccion") return u.role === "ingreso";
    if (curso.audiencia === "continua") return u.role === "gestor" || u.role === "ingreso";
    if (curso.audiencia === "cartera") return String(curso.cartera || "") === String(u.cliente || u.cartera || "");
    return false;
  }

  // ── Datos ───────────────────────────────────────────────────────────────────────────────
  var datos = {
    cursos: function () {
      return V2.db.collection(COL.cursos).get().then(function (sn) {
        var arr = sn.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
        arr.sort(function (a, b) { return (a.orden || 0) - (b.orden || 0) || String(a.nombre).localeCompare(String(b.nombre)); });
        return arr;
      });
    },
    guardar: function (curso) {
      var id = curso.id || ("cur" + Date.now());
      var data = Object.assign({}, curso, { id: id, updatedAt: V2.hoy() });
      if (!data.createdAt) data.createdAt = V2.hoy();
      return V2.db.collection(COL.cursos).doc(id).set(data, { merge: true }).then(function () { return data; });
    },
    borrar: function (id) { return V2.db.collection(COL.cursos).doc(id).delete(); },
    gestores: function () {
      return V2.db.collection("usuarios").get().then(function (sn) {
        return sn.docs.map(function (d) { return Object.assign({ uid: d.id }, d.data()); })
          .filter(function (u) { return (u.role === "gestor" || u.role === "ingreso") && u.estado !== "inactivo"; });
      });
    },
    progresos: function () {
      return V2.db.collection(COL.progreso).get().then(function (sn) { var o = {}; sn.docs.forEach(function (d) { o[d.id] = d.data(); }); return o; });
    },
    intentos: function () {
      return V2.db.collection(COL.intentos).get().then(function (sn) {
        return sn.docs.map(function (d) { return d.data(); }).sort(function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); });
      });
    }
  };

  function subirArchivo(file, cartera) {
    var fd = new FormData();
    fd.append("file", file); fd.append("subtipo", "cap2"); fd.append("cartera", cartera || "General");
    return fetch(URL_UPLOAD, { method: "POST", body: fd }).then(function (r) {
      return r.json().catch(function () { return { error: "Respuesta no válida del servidor" }; }).then(function (j) {
        if (!r.ok || j.error) throw new Error(j.error || ("Error " + r.status));
        return j;
      });
    });
  }

  function errorTexto(e) {
    var m = String((e && e.message) || e);
    if (/quota|exhausted/i.test(m)) return "Firestore agotó la cuota diaria del plan gratis. Probá mañana o pasá el proyecto a Blaze.";
    if (/permission/i.test(m)) return "Firestore no dejó hacer esto con tu usuario (reglas de seguridad): " + m;
    return m;
  }

  function Barra(props) {
    var p = Math.min(100, props.pct || 0);
    return <div style={{ height: 8, background: V2.C.pale, borderRadius: 6, overflow: "hidden", minWidth: 60 }}>
      <div style={{ height: "100%", width: p + "%", background: p >= 100 ? V2.C.green : V2.C.light }} />
    </div>;
  }

  // ═══════════════════════════ Editor de curso ═════════════════════════════════════════
  function EditorCurso(props) { // {curso, gestores, onCancelar, onGuardado}
    var base = props.curso || {};
    var st = useState(function () {
      return {
        id: base.id || null, nombre: base.nombre || "", descripcion: base.descripcion || "", audiencia: base.audiencia || "continua",
        cartera: base.cartera || "", activo: base.activo !== false, orden: base.orden || 0, asignadosA: (base.asignadosA || []).slice(),
        materiales: copia(materialesDe(base)), evaluacion: base.evaluacion ? copia(base.evaluacion) : null
      };
    });
    var c = st[0], setC = st[1];
    var stSub = useState(""); var subiendo = stSub[0], setSubiendo = stSub[1];
    var stErr = useState(""); var err = stErr[0], setErr = stErr[1];
    var stG = useState(false); var guardando = stG[0], setGuardando = stG[1];
    var stDrag = useState(false); var drag = stDrag[0], setDrag = stDrag[1];
    var stQG = useState(""); var qG = stQG[0], setQG = stQG[1];
    var set = function (patch) { setC(function (prev) { return Object.assign({}, prev, patch); }); };

    var carteras = props.gestores.map(function (g) { return g.cliente || g.cartera; })
      .filter(function (x, i, a) { return x && a.indexOf(x) === i; }).sort();
    if (c.cartera && carteras.indexOf(c.cartera) < 0) carteras.push(c.cartera);

    var agregarArchivos = function (files) {
      var cola = Array.prototype.slice.call(files);
      var siguiente = function () {
        var f = cola.shift();
        if (!f) { setSubiendo(""); return; }
        setSubiendo(f.name); setErr("");
        subirArchivo(f, c.cartera || "General").then(function (r) {
          var mat = { id: idCorto(), titulo: f.name.replace(/\.[^.]+$/, ""), tipo: tipoDe(f.name), url: r.url, path: r.path || "", tamanio: r.size || f.size, actualizadoEn: V2.hoy(), revisarCadaDias: 0 };
          setC(function (prev) { return Object.assign({}, prev, { materiales: prev.materiales.concat([mat]) }); });
        }).catch(function (e) { setErr("No se pudo subir “" + f.name + "”: " + errorTexto(e)); }).then(siguiente);
      };
      siguiente();
    };
    var agregarLink = function () {
      var u = window.prompt("Pegá el link (YouTube, Drive, cualquier URL):");
      if (!u || !u.trim()) return; u = u.trim();
      if (!/^https?:\/\//i.test(u)) { setErr("El link tiene que empezar con http:// o https://"); return; }
      var mat = { id: idCorto(), titulo: tipoDe(u) === "youtube" ? "Video de YouTube" : "Enlace", tipo: tipoDe(u), url: u, tamanio: 0, actualizadoEn: V2.hoy(), revisarCadaDias: 0, link: true };
      set({ materiales: c.materiales.concat([mat]) });
    };
    var setMat = function (j, patch) { set({ materiales: c.materiales.map(function (x, k) { return k === j ? Object.assign({}, x, patch) : x; }) }); };
    var delMat = function (j) { set({ materiales: c.materiales.filter(function (x, k) { return k !== j; }) }); };
    var moverMat = function (j, d) {
      var arr = c.materiales.slice(), k = j + d;
      if (k < 0 || k >= arr.length) return;
      var t = arr[j]; arr[j] = arr[k]; arr[k] = t; set({ materiales: arr });
    };

    var preguntaVacia = function () { return { preg: "", opciones: ["", "", "", ""], correcta: 0 }; };
    var setEv = function (patch) { set({ evaluacion: Object.assign({}, c.evaluacion, patch) }); };
    var setPreg = function (i, patch) { setEv({ preguntas: c.evaluacion.preguntas.map(function (p, k) { return k === i ? Object.assign({}, p, patch) : p; }) }); };

    var guardar = function () {
      if (!c.nombre.trim()) { setErr("Poné un nombre al curso."); return; }
      if (c.audiencia === "cartera" && !c.cartera) { setErr("Elegí la cartera del curso."); return; }
      if (c.evaluacion) {
        for (var i = 0; i < c.evaluacion.preguntas.length; i++) {
          var p = c.evaluacion.preguntas[i];
          if (!p.preg.trim() || p.opciones.some(function (o) { return !String(o).trim(); })) { setErr("Completá todas las preguntas y opciones del examen (o quitá el examen)."); return; }
        }
      }
      setGuardando(true); setErr("");
      datos.guardar(Object.assign({}, c, { cartera: c.audiencia === "cartera" ? c.cartera : null }))
        .then(props.onGuardado).catch(function (e) { setErr("No se pudo guardar: " + errorTexto(e)); setGuardando(false); });
    };

    var gestoresF = props.gestores.filter(function (g) { return !qG || norm((g.name || g.user) + " " + (g.legajo || "")).indexOf(norm(qG)) >= 0; });

    return <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <V2.Boton tipo="secundario" chico onClick={props.onCancelar}>← Cursos</V2.Boton>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{c.id ? "Editar curso" : "Nuevo curso"}</div>
      </div>
      {err && <V2.Aviso tipo="error" onCerrar={function () { setErr(""); }}>{err}</V2.Aviso>}

      <V2.Tarjeta titulo="Datos del curso">
        <div style={{ display: "grid", gap: 10 }}>
          <V2.Campo etiqueta="Nombre"><input value={c.nombre} onChange={function (e) { set({ nombre: e.target.value }); }} placeholder="Ej: Guion Santander" style={V2.estiloInput} /></V2.Campo>
          <V2.Campo etiqueta="Descripción"><textarea value={c.descripcion} onChange={function (e) { set({ descripcion: e.target.value }); }} rows={2} style={Object.assign({}, V2.estiloInput, { resize: "vertical" })} /></V2.Campo>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <V2.Campo etiqueta="Audiencia (quién lo ve)">
              <select value={c.audiencia} onChange={function (e) { set({ audiencia: e.target.value }); }} style={V2.estiloInput}>
                {AUDIENCIAS.map(function (a) { return <option key={a.v} value={a.v}>{a.icon} {a.label} — {a.desc}</option>; })}
              </select>
            </V2.Campo>
            {c.audiencia === "cartera" && <V2.Campo etiqueta="Cartera">
              <select value={c.cartera} onChange={function (e) { set({ cartera: e.target.value }); }} style={V2.estiloInput}>
                <option value="">— Elegí —</option>
                {carteras.map(function (x) { return <option key={x} value={x}>{x}</option>; })}
              </select>
            </V2.Campo>}
            <V2.Boton tipo={c.activo ? "primario" : "secundario"} chico onClick={function () { set({ activo: !c.activo }); }}>{c.activo ? "✓ Activo" : "Inactivo"}</V2.Boton>
          </div>
          <div>
            <div className="v2-sub" style={{ marginBottom: 4 }}>Asignación puntual (opcional, además de la audiencia): gestores puntuales para refuerzo. {c.asignadosA.length ? (c.asignadosA.length + " elegido(s).") : ""}</div>
            <input value={qG} onChange={function (e) { setQG(e.target.value); }} placeholder="Buscar gestor…" style={Object.assign({}, V2.estiloInput, { marginBottom: 6 })} />
            <div style={{ maxHeight: 130, overflowY: "auto", border: "1px solid " + V2.C.border, borderRadius: 8, padding: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {!gestoresF.length && <span className="v2-sub">Sin gestores.</span>}
              {gestoresF.map(function (g) {
                var on = c.asignadosA.indexOf(g.uid) >= 0;
                return <V2.Chip key={g.uid} color={on ? V2.C.green : null}
                  onClick={function () { set({ asignadosA: on ? c.asignadosA.filter(function (x) { return x !== g.uid; }) : c.asignadosA.concat([g.uid]) }); }}>
                  {on ? "✓ " : ""}{g.name || g.user}{g.legajo ? (" (" + g.legajo + ")") : ""}
                </V2.Chip>;
              })}
            </div>
          </div>
        </div>
      </V2.Tarjeta>

      <V2.Tarjeta titulo="Material">
        <div onDragOver={function (e) { e.preventDefault(); setDrag(true); }} onDragLeave={function () { setDrag(false); }}
          onDrop={function (e) { e.preventDefault(); setDrag(false); if (e.dataTransfer.files && e.dataTransfer.files.length) agregarArchivos(e.dataTransfer.files); }}
          style={{ border: "2px dashed " + (drag ? V2.C.green : V2.C.border), background: drag ? V2.C.pale : V2.C.bg, borderRadius: 10, padding: "18px 14px", textAlign: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 600 }}>{subiendo ? ("⏳ Subiendo " + subiendo + "…") : "Arrastrá archivos acá (PDF, Word, Excel, PPT, video, audio, imagen)"}</div>
          <div className="v2-sub" style={{ marginTop: 6 }}>
            <label style={{ color: V2.C.info, cursor: "pointer", textDecoration: "underline" }}>elegir del disco
              <input type="file" multiple style={{ display: "none" }} onChange={function (e) { agregarArchivos(e.target.files); e.target.value = ""; }} /></label>
            {" · "}<a onClick={agregarLink} style={{ color: V2.C.info, cursor: "pointer", textDecoration: "underline" }}>pegar un link</a>
          </div>
        </div>
        {!c.materiales.length && <div className="v2-sub" style={{ textAlign: "center" }}>Todavía no hay material.</div>}
        {c.materiales.map(function (m, j) {
          var ev = estadoMaterial(m);
          return <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "7px 9px", background: V2.C.bg, borderRadius: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 17 }}>{ICONO_TIPO[m.tipo] || "📎"}</span>
            <input value={m.titulo} onChange={function (e) { setMat(j, { titulo: e.target.value }); }} style={Object.assign({}, V2.estiloInput, { flex: "1 1 200px" })} />
            {m.url && <a href={m.url} target="_blank" rel="noopener noreferrer" className="v2-sub">abrir ↗</a>}
            <span className="v2-sub" title="Cada cuántos días hay que revisar/actualizar este material (0 = no vence)">revisar cada</span>
            <input type="number" min="0" value={m.revisarCadaDias || 0} onChange={function (e) { setMat(j, { revisarCadaDias: Math.max(0, +e.target.value || 0) }); }} style={Object.assign({}, V2.estiloInput, { width: 64 })} />
            <span className="v2-sub">días</span>
            <ChipVence estado={ev} />
            {ev.estado !== "ok" && <V2.Boton tipo="link" chico title="Marcar como revisado hoy" onClick={function () { setMat(j, { actualizadoEn: V2.hoy() }); }}>marcar revisado</V2.Boton>}
            <V2.Boton tipo="link" chico title="Subir" onClick={function () { moverMat(j, -1); }}>↑</V2.Boton>
            <V2.Boton tipo="link" chico title="Bajar" onClick={function () { moverMat(j, 1); }}>↓</V2.Boton>
            <V2.Boton tipo="peligro" chico onClick={function () { delMat(j); }}>✕</V2.Boton>
          </div>;
        })}
      </V2.Tarjeta>

      <V2.Tarjeta titulo="Examen (opcional)">
        {!c.evaluacion && <V2.Boton tipo="secundario" chico onClick={function () { set({ evaluacion: { notaMinima: 6, preguntas: [preguntaVacia()] } }); }}>+ Agregar examen</V2.Boton>}
        {c.evaluacion && <div>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 10 }}>
            <V2.Campo etiqueta="Nota mínima para aprobar (1-10)">
              <input type="number" min="1" max="10" value={c.evaluacion.notaMinima} onChange={function (e) { setEv({ notaMinima: Math.max(1, Math.min(10, +e.target.value || 6)) }); }} style={Object.assign({}, V2.estiloInput, { width: 90 })} />
            </V2.Campo>
            <V2.Boton tipo="peligro" chico onClick={function () { if (window.confirm("¿Quitar el examen del curso?")) set({ evaluacion: null }); }}>Quitar examen</V2.Boton>
          </div>
          {c.evaluacion.preguntas.map(function (p, i) {
            return <div key={i} style={{ border: "1px solid " + V2.C.border, borderRadius: 10, padding: 12, marginBottom: 10, background: V2.C.white }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input value={p.preg} onChange={function (e) { setPreg(i, { preg: e.target.value }); }} placeholder={"Pregunta " + (i + 1)} style={Object.assign({}, V2.estiloInput, { flex: 1, fontSize: 14, fontWeight: 600 })} />
                {c.evaluacion.preguntas.length > 1 && <V2.Boton tipo="peligro" chico onClick={function () { setEv({ preguntas: c.evaluacion.preguntas.filter(function (x, k) { return k !== i; }) }); }}>✕</V2.Boton>}
              </div>
              {p.opciones.map(function (o, k) {
                return <label key={k} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 5 }}>
                  <input type="radio" name={"correcta-" + i} checked={p.correcta === k} onChange={function () { setPreg(i, { correcta: k }); }} style={{ accentColor: V2.C.green }} title="Respuesta correcta" />
                  <input value={o} onChange={function (e) { setPreg(i, { opciones: p.opciones.map(function (x, n) { return n === k ? e.target.value : x; }) }); }} placeholder={"Opción " + (k + 1)}
                    style={Object.assign({}, V2.estiloInput, { flex: 1, borderColor: p.correcta === k ? V2.C.green : V2.C.border })} />
                </label>;
              })}
              <div className="v2-sub">El punto marcado es la respuesta correcta.</div>
            </div>;
          })}
          <V2.Boton tipo="secundario" chico onClick={function () { setEv({ preguntas: c.evaluacion.preguntas.concat([preguntaVacia()]) }); }}>+ Pregunta</V2.Boton>
        </div>}
      </V2.Tarjeta>

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", margin: "6px 0 30px" }}>
        <V2.Boton tipo="secundario" onClick={props.onCancelar}>Cancelar</V2.Boton>
        <V2.Boton onClick={guardar} disabled={guardando || !!subiendo}>{guardando ? "Guardando…" : "Guardar curso"}</V2.Boton>
      </div>
    </div>;
  }

  // ═══════════════════════════ Pantalla Cursos ═════════════════════════════════════════
  function PantallaCursos() {
    var stC = useState(null); var cursos = stC[0], setCursos = stC[1];
    var stG = useState([]); var gestores = stG[0], setGestores = stG[1];
    var stEd = useState(null); var editando = stEd[0], setEditando = stEd[1];
    var stQ = useState(""); var q = stQ[0], setQ = stQ[1];
    var stA = useState("todas"); var fAud = stA[0], setFAud = stA[1];
    var stE = useState("todos"); var fEst = stE[0], setFEst = stE[1];
    var stErr = useState(""); var err = stErr[0], setErr = stErr[1];
    var puedeEditar = V2.puede("capacitacion");

    var cargar = function () {
      datos.cursos().then(setCursos).catch(function (e) { setErr("No se pudieron cargar los cursos: " + errorTexto(e)); setCursos([]); });
    };
    useEffect(function () {
      cargar();
      datos.gestores().then(setGestores).catch(function () { setGestores([]); });
    }, []);

    var accion = function (p, okMsg) { p.then(cargar).catch(function (e) { setErr(okMsg + ": " + errorTexto(e)); }); };

    if (editando) return <EditorCurso curso={editando} gestores={gestores} onCancelar={function () { setEditando(null); }} onGuardado={function () { setEditando(null); cargar(); }} />;
    if (cursos === null) return <V2.Cargando texto="Cargando cursos…" />;

    var hoy = V2.hoy();
    var conVence = function (c) {
      var mats = materialesDe(c), venc = 0, pronto = 0;
      mats.forEach(function (m) { var e = estadoMaterial(m, hoy); if (e.estado === "vencido") venc++; else if (e.estado === "pronto") pronto++; });
      return { venc: venc, pronto: pronto };
    };
    var filtrados = cursos.filter(function (c) {
      if (q && norm(c.nombre + " " + (c.descripcion || "")).indexOf(norm(q)) < 0) return false;
      if (fAud !== "todas" && c.audiencia !== fAud) return false;
      if (fEst === "activos" && !c.activo) return false;
      if (fEst === "inactivos" && c.activo) return false;
      if (fEst === "vence") { var v = conVence(c); if (!v.venc && !v.pronto) return false; }
      return true;
    });
    var totalVencidos = cursos.reduce(function (a, c) { var v = conVence(c); return a + v.venc + v.pronto; }, 0);

    return <div>
      {err && <V2.Aviso tipo="error" onCerrar={function () { setErr(""); }}>{err}</V2.Aviso>}
      {totalVencidos > 0 && <V2.Aviso tipo="alerta">{totalVencidos} material(es) vencido(s) o por vencer. Filtrá por “Con material por vencer” para verlos.</V2.Aviso>}
      <div className="v2-tarjeta" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <V2.Campo etiqueta="Buscar"><input value={q} onChange={function (e) { setQ(e.target.value); }} placeholder="Nombre del curso" style={V2.estiloInput} /></V2.Campo>
        <V2.Campo etiqueta="Audiencia">
          <select value={fAud} onChange={function (e) { setFAud(e.target.value); }} style={V2.estiloInput}>
            <option value="todas">Todas</option>
            {AUDIENCIAS.map(function (a) { return <option key={a.v} value={a.v}>{a.icon} {a.label}</option>; })}
          </select>
        </V2.Campo>
        <V2.Campo etiqueta="Estado">
          <select value={fEst} onChange={function (e) { setFEst(e.target.value); }} style={V2.estiloInput}>
            <option value="todos">Activos e inactivos</option>
            <option value="activos">Solo activos</option>
            <option value="inactivos">Solo inactivos</option>
            <option value="vence">Con material por vencer</option>
          </select>
        </V2.Campo>
        <span className="v2-sub">{filtrados.length} curso(s)</span>
        {puedeEditar && <span style={{ marginLeft: "auto" }}><V2.Boton onClick={function () { setEditando({}); }}>+ Nuevo curso</V2.Boton></span>}
      </div>
      <div className="v2-sub" style={{ margin: "0 0 10px" }}>Los gestores hacen estos cursos desde la versión anterior (Capacitación). La audiencia define quién ve cada uno.</div>

      {!filtrados.length && <V2.Tarjeta><div className="v2-sub" style={{ textAlign: "center", padding: 16 }}>{cursos.length ? "Ningún curso coincide con el filtro." : "Todavía no hay cursos. Creá el primero con “+ Nuevo curso”."}</div></V2.Tarjeta>}
      {filtrados.map(function (c) {
        var ai = audInfo(c.audiencia), mats = materialesDe(c), v = conVence(c);
        return <div key={c.id} className="v2-tarjeta" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", opacity: c.activo ? 1 : 0.6 }}>
          <div style={{ fontSize: 24 }}>{ai.icon}</div>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <b>{c.nombre}</b>
              <V2.Chip>{ai.label}{c.cartera ? (" · " + c.cartera) : ""}</V2.Chip>
              {!c.activo && <V2.Chip color={V2.C.muted}>Inactivo</V2.Chip>}
              {v.venc > 0 && <V2.Chip color={V2.C.danger}>{v.venc} vencido(s)</V2.Chip>}
              {v.pronto > 0 && <V2.Chip color={V2.C.warn}>{v.pronto} vence(n) pronto</V2.Chip>}
            </div>
            <div className="v2-sub">{c.descripcion || "—"}</div>
            <div className="v2-sub">{mats.length} material(es) · {c.evaluacion ? ("examen de " + (c.evaluacion.preguntas || []).length + " pregunta(s)") : "sin examen"}{c.asignadosA && c.asignadosA.length ? (" · " + c.asignadosA.length + " asignado(s)") : ""}</div>
          </div>
          {puedeEditar && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <V2.Boton tipo="secundario" chico onClick={function () { accion(datos.guardar(Object.assign({}, c, { activo: !c.activo })), "No se pudo cambiar el estado"); }}>{c.activo ? "Desactivar" : "Activar"}</V2.Boton>
            <V2.Boton tipo="secundario" chico onClick={function () { accion(datos.guardar(Object.assign(copia(c), { id: null, nombre: c.nombre + " (copia)", activo: false, createdAt: null })), "No se pudo duplicar"); }}>Duplicar</V2.Boton>
            <V2.Boton tipo="secundario" chico onClick={function () { setEditando(c); }}>Editar</V2.Boton>
            <V2.Boton tipo="peligro" chico onClick={function () { if (window.confirm("¿Borrar el curso “" + c.nombre + "”? No se puede deshacer.")) accion(datos.borrar(c.id), "No se pudo borrar"); }}>Borrar</V2.Boton>
          </div>}
        </div>;
      })}
    </div>;
  }

  // ═══════════════════════════ Pantalla Seguimiento ════════════════════════════════════
  function PantallaSeguimiento() {
    var stTab = useState("equipo"); var tab = stTab[0], setTab = stTab[1];
    var stD = useState(null); var d = stD[0], setD = stD[1];
    var stErr = useState(""); var err = stErr[0], setErr = stErr[1];
    var stQ = useState(""); var q = stQ[0], setQ = stQ[1];
    var stCart = useState("todas"); var fCart = stCart[0], setFCart = stCart[1];
    var stRol = useState("todos"); var fRol = stRol[0], setFRol = stRol[1];
    var stEst = useState("todos"); var fEst = stEst[0], setFEst = stEst[1];
    var stDet = useState(null); var detalle = stDet[0], setDetalle = stDet[1];

    useEffect(function () {
      Promise.all([datos.cursos(), datos.gestores(), datos.progresos(), datos.intentos()]).then(function (r) {
        setD({ cursos: r[0], gestores: r[1], prog: r[2], intentos: r[3] });
      }).catch(function (e) { setErr("No se pudo cargar el seguimiento: " + errorTexto(e)); setD({ cursos: [], gestores: [], prog: {}, intentos: [] }); });
    }, []);
    if (d === null) return <V2.Cargando texto="Cargando seguimiento…" />;

    var carteras = d.gestores.map(function (u) { return u.cliente || u.cartera; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; }).sort();
    var filas = d.gestores.map(function (u) {
      var prog = d.prog[u.uid] || { cursos: {} };
      var mis = d.cursos.filter(function (c) { return cursoVisible(c, u); });
      var est = mis.map(function (c) { return progresoCurso(c, prog); });
      var completos = est.filter(function (e) { return e.completo; }).length;
      var vistM = est.reduce(function (a, e) { return a + e.vistos; }, 0), totM = est.reduce(function (a, e) { return a + e.total; }, 0);
      return {
        u: u, mis: mis, total: est.length, completos: completos,
        pct: totM ? Math.round(vistM / totM * 100) : (est.length && completos === est.length ? 100 : 0),
        seg: est.reduce(function (a, e) { return a + e.segundos; }, 0),
        sospechoso: est.some(function (e) { return e.sospechoso; }),
        examTotal: mis.filter(function (c) { return c.evaluacion; }).length,
        examOk: mis.filter(function (c, i) { return c.evaluacion && est[i].examOk; }).length,
        estado: est.length && completos === est.length ? "completo" : "pendiente"
      };
    });
    var filasF = filas.filter(function (f) {
      if (q && norm((f.u.name || f.u.user) + " " + (f.u.legajo || "")).indexOf(norm(q)) < 0) return false;
      if (fCart !== "todas" && String(f.u.cliente || f.u.cartera) !== fCart) return false;
      if (fRol === "nuevos" && f.u.role !== "ingreso") return false;
      if (fRol === "continuos" && f.u.role !== "gestor") return false;
      if (fEst === "completos" && f.estado !== "completo") return false;
      if (fEst === "pendientes" && f.estado !== "pendiente") return false;
      if (fEst === "sospechosos" && !f.sospechoso) return false;
      return true;
    }).sort(function (a, b) { return a.pct - b.pct; });
    var intF = d.intentos.filter(function (it) {
      if (q && norm((it.gestorNombre || "") + " " + (it.cursoNombre || "")).indexOf(norm(q)) < 0) return false;
      if (fEst === "aprobados" && it.estado !== "aprobado") return false;
      if (fEst === "reprobados" && it.estado !== "reprobado") return false;
      return true;
    });

    var exportar = function () {
      var rows = filasF.map(function (f) {
        return { Gestor: f.u.name || f.u.user, Legajo: f.u.legajo || "", Cartera: f.u.cliente || f.u.cartera || "", Rol: f.u.role, "Cursos completos": f.completos + "/" + f.total, "% avance": f.pct, Tiempo: fmtSeg(f.seg), "Exámenes aprobados": f.examOk + "/" + f.examTotal, Alerta: f.sospechoso ? "Revisar tiempos" : "" };
      });
      var ws = XLSX.utils.json_to_sheet(rows), wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Seguimiento");
      XLSX.writeFile(wb, "seguimiento-capacitacion-" + V2.hoy() + ".xlsx");
    };
    var promedioEquipo = filas.length ? Math.round(filas.reduce(function (a, f) { return a + f.pct; }, 0) / filas.length) : 0;

    return <div>
      {err && <V2.Aviso tipo="error" onCerrar={function () { setErr(""); }}>{err}</V2.Aviso>}
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <V2.Boton tipo={tab === "equipo" ? "primario" : "secundario"} chico onClick={function () { setTab("equipo"); setFEst("todos"); }}>Equipo</V2.Boton>
        <V2.Boton tipo={tab === "historial" ? "primario" : "secundario"} chico onClick={function () { setTab("historial"); setFEst("todos"); }}>Historial de exámenes</V2.Boton>
        {tab === "equipo" && <span className="v2-sub" style={{ alignSelf: "center" }}>Avance promedio del equipo: <b>{promedioEquipo}%</b> · {filas.filter(function (f) { return f.estado === "completo"; }).length}/{filas.length} al día</span>}
      </div>
      <div className="v2-tarjeta" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <V2.Campo etiqueta="Buscar"><input value={q} onChange={function (e) { setQ(e.target.value); }} placeholder={tab === "equipo" ? "Gestor o legajo" : "Gestor o curso"} style={V2.estiloInput} /></V2.Campo>
        {tab === "equipo" && <V2.Campo etiqueta="Cartera">
          <select value={fCart} onChange={function (e) { setFCart(e.target.value); }} style={V2.estiloInput}>
            <option value="todas">Todas</option>{carteras.map(function (x) { return <option key={x} value={x}>{x}</option>; })}
          </select></V2.Campo>}
        {tab === "equipo" && <V2.Campo etiqueta="Tipo">
          <select value={fRol} onChange={function (e) { setFRol(e.target.value); }} style={V2.estiloInput}>
            <option value="todos">Todos</option><option value="nuevos">Nuevos (inducción)</option><option value="continuos">En actividad</option>
          </select></V2.Campo>}
        <V2.Campo etiqueta="Estado">
          <select value={fEst} onChange={function (e) { setFEst(e.target.value); }} style={V2.estiloInput}>
            <option value="todos">Todos</option>
            {tab === "equipo" ? [<option key="c" value="completos">Al día</option>, <option key="p" value="pendientes">Pendientes</option>, <option key="s" value="sospechosos">A revisar (vio material en menos de 15 s)</option>]
              : [<option key="a" value="aprobados">Aprobados</option>, <option key="r" value="reprobados">Reprobados</option>]}
          </select></V2.Campo>
        {tab === "equipo" && <span style={{ marginLeft: "auto" }}><V2.Boton tipo="secundario" chico disabled={!filasF.length} onClick={exportar}>⬇ Excel</V2.Boton></span>}
      </div>

      {tab === "equipo" && <V2.Tarjeta>
        <div className="v2-tabla-caja"><table className="v2-tabla v2-tarjetas">
          <thead><tr><th>Gestor</th><th>Cartera</th><th>Avance</th><th>Tiempo</th><th>Exámenes</th><th></th></tr></thead>
          <tbody>
            {filasF.map(function (f) {
              var abierto = detalle === f.u.uid;
              return <React.Fragment key={f.u.uid}>
                <tr>
                  <td style={{ fontWeight: 600 }}>{f.u.name || f.u.user}
                    {f.u.role === "ingreso" && <V2.Chip color={V2.C.info}>nuevo</V2.Chip>}
                    {f.sospechoso && <span title="Marcó material como visto en menos de 15 segundos" style={{ color: V2.C.warn }}> ⚠</span>}
                    <span className="v2-sub">{f.u.legajo || ""}</span></td>
                  <td data-label="Cartera">{f.u.cliente || f.u.cartera || "—"}</td>
                  <td data-label="Avance" style={{ minWidth: 140 }}><div style={{ display: "flex", gap: 8, alignItems: "center" }}><div style={{ flex: 1 }}><Barra pct={f.pct} /></div><span className="v2-sub v2-num">{f.completos}/{f.total}</span></div></td>
                  <td data-label="Tiempo" className="v2-num">{fmtSeg(f.seg)}</td>
                  <td data-label="Exámenes" className="v2-num">{f.examTotal ? (f.examOk + "/" + f.examTotal) : "—"}</td>
                  <td><V2.Boton tipo="link" chico onClick={function () { setDetalle(abierto ? null : f.u.uid); }}>{abierto ? "Cerrar" : "Ver cursos"}</V2.Boton></td>
                </tr>
                {abierto && <tr><td colSpan={6} style={{ background: V2.C.bg, padding: "6px 12px 10px" }}>
                  {!f.mis.length && <span className="v2-sub">No tiene cursos asignados.</span>}
                  {f.mis.map(function (c) {
                    var e = progresoCurso(c, d.prog[f.u.uid] || { cursos: {} });
                    return <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderBottom: "1px solid " + V2.C.border, fontSize: 13, flexWrap: "wrap" }}>
                      <span style={{ flex: "1 1 200px" }}>{audInfo(c.audiencia).icon} {c.nombre}</span>
                      <span className="v2-sub">{e.vistos}/{e.total} vistos</span>
                      <span style={{ width: 90 }}><Barra pct={e.pct} /></span>
                      {c.evaluacion && <V2.Chip color={e.examOk ? V2.C.green : V2.C.muted}>{e.examen ? ("nota " + (e.examen.mejorNota || 0).toFixed(1)) : "sin rendir"}</V2.Chip>}
                      {e.completo && <V2.Chip color={V2.C.green}>✓ completo</V2.Chip>}
                    </div>;
                  })}
                </td></tr>}
              </React.Fragment>;
            })}
            {!filasF.length && <tr><td colSpan={6} className="v2-sub" style={{ padding: 18, textAlign: "center" }}>Sin gestores para el filtro.</td></tr>}
          </tbody>
        </table></div>
      </V2.Tarjeta>}

      {tab === "historial" && <V2.Tarjeta>
        <div className="v2-tabla-caja"><table className="v2-tabla v2-tarjetas">
          <thead><tr><th>Fecha</th><th>Gestor</th><th>Curso</th><th>Nota</th><th>Intento</th><th>Estado</th></tr></thead>
          <tbody>
            {intF.map(function (it, i) {
              var ok = it.estado === "aprobado";
              return <tr key={i}>
                <td data-label="Fecha" className="v2-num">{V2.fmtFecha(it.fecha)}</td>
                <td style={{ fontWeight: 600 }}>{it.gestorNombre}<span className="v2-sub">{it.legajo || ""}</span></td>
                <td data-label="Curso">{it.cursoNombre}</td>
                <td data-label="Nota" className="v2-num" style={{ fontWeight: 700, color: ok ? V2.C.ok : V2.C.danger }}>{(+it.nota || 0).toFixed(1)}</td>
                <td data-label="Intento" className="v2-num">#{it.intento}</td>
                <td data-label="Estado"><V2.Chip color={ok ? V2.C.ok : V2.C.danger}>{it.estado}</V2.Chip></td>
              </tr>;
            })}
            {!intF.length && <tr><td colSpan={6} className="v2-sub" style={{ padding: 18, textAlign: "center" }}>Sin exámenes rendidos.</td></tr>}
          </tbody>
        </table></div>
      </V2.Tarjeta>}
    </div>;
  }

  V2.registrar({ id: "cap-cursos", titulo: "Cursos", grupo: "Capacitación", icono: "📚", orden: 1, componente: PantallaCursos });
  V2.registrar({ id: "cap-seguimiento", titulo: "Seguimiento", grupo: "Capacitación", icono: "📊", orden: 2, componente: PantallaSeguimiento });
  V2._capacitacion = { estadoMaterial: estadoMaterial, progresoCurso: progresoCurso, cursoVisible: cursoVisible };   // para probar desde la consola
})();

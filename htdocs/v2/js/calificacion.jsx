// ═══════════════════════════════════════════════════════════════════════════════════════
// PANTALLA "Calificación del audio" (Configuración). 27/11/2026.
// Define cómo se califica una llamada según el % de temas cumplidos (de su parámetro de
// análisis por cliente). Por defecto: Malo 0-59 · Bueno 60-80 · Muy bueno 81-100.
// Firestore: configuracion/calificacion = {niveles:[{nombre, desde, color}], actualizadoPor, actualizadoEn}
// Cada nivel va desde su "desde" hasta el "desde" del siguiente menos 1 (el último hasta 100).
// Sintaxis: var + function(){}, SIN ?. ni ??  (Babel 7.24.7 en el navegador).
// ═══════════════════════════════════════════════════════════════════════════════════════
(function () {
  var NOMBRES_COLOR = { rojo: "Rojo", amarillo: "Amarillo", verde: "Verde", azul: "Azul", gris: "Gris" };

  function usuarioActual() {
    if (V2.usuario && V2.usuario.nombre) return V2.usuario.nombre;
    if (V2.auth && V2.auth.currentUser && V2.auth.currentUser.email) return V2.auth.currentUser.email;
    return "—";
  }
  function copia(n) { return (n || []).map(function (x) { return { nombre: x.nombre || "", desde: +x.desde || 0, color: x.color || "gris" }; }); }

  function validar(niveles) {
    if (!niveles.length) return "Tiene que haber al menos un nivel.";
    for (var i = 0; i < niveles.length; i++) {
      var n = niveles[i];
      if (!String(n.nombre || "").trim()) return "El nivel " + (i + 1) + " no tiene nombre.";
      if (!(n.desde >= 0 && n.desde <= 100)) return "“" + n.nombre + "”: el “desde” tiene que estar entre 0 y 100.";
      if (i > 0 && n.desde <= niveles[i - 1].desde) return "Los niveles tienen que ir de menor a mayor: “" + n.nombre + "” empieza en " + n.desde + "% y el anterior en " + niveles[i - 1].desde + "%.";
    }
    if (niveles[0].desde !== 0) return "El primer nivel tiene que empezar en 0%, para que toda llamada tenga calificación.";
    return "";
  }

  function PantallaCalificacion() {
    var vivos = V2.useNiveles();
    var stN = useState(null); var niveles = stN[0], setNiveles = stN[1];
    var stG = useState(false); var guardando = stG[0], setGuardando = stG[1];
    var stM = useState(null); var msg = stM[0], setMsg = stM[1];
    var stP = useState(75); var prueba = stP[0], setPrueba = stP[1];

    // Al cargar (o si cambian desde otra pestaña y no hay edición en curso) se toman los vigentes.
    var firmaVivos = JSON.stringify(copia(V2.ordenarNiveles(vivos)));
    var stF = useState(""); var firmaBase = stF[0], setFirmaBase = stF[1];
    useEffect(function () {
      if (niveles === null || JSON.stringify(niveles) === firmaBase) { setNiveles(JSON.parse(firmaVivos)); setFirmaBase(firmaVivos); }
    }, [firmaVivos]);
    if (!niveles) return <V2.Cargando texto="Cargando calificación…" />;

    var cambiado = JSON.stringify(niveles) !== firmaBase;
    var error = validar(niveles);
    var cambiar = function (i, patch) { setMsg(null); setNiveles(niveles.map(function (n, k) { return k === i ? Object.assign({}, n, patch) : n; })); };
    var quitar = function (i) { setMsg(null); setNiveles(niveles.filter(function (n, k) { return k !== i; })); };
    var agregar = function () {
      var ult = niveles[niveles.length - 1];
      var desde = ult ? Math.min(100, ult.desde + Math.max(1, Math.round((100 - ult.desde) / 2))) : 0;
      setNiveles(niveles.concat([{ nombre: "", desde: desde, color: "azul" }]));
    };
    var guardar = function () {
      if (error) { setMsg({ tipo: "error", texto: error }); return; }
      setGuardando(true); setMsg(null);
      var datos = { niveles: copia(niveles).map(function (n) { return Object.assign(n, { nombre: n.nombre.trim() }); }), actualizadoPor: usuarioActual(), actualizadoEn: new Date().toISOString() };
      V2.db.collection("configuracion").doc("calificacion").set(datos, { merge: true })
        .then(function () { setGuardando(false); setFirmaBase(JSON.stringify(datos.niveles)); setNiveles(datos.niveles); setMsg({ tipo: "ok", texto: "Guardado. Las calificaciones de Buscar y analizar ya usan esta escala." }); })
        .catch(function (e) { setGuardando(false); setMsg({ tipo: "error", texto: "No se pudo guardar: " + ((e && e.message) || e) }); });
    };

    var input = Object.assign({}, V2.estiloInput, { width: "100%", boxSizing: "border-box", font: "inherit", fontSize: 13 });
    var resPrueba = !error ? V2.calificar(+prueba, niveles) : null;

    return <div style={{ maxWidth: 820 }}>
      <V2.Tarjeta titulo="Escala de calificación">
        <div className="v2-sub" style={{ marginBottom: 12, lineHeight: 1.5 }}>
          Al analizar una llamada, la IA marca qué temas del parámetro de su cliente se cumplieron. El <b>% de cumplimiento</b> (ponderado por el peso de cada tema)
          define la calificación según estos niveles. Cada nivel va desde su % hasta el siguiente.
        </div>

        <div className="v2-tabla-caja">
          <table className="v2-tabla" style={{ minWidth: 520 }}>
            <thead><tr><th>Calificación</th><th style={{ width: 110 }}>Desde (%)</th><th style={{ width: 90 }}>Hasta (%)</th><th style={{ width: 130 }}>Color</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>
              {niveles.map(function (n, i) {
                var sig = niveles[i + 1];
                var hasta = sig ? (sig.desde - 1) : 100;
                return <tr key={i}>
                  <td style={{ padding: 6 }}><input aria-label={"Nombre del nivel " + (i + 1)} value={n.nombre} placeholder="Ej: Excelente" onChange={function (e) { cambiar(i, { nombre: e.target.value }); }} style={input} /></td>
                  <td style={{ padding: 6 }}><input aria-label={"Desde, nivel " + (i + 1)} type="number" min="0" max="100" value={n.desde} disabled={i === 0} title={i === 0 ? "El primer nivel siempre empieza en 0%" : ""}
                    onChange={function (e) { cambiar(i, { desde: Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)) }); }} style={input} /></td>
                  <td style={{ padding: 6 }} className="v2-num">{hasta >= n.desde ? hasta : "—"}</td>
                  <td style={{ padding: 6 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 4, background: V2.COLORES_NIVEL[n.color] || V2.C.muted, flexShrink: 0 }} />
                      <select aria-label={"Color, nivel " + (i + 1)} value={n.color} onChange={function (e) { cambiar(i, { color: e.target.value }); }} style={input}>
                        {Object.keys(NOMBRES_COLOR).map(function (c) { return <option key={c} value={c}>{NOMBRES_COLOR[c]}</option>; })}
                      </select>
                    </span>
                  </td>
                  <td style={{ padding: 6 }}>{niveles.length > 1 && <V2.Boton tipo="link" chico title="Quitar nivel" onClick={function () { quitar(i); }}>✕</V2.Boton>}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
          <V2.Boton tipo="secundario" chico onClick={agregar} disabled={niveles.length >= 6}>+ Agregar nivel</V2.Boton>
          <V2.Boton tipo="link" chico onClick={function () { setNiveles(copia(V2.NIVELES_DEFECTO)); setMsg({ tipo: "info", texto: "Se cargó la escala por defecto (Malo / Bueno / Muy bueno). Tocá Guardar para aplicarla." }); }}>Volver a la escala por defecto</V2.Boton>
        </div>

        {/* Vista previa: barra 0-100 con los tramos */}
        {!error && <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", height: 26, borderRadius: 6, overflow: "hidden", border: "1px solid " + V2.C.border }}>
            {niveles.map(function (n, i) {
              var sig = niveles[i + 1], ancho = (sig ? sig.desde : 101) - n.desde;
              return <div key={i} title={n.nombre} style={{ flex: ancho + " 0 0", background: V2.COLORES_NIVEL[n.color] || V2.C.muted, color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", whiteSpace: "nowrap", padding: "0 4px" }}>{n.nombre}</div>;
            })}
          </div>
          <div className="v2-num v2-sub" style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}><span>0%</span><span>100%</span></div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13, flexWrap: "wrap" }}>
            <label htmlFor="cal-prueba">Probar: una llamada que cumple el</label>
            <input id="cal-prueba" type="number" min="0" max="100" value={prueba} onChange={function (e) { setPrueba(Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0))); }} style={Object.assign({}, V2.estiloInput, { width: 70 })} />
            <span>% de los temas queda</span>
            {resPrueba && <V2.Chip color={resPrueba.color}>{resPrueba.nombre}</V2.Chip>}
          </div>
        </div>}

        {error && <div style={{ marginTop: 12 }}><V2.Aviso tipo="error">{error}</V2.Aviso></div>}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
          <V2.Boton onClick={guardar} disabled={guardando || !cambiado || !!error}>{guardando ? "Guardando…" : "Guardar"}</V2.Boton>
          {cambiado && !guardando && <V2.Boton tipo="secundario" onClick={function () { setNiveles(JSON.parse(firmaBase)); setMsg(null); }}>Descartar cambios</V2.Boton>}
        </div>
        {msg && <div style={{ marginTop: 10 }}><V2.Aviso tipo={msg.tipo} onCerrar={function () { setMsg(null); }}>{msg.texto}</V2.Aviso></div>}
      </V2.Tarjeta>
    </div>;
  }

  V2.registrar({ id: "calificacion", titulo: "Calificación del audio", grupo: "Configuración", icono: "🏷️", orden: 0.5, componente: PantallaCalificacion });
})();

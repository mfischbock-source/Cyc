// ═══════════════════════════════════════════════════════════════════════════════════════
// Configuración → Ingresos (solo propietario): quién entró y cuándo. Lee ingresos_v2 en vivo.
// Reglas de sintaxis (Babel 7.24.7 en el navegador): var + function(){}, SIN ?. ni ??
// ═══════════════════════════════════════════════════════════════════════════════════════
(function () {
  var LIMITE = 500;
  var RESULTADO = {
    ok: { texto: "Ingresó", color: function () { return V2.C.ok; } },
    pendiente: { texto: "Esperando aprobación", color: function () { return V2.C.warn; } },
    inactivo: { texto: "Bloqueado (desactivado)", color: function () { return V2.C.danger; } },
    rechazado: { texto: "Rechazado (mail no habilitado)", color: function () { return V2.C.danger; } }
  };

  function fmtFechaHora(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return "—";
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function mismoDia(iso, ref) { var a = new Date(iso); return !isNaN(a.getTime()) && a.toDateString() === ref.toDateString(); }

  function PantallaIngresos() {
    var stLista = useState(null); var lista = stLista[0], setLista = stLista[1];
    var stErr = useState(""); var err = stErr[0], setErr = stErr[1];
    var stQ = useState(""); var q = stQ[0], setQ = stQ[1];
    var stVista = useState("personas"); var vista = stVista[0], setVista = stVista[1];

    useEffect(function () {
      return V2.db.collection(V2.config.col.ingresos).orderBy("en", "desc").limit(LIMITE).onSnapshot(
        function (sn) { setLista(sn.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); })); setErr(""); },
        function (e) { setLista([]); setErr("No se pudo cargar el registro de ingresos: " + ((e && e.message) || e)); });
    }, []);

    if (!V2.puede("ingresos")) return <V2.Aviso tipo="error">Esta pantalla es solo para el propietario.</V2.Aviso>;

    var norm = function (s) { return String(s || "").toLowerCase(); };
    var filtro = norm(q.trim());
    var todos = lista || [];
    var visibles = todos.filter(function (x) { return !filtro || (norm(x.email) + " " + norm(x.nombre)).indexOf(filtro) >= 0; });
    var hoy = new Date();
    var hoyN = todos.filter(function (x) { return x.resultado === "ok" && mismoDia(x.en, hoy); });
    var personasHoy = {}; hoyN.forEach(function (x) { personasHoy[x.email] = true; });
    var bloqueados = todos.filter(function (x) { return x.resultado !== "ok"; }).length;

    // Por persona: último ingreso, cantidad de ingresos exitosos y último resultado (la lista ya viene de más nuevo a más viejo).
    var porMail = {}, orden = [];
    visibles.forEach(function (x) {
      var k = x.email || "?";
      if (!porMail[k]) { porMail[k] = { email: k, nombre: x.nombre, role: x.role, ultimo: x, ingresos: 0, bloqueos: 0 }; orden.push(k); }
      if (x.resultado === "ok") porMail[k].ingresos++; else porMail[k].bloqueos++;
      if (!porMail[k].nombre && x.nombre) porMail[k].nombre = x.nombre;
    });

    var chipResultado = function (r) { var d = RESULTADO[r] || { texto: r || "—", color: function () { return V2.C.muted; } }; return <V2.Chip color={d.color()}>{d.texto}</V2.Chip>; };

    return <div>
      <div className="v2-kpis" style={{ marginBottom: 12 }}>
        <div className="v2-kpi"><b>{personasHoy ? Object.keys(personasHoy).length : 0}</b><span>personas entraron hoy</span></div>
        <div className="v2-kpi"><b>{hoyN.length}</b><span>ingresos hoy</span></div>
        <div className="v2-kpi"><b>{lista ? Object.keys((function () { var o = {}; todos.forEach(function (x) { o[x.email] = 1; }); return o; })()).length : "—"}</b><span>personas en el registro</span></div>
        <div className="v2-kpi"><b>{bloqueados}</b><span>intentos sin acceso</span></div>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <input value={q} onChange={function (e) { setQ(e.target.value); }} placeholder="Buscar por mail o nombre…" style={Object.assign({}, V2.estiloInput, { minWidth: 240 })} />
        <V2.Boton tipo={vista === "personas" ? "primario" : "secundario"} chico onClick={function () { setVista("personas"); }}>Por persona</V2.Boton>
        <V2.Boton tipo={vista === "cronologico" ? "primario" : "secundario"} chico onClick={function () { setVista("cronologico"); }}>Cronológico</V2.Boton>
        <span className="v2-sub">{lista ? ("últimos " + LIMITE + " registros como máximo") : ""}</span>
      </div>
      {err && <V2.Aviso tipo="error">{err}</V2.Aviso>}
      {lista === null && <V2.Cargando texto="Cargando ingresos…" />}
      {lista && lista.length === 0 && !err && <div className="v2-sub" style={{ padding: 20 }}>Todavía no hay ingresos registrados. Se registran desde que está la versión nueva en uso.</div>}
      {lista && lista.length > 0 && visibles.length === 0 && <div className="v2-sub" style={{ padding: 20 }}>Nadie coincide con "{q}".</div>}

      {visibles.length > 0 && vista === "personas" && <div className="v2-tabla-caja">
        <table className="v2-tabla v2-tarjetas">
          <thead><tr><th>Persona</th><th>Último ingreso</th><th>Resultado</th><th>Ingresos</th><th>Sin acceso</th></tr></thead>
          <tbody>
            {orden.map(function (k) {
              var p = porMail[k];
              return <tr key={k}>
                <td><div style={{ fontWeight: 700 }}>{p.nombre || p.email}</div><span className="v2-sub">{p.email}{p.role && V2.ROLES[p.role] ? (" · " + V2.ROLES[p.role].etiqueta) : ""}</span></td>
                <td data-label="Último">{fmtFechaHora(p.ultimo.en)}</td>
                <td data-label="Resultado">{chipResultado(p.ultimo.resultado)}</td>
                <td data-label="Ingresos" className="v2-num">{p.ingresos}</td>
                <td data-label="Sin acceso" className="v2-num">{p.bloqueos}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>}

      {visibles.length > 0 && vista === "cronologico" && <div className="v2-tabla-caja">
        <table className="v2-tabla v2-tarjetas">
          <thead><tr><th>Fecha y hora</th><th>Persona</th><th>Resultado</th><th>Rol</th><th>Con</th></tr></thead>
          <tbody>
            {visibles.map(function (x) {
              return <tr key={x.id}>
                <td data-label="Cuándo" className="v2-num">{fmtFechaHora(x.en)}</td>
                <td><div style={{ fontWeight: 700 }}>{x.nombre || x.email}</div><span className="v2-sub">{x.email}</span></td>
                <td data-label="Resultado">{chipResultado(x.resultado)}</td>
                <td data-label="Rol">{x.role && V2.ROLES[x.role] ? V2.ROLES[x.role].etiqueta : "—"}</td>
                <td data-label="Con">{x.metodo || "—"}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>}
      <div className="v2-sub" style={{ marginTop: 14, lineHeight: 1.6 }}>Se registra un ingreso por cada vez que alguien abre la app en un navegador (no cada vez que recarga). La hora es la de tu navegador.</div>
    </div>;
  }

  V2.registrar({ id: "ingresos", titulo: "Ingresos", grupo: "Configuración", icono: "🕑", orden: 3, componente: PantallaIngresos });
})();

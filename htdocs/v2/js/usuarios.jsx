// ═══════════════════════════════════════════════════════════════════════════════════════
// Configuración → Usuarios. Admin y propietario: lista en vivo, rol y activar/desactivar.
// Propietario: además habilita mails de antemano (invitaciones_v2) con el rol que elija.
// Reglas de sintaxis (Babel 7.24.7 en el navegador): var + function(){}, SIN ?. ni ??
// ═══════════════════════════════════════════════════════════════════════════════════════
(function () {
  var ORDEN_ROLES = ["admin", "supervisor", "auditor"];   // "owner" no se asigna desde acá: sale de V2.config.propietarios
  var RE_MAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

  function fmtIngreso(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return V2.fmtFecha(String(iso).slice(0, 10)) + " " + String(iso).slice(11, 16);
  }

  // ── Habilitar mails (solo propietario) ───────────────────────────────────────────────────
  function HabilitarMails(props) { // {usuarios}
    var stTxt = useState(""); var txt = stTxt[0], setTxt = stTxt[1];
    var stRol = useState("supervisor"); var rol = stRol[0], setRol = stRol[1];
    var stMsg = useState(null); var msg = stMsg[0], setMsg = stMsg[1];       // {tipo, texto}
    var stOcup = useState(false); var ocupado = stOcup[0], setOcupado = stOcup[1];
    var stInv = useState(null); var invs = stInv[0], setInvs = stInv[1];
    var stErrInv = useState(""); var errInv = stErrInv[0], setErrInv = stErrInv[1];

    useEffect(function () {
      return V2.db.collection(V2.config.col.invitaciones).onSnapshot(
        function (sn) { setInvs(sn.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); })); setErrInv(""); },
        function (e) { setInvs([]); setErrInv("No se pudieron cargar los mails habilitados: " + ((e && e.message) || e)); });
    }, []);

    var agregar = function () {
      var partes = txt.split(/[\s,;]+/).map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
      if (!partes.length) { setMsg({ tipo: "error", texto: "Escribí al menos un mail." }); return; }
      var vistos = {}, validos = [], invalidos = [], repetidos = 0;
      partes.forEach(function (m) { if (vistos[m]) { repetidos++; return; } vistos[m] = true; (RE_MAIL.test(m) ? validos : invalidos).push(m); });
      var porMail = {}; (props.usuarios || []).forEach(function (u) { porMail[String(u.email || "").toLowerCase()] = u; });
      var yaTienen = [], aInvitar = [], aActualizar = [];
      validos.forEach(function (m) {
        var u = porMail[m];
        if (!u) aInvitar.push(m);
        else if (!V2.ROLES[u.role]) aActualizar.push(u);       // ya entró y quedó "esperando aprobación": se le asigna el rol ya
        else yaTienen.push(m + " (" + V2.ROLES[u.role].etiqueta + ")");
      });
      if (!aInvitar.length && !aActualizar.length) {
        setMsg({ tipo: invalidos.length ? "error" : "info", texto: (invalidos.length ? ("No son mails válidos: " + invalidos.join(", ") + ". ") : "") + (yaTienen.length ? ("Ya tienen rol: " + yaTienen.join(", ") + " (cambiáselo en la tabla de abajo).") : "") });
        return;
      }
      setOcupado(true); setMsg(null);
      var batch = V2.db.batch(), quien = (V2.usuario && V2.usuario.email) || "", ahora = new Date().toISOString();
      aInvitar.forEach(function (m) { batch.set(V2.db.collection(V2.config.col.invitaciones).doc(m), { role: rol, creadoPor: quien, creadoEn: ahora }); });
      aActualizar.forEach(function (u) { batch.update(V2.db.collection(V2.config.col.accesos).doc(u.id), { role: rol, origen: "invitacion", actualizadoPor: quien, actualizadoEn: ahora }); });
      batch.commit().then(function () {
        var partesMsg = [];
        if (aInvitar.length) partesMsg.push(aInvitar.length + " mail(s) habilitado(s) como " + V2.ROLES[rol].etiqueta + ": " + aInvitar.join(", "));
        if (aActualizar.length) partesMsg.push(aActualizar.length + " que ya habían entrado pasaron a " + V2.ROLES[rol].etiqueta + ": " + aActualizar.map(function (u) { return u.email; }).join(", "));
        if (yaTienen.length) partesMsg.push("ya tenían rol (sin cambios): " + yaTienen.join(", "));
        if (invalidos.length) partesMsg.push("no son mails válidos (omitidos): " + invalidos.join(", "));
        if (repetidos) partesMsg.push(repetidos + " repetido(s) omitido(s)");
        setMsg({ tipo: invalidos.length ? "alerta" : "ok", texto: partesMsg.join(" · ") + "." });
        setTxt("");
      }).catch(function (e) { setMsg({ tipo: "error", texto: "No se pudo guardar: " + ((e && e.message) || e) }); })
        .finally(function () { setOcupado(false); });
    };
    var quitar = function (id) {
      V2.db.collection(V2.config.col.invitaciones).doc(id).delete().catch(function (e) { setMsg({ tipo: "error", texto: "No se pudo quitar " + id + ": " + ((e && e.message) || e) }); });
    };

    var pendientes = (invs || []).filter(function (i) { return !i.usadoEn; }).sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
    return <V2.Tarjeta titulo="Habilitar mails" style={{ marginBottom: 14 }}>
      <div className="v2-sub" style={{ marginBottom: 8 }}>Pegá uno o varios mails (separados por línea, coma o espacio). Cuando entren con Google, quedan con el rol elegido, sin esperar aprobación. Sirve también para mails que no son @{V2.config.dominio}.</div>
      <textarea value={txt} onChange={function (e) { setTxt(e.target.value); }} rows={3} placeholder={"nombre.apellido@" + V2.config.dominio + "\notra.persona@" + V2.config.dominio}
        style={Object.assign({}, V2.estiloInput, { width: "100%", fontFamily: "inherit" })} disabled={ocupado} />
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <span>Rol:</span>
        <select value={rol} onChange={function (e) { setRol(e.target.value); }} disabled={ocupado}>
          {ORDEN_ROLES.map(function (r) { return <option key={r} value={r}>{V2.ROLES[r].etiqueta}</option>; })}
        </select>
        <V2.Boton onClick={agregar} disabled={ocupado || props.usuarios === null}>{ocupado ? "Guardando…" : props.usuarios === null ? "Cargando usuarios…" : "Habilitar"}</V2.Boton>
      </div>
      {msg && <V2.Aviso tipo={msg.tipo} onCerrar={function () { setMsg(null); }}>{msg.texto}</V2.Aviso>}
      {errInv && <V2.Aviso tipo="error">{errInv}</V2.Aviso>}
      {invs && pendientes.length > 0 && <div style={{ marginTop: 12 }}>
        <div className="v2-sub" style={{ marginBottom: 6 }}>Habilitados que todavía no entraron ({pendientes.length}):</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {pendientes.map(function (i) {
            return <span key={i.id} className="v2-chip" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              {i.id} · {V2.ROLES[i.role] ? V2.ROLES[i.role].etiqueta : i.role}
              <a onClick={function () { quitar(i.id); }} style={{ cursor: "pointer", fontWeight: 700 }} title="Quitar">✕</a>
            </span>;
          })}
        </div>
      </div>}
    </V2.Tarjeta>;
  }

  function PantallaUsuarios() {
    var stLista = useState(null); var lista = stLista[0], setLista = stLista[1];
    var stErr = useState(""); var err = stErr[0], setErr = stErr[1];
    var stFila = useState({}); var errFila = stFila[0], setErrFila = stFila[1];
    var stEnCurso = useState({}); var enCurso = stEnCurso[0], setEnCurso = stEnCurso[1];
    var stQ = useState(""); var q = stQ[0], setQ = stQ[1];

    useEffect(function () {
      return V2.db.collection(V2.config.col.accesos).onSnapshot(
        function (sn) { setLista(sn.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); })); setErr(""); },
        function (e) { setLista([]); setErr("No se pudieron cargar los usuarios: " + ((e && e.message) || e)); });
    }, []);

    if (!V2.puede("usuarios")) return <V2.Aviso tipo="error">Tu rol no tiene permiso para administrar usuarios.</V2.Aviso>;
    var soyPropietario = V2.puede("invitar");

    var marcar = function (id, valor, msg) {
      setEnCurso(function (p) { var n = Object.assign({}, p); if (valor) n[id] = true; else delete n[id]; return n; });
      setErrFila(function (p) { var n = Object.assign({}, p); if (msg) n[id] = msg; else delete n[id]; return n; });
    };
    var guardar = function (u, cambios) {
      var soyYo = V2.usuario && u.id === V2.usuario.uid;
      var nuevoRol = cambios.role != null ? cambios.role : u.role;
      var nuevoEstado = cambios.estado != null ? cambios.estado : u.estado;
      if (soyYo && (nuevoRol !== V2.usuario.role || nuevoEstado === "inactivo")) { marcar(u.id, false, "No podés cambiarte el rol ni desactivarte a vos mismo."); return; }
      marcar(u.id, true, "");
      V2.db.collection(V2.config.col.accesos).doc(u.id).update(Object.assign({}, cambios, {
        actualizadoPor: (V2.usuario && V2.usuario.email) || "", actualizadoEn: new Date().toISOString()
      })).then(function () { marcar(u.id, false, ""); })
        .catch(function (e) { marcar(u.id, false, "No se pudo guardar: " + ((e && e.message) || e)); });
    };

    var norm = function (s) { return String(s || "").toLowerCase(); };
    var esProp = function (u) { return V2.config.propietarios.indexOf(norm(u.email)) >= 0; };
    var visibles = (lista || []).filter(function (u) { return !q.trim() || (norm(u.email) + " " + norm(u.nombre)).indexOf(norm(q.trim())) >= 0; });
    // Pendientes primero, después por email.
    visibles.sort(function (a, b) {
      var pa = V2.ROLES[a.role] ? 1 : 0, pb = V2.ROLES[b.role] ? 1 : 0;
      return pa !== pb ? pa - pb : norm(a.email).localeCompare(norm(b.email));
    });
    var pendientes = (lista || []).filter(function (u) { return !V2.ROLES[u.role] && u.estado !== "inactivo"; }).length;
    var activos = (lista || []).filter(function (u) { return V2.ROLES[u.role] && u.estado !== "inactivo"; }).length;

    return <div>
      {soyPropietario && <HabilitarMails usuarios={lista} />}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <input value={q} onChange={function (e) { setQ(e.target.value); }} placeholder="Buscar por mail o nombre…" style={Object.assign({}, V2.estiloInput, { minWidth: 260 })} />
        <span className="v2-sub">{lista ? (lista.length + " cuenta(s) · " + activos + " activa(s)") : ""}</span>
        {pendientes > 0 && <V2.Chip color={V2.C.warn}>{pendientes} esperando aprobación</V2.Chip>}
      </div>
      {err && <V2.Aviso tipo="error">{err}</V2.Aviso>}
      {lista === null && <V2.Cargando texto="Cargando usuarios…" />}
      {lista && lista.length === 0 && !err && <div className="v2-sub" style={{ padding: 20 }}>Todavía no ingresó nadie. Las cuentas aparecen acá la primera vez que entran con Google.</div>}
      {lista && lista.length > 0 && visibles.length === 0 && <div className="v2-sub" style={{ padding: 20 }}>Nadie coincide con "{q}".</div>}
      {visibles.length > 0 && <div className="v2-tabla-caja">
        <table className="v2-tabla v2-tarjetas">
          <thead><tr><th>Usuario</th><th>Rol</th><th>Acceso</th><th>Último ingreso</th></tr></thead>
          <tbody>
            {visibles.map(function (u) {
              var ocupado = !!enCurso[u.id];
              var activo = u.estado !== "inactivo";
              var sinRol = !V2.ROLES[u.role];
              var intocable = u.role === "owner" || esProp(u);   // el propietario no se edita desde acá
              return <React.Fragment key={u.id}>
                <tr className={activo ? "" : "v2-fila-sin"}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{u.nombre || u.email}</div>
                    <span className="v2-sub">{u.email}</span>
                    {V2.usuario && u.id === V2.usuario.uid && <div style={{ marginTop: 4 }}><V2.Chip color={V2.C.info}>Vos</V2.Chip></div>}
                  </td>
                  <td data-label="Rol">
                    {intocable ? <V2.Chip color={V2.C.green}>Propietario</V2.Chip>
                      : <select value={sinRol ? "" : u.role} disabled={ocupado} onChange={function (e) { if (e.target.value) guardar(u, { role: e.target.value }); }}>
                        {sinRol && <option value="">Sin rol (pendiente)</option>}
                        {ORDEN_ROLES.map(function (r) { return <option key={r} value={r}>{V2.ROLES[r].etiqueta}</option>; })}
                      </select>}
                  </td>
                  <td data-label="Acceso">
                    {intocable ? <span className="v2-sub">—</span>
                      : <V2.Boton tipo={activo ? "secundario" : "primario"} chico disabled={ocupado} onClick={function () { guardar(u, { estado: activo ? "inactivo" : "activo" }); }}>
                        {activo ? "Desactivar" : "Activar"}
                      </V2.Boton>}
                  </td>
                  <td data-label="Último ingreso">{fmtIngreso(u.ultimoIngreso)}</td>
                </tr>
                {errFila[u.id] && <tr><td colSpan={4} style={{ padding: "0 10px 10px" }}><V2.Aviso tipo="error" onCerrar={function () { marcar(u.id, false, ""); }}>{errFila[u.id]}</V2.Aviso></td></tr>}
              </React.Fragment>;
            })}
          </tbody>
        </table>
      </div>}
      <div className="v2-sub" style={{ marginTop: 14, lineHeight: 1.6 }}>
        <b>Administrador</b>: todo, incluido usuarios y métodos · <b>Supervisor</b>: buscar, escuchar, analizar y descargar · <b>Auditor</b>: buscar, escuchar, ver scores y descargar (no dispara análisis).
      </div>
    </div>;
  }

  V2.registrar({ id: "usuarios", titulo: "Usuarios", grupo: "Configuración", icono: "👥", orden: 2, componente: PantallaUsuarios });
})();

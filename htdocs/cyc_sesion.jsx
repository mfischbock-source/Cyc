/*
 * DASA — C&C · cyc_sesion.jsx (lo cargan la app anterior y la v2, ANTES que el resto)
 *
 * El backend ya no acepta el token fijo: pide una cookie de sesión que emite /sesion.php
 * después de validar el login de Firebase (ver cyc_auth.php). Este script:
 *   1. Antes de cualquier fetch/XHR a un .php del mismo sitio, se asegura de tener sesión
 *      (manda el ID token de Firebase a /sesion.php una vez).
 *   2. Si un endpoint contesta 401 (sesión vencida), renueva y reintenta UNA vez.
 *   3. Al cerrar sesión en Firebase, borra la cookie (PCs compartidas del call center).
 * Así no hubo que tocar las ~30 llamadas al backend de cada app.
 */
(function () {
  "use strict";
  var SESION_URL = "/sesion.php";
  var fetchOrig = window.fetch.bind(window);
  var pendiente = null;        // promesa de la sesión en curso / ya hecha
  var uidSesion = null;
  var escuchando = false;

  function authFirebase() {
    if (window.V2 && window.V2.auth) return window.V2.auth;
    if (window.auth && window.auth.currentUser !== undefined) return window.auth;
    try { if (window.firebase && window.firebase.apps && window.firebase.apps.length) return window.firebase.auth(); } catch (e) {}
    return null;
  }

  function esApi(url) {
    try {
      var u = new URL(url, window.location.href);
      return u.origin === window.location.origin && /\.php$/i.test(u.pathname) && u.pathname !== SESION_URL;
    } catch (e) { return false; }
  }

  // Sin usuario en Firebase (cerró sesión, acá o en otra pestaña) → borrar la cookie del server.
  function escucharSalida(auth) {
    if (escuchando || !auth || !auth.onAuthStateChanged) return;
    escuchando = true;
    var habiaUsuario = null;
    auth.onAuthStateChanged(function (user) {
      // Con usuario: pedir la sesión YA (no esperar al primer fetch). Hay pantallas que solo usan
      // Firestore y lo primero que piden al server es un <audio src="audio.php">, que no pasa por
      // fetch: sin esto el audio daba 401 hasta que alguna otra cosa abría la sesión.
      if (user) { habiaUsuario = true; window.cycSesion(false); return; }
      if (habiaUsuario === false) return;          // ya se borró
      habiaUsuario = false; uidSesion = null; pendiente = null;
      fetchOrig(SESION_URL, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: '{"salir":true}' }).catch(function () {});
    });
  }

  // La cookie dura 12 h (cyc_auth.php): renovarla cada 6 h para que los <audio> de una pestaña que
  // quedó abierta todo el día no empiecen a dar 401 (los fetch se renuevan solos ante un 401).
  setInterval(function () {
    var a = authFirebase();
    if (a && a.currentUser) window.cycSesion(true);
  }, 6 * 3600 * 1000);

  // Enganchar el listener apenas la app inicializa Firebase (no esperar al primer pedido).
  var intentos = 0;
  var poll = setInterval(function () {
    var a = authFirebase();
    if (a || ++intentos > 120) { clearInterval(poll); if (a) escucharSalida(a); }
  }, 250);

  // Devuelve una promesa que resuelve true si hay sesión en el server.
  window.cycSesion = function (forzar) {
    var auth = authFirebase();
    var user = auth && auth.currentUser;
    if (!user) return Promise.resolve(false);
    escucharSalida(auth);
    if (pendiente && !forzar && uidSesion === user.uid) return pendiente;
    uidSesion = user.uid;
    pendiente = user.getIdToken(!!forzar).then(function (idToken) {
      return fetchOrig(SESION_URL, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: idToken })
      });
    }).then(function (r) {
      if (!r.ok) { pendiente = null; console.warn("[cyc] sesión rechazada:", r.status); }
      return r.ok;
    }).catch(function (e) { pendiente = null; console.warn("[cyc] no se pudo iniciar sesión:", e); return false; });
    return pendiente;
  };

  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || String(input);
    if (!esApi(url)) return fetchOrig(input, init);
    var opciones = Object.assign({ credentials: "same-origin" }, init || {});
    return window.cycSesion(false).then(function () {
      return fetchOrig(input, opciones);
    }).then(function (r) {
      if (r.status !== 401) return r;
      return window.cycSesion(true).then(function (ok) { return ok ? fetchOrig(input, opciones) : r; });
    });
  };

  // XHR (las subidas con barra de progreso): esperar la sesión antes de enviar.
  var openOrig = XMLHttpRequest.prototype.open;
  var sendOrig = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (metodo, url) {
    this._cycApi = esApi(url);
    return openOrig.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this, args = arguments;
    if (!xhr._cycApi) return sendOrig.apply(xhr, args);
    window.cycSesion(false).then(function () { sendOrig.apply(xhr, args); });
  };
})();

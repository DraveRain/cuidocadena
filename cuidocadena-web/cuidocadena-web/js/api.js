/* Capa de acceso a datos. La interfaz solo usa CC.api; esta capa decide si habla con
   el modo demostración (navegador) o con el script de Google Apps Script (modo real). */
(function () {
  'use strict';
  var cfg = CC.config;

  function remoto(accion, datos) {
    var cuerpo = JSON.stringify(Object.assign({ accion: accion }, datos));
    // text/plain evita la petición previa (preflight) que Apps Script no responde
    return fetch(cfg.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: cuerpo })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, mensaje: 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.' }; });
  }

  var acciones = ['registrar', 'datosPanel', 'guardarMedicamento', 'agregarHorario', 'cambiarActivo', 'vistaPaciente', 'confirmar', 'historial'];
  var api = { modo: cfg.API_URL ? 'real' : 'demo' };
  acciones.forEach(function (a) {
    api[a] = function (datos) {
      if (cfg.API_URL) return remoto(a, datos || {});
      // el modo demostración responde igual que el servidor: de forma asíncrona
      return new Promise(function (res) { setTimeout(function () { res(CC.demoApi[a](datos || {})); }, 60); });
    };
  });
  api.demo = CC.demoApi.demo;
  CC.api = api;
})();

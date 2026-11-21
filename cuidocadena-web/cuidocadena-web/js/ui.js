/* Elementos compartidos: encabezado, pie, barra de demostración y utilidades de pantalla. */
(function () {
  'use strict';
  var L = CC.logica;
  var ui = {};

  ui.ICONO = { confirmada: '✔', pendiente: '⏳', omitida: '⚠', programada: '🕒' };
  ui.TEXTO = { confirmada: 'Tomada', pendiente: 'Por confirmar', omitida: 'No confirmada', programada: 'Programada' };

  ui.estado = function (e) {
    return '<span class="estado ' + e + '"><span aria-hidden="true">' + ui.ICONO[e] + '</span>' + ui.TEXTO[e] + '</span>';
  };
  ui.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  ui.hora12 = function (hhmm) {
    var p = hhmm.split(':'), h = +p[0], suf = h >= 12 ? 'p. m.' : 'a. m.';
    return ((h % 12) || 12) + ':' + p[1] + ' ' + suf;
  };
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  ui.fechaLarga = function (iso) {
    var p = iso.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
    return DIAS[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()];
  };
  ui.param = function (n) { return new URLSearchParams(location.search).get(n); };
  ui.base = function () { return location.href.replace(/[^\/]*([?#].*)?$/, ''); };

  ui.encabezado = function (activo) {
    var items = [['index.html', 'Inicio', 'inicio'], ['registro.html', 'Registro', 'registro'], ['privacidad.html', 'Privacidad y ayuda', 'privacidad']];
    var panel = localStorage.getItem('cc_enlace_panel');
    if (panel) items.splice(2, 0, [panel, 'Mi panel', 'panel']);
    var h = '<header class="encabezado"><div class="contenedor"><a class="marca" href="index.html" aria-label="CuidoCadena, inicio"><img src="img/logo-horizontal.svg" alt="CuidoCadena"></a><nav class="menu" aria-label="Principal">';
    items.forEach(function (i) { h += '<a href="' + i[0] + '"' + (i[2] === activo ? ' aria-current="page"' : '') + '>' + i[1] + '</a>'; });
    h += '</nav></div></header>';
    return h;
  };
  ui.pie = function () {
    return '<footer class="pie"><div class="contenedor"><div>© 2026 CuidoCadena · Proyecto de práctica profesional, Universidad Simón Bolívar</div>' +
      '<div><a href="privacidad.html">Aviso de privacidad y ayuda</a></div></div></footer>';
  };
  ui.montar = function (activo, claseMain) {
    var cab = document.getElementById('cab'), pie = document.getElementById('pie');
    if (cab) cab.innerHTML = ui.encabezado(activo);
    if (pie) pie.innerHTML = ui.pie();
    if (CC.api.modo === 'demo') ui.barraDemo();
  };

  /* ---------- barra de demostración ---------- */
  ui.barraDemo = function () {
    document.body.classList.add('con-barra-demo');
    var d = CC.api.demo, b = document.createElement('div');
    b.className = 'barra-demo'; b.setAttribute('role', 'region'); b.setAttribute('aria-label', 'Herramientas de demostración');
    b.innerHTML = '<strong>Modo demostración</strong>' +
      '<span class="reloj" id="demo-reloj"></span>' +
      '<button type="button" data-a="adelantar">Adelantar 15 min</button>' +
      '<button type="button" data-a="adelantar30">Adelantar 1 hora</button>' +
      '<label><input type="checkbox" id="demo-fallo"> Simular fallo del correo</label>' +
      '<button type="button" data-a="correos">Correos enviados</button>' +
      '<button type="button" data-a="ejemplo">Cargar ejemplo</button>' +
      '<button type="button" data-a="reiniciar">Reiniciar</button>';
    document.body.appendChild(b);
    var dlg = document.createElement('dialog'); dlg.id = 'dlg-correos';
    dlg.innerHTML = '<h2>Correos enviados al cuidador</h2><p style="color:#4A5B66;font-size:.9rem">En la versión real salen por Gmail con MailApp. Aquí se simulan.</p><div id="lista-correos"></div><button class="boton pequeno" type="button" id="cerrar-correos">Cerrar</button>';
    document.body.appendChild(dlg);
    function reloj() {
      var t = new Date(d.ahoraMs());
      document.getElementById('demo-reloj').textContent = 'Hora simulada: ' + ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2);
    }
    reloj(); setInterval(reloj, 5000);
    document.getElementById('demo-fallo').checked = d.fallarCorreo();
    document.getElementById('demo-fallo').addEventListener('change', function (e) { d.fallarCorreo(e.target.checked); });
    b.addEventListener('click', function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-a'); if (!a) return;
      if (a === 'adelantar') { d.adelantarReloj(15); location.reload(); }
      else if (a === 'adelantar30') { d.adelantarReloj(60); location.reload(); }
      else if (a === 'reiniciar') { d.reiniciar(); localStorage.removeItem('cc_enlace_panel'); location.href = 'index.html'; }
      else if (a === 'ejemplo') { var r = d.cargarEjemplo(); localStorage.setItem('cc_enlace_panel', 'panel.html?c=' + r.tokenCuidador); location.href = 'panel.html?c=' + r.tokenCuidador; }
      else if (a === 'correos') {
        var cs = d.correos();
        document.getElementById('lista-correos').innerHTML = cs.length ? cs.map(function (c) {
          return '<div class="correo-sim"><div class="meta">Para: ' + ui.esc(c.para) + ' · ' + ui.esc(c.enviado.replace('T', ' ')) + '</div><strong>' + ui.esc(c.asunto) + '</strong><div>' + ui.esc(c.cuerpo) + '</div></div>';
        }).join('') : '<p>Todavía no se ha enviado ningún correo.</p>';
        dlg.showModal();
      }
    });
    document.getElementById('cerrar-correos').addEventListener('click', function () { dlg.close(); });
    // simula el disparador de tiempo del script (cada pocos segundos en la demostración)
    setInterval(function () {
      var r = d.ejecutarVerificacion();
      if (r.nuevas || r.enviadas) { if (ui.alActualizar) ui.alActualizar(); }
    }, CC.config.VERIFICACION_DEMO_SEG * 1000);
  };

  ui.errorCampo = function (id, msg) {
    var campo = document.getElementById(id); if (!campo) return;
    var cont = campo.closest('.campo') || campo.parentElement;
    cont.classList.toggle('con-error', !!msg);
    var e = cont.querySelector('.error'); if (e) { e.textContent = msg || ''; }
  };

  /* Enlaces para compartir el enlace del paciente por WhatsApp o correo (sin servidor) */
  ui.msgPaciente = function (nombre, enlace) {
    return 'Hola, este es tu enlace de CuidoCadena para confirmar tus medicamentos' + (nombre ? ', ' + nombre : '') +
           '. Ábrelo cuando sea la hora de tu toma y toca el botón "Ya tomé mi medicamento": ' + enlace;
  };
  ui.enlaceWhatsApp = function (nombre, enlace) { return 'https://wa.me/?text=' + encodeURIComponent(ui.msgPaciente(nombre, enlace)); };
  ui.enlaceCorreo = function (nombre, enlace) {
    return 'mailto:?subject=' + encodeURIComponent('Tu enlace de CuidoCadena') + '&body=' + encodeURIComponent(ui.msgPaciente(nombre, enlace));
  };

  ui.copiar = function (texto, boton) {
    var ok = function () { var t = boton.textContent; boton.textContent = 'Copiado ✔'; setTimeout(function () { boton.textContent = t; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texto).then(ok, ok); else ok();
  };

  CC.ui = ui;
})();

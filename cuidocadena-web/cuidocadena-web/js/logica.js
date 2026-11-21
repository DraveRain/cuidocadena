/* CuidoCadena - reglas de negocio puras (sin acceso a datos ni a la pantalla).
   Las mismas reglas están implementadas en apps-script/Codigo.gs. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.CC = root.CC || {}; root.CC.logica = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_INTENTOS = 3;
  // Una alerta solo se genera si la ventana terminó hace menos de este margen (minutos).
  // Evita avisos tardíos, o falsos, cuando se crea un horario después de su hora.
  var MARGEN_ALERTA_MIN = 60;

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // Fecha local en formato AAAA-MM-DD
  function fechaISO(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function sumarDias(fecha, dias) {
    var p = fecha.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2] + dias, 12, 0, 0);
    return fechaISO(d);
  }

  // Momento (ms) en que empieza una toma: fecha AAAA-MM-DD + hora HH:MM
  function inicioToma(fecha, hora) {
    var f = fecha.split('-'), h = hora.split(':');
    return new Date(+f[0], +f[1] - 1, +f[2], +h[0], +h[1], 0, 0).getTime();
  }

  function validarCorreo(c) {
    return typeof c === 'string' && c.length <= 100 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.trim());
  }

  function validarHora(h) {
    return typeof h === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(h);
  }

  function validarVentana(v) {
    var n = Number(v);
    return Number.isInteger(n) && n >= 5 && n <= 240;
  }

  function validarEdad(e) {
    var n = Number(e);
    return Number.isInteger(n) && n >= 60 && n <= 120;
  }

  function validarTelefono(t) {
    return t === undefined || t === null || t === '' || (/^\d{7,15}$/.test(String(t)));
  }

  // Devuelve un objeto {campo: mensaje}; vacío si todo es válido (RF01, RF02)
  function validarRegistro(d) {
    var e = {};
    if (!d.cuidadorNombre || !String(d.cuidadorNombre).trim()) e.cuidadorNombre = 'Escribe el nombre del cuidador.';
    else if (String(d.cuidadorNombre).length > 80) e.cuidadorNombre = 'El nombre es demasiado largo.';
    if (!validarCorreo(d.cuidadorCorreo)) e.cuidadorCorreo = 'Escribe un correo válido, por ejemplo nombre@correo.com.';
    if (!validarTelefono(d.cuidadorTelefono)) e.cuidadorTelefono = 'El teléfono debe tener solo números, entre 7 y 15 dígitos.';
    if (!d.pacienteNombre || !String(d.pacienteNombre).trim()) e.pacienteNombre = 'Escribe el nombre del paciente.';
    else if (String(d.pacienteNombre).length > 80) e.pacienteNombre = 'El nombre es demasiado largo.';
    if (!validarEdad(d.pacienteEdad)) e.pacienteEdad = 'La edad debe estar entre 60 y 120 años.';
    if (d.consentimiento !== true) e.consentimiento = 'Debes aceptar el tratamiento de datos para continuar.';
    return e;
  }

  function validarMedicamento(d) {
    var e = {};
    if (!d.nombre || !String(d.nombre).trim()) e.nombre = 'Escribe el nombre del medicamento.';
    else if (String(d.nombre).length > 80) e.nombre = 'El nombre es demasiado largo.';
    if (!d.dosis || !String(d.dosis).trim()) e.dosis = 'Escribe la dosis, por ejemplo 1 tableta de 50 mg.';
    else if (String(d.dosis).length > 50) e.dosis = 'La dosis es demasiado larga.';
    if (!validarHora(d.hora)) e.hora = 'Escribe la hora con formato 24 horas, por ejemplo 08:00.';
    if (!validarVentana(d.ventana)) e.ventana = 'La ventana debe estar entre 5 y 240 minutos.';
    return e;
  }

  // Estado de una toma en un momento dado (RF05, RF06, RF07)
  //  programada: la hora aún no llega
  //  pendiente:  la hora llegó y la ventana sigue abierta
  //  confirmada: existe confirmación para ese horario y día
  //  omitida:    la ventana terminó sin confirmación
  function estadoToma(horario, fecha, ahoraMs, confirmacion) {
    if (confirmacion) return 'confirmada';
    var ini = inicioToma(fecha, horario.hora_programada);
    var fin = ini + Number(horario.ventana_min) * 60000;
    if (ahoraMs < ini) return 'programada';
    if (ahoraMs < fin) return 'pendiente';
    return 'omitida';
  }

  // ¿Se puede confirmar ahora? Solo dentro de la ventana y una vez por toma (RF05, RF06)
  function puedeConfirmar(horario, fecha, ahoraMs, confirmacion) {
    if (!horario || horario.activo === false) return { ok: false, mensaje: 'Este horario no está activo.' };
    if (confirmacion) return { ok: false, mensaje: 'La toma ya estaba confirmada.' };
    var est = estadoToma(horario, fecha, ahoraMs, null);
    if (est === 'programada') return { ok: false, mensaje: 'Todavía no es la hora de esta toma.' };
    if (est === 'omitida') return { ok: false, mensaje: 'La ventana de confirmación ya terminó.' };
    return { ok: true };
  }

  function hayConfirmacion(confirmaciones, idHorario, fecha) {
    for (var i = 0; i < confirmaciones.length; i++) {
      if (confirmaciones[i].id_horario === idHorario && confirmaciones[i].fecha_toma === fecha) return confirmaciones[i];
    }
    return null;
  }

  function hayAlerta(alertas, idHorario, fecha) {
    for (var i = 0; i < alertas.length; i++) {
      if (alertas[i].id_horario === idHorario && alertas[i].fecha_toma === fecha) return alertas[i];
    }
    return null;
  }

  // Tomas de un día, con estado, para los horarios activos (de medicamentos activos)
  function tomasDelDia(horarios, medicamentos, confirmaciones, fecha, ahoraMs) {
    var porMed = {};
    medicamentos.forEach(function (m) { porMed[m.id_medicamento] = m; });
    var out = [];
    horarios.forEach(function (h) {
      var m = porMed[h.id_medicamento];
      if (!m || m.activo === false || h.activo === false) return;
      var conf = hayConfirmacion(confirmaciones, h.id_horario, fecha);
      out.push({
        id_horario: h.id_horario,
        medicamento: m.nombre,
        dosis: m.dosis,
        hora: h.hora_programada,
        ventana_min: Number(h.ventana_min),
        fecha: fecha,
        estado: estadoToma(h, fecha, ahoraMs, conf),
        confirmado_por: conf ? conf.confirmado_por : null,
        hora_confirmacion: conf ? conf.fecha_hora_registro : null
      });
    });
    out.sort(function (a, b) { return a.hora < b.hora ? -1 : a.hora > b.hora ? 1 : 0; });
    return out;
  }

  // Próxima toma que el paciente debe atender: la pendiente más antigua o, si no hay, la programada más cercana
  function proximaToma(tomas) {
    var pend = tomas.filter(function (t) { return t.estado === 'pendiente'; });
    if (pend.length) return pend[0];
    var prog = tomas.filter(function (t) { return t.estado === 'programada'; });
    return prog.length ? prog[0] : null;
  }

  // Tomas cuya ventana terminó sin confirmación y sin alerta registrada (CU04, RF07)
  function tomasQueRequierenAlerta(horarios, medicamentos, confirmaciones, alertas, fecha, ahoraMs) {
    return tomasDelDia(horarios, medicamentos, confirmaciones, fecha, ahoraMs).filter(function (t) {
      if (t.estado !== 'omitida' || hayAlerta(alertas, t.id_horario, fecha)) return false;
      var fin = inicioToma(fecha, t.hora) + t.ventana_min * 60000;
      return ahoraMs - fin <= MARGEN_ALERTA_MIN * 60000;
    });
  }

  // Resultado de un intento de envío (RF08): máximo tres intentos
  function resultadoIntento(alerta, exito, ahoraIso) {
    var a = {}; for (var k in alerta) a[k] = alerta[k];
    a.intentos = Number(a.intentos || 0) + 1;
    if (exito) { a.estado_envio = 'enviada'; a.fecha_hora_envio = ahoraIso; }
    else if (a.intentos >= MAX_INTENTOS) a.estado_envio = 'fallida';
    else a.estado_envio = 'pendiente';
    return a;
  }

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  return {
    MAX_INTENTOS: MAX_INTENTOS, MARGEN_ALERTA_MIN: MARGEN_ALERTA_MIN,
    fechaISO: fechaISO, sumarDias: sumarDias, inicioToma: inicioToma,
    validarCorreo: validarCorreo, validarHora: validarHora, validarVentana: validarVentana,
    validarEdad: validarEdad, validarTelefono: validarTelefono,
    validarRegistro: validarRegistro, validarMedicamento: validarMedicamento,
    estadoToma: estadoToma, puedeConfirmar: puedeConfirmar,
    hayConfirmacion: hayConfirmacion, hayAlerta: hayAlerta,
    tomasDelDia: tomasDelDia, proximaToma: proximaToma,
    tomasQueRequierenAlerta: tomasQueRequierenAlerta,
    resultadoIntento: resultadoIntento, uuid: uuid
  };
});

/**
 * CuidoCadena - servicio web (Google Apps Script) con Google Sheets como base de datos.
 *
 * Archivos del proyecto Apps Script:
 *   Logica.gs  -> reglas de negocio (es el mismo archivo js/logica.js del sitio, sin cambios)
 *   Codigo.gs  -> este archivo: acceso a las hojas, acciones de la API, correos y verificador
 *
 * Pasos de instalación en README.md. Zona horaria: America/Bogota (appsscript.json).
 */

// reglas de Logica.gs (con Proxy no importa el orden en que Apps Script cargue los archivos)
var L = new Proxy({}, { get: function (_, k) { return CC.logica[k]; } });
var HOJAS = {
  Cuidador:     ['id_cuidador', 'nombre', 'correo', 'telefono', 'token_acceso'],
  Paciente:     ['id_paciente', 'id_cuidador', 'nombre', 'edad', 'consentimiento', 'fecha_consentimiento', 'token_acceso'],
  Medicamento:  ['id_medicamento', 'id_paciente', 'nombre', 'dosis', 'activo'],
  Horario:      ['id_horario', 'id_medicamento', 'hora_programada', 'ventana_min', 'activo'],
  Confirmacion: ['id_confirmacion', 'id_horario', 'fecha_toma', 'fecha_hora_registro', 'confirmado_por'],
  Alerta:       ['id_alerta', 'id_horario', 'fecha_toma', 'estado_envio', 'intentos', 'fecha_hora_envio']
};
var NUMERICAS = { edad: 1, ventana_min: 1, intentos: 1 };
var BOOLEANAS = { consentimiento: 1, activo: 1 };

/* ===================== Utilidades de hojas ===================== */

function libro_() { return SpreadsheetApp.getActiveSpreadsheet(); }

/** Crea las seis hojas con sus encabezados. Ejecutar una sola vez desde el editor. */
function configurarHojas() {
  var libro = libro_();
  Object.keys(HOJAS).forEach(function (nombre) {
    var hoja = libro.getSheetByName(nombre) || libro.insertSheet(nombre);
    var cols = HOJAS[nombre];
    hoja.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    hoja.getRange(1, 1, hoja.getMaxRows(), cols.length).setNumberFormat('@');   // texto: evita que Sheets convierta "08:00" en hora
    hoja.setFrozenRows(1);
  });
}

function leer_(nombre) {
  var hoja = libro_().getSheetByName(nombre), cols = HOJAS[nombre];
  var n = hoja.getLastRow();
  if (n < 2) return [];
  return hoja.getRange(2, 1, n - 1, cols.length).getValues().map(function (fila) {
    var o = {};
    cols.forEach(function (c, i) {
      var v = fila[i];
      if (v === '') v = (c === 'fecha_hora_envio') ? null : '';
      else if (NUMERICAS[c]) v = Number(v);
      else if (BOOLEANAS[c]) v = (v === true || String(v).toUpperCase() === 'TRUE');
      o[c] = v;
    });
    return o;
  });
}

function aFila_(nombre, obj) {
  return HOJAS[nombre].map(function (c) { var v = obj[c]; return v === null || v === undefined ? '' : String(v); });
}

function insertar_(nombre, obj) {
  var hoja = libro_().getSheetByName(nombre);
  hoja.getRange(hoja.getLastRow() + 1, 1, 1, HOJAS[nombre].length).setValues([aFila_(nombre, obj)]);
}

function actualizar_(nombre, clave, obj) {
  var hoja = libro_().getSheetByName(nombre), cols = HOJAS[nombre];
  var n = hoja.getLastRow();
  if (n < 2) return false;
  var ids = hoja.getRange(2, 1, n - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(obj[clave])) {
      hoja.getRange(i + 2, 1, 1, cols.length).setValues([aFila_(nombre, obj)]);
      return true;
    }
  }
  return false;
}

function ahoraIso_(ms) {
  return Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}
function por_(lista, campo, valor) { return lista.filter(function (x) { return x[campo] === valor; })[0]; }
function nuevoId_() { return Utilities.getUuid(); }

/* ===================== Puerta de entrada (POST) ===================== */

function doPost(e) {
  var lock = LockService.getScriptLock();
  var respuesta;
  try {
    lock.waitLock(20000);                  // un solo escritor a la vez (RNF de integridad)
    var d = JSON.parse(e.postData.contents);
    var acciones = { registrar: registrar, datosPanel: datosPanel, guardarMedicamento: guardarMedicamento,
                     agregarHorario: agregarHorario, cambiarActivo: cambiarActivo, vistaPaciente: vistaPaciente,
                     confirmar: confirmar, historial: historial };
    if (!acciones.hasOwnProperty(d.accion)) respuesta = { ok: false, mensaje: 'Acción no válida.' };
    else respuesta = acciones[d.accion](d);
  } catch (err) {
    console.error(err);
    respuesta = { ok: false, mensaje: 'Ocurrió un error en el servidor. Inténtalo de nuevo en un momento.' };
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
  return ContentService.createTextOutput(JSON.stringify(respuesta)).setMimeType(ContentService.MimeType.JSON);
}

/** Sirve para comprobar en el navegador que el despliegue quedó activo. */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, servicio: 'CuidoCadena' })).setMimeType(ContentService.MimeType.JSON);
}

/* ===================== Acciones ===================== */

function cuidadorPorToken_(token) { return token ? por_(leer_('Cuidador'), 'token_acceso', token) : null; }
function pacientePorToken_(token) { return token ? por_(leer_('Paciente'), 'token_acceso', token) : null; }
function pacientesDe_(cuid) { return leer_('Paciente').filter(function (p) { return p.id_cuidador === cuid.id_cuidador; }); }
function medsDe_(idPac) { return leer_('Medicamento').filter(function (m) { return m.id_paciente === idPac; }); }
function horsDe_(meds) {
  var ids = {}; meds.forEach(function (m) { ids[m.id_medicamento] = 1; });
  return leer_('Horario').filter(function (h) { return ids[h.id_medicamento]; });
}
function idsHorario_(hors) { var o = {}; hors.forEach(function (h) { o[h.id_horario] = 1; }); return o; }

function tomasHoy_(pac, ahora) {
  var meds = medsDe_(pac.id_paciente), hors = horsDe_(meds), ids = idsHorario_(hors);
  var conf = leer_('Confirmacion').filter(function (c) { return ids[c.id_horario]; });
  return L.tomasDelDia(hors, meds, conf, L.fechaISO(new Date(ahora)), ahora);
}

function registrar(d) {                       // CU01
  var err = L.validarRegistro(d);
  if (Object.keys(err).length) return { ok: false, errores: err };
  var correo = String(d.cuidadorCorreo).trim().toLowerCase();
  var cuid = por_(leer_('Cuidador'), 'correo', correo);
  if (!cuid) {
    cuid = { id_cuidador: nuevoId_(), nombre: String(d.cuidadorNombre).trim(), correo: correo,
             telefono: d.cuidadorTelefono || '', token_acceso: nuevoId_() };
    insertar_('Cuidador', cuid);
  }
  var pac = { id_paciente: nuevoId_(), id_cuidador: cuid.id_cuidador, nombre: String(d.pacienteNombre).trim(),
              edad: Number(d.pacienteEdad), consentimiento: true, fecha_consentimiento: ahoraIso_(Date.now()), token_acceso: nuevoId_() };
  insertar_('Paciente', pac);
  return { ok: true, tokenCuidador: cuid.token_acceso, tokenPaciente: pac.token_acceso };
}

function datosPanel(d) {                      // CU02 y CU05 (resumen)
  var cuid = cuidadorPorToken_(d.token);
  if (!cuid) return { ok: false, mensaje: 'Enlace no válido.' };
  var pacs = pacientesDe_(cuid);
  if (!pacs.length) return { ok: false, mensaje: 'Este cuidador no tiene pacientes.' };
  var pac = por_(pacs, 'id_paciente', d.idPaciente) || pacs[0];
  var meds = medsDe_(pac.id_paciente), hors = horsDe_(meds), ids = idsHorario_(hors), ahora = Date.now();
  return {
    ok: true, ahoraMs: ahora,
    cuidador: { nombre: cuid.nombre, correo: cuid.correo },
    pacientes: pacs.map(function (p) { return { id_paciente: p.id_paciente, nombre: p.nombre, edad: p.edad }; }),
    paciente: { id_paciente: pac.id_paciente, nombre: pac.nombre, edad: pac.edad, token_paciente: pac.token_acceso },
    medicamentos: meds.map(function (m) {
      return { id_medicamento: m.id_medicamento, nombre: m.nombre, dosis: m.dosis, activo: m.activo,
               horarios: hors.filter(function (h) { return h.id_medicamento === m.id_medicamento; }) };
    }),
    tomasHoy: tomasHoy_(pac, ahora),
    alertas: leer_('Alerta').filter(function (a) { return ids[a.id_horario]; })
  };
}

function guardarMedicamento(d) {              // CU02
  var cuid = cuidadorPorToken_(d.token);
  if (!cuid) return { ok: false, mensaje: 'Enlace no válido.' };
  var pac = por_(pacientesDe_(cuid), 'id_paciente', d.idPaciente);
  if (!pac) return { ok: false, mensaje: 'El paciente no existe.' };
  var err = L.validarMedicamento(d);
  if (Object.keys(err).length) return { ok: false, errores: err };
  var m = { id_medicamento: nuevoId_(), id_paciente: pac.id_paciente, nombre: String(d.nombre).trim(), dosis: String(d.dosis).trim(), activo: true };
  insertar_('Medicamento', m);
  insertar_('Horario', { id_horario: nuevoId_(), id_medicamento: m.id_medicamento, hora_programada: d.hora, ventana_min: Number(d.ventana), activo: true });
  return { ok: true };
}

function agregarHorario(d) {
  var cuid = cuidadorPorToken_(d.token);
  if (!cuid) return { ok: false, mensaje: 'Enlace no válido.' };
  var m = por_(leer_('Medicamento'), 'id_medicamento', d.idMedicamento);
  var pac = m && por_(pacientesDe_(cuid), 'id_paciente', m.id_paciente);
  if (!m || !pac) return { ok: false, mensaje: 'El medicamento no existe.' };
  var err = {};
  if (!L.validarHora(d.hora)) err.hora = 'Escribe la hora con formato 24 horas, por ejemplo 08:00.';
  if (!L.validarVentana(d.ventana)) err.ventana = 'La ventana debe estar entre 5 y 240 minutos.';
  if (Object.keys(err).length) return { ok: false, errores: err };
  insertar_('Horario', { id_horario: nuevoId_(), id_medicamento: m.id_medicamento, hora_programada: d.hora, ventana_min: Number(d.ventana), activo: true });
  return { ok: true };
}

function cambiarActivo(d) {                   // RF10: desactivar sin borrar historial
  var cuid = cuidadorPorToken_(d.token);
  if (!cuid) return { ok: false, mensaje: 'Enlace no válido.' };
  var propios = {}; pacientesDe_(cuid).forEach(function (p) { propios[p.id_paciente] = 1; });
  var meds = leer_('Medicamento').filter(function (m) { return propios[m.id_paciente]; });
  if (d.tipo === 'horario') {
    var h = por_(horsDe_(meds), 'id_horario', d.id);
    if (!h) return { ok: false, mensaje: 'No se encontró el registro.' };
    h.activo = !!d.activo; actualizar_('Horario', 'id_horario', h);
  } else {
    var m = por_(meds, 'id_medicamento', d.id);
    if (!m) return { ok: false, mensaje: 'No se encontró el registro.' };
    m.activo = !!d.activo; actualizar_('Medicamento', 'id_medicamento', m);
  }
  return { ok: true };
}

function vistaPaciente(d) {                   // pantalla simple del paciente
  var pac = pacientePorToken_(d.token);
  if (!pac) return { ok: false, mensaje: 'Enlace no válido.' };
  var ahora = Date.now(), tomas = tomasHoy_(pac, ahora);
  return { ok: true, ahoraMs: ahora, paciente: { nombre: pac.nombre }, tomasHoy: tomas, proxima: L.proximaToma(tomas) };
}

function confirmar(d) {                       // CU03
  var quien, pac, cuid;
  if (d.quien === 'cuidador') {
    cuid = cuidadorPorToken_(d.token);
    if (!cuid) return { ok: false, mensaje: 'Enlace no válido.' };
    quien = 'cuidador';
  } else {
    pac = pacientePorToken_(d.token);
    if (!pac) return { ok: false, mensaje: 'Enlace no válido.' };
    quien = 'paciente';
  }
  var h = por_(leer_('Horario'), 'id_horario', d.idHorario);
  if (!h) return { ok: false, mensaje: 'La toma no existe.' };
  var m = por_(leer_('Medicamento'), 'id_medicamento', h.id_medicamento);
  if (pac && m.id_paciente !== pac.id_paciente) return { ok: false, mensaje: 'La toma no pertenece a este paciente.' };
  if (cuid && !por_(pacientesDe_(cuid), 'id_paciente', m.id_paciente)) return { ok: false, mensaje: 'La toma no pertenece a un paciente de este cuidador.' };
  var ahora = Date.now(), hoy = L.fechaISO(new Date(ahora));
  var previa = L.hayConfirmacion(leer_('Confirmacion'), h.id_horario, hoy);
  var r = L.puedeConfirmar(h, hoy, ahora, previa);
  if (!r.ok) return r;
  insertar_('Confirmacion', { id_confirmacion: nuevoId_(), id_horario: h.id_horario, fecha_toma: hoy,
                              fecha_hora_registro: ahoraIso_(ahora), confirmado_por: quien });
  return { ok: true };
}

function historial(d) {                       // CU05
  var cuid = cuidadorPorToken_(d.token);
  if (!cuid) return { ok: false, mensaje: 'Enlace no válido.' };
  var pac = por_(pacientesDe_(cuid), 'id_paciente', d.idPaciente);
  if (!pac) return { ok: false, mensaje: 'El paciente no existe.' };
  var meds = medsDe_(pac.id_paciente), hors = horsDe_(meds), mapaH = {}, mapaM = {};
  hors.forEach(function (h) { mapaH[h.id_horario] = h; });
  meds.forEach(function (m) { mapaM[m.id_medicamento] = m; });
  var filas = [];
  leer_('Confirmacion').forEach(function (c) {
    var h = mapaH[c.id_horario]; if (!h) return;
    filas.push({ fecha: c.fecha_toma, hora: h.hora_programada, medicamento: mapaM[h.id_medicamento].nombre,
                 dosis: mapaM[h.id_medicamento].dosis, estado: 'confirmada', detalle: 'Confirmada por ' + c.confirmado_por });
  });
  leer_('Alerta').forEach(function (a) {
    var h = mapaH[a.id_horario]; if (!h) return;
    filas.push({ fecha: a.fecha_toma, hora: h.hora_programada, medicamento: mapaM[h.id_medicamento].nombre,
                 dosis: mapaM[h.id_medicamento].dosis, estado: 'omitida',
                 detalle: 'Alerta ' + a.estado_envio + ', intentos: ' + a.intentos });
  });
  filas = filas.filter(function (f) { return (!d.desde || f.fecha >= d.desde) && (!d.hasta || f.fecha <= d.hasta); });
  filas.sort(function (a, b) { return a.fecha === b.fecha ? (a.hora < b.hora ? 1 : -1) : (a.fecha < b.fecha ? 1 : -1); });
  return { ok: true, filas: filas };
}

/* ===================== Sistema de Verificación Automática (CU04) ===================== */

/** Se ejecuta cada 5 minutos con un disparador de tiempo. Crea alertas y envía los correos. */
function verificarConfirmaciones() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ahora = Date.now(), hoy = L.fechaISO(new Date(ahora)), resumen = { nuevas: 0, enviadas: 0, fallidas: 0 };
    var cuidadores = leer_('Cuidador');
    leer_('Paciente').forEach(function (p) {
      var cuid = por_(cuidadores, 'id_cuidador', p.id_cuidador);
      var meds = medsDe_(p.id_paciente), hors = horsDe_(meds), ids = idsHorario_(hors);
      var conf = leer_('Confirmacion').filter(function (c) { return ids[c.id_horario]; });
      var alertas = leer_('Alerta').filter(function (a) { return ids[a.id_horario]; });
      L.tomasQueRequierenAlerta(hors, meds, conf, alertas, hoy, ahora).forEach(function (t) {
        var a = { id_alerta: nuevoId_(), id_horario: t.id_horario, fecha_toma: hoy, estado_envio: 'pendiente', intentos: 0, fecha_hora_envio: null };
        insertar_('Alerta', a); alertas.push(a); resumen.nuevas++;
      });
      alertas.forEach(function (a) {
        if (a.estado_envio !== 'pendiente') return;
        var h = por_(hors, 'id_horario', a.id_horario), m = por_(meds, 'id_medicamento', h.id_medicamento);
        var exito = enviarCorreo_(cuid.correo,
          'CuidoCadena: ' + p.nombre + ' no confirmó su medicamento',
          p.nombre + ' no confirmó la toma de ' + m.nombre + ' (' + m.dosis + ') programada a las ' + h.hora_programada +
          '. La ventana de ' + h.ventana_min + ' minutos ya terminó. Te recomendamos comunicarte con ella o con él.');
        var nueva = L.resultadoIntento(a, exito, ahoraIso_(ahora));
        actualizar_('Alerta', 'id_alerta', nueva);
        if (exito) resumen.enviadas++; else if (nueva.estado_envio === 'fallida') resumen.fallidas++;
      });
    });
    console.log(JSON.stringify(resumen));
    return resumen;
  } finally { lock.releaseLock(); }
}

function enviarCorreo_(para, asunto, cuerpo) {
  try { MailApp.sendEmail({ to: para, subject: asunto, body: cuerpo, name: 'CuidoCadena' }); return true; }
  catch (e) { console.error('Fallo de envío: ' + e); return false; }
}

/** Crea el disparador de tiempo (cada 5 minutos). Ejecutar una sola vez desde el editor. */
function crearDisparador() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'verificarConfirmaciones') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('verificarConfirmaciones').timeBased().everyMinutes(5).create();
}

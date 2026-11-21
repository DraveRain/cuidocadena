/* Modo demostración: guarda los datos en localStorage y simula el verificador y el correo.
   Replica las seis entidades del modelo de datos (Cuidador, Paciente, Medicamento, Horario, Confirmacion, Alerta). */
(function () {
  'use strict';
  var L = CC.logica;
  var CLAVE = 'cuidocadena_demo_v1';

  function vacia() {
    return { cuidadores: [], pacientes: [], medicamentos: [], horarios: [], confirmaciones: [], alertas: [],
             correos: [], relojMin: 0, fallarCorreo: false };
  }
  function leer() {
    try { var r = localStorage.getItem(CLAVE); if (r) return JSON.parse(r); } catch (e) {}
    return vacia();
  }
  function guardar(db) { try { localStorage.setItem(CLAVE, JSON.stringify(db)); } catch (e) {} }

  function ahoraMs(db) { return Date.now() + db.relojMin * 60000; }
  function iso(ms) { var d = new Date(ms); return L.fechaISO(d) + 'T' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2); }

  function porToken(db, tipo, token) {
    var lista = tipo === 'c' ? db.cuidadores : db.pacientes;
    for (var i = 0; i < lista.length; i++) if (lista[i].token_acceso === token) return lista[i];
    return null;
  }
  function pacientesDe(db, cuidador) {
    return db.pacientes.filter(function (p) { return p.id_cuidador === cuidador.id_cuidador; });
  }
  function medsDe(db, idPaciente) { return db.medicamentos.filter(function (m) { return m.id_paciente === idPaciente; }); }
  function horsDe(db, meds) {
    var ids = {}; meds.forEach(function (m) { ids[m.id_medicamento] = 1; });
    return db.horarios.filter(function (h) { return ids[h.id_medicamento]; });
  }

  function tomasHoy(db, paciente) {
    var meds = medsDe(db, paciente.id_paciente), hors = horsDe(db, meds), ids = {};
    hors.forEach(function (h) { ids[h.id_horario] = 1; });
    var conf = db.confirmaciones.filter(function (c) { return ids[c.id_horario]; });
    var ahora = ahoraMs(db);
    return L.tomasDelDia(hors, meds, conf, L.fechaISO(new Date(ahora)), ahora);
  }

  /* ---- Verificador automático (CU04): equivale al disparador de tiempo de Apps Script ---- */
  function verificar(db) {
    var ahora = ahoraMs(db), hoy = L.fechaISO(new Date(ahora)), nuevas = 0, enviadas = 0;
    db.pacientes.forEach(function (p) {
      var cuid = db.cuidadores.filter(function (c) { return c.id_cuidador === p.id_cuidador; })[0];
      var meds = medsDe(db, p.id_paciente), hors = horsDe(db, meds), ids = {};
      hors.forEach(function (h) { ids[h.id_horario] = 1; });
      var conf = db.confirmaciones.filter(function (c) { return ids[c.id_horario]; });
      var alertas = db.alertas.filter(function (a) { return ids[a.id_horario]; });
      L.tomasQueRequierenAlerta(hors, meds, conf, alertas, hoy, ahora).forEach(function (t) {
        db.alertas.push({ id_alerta: L.uuid(), id_horario: t.id_horario, fecha_toma: hoy,
                          estado_envio: 'pendiente', intentos: 0, fecha_hora_envio: null });
        nuevas++;
      });
      // envío y reintentos
      db.alertas.forEach(function (a, i) {
        if (!ids[a.id_horario] || a.estado_envio !== 'pendiente') return;
        var h = hors.filter(function (x) { return x.id_horario === a.id_horario; })[0];
        var m = meds.filter(function (x) { return x.id_medicamento === h.id_medicamento; })[0];
        var exito = !db.fallarCorreo;
        db.alertas[i] = L.resultadoIntento(a, exito, iso(ahora));
        if (exito) {
          enviadas++;
          db.correos.unshift({
            para: cuid.correo, enviado: iso(ahora),
            asunto: 'CuidoCadena: ' + p.nombre + ' no confirmó su medicamento',
            cuerpo: p.nombre + ' no confirmó la toma de ' + m.nombre + ' (' + m.dosis + ') programada a las ' + h.hora_programada +
                    '. La ventana de ' + h.ventana_min + ' minutos ya terminó. Te recomendamos comunicarte con ella o con él.'
          });
        }
      });
    });
    return { nuevas: nuevas, enviadas: enviadas };
  }

  /* ---- Datos de ejemplo para la demostración ---- */
  function ejemplo(db) {
    var base = vacia();
    base.relojMin = 0;
    var ahora = Date.now();
    var hoy = L.fechaISO(new Date(ahora));
    var cuid = { id_cuidador: L.uuid(), nombre: 'Laura Martínez', correo: 'laura.martinez@ejemplo.com', telefono: '3001234567', token_acceso: L.uuid() };
    var pac = { id_paciente: L.uuid(), id_cuidador: cuid.id_cuidador, nombre: 'Rosa Elena Martínez', edad: 74, consentimiento: true,
                fecha_consentimiento: iso(ahora), token_acceso: L.uuid() };
    base.cuidadores.push(cuid); base.pacientes.push(pac);
    function hhmm(ms) { var d = new Date(ms); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
    // Una toma recién abierta (para confirmar en la demo), una de la mañana ya confirmada y una de la noche
    var defs = [
      { n: 'Losartán', d: '1 tableta de 50 mg', h: '08:00', v: 30 },
      { n: 'Metformina', d: '1 tableta de 850 mg', h: hhmm(ahora - 5 * 60000), v: 20 },
      { n: 'Atorvastatina', d: '1 tableta de 20 mg', h: '20:00', v: 60 }
    ];
    // Evita horarios duplicados en la misma hora
    if (defs[1].h === '08:00' || defs[1].h === '20:00') defs[1].h = hhmm(ahora - 6 * 60000);
    defs.forEach(function (x) {
      var m = { id_medicamento: L.uuid(), id_paciente: pac.id_paciente, nombre: x.n, dosis: x.d, activo: true };
      var h = { id_horario: L.uuid(), id_medicamento: m.id_medicamento, hora_programada: x.h, ventana_min: x.v, activo: true };
      base.medicamentos.push(m); base.horarios.push(h);
    });
    // Historial de los 3 días anteriores: todo confirmado salvo una toma omitida con su alerta enviada
    for (var dia = 3; dia >= 1; dia--) {
      var f = L.sumarDias(hoy, -dia);
      base.horarios.forEach(function (h, idx) {
        var omitida = (dia === 2 && idx === 2);
        if (omitida) {
          base.alertas.push({ id_alerta: L.uuid(), id_horario: h.id_horario, fecha_toma: f, estado_envio: 'enviada', intentos: 1,
                              fecha_hora_envio: f + 'T' + h.hora_programada + ':00' });
        } else {
          base.confirmaciones.push({ id_confirmacion: L.uuid(), id_horario: h.id_horario, fecha_toma: f,
                                     fecha_hora_registro: f + 'T' + h.hora_programada + ':00', confirmado_por: idx === 1 ? 'cuidador' : 'paciente' });
        }
      });
    }
    // La toma de las 08:00 de hoy, si ya pasó, queda confirmada
    var h0 = base.horarios[0];
    if (L.inicioToma(hoy, h0.hora_programada) < ahora) {
      base.confirmaciones.push({ id_confirmacion: L.uuid(), id_horario: h0.id_horario, fecha_toma: hoy,
                                 fecha_hora_registro: hoy + 'T' + h0.hora_programada + ':00', confirmado_por: 'paciente' });
    }
    return { db: base, tokenCuidador: cuid.token_acceso, tokenPaciente: pac.token_acceso };
  }

  /* ---- API (misma forma que el script de Apps Script) ---- */
  var api = {
    registrar: function (d) {
      var db = leer(), err = L.validarRegistro(d);
      if (Object.keys(err).length) return { ok: false, errores: err };
      var correo = String(d.cuidadorCorreo).trim().toLowerCase();
      var cuid = db.cuidadores.filter(function (c) { return c.correo === correo; })[0];
      if (!cuid) {
        cuid = { id_cuidador: L.uuid(), nombre: String(d.cuidadorNombre).trim(), correo: correo,
                 telefono: d.cuidadorTelefono || '', token_acceso: L.uuid() };
        db.cuidadores.push(cuid);
      }
      var pac = { id_paciente: L.uuid(), id_cuidador: cuid.id_cuidador, nombre: String(d.pacienteNombre).trim(),
                  edad: Number(d.pacienteEdad), consentimiento: true, fecha_consentimiento: iso(ahoraMs(db)), token_acceso: L.uuid() };
      db.pacientes.push(pac); guardar(db);
      return { ok: true, tokenCuidador: cuid.token_acceso, tokenPaciente: pac.token_acceso };
    },

    datosPanel: function (d) {
      var db = leer(), cuid = porToken(db, 'c', d.token);
      if (!cuid) return { ok: false, mensaje: 'Enlace no válido.' };
      verificar(db); guardar(db);
      var pacs = pacientesDe(db, cuid);
      if (!pacs.length) return { ok: false, mensaje: 'Este cuidador no tiene pacientes.' };
      var pac = pacs.filter(function (p) { return p.id_paciente === d.idPaciente; })[0] || pacs[0];
      var meds = medsDe(db, pac.id_paciente), hors = horsDe(db, meds), ids = {};
      hors.forEach(function (h) { ids[h.id_horario] = 1; });
      var ahora = ahoraMs(db);
      return {
        ok: true, ahoraMs: ahora,
        cuidador: { nombre: cuid.nombre, correo: cuid.correo },
        pacientes: pacs.map(function (p) { return { id_paciente: p.id_paciente, nombre: p.nombre, edad: p.edad }; }),
        paciente: { id_paciente: pac.id_paciente, nombre: pac.nombre, edad: pac.edad, token_paciente: pac.token_acceso },
        medicamentos: meds.map(function (m) {
          return { id_medicamento: m.id_medicamento, nombre: m.nombre, dosis: m.dosis, activo: m.activo,
                   horarios: hors.filter(function (h) { return h.id_medicamento === m.id_medicamento; }) };
        }),
        tomasHoy: tomasHoy(db, pac),
        alertas: db.alertas.filter(function (a) { return ids[a.id_horario]; })
      };
    },

    guardarMedicamento: function (d) {
      var db = leer(), cuid = porToken(db, 'c', d.token);
      if (!cuid) return { ok: false, mensaje: 'Enlace no válido.' };
      var pac = pacientesDe(db, cuid).filter(function (p) { return p.id_paciente === d.idPaciente; })[0];
      if (!pac) return { ok: false, mensaje: 'El paciente no existe.' };
      var err = L.validarMedicamento(d);
      if (Object.keys(err).length) return { ok: false, errores: err };
      var m = { id_medicamento: L.uuid(), id_paciente: pac.id_paciente, nombre: String(d.nombre).trim(), dosis: String(d.dosis).trim(), activo: true };
      var h = { id_horario: L.uuid(), id_medicamento: m.id_medicamento, hora_programada: d.hora, ventana_min: Number(d.ventana), activo: true };
      db.medicamentos.push(m); db.horarios.push(h); guardar(db);
      return { ok: true };
    },

    agregarHorario: function (d) {
      var db = leer(), cuid = porToken(db, 'c', d.token);
      if (!cuid) return { ok: false, mensaje: 'Enlace no válido.' };
      var m = db.medicamentos.filter(function (x) { return x.id_medicamento === d.idMedicamento; })[0];
      if (!m) return { ok: false, mensaje: 'El medicamento no existe.' };
      var err = {};
      if (!L.validarHora(d.hora)) err.hora = 'Escribe la hora con formato 24 horas, por ejemplo 08:00.';
      if (!L.validarVentana(d.ventana)) err.ventana = 'La ventana debe estar entre 5 y 240 minutos.';
      if (Object.keys(err).length) return { ok: false, errores: err };
      db.horarios.push({ id_horario: L.uuid(), id_medicamento: m.id_medicamento, hora_programada: d.hora, ventana_min: Number(d.ventana), activo: true });
      guardar(db); return { ok: true };
    },

    cambiarActivo: function (d) {          // desactiva o reactiva un medicamento o un horario sin borrar el historial (RF10)
      var db = leer(), cuid = porToken(db, 'c', d.token);
      if (!cuid) return { ok: false, mensaje: 'Enlace no válido.' };
      var lista = d.tipo === 'horario' ? db.horarios : db.medicamentos;
      var clave = d.tipo === 'horario' ? 'id_horario' : 'id_medicamento';
      var it = lista.filter(function (x) { return x[clave] === d.id; })[0];
      if (!it) return { ok: false, mensaje: 'No se encontró el registro.' };
      it.activo = !!d.activo; guardar(db); return { ok: true };
    },

    vistaPaciente: function (d) {
      var db = leer(), pac = porToken(db, 'p', d.token);
      if (!pac) return { ok: false, mensaje: 'Enlace no válido.' };
      verificar(db); guardar(db);
      var tomas = tomasHoy(db, pac);
      return { ok: true, ahoraMs: ahoraMs(db), paciente: { nombre: pac.nombre }, tomasHoy: tomas, proxima: L.proximaToma(tomas) };
    },

    confirmar: function (d) {              // CU03: la confirma el paciente (su enlace) o el cuidador (el suyo)
      var db = leer(), quien, pac;
      if (d.quien === 'cuidador') {
        var cuid = porToken(db, 'c', d.token);
        if (!cuid) return { ok: false, mensaje: 'Enlace no válido.' };
        quien = 'cuidador';
      } else {
        pac = porToken(db, 'p', d.token);
        if (!pac) return { ok: false, mensaje: 'Enlace no válido.' };
        quien = 'paciente';
      }
      var h = db.horarios.filter(function (x) { return x.id_horario === d.idHorario; })[0];
      if (!h) return { ok: false, mensaje: 'La toma no existe.' };
      var m = db.medicamentos.filter(function (x) { return x.id_medicamento === h.id_medicamento; })[0];
      if (pac && m.id_paciente !== pac.id_paciente) return { ok: false, mensaje: 'La toma no pertenece a este paciente.' };
      if (quien === 'cuidador') {
        var p2 = db.pacientes.filter(function (p) { return p.id_paciente === m.id_paciente; })[0];
        var dueno = db.cuidadores.filter(function (c) { return c.id_cuidador === p2.id_cuidador; })[0];
        if (dueno.token_acceso !== d.token) return { ok: false, mensaje: 'La toma no pertenece a un paciente de este cuidador.' };
      }
      var ahora = ahoraMs(db), hoy = L.fechaISO(new Date(ahora));
      var previa = L.hayConfirmacion(db.confirmaciones, h.id_horario, hoy);
      var r = L.puedeConfirmar(h, hoy, ahora, previa);
      if (!r.ok) return r;
      db.confirmaciones.push({ id_confirmacion: L.uuid(), id_horario: h.id_horario, fecha_toma: hoy,
                               fecha_hora_registro: iso(ahora), confirmado_por: quien });
      guardar(db);
      return { ok: true };
    },

    historial: function (d) {               // CU05: confirmaciones y alertas por rango de fechas
      var db = leer(), cuid = porToken(db, 'c', d.token);
      if (!cuid) return { ok: false, mensaje: 'Enlace no válido.' };
      var pac = pacientesDe(db, cuid).filter(function (p) { return p.id_paciente === d.idPaciente; })[0];
      if (!pac) return { ok: false, mensaje: 'El paciente no existe.' };
      var meds = medsDe(db, pac.id_paciente), hors = horsDe(db, meds), mapaH = {}, mapaM = {};
      hors.forEach(function (h) { mapaH[h.id_horario] = h; });
      meds.forEach(function (m) { mapaM[m.id_medicamento] = m; });
      var filas = [];
      db.confirmaciones.forEach(function (c) {
        var h = mapaH[c.id_horario]; if (!h) return;
        filas.push({ fecha: c.fecha_toma, hora: h.hora_programada, medicamento: mapaM[h.id_medicamento].nombre,
                     dosis: mapaM[h.id_medicamento].dosis, estado: 'confirmada', detalle: 'Confirmada por ' + c.confirmado_por });
      });
      db.alertas.forEach(function (a) {
        var h = mapaH[a.id_horario]; if (!h) return;
        filas.push({ fecha: a.fecha_toma, hora: h.hora_programada, medicamento: mapaM[h.id_medicamento].nombre,
                     dosis: mapaM[h.id_medicamento].dosis, estado: 'omitida',
                     detalle: 'Alerta ' + a.estado_envio + ', intentos: ' + a.intentos });
      });
      filas = filas.filter(function (f) { return (!d.desde || f.fecha >= d.desde) && (!d.hasta || f.fecha <= d.hasta); });
      filas.sort(function (a, b) { return a.fecha === b.fecha ? (a.hora < b.hora ? 1 : -1) : (a.fecha < b.fecha ? 1 : -1); });
      return { ok: true, filas: filas };
    },

    /* ---- herramientas solo del modo demostración ---- */
    demo: {
      cargarEjemplo: function () { var e = ejemplo(); guardar(e.db); return { tokenCuidador: e.tokenCuidador, tokenPaciente: e.tokenPaciente }; },
      reiniciar: function () { guardar(vacia()); },
      adelantarReloj: function (min) { var db = leer(); db.relojMin += min; verificar(db); guardar(db); return db.relojMin; },
      ejecutarVerificacion: function () { var db = leer(); var r = verificar(db); guardar(db); return r; },
      relojMin: function () { return leer().relojMin; },
      ahoraMs: function () { return ahoraMs(leer()); },
      correos: function () { return leer().correos; },
      fallarCorreo: function (v) { var db = leer(); if (v !== undefined) { db.fallarCorreo = !!v; guardar(db); } return db.fallarCorreo; },
      hayDatos: function () { return leer().pacientes.length > 0; }
    }
  };

  CC.demoApi = api;
})();

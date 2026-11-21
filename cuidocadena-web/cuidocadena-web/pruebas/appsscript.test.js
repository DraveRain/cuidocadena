/* Prueba de Codigo.gs con un simulador de los servicios de Google (SpreadsheetApp, LockService, MailApp...).
   No reemplaza la prueba en Google real: comprueba la lógica y el flujo de datos del script. Ejecutar: node pruebas/appsscript.test.js */
process.env.TZ = 'America/Bogota';
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..', 'apps-script');

let offsetMs = 0;
const RealDate = Date;
class FDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(RealDate.now() + offsetMs); else super(...a); }
  static now() { return RealDate.now() + offsetMs; }
}
const libro = {};   // nombre -> filas (incluye encabezado)
const hoja = (n) => ({
  getLastRow: () => libro[n].length, getMaxRows: () => 1000,
  getRange: (r, c, nr, nc) => ({
    setValues: (v) => { v.forEach((f, i) => { libro[n][r - 1 + i] = f.slice(); }); return { setFontWeight() {} }; },
    getValues: () => { const o = []; for (let i = 0; i < nr; i++) o.push((libro[n][r - 1 + i] || []).slice(0, nc)); return o; },
    setNumberFormat() {}, setFontWeight() {}
  }),
  setFrozenRows() {}
});
const correos = []; let fallarMail = false; const disparadores = [];
const ctx = {
  console, JSON, Math, Object, Array, String, Number, Date: FDate, Proxy,
  SpreadsheetApp: { getActiveSpreadsheet: () => ({
    getSheetByName: (n) => (libro[n] ? hoja(n) : null),
    insertSheet: (n) => { libro[n] = []; return hoja(n); } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  MailApp: { sendEmail: (m) => { if (fallarMail) throw new Error('cuota'); correos.push(m); } },
  Utilities: { getUuid: () => require('crypto').randomUUID(),
    formatDate: (d, tz, f) => { const p = (x) => String(x).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; } },
  Session: { getScriptTimeZone: () => 'America/Bogota' },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ t, setMimeType() { return this; }, getContent() { return this.t; } }) },
  ScriptApp: { getProjectTriggers: () => disparadores.slice(), deleteTrigger() {},
    newTrigger: (f) => ({ timeBased: () => ({ everyMinutes: (m) => ({ create: () => disparadores.push({ f, m }) }) }) }) }
};
vm.createContext(ctx);
// Logica.gs se carga DESPUÉS de Codigo.gs a propósito: así se prueba que el orden no importa
vm.runInContext(fs.readFileSync(path.join(dir, 'Codigo.gs'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'Logica.gs'), 'utf8'), ctx);

const post = (o) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(o) } }).getContent());
let ok = 0, fail = 0;
const t = (id, nombre, cond) => { if (cond) { ok++; console.log('OK   ' + id + ' ' + nombre); } else { fail++; console.log('FALLA ' + id + ' ' + nombre); } };
const hhmm = (ms) => { const d = new RealDate(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

ctx.configurarHojas();
t('G01', 'configurarHojas crea 6 hojas con encabezados', Object.keys(libro).length === 6 && libro.Alerta[0].includes('estado_envio'));

let r = post({ accion: 'registrar', cuidadorNombre: 'Laura Martínez', cuidadorCorreo: 'laura@correo.com', cuidadorTelefono: '3001234567', pacienteNombre: 'Rosa Elena', pacienteEdad: 74, consentimiento: true });
t('G02', 'registrar devuelve los dos enlaces', r.ok && r.tokenCuidador && r.tokenPaciente);
const tc = r.tokenCuidador, tp = r.tokenPaciente;
t('G03', 'registrar rechaza edad inválida', !post({ accion: 'registrar', cuidadorNombre: 'A B', cuidadorCorreo: 'a@b.co', pacienteNombre: 'X Y', pacienteEdad: 30, consentimiento: true }).ok);
t('G04', 'acción desconocida se rechaza', post({ accion: 'borrarTodo' }).ok === false);
t('G05', 'token inválido se rechaza', post({ accion: 'datosPanel', token: 'falso' }).ok === false);

let p = post({ accion: 'datosPanel', token: tc });
const idPac = p.paciente.id_paciente;
const hace = hhmm(Date.now() - 20 * 60000);                      // hora ya vencida: ventana de 5 min
r = post({ accion: 'guardarMedicamento', token: tc, idPaciente: idPac, nombre: 'Losartán', dosis: '50 mg', hora: hace, ventana: 5 });
t('G06', 'guardarMedicamento crea medicamento y horario', r.ok && libro.Medicamento.length === 2 && libro.Horario.length === 2);
t('G07', 'la hora se guarda como texto HH:mm', libro.Horario[1][2] === hace);
r = post({ accion: 'guardarMedicamento', token: tc, idPaciente: idPac, nombre: '', dosis: '', hora: '25:00', ventana: 1 });
t('G08', 'guardarMedicamento valida campos', !r.ok && r.errores);

p = post({ accion: 'datosPanel', token: tc });
t('G09', 'la toma vencida aparece como omitida', p.tomasHoy[0].estado === 'omitida');
let v = ctx.verificarConfirmaciones();
t('G10', 'verificador crea y envía 1 alerta', v.nuevas === 1 && v.enviadas === 1 && correos.length === 1 && correos[0].to === 'laura@correo.com');
v = ctx.verificarConfirmaciones();
t('G11', 'no duplica la alerta en la siguiente ejecución', v.nuevas === 0 && correos.length === 1);

// horario creado hace más de 60 min de vencido: no debe alertar (margen)
const vieja = hhmm(Date.now() - 180 * 60000);
post({ accion: 'guardarMedicamento', token: tc, idPaciente: idPac, nombre: 'Vieja', dosis: '1', hora: vieja, ventana: 5 });
v = ctx.verificarConfirmaciones();
t('G12', 'margen de 60 min: no alerta por una toma muy vieja', v.nuevas === 0);

// confirmación por paciente dentro de ventana
const prox = hhmm(Date.now() + 1 * 60000);
post({ accion: 'guardarMedicamento', token: tc, idPaciente: idPac, nombre: 'Metformina', dosis: '850 mg', hora: prox, ventana: 30 });
offsetMs = 2 * 60000;                                           // ya es la hora
const vp = post({ accion: 'vistaPaciente', token: tp });
const toma = vp.tomasHoy.find((x) => x.medicamento === 'Metformina');
t('G13', 'la vista del paciente muestra la toma por confirmar', vp.ok && toma && toma.estado === 'pendiente');
r = post({ accion: 'confirmar', token: tp, idHorario: toma.id_horario, quien: 'paciente' });
t('G14', 'el paciente confirma', r.ok && libro.Confirmacion.length === 2);
r = post({ accion: 'confirmar', token: tp, idHorario: toma.id_horario, quien: 'paciente' });
t('G15', 'no permite confirmar dos veces', !r.ok);
r = post({ accion: 'confirmar', token: 'falso', idHorario: toma.id_horario, quien: 'paciente' });
t('G16', 'confirmar con enlace falso se rechaza', !r.ok);
const h = post({ accion: 'historial', token: tc, idPaciente: idPac });
t('G17', 'historial trae confirmadas y omitidas', h.ok && h.filas.some((f) => f.estado === 'confirmada') && h.filas.some((f) => f.estado === 'omitida'));

// reintentos: 3 y queda fallida
post({ accion: 'guardarMedicamento', token: tc, idPaciente: idPac, nombre: 'Fallo', dosis: '1', hora: hhmm(Date.now() - 15 * 60000), ventana: 5 });
fallarMail = true;
const n0 = correos.length;
ctx.verificarConfirmaciones(); ctx.verificarConfirmaciones(); v = ctx.verificarConfirmaciones();
const al = libro.Alerta.slice(1).find((f) => f[4] === '3');
t('G18', 'tras 3 intentos fallidos la alerta queda fallida', al && al[3] === 'fallida' && correos.length === n0 && v.fallidas === 1);
v = ctx.verificarConfirmaciones();
t('G19', 'una alerta fallida no se reintenta más', libro.Alerta.slice(1).find((f) => f[3] === 'fallida')[4] === '3');
fallarMail = false;

const m = post({ accion: 'datosPanel', token: tc }).medicamentos.find((x) => x.nombre === 'Losartán');
r = post({ accion: 'cambiarActivo', token: tc, tipo: 'medicamento', id: m.id_medicamento, activo: false });
t('G20', 'cambiarActivo desactiva sin borrar', r.ok && post({ accion: 'datosPanel', token: tc }).medicamentos.find((x) => x.nombre === 'Losartán').activo === false);
t('G21', 'crearDisparador crea uno cada 5 minutos', (ctx.crearDisparador(), disparadores.length === 1 && disparadores[0].m === 5));

// otro cuidador no ve datos ajenos
const otro = post({ accion: 'registrar', cuidadorNombre: 'Otro Cuidador', cuidadorCorreo: 'otro@correo.com', pacienteNombre: 'Pedro Gómez', pacienteEdad: 80, consentimiento: true });
t('G22', 'un cuidador no accede al paciente de otro', !post({ accion: 'historial', token: otro.tokenCuidador, idPaciente: idPac }).ok);

console.log(`\n${ok} de ${ok + fail} pruebas aprobadas`);
process.exit(fail ? 1 : 0);

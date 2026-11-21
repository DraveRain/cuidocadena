// Pruebas unitarias de js/logica.js. Ejecutar con: node pruebas/logica.test.js
const assert = require('assert');
const L = require('../js/logica.js');

const resultados = [];
function caso(id, descripcion, fn) {
  try { fn(); resultados.push([id, descripcion, 'Aprobada']); }
  catch (e) { resultados.push([id, descripcion, 'FALLÓ: ' + e.message]); }
}

const hor = { id_horario: 'h1', id_medicamento: 'm1', hora_programada: '08:00', ventana_min: 30, activo: true };
const F = '2026-11-20';
const t = (hhmm) => L.inicioToma(F, hhmm);

caso('U01', 'Antes de la hora la toma está programada', () =>
  assert.strictEqual(L.estadoToma(hor, F, t('07:59'), null), 'programada'));
caso('U02', 'A la hora exacta la toma está pendiente', () =>
  assert.strictEqual(L.estadoToma(hor, F, t('08:00'), null), 'pendiente'));
caso('U03', 'Dentro de la ventana sin confirmar sigue pendiente', () =>
  assert.strictEqual(L.estadoToma(hor, F, t('08:29'), null), 'pendiente'));
caso('U04', 'Al terminar la ventana sin confirmar queda omitida', () =>
  assert.strictEqual(L.estadoToma(hor, F, t('08:30'), null), 'omitida'));
caso('U05', 'Con confirmación la toma queda confirmada aunque pase la ventana', () =>
  assert.strictEqual(L.estadoToma(hor, F, t('10:00'), { id_horario: 'h1' }), 'confirmada'));
caso('U06', 'No se puede confirmar antes de la hora', () =>
  assert.strictEqual(L.puedeConfirmar(hor, F, t('07:00'), null).ok, false));
caso('U07', 'Se puede confirmar dentro de la ventana', () =>
  assert.strictEqual(L.puedeConfirmar(hor, F, t('08:10'), null).ok, true));
caso('U08', 'No se acepta una segunda confirmación de la misma toma', () => {
  const r = L.puedeConfirmar(hor, F, t('08:10'), { id_horario: 'h1' });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.mensaje, 'La toma ya estaba confirmada.');
});
caso('U09', 'No se puede confirmar después de la ventana', () =>
  assert.strictEqual(L.puedeConfirmar(hor, F, t('09:00'), null).ok, false));
caso('U10', 'Hora válida en formato HH:MM de 24 horas', () => {
  assert.ok(L.validarHora('08:00')); assert.ok(L.validarHora('23:59'));
  assert.ok(!L.validarHora('24:00')); assert.ok(!L.validarHora('8:00')); assert.ok(!L.validarHora('08:60'));
});
caso('U11', 'La ventana debe estar entre 5 y 240 minutos', () => {
  assert.ok(L.validarVentana(5)); assert.ok(L.validarVentana(240)); assert.ok(L.validarVentana('30'));
  assert.ok(!L.validarVentana(4)); assert.ok(!L.validarVentana(241)); assert.ok(!L.validarVentana(10.5));
});
caso('U12', 'Validación de correo', () => {
  assert.ok(L.validarCorreo('laura@correo.com'));
  assert.ok(!L.validarCorreo('laura@')); assert.ok(!L.validarCorreo('laura correo.com'));
});
caso('U13', 'La edad debe estar entre 60 y 120', () => {
  assert.ok(L.validarEdad(60)); assert.ok(L.validarEdad(120));
  assert.ok(!L.validarEdad(59)); assert.ok(!L.validarEdad(121)); assert.ok(!L.validarEdad('abc'));
});
caso('U14', 'No se registra un paciente sin autorización de datos', () => {
  const e = L.validarRegistro({ cuidadorNombre: 'Laura', cuidadorCorreo: 'l@c.co', pacienteNombre: 'Rosa', pacienteEdad: 74, consentimiento: false });
  assert.ok(e.consentimiento);
});
caso('U15', 'Un registro completo y válido no tiene errores', () => {
  const e = L.validarRegistro({ cuidadorNombre: 'Laura', cuidadorCorreo: 'l@c.co', cuidadorTelefono: '3001234567', pacienteNombre: 'Rosa', pacienteEdad: 74, consentimiento: true });
  assert.deepStrictEqual(e, {});
});
caso('U16', 'Se detectan las tomas omitidas sin alerta', () => {
  const meds = [{ id_medicamento: 'm1', nombre: 'Losartán', dosis: '50 mg', activo: true }];
  const r = L.tomasQueRequierenAlerta([hor], meds, [], [], F, t('09:00'));
  assert.strictEqual(r.length, 1);
});
caso('U17', 'No se duplica la alerta de una toma ya alertada', () => {
  const meds = [{ id_medicamento: 'm1', nombre: 'Losartán', dosis: '50 mg', activo: true }];
  const r = L.tomasQueRequierenAlerta([hor], meds, [], [{ id_horario: 'h1', fecha_toma: F }], F, t('09:00'));
  assert.strictEqual(r.length, 0);
});
caso('U18', 'No genera alerta si la toma fue confirmada', () => {
  const meds = [{ id_medicamento: 'm1', nombre: 'Losartán', dosis: '50 mg', activo: true }];
  const r = L.tomasQueRequierenAlerta([hor], meds, [{ id_horario: 'h1', fecha_toma: F }], [], F, t('09:00'));
  assert.strictEqual(r.length, 0);
});
caso('U24', 'No se alerta una toma cuya ventana terminó hace más de 60 minutos', () => {
  const meds = [{ id_medicamento: 'm1', nombre: 'Losartán', dosis: '50 mg', activo: true }];
  assert.strictEqual(L.tomasQueRequierenAlerta([hor], meds, [], [], F, t('10:00')).length, 0);
  assert.strictEqual(L.tomasQueRequierenAlerta([hor], meds, [], [], F, t('09:30')).length, 1);
});
caso('U19', 'Un medicamento o un horario inactivo no genera tomas', () => {
  const meds = [{ id_medicamento: 'm1', nombre: 'X', dosis: 'y', activo: false }];
  assert.strictEqual(L.tomasDelDia([hor], meds, [], F, t('09:00')).length, 0);
  const meds2 = [{ id_medicamento: 'm1', nombre: 'X', dosis: 'y', activo: true }];
  assert.strictEqual(L.tomasDelDia([Object.assign({}, hor, { activo: false })], meds2, [], F, t('09:00')).length, 0);
});
caso('U20', 'Reintentos de envío: pendiente, pendiente y fallida al tercer intento', () => {
  let a = { intentos: 0, estado_envio: 'pendiente' };
  a = L.resultadoIntento(a, false, 'x'); assert.strictEqual(a.estado_envio, 'pendiente');
  a = L.resultadoIntento(a, false, 'x'); assert.strictEqual(a.estado_envio, 'pendiente');
  a = L.resultadoIntento(a, false, 'x'); assert.strictEqual(a.estado_envio, 'fallida'); assert.strictEqual(a.intentos, 3);
});
caso('U21', 'Un envío exitoso marca la alerta como enviada', () => {
  const a = L.resultadoIntento({ intentos: 1, estado_envio: 'pendiente' }, true, '2026-11-20T09:00:00');
  assert.strictEqual(a.estado_envio, 'enviada'); assert.strictEqual(a.intentos, 2);
});
caso('U22', 'La próxima toma es la pendiente o, si no hay, la programada más cercana', () => {
  const tomas = [{ estado: 'confirmada', hora: '08:00' }, { estado: 'programada', hora: '20:00' }, { estado: 'programada', hora: '13:00' }];
  tomas.sort((a, b) => a.hora < b.hora ? -1 : 1);
  assert.strictEqual(L.proximaToma(tomas).hora, '13:00');
});
caso('U23', 'Los identificadores UUID no se repiten', () => {
  const s = new Set(); for (let i = 0; i < 2000; i++) s.add(L.uuid());
  assert.strictEqual(s.size, 2000);
});

const fallos = resultados.filter(r => !r[2].startsWith('Aprobada'));
resultados.forEach(r => console.log(r[0] + '\t' + r[2] + '\t' + r[1]));
console.log('\n' + (resultados.length - fallos.length) + ' de ' + resultados.length + ' pruebas aprobadas');
process.exit(fallos.length ? 1 : 0);

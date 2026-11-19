'use strict';
// Base de demostración separada (backend/data/demo.sqlite). Nunca escribe en la base real.
// Uso: npm run demo:reset  → crea la base con los casos de la defensa.
//      npm run start:demo  → inicia el servidor sobre esa base.
// La demostración no se conecta a GitHub: las referencias quedan sin verificar y no se crean issues.
const fs = require('node:fs');
const path = require('node:path');
const { openDatabase, transaction } = require('./database.cjs');
const { seedUsers } = require('./auth.cjs');
const S = require('./service.cjs');

const DEMO = path.join(__dirname, 'data', 'demo.sqlite');
function buildDemo(db) {
  const u = id => db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(id);
  const david = u('team-david'), leslie = u('team-leslie'), edwin = u('team-edwin'), pablo = u('team-pablo'), shirley = u('team-shirley');
  const tx = fn => transaction(db, fn);
  const act = (id, action, user, data = {}) => tx(() => S.mutate(db, id, action, user, { ...data, revision: S.snapshot(db, david).requests.find(r => r.id === id)?.revision ?? 0 }));

  const plan = (extra = {}) => ({
    itilType: 'Normal', classificationJustification: 'Cambio funcional que requiere evaluación de riesgos y planificación ordinaria.', plannedChanges: 'Modificar el flujo de reservas, el esquema de boletos y los casos de prueba.',
    affectedModules: [{ module: 'Reservas y pasajeros', operation: 'Modificación' }, { module: 'Boletos QR e historial', operation: 'Modificación' }],
    impact: 'Alto', technicalImpact: 'Afecta reservas, el esquema de boletos y la liberación de asientos.', functionalImpact: 'Cambia la experiencia de compra y las políticas de las cooperativas.',
    risks: ['Liberación incorrecta de asientos', 'Reembolsos duplicados'], urgency: 'Media', priority: 'Alta', feasibility: 'Viable', feasibilityJustification: 'El equipo conoce el módulo y existen pruebas base.',
    effortHours: 24, durationDays: 5, resources: 'Un desarrollador y entorno de pruebas.', considerations: '',
    rolloutObjective: 'Incorporar la cancelación sin afectar las ventas activas.', rolloutSteps: ['Crear rama de trabajo', 'Migrar el esquema en pruebas', 'Implementar la cancelación', 'Ejecutar pruebas', 'Publicar la versión'],
    rolloutDependencies: 'Migración del esquema antes del código.', rolloutResponsibles: 'Desarrollador asignado.', rolloutChecks: 'Compra y cancelación en el entorno de pruebas.', rolloutCompletion: 'Criterios de aceptación verificados.',
    backoutTriggers: 'Errores al liberar asientos o fallos de la migración.', backoutActions: ['Revertir el merge', 'Restaurar el respaldo del esquema'], backoutVersion: 'Versión 1.2.0', backoutData: 'Respaldar las reservas antes de migrar.', backoutResponsible: 'Desarrollador asignado', backoutVerification: 'Comprobar compra normal después de revertir.',
    testObjective: 'Verificar la cancelación y la liberación de asientos.', testTypes: 'Funcionales y de regresión.', testCriteria: ['El boleto se cancela antes de la salida', 'El asiento queda disponible'], testSuccess: 'Todas las pruebas superadas.', testEvidence: 'Capturas y registro de pruebas.',
    downtimeValue: 0, downtimeUnit: 'minutos', plannedDate: '2026-12-01T22:00', targetVersion: '1.3.0', ...extra
  });
  const base = { modules: ['Reservas y pasajeros', 'Boletos QR e historial'], currentBehavior: 'Una vez comprado, el boleto no puede cancelarse desde la aplicación.', featureMissing: true, result: 'Poder cancelar un boleto y liberar el asiento.' };
  const toApproval = (id, extra) => { act(id, 'receive', david); act(id, 'validate', david); act(id, 'evaluation', david, { ...plan(extra), step: 'planning' }); };

  // Ejemplo 1: cancelación de boletos, de principio a fin.
  const e1 = tx(() => S.createRequest(db, null, { requesterType: 'usuario', name: 'María Usuaria (demostración)', email: 'maria.demo@example.com', title: 'Permitir la cancelación de boletos', description: 'Quiero poder cancelar un boleto comprado cuando no pueda viajar.', justification: 'Hoy debo acudir a la oficina de la cooperativa para cancelar.', ...base })).request.id;
  toApproval(e1);
  act(e1, 'decision', david, { decision: 'Aprobado con condiciones', justification: 'Beneficio alto y riesgo controlado con el plan de backout.', conditions: [{ text: 'Respaldar la base antes de migrar', verification: 'Evidencia del respaldo adjunta en la revisión.' }] });
  act(e1, 'assign', david, { developerId: edwin.id, targetDate: '2026-12-05', notes: 'Seguir el rollout aprobado.' });
  act(e1, 'start', edwin, { conditionsAcknowledged: true });
  act(e1, 'activity', edwin, { description: 'Migración del esquema y lógica de cancelación', hours: 10, status: 'Completada' });
  act(e1, 'git', edwin, { kind: 'Rama', value: 'feature/cancelacion-boletos' });
  act(e1, 'git', edwin, { kind: 'Pull request', value: '#42', url: 'https://github.com/ejemplo/busesuta/pull/42', note: 'Enlace registrado manualmente.' });
  act(e1, 'module-change', edwin, { module: 'Reservas y pasajeros', operation: 'Modificación', description: 'Nuevo caso de uso de cancelación.' });
  act(e1, 'module-change', edwin, { module: 'Boletos QR e historial', operation: 'Modificación', description: 'Estado «cancelado» en el historial de boletos.' });
  act(e1, 'send-to-tests', edwin);
  act(e1, 'test', pablo, { name: 'Cancelar antes de la salida', expected: 'El boleto queda cancelado', obtained: 'Cancelado correctamente', status: 'Superada', criterion: 'El boleto se cancela antes de la salida' });
  act(e1, 'test', pablo, { name: 'Liberación del asiento', expected: 'Asiento disponible', obtained: 'Disponible en la búsqueda', status: 'Superada', criterion: 'El asiento queda disponible' });
  act(e1, 'finish-tests', pablo, { outcome: 'Todas superadas' });
  act(e1, 'review', pablo, { summary: 'Implementación conforme al rollout aprobado.', rolloutCompliance: 'Cumplido', criteria: S.requestDetail(db, e1, pablo).reviewCriteria.map(() => ({ met: true })), conditions: [{ id: 'C1', met: true, evidence: 'Respaldo del 2026-11-20 adjunto.' }], recommendation: 'Cerrar como exitoso.', decision: 'Conforme' });
  act(e1, 'close', edwin, { result: 'Exitoso', summary: 'Cancelación de boletos disponible en la versión 1.3.0.', resultingVersion: '1.3.0' });

  // Ejemplo 2: técnicamente viable, pero rechazado por riesgo y prioridad.
  const e2 = tx(() => S.createRequest(db, leslie, { requesterType: 'experto', modules: ['Pagos y comprobantes'], title: 'Reemplazar la pasarela de pagos', currentBehavior: 'La pasarela actual funciona con comisiones altas.', description: 'Migrar todos los pagos a un proveedor nuevo con otra API.', justification: 'Reducir comisiones a mediano plazo para las cooperativas.', result: 'Pagos procesados por el nuevo proveedor.', modificationType: 'Modificación', environment: 'Producción', currentVersion: 'No determinada', acceptanceCriteria: ['Los pagos se aprueban con el nuevo proveedor'], components: 'Servicio de pagos, conciliación' })).request.id;
  act(e2, 'receive', david); act(e2, 'validate', david);
  act(e2, 'evaluation', david, { ...plan({ affectedModules: [{ module: 'Pagos y comprobantes', operation: 'Modificación' }], risks: ['Interrupción de ventas', 'Conciliación contable'], effortHours: 160, durationDays: 30 }), step: 'analysis' });
  act(e2, 'decision', david, { decision: 'Rechazado', justification: 'Es viable, pero el riesgo de interrumpir ventas y el esfuerzo superan el beneficio en este semestre.' });
  act(e2, 'close-rejected', david, { justification: 'Rechazo comunicado al solicitante.' });

  // Ejemplo 3: pruebas fallidas, correcciones y nueva ronda.
  const e3 = tx(() => S.createRequest(db, shirley, { requesterType: 'experto', modules: ['Buses y plantillas de asientos'], title: 'Marcar asientos preferenciales', currentBehavior: 'Todos los asientos se muestran iguales.', description: 'Distinguir visualmente los asientos preferenciales en el selector.', justification: 'Facilitar la compra a personas con discapacidad y adultos mayores.', result: 'Asientos preferenciales identificados.', modificationType: 'Modificación', environment: 'Pruebas', currentVersion: '2.0.1', targetVersion: '2.1.0', acceptanceCriteria: ['Los asientos preferenciales tienen un icono distinto'] })).request.id;
  toApproval(e3, { affectedModules: [{ module: 'Buses y plantillas de asientos', operation: 'Modificación' }], impact: 'Bajo', priority: 'Media', targetVersion: '2.1.0', testCriteria: ['Los asientos preferenciales tienen un icono distinto'] });
  act(e3, 'decision', david, { decision: 'Aprobado', justification: 'Cambio acotado con beneficio de accesibilidad.' });
  act(e3, 'assign', david, { developerId: shirley.id });
  act(e3, 'start', shirley);
  act(e3, 'activity', shirley, { description: 'Nuevo icono y leyenda', hours: 4 });
  act(e3, 'module-change', shirley, { module: 'Buses y plantillas de asientos', operation: 'Modificación', description: 'Icono de asiento preferencial.' });
  act(e3, 'send-to-tests', shirley);
  act(e3, 'test', leslie, { name: 'Icono preferencial visible', expected: 'Icono distinto', obtained: 'El icono no aparece en móviles', status: 'Fallida' });
  act(e3, 'finish-tests', leslie, { outcome: 'Existen fallos', incident: 'El icono no se muestra en pantallas pequeñas.' });
  act(e3, 'start', shirley, { note: 'Corrección para pantallas pequeñas.' });
  act(e3, 'activity', shirley, { description: 'Ajuste de estilos responsivos', hours: 2 });
  act(e3, 'send-to-tests', shirley);
  act(e3, 'test', leslie, { name: 'Icono preferencial visible', expected: 'Icono distinto', obtained: 'Visible en todos los tamaños', status: 'Superada' });
  act(e3, 'finish-tests', leslie, { outcome: 'Todas superadas' });
  act(e3, 'review', leslie, { summary: 'Corrección aplicada en la segunda ronda.', rolloutCompliance: 'Cumplido', criteria: S.requestDetail(db, e3, leslie).reviewCriteria.map(() => ({ met: true })), recommendation: 'Cerrar como exitoso.', decision: 'Conforme' });
  act(e3, 'close', shirley, { result: 'Exitoso', summary: 'Asientos preferenciales disponibles tras una corrección.', resultingVersion: '2.1.0' });

  // Una solicitud nueva queda pendiente para mostrar la recepción en vivo.
  const e4 = tx(() => S.createRequest(db, pablo, { requesterType: 'experto', modules: ['Notificaciones'], title: 'Recordatorio antes del viaje', currentBehavior: 'No se envían recordatorios.', featureMissing: true, description: 'Enviar una notificación un día antes del viaje.', justification: 'Reducir los pasajeros que olvidan su viaje.', result: 'Recordatorio recibido.', modificationType: 'Adición', environment: 'Desarrollo', currentVersion: 'No determinada', acceptanceCriteria: ['Se envía una notificación 24 horas antes'], components: 'Servicio de notificaciones' })).request.id;
  return { e1, e2, e3, e4 };
}
if (require.main === module) {
  // Solo se reinicia el archivo fijo de demostración, nunca DB_PATH ni la base real.
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(DEMO + suffix, { force: true });
  fs.rmSync(path.join(path.dirname(DEMO), 'demo-uploads'), { recursive: true, force: true });
  const db = openDatabase(DEMO);
  try {
    seedUsers(db, process.env.SEED_PASSWORD);
    const result = buildDemo(db);
    console.log(`Base de demostración creada en ${DEMO}:`, result);
  } finally { db.close(); }
}
module.exports = { buildDemo, DEMO };

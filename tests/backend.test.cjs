'use strict';
// Integración HTTP con servidores efímeros y bases temporales (nunca la base real).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const http = require('node:http');
const { createApp } = require('../backend/server.cjs');
const { createGithub } = require('../backend/github.cjs');
const { openDatabase } = require('../backend/database.cjs');
const { configureTeam } = require('../backend/configure-team.cjs');
const { hashPassword } = require('../backend/auth.cjs');

const PASSWORD = 'Test-ChangeFlow-2026!';
const USERS = [['team-leslie', 'Leslie', 'leslie@uta.edu.ec', 'experto'], ['team-david', 'David', 'david@uta.edu.ec', 'ccc'], ['team-edwin', 'Edwin', 'edwin@uta.edu.ec', 'experto'], ['team-pablo', 'Pablo', 'pablo@uta.edu.ec', 'experto'], ['team-shirley', 'Shirley', 'shirley@uta.edu.ec', 'experto'], ['user-ana', 'Ana', 'ana@example.com', 'usuario'], ['ccc-maria', 'María', 'maria@uta.edu.ec', 'ccc']];
const userCrf = { requesterType: 'usuario', modules: ['Reservas y pasajeros'], title: 'Cancelar boletos', currentBehavior: 'No existe la opción.', featureMissing: true, description: 'Permitir cancelar un boleto comprado desde la aplicación.', justification: 'Evita viajar a la oficina de la cooperativa para cancelar.', result: 'Boleto cancelado y asiento liberado.' };
const devCrf = extra => ({ ...userCrf, requesterType: 'experto', title: 'Cancelación técnica', proposedItilType: 'Normal', modificationType: 'Modificación', environment: 'Pruebas', currentVersion: 'No determinada', acceptanceCriteria: ['El boleto se cancela', 'El asiento se libera'], components: 'Servicio de cancelación', ...extra });
const tmp = () => mkdtempSync(join(tmpdir(), 'changeflow-'));

async function start(filename, options = {}) {
  // Por defecto sin GitHub: las pruebas generales no dependen de la red.
  const app = createApp({ filename, seedPassword: PASSWORD, initialUsers: USERS, github: createGithub({}), ...options });
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
  app.url = `http://127.0.0.1:${app.server.address().port}`;
  return app;
}
const stop = app => new Promise(resolve => app.server.close(resolve));
async function client(app, email) {
  let cookie = '', csrf = '';
  const call = async (path, method = 'GET', body, headers = {}) => {
    const response = await fetch(app.url + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const set = response.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    const raw = Buffer.from(await response.arrayBuffer()); let data; try { data = JSON.parse(raw.toString('utf8')); } catch { data = raw; }
    if (data?.csrf) csrf = data.csrf;
    return { status: response.status, data, headers: response.headers };
  };
  if (email) { const r = await call('/api/auth/login', 'POST', { email, password: PASSWORD }); assert.equal(r.status, 200, `login ${email}`); }
  // Acción sobre una solicitud con su revisión actual.
  const act = async (id, action, data = {}) => { const d = await call(`/api/requests/${id}`); return call(`/api/requests/${id}/${action}`, 'POST', { ...data, revision: d.data?.request?.revision ?? 0 }); };
  const ok = async (id, action, data) => { const r = await act(id, action, data); assert.equal(r.status, 200, `${action}: ${r.data?.error}`); return r.data.request; };
  return { call, act, ok };
}
async function team(app) {
  const c = {};
  for (const [, name, email] of USERS) c[name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')] = await client(app, email);
  return c;
}
const fullPlan = (affectedModules = [{ module: 'Reservas y pasajeros', operation: 'Modificación' }]) => ({
  itilType: 'Normal', classificationJustification: 'Cambio funcional con evaluación ordinaria.', plannedChanges: 'Modificar ventas y esquema.', affectedModules,
  impact: 'Medio', technicalImpact: 'Afecta ventas.', functionalImpact: 'Cambia la compra.', risks: 'Liberación incorrecta\nReembolsos duplicados', urgency: 'Media', priority: 'Alta',
  feasibility: 'Viable', feasibilityJustification: 'Equipo con experiencia.', effortHours: 16, durationDays: 4, resources: 'No se requieren recursos adicionales.',
  rolloutPlan: '## Objetivo\nIncorporar la cancelación sin afectar ventas.\n\n## Actividades\n1. Rama de trabajo\n2. Implementación\n3. Pruebas',
  backoutPlan: '## Activación\n- Errores en ventas\n\n## Acciones\n1. Revertir el merge a la versión 1.2.0 con el respaldo previo',
  testObjective: 'Verificar cancelación.', testTypes: 'Funcionales', testCriteria: ['El boleto se cancela'], testSuccess: 'Todas superadas.', testEvidence: 'Capturas.',
  downtimeValue: 0, downtimeUnit: 'minutos', plannedDate: '2026-12-01T22:00', targetVersion: '1.3.0'
});

test('seguridad: sesión, CSRF, origen, rutas privadas y permisos por rol', async () => {
  const app = await start(':memory:');
  try {
    const anon = await client(app), t = await team(app);
    assert.equal((await anon.call('/api/requests')).status, 401);
    assert.equal((await anon.call('/api/reports')).status, 401);
    for (const p of ['/backend/data/changeflow.sqlite', '/.env', '/backend/server.cjs']) assert.equal((await anon.call(p)).status, 404);
    assert.equal((await t.leslie.call('/api/requests', 'POST', devCrf(), { 'X-CSRF-Token': 'falso' })).status, 403);
    assert.equal((await t.leslie.call('/api/requests', 'POST', devCrf(), { Origin: 'https://malicioso.example' })).status, 403);
    assert.equal((await t.ana.call('/api/reports')).status, 403, 'el usuario final no consulta los reportes internos');
    assert.equal((await t.david.call('/api/ics')).status, 404, 'el catálogo de ICS ya no existe');
    // RN-03 / RN-27: ni el usuario final ni el desarrollador pueden ejecutar acciones del CCC por HTTP directo.
    const id = (await t.ana.call('/api/requests', 'POST', userCrf)).data.request.id;
    for (const c of [t.ana, t.leslie]) {
      assert.equal((await c.act(id, 'receive')).status, c === t.ana ? 403 : 403);
      assert.equal((await c.act(id, 'decision', { decision: 'Aprobado', justification: 'Aprobación indebida.' })).status, 403);
    }
    // El usuario final no ve solicitudes ajenas.
    const other = (await t.leslie.call('/api/requests', 'POST', devCrf())).data.request.id;
    assert.equal((await t.ana.call(`/api/requests/${other}`)).status, 403);
    assert.equal((await t.ana.call('/api/requests')).data.requests.length, 1);
    // El estado no se puede fijar directamente: no existe una ruta para ello y los campos internos se ignoran.
    assert.equal((await t.david.call(`/api/requests/${id}/status`, 'POST', { status: 'Cerrada', revision: 1 })).status, 404);
    const forged = (await t.ana.call('/api/requests', 'POST', { ...userCrf, status: 'Aprobada', priority: 'Crítica', ownerId: 'team-david', id: 'CRF-999999', evaluation: { itilType: 'Normal' } })).data.request;
    assert.equal(forged.status, 'Registrada'); assert.equal(forged.priority, null); assert.equal(forged.ownerId, 'user-ana'); assert.equal(forged.evaluation, null); assert.match(forged.id, /^CRF-\d{6}$/);
    assert.equal((await anon.call('/api/auth/login', 'POST', { email: 'david@uta.edu.ec', password: 'incorrecta' })).status, 401);
    const logout = await t.pablo.call('/api/auth/logout', 'POST', {}); assert.equal(logout.status, 200);
    assert.equal((await t.pablo.call('/api/requests')).status, 401);
  } finally { await stop(app); }
});

test('CRF: validaciones, códigos únicos, identidad del iniciador y bloqueo tras la recepción', async () => {
  const app = await start(':memory:');
  try {
    const t = await team(app);
    assert.equal((await t.ana.call('/api/requests', 'POST', { ...userCrf, description: 'corto' })).status, 400);
    assert.equal((await t.ana.call('/api/requests', 'POST', { ...userCrf, modules: ['Inventado'] })).status, 400);
    assert.equal((await t.ana.call('/api/requests', 'POST', { ...userCrf, requesterType: 'experto' })).status, 403);
    assert.equal((await t.leslie.call('/api/requests', 'POST', devCrf({ acceptanceCriteria: [] }))).status, 400);
    for (const modules of [[], ['Inventado'], ['No estoy seguro', 'Cooperativas']]) {
      const bad = await t.leslie.call('/api/requests', 'POST', devCrf({ modules }));
      assert.equal(bad.status, 400); assert.equal(bad.data.field, 'modules');
    }
    const multi = (await t.ana.call('/api/requests', 'POST', { ...userCrf, modules: ['Pagos y comprobantes', 'Notificaciones'] })).data.request;
    assert.deepEqual(multi.modules, ['Pagos y comprobantes', 'Notificaciones']); assert.equal(multi.module, 'Pagos y comprobantes');
    for (const [extra, field] of [[{ currentVersion: '1.0' }, 'currentVersion'], [{ currentVersion: '01.2.0' }, 'currentVersion'], [{ currentVersion: '1.2.0', targetVersion: '1.2.0' }, 'targetVersion'], [{ currentVersion: '1.2.0', targetVersion: '1.1.9' }, 'targetVersion'], [{ modules: ['Inventado'] }, 'modules']]) {
      const bad = await t.leslie.call('/api/requests', 'POST', devCrf(extra));
      assert.equal(bad.status, 400); assert.equal(bad.data.field, field, 'el servidor indica el campo con error');
    }
    assert.equal((await t.leslie.call('/api/requests', 'POST', devCrf({ currentVersion: '1.2.0', targetVersion: '1.10.0' }))).status, 201, '1.10.0 es mayor que 1.2.0');
    assert.equal((await t.leslie.call('/api/requests', 'POST', devCrf({ businessRulesAffected: true }))).status, 400);
    // Fallo 4: el único CCC no puede presentar solicitudes que nadie podría evaluar.
    assert.equal((await t.david.call('/api/requests', 'POST', devCrf())).status, 403);
    const noItil = await t.leslie.call('/api/requests', 'POST', devCrf({ proposedItilType: '' }));
    assert.equal(noItil.status, 400); assert.equal(noItil.data.field, 'proposedItilType');
    const noVersion = (await t.leslie.call('/api/requests', 'POST', devCrf({ currentVersion: '', targetVersion: '1.0.0' }))).data.request;
    assert.equal(noVersion.currentVersion, 'No determinada', 'la versión actual es opcional'); assert.equal(noVersion.proposedItilType, 'Normal');
    const created = await Promise.all([1, 2, 3].map(() => t.leslie.call('/api/requests', 'POST', devCrf())));
    const ids = created.map(r => r.data.request.id);
    assert.equal(new Set(ids).size, 3);
    const r = created[0].data.request;
    assert.equal(r.name, 'Leslie'); assert.equal(r.email, 'leslie@uta.edu.ec'); assert.equal(r.project, 'BusesUTA');
    assert.match(r.createdAt, /T/); assert.equal(r.businessRules, 'No aplica'); assert.deepEqual(r.acceptanceCriteria, ['El boleto se cancela', 'El asiento se libera']);
    assert.equal((await t.leslie.call(`/api/requests/${r.id}`, 'PATCH', { ...devCrf({ title: 'Título corregido' }), revision: r.revision })).status, 200);
    assert.equal((await t.pablo.call(`/api/requests/${r.id}`, 'PATCH', { ...devCrf(), revision: r.revision + 1 })).status, 403);
    assert.equal((await t.leslie.call(`/api/requests/${r.id}`, 'PATCH', { ...devCrf(), revision: 0 })).status, 409, 'versión antigua');
    // Fallo 1: tras la recepción, y aun después de responder una solicitud de información, no se puede borrar ni editar.
    await t.david.ok(r.id, 'receive');
    await t.david.ok(r.id, 'request-info', { missing: 'Indica qué cooperativas participan.' });
    await t.leslie.ok(r.id, 'clarification', { note: 'Todas las cooperativas.' });
    const after = (await t.leslie.call(`/api/requests/${r.id}`)).data.request;
    assert.equal(after.status, 'En validación');
    assert.equal((await t.leslie.call(`/api/requests/${r.id}`, 'DELETE', { revision: after.revision })).status, 409);
    assert.equal((await t.leslie.call(`/api/requests/${r.id}`, 'PATCH', { ...devCrf(), revision: after.revision })).status, 409);
    // El CCC puede corregir cualquier CRF abierto (técnico o de usuario final), con motivo y conservando el original.
    const sinMotivo = await t.david.call(`/api/requests/${r.id}`, 'PATCH', { ...devCrf({ title: 'Título corregido por el CCC' }), revision: after.revision });
    assert.equal(sinMotivo.status, 400); assert.equal(sinMotivo.data.field, 'correctionReason');
    const corrected = await t.david.call(`/api/requests/${r.id}`, 'PATCH', { ...devCrf({ title: 'Título corregido por el CCC', environment: 'Producción' }), correctionReason: 'El entorno afectado real es producción.', revision: after.revision });
    assert.equal(corrected.status, 200, corrected.data.error);
    const c = corrected.data.request;
    assert.equal(c.title, 'Título corregido por el CCC'); assert.equal(c.original.title, 'Título corregido'); assert.equal(c.original.environment, 'Pruebas');
    assert.deepEqual(c.corrections[0].fields, ['title', 'environment']); assert.equal(c.name, 'Leslie', 'la identidad del iniciador no cambia');
    assert.ok((await t.david.call(`/api/requests/${r.id}`)).data.audit.some(e => e.action === 'Corrección del CCC' && e.field === 'environment' && e.old_value === 'Pruebas'));
    const fromUser = (await t.ana.call('/api/requests', 'POST', userCrf)).data.request;
    assert.equal((await t.david.call(`/api/requests/${fromUser.id}`, 'PATCH', { ...userCrf, title: 'Cancelación de boletos comprados', correctionReason: 'Título más preciso para el catálogo.', revision: fromUser.revision })).status, 200);
    assert.equal((await t.pablo.call(`/api/requests/${fromUser.id}`, 'PATCH', { ...userCrf, correctionReason: 'Intento de un desarrollador.', revision: fromUser.revision + 1 })).status, 403);
    // Una solicitud sin recibir sí puede eliminarse; el evento queda en la auditoría.
    const del = (await t.leslie.call(`/api/requests/${ids[1]}`)).data.request;
    assert.equal((await t.leslie.call(`/api/requests/${ids[1]}`, 'DELETE', { revision: del.revision })).status, 200);
    const audit = (await t.david.call('/api/audit?action=Eliminación')).data.events;
    assert.ok(audit.some(e => e.entity_id === ids[1]));
    const fourth = (await t.leslie.call('/api/requests', 'POST', devCrf())).data.request.id;
    assert.ok(!ids.includes(fourth), 'los códigos eliminados no se reutilizan');
  } finally { await stop(app); }
});

test('solicitud sin cuenta: comprobante, seguimiento con clave y respuesta al CCC', async () => {
  const dir = tmp(), app = await start(join(dir, 'public.sqlite'));
  try {
    const anon = await client(app), t = await team(app);
    assert.equal((await anon.call('/api/public/requests', 'POST', { ...userCrf, name: 'Visitante' })).status, 400);
    assert.equal((await anon.call('/api/public/requests', 'POST', { ...devCrf(), name: 'Visitante', email: 'v@example.com' })).status, 403);
    const sent = await anon.call('/api/public/requests', 'POST', { ...userCrf, name: 'Visitante', email: 'V@Example.com' });
    assert.equal(sent.status, 201);
    const { id, trackingToken } = sent.data.receipt;
    assert.match(trackingToken, /^[a-f0-9]{36}$/);
    assert.deepEqual(Object.keys(sent.data.receipt).sort(), ['date', 'id', 'status', 'trackingToken']);
    assert.equal((await anon.call('/api/public/track', 'POST', { code: id, token: 'f'.repeat(36) })).status, 404);
    // Fallo 2: el CCC pide información y el solicitante sin cuenta puede responder con su clave.
    await t.david.ok(id, 'receive');
    await t.david.ok(id, 'request-info', { missing: 'Adjunta una captura del error.' });
    const tracked = (await anon.call('/api/public/track', 'POST', { code: id, token: trackingToken })).data.request;
    assert.equal(tracked.status, 'Pendiente de información'); assert.equal(tracked.pendingInfo, 'Adjunta una captura del error.');
    assert.equal(tracked.evaluation, undefined); assert.equal(tracked.email, undefined, 'no expone datos internos');
    const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
    const answer = await anon.call('/api/public/track/clarification', 'POST', { code: id, token: trackingToken, revision: tracked.revision, note: 'Adjunto la captura.', files: [{ name: 'captura.png', data: png }] });
    assert.equal(answer.status, 200, answer.data.error); assert.equal(answer.data.request.status, 'En validación');
    const detail = (await t.david.call(`/api/requests/${id}`)).data;
    assert.equal(detail.attachments.length, 1); assert.equal(detail.request.infoRequests[0].response, 'Adjunto la captura.');
    assert.equal(detail.request.trackingHash, undefined, 'el hash de la clave no se envía');
    // Los desarrolladores ven las solicitudes recibidas sin cuenta.
    assert.equal((await t.pablo.call(`/api/requests/${id}`)).status, 200);
  } finally { await stop(app); rmSync(dir, { recursive: true, force: true }); }
});

test('ficha única del CCC: borrador, análisis, planificación y decisiones coherentes', async () => {
  const app = await start(':memory:');
  try {
    const t = await team(app);
    const id = (await t.leslie.call('/api/requests', 'POST', devCrf())).data.request.id;
    assert.equal((await t.david.act(id, 'evaluation', { step: 'draft' })).status, 409, 'requiere iniciar el análisis');
    await t.david.ok(id, 'receive'); await t.david.ok(id, 'validate');
    // Guardado parcial: no se marca como completado.
    const draft = await t.david.ok(id, 'evaluation', { step: 'draft', itilType: 'Normal', impact: 'Alto' });
    assert.equal(draft.status, 'En análisis'); assert.equal(draft.evaluation.itilType, 'Normal'); assert.equal(draft.evaluation.analysisCompletedAt, undefined);
    const incomplete = await t.david.act(id, 'evaluation', { step: 'analysis', itilType: 'Normal' });
    assert.equal(incomplete.status, 400); assert.match(incomplete.data.error, /Impacto técnico/);
    assert.equal((await t.david.act(id, 'evaluation', { ...fullPlan(), effortHours: -3, step: 'draft' })).status, 400, 'esfuerzo negativo');
    // Fallo 3: no se puede aprobar antes de completar la planificación.
    assert.equal((await t.david.act(id, 'decision', { decision: 'Aprobado', justification: 'Intento prematuro.' })).status, 409);
    // Otro integrante del CCC no puede tomar una ficha ajena.
    assert.equal((await t.maria.act(id, 'evaluation', { step: 'draft' })).status, 403);
    const template = await t.david.act(id, 'evaluation', { ...fullPlan(), rolloutPlan: '## Objetivo\n\n## Actividades\n1. \n2. ', step: 'planning' });
    assert.equal(template.status, 400); assert.match(template.data.error, /Plan de rollout/);
    const planned = await t.david.ok(id, 'evaluation', { ...fullPlan(), step: 'planning' });
    assert.match(planned.evaluation.rolloutPlan, /## Objetivo/);
    assert.equal(planned.status, 'Pendiente de aprobación'); assert.equal(planned.priority, 'Alta');
    // Una modificación posterior obliga a completar de nuevo la planificación.
    const changed = await t.david.ok(id, 'evaluation', { ...fullPlan(), impact: 'Alto', step: 'draft' });
    assert.equal(changed.status, 'En planificación');
    await t.david.ok(id, 'evaluation', { ...fullPlan(), feasibility: 'No viable', step: 'planning' });
    // Caso D: un cambio no viable no puede aprobarse, ni siquiera con condiciones; se informa el error.
    for (const decision of ['Aprobado', 'Aprobado con condiciones']) {
      const blocked = await t.david.act(id, 'decision', { decision, justification: 'Se aprueba igualmente.', conditions: [{ text: 'X', verification: 'Y' }] });
      assert.equal(blocked.status, 409); assert.match(blocked.data.error, /No viable/); assert.equal(blocked.data.field, 'decision');
    }
    // Versión objetivo: formato válido y mayor que la versión actual del CRF.
    const badVersion = await t.david.act(id, 'evaluation', { ...fullPlan(), targetVersion: '1.3', step: 'draft' });
    assert.equal(badVersion.status, 400); assert.equal(badVersion.data.field, 'targetVersion');
    await t.david.ok(id, 'evaluation', { ...fullPlan(), step: 'planning' });
    assert.equal((await t.david.act(id, 'decision', { decision: 'Aprobado con condiciones', justification: 'Se aprueba con condiciones.', conditions: [{ text: 'Respaldo', verification: '' }] })).status, 400);
    assert.equal((await t.david.act(id, 'decision', { decision: 'Aprobado', justification: 'Con condiciones ocultas.', conditions: [{ text: 'X', verification: 'Y' }] })).status, 400);
    const approved = await t.david.ok(id, 'decision', { decision: 'Aprobado con condiciones', justification: 'Beneficio alto con riesgo controlado.', conditions: [{ text: 'Respaldar la base', verification: 'Evidencia en la revisión' }] });
    assert.equal(approved.status, 'Aprobada con condiciones');
    const decision = approved.decisions.at(-1);
    assert.equal(decision.conditions[0].id, 'C1'); assert.equal(decision.evaluationSnapshot.feasibility, 'Viable');
    assert.deepEqual(approved.decisions.at(-1).authorizedModules, [{ module: 'Reservas y pasajeros', operation: 'Modificación' }]);
    assert.deepEqual((await t.david.call(`/api/requests/${id}`)).data.authorizedModules, ['Reservas y pasajeros']);
    const noModules = await t.david.act(id, 'reevaluate', { reason: 'Revisar los módulos afectados.' });
    assert.equal(noModules.status, 200);
    const missing = await t.david.act(id, 'evaluation', { ...fullPlan([]), step: 'planning' });
    assert.equal(missing.status, 400); assert.match(missing.data.error, /Módulos afectados/);
    assert.equal((await t.david.act(id, 'evaluation', { ...fullPlan([{ module: 'No estoy seguro', operation: 'Modificación' }]), step: 'draft' })).data.field, 'affectedModules');
    await t.david.ok(id, 'evaluation', { ...fullPlan(), step: 'planning' });
    await t.david.ok(id, 'decision', { decision: 'Aprobado con condiciones', justification: 'Beneficio alto con riesgo controlado.', conditions: [{ text: 'Respaldar la base', verification: 'Evidencia en la revisión' }] });
    // Reevaluar conserva la decisión anterior como sustituida.
    const re = await t.david.ok(id, 'reevaluate', { reason: 'Cambió la disponibilidad del equipo.' });
    assert.equal(re.status, 'En planificación'); assert.equal(re.decisions.filter(d => d.kind === 'Autorización').every(d => d.superseded), true);
    assert.deepEqual((await t.david.call(`/api/requests/${id}`)).data.authorizedModules, []);
    // Caso C: viable pero rechazado; el rechazo puede emitirse sin planes completos.
    const c = (await t.pablo.call('/api/requests', 'POST', devCrf())).data.request.id;
    await t.david.ok(c, 'receive'); await t.david.ok(c, 'validate');
    await t.david.ok(c, 'evaluation', { ...fullPlan(), rolloutPlan: '', step: 'analysis' });
    assert.equal((await t.david.act(c, 'decision', { decision: 'Rechazado', justification: '' })).status, 400);
    const rejected = await t.david.ok(c, 'decision', { decision: 'Rechazado', justification: 'Viable, pero el costo supera el beneficio.' });
    assert.equal(rejected.status, 'Rechazada'); assert.equal(rejected.evaluation.feasibility, 'Viable');
    assert.ok(rejected.notices.some(n => /rechazada/.test(n.message)));
    // RN-05: una rechazada no se asigna ni se implementa.
    assert.equal((await t.david.act(c, 'assign', { developerId: 'team-edwin' })).status, 409);
    assert.equal((await t.pablo.act(c, 'start')).status, 403);
    const closed = await t.david.ok(c, 'close-rejected', {});
    assert.equal(closed.status, 'Cerrada'); assert.equal(closed.closure.result, null); assert.equal(closed.closure.administrative, 'Cerrada por rechazo');
    // RN-28: «Más información» no es un rechazo; el iniciador responde y el análisis se reanuda.
    const m = (await t.shirley.call('/api/requests', 'POST', devCrf())).data.request.id;
    await t.david.ok(m, 'receive'); await t.david.ok(m, 'validate');
    const info = await t.david.ok(m, 'decision', { decision: 'Más información', justification: 'Falta el detalle de reglas de negocio.' });
    assert.equal(info.status, 'Pendiente de información');
    assert.equal((await t.david.act(m, 'decision', { decision: 'Aprobado', justification: 'Sin esperar la respuesta.' })).status, 409);
    await t.shirley.ok(m, 'clarification', { note: 'RN-02 y RN-20.' });
    assert.equal((await t.shirley.call(`/api/requests/${m}`)).data.request.status, 'En validación');
  } finally { await stop(app); }
});

test('ejecución: asignación, implementación, desviación, pruebas fallidas, revisión, cierre y reapertura', async () => {
  const dir = tmp();
  const app = await start(join(dir, 'flow.sqlite'));
  try {
    const t = await team(app);
    const id = (await t.leslie.call('/api/requests', 'POST', devCrf())).data.request.id;
    await t.david.ok(id, 'receive'); await t.david.ok(id, 'validate');
    await t.david.ok(id, 'evaluation', { ...fullPlan(), step: 'planning' });
    await t.david.ok(id, 'decision', { decision: 'Aprobado con condiciones', justification: 'Beneficio alto.', conditions: [{ text: 'Respaldar la base', verification: 'Captura del respaldo' }] });
    assert.equal((await t.david.act(id, 'assign', { developerId: 'user-ana' })).status, 400, 'solo desarrolladores');
    assert.equal((await t.leslie.act(id, 'assign', { developerId: 'team-edwin' })).status, 403);
    await t.david.ok(id, 'assign', { developerId: 'team-edwin', targetDate: '2099-01-10' });
    assert.equal((await t.david.act(id, 'assign', { developerId: 'team-shirley' })).status, 400, 'la reasignación exige motivo');
    const reassigned = await t.david.ok(id, 'assign', { developerId: 'team-shirley', reason: 'Edwin pasa a otro cambio.' });
    assert.equal(reassigned.assignments.length, 2); assert.ok(reassigned.assignments[0].releasedAt);
    await t.david.ok(id, 'assign', { developerId: 'team-edwin', reason: 'Edwin vuelve a estar disponible.' });
    assert.equal((await t.shirley.act(id, 'start')).status, 403, 'responsable anterior');
    assert.equal((await t.edwin.act(id, 'start')).status, 400, 'debe confirmar las condiciones');
    await t.edwin.ok(id, 'start', { conditionsAcknowledged: true });
    assert.equal((await t.edwin.act(id, 'send-to-tests')).status, 409, 'sin actividades');
    await t.edwin.ok(id, 'activity', { description: 'Lógica de cancelación', hours: 6 });
    assert.equal((await t.edwin.act(id, 'git', { kind: 'Commit', value: 'no-es-un-sha' })).status, 400);
    assert.equal((await t.edwin.act(id, 'git', { kind: 'Pull request', value: 'abc', url: 'https://github.com/org/repo/issues/4' })).status, 400);
    const git = await t.edwin.ok(id, 'git', { kind: 'Pull request', value: '#4', url: 'https://github.com/org/repo/pull/4' });
    assert.equal(git.gitRefs[0].verified, false); assert.equal(git.gitRefs[0].verification.status, 'sin configurar');
    // Un cliente no puede marcar una referencia como verificada.
    const forged = await t.edwin.ok(id, 'git', { kind: 'Rama', value: 'feature/x', verification: { ok: true }, verified: true });
    assert.equal(forged.gitRefs.at(-1).verified, false);
    await t.edwin.ok(id, 'module-change', { module: 'Reservas y pasajeros', operation: 'Modificación', description: 'Caso de uso de cancelación.' });
    assert.equal((await t.edwin.act(id, 'module-change', { module: 'No estoy seguro', operation: 'Modificación', description: 'Sin módulo.' })).status, 400);
    // Caso K: un módulo no autorizado genera una desviación que bloquea el avance.
    const dev = await t.edwin.ok(id, 'module-change', { module: 'Pagos y comprobantes', operation: 'Modificación', description: 'Reembolso del pago.' });
    assert.equal(dev.deviations[0].status, 'Pendiente'); assert.equal(dev.changes.at(-1).inScope, false);
    assert.equal((await t.edwin.act(id, 'send-to-tests')).status, 409);
    assert.equal((await t.edwin.act(id, 'scope', { deviationId: 'DES-1', decision: 'Autorizada', justification: 'Autoriza el desarrollador.' })).status, 403);
    const scoped = await t.david.ok(id, 'scope', { deviationId: 'DES-1', decision: 'Autorizada', justification: 'La columna es necesaria.' });
    assert.equal(scoped.decisions.at(-1).kind, 'Ampliación de alcance'); assert.equal(scoped.decisions.at(-1).module, 'Pagos y comprobantes');
    assert.ok(scoped.changes.every(c => c.inScope)); assert.ok((await t.david.call(`/api/requests/${id}`)).data.authorizedModules.includes('Pagos y comprobantes'));
    // Rama de trabajo con formato identificador-titulo-descripcionCorta y PR desde esa rama.
    assert.equal((await t.edwin.act(id, 'send-to-tests')).status, 409, 'sin rama ni PR');
    assert.equal((await t.edwin.act(id, 'pull-request', { number: 4 })).status, 409, 'el PR requiere la rama');
    assert.equal((await t.pablo.act(id, 'branch', { shortDescription: 'liberar asiento' })).status, 403, 'solo el asignado');
    assert.equal((await t.edwin.act(id, 'branch', { shortDescription: '!!' })).data.field, 'shortDescription');
    const branch = await t.edwin.ok(id, 'branch', { shortDescription: 'Liberar asiento', base: 'develop' });
    assert.equal(branch.workBranch.name, `${id}-cancelacion-tecnica-liberar-asiento`); assert.equal(branch.workBranch.base, 'develop'); assert.equal(branch.workBranch.verified, false);
    assert.equal((await t.edwin.act(id, 'send-to-tests')).status, 409, 'sin PR');
    const pr = await t.edwin.ok(id, 'pull-request', { number: '#4' });
    assert.equal(pr.pullRequest.head, branch.workBranch.name); assert.equal(pr.pullRequest.base, 'develop');
    assert.equal((await t.edwin.act(id, 'branch', { shortDescription: 'otra rama' })).status, 409, 'con PR la rama no se reemplaza');
    await t.edwin.ok(id, 'send-to-tests');
    // Caso J: pruebas fallidas → correcciones, sin sobrescribir la ronda anterior.
    assert.equal((await t.pablo.act(id, 'finish-tests', { outcome: 'Todas superadas' })).status, 409, 'sin pruebas');
    await t.pablo.ok(id, 'test', { name: 'Cancelar', expected: 'Cancelado', obtained: 'Error 500', status: 'Fallida' });
    assert.equal((await t.pablo.act(id, 'finish-tests', { outcome: 'Todas superadas' })).status, 409);
    assert.equal((await t.pablo.act(id, 'finish-tests', { outcome: 'Existen fallos' })).status, 400, 'incidencia obligatoria');
    const failed = await t.pablo.ok(id, 'finish-tests', { outcome: 'Existen fallos', incident: 'Error al liberar el asiento.' });
    assert.equal(failed.status, 'Correcciones requeridas');
    assert.equal((await t.edwin.act(id, 'close', { result: 'Exitoso', summary: 'Intento de cierre.' })).status, 409);
    await t.edwin.ok(id, 'start', { note: 'Corrección', conditionsAcknowledged: true });
    await t.edwin.ok(id, 'activity', { description: 'Corrección del error 500', hours: 2 });
    await t.edwin.ok(id, 'send-to-tests');
    const t2 = await t.pablo.ok(id, 'test', { name: 'Cancelar', expected: 'Cancelado', obtained: 'Cancelado', status: 'Superada' });
    assert.equal(t2.tests.length, 2); assert.equal(t2.tests[0].status, 'Fallida');
    await t.pablo.ok(id, 'finish-tests', { outcome: 'Todas superadas' });
    const crit = (await t.pablo.call(`/api/requests/${id}`)).data.reviewCriteria;
    // RN-19: no hay conformidad con condiciones sin verificar o criterios incumplidos.
    const review = { summary: 'Implementación revisada.', rolloutCompliance: 'Cumplido', recommendation: 'Cerrar.', decision: 'Conforme' };
    assert.equal((await t.pablo.act(id, 'review', { ...review, criteria: crit.map(() => ({ met: true })), conditions: [{ id: 'C1', met: false }] })).status, 409);
    assert.equal((await t.pablo.act(id, 'review', { ...review, criteria: crit.map((_, i) => ({ met: i > 0 })), conditions: [{ id: 'C1', met: true }] })).status, 409);
    const reviewed = await t.pablo.ok(id, 'review', { ...review, criteria: crit.map(() => ({ met: true })), conditions: [{ id: 'C1', met: true, evidence: 'Respaldo adjunto' }] });
    assert.equal(reviewed.reviews[0].independent, true);
    assert.equal((await t.pablo.act(id, 'close', { result: 'Exitoso', summary: 'Cierre por otro.' })).status, 403);
    const closed = await t.edwin.ok(id, 'close', { result: 'Exitoso', summary: 'Cancelación disponible.', resultingVersion: '1.3.0' });
    assert.equal(closed.status, 'Cerrada'); assert.equal(closed.closure.result, 'Exitoso'); assert.equal(closed.decisions[0].decision, 'Aprobado con condiciones');
    assert.deepEqual(closed.closure.modulesModified, ['Reservas y pasajeros', 'Pagos y comprobantes']);
    // Reapertura documentada.
    assert.equal((await t.david.act(id, 'reopen', { reason: 'corto' })).status, 400);
    const reopened = await t.david.ok(id, 'reopen', { reason: 'Se detectó un efecto secundario en producción.' });
    assert.equal(reopened.status, 'En análisis'); assert.equal(reopened.closures.length, 1); assert.equal(reopened.reopenings[0].newStatus, 'En análisis');

    // Cierre fallido con backout y cierre incompleto.
    const f = (await t.leslie.call('/api/requests', 'POST', devCrf())).data.request.id;
    await t.david.ok(f, 'receive'); await t.david.ok(f, 'validate');
    await t.david.ok(f, 'evaluation', { ...fullPlan(), itilType: 'Emergencia', classificationJustification: 'Caída de ventas en producción que exige atención inmediata.', rolloutPlan: '1. Aplicar el parche urgente', backoutPlan: '1. Revertir el despliegue', testTypes: '', step: 'planning' });
    await t.david.ok(f, 'decision', { decision: 'Aprobado', justification: 'Emergencia autorizada.' });
    await t.david.ok(f, 'assign', { developerId: 'team-shirley' });
    await t.shirley.ok(f, 'start');
    await t.shirley.ok(f, 'activity', { description: 'Parche urgente', hours: 1 });
    await t.shirley.ok(f, 'module-change', { module: 'Reservas y pasajeros', operation: 'Modificación', description: 'Parche.' });
    await t.shirley.ok(f, 'branch', { shortDescription: 'parche urgente' });
    await t.shirley.ok(f, 'pull-request', { number: 9 });
    await t.shirley.ok(f, 'send-to-tests');
    await t.leslie.ok(f, 'test', { name: 'Ventas', expected: 'OK', obtained: 'Falla', status: 'Fallida' });
    await t.leslie.ok(f, 'finish-tests', { outcome: 'Existen fallos', incident: 'El parche rompe el pago.', next: 'Revisión' });
    const bko = await t.shirley.ok(f, 'backout', { trigger: 'El parche rompe el pago.', actions: 'Se revirtió el despliegue.', recovered: 'r15', result: 'Reversión exitosa', systemState: 'Ventas operativas con r15.' });
    assert.equal(bko.backouts.length, 1);
    await t.leslie.ok(f, 'review', { summary: 'Se aplicó el backout.', rolloutCompliance: 'No cumplido', criteria: (await t.leslie.call(`/api/requests/${f}`)).data.reviewCriteria.map(() => ({ met: false })), recommendation: 'Cerrar como fallido.', decision: 'Implementación fallida' });
    assert.equal((await t.shirley.act(f, 'close', { result: 'Exitoso', summary: 'Intento.' })).status, 409);
    assert.equal((await t.shirley.act(f, 'close', { result: 'Fallido', summary: 'Se revirtió.' })).status, 400, 'justificación obligatoria');
    const fc = await t.shirley.ok(f, 'close', { result: 'Fallido', summary: 'Se revirtió.', justification: 'El parche se revirtió mediante el plan de backout.' });
    assert.equal(fc.closure.result, 'Fallido');
    const reports = (await t.david.call('/api/reports')).data;
    assert.equal(reports.counts.failed, 1);
    assert.equal((await t.david.call('/api/reports?result=Fallido')).data.rows.length, 1);
  } finally { await stop(app); rmSync(dir, { recursive: true, force: true }); }
});

test('auditoría, adjuntos y reportes: eventos inmutables, acceso protegido y CSV', async () => {
  const dir = tmp(), app = await start(join(dir, 'files.sqlite'));
  try {
    const t = await team(app);
    const r = (await t.ana.call('/api/requests', 'POST', { ...userCrf, files: [{ name: 'nota.txt', data: Buffer.from('hola').toString('base64') }] })).data.request;
    assert.equal((await t.ana.call('/api/requests', 'POST', { ...userCrf, files: [{ name: 'virus.exe', data: 'AAAA' }] })).status, 400);
    assert.equal((await t.ana.call('/api/requests', 'POST', { ...userCrf, files: [{ name: 'grande.pdf', data: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }] })).status, 400);
    const detail = (await t.david.call(`/api/requests/${r.id}`)).data;
    const att = detail.attachments[0];
    assert.equal(att.filename, 'nota.txt');
    const download = await t.david.call(`/api/attachments/${att.id}`);
    assert.equal(download.status, 200); assert.equal(download.data.toString(), 'hola'); assert.match(download.headers.get('content-disposition'), /attachment/);
    const other = await client(app, 'leslie@uta.edu.ec');
    assert.equal((await other.call(`/api/attachments/${att.id}`)).status, 403, 'un desarrollador no ve adjuntos de solicitudes privadas no aprobadas');
    assert.equal((await (await client(app)).call(`/api/attachments/${att.id}`)).status, 401);
    // Eventos: creación, recepción, decisiones; no se pueden modificar.
    await t.david.ok(r.id, 'receive');
    const events = detail.audit.concat((await t.david.call(`/api/requests/${r.id}`)).data.audit);
    assert.ok(events.some(e => e.action === 'Creación de CRF'));
    assert.ok(events.some(e => e.action === 'Recepción del CRF' && e.from_status === 'Registrada' && e.to_status === 'En validación'));
    assert.throws(() => app.db.prepare("UPDATE audit_events SET action='x'").run(), /no puede modificarse/);
    assert.throws(() => app.db.prepare('DELETE FROM audit_events').run(), /no puede eliminarse/);
    const rep = (await t.david.call('/api/reports')).data;
    assert.equal(rep.counts.total, 1); assert.equal(rep.metrics.avgDecisionDays, null, 'sin datos no se inventan métricas');
    const csv = await t.david.call('/api/reports.csv');
    assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /text\/csv/); assert.match(csv.data.toString(), /"Código";"Fecha";"Título"/);
    assert.equal((await t.ana.call('/api/reports')).status, 403);
  } finally { await stop(app); rmSync(dir, { recursive: true, force: true }); }
});

test('migración del modelo anterior: conserva datos, códigos y marca incoherencias', async () => {
  const dir = tmp(), file = join(dir, 'legacy.sqlite');
  try {
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,role TEXT NOT NULL CHECK(role IN ('usuario','experto','ccc')),password_hash TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE requests(id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id TEXT REFERENCES users(id),document TEXT NOT NULL); PRAGMA user_version=3;`);
    const insertUser = old.prepare('INSERT INTO users(id,name,email,role,password_hash) VALUES(?,?,?,?,?)');
    for (const u of USERS) insertUser.run(...u, hashPassword(PASSWORD));
    const base = { project: 'ProyectoBusesUTA', module: 'Cooperativas', title: 'Antiguo', currentBehavior: 'x', description: 'Descripción suficientemente larga.', justification: 'Justificación suficientemente larga.', result: 'r', attachments: ['captura.png'], name: 'Leslie', email: 'leslie@uta.edu.ec', ownerId: 'team-leslie', requesterType: 'experto', components: 'API', environment: 'Pruebas', acceptanceCriteria: 'Uno\nDos', priority: 'Media', revision: 3, history: [{ status: 'Pendiente', date: '2026-10-01T10:00:00.000Z', responsible: 'Leslie', note: 'Solicitud registrada.' }], date: '2026-10-01' };
    const analysis = { impact: 'Medio', technicalImpact: 't', risks: 'r', feasibility: 'Viable', effort: '8 h', resources: 'r', considerations: 'c', priority: 'Alta', analyst: 'David', analystId: 'team-david', date: '2026-10-02T10:00:00.000Z' };
    const docs = [
      { ...base, id: 'SCR-0001', status: 'Pendiente', resolutions: [] },
      { ...base, id: 'SCR-0002', status: 'Aprobada', analysis, resolutions: [{ decision: 'Aprobado', decisionNote: 'Ok', conditions: '', responsible: 'David', responsibleId: 'team-david', date: '2026-10-03T10:00:00.000Z' }] },
      { ...base, id: 'SCR-0003', status: 'Más información', analysis, resolutions: [{ decision: 'Más información', decisionNote: 'Falta detalle', responsible: 'David', date: '2026-10-03T10:00:00.000Z' }] }
    ];
    for (const d of docs) old.prepare('INSERT INTO requests(owner_id,document) VALUES(?,?)').run(d.ownerId, JSON.stringify(d));
    old.close();
    const app = await start(file);
    try {
      const t = await team(app);
      const list = (await t.david.call('/api/requests')).data.requests;
      assert.deepEqual(list.map(r => `${r.id}:${r.legacyCode}:${r.status}`), ['CRF-000001:SCR-0001:Registrada', 'CRF-000002:SCR-0002:Aprobada', 'CRF-000003:SCR-0003:Pendiente de información']);
      const approved = list[1];
      assert.equal(approved.legacy.analysis.effort, '8 h'); assert.deepEqual(approved.legacy.attachmentNames, ['captura.png']);
      assert.equal(approved.decisions[0].legacy, true); assert.ok(approved.flags.length, 'incoherencia marcada para revisión');
      assert.deepEqual(approved.acceptanceCriteria, ['Uno', 'Dos']);
      assert.equal((await t.david.act('SCR-0002', 'assign', { developerId: 'team-edwin' })).status, 409, 'exige reevaluar la aprobación heredada');
      assert.deepEqual(list[0].modules, ['Cooperativas'], 'el módulo único anterior se presenta como lista');
      assert.equal((await t.david.act('CRF-000002', 'reevaluate', { reason: 'Completar rollout y backout.' })).status, 200);
      await t.leslie.ok('CRF-000003', 'clarification', { note: 'Detalle aportado.' });
      assert.ok((await t.david.call('/api/audit?action=Migración')).data.events.length >= 3);
      assert.equal((await t.leslie.call('/api/requests', 'POST', devCrf())).data.request.id, 'CRF-000004', 'el contador continúa');
    } finally { await stop(app); }
    // La migración es idempotente.
    const db = openDatabase(file);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='Migración al modelo 4'").get().n, 3);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('equipo y persistencia: sincronización de cuentas y datos conservados al reiniciar', async () => {
  const dir = tmp(), file = join(dir, 'team.sqlite');
  try {
    let app = await start(file);
    let id;
    try {
      const t = await team(app);
      id = (await t.leslie.call('/api/requests', 'POST', devCrf())).data.request.id;
      await t.maria.ok(id, 'receive'); await t.maria.ok(id, 'validate');
      await t.maria.ok(id, 'evaluation', { step: 'draft', itilType: 'Normal' });
    } finally { await stop(app); }
    const db = openDatabase(file);
    const result = configureTeam(db, 'Nueva-Clave-Equipo-2026');
    assert.deepEqual(result.users.map(u => u.role).sort(), ['ccc', 'experto', 'experto', 'experto', 'experto']);
    assert.equal(result.reopened, 1, 'la ficha de María se conserva y se reinicia');
    assert.equal(configureTeam(db, 'Nueva-Clave-Equipo-2026').reopened, 0, 'idempotente');
    db.close();
    app = createApp({ filename: file, seedPassword: 'otra-clave-que-no-se-usa' });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); app.url = `http://127.0.0.1:${app.server.address().port}`;
    try {
      const anon = await client(app);
      assert.equal((await anon.call('/api/auth/login', 'POST', { email: 'maria@uta.edu.ec', password: PASSWORD })).status, 401, 'cuenta desactivada');
      assert.equal((await anon.call('/api/auth/login', 'POST', { email: 'david@uta.edu.ec', password: 'Nueva-Clave-Equipo-2026' })).status, 200);
      const r = (await anon.call(`/api/requests/${id}`)).data.request;
      assert.equal(r.status, 'En validación'); assert.equal(r.previousEvaluations[0].member, 'María'); assert.equal(r.evaluation, null);
    } finally { await stop(app); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- GitHub (API simulada) ----------
function mockGithub() {
  const state = { issues: [], comments: [], calls: [], branches: { main: 'm'.repeat(40), 'feature/x': 'a'.repeat(40) }, pulls: { 4: { number: 4, title: 'Cancelación de boletos', state: 'closed', merged_at: '2026-11-20T10:00:00Z', head: { ref: 'feature/x' }, base: { ref: 'main' } }, 5: { number: 5, title: 'Ajuste', state: 'open', merged_at: null, draft: false, head: { ref: 'fix' }, base: { ref: 'main' } } } };
  const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(data === undefined ? '' : JSON.stringify(data)); };
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const data = body ? JSON.parse(body) : null, url = decodeURIComponent(req.url);
    state.calls.push({ method: req.method, url, data, auth: req.headers.authorization, agent: req.headers['user-agent'] });
    if (req.headers.authorization !== 'Bearer test-token') return send(res, 401, { message: 'Bad credentials' });
    const base = '/repos/org/busesuta';
    if (url === base) return send(res, 200, { full_name: 'org/busesuta', default_branch: 'main', private: true, html_url: 'https://github.com/org/busesuta', has_issues: true, permissions: { push: true } });
    let m;
    if ((m = /^\/repos\/org\/busesuta\/branches\/(.+)$/.exec(url))) return state.branches[m[1]] ? send(res, 200, { name: m[1], commit: { sha: state.branches[m[1]] }, _links: { html: `https://github.com/org/busesuta/tree/${m[1]}` } }) : send(res, 404, { message: 'Branch not found' });
    if ((m = /^\/repos\/org\/busesuta\/git\/ref\/heads\/(.+)$/.exec(url))) return state.branches[m[1]] ? send(res, 200, { object: { sha: state.branches[m[1]] } }) : send(res, 404, { message: 'Not Found' });
    if (url === `${base}/git/refs` && req.method === 'POST') { state.branches[data.ref.replace('refs/heads/', '')] = data.sha; return send(res, 201, { ref: data.ref }); }
    if (url === `${base}/commits/abc1234`) return send(res, 200, { sha: 'abc1234' + '0'.repeat(33), html_url: 'https://github.com/org/busesuta/commit/abc1234', commit: { message: 'Cancelación\n\ndetalle', author: { name: 'Edwin', date: '2026-11-20T09:00:00Z' } } });
    if (url.startsWith(`${base}/pulls?`)) { const q = new URLSearchParams(url.split('?')[1]); return send(res, 200, Object.values(state.pulls).filter(p => p.state === 'open' && `org:${p.head.ref}` === q.get('head') && p.base.ref === q.get('base')).map(p => ({ ...p, html_url: `https://github.com/org/busesuta/pull/${p.number}` }))); }
    if (url === `${base}/pulls` && req.method === 'POST') { if (!state.branches[data.head]) return send(res, 422, { message: 'Validation Failed', errors: [{ message: 'head no existe' }] }); const n = 100 + Object.keys(state.pulls).length; state.pulls[n] = { number: n, title: data.title, body: data.body, state: 'open', merged_at: null, head: { ref: data.head }, base: { ref: data.base } }; return send(res, 201, { ...state.pulls[n], html_url: `https://github.com/org/busesuta/pull/${n}` }); }
    if ((m = /\/pulls\/(\d+)$/.exec(url)) && state.pulls[m[1]]) return send(res, 200, { ...state.pulls[m[1]], html_url: `https://github.com/org/busesuta/pull/${m[1]}` });
    if (url === `${base}/git/ref/tags/v1.3.0`) return send(res, 200, { object: { sha: 'b'.repeat(40) } });
    if (url === `${base}/issues` && req.method === 'POST') { const issue = { number: state.issues.length + 1, html_url: `https://github.com/org/busesuta/issues/${state.issues.length + 1}`, state: 'open', created_at: '2026-11-19T00:00:00Z', assignees: [], ...data, labels: data.labels.map(name => ({ name })) }; state.issues.push(issue); return send(res, 201, issue); }
    const issue = /\/issues\/(\d+)(\/comments)?$/.exec(url);
    if (issue) {
      const it = state.issues[Number(issue[1]) - 1];
      if (!it) return send(res, 404, { message: 'Not Found' });
      if (issue[2] && req.method === 'POST') { state.comments.push({ issue: it.number, body: data.body }); return send(res, 201, { id: state.comments.length }); }
      if (req.method === 'PATCH') {
        if (data.assignees?.some(a => a === 'NoColaborador')) return send(res, 422, { message: 'Validation Failed' });
        Object.assign(it, data, { labels: data.labels.map(name => ({ name })), ...(data.assignees ? { assignees: data.assignees.map(login => ({ login })) } : {}) }); return send(res, 200, it);
      }
      return send(res, 200, it);
    }
    return send(res, 404, { message: 'Not Found' });
  });
  return { state, server };
}
const GH_USERS = USERS.map(([id, name, email, role]) => [id, name, email, role, { 'team-edwin': 'EdwinGH', 'team-pablo': 'PabloGH', 'team-shirley': 'NoColaborador' }[id]]);
test('GitHub: issue al aprobar, asignación, rama y PR del cambio, y verificación de referencias', async () => {
  const gh = mockGithub();
  await new Promise(resolve => gh.server.listen(0, '127.0.0.1', resolve));
  const apiUrl = `http://127.0.0.1:${gh.server.address().port}`;
  const app = await start(':memory:', { initialUsers: GH_USERS, github: createGithub({ repo: 'org/busesuta', token: 'test-token', apiUrl }), appUrl: 'http://cambios.example' });
  try {
    const anon = await client(app), t = await team(app);
    const status = (await t.edwin.call('/api/github/status')).data;
    assert.equal(status.configured, true); assert.equal(status.reachable, true); assert.equal(status.canCreateIssues, true); assert.equal(status.defaultBranch, 'main');
    // Registrar una solicitud no crea la issue: se crea cuando el CCC la aprueba.
    const pub = (await anon.call('/api/public/requests', 'POST', { ...userCrf, name: 'Visitante Privado', email: 'privado@example.com' })).data.receipt;
    const id = (await t.leslie.call('/api/requests', 'POST', devCrf())).data.request.id;
    assert.equal(gh.state.issues.length, 0);
    assert.equal((await t.david.call(`/api/requests/${id}/github-issue`, 'POST', {})).status, 409, 'sin aprobación no hay issue');
    await t.david.ok(pub.id, 'receive'); await t.david.ok(pub.id, 'validate');
    await t.david.ok(pub.id, 'evaluation', { ...fullPlan(), step: 'analysis' });
    await t.david.ok(pub.id, 'decision', { decision: 'Rechazado', justification: 'No es prioritario este semestre.' });
    assert.equal(gh.state.issues.length, 0, 'un rechazo no crea issue');
    await t.david.ok(id, 'receive'); await t.david.ok(id, 'validate');
    await t.david.ok(id, 'evaluation', { ...fullPlan(), step: 'planning' });
    const approved = await t.david.ok(id, 'decision', { decision: 'Aprobado', justification: 'Cambio acotado y viable.' });
    assert.equal(approved.github.issue.number, 1); assert.equal(gh.state.issues.length, 1);
    const issue = gh.state.issues[0];
    assert.equal(issue.title, `[${id}] Cancelación técnica`); assert.match(issue.body, /http:\/\/cambios\.example\/#detalle\//);
    assert.doesNotMatch(issue.body, /leslie@uta\.edu\.ec/);
    assert.ok(issue.labels.some(l => l.name === 'estado: aprobada'));
    assert.ok(gh.state.calls.every(c => c.agent === 'changeflow-uta'));
    // La issue se asigna al desarrollador responsable (su usuario de GitHub) y cambia con la reasignación.
    await t.david.ok(id, 'assign', { developerId: 'team-pablo' });
    assert.deepEqual(issue.assignees.map(a => a.login), ['PabloGH']);
    await t.david.ok(id, 'assign', { developerId: 'team-edwin', reason: 'Pablo pasa a otro cambio.' });
    assert.deepEqual(issue.assignees.map(a => a.login), ['EdwinGH']);
    await t.edwin.ok(id, 'start');
    assert.ok(issue.labels.some(l => l.name === 'estado: en implementación'));
    // Rama de trabajo creada en GitHub desde la base, con el formato del CRF.
    assert.equal((await t.edwin.act(id, 'branch', { shortDescription: 'liberar asiento', base: 'no-existe', create: true })).data.field, 'base');
    const missing = await t.edwin.act(id, 'branch', { shortDescription: 'liberar asiento' });
    assert.equal(missing.status, 400); assert.match(missing.data.error, /no existe en org\/busesuta/);
    const branch = await t.edwin.ok(id, 'branch', { shortDescription: 'liberar asiento', create: true });
    const name = `${id}-cancelacion-tecnica-liberar-asiento`;
    assert.equal(branch.workBranch.name, name); assert.equal(branch.workBranch.created, true); assert.equal(branch.workBranch.verified, true);
    assert.ok(gh.state.branches[name], 'la rama existe en GitHub');
    assert.match(gh.state.comments.at(-1).body, /Rama de trabajo/);
    // Referencias verificadas.
    const missingRef = await t.edwin.act(id, 'git', { kind: 'Rama', value: 'no-existe' });
    assert.equal(missingRef.status, 400); assert.equal(missingRef.data.field, 'value');
    assert.equal((await t.edwin.act(id, 'git', { kind: 'Pull request', value: '#4', url: 'https://github.com/otro/repo/pull/4' })).data.field, 'url');
    assert.equal((await t.edwin.ok(id, 'git', { kind: 'Commit', value: 'abc1234' })).gitRefs.at(-1).verification.details.message, 'Cancelación');
    assert.equal((await t.edwin.ok(id, 'git', { kind: 'Versión o tag', value: 'v1.3.0' })).gitRefs.at(-1).verified, true);
    // PR: uno existente que no sale de la rama de trabajo se rechaza; se crea el correcto en GitHub.
    const wrong = await t.edwin.act(id, 'pull-request', { mode: 'link', number: 5 });
    assert.equal(wrong.status, 400); assert.match(wrong.data.error, /sale de la rama «fix»/);
    const wrongBase = await t.edwin.act(id, 'pull-request', { mode: 'link', number: 4, base: 'develop' });
    assert.equal(wrongBase.status, 400); assert.equal(wrongBase.data.field, 'base');
    const pr = await t.edwin.ok(id, 'pull-request', { mode: 'create' });
    assert.equal(pr.pullRequest.created, true); assert.equal(pr.pullRequest.head, name); assert.equal(pr.pullRequest.base, 'main'); assert.equal(pr.pullRequest.state, 'abierto');
    const created = gh.state.pulls[pr.pullRequest.number];
    assert.equal(created.title, `[${id}] Cancelación técnica`); assert.match(created.body, /Refs #1/);
    gh.state.pulls[pr.pullRequest.number] = { ...created, state: 'closed', merged_at: '2026-11-21T00:00:00Z' };
    const refreshed = await t.pablo.ok(id, 'git-refresh', { refId: pr.gitRefs.find(g => g.kind === 'Pull request').id });
    assert.equal(refreshed.pullRequest.state, 'fusionado');
    // El cierre cierra la issue como completada.
    await t.edwin.ok(id, 'module-change', { module: 'Reservas y pasajeros', operation: 'Modificación', description: 'Cancelación.' });
    await t.edwin.ok(id, 'activity', { description: 'Implementación', hours: 3 });
    await t.edwin.ok(id, 'send-to-tests');
    await t.pablo.ok(id, 'test', { name: 'Cancelar', expected: 'OK', obtained: 'OK', status: 'Superada' });
    await t.pablo.ok(id, 'finish-tests', { outcome: 'Todas superadas' });
    await t.pablo.ok(id, 'review', { summary: 'Conforme con lo autorizado.', rolloutCompliance: 'Cumplido', criteria: (await t.pablo.call(`/api/requests/${id}`)).data.reviewCriteria.map(() => ({ met: true })), recommendation: 'Cerrar.', decision: 'Conforme' });
    await t.edwin.ok(id, 'close', { result: 'Exitoso', summary: 'Cancelación disponible.' });
    assert.equal(issue.state, 'closed'); assert.equal(issue.state_reason, 'completed'); assert.ok(issue.labels.some(l => l.name === 'estado: cerrada'));
    // Un responsable sin acceso al repositorio no bloquea la sincronización: se informa.
    const other = (await t.leslie.call('/api/requests', 'POST', devCrf({ title: 'Otro cambio' }))).data.request.id;
    await t.david.ok(other, 'receive'); await t.david.ok(other, 'validate');
    await t.david.ok(other, 'evaluation', { ...fullPlan(), step: 'planning' });
    await t.david.ok(other, 'decision', { decision: 'Aprobado', justification: 'Cambio acotado y viable.' });
    const assigned = await t.david.ok(other, 'assign', { developerId: 'team-shirley' });
    assert.match(assigned.github.lastSync.message, /No se pudo asignar a NoColaborador/);
    assert.equal((await t.edwin.call(`/api/requests/${id}/github-issue`, 'POST', {})).status, 403);
  } finally { await stop(app); await new Promise(resolve => gh.server.close(resolve)); }
});
test('GitHub no disponible: el flujo sigue y la issue puede reintentarse', async () => {
  const app = await start(':memory:', { github: createGithub({ repo: 'org/busesuta', token: 'test-token', apiUrl: 'http://127.0.0.1:9', timeoutMs: 1500 }) });
  try {
    const t = await team(app);
    const id = (await t.leslie.call('/api/requests', 'POST', devCrf())).data.request.id;
    await t.david.ok(id, 'receive'); await t.david.ok(id, 'validate');
    await t.david.ok(id, 'evaluation', { ...fullPlan(), step: 'planning' });
    const approved = await t.david.ok(id, 'decision', { decision: 'Aprobado', justification: 'Cambio acotado y viable.' });
    assert.equal(approved.status, 'Aprobada', 'GitHub caído no impide aprobar');
    assert.equal(approved.github.lastSync.ok, false); assert.equal(approved.github.issue, undefined);
    const retry = await t.david.call(`/api/requests/${id}/github-issue`, 'POST', {});
    assert.equal(retry.status, 502); assert.match(retry.data.error, /GitHub/);
    assert.equal(createGithub({ repo: 'org/busesuta' }).canIssue(), false);
    assert.equal((await createGithub({}).verify('Rama', 'main')).status, 'sin configurar');
  } finally { await stop(app); }
});

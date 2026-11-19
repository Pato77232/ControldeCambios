'use strict';
// Integración HTTP con servidores efímeros y bases temporales (nunca la base real).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('../backend/server.cjs');
const { openDatabase } = require('../backend/database.cjs');
const { configureTeam } = require('../backend/configure-team.cjs');
const { hashPassword } = require('../backend/auth.cjs');

const PASSWORD = 'Test-ChangeFlow-2026!';
const USERS = [['team-leslie', 'Leslie', 'leslie@uta.edu.ec', 'experto'], ['team-david', 'David', 'david@uta.edu.ec', 'ccc'], ['team-edwin', 'Edwin', 'edwin@uta.edu.ec', 'experto'], ['team-pablo', 'Pablo', 'pablo@uta.edu.ec', 'experto'], ['team-shirley', 'Shirley', 'shirley@uta.edu.ec', 'experto'], ['user-ana', 'Ana', 'ana@example.com', 'usuario'], ['ccc-maria', 'María', 'maria@uta.edu.ec', 'ccc']];
const userCrf = { requesterType: 'usuario', module: 'Reservas y pasajeros', title: 'Cancelar boletos', currentBehavior: 'No existe la opción.', featureMissing: true, description: 'Permitir cancelar un boleto comprado desde la aplicación.', justification: 'Evita viajar a la oficina de la cooperativa para cancelar.', result: 'Boleto cancelado y asiento liberado.' };
const devCrf = extra => ({ ...userCrf, requesterType: 'experto', title: 'Cancelación técnica', modificationType: 'Modificación', environment: 'Pruebas', currentVersion: 'No determinada', acceptanceCriteria: ['El boleto se cancela', 'El asiento se libera'], suggestedIcsText: 'Servicio de cancelación', ...extra });
const tmp = () => mkdtempSync(join(tmpdir(), 'changeflow-'));

async function start(filename) {
  const app = createApp({ filename, seedPassword: PASSWORD, initialUsers: USERS });
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
const fullPlan = (ics = []) => ({
  itilType: 'Normal', classificationJustification: 'Cambio funcional con evaluación ordinaria.', plannedChanges: 'Modificar ventas y esquema.', icsNote: ics.length ? '' : 'Sin ICS catalogados todavía.',
  impact: 'Medio', technicalImpact: 'Afecta ventas.', functionalImpact: 'Cambia la compra.', risks: 'Liberación incorrecta\nReembolsos duplicados', urgency: 'Media', priority: 'Alta',
  feasibility: 'Viable', feasibilityJustification: 'Equipo con experiencia.', effortHours: 16, durationDays: 4, resources: 'No se requieren recursos adicionales.',
  rolloutObjective: 'Incorporar la cancelación.', rolloutSteps: ['Rama', 'Implementación', 'Pruebas'], rolloutDependencies: 'Ninguna.', rolloutResponsibles: 'Asignado', rolloutChecks: 'Compra normal.', rolloutCompletion: 'Criterios cumplidos.',
  backoutTriggers: 'Errores en ventas.', backoutActions: ['Revertir merge'], backoutVersion: '1.2.0', backoutData: 'Respaldo previo.', backoutResponsible: 'Asignado', backoutVerification: 'Compra normal.',
  testObjective: 'Verificar cancelación.', testTypes: 'Funcionales', testCriteria: ['El boleto se cancela'], testSuccess: 'Todas superadas.', testEvidence: 'Capturas.',
  downtimeValue: 0, downtimeUnit: 'minutos', plannedDate: '2026-12-01T22:00', targetVersion: '1.3.0', potentialIcs: ics
});
async function createIcs(c, data) { const r = await c.call('/api/ics', 'POST', { kind: 'Básico', categoryId: 3, description: 'Elemento de prueba de BusesUTA.', ...data }); assert.equal(r.status, 201, r.data?.error); return r.data.ics; }

test('seguridad: sesión, CSRF, origen, rutas privadas y permisos por rol', async () => {
  const app = await start(':memory:');
  try {
    const anon = await client(app), t = await team(app);
    assert.equal((await anon.call('/api/requests')).status, 401);
    assert.equal((await anon.call('/api/ics')).status, 401);
    for (const p of ['/backend/data/changeflow.sqlite', '/.env', '/backend/server.cjs']) assert.equal((await anon.call(p)).status, 404);
    assert.equal((await t.leslie.call('/api/requests', 'POST', devCrf(), { 'X-CSRF-Token': 'falso' })).status, 403);
    assert.equal((await t.leslie.call('/api/requests', 'POST', devCrf(), { Origin: 'https://malicioso.example' })).status, 403);
    assert.equal((await t.ana.call('/api/ics')).status, 403, 'el usuario final no consulta el catálogo interno');
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
    assert.equal((await t.ana.call('/api/requests', 'POST', { ...userCrf, module: 'Inventado' })).status, 400);
    assert.equal((await t.ana.call('/api/requests', 'POST', { ...userCrf, requesterType: 'experto' })).status, 403);
    assert.equal((await t.leslie.call('/api/requests', 'POST', devCrf({ acceptanceCriteria: [] }))).status, 400);
    assert.equal((await t.leslie.call('/api/requests', 'POST', devCrf({ suggestedIcsText: '' }))).status, 400, 'requiere ICS o sugerencia');
    for (const [extra, field] of [[{ currentVersion: '1.0' }, 'currentVersion'], [{ currentVersion: '01.2.0' }, 'currentVersion'], [{ currentVersion: '1.2.0', targetVersion: '1.2.0' }, 'targetVersion'], [{ currentVersion: '1.2.0', targetVersion: '1.1.9' }, 'targetVersion'], [{ module: 'Inventado' }, 'module']]) {
      const bad = await t.leslie.call('/api/requests', 'POST', devCrf(extra));
      assert.equal(bad.status, 400); assert.equal(bad.data.field, field, 'el servidor indica el campo con error');
    }
    assert.equal((await t.leslie.call('/api/requests', 'POST', devCrf({ currentVersion: '1.2.0', targetVersion: '1.10.0' }))).status, 201, '1.10.0 es mayor que 1.2.0');
    assert.equal((await t.leslie.call('/api/requests', 'POST', devCrf({ businessRulesAffected: true }))).status, 400);
    // Fallo 4: el único CCC no puede presentar solicitudes que nadie podría evaluar.
    assert.equal((await t.david.call('/api/requests', 'POST', devCrf())).status, 403);
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
    const ics = await createIcs(t.david, { name: 'Módulo de ventas' });
    const id = (await t.leslie.call('/api/requests', 'POST', devCrf({ suggestedIcs: [ics.id] }))).data.request.id;
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
    const planned = await t.david.ok(id, 'evaluation', { ...fullPlan([{ icsId: ics.id, operation: 'Modificación' }]), step: 'planning' });
    assert.equal(planned.status, 'Pendiente de aprobación'); assert.equal(planned.priority, 'Alta');
    // Una modificación posterior obliga a completar de nuevo la planificación.
    const changed = await t.david.ok(id, 'evaluation', { ...fullPlan([{ icsId: ics.id, operation: 'Modificación' }]), impact: 'Alto', step: 'draft' });
    assert.equal(changed.status, 'En planificación');
    await t.david.ok(id, 'evaluation', { ...fullPlan([{ icsId: ics.id, operation: 'Modificación' }]), feasibility: 'No viable', step: 'planning' });
    // Caso D: un cambio no viable no puede aprobarse, ni siquiera con condiciones; se informa el error.
    for (const decision of ['Aprobado', 'Aprobado con condiciones']) {
      const blocked = await t.david.act(id, 'decision', { decision, justification: 'Se aprueba igualmente.', conditions: [{ text: 'X', verification: 'Y' }] });
      assert.equal(blocked.status, 409); assert.match(blocked.data.error, /No viable/); assert.equal(blocked.data.field, 'decision');
    }
    // Versión objetivo: formato válido y mayor que la versión actual del CRF.
    const badVersion = await t.david.act(id, 'evaluation', { ...fullPlan([{ icsId: ics.id, operation: 'Modificación' }]), targetVersion: '1.3', step: 'draft' });
    assert.equal(badVersion.status, 400); assert.equal(badVersion.data.field, 'targetVersion');
    await t.david.ok(id, 'evaluation', { ...fullPlan([{ icsId: ics.id, operation: 'Modificación' }]), step: 'planning' });
    assert.equal((await t.david.act(id, 'decision', { decision: 'Aprobado con condiciones', justification: 'Se aprueba con condiciones.', conditions: [{ text: 'Respaldo', verification: '' }] })).status, 400);
    assert.equal((await t.david.act(id, 'decision', { decision: 'Aprobado', justification: 'Con condiciones ocultas.', conditions: [{ text: 'X', verification: 'Y' }] })).status, 400);
    const approved = await t.david.ok(id, 'decision', { decision: 'Aprobado con condiciones', justification: 'Beneficio alto con riesgo controlado.', conditions: [{ text: 'Respaldar la base', verification: 'Evidencia en la revisión' }] });
    assert.equal(approved.status, 'Aprobada con condiciones');
    const decision = approved.decisions.at(-1);
    assert.equal(decision.conditions[0].id, 'C1'); assert.equal(decision.evaluationSnapshot.feasibility, 'Viable');
    assert.deepEqual(approved.ics.autorizado, [ics.code]);
    // Reevaluar conserva la decisión anterior como sustituida.
    const re = await t.david.ok(id, 'reevaluate', { reason: 'Cambió la disponibilidad del equipo.' });
    assert.equal(re.status, 'En planificación'); assert.equal(re.decisions[0].superseded, true); assert.equal(re.ics.autorizado.length, 0);
    // Caso C: viable pero rechazado; el rechazo puede emitirse sin planes completos.
    const c = (await t.pablo.call('/api/requests', 'POST', devCrf())).data.request.id;
    await t.david.ok(c, 'receive'); await t.david.ok(c, 'validate');
    await t.david.ok(c, 'evaluation', { ...fullPlan(), rolloutSteps: [], step: 'analysis' });
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
    const ventas = await createIcs(t.david, { name: 'Módulo de ventas', revision: '1.2.0' });
    const esquema = await createIcs(t.david, { name: 'Esquema de reservas', revision: 'r14', categoryId: 4 });
    const lb = (await t.david.call('/api/baselines', 'POST', { name: 'Base inicial', items: [{ revisionId: ventas.current_revision_id }] })).data.code;
    await t.david.call(`/api/baselines/${lb}/submit`, 'POST', {});
    assert.equal((await t.david.call(`/api/baselines/${lb}/decide`, 'POST', { decision: 'Aprobada', note: 'Configuración revisada.' })).status, 200);
    const id = (await t.leslie.call('/api/requests', 'POST', devCrf({ suggestedIcs: [ventas.id] }))).data.request.id;
    await t.david.ok(id, 'receive'); await t.david.ok(id, 'validate');
    await t.david.ok(id, 'evaluation', { ...fullPlan([{ icsId: ventas.id, operation: 'Modificación' }]), step: 'planning' });
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
    assert.equal((await t.edwin.act(id, 'git', { kind: 'Pull request', value: '#4', url: 'https://github.com/org/repo/issues/4' })).status, 400);
    const git = await t.edwin.ok(id, 'git', { kind: 'Pull request', value: '#4', url: 'https://github.com/org/repo/pull/4' });
    assert.equal(git.gitRefs[0].verified, false);
    await t.edwin.ok(id, 'ics-change', { icsId: ventas.id, operation: 'Modificación', toRevision: '1.3.0', description: 'Caso de uso de cancelación.' });
    assert.equal((await t.edwin.act(id, 'ics-change', { icsId: ventas.id, operation: 'Modificación', toRevision: '1.3.1', description: 'Otra revisión.' })).status, 409, 'una revisión en curso por ICS');
    // Caso K: un ICS no autorizado genera una desviación que bloquea el avance.
    const dev = await t.edwin.ok(id, 'ics-change', { icsId: esquema.id, operation: 'Modificación', toRevision: 'r15', description: 'Columna de cancelación.' });
    assert.equal(dev.deviations[0].status, 'Pendiente');
    assert.equal((await t.edwin.act(id, 'send-to-tests')).status, 409);
    assert.equal((await t.edwin.act(id, 'scope', { deviationId: 'DES-1', decision: 'Autorizada', justification: 'Autoriza el desarrollador.' })).status, 403);
    const scoped = await t.david.ok(id, 'scope', { deviationId: 'DES-1', decision: 'Autorizada', justification: 'La columna es necesaria.' });
    assert.ok(scoped.ics.autorizado.includes(esquema.code)); assert.equal(scoped.decisions.at(-1).kind, 'Ampliación de alcance');
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
    // Caso L: la línea base aprobada conserva la revisión original; el ICS avanza a la nueva.
    const icsDetail = (await t.david.call(`/api/ics/${ventas.code}`)).data;
    assert.equal(icsDetail.ics.currentRevision, '1.3.0');
    assert.deepEqual(icsDetail.revisions.map(r => `${r.revision}:${r.status}`), ['1.2.0:Reemplazada', '1.3.0:Vigente']);
    assert.equal(icsDetail.baselines[0].revision, '1.2.0');
    assert.ok(icsDetail.requests.some(x => x.kind === 'modificado' && x.code === id));
    // Reapertura documentada.
    assert.equal((await t.david.act(id, 'reopen', { reason: 'corto' })).status, 400);
    const reopened = await t.david.ok(id, 'reopen', { reason: 'Se detectó un efecto secundario en producción.' });
    assert.equal(reopened.status, 'En análisis'); assert.equal(reopened.closures.length, 1); assert.equal(reopened.reopenings[0].newStatus, 'En análisis');

    // Cierre fallido con backout y cierre incompleto.
    const f = (await t.leslie.call('/api/requests', 'POST', devCrf())).data.request.id;
    await t.david.ok(f, 'receive'); await t.david.ok(f, 'validate');
    await t.david.ok(f, 'evaluation', { ...fullPlan([{ icsId: esquema.id, operation: 'Modificación' }]), itilType: 'Emergencia', classificationJustification: 'Caída de ventas en producción que exige atención inmediata.', rolloutObjective: '', testTypes: '', step: 'planning' });
    await t.david.ok(f, 'decision', { decision: 'Aprobado', justification: 'Emergencia autorizada.' });
    await t.david.ok(f, 'assign', { developerId: 'team-shirley' });
    await t.shirley.ok(f, 'start');
    await t.shirley.ok(f, 'activity', { description: 'Parche urgente', hours: 1 });
    await t.shirley.ok(f, 'ics-change', { icsId: esquema.id, operation: 'Modificación', toRevision: 'r16', description: 'Parche.' });
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
    const r16 = (await t.david.call(`/api/ics/${esquema.code}`)).data.revisions.find(r => r.revision === 'r16');
    assert.equal(r16.status, 'Descartada');
    const reports = (await t.david.call('/api/reports')).data;
    assert.equal(reports.counts.failed, 1);
    assert.equal((await t.david.call('/api/reports?result=Fallido')).data.rows.length, 1);
  } finally { await stop(app); rmSync(dir, { recursive: true, force: true }); }
});

test('ICS y líneas base: códigos, duplicados, ciclos, revisiones inmutables y composición congelada', async () => {
  const app = await start(':memory:');
  try {
    const t = await team(app);
    const parent = await createIcs(t.david, { name: 'Módulo de ventas', kind: 'Agregado' });
    const child = await createIcs(t.david, { name: 'Selector de asientos', parentId: parent.id, path: 'src/asientos' });
    assert.equal(parent.code, 'ICS-BUS-001'); assert.equal(child.code, 'ICS-BUS-002');
    assert.equal(child.status, 'Identificado'); assert.equal(child.currentRevision, 'No determinada');
    assert.equal((await t.david.call('/api/ics', 'POST', { kind: 'Básico', categoryId: 3, name: 'módulo de VENTAS', description: 'Duplicado del módulo.' })).status, 409);
    assert.equal((await t.david.call('/api/ics', 'POST', { kind: 'Básico', categoryId: 3, name: 'Otro', description: 'Misma ruta que otro.', path: 'src/asientos' })).status, 409);
    assert.equal((await t.david.call('/api/ics', 'POST', { kind: 'Básico', categoryId: 3, name: 'Hijo de básico', description: 'Contenedor inválido.', parentId: child.id })).status, 400);
    const proposed = await createIcs(t.pablo, { name: 'Servicio de notificaciones', status: 'Bajo control de configuración' });
    assert.equal(proposed.status, 'Propuesto', 'un desarrollador solo propone');
    // Ciclo padre-hijo.
    const agg2 = await createIcs(t.david, { name: 'Subsistema', kind: 'Agregado', parentId: parent.id });
    const p = (await t.david.call(`/api/ics/${parent.code}`)).data.ics;
    assert.equal((await t.david.call(`/api/ics/${parent.code}`, 'PATCH', { ...p, categoryId: p.category_id, parentId: agg2.id, ownerId: '', version: p.version })).status, 400);
    assert.equal((await t.david.call(`/api/ics/${parent.code}`, 'PATCH', { ...p, categoryId: p.category_id, status: 'Bajo control de configuración', justification: 'Intento manual de control.', ownerId: '', parentId: '', version: p.version })).status, 409);
    assert.equal((await t.pablo.call(`/api/ics/${parent.code}`, 'PATCH', { ...p, categoryId: p.category_id, ownerId: '', parentId: '', version: p.version })).status, 403);
    // Relaciones.
    assert.equal((await t.david.call(`/api/ics/${parent.code}/relations`, 'POST', { target: child.code, type: 'depende de' })).status, 200);
    assert.equal((await t.david.call(`/api/ics/${child.code}/relations`, 'POST', { target: parent.code, type: 'depende de' })).status, 409);
    // Línea base: no incluye ICS propuestos; aprobada queda congelada.
    assert.equal((await t.david.call('/api/baselines', 'POST', { name: 'LB inválida', items: [{ revisionId: proposed.current_revision_id }] })).status, 400);
    assert.equal((await t.pablo.call('/api/baselines', 'POST', { name: 'LB del desarrollador', items: [] })).status, 403);
    const code = (await t.david.call('/api/baselines', 'POST', { name: 'LB 1', softwareVersion: '1.0.0', items: [{ revisionId: parent.current_revision_id }, { revisionId: child.current_revision_id }] })).data.code;
    assert.equal(code, 'LB-BUS-001');
    assert.equal((await t.david.call(`/api/baselines/${code}/decide`, 'POST', { decision: 'Aprobada', note: 'Sin revisión previa.' })).status, 409);
    await t.david.call(`/api/baselines/${code}/submit`, 'POST', {});
    assert.equal((await t.david.call(`/api/baselines/${code}/items`, 'POST', { items: [] })).status, 409);
    assert.equal((await t.david.call(`/api/baselines/${code}/decide`, 'POST', { decision: 'Aprobada', note: 'Configuración revisada.' })).status, 200);
    assert.equal((await t.david.call(`/api/ics/${child.code}`)).data.ics.status, 'Bajo control de configuración');
    assert.equal((await t.david.call(`/api/ics/${child.code}/revisions`, 'POST', { revision: '2.0', notes: 'Cambio sin CRF.' })).status, 409, 'un ICS controlado solo cambia por CRF');
    // RN-24: un ICS identificado después no se agrega automáticamente.
    await createIcs(t.david, { name: 'Nuevo componente' });
    assert.equal((await t.david.call('/api/baselines')).data.baselines[0].items.length, 2);
    // La base de datos impide alterar una línea base aprobada o borrar revisiones aunque se intente directamente.
    assert.throws(() => app.db.prepare('DELETE FROM baseline_items').run(), /no puede modificarse/);
    assert.throws(() => app.db.prepare("UPDATE baselines SET name='x'").run(), /no puede modificarse/);
    assert.throws(() => app.db.prepare("UPDATE ics_revisions SET revision='x'").run(), /no puede modificarse/);
    assert.throws(() => app.db.prepare('DELETE FROM ics_revisions').run(), /no puede eliminarse/);
    // Derivada: parte de las revisiones vigentes y no altera la anterior.
    const d2 = (await t.david.call('/api/baselines', 'POST', { name: 'LB 2', derivedFrom: code })).data;
    assert.equal(d2.baselines.find(b => b.code === d2.code).items.length, 2);
    const audit = (await t.david.call(`/api/ics/${parent.code}`)).data.audit;
    assert.ok(audit.some(e => e.action === 'Identificación de ICS'));
    assert.ok(audit.some(e => e.action === 'Relación de ICS'));
  } finally { await stop(app); }
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

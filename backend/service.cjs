'use strict';
// Flujo de control de cambios: CRF, ficha única del CCC, asignación, implementación, pruebas, revisión y cierre.
// Todas las transiciones y permisos se validan aquí; el cliente solo refleja estas reglas.
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const C = require('./catalog.cjs');
const { SCHEMA, crfCode } = require('./migrate.cjs');
const { audit, auditChanges } = require('./audit.cjs');
const files = require('./files.cjs');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const now = () => new Date().toISOString();
const localDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const digest = v => createHash('sha256').update(v).digest('hex');
const isCCC = u => u?.role === 'ccc';
const isDev = u => u?.role === 'experto';
const nameOf = u => u ? (u.id ? u.name : `${u.name} (sin cuenta)`) : 'Sistema';

// ---------- Validación de entrada ----------
function str(data, key, { required = false, max = 5000, min = 0, label = key } = {}) {
  const v = data[key];
  if (v !== undefined && v !== null && typeof v !== 'string') fail(400, `Campo inválido: ${label}.`);
  const s = (v || '').trim();
  if (required && !s) fail(400, `${label}: este campo es obligatorio.`);
  if (s.length > max) fail(400, `${label}: máximo ${max} caracteres.`);
  if (s && s.length < min) fail(400, `${label}: escribe al menos ${min} caracteres.`);
  return s;
}
function pick(value, values, label, required = true) {
  if ((value === undefined || value === null || value === '') && !required) return '';
  if (!values.includes(value)) fail(400, `Selecciona ${label} válido.`);
  return value;
}
function list(data, key, { required = false, max = 40, label = key } = {}) {
  let v = data[key];
  if (v === undefined || v === null || v === '') v = [];
  if (typeof v === 'string') v = v.split(/\r?\n/);
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) fail(400, `Campo inválido: ${label}.`);
  const out = v.map(x => x.trim()).filter(Boolean);
  if (out.length > max || out.some(x => x.length > 2000)) fail(400, `${label}: demasiados elementos o elementos demasiado largos.`);
  if (required && !out.length) fail(400, `${label}: agrega al menos un elemento.`);
  return out;
}
function num(data, key, { required = false, label = key, max = 100000 } = {}) {
  const v = data[key];
  if (v === undefined || v === null || v === '') { if (required) fail(400, `${label}: este campo es obligatorio.`); return null; }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) fail(400, `${label}: ingresa un número entre 0 y ${max}.`);
  return Math.round(n * 100) / 100;
}
function link(value, label) {
  if (!value) return '';
  let u; try { u = new URL(value); } catch { fail(400, `${label}: la dirección no es una URL válida.`); }
  if (!['https:', 'http:'].includes(u.protocol)) fail(400, `${label}: usa una URL http o https.`);
  return u.href;
}
function isoDate(value, label, notBefore) {
  if (!value) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(400, `${label}: fecha inválida.`);
  if (notBefore && value < notBefore) fail(400, `${label}: no puede ser anterior al ${notBefore}.`);
  return value;
}
const bool = v => v === true || v === 'true' || v === 'on';
const nextId = (items, prefix) => `${prefix}-${(items?.length || 0) + 1}`;

// ---------- Acceso y carga ----------
function parseCode(id) {
  const m = /^(CRF|SCR)-(\d{1,9})$/.exec(String(id || ''));
  if (!m) fail(404, 'Solicitud no encontrada.');
  return Number(m[2]);
}
function load(db, number) {
  const row = db.prepare('SELECT document FROM requests WHERE id=?').get(number);
  return row ? JSON.parse(row.document) : null;
}
const everApproved = r => (r.decisions || []).some(d => d.kind === 'Autorización' && ['Aprobado', 'Aprobado con condiciones'].includes(d.decision));
// El CCC ve todo. Un desarrollador ve las propias, las recibidas sin cuenta, las que tiene asignadas
// y las aprobadas (trabajo del equipo que puede probar o revisar). Un usuario final ve solo las suyas.
function canView(r, user) {
  if (isCCC(user)) return true;
  if (r.ownerId && r.ownerId === user.id) return true;
  if (isDev(user)) return (r.submittedWithoutAccount && r.ownerId === null) || (r.assignments || []).some(a => a.developerId === user.id) || everApproved(r);
  return false;
}
function getRequest(db, id, user) {
  const number = parseCode(id), r = load(db, number);
  if (!r) fail(404, 'Solicitud no encontrada.');
  if (user && !canView(r, user)) fail(403, 'No tienes acceso a esta solicitud.');
  return { r, number };
}
function save(db, r) {
  r.revision++;
  db.prepare('UPDATE requests SET document=? WHERE id=?').run(JSON.stringify(r), parseCode(r.id));
  return r;
}
// Historial visible en el expediente + evento persistente de auditoría.
function transition(db, r, user, to, action, note) {
  const from = r.status;
  r.status = to;
  r.history.push({ status: to, from, date: now(), responsible: nameOf(user), responsibleId: user?.id ?? null, action, note });
  audit(db, { entityType: 'CRF', entityId: r.id, action, actor: user, from, to, justification: note });
}
function log(db, r, user, action, note, extra = {}) {
  r.history.push({ status: r.status, date: now(), responsible: nameOf(user), responsibleId: user?.id ?? null, action, note });
  audit(db, { entityType: 'CRF', entityId: r.id, action, actor: user, from: r.status, to: r.status, justification: note, ...extra });
}
function notify(r, message) { (r.notices ||= []).push({ at: now(), to: r.email, message, channel: 'Expediente y seguimiento (sin correo automático)' }); }

// ---------- Relaciones CRF-ICS ----------
function icsById(db, id) { return db.prepare('SELECT id,code,name,status,current_revision_id FROM ics WHERE id=?').get(id); }
function validIcs(db, ids, label) {
  if (!Array.isArray(ids)) fail(400, `${label}: selección inválida.`);
  const unique = [...new Set(ids.map(Number))];
  if (unique.length > 50 || unique.some(x => !Number.isInteger(x))) fail(400, `${label}: selección inválida.`);
  return unique.map(id => {
    const ics = icsById(db, id);
    if (!ics) fail(400, `${label}: el ICS seleccionado no existe.`);
    if (ics.status === 'Retirado') fail(400, `${label}: ${ics.code} está retirado.`);
    return ics;
  });
}
function links(db, number) {
  return db.prepare(`SELECT ri.id,ri.kind,ri.operation,ri.from_revision AS fromRevision,ri.to_revision AS toRevision,ri.revision_id AS revisionId,ri.description,ri.evidence,
    ri.in_scope AS inScope,ri.active,ri.decision_n AS decisionN,ri.round,ri.created_at AS createdAt,i.id AS icsId,i.code,i.name,i.status AS icsStatus
    FROM request_ics ri JOIN ics i ON i.id=ri.ics_id WHERE ri.request_id=? ORDER BY ri.id`).all(number);
}
const authorizedLinks = (db, number) => links(db, number).filter(l => l.kind === 'autorizado' && l.active);
function insertLink(db, number, icsId, kind, user, extra = {}) {
  db.prepare(`INSERT INTO request_ics(request_id,ics_id,kind,operation,from_revision,to_revision,revision_id,description,evidence,in_scope,active,decision_n,round,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`).run(number, icsId, kind, extra.operation ?? null, extra.fromRevision ?? null, extra.toRevision ?? null, extra.revisionId ?? null,
    extra.description ?? '', extra.evidence ?? '', extra.inScope ?? null, extra.decisionN ?? null, extra.round ?? null, user?.id ?? null, now());
}

// ---------- CRF ----------
function requestFields(db, data, kind, date) {
  const f = { project: C.PROJECT };
  f.module = pick(data.module, C.MODULES, 'un módulo afectado');
  f.title = str(data, 'title', { required: true, max: 120, min: 5, label: 'Título' });
  f.currentBehavior = str(data, 'currentBehavior', { required: true, label: 'Situación o comportamiento actual' });
  f.featureMissing = bool(data.featureMissing);
  f.description = str(data, 'description', { required: true, min: 20, label: 'Descripción del cambio' });
  f.justification = str(data, 'justification', { required: true, min: 20, label: 'Justificación' });
  f.result = str(data, 'result', { required: true, label: 'Resultado esperado' });
  f.desiredDate = isoDate(str(data, 'desiredDate', { max: 10, label: 'Fecha deseada' }), 'Fecha deseada', date);
  f.observations = str(data, 'observations', { label: 'Observaciones' });
  let suggested = [];
  if (kind === 'experto') {
    f.modificationType = pick(data.modificationType, C.OPERATIONS, 'un tipo de modificación');
    f.environment = pick(data.environment, C.ENVIRONMENTS, 'un entorno afectado');
    f.currentVersion = str(data, 'currentVersion', { required: true, max: 40, label: 'Versión actual' });
    if (f.currentVersion !== 'No determinada' && !C.SEMVER.test(f.currentVersion)) fail(400, 'Versión actual: usa MAJOR.MINOR.PATCH o «No determinada».');
    f.targetVersion = str(data, 'targetVersion', { max: 40, label: 'Versión propuesta' });
    if (f.targetVersion && !C.SEMVER.test(f.targetVersion)) fail(400, 'Versión propuesta: usa MAJOR.MINOR.PATCH.');
    f.spec = str(data, 'spec', { max: 3000, label: 'Especificación técnica' });
    f.specUrl = link(str(data, 'specUrl', { max: 500, label: 'Enlace de la especificación' }), 'Enlace de la especificación');
    f.businessRulesAffected = bool(data.businessRulesAffected);
    f.businessRules = f.businessRulesAffected ? str(data, 'businessRules', { required: true, max: 2000, label: 'Reglas de negocio afectadas' }) : 'No aplica';
    f.acceptanceCriteria = list(data, 'acceptanceCriteria', { required: true, label: 'Criterios de aceptación' });
    f.suggestedIcsText = str(data, 'suggestedIcsText', { max: 1000, label: 'ICS sugeridos no catalogados' });
    f.proposedPriority = pick(data.proposedPriority || 'Media', C.LEVELS, 'una prioridad propuesta');
    suggested = validIcs(db, data.suggestedIcs || [], 'Componentes potencialmente afectados');
    if (!suggested.length && !f.suggestedIcsText) fail(400, 'Componentes potencialmente afectados: selecciona al menos un ICS del catálogo o sugiere uno nuevo.');
  }
  return { fields: f, suggested };
}
function blankRequest() {
  return { infoRequests: [], evaluation: null, previousEvaluations: [], decisions: [], assignments: [], implementation: { rounds: [] }, gitRefs: [], deviations: [], tests: [], testRounds: [], reviews: [], backouts: [], closure: null, closures: [], reopenings: [], notices: [], flags: [] };
}
function createRequest(db, user, data) {
  const guest = !user;
  if (guest) {
    if (data.requesterType !== 'usuario') fail(403, 'Solo las solicitudes de usuario final pueden enviarse sin cuenta.');
    const name = str(data, 'name', { required: true, max: 200, label: 'Nombre' }), email = str(data, 'email', { required: true, max: 200, label: 'Correo electrónico' }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail(400, 'Ingresa un correo electrónico válido.');
    user = { id: null, name, email, role: 'usuario' };
  }
  if (isCCC(user)) fail(403, 'El CCC recibe y evalúa las solicitudes. No puede presentarlas porque nadie más podría evaluarlas de forma independiente.');
  const kind = user.role;
  if (data.requesterType !== kind) fail(403, 'El tipo de solicitud no corresponde a tu perfil.');
  const date = localDate();
  const { fields, suggested } = requestFields(db, data, kind, date);
  const inserted = db.prepare('INSERT INTO requests(owner_id,document) VALUES(?,?)').run(user.id, '{}');
  const number = Number(inserted.lastInsertRowid);
  let trackingToken = null;
  const r = { schema: SCHEMA, ...fields, id: crfCode(number), date, createdAt: now(), name: user.name, email: user.email, ownerId: user.id, requesterType: kind, priority: null, status: 'Registrada', revision: 0, history: [], ...blankRequest() };
  if (guest) { trackingToken = randomBytes(18).toString('hex'); r.submittedWithoutAccount = true; r.trackingHash = digest(trackingToken); }
  for (const ics of suggested) insertLink(db, number, ics.id, 'sugerido', user);
  r.history.push({ status: 'Registrada', from: null, date: r.createdAt, responsible: nameOf(user), responsibleId: user.id, action: 'Creación de CRF', note: `CRF ${kind === 'experto' ? 'técnico' : 'de usuario final'} registrado.` });
  audit(db, { entityType: 'CRF', entityId: r.id, action: 'Creación de CRF', actor: user, to: 'Registrada', justification: `${r.title}${suggested.length ? ` · ICS sugeridos: ${suggested.map(i => i.code).join(', ')}` : ''}` });
  files.storeFiles(db, { requestNumber: number, requestCode: r.id, context: 'Solicitud', files: data.files, user, fail });
  save(db, r);
  return { request: present(db, number, r), trackingToken };
}

// ---------- Ficha del CCC ----------
const EVAL_TEXT = {
  classificationJustification: 'Justificación de la clasificación', standardReference: 'Procedimiento estándar de referencia', plannedChanges: 'Conjunto de modificaciones previstas',
  icsNote: 'Situación de los ICS no identificados', technicalImpact: 'Impacto técnico previsto', functionalImpact: 'Impacto funcional u operativo',
  feasibilityJustification: 'Justificación de viabilidad', resources: 'Recursos necesarios', considerations: 'Consideraciones adicionales',
  rolloutObjective: 'Objetivo de la implementación', rolloutDependencies: 'Dependencias', rolloutResponsibles: 'Responsables previstos', rolloutChecks: 'Verificaciones iniciales', rolloutCompletion: 'Condiciones de implementación completada',
  backoutTriggers: 'Condiciones que activan la reversión', backoutVersion: 'Versión o configuración a recuperar', backoutData: 'Precauciones sobre los datos', backoutResponsible: 'Responsable de la reversión', backoutVerification: 'Verificación posterior a la reversión', backoutAlternative: 'Estrategia de recuperación o mitigación',
  testObjective: 'Objetivo de las pruebas', testTypes: 'Tipos de prueba previstos', testSuccess: 'Condiciones de éxito', testEvidence: 'Evidencias esperadas',
  plannedDate: 'Fecha prevista de implementación', targetVersion: 'Versión objetivo'
};
const EVAL_LIST = { risks: 'Riesgos identificados', rolloutSteps: 'Actividades del rollout (en orden)', backoutActions: 'Acciones de reversión', testCriteria: 'Criterios de aceptación para pruebas' };
const EVAL_ENUM = { itilType: [Object.keys(C.ITIL), 'un tipo de cambio ITIL'], impact: [C.IMPACT, 'un impacto'], urgency: [C.LEVELS, 'una urgencia'], priority: [C.LEVELS, 'una prioridad'], feasibility: [C.FEASIBILITY, 'una viabilidad'], downtimeUnit: [C.DOWNTIME_UNITS, 'una unidad de inactividad'] };
const EVAL_NUM = { effortHours: 'Esfuerzo estimado (horas-persona)', durationDays: 'Duración estimada (días calendario)', downtimeValue: 'Tiempo de inactividad previsto' };
const EVAL_KEYS = [...Object.keys(EVAL_TEXT), ...Object.keys(EVAL_LIST), ...Object.keys(EVAL_ENUM), ...Object.keys(EVAL_NUM), 'standardSameConditions'];
function parseEvaluation(db, data) {
  const e = {};
  for (const [k, label] of Object.entries(EVAL_TEXT)) e[k] = str(data, k, { max: ['targetVersion', 'plannedDate'].includes(k) ? 40 : 5000, label });
  for (const [k, label] of Object.entries(EVAL_LIST)) e[k] = list(data, k, { label });
  for (const [k, [values, label]] of Object.entries(EVAL_ENUM)) e[k] = pick(data[k], values, label, false);
  for (const [k, label] of Object.entries(EVAL_NUM)) e[k] = num(data, k, { label, max: k === 'durationDays' ? 3650 : 100000 });
  e.standardSameConditions = bool(data.standardSameConditions);
  if (e.plannedDate && (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(e.plannedDate) || Number.isNaN(Date.parse(e.plannedDate)))) fail(400, 'Fecha prevista de implementación: fecha inválida.');
  if (e.targetVersion && e.targetVersion !== 'Pendiente' && !C.SEMVER.test(e.targetVersion)) fail(400, 'Versión objetivo: usa MAJOR.MINOR.PATCH o «Pendiente».');
  if (e.standardReference) e.standardReference = e.standardReference.toUpperCase();
  const raw = Array.isArray(data.potentialIcs) ? data.potentialIcs : [];
  if (raw.length > 50) fail(400, 'ICS potencialmente afectados: demasiados elementos.');
  const potential = raw.map(x => ({ ics: validIcs(db, [x?.icsId], 'ICS potencialmente afectados')[0], operation: pick(x?.operation || 'Modificación', C.OPERATIONS, 'una operación prevista') }));
  if (new Set(potential.map(p => p.ics.id)).size !== potential.length) fail(400, 'ICS potencialmente afectados: hay elementos repetidos.');
  return { e, potential };
}
function missingAnalysis(e, potentialCount) {
  const m = [];
  const need = (ok, label) => { if (!ok) m.push(label); };
  need(e.itilType, 'Tipo de cambio ITIL');
  need(e.classificationJustification, EVAL_TEXT.classificationJustification);
  need(potentialCount || e.icsNote, 'ICS potencialmente afectados o justificación de su ausencia');
  need(e.plannedChanges, EVAL_TEXT.plannedChanges);
  for (const k of ['impact', 'urgency', 'priority', 'feasibility']) need(e[k], { impact: 'Impacto estimado', urgency: 'Urgencia', priority: 'Prioridad', feasibility: 'Viabilidad técnica' }[k]);
  for (const k of ['technicalImpact', 'functionalImpact', 'feasibilityJustification', 'resources']) need(e[k], EVAL_TEXT[k]);
  need(e.risks?.length, EVAL_LIST.risks);
  need(e.effortHours !== null && e.effortHours !== undefined, EVAL_NUM.effortHours);
  need(e.durationDays !== null && e.durationDays !== undefined, EVAL_NUM.durationDays);
  return m;
}
// Emergencia: planes resumidos pero trazables. Normal y estándar: planes completos.
function missingPlanning(e) {
  const m = [], need = (ok, label) => { if (!ok) m.push(label); };
  need(e.rolloutSteps?.length, EVAL_LIST.rolloutSteps);
  need(e.backoutActions?.length || e.backoutAlternative, `${EVAL_LIST.backoutActions} o estrategia de recuperación`);
  need(e.backoutTriggers, EVAL_TEXT.backoutTriggers);
  need(e.testCriteria?.length, EVAL_LIST.testCriteria);
  need(e.downtimeValue !== null && e.downtimeValue !== undefined, EVAL_NUM.downtimeValue);
  need(e.downtimeUnit, 'Unidad del tiempo de inactividad');
  need(e.plannedDate, EVAL_TEXT.plannedDate);
  if (e.itilType !== 'Emergencia') {
    for (const k of ['rolloutObjective', 'rolloutDependencies', 'rolloutChecks', 'rolloutCompletion', 'backoutResponsible', 'backoutVerification', 'testObjective', 'testTypes', 'testSuccess', 'testEvidence']) need(e[k], EVAL_TEXT[k]);
    need(e.backoutActions?.length ? e.backoutVersion && e.backoutData : e.backoutAlternative, 'Versión a recuperar y precauciones sobre los datos (o estrategia alternativa justificada)');
  }
  return m;
}
function checkStandardReference(db, e) {
  if (e.itilType !== 'Estándar' || !e.standardReference) return null;
  let ref;
  try { ref = load(db, parseCode(e.standardReference)); } catch { ref = null; }
  if (!ref) fail(400, 'Procedimiento estándar de referencia: el CRF indicado no existe.');
  if (ref.evaluation?.itilType !== 'Estándar' || ref.closure?.result !== 'Exitoso') fail(400, 'El CRF de referencia debe ser un cambio estándar cerrado con resultado exitoso.');
  if (!e.standardSameConditions) fail(400, 'Confirma que el cambio corresponde exactamente al procedimiento autorizado y que sus condiciones no cambiaron.');
  return ref.id;
}
function requireCCC(r, user) {
  if (!isCCC(user)) fail(403, 'Solo el miembro autorizado del CCC puede realizar esta acción.');
  if (r.ownerId && r.ownerId === user.id) fail(403, 'No puedes evaluar ni autorizar tu propia solicitud.');
  if (r.evaluation?.memberId && r.evaluation.memberId !== user.id && ['En análisis', 'En planificación', 'Pendiente de aprobación'].includes(r.status)) fail(403, 'Esta ficha está a cargo de otro integrante del CCC.');
}
function requireState(r, states) { if (!states.includes(r.status)) fail(409, `La acción no está disponible mientras la solicitud está «${r.status}».`); }
const currentAssignment = r => { const a = (r.assignments || []).at(-1); return a && !a.releasedAt ? a : null; };
const currentAuthorization = r => [...(r.decisions || [])].reverse().find(d => d.kind === 'Autorización' && d.decision !== 'Más información' && !d.superseded) || null;
const currentRound = r => r.implementation?.rounds?.at(-1) || null;
function requireAssignee(r, user) {
  const a = currentAssignment(r);
  if (!isDev(user) || !a || a.developerId !== user.id) fail(403, 'Solo el desarrollador asignado puede registrar esta etapa.');
  return a;
}
function requestInfo(db, r, user, missing, decisionRecord) {
  (r.infoRequests ||= []).push({ id: nextId(r.infoRequests, 'INF'), at: now(), by: user.name, byId: user.id, from: r.status, missing });
  if (decisionRecord) r.decisions.push(decisionRecord);
  notify(r, `El CCC solicita información adicional: ${missing}`);
  transition(db, r, user, 'Pendiente de información', 'Solicitud de información adicional', missing);
}
function syncPotential(db, r, number, potential, user) {
  const before = links(db, number).filter(l => l.kind === 'potencial');
  const key = l => `${l.code}:${l.operation}`;
  const after = potential.map(p => ({ code: p.ics.code, operation: p.operation }));
  if (JSON.stringify(before.map(key)) === JSON.stringify(after.map(key))) return;
  db.prepare("DELETE FROM request_ics WHERE request_id=? AND kind='potencial'").run(number);
  for (const p of potential) insertLink(db, number, p.ics.id, 'potencial', user, { operation: p.operation });
  audit(db, { entityType: 'CRF', entityId: r.id, action: 'Cambio de ICS afectados', actor: user, from: r.status, to: r.status, field: 'ICS potencialmente afectados', oldValue: before.map(key).join(', ') || '—', newValue: after.map(key).join(', ') || '—' });
}
function evaluationAction(db, r, number, user, data) {
  requireCCC(r, user);
  requireState(r, ['En análisis', 'En planificación', 'Pendiente de aprobación']);
  const step = pick(data.step || 'draft', ['draft', 'analysis', 'planning'], 'una acción de la ficha');
  const { e, potential } = parseEvaluation(db, data);
  const before = r.evaluation || {};
  r.evaluation = { ...before, ...e, member: before.member || user.name, memberId: before.memberId || user.id, startedAt: before.startedAt || now(), updatedAt: now(), migrated: undefined };
  const changed = EVAL_KEYS.some(k => JSON.stringify(before[k] ?? null) !== JSON.stringify(e[k] ?? null));
  auditChanges(db, { entityType: 'CRF', entityId: r.id, action: 'Modificación de la ficha del CCC', actor: user, from: r.status, to: r.status }, before, e, EVAL_KEYS);
  syncPotential(db, r, number, potential, user);
  if (changed && r.status === 'Pendiente de aprobación') transition(db, r, user, 'En planificación', 'Modificación de la ficha', 'La ficha cambió después de completar la planificación; debe completarse nuevamente antes de decidir.');
  if (step === 'draft') { log(db, r, user, 'Guardado de borrador', 'Ficha del CCC guardada como borrador.'); return; }
  const missingA = missingAnalysis(r.evaluation, potential.length);
  if (missingA.length) fail(400, `Para completar el análisis falta: ${missingA.join('; ')}.`);
  const reference = checkStandardReference(db, r.evaluation);
  if (r.evaluation.itilType === 'Emergencia' && r.evaluation.classificationJustification.length < 30) fail(400, 'Un cambio de emergencia requiere explicar en al menos 30 caracteres la situación que exige el procedimiento acelerado.');
  r.priority = r.evaluation.priority;
  if (r.status === 'En análisis') {
    r.evaluation.analysisCompletedAt = now();
    transition(db, r, user, 'En planificación', 'Análisis completado', `Tipo ${r.evaluation.itilType}; impacto ${r.evaluation.impact}; viabilidad ${r.evaluation.feasibility}${reference ? `; procedimiento estándar ${reference}` : ''}.`);
  }
  if (step === 'planning') {
    const missingP = missingPlanning(r.evaluation);
    if (missingP.length) fail(400, `Para completar la planificación falta: ${missingP.join('; ')}.`);
    r.evaluation.planningCompletedAt = now();
    transition(db, r, user, 'Pendiente de aprobación', 'Planificación completada', `Rollout (${r.evaluation.rolloutSteps.length} actividades), backout y plan de pruebas documentados.`);
  }
}
function parseConditions(data) {
  const raw = Array.isArray(data.conditions) ? data.conditions : [];
  if (raw.length > 20) fail(400, 'Demasiadas condiciones.');
  return raw.map((c, i) => {
    const text = str(c || {}, 'text', { required: true, max: 1000, label: `Condición ${i + 1}` });
    const verification = str(c || {}, 'verification', { required: true, max: 1000, label: `Verificación de la condición ${i + 1}` });
    return { id: `C${i + 1}`, text, verification };
  });
}
function decisionAction(db, r, number, user, data) {
  requireCCC(r, user);
  const decision = pick(data.decision, C.DECISIONS, 'una decisión');
  const justification = str(data, 'justification', { required: true, min: 10, max: 5000, label: 'Justificación de la decisión' });
  const base = { n: r.decisions.length + 1, kind: 'Autorización', decision, justification, conditions: [], decidedBy: user.name, decidedById: user.id, at: now(), itilType: r.evaluation?.itilType || '', evaluationSnapshot: r.evaluation ? { ...r.evaluation, potentialIcs: links(db, number).filter(l => l.kind === 'potencial').map(l => `${l.code} (${l.operation})`) } : null };
  if (decision === 'Más información') {
    requireState(r, ['En validación', 'En análisis', 'En planificación', 'Pendiente de aprobación']);
    requestInfo(db, r, user, justification, base);
    return;
  }
  if (decision === 'Rechazado') {
    requireState(r, ['En análisis', 'En planificación', 'Pendiente de aprobación']);
    r.decisions.push(base);
    notify(r, `Solicitud rechazada por el CCC: ${justification}`);
    transition(db, r, user, 'Rechazada', 'Rechazo', justification);
    return;
  }
  requireState(r, ['Pendiente de aprobación']);
  const e = r.evaluation || {}, potentialCount = links(db, number).filter(l => l.kind === 'potencial').length;
  const missing = [...missingAnalysis(e, potentialCount), ...missingPlanning(e)];
  if (missing.length) fail(409, `No se puede aprobar: falta ${missing.join('; ')}.`);
  if (e.feasibility === 'No viable') {
    base.feasibilityException = str(data, 'feasibilityException', { required: true, min: 30, max: 3000, label: 'Excepción de viabilidad' });
    if (!bool(data.analysisReviewed)) fail(400, 'Confirma que revisaste el análisis antes de aprobar un cambio marcado como no viable.');
  }
  if (decision === 'Aprobado con condiciones') {
    base.conditions = parseConditions(data);
    if (!base.conditions.length) fail(400, 'Una aprobación condicionada requiere al menos una condición con su forma de verificación.');
  } else if (Array.isArray(data.conditions) && data.conditions.length) fail(400, 'Una aprobación sin restricciones no admite condiciones; usa «Aprobado con condiciones».');
  base.preauthorizedBy = e.itilType === 'Estándar' && e.standardReference ? e.standardReference : null;
  r.decisions.push(base);
  for (const l of links(db, number).filter(l => l.kind === 'potencial')) insertLink(db, number, l.icsId, 'autorizado', user, { operation: l.operation, decisionN: base.n });
  notify(r, `Solicitud ${decision === 'Aprobado' ? 'aprobada' : 'aprobada con condiciones'} por el CCC. La aprobación no implica que el cambio ya esté implementado.`);
  transition(db, r, user, C.DECISION_STATUS[decision], decision === 'Aprobado' ? 'Aprobación' : 'Aprobación condicionada', `${justification}${base.conditions.length ? ` · Condiciones: ${base.conditions.map(c => c.text).join(' | ')}` : ''}${base.feasibilityException ? ` · Excepción de viabilidad: ${base.feasibilityException}` : ''}`);
}
function supersede(db, r, number, user, reason) {
  const auth = currentAuthorization(r);
  if (auth) Object.assign(auth, { superseded: true, supersededAt: now(), supersededBy: user.name, supersededReason: reason });
  db.prepare("UPDATE request_ics SET active=0 WHERE request_id=? AND kind='autorizado'").run(number);
  const a = currentAssignment(r);
  if (a) Object.assign(a, { releasedAt: now(), releasedReason: reason });
}

// ---------- Ejecución del cambio ----------
function assignAction(db, r, number, user, data) {
  requireCCC(r, user);
  requireState(r, ['Aprobada', 'Aprobada con condiciones', 'Asignada', 'En implementación', 'En pruebas', 'Correcciones requeridas']);
  const auth = currentAuthorization(r);
  if (!auth || !['Aprobado', 'Aprobado con condiciones'].includes(auth.decision)) fail(409, 'La asignación requiere una autorización vigente del CCC.');
  if (auth.needsReevaluation) fail(409, 'La aprobación proviene de la versión anterior sin planes de rollout ni backout. Reevalúa la solicitud antes de asignarla.');
  const developerId = str(data, 'developerId', { required: true, max: 100, label: 'Desarrollador responsable' });
  const dev = db.prepare("SELECT id,name,role FROM users WHERE id=? AND active=1").get(developerId);
  if (!dev || dev.role !== 'experto') fail(400, 'Selecciona un desarrollador activo.');
  const previous = currentAssignment(r);
  if (previous?.developerId === dev.id) fail(409, `${dev.name} ya es el responsable asignado.`);
  const reason = previous ? str(data, 'reason', { required: true, min: 10, max: 2000, label: 'Motivo de la reasignación' }) : str(data, 'reason', { max: 2000 });
  const assignment = { n: r.assignments.length + 1, developerId: dev.id, developerName: dev.name, assignedBy: user.name, assignedById: user.id, at: now(), targetDate: isoDate(str(data, 'targetDate', { max: 10 }), 'Fecha objetivo', localDate()), notes: str(data, 'notes', { max: 3000, label: 'Observaciones de implementación' }), priority: pick(data.priority || r.priority || 'Media', C.LEVELS, 'una prioridad'), decisionN: auth.n, reason, previous: previous ? previous.developerName : null };
  if (previous) Object.assign(previous, { releasedAt: assignment.at, releasedReason: reason });
  if (assignment.priority !== r.priority) { audit(db, { entityType: 'CRF', entityId: r.id, action: 'Cambio de prioridad', actor: user, field: 'priority', oldValue: r.priority, newValue: assignment.priority }); r.priority = assignment.priority; }
  r.assignments.push(assignment);
  const note = previous ? `Reasignada de ${previous.developerName} a ${dev.name}: ${reason}` : `Asignada a ${dev.name} según la decisión ${auth.n}.`;
  if (['Aprobada', 'Aprobada con condiciones'].includes(r.status)) transition(db, r, user, 'Asignada', previous ? 'Reasignación' : 'Asignación', note);
  else log(db, r, user, previous ? 'Reasignación' : 'Asignación', note, { field: 'responsable', oldValue: previous?.developerName || null, newValue: dev.name });
}
function startImplementation(db, r, user, data) {
  requireAssignee(r, user);
  requireState(r, ['Asignada', 'Correcciones requeridas']);
  const auth = currentAuthorization(r);
  if (!auth || !['Aprobado', 'Aprobado con condiciones'].includes(auth.decision)) fail(409, 'No existe una autorización vigente.');
  const note = str(data, 'note', { max: 2000, label: 'Observación de inicio' });
  if (auth.conditions?.length && !bool(data.conditionsAcknowledged)) fail(400, 'Confirma que leíste las condiciones de aprobación del CCC.');
  r.implementation.rounds.push({ n: r.implementation.rounds.length + 1, startedAt: now(), startedBy: user.name, startedById: user.id, note, activities: [] });
  transition(db, r, user, 'En implementación', r.implementation.rounds.length > 1 ? 'Inicio de correcciones' : 'Inicio de implementación', note || `Ronda ${r.implementation.rounds.length} de implementación.`);
}
function activityAction(db, r, user, data) {
  requireAssignee(r, user);
  requireState(r, ['En implementación']);
  const round = currentRound(r);
  const activity = { id: `ACT-${r.implementation.rounds.reduce((n, x) => n + x.activities.length, 0) + 1}`, date: isoDate(str(data, 'date', { max: 10 }), 'Fecha de la actividad') || localDate(), description: str(data, 'description', { required: true, min: 5, max: 3000, label: 'Descripción de la actividad' }), hours: num(data, 'hours', { required: true, label: 'Tiempo utilizado (horas)', max: 1000 }), status: pick(data.status || 'Completada', C.ACTIVITY_STATES, 'un estado de actividad'), observations: str(data, 'observations', { max: 2000 }), evidence: str(data, 'evidence', { max: 1000 }), by: user.name, at: now() };
  round.activities.push(activity);
  log(db, r, user, 'Registro de actividad', `${activity.id}: ${activity.description} (${activity.hours} h, ${activity.status}).`);
}
function gitAction(db, r, user, data) {
  requireAssignee(r, user);
  requireState(r, ['En implementación', 'En pruebas', 'En revisión', 'Correcciones requeridas']);
  const kind = pick(data.kind, C.GIT_KINDS, 'un tipo de referencia');
  const value = str(data, 'value', { required: true, max: 300, label: 'Referencia' });
  const url = link(str(data, 'url', { max: 500, label: 'Enlace' }), 'Enlace');
  if (kind === 'Commit' && !/^[0-9a-f]{7,40}$/i.test(value)) fail(400, 'Commit: indica el identificador SHA (7 a 40 caracteres hexadecimales).');
  if (kind === 'Pull request' && url && /github\.com$/i.test(new URL(url).hostname) && !/\/pull\/\d+/.test(new URL(url).pathname)) fail(400, 'Pull request: la URL de GitHub debe tener la forma …/pull/número.');
  if (['Repositorio', 'Pull request', 'Enlace de evidencia'].includes(kind) && !url) fail(400, `${kind}: indica la URL.`);
  const ref = { id: nextId(r.gitRefs, 'GIT'), kind, value, url, note: str(data, 'note', { max: 1000 }), by: user.name, at: now(), verified: false };
  r.gitRefs.push(ref);
  log(db, r, user, 'Registro de evidencia', `${kind}: ${value}${url ? ` (${url})` : ''}. Registrado manualmente; el sistema no verificó el repositorio.`);
}
function icsChangeAction(db, r, number, user, data) {
  requireAssignee(r, user);
  requireState(r, ['En implementación']);
  const ics = validIcs(db, [data.icsId], 'ICS modificado')[0];
  const operation = pick(data.operation, C.OPERATIONS, 'un tipo de operación');
  const toRevision = str(data, 'toRevision', { required: true, max: 60, label: 'Revisión nueva' });
  const description = str(data, 'description', { required: true, min: 5, max: 3000, label: 'Descripción de la modificación' });
  const evidence = str(data, 'evidence', { max: 1000, label: 'Evidencia asociada' });
  const current = ics.current_revision_id ? db.prepare('SELECT revision FROM ics_revisions WHERE id=?').get(ics.current_revision_id)?.revision : null;
  const busy = db.prepare("SELECT request_id FROM ics_revisions WHERE ics_id=? AND status='En cambio'").get(ics.id);
  if (busy) fail(409, `${ics.code} ya tiene una revisión en curso (${crfCode(busy.request_id)}).`);
  if (db.prepare('SELECT 1 FROM ics_revisions WHERE ics_id=? AND revision=?').get(ics.id, toRevision)) fail(409, `La revisión ${toRevision} de ${ics.code} ya existe.`);
  const revisionId = Number(db.prepare("INSERT INTO ics_revisions(ics_id,revision,git_ref,date,notes,request_id,status,created_by) VALUES(?,?,?,?,?,?,'En cambio',?)").run(ics.id, toRevision, str(data, 'gitRef', { max: 200 }), now(), description, number, user.id).lastInsertRowid);
  const authorized = authorizedLinks(db, number).some(l => l.icsId === ics.id);
  insertLink(db, number, ics.id, 'modificado', user, { operation, fromRevision: current || 'Sin revisión', toRevision, revisionId, description, evidence, inScope: authorized ? 1 : 0, round: currentRound(r).n });
  if (!authorized) {
    r.deviations.push({ id: nextId(r.deviations, 'DES'), icsId: ics.id, icsCode: ics.code, description: `Modificación de ${ics.code} fuera de los ICS autorizados: ${description}`, status: 'Pendiente', by: user.name, at: now() });
    log(db, r, user, 'Desviación de alcance', `${ics.code} no estaba autorizado. Requiere decisión del CCC antes de continuar.`);
  }
  log(db, r, user, 'Registro de ICS modificado', `${ics.code} ${operation}: ${current || 'sin revisión'} → ${toRevision}.`, { field: ics.code, oldValue: current, newValue: toRevision });
}
function deviationAction(db, r, user, data) {
  requireAssignee(r, user);
  requireState(r, ['En implementación', 'En pruebas', 'Correcciones requeridas']);
  const description = str(data, 'description', { required: true, min: 10, max: 3000, label: 'Descripción de la desviación' });
  r.deviations.push({ id: nextId(r.deviations, 'DES'), icsId: null, icsCode: null, description, status: 'Pendiente', by: user.name, at: now() });
  log(db, r, user, 'Desviación de alcance', description);
}
function scopeAction(db, r, number, user, data) {
  requireCCC(r, user);
  requireState(r, ['En implementación', 'En pruebas', 'En revisión', 'Correcciones requeridas']);
  const d = r.deviations.find(x => x.id === data.deviationId);
  if (!d || d.status !== 'Pendiente') fail(409, 'La desviación no existe o ya fue decidida.');
  const decision = pick(data.decision, ['Autorizada', 'No autorizada'], 'una decisión de alcance');
  const justification = str(data, 'justification', { required: true, min: 10, max: 3000, label: 'Justificación' });
  Object.assign(d, { status: decision, decidedBy: user.name, decidedAt: now(), justification });
  const record = { n: r.decisions.length + 1, kind: 'Ampliación de alcance', decision: decision === 'Autorizada' ? 'Aprobado' : 'Rechazado', justification, deviationId: d.id, conditions: [], decidedBy: user.name, decidedById: user.id, at: now() };
  r.decisions.push(record);
  if (decision === 'Autorizada' && d.icsId) {
    insertLink(db, number, d.icsId, 'autorizado', user, { operation: 'Modificación', decisionN: record.n });
    db.prepare("UPDATE request_ics SET in_scope=1 WHERE request_id=? AND ics_id=? AND kind='modificado'").run(number, d.icsId);
  }
  log(db, r, user, 'Decisión de alcance', `${d.id} ${decision.toLowerCase()}: ${justification}`);
}
function sendToTests(db, r, number, user, data) {
  requireAssignee(r, user);
  requireState(r, ['En implementación']);
  const round = currentRound(r);
  if (!round.activities.length) fail(409, 'Registra al menos una actividad de implementación en esta ronda.');
  if (!links(db, number).some(l => l.kind === 'modificado')) fail(409, 'Identifica los ICS realmente modificados antes de enviar a pruebas.');
  if (r.deviations.some(d => d.status === 'Pendiente')) fail(409, 'Hay desviaciones de alcance pendientes de decisión del CCC.');
  round.sentToTestsAt = now();
  transition(db, r, user, 'En pruebas', 'Envío a pruebas', str(data, 'note', { max: 2000 }) || `Ronda ${round.n} lista para pruebas.`);
}
function testAction(db, r, user, data) {
  if (!isDev(user)) fail(403, 'Las pruebas las registran los desarrolladores.');
  requireState(r, ['En pruebas']);
  const status = pick(data.status, C.TEST_STATES, 'un estado de prueba');
  const t = { id: `PRB-${r.tests.length + 1}`, round: currentRound(r).n, name: str(data, 'name', { required: true, max: 200, label: 'Nombre de la prueba' }), description: str(data, 'description', { max: 2000 }), criterion: str(data, 'criterion', { max: 2000 }), expected: str(data, 'expected', { required: true, max: 2000, label: 'Resultado esperado' }), obtained: str(data, 'obtained', { required: ['Superada', 'Fallida', 'Bloqueada'].includes(status), max: 2000, label: 'Resultado obtenido' }), status, date: now(), responsible: user.name, responsibleId: user.id, independent: currentAssignment(r)?.developerId !== user.id, evidence: str(data, 'evidence', { max: 1000 }), observations: str(data, 'observations', { max: 2000 }) };
  r.tests.push(t);
  log(db, r, user, 'Resultado de prueba', `${t.id} ${t.name}: ${t.status}${t.independent ? '' : ' (registrada por el implementador)'}.`);
}
// Último resultado de cada prueba (por nombre) dentro de la ronda: las ejecuciones anteriores se conservan.
function latestTests(r, round) {
  const map = new Map();
  for (const t of r.tests.filter(t => t.round === round)) map.set(t.name.toLowerCase(), t);
  return [...map.values()];
}
function finishTests(db, r, user, data) {
  if (!isDev(user)) fail(403, 'Las pruebas las registran los desarrolladores.');
  requireState(r, ['En pruebas']);
  const round = currentRound(r).n, latest = latestTests(r, round);
  const outcome = pick(data.outcome, C.TEST_OUTCOMES, 'un resultado de pruebas');
  const note = str(data, 'note', { max: 3000, label: 'Observaciones' });
  if (!latest.length) fail(409, 'Registra al menos una prueba en esta ronda.');
  const record = { round, outcome, note, by: user.name, at: now() };
  if (outcome === 'Todas superadas') {
    if (latest.some(t => t.status !== 'Superada')) fail(409, 'No todas las pruebas de esta ronda están superadas.');
    r.testRounds.push(record);
    transition(db, r, user, 'En revisión', 'Resultado de pruebas', `Ronda ${round}: todas las pruebas superadas.`);
  } else if (outcome === 'Existen fallos') {
    if (!latest.some(t => t.status === 'Fallida')) fail(409, 'No hay pruebas fallidas en esta ronda.');
    record.incident = str(data, 'incident', { required: true, min: 10, max: 3000, label: 'Incidencia detectada' });
    r.testRounds.push(record);
    if (data.next === 'Revisión') transition(db, r, user, 'En revisión', 'Resultado de pruebas', `Ronda ${round} con fallos; se envía a revisión para evaluar el resultado. Incidencia: ${record.incident}`);
    else transition(db, r, user, 'Correcciones requeridas', 'Resultado de pruebas', `Ronda ${round} con fallos. Incidencia: ${record.incident}`);
  } else {
    if (!note || note.length < 10) fail(400, 'Explica por qué las pruebas quedaron incompletas.');
    r.testRounds.push(record);
    transition(db, r, user, 'En revisión', 'Resultado de pruebas', `Ronda ${round}: pruebas incompletas. ${note}`);
  }
}
function backoutAction(db, r, user, data) {
  requireAssignee(r, user);
  requireState(r, ['En implementación', 'En pruebas', 'Correcciones requeridas', 'En revisión']);
  const b = { id: nextId(r.backouts, 'BKO'), round: currentRound(r)?.n || null, trigger: str(data, 'trigger', { required: true, min: 10, max: 2000, label: 'Motivo de activación' }), at: now(), by: user.name, actions: str(data, 'actions', { required: true, min: 10, max: 3000, label: 'Acciones realizadas' }), recovered: str(data, 'recovered', { required: true, max: 300, label: 'Configuración o versión recuperada' }), result: pick(data.result, C.BACKOUT_RESULTS, 'un resultado de reversión'), evidence: str(data, 'evidence', { max: 1000 }), systemState: str(data, 'systemState', { required: true, max: 2000, label: 'Estado posterior del sistema' }) };
  r.backouts.push(b);
  log(db, r, user, 'Ejecución de backout', `${b.id}: ${b.result}. Recuperado: ${b.recovered}. El sistema solo documenta la reversión; no restaura código ni datos.`);
}
function reviewCriteria(r) { return [...new Set([...(r.acceptanceCriteria || []), ...(r.evaluation?.testCriteria || [])])]; }
function reviewAction(db, r, number, user, data) {
  if (!isDev(user)) fail(403, 'La revisión postimplementación la registra un desarrollador.');
  requireState(r, ['En revisión']);
  const criteria = reviewCriteria(r), auth = currentAuthorization(r);
  const rawCriteria = Array.isArray(data.criteria) ? data.criteria : [];
  if (rawCriteria.length !== criteria.length) fail(400, 'Indica el cumplimiento de cada criterio de aceptación.');
  const criteriaResult = criteria.map((text, i) => ({ text, met: bool(rawCriteria[i]?.met), note: str(rawCriteria[i] || {}, 'note', { max: 1000 }) }));
  const rawConditions = Array.isArray(data.conditions) ? data.conditions : [];
  const conditions = (auth?.conditions || []).map(c => { const x = rawConditions.find(y => y?.id === c.id) || {}; return { id: c.id, text: c.text, verification: c.verification, met: bool(x.met), evidence: str(x, 'evidence', { max: 1000 }) }; });
  const decision = pick(data.decision, C.REVIEW_DECISIONS, 'una decisión de revisión');
  const lastTests = r.testRounds.at(-1);
  const review = { n: r.reviews.length + 1, round: currentRound(r).n, reviewer: user.name, reviewerId: user.id, independent: currentAssignment(r)?.developerId !== user.id, at: now(), summary: str(data, 'summary', { required: true, min: 10, max: 3000, label: 'Resumen de implementación' }), testResult: lastTests?.outcome || 'Sin pruebas', criteria: criteriaResult, rolloutCompliance: pick(data.rolloutCompliance, C.ROLLOUT_COMPLIANCE, 'el cumplimiento del rollout'), conditions, modifiedIcs: links(db, number).filter(l => l.kind === 'modificado').map(l => `${l.code} ${l.fromRevision}→${l.toRevision}${l.inScope ? '' : ' (fuera de alcance)'}`), deviationsFound: str(data, 'deviationsFound', { max: 3000 }), pendingIssues: str(data, 'pendingIssues', { max: 3000 }), recommendation: str(data, 'recommendation', { required: true, max: 3000, label: 'Recomendación final' }), evidence: str(data, 'evidence', { max: 1000 }), decision };
  if (decision === 'Conforme') {
    const problems = [];
    if (lastTests?.outcome !== 'Todas superadas' || lastTests.round !== review.round) problems.push('las pruebas de la ronda actual no están todas superadas');
    if (criteriaResult.some(c => !c.met)) problems.push('hay criterios de aceptación incumplidos');
    if (conditions.some(c => !c.met)) problems.push('hay condiciones del CCC sin verificar');
    if (r.deviations.some(d => d.status !== 'Autorizada')) problems.push('hay desviaciones de alcance no autorizadas o pendientes');
    if (review.rolloutCompliance === 'No cumplido') problems.push('el rollout no se cumplió');
    if (review.pendingIssues) problems.push('hay incidencias pendientes');
    if (problems.length) fail(409, `No se puede declarar conforme: ${problems.join('; ')}.`);
  }
  r.reviews.push(review);
  if (decision === 'Requiere correcciones') transition(db, r, user, 'Correcciones requeridas', 'Revisión postimplementación', `Revisión ${review.n}: requiere correcciones. ${review.recommendation}`);
  else log(db, r, user, 'Revisión postimplementación', `Revisión ${review.n}: ${decision}${review.independent ? '' : ' (realizada por el implementador)'}. ${review.recommendation}`);
}
function finalizeRevisions(db, number, success) {
  for (const l of links(db, number).filter(l => l.kind === 'modificado' && l.revisionId)) {
    const rev = db.prepare('SELECT id,ics_id,status FROM ics_revisions WHERE id=?').get(l.revisionId);
    if (rev?.status !== 'En cambio') continue;
    if (success) {
      const ics = db.prepare('SELECT current_revision_id FROM ics WHERE id=?').get(rev.ics_id);
      if (ics.current_revision_id) db.prepare("UPDATE ics_revisions SET status='Reemplazada' WHERE id=?").run(ics.current_revision_id);
      db.prepare("UPDATE ics_revisions SET status='Vigente' WHERE id=?").run(rev.id);
      db.prepare(`UPDATE ics SET current_revision_id=?, version=version+1${l.operation === 'Eliminación' ? ", status='Retirado'" : ''} WHERE id=?`).run(rev.id, rev.ics_id);
    } else db.prepare("UPDATE ics_revisions SET status='Descartada' WHERE id=?").run(rev.id);
  }
}
function closeAction(db, r, number, user, data) {
  requireAssignee(r, user);
  requireState(r, ['En revisión']);
  const round = currentRound(r).n, review = r.reviews.at(-1);
  if (!review || review.round !== round) fail(409, 'Registra la revisión postimplementación de esta ronda antes de cerrar.');
  const result = pick(data.result, C.CLOSURE_RESULTS, 'un resultado de cierre');
  const justification = str(data, 'justification', { required: result !== 'Exitoso', min: result !== 'Exitoso' ? 10 : 0, max: 3000, label: 'Justificación del cierre' });
  if (result === 'Exitoso') {
    if (review.decision !== 'Conforme') fail(409, 'El cierre exitoso requiere una revisión «Conforme».');
    if (r.backouts.some(b => b.round === round)) fail(409, 'Se ejecutó un backout en esta ronda; el cierre no puede ser exitoso.');
  }
  const resultingVersion = str(data, 'resultingVersion', { max: 40, label: 'Versión resultante' });
  if (resultingVersion && !C.SEMVER.test(resultingVersion)) fail(400, 'Versión resultante: usa MAJOR.MINOR.PATCH.');
  const modified = links(db, number).filter(l => l.kind === 'modificado');
  r.closure = { result, administrative: 'Cerrada', by: user.name, byId: user.id, at: now(), summary: str(data, 'summary', { required: true, min: 10, max: 3000, label: 'Resumen del trabajo' }), modifications: modified.map(l => `${l.code} ${l.operation}: ${l.description}`), evidence: str(data, 'evidence', { max: 1000 }), testsResult: r.testRounds.at(-1)?.outcome || 'Sin pruebas', reviewResult: review.decision, gitRefs: r.gitRefs.map(g => `${g.kind}: ${g.value}`), icsModified: modified.map(l => `${l.code} ${l.fromRevision}→${l.toRevision}`), resultingVersion, justification };
  finalizeRevisions(db, number, result === 'Exitoso');
  notify(r, `Solicitud cerrada con resultado ${result.toLowerCase()}.`);
  transition(db, r, user, 'Cerrada', 'Cierre', `Resultado ${result}. ${justification || r.closure.summary}`);
}
function closeRejected(db, r, user, data) {
  requireCCC(r, user);
  requireState(r, ['Rechazada']);
  r.closure = { result: null, administrative: 'Cerrada por rechazo', by: user.name, byId: user.id, at: now(), summary: currentAuthorization(r)?.justification || '', justification: str(data, 'justification', { max: 2000 }) || 'Cierre administrativo de una solicitud rechazada.' };
  transition(db, r, user, 'Cerrada', 'Cierre administrativo', r.closure.justification);
}
function reopenAction(db, r, number, user, data) {
  requireCCC(r, user);
  requireState(r, ['Cerrada']);
  const reason = str(data, 'reason', { required: true, min: 10, max: 3000, label: 'Motivo de la reapertura' });
  r.closures.push(r.closure);
  r.closure = null;
  supersede(db, r, number, user, `Reapertura: ${reason}`);
  if (r.evaluation) { r.previousEvaluations.push(r.evaluation); r.evaluation = { ...r.evaluation, member: user.name, memberId: user.id, startedAt: now(), analysisCompletedAt: null, planningCompletedAt: null }; }
  r.reopenings.push({ by: user.name, at: now(), reason, newStatus: 'En análisis' });
  transition(db, r, user, 'En análisis', 'Reapertura', reason);
}

// ---------- Despachador ----------
function mutate(db, id, action, user, data) {
  const { r, number } = getRequest(db, id, user);
  if (data.revision !== r.revision) fail(409, 'La solicitud cambió. Actualiza el expediente antes de guardar.');
  switch (action) {
    case 'edit': case 'delete': {
      if (r.ownerId !== user.id) fail(403, 'Solo el solicitante puede modificar esta petición.');
      if (r.status !== 'Registrada' || r.history.some(h => h.action && !['Creación de CRF', 'Petición actualizada', 'Migración'].includes(h.action))) fail(409, 'La petición está bloqueada porque el CCC ya la recibió. Su contenido original se conserva.');
      if (action === 'delete') {
        files.removeFiles(db, number);
        db.prepare('DELETE FROM requests WHERE id=?').run(number);
        audit(db, { entityType: 'CRF', entityId: r.id, action: 'Eliminación de CRF', actor: user, from: r.status, justification: `Eliminada por su solicitante antes de la recepción del CCC: ${r.title}` });
        return null;
      }
      const { fields, suggested } = requestFields(db, data, r.requesterType, r.date);
      auditChanges(db, { entityType: 'CRF', entityId: r.id, action: 'Modificación de información', actor: user, from: r.status, to: r.status }, r, fields, Object.keys(fields));
      Object.assign(r, fields);
      db.prepare("DELETE FROM request_ics WHERE request_id=? AND kind='sugerido'").run(number);
      for (const ics of suggested) insertLink(db, number, ics.id, 'sugerido', user);
      r.history.push({ status: r.status, date: now(), responsible: user.name, responsibleId: user.id, action: 'Petición actualizada', note: 'El solicitante actualizó la petición antes de su recepción.' });
      break;
    }
    case 'receive':
      requireCCC(r, user); requireState(r, ['Registrada']);
      r.validation = { receivedBy: user.name, receivedAt: now() };
      transition(db, r, user, 'En validación', 'Recepción del CRF', 'El CCC recibió la solicitud y verifica que contenga la información necesaria.');
      break;
    case 'validate':
      requireCCC(r, user); requireState(r, ['En validación']);
      Object.assign(r.validation ||= {}, { validatedBy: user.name, validatedAt: now(), note: str(data, 'note', { max: 2000 }) });
      r.evaluation = { ...(r.evaluation || {}), member: user.name, memberId: user.id, startedAt: r.evaluation?.startedAt || now(), testCriteria: r.evaluation?.testCriteria?.length ? r.evaluation.testCriteria : [...(r.acceptanceCriteria || [])] };
      transition(db, r, user, 'En análisis', 'Inicio del análisis', r.validation.note || 'Solicitud completa; comienza el análisis del CCC.');
      break;
    case 'request-info':
      requireCCC(r, user); requireState(r, ['En validación', 'En análisis', 'En planificación', 'Pendiente de aprobación']);
      requestInfo(db, r, user, str(data, 'missing', { required: true, min: 10, max: 3000, label: 'Información que falta' }));
      break;
    case 'clarification':
      if (r.ownerId !== user.id) fail(403, 'Solo el solicitante puede aportar la información adicional.');
      clarify(db, r, number, user, data);
      break;
    case 'evaluation': evaluationAction(db, r, number, user, data); break;
    case 'decision': decisionAction(db, r, number, user, data); break;
    case 'reevaluate': {
      requireCCC(r, user); requireState(r, ['Aprobada', 'Aprobada con condiciones', 'Asignada']);
      const reason = str(data, 'reason', { required: true, min: 10, max: 3000, label: 'Motivo de la reevaluación' });
      supersede(db, r, number, user, reason);
      if (r.evaluation) r.evaluation.planningCompletedAt = null;
      r.evaluation = { ...(r.evaluation || {}), member: r.evaluation?.member || user.name, memberId: r.evaluation?.memberId || user.id, startedAt: r.evaluation?.startedAt || now() };
      transition(db, r, user, r.evaluation.analysisCompletedAt ? 'En planificación' : 'En análisis', 'Reevaluación', `${reason} La decisión anterior se conserva en el historial.`);
      break;
    }
    case 'assign': assignAction(db, r, number, user, data); break;
    case 'start': startImplementation(db, r, user, data); break;
    case 'activity': activityAction(db, r, user, data); break;
    case 'git': gitAction(db, r, user, data); break;
    case 'ics-change': icsChangeAction(db, r, number, user, data); break;
    case 'deviation': deviationAction(db, r, user, data); break;
    case 'scope': scopeAction(db, r, number, user, data); break;
    case 'send-to-tests': sendToTests(db, r, number, user, data); break;
    case 'test': testAction(db, r, user, data); break;
    case 'finish-tests': finishTests(db, r, user, data); break;
    case 'backout': backoutAction(db, r, user, data); break;
    case 'review': reviewAction(db, r, number, user, data); break;
    case 'close': closeAction(db, r, number, user, data); break;
    case 'close-rejected': closeRejected(db, r, user, data); break;
    case 'reopen': reopenAction(db, r, number, user, data); break;
    default: fail(404, 'Acción no encontrada.');
  }
  return present(db, number, save(db, r));
}
function clarify(db, r, number, user, data) {
  requireState(r, ['Pendiente de información']);
  const note = str(data, 'note', { required: true, min: 5, max: 5000, label: 'Respuesta' });
  const pending = r.infoRequests.at(-1);
  if (pending) Object.assign(pending, { response: note, respondedAt: now(), respondedBy: nameOf(user) });
  files.storeFiles(db, { requestNumber: number, requestCode: r.id, context: 'Información adicional', files: data.files, user, fail });
  transition(db, r, user, 'En validación', 'Respuesta del iniciador', note);
}
function uploadAttachments(db, id, user, data) {
  const { r, number } = getRequest(db, id, user);
  const context = pick(data.context || 'Evidencia', ['Solicitud', 'Información adicional', 'Evidencia'], 'un contexto de adjunto');
  if (r.status === 'Cerrada') fail(409, 'La solicitud está cerrada; sus evidencias ya no pueden ampliarse.');
  if (!isCCC(user) && r.ownerId !== user.id && !isDev(user)) fail(403, 'No puedes adjuntar archivos a esta solicitud.');
  const saved = files.storeFiles(db, { requestNumber: number, requestCode: r.id, context, files: data.files, user, fail });
  if (!saved.length) fail(400, 'Selecciona al menos un archivo.');
  log(db, r, user, 'Registro de evidencia', `${saved.length} archivo(s) adjuntado(s): ${saved.map(s => s.filename).join(', ')}.`);
  return present(db, number, save(db, r));
}

// ---------- Seguimiento sin cuenta ----------
function publicRequest(db, data) {
  const token = typeof data.token === 'string' ? data.token : '';
  let r = null;
  try { r = load(db, parseCode(data.code)); } catch { r = null; }
  const valid = r?.trackingHash && /^[a-f0-9]{36}$/.test(token) && timingSafeEqual(Buffer.from(digest(token)), Buffer.from(r.trackingHash));
  if (!valid) fail(404, 'No se encontró una solicitud con ese código y clave de seguimiento.');
  return r;
}
// Solo información comunicable al solicitante: nada del análisis interno, ICS o planes.
function publicView(r) {
  const auth = currentAuthorization(r);
  return { id: r.id, title: r.title, date: r.date, status: r.status, revision: r.revision, pendingInfo: r.status === 'Pendiente de información' ? r.infoRequests.at(-1)?.missing : null, decision: auth ? { decision: auth.decision, at: auth.at, justification: auth.justification, conditions: auth.conditions.map(c => c.text) } : null, closure: r.closure ? { result: r.closure.result, administrative: r.closure.administrative, at: r.closure.at } : null, notices: r.notices || [] };
}
function trackRequest(db, data) { return publicView(publicRequest(db, data)); }
function publicClarification(db, data) {
  const r = publicRequest(db, data);
  if (data.revision !== r.revision) fail(409, 'La solicitud cambió. Consulta nuevamente su estado.');
  clarify(db, r, parseCode(r.id), { id: null, name: r.name, email: r.email, role: 'usuario' }, data);
  return publicView(save(db, r));
}

// ---------- Lecturas ----------
const clean = r => { const { trackingHash, ...rest } = r; return rest; };
const EMPTY_LINKS = () => ({ sugerido: [], potencial: [], autorizado: [], modificado: [] });
// Respuesta para el cliente: sin el hash de seguimiento y con el resumen de ICS relacionados.
function present(db, number, r) { return { ...clean(r), ics: linkSummary(db).get(number) || EMPTY_LINKS() }; }
function allVisible(db, user) {
  return db.prepare('SELECT id,document FROM requests ORDER BY id').all().map(x => ({ number: x.id, r: JSON.parse(x.document) })).filter(x => canView(x.r, user));
}
function linkSummary(db) {
  const map = new Map();
  for (const l of db.prepare("SELECT ri.request_id AS rid,ri.kind,ri.active,i.code FROM request_ics ri JOIN ics i ON i.id=ri.ics_id").all()) {
    if (l.kind === 'autorizado' && !l.active) continue;
    const entry = map.get(l.rid) || { sugerido: [], potencial: [], autorizado: [], modificado: [] };
    if (!entry[l.kind].includes(l.code)) entry[l.kind].push(l.code);
    map.set(l.rid, entry);
  }
  return map;
}
function snapshot(db, user) {
  const summary = linkSummary(db);
  return { requests: allVisible(db, user).map(({ number, r }) => ({ ...clean(r), ics: summary.get(number) || EMPTY_LINKS() })) };
}
function configurationAudit(r, all) {
  const active = all.filter(l => l.kind !== 'autorizado' || l.active);
  const codes = kind => [...new Set(active.filter(l => l.kind === kind).map(l => l.code))];
  const authorized = codes('autorizado'), modified = codes('modificado'), potential = codes('potencial');
  const findings = [];
  const outside = modified.filter(c => !authorized.includes(c));
  const untouched = authorized.filter(c => !modified.includes(c));
  if (outside.length) findings.push(`ICS modificados fuera de lo autorizado: ${outside.join(', ')}.`);
  if (untouched.length && r.status === 'Cerrada') findings.push(`ICS autorizados que no se modificaron: ${untouched.join(', ')}.`);
  for (const d of r.deviations || []) if (d.status !== 'Autorizada') findings.push(`Desviación ${d.id} ${d.status.toLowerCase()}: ${d.description}`);
  const review = r.reviews?.at(-1);
  if (review) { review.criteria.filter(c => !c.met).forEach(c => findings.push(`Criterio incumplido: ${c.text}`)); review.conditions.filter(c => !c.met).forEach(c => findings.push(`Condición sin verificar: ${c.text}`)); }
  if (r.closure?.result === 'Exitoso' && !r.gitRefs?.length) findings.push('Cierre exitoso sin referencias de control de versiones registradas.');
  if (r.flags?.length) findings.push(...r.flags);
  const auth = currentAuthorization(r);
  return { requested: { title: r.title, description: r.description, result: r.result, suggested: codes('sugerido') }, authorized: auth ? { decision: auth.decision, at: auth.at, by: auth.decidedBy, conditions: auth.conditions, plannedChanges: auth.evaluationSnapshot?.plannedChanges || '' } : null, potential, authorizedIcs: authorized, modifiedIcs: modified, evidences: { git: r.gitRefs?.length || 0, tests: r.tests?.length || 0, backouts: r.backouts?.length || 0 }, review: review ? { decision: review.decision, by: review.reviewer, independent: review.independent } : null, closure: r.closure, findings, note: 'Verificación académica de la configuración; no equivale a una auditoría certificada.' };
}
function requestDetail(db, id, user) {
  const { r, number } = getRequest(db, id, user);
  const all = links(db, number);
  return { request: clean(r), links: all, attachments: files.listAttachments(db, number), audit: db.prepare("SELECT * FROM audit_events WHERE entity_type='CRF' AND entity_id=? ORDER BY id").all(r.id), configAudit: configurationAudit(r, all), reviewCriteria: reviewCriteria(r) };
}
function attachmentFor(db, attachmentId, user) {
  const file = files.readAttachment(db, attachmentId);
  if (!file) fail(404, 'Adjunto no encontrado.');
  const r = file.row.request_id ? load(db, file.row.request_id) : null;
  if (!r || !canView(r, user)) fail(403, 'No tienes acceso a este adjunto.');
  return file;
}
function users(db) { return db.prepare("SELECT id,name,email,role FROM users WHERE active=1 AND role IN ('experto','ccc') ORDER BY name").all(); }

module.exports = { HttpError, fail, str, pick, list, num, link, isoDate, bool, now, isCCC, isDev, parseCode, canView, snapshot, createRequest, mutate, uploadAttachments, trackRequest, publicClarification, requestDetail, attachmentFor, users, allVisible, linkSummary, currentAuthorization, currentAssignment, reviewCriteria, EVAL_TEXT, EVAL_LIST, EVAL_NUM };

'use strict';
// Flujo de control de cambios: CRF, ficha única del CCC, asignación, implementación, pruebas, revisión y cierre.
// Todas las transiciones y permisos se validan aquí; el cliente solo refleja estas reglas.
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const C = require('./catalog.cjs');
const { SCHEMA, crfCode } = require('./migrate.cjs');
const { audit, auditChanges } = require('./audit.cjs');
const files = require('./files.cjs');

// `field` identifica el campo con error para que el cliente lo marque en rojo.
class HttpError extends Error { constructor(status, message, field) { super(message); this.status = status; if (field) this.field = field; } }
const fail = (status, message, field) => { throw new HttpError(status, message, field); };
// Solo el servidor puede adjuntar el resultado de GitHub: un símbolo no puede llegar en un JSON del cliente.
const GITHUB_RESULT = Symbol.for('changeflow.github');
const now = () => new Date().toISOString();
const localDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const digest = v => createHash('sha256').update(v).digest('hex');
const isCCC = u => u?.role === 'ccc';
const isDev = u => u?.role === 'experto';
const nameOf = u => u ? (u.id ? u.name : `${u.name} (sin cuenta)`) : 'Sistema';

// ---------- Validación de entrada ----------
function str(data, key, { required = false, max = 5000, min = 0, label = key } = {}) {
  const v = data[key];
  if (v !== undefined && v !== null && typeof v !== 'string') fail(400, `Campo inválido: ${label}.`, key);
  const s = (v || '').trim();
  if (required && !s) fail(400, `${label}: este campo es obligatorio.`, key);
  if (s.length > max) fail(400, `${label}: máximo ${max} caracteres.`, key);
  if (s && s.length < min) fail(400, `${label}: escribe al menos ${min} caracteres.`, key);
  return s;
}
function pick(value, values, label, opt = true) {
  const { required = true, field } = typeof opt === 'object' ? opt : { required: opt };
  if ((value === undefined || value === null || value === '') && !required) return '';
  if (!values.includes(value)) fail(400, `Selecciona ${label} válido.`, field);
  return value;
}
function list(data, key, { required = false, max = 40, label = key } = {}) {
  let v = data[key];
  if (v === undefined || v === null || v === '') v = [];
  if (typeof v === 'string') v = v.split(/\r?\n/);
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) fail(400, `Campo inválido: ${label}.`, key);
  const out = v.map(x => x.trim()).filter(Boolean);
  if (out.length > max || out.some(x => x.length > 2000)) fail(400, `${label}: demasiados elementos o elementos demasiado largos.`, key);
  if (required && !out.length) fail(400, `${label}: agrega al menos un elemento.`, key);
  return out;
}
function num(data, key, { required = false, label = key, max = 100000 } = {}) {
  const v = data[key];
  if (v === undefined || v === null || v === '') { if (required) fail(400, `${label}: este campo es obligatorio.`, key); return null; }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) fail(400, `${label}: ingresa un número entre 0 y ${max}.`, key);
  return Math.round(n * 100) / 100;
}
function link(value, label) {
  if (!value) return '';
  let u; try { u = new URL(value); } catch { fail(400, `${label}: la dirección no es una URL válida.`); }
  if (!['https:', 'http:'].includes(u.protocol)) fail(400, `${label}: usa una URL http o https.`);
  return u.href;
}
function isoDate(value, label, notBefore, field) {
  if (!value) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(400, `${label}: fecha inválida.`, field);
  if (notBefore && value < notBefore) fail(400, `${label}: no puede ser anterior al ${notBefore}.`, field);
  return value;
}
// Versiones semánticas MAJOR.MINOR.PATCH; una versión propuesta debe ser mayor que la actual.
const semverCmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
function version(value, label, field, { allow = [], greaterThan } = {}) {
  if (!value || allow.includes(value)) return value || '';
  if (!C.SEMVER.test(value) || value.split('.').some(n => n.length > 6)) fail(400, `${label}: usa el formato MAJOR.MINOR.PATCH, por ejemplo 1.4.0${allow.length ? ` (o «${allow.join('» / «')}»)` : ''}.`, field);
  if (greaterThan && C.SEMVER.test(greaterThan) && semverCmp(value, greaterThan) <= 0) fail(400, `${label}: debe ser mayor que la versión actual ${greaterThan}.`, field);
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

// ---------- Módulos afectados ----------
// Una solicitud puede afectar varios módulos del catálogo. `module` conserva el primero por compatibilidad.
const modulesOf = r => r.modules?.length ? r.modules : r.module ? [r.module] : [];
function parseModules(data, { field = 'modules', label = 'Módulos afectados', allowUnsure = true } = {}) {
  let v = data[field];
  if ((v === undefined || v === null || v === '') && field === 'modules' && data.module) v = [data.module];
  if (typeof v === 'string') v = [v];
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) fail(400, `${label}: selección inválida.`, field);
  const out = [...new Set(v)];
  if (!out.length) fail(400, `${label}: selecciona al menos un módulo.`, field);
  for (const m of out) if (!C.MODULES.includes(m) || (!allowUnsure && m === 'No estoy seguro')) fail(400, `${label}: «${m}» no es un módulo válido.`, field);
  if (out.includes('No estoy seguro') && out.length > 1) fail(400, `${label}: no combines «No estoy seguro» con otros módulos.`, field);
  return out;
}
// Módulos autorizados vigentes: los de la decisión vigente más las ampliaciones de alcance aprobadas después.
function authorizedModules(r) {
  const auth = currentAuthorization(r);
  if (!auth || !['Aprobado', 'Aprobado con condiciones'].includes(auth.decision)) return [];
  const list = (auth.authorizedModules || []).map(x => x.module);
  for (const d of r.decisions || []) if (d.kind === 'Ampliación de alcance' && d.n > auth.n && d.decision === 'Aprobado' && d.module) list.push(d.module);
  return [...new Set(list)];
}

// ---------- CRF ----------
function requestFields(db, data, kind, date) {
  const f = { project: C.PROJECT };
  f.modules = parseModules(data);
  f.module = f.modules[0];
  f.title = str(data, 'title', { required: true, max: 120, min: 5, label: 'Título' });
  f.currentBehavior = str(data, 'currentBehavior', { required: true, label: 'Situación o comportamiento actual' });
  f.featureMissing = bool(data.featureMissing);
  f.description = str(data, 'description', { required: true, min: 20, label: 'Descripción del cambio' });
  f.justification = str(data, 'justification', { required: true, min: 20, label: 'Justificación' });
  f.result = str(data, 'result', { required: true, label: 'Resultado esperado' });
  f.desiredDate = isoDate(str(data, 'desiredDate', { max: 10, label: 'Fecha deseada' }), 'Fecha deseada', date, 'desiredDate');
  f.observations = str(data, 'observations', { label: 'Observaciones' });
  if (kind === 'experto') {
    f.modificationType = pick(data.modificationType, C.OPERATIONS, 'un tipo de modificación', { field: 'modificationType' });
    f.environment = pick(data.environment, C.ENVIRONMENTS, 'un entorno afectado', { field: 'environment' });
    f.proposedItilType = pick(data.proposedItilType, Object.keys(C.ITIL), 'un tipo de cambio ITIL propuesto', { field: 'proposedItilType' });
    f.currentVersion = str(data, 'currentVersion', { max: 40, label: 'Versión actual' }) || 'No determinada';
    version(f.currentVersion, 'Versión actual', 'currentVersion', { allow: ['No determinada'] });
    f.targetVersion = str(data, 'targetVersion', { max: 40, label: 'Versión propuesta' });
    version(f.targetVersion, 'Versión propuesta', 'targetVersion', { greaterThan: f.currentVersion });
    f.spec = str(data, 'spec', { max: 3000, label: 'Especificación técnica' });
    f.specUrl = link(str(data, 'specUrl', { max: 500, label: 'Enlace de la especificación' }), 'Enlace de la especificación');
    f.businessRulesAffected = bool(data.businessRulesAffected);
    f.businessRules = f.businessRulesAffected ? str(data, 'businessRules', { required: true, max: 2000, label: 'Reglas de negocio afectadas' }) : 'No aplica';
    f.acceptanceCriteria = list(data, 'acceptanceCriteria', { required: true, label: 'Criterios de aceptación' });
    f.components = str(data, 'components', { max: 1000, label: 'Componentes técnicos afectados' });
    f.proposedPriority = pick(data.proposedPriority || 'Media', C.LEVELS, 'una prioridad propuesta', { field: 'proposedPriority' });
  }
  return { fields: f };
}
function blankRequest() {
  return { infoRequests: [], evaluation: null, previousEvaluations: [], decisions: [], assignments: [], implementation: { rounds: [] }, gitRefs: [], changes: [], deviations: [], tests: [], testRounds: [], reviews: [], backouts: [], closure: null, closures: [], reopenings: [], notices: [], flags: [] };
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
  const { fields } = requestFields(db, data, kind, date);
  const inserted = db.prepare('INSERT INTO requests(owner_id,document) VALUES(?,?)').run(user.id, '{}');
  const number = Number(inserted.lastInsertRowid);
  let trackingToken = null;
  const r = { schema: SCHEMA, ...fields, id: crfCode(number), date, createdAt: now(), name: user.name, email: user.email, ownerId: user.id, requesterType: kind, priority: null, status: 'Registrada', revision: 0, history: [], ...blankRequest() };
  if (guest) { trackingToken = randomBytes(18).toString('hex'); r.submittedWithoutAccount = true; r.trackingHash = digest(trackingToken); }
  r.history.push({ status: 'Registrada', from: null, date: r.createdAt, responsible: nameOf(user), responsibleId: user.id, action: 'Creación de CRF', note: `CRF ${kind === 'experto' ? 'técnico' : 'de usuario final'} registrado.` });
  audit(db, { entityType: 'CRF', entityId: r.id, action: 'Creación de CRF', actor: user, to: 'Registrada', justification: `${r.title} · Módulos: ${r.modules.join(', ')}` });
  files.storeFiles(db, { requestNumber: number, requestCode: r.id, context: 'Solicitud', files: data.files, user, fail });
  save(db, r);
  return { request: present(r), trackingToken };
}

// ---------- Ficha del CCC ----------
const EVAL_TEXT = {
  classificationJustification: 'Justificación de la clasificación', standardReference: 'Procedimiento estándar de referencia', plannedChanges: 'Conjunto de modificaciones previstas',
  technicalImpact: 'Impacto técnico previsto', functionalImpact: 'Impacto funcional u operativo',
  feasibilityJustification: 'Justificación de viabilidad', resources: 'Recursos necesarios', considerations: 'Consideraciones adicionales',
  rolloutPlan: 'Plan de rollout', backoutPlan: 'Plan de backout',
  testObjective: 'Objetivo de las pruebas', testTypes: 'Tipos de prueba previstos', testSuccess: 'Condiciones de éxito', testEvidence: 'Evidencias esperadas',
  plannedDate: 'Fecha prevista de implementación', targetVersion: 'Versión objetivo'
};
const EVAL_LIST = { risks: 'Riesgos identificados', testCriteria: 'Criterios de aceptación para pruebas' };
const EVAL_ENUM = { itilType: [Object.keys(C.ITIL), 'un tipo de cambio ITIL'], impact: [C.IMPACT, 'un impacto'], urgency: [C.LEVELS, 'una urgencia'], priority: [C.LEVELS, 'una prioridad'], feasibility: [C.FEASIBILITY, 'una viabilidad'], downtimeUnit: [C.DOWNTIME_UNITS, 'una unidad de inactividad'] };
const EVAL_NUM = { effortHours: 'Esfuerzo estimado (horas-persona)', durationDays: 'Duración estimada (días calendario)', downtimeValue: 'Tiempo de inactividad previsto' };
const EVAL_KEYS = [...Object.keys(EVAL_TEXT), ...Object.keys(EVAL_LIST), ...Object.keys(EVAL_ENUM), ...Object.keys(EVAL_NUM), 'standardSameConditions', 'affectedModules'];
function parseEvaluation(db, data, r) {
  const e = {};
  for (const [k, label] of Object.entries(EVAL_TEXT)) e[k] = str(data, k, { max: ['targetVersion', 'plannedDate'].includes(k) ? 40 : ['rolloutPlan', 'backoutPlan'].includes(k) ? 20000 : 5000, label });
  for (const [k, label] of Object.entries(EVAL_LIST)) e[k] = list(data, k, { label });
  for (const [k, [values, label]] of Object.entries(EVAL_ENUM)) e[k] = pick(data[k], values, label, { required: false, field: k });
  for (const [k, label] of Object.entries(EVAL_NUM)) e[k] = num(data, k, { label, max: k === 'durationDays' ? 3650 : 100000 });
  e.standardSameConditions = bool(data.standardSameConditions);
  if (e.plannedDate && (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(e.plannedDate) || Number.isNaN(Date.parse(e.plannedDate)))) fail(400, 'Fecha prevista de implementación: fecha inválida.', 'plannedDate');
  version(e.targetVersion, 'Versión objetivo', 'targetVersion', { allow: ['Pendiente'], greaterThan: r?.currentVersion });
  if (e.standardReference) e.standardReference = e.standardReference.toUpperCase();
  // Módulos confirmados por el CCC, cada uno con la operación prevista.
  const raw = Array.isArray(data.affectedModules) ? data.affectedModules : [];
  const names = raw.length ? parseModules({ affectedModules: raw.map(x => x?.module) }, { field: 'affectedModules', label: 'Módulos afectados', allowUnsure: false }) : [];
  e.affectedModules = names.map(module => ({ module, operation: pick(raw.find(x => x?.module === module)?.operation || 'Modificación', C.OPERATIONS, 'una operación prevista', { field: 'affectedModules' }) }));
  return { e };
}
function missingAnalysis(e) {
  const m = [];
  const need = (ok, label) => { if (!ok) m.push(label); };
  need(e.itilType, 'Tipo de cambio ITIL');
  need(e.classificationJustification, EVAL_TEXT.classificationJustification);
  need(e.affectedModules?.length, 'Módulos afectados confirmados por el CCC');
  need(e.plannedChanges, EVAL_TEXT.plannedChanges);
  for (const k of ['impact', 'urgency', 'priority', 'feasibility']) need(e[k], { impact: 'Impacto estimado', urgency: 'Urgencia', priority: 'Prioridad', feasibility: 'Viabilidad técnica' }[k]);
  for (const k of ['technicalImpact', 'functionalImpact', 'feasibilityJustification', 'resources']) need(e[k], EVAL_TEXT[k]);
  need(e.risks?.length, EVAL_LIST.risks);
  need(e.effortHours !== null && e.effortHours !== undefined, EVAL_NUM.effortHours);
  need(e.durationDays !== null && e.durationDays !== undefined, EVAL_NUM.durationDays);
  return m;
}
// Contenido real de un plan en Markdown: sin títulos, viñetas vacías ni la plantilla sin completar.
const planContent = text => String(text || '').split(/\r?\n/).map(l => l.replace(/^\s*(#{1,6}\s.*|[-*+]\s*|\d+[.)]\s*|>\s*)$/, '').replace(/^\s*(#{1,6}\s+)/, '')).join(' ').replace(/\s+/g, ' ').trim();
// Emergencia: planes resumidos pero trazables. Normal y estándar: planes completos.
function missingPlanning(e) {
  const m = [], need = (ok, label) => { if (!ok) m.push(label); };
  const minimum = e.itilType === 'Emergencia' ? 15 : 40;
  need(planContent(e.rolloutPlan).length >= minimum, `${EVAL_TEXT.rolloutPlan} (describe objetivo, actividades en orden y verificaciones)`);
  need(planContent(e.backoutPlan).length >= minimum, `${EVAL_TEXT.backoutPlan} (condiciones de activación, acciones de reversión y verificación)`);
  need(e.testCriteria?.length, EVAL_LIST.testCriteria);
  need(e.downtimeValue !== null && e.downtimeValue !== undefined, EVAL_NUM.downtimeValue);
  need(e.downtimeUnit, 'Unidad del tiempo de inactividad');
  need(e.plannedDate, EVAL_TEXT.plannedDate);
  if (e.itilType !== 'Emergencia') {
    for (const k of ['testObjective', 'testTypes', 'testSuccess', 'testEvidence']) need(e[k], EVAL_TEXT[k]);
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
function evaluationAction(db, r, number, user, data) {
  requireCCC(r, user);
  requireState(r, ['En análisis', 'En planificación', 'Pendiente de aprobación']);
  const step = pick(data.step || 'draft', ['draft', 'analysis', 'planning'], 'una acción de la ficha', { field: 'step' });
  const { e } = parseEvaluation(db, data, r);
  const before = r.evaluation || {};
  r.evaluation = { ...before, ...e, member: before.member || user.name, memberId: before.memberId || user.id, startedAt: before.startedAt || now(), updatedAt: now(), migrated: undefined };
  const changed = EVAL_KEYS.some(k => JSON.stringify(before[k] ?? null) !== JSON.stringify(e[k] ?? null));
  auditChanges(db, { entityType: 'CRF', entityId: r.id, action: 'Modificación de la ficha del CCC', actor: user, from: r.status, to: r.status }, before, e, EVAL_KEYS);
  if (changed && r.status === 'Pendiente de aprobación') transition(db, r, user, 'En planificación', 'Modificación de la ficha', 'La ficha cambió después de completar la planificación; debe completarse nuevamente antes de decidir.');
  if (step === 'draft') { log(db, r, user, 'Guardado de borrador', 'Ficha del CCC guardada como borrador.'); return; }
  const missingA = missingAnalysis(r.evaluation);
  if (missingA.length) fail(400, `Para completar el análisis falta: ${missingA.join('; ')}.`);
  const reference = checkStandardReference(db, r.evaluation);
  if (r.evaluation.itilType === 'Emergencia' && r.evaluation.classificationJustification.length < 30) fail(400, 'Un cambio de emergencia requiere explicar en al menos 30 caracteres la situación que exige el procedimiento acelerado.', 'classificationJustification');
  r.priority = r.evaluation.priority;
  if (r.status === 'En análisis') {
    r.evaluation.analysisCompletedAt = now();
    transition(db, r, user, 'En planificación', 'Análisis completado', `Tipo ${r.evaluation.itilType}; impacto ${r.evaluation.impact}; viabilidad ${r.evaluation.feasibility}${reference ? `; procedimiento estándar ${reference}` : ''}.`);
  }
  if (step === 'planning') {
    const missingP = missingPlanning(r.evaluation);
    if (missingP.length) fail(400, `Para completar la planificación falta: ${missingP.join('; ')}.`);
    r.evaluation.planningCompletedAt = now();
    transition(db, r, user, 'Pendiente de aprobación', 'Planificación completada', 'Planes de rollout, backout y pruebas documentados.');
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
  const decision = pick(data.decision, C.DECISIONS, 'una decisión', { field: 'decision' });
  const justification = str(data, 'justification', { required: true, min: 10, max: 5000, label: 'Justificación de la decisión' });
  const base = { n: r.decisions.length + 1, kind: 'Autorización', decision, justification, conditions: [], decidedBy: user.name, decidedById: user.id, at: now(), itilType: r.evaluation?.itilType || '', evaluationSnapshot: r.evaluation ? { ...r.evaluation } : null };
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
  const e = r.evaluation || {};
  const missing = [...missingAnalysis(e), ...missingPlanning(e)];
  if (missing.length) fail(409, `No se puede aprobar: falta ${missing.join('; ')}.`);
  // Un cambio marcado como no viable no se aprueba: se corrige el análisis o se rechaza.
  if (e.feasibility === 'No viable') fail(409, 'No se puede aprobar un cambio con viabilidad técnica «No viable». Corrige el análisis (sección B) o rechaza la solicitud.', 'decision');
  if (decision === 'Aprobado con condiciones') {
    base.conditions = parseConditions(data);
    if (!base.conditions.length) fail(400, 'Una aprobación condicionada requiere al menos una condición con su forma de verificación.');
  } else if (Array.isArray(data.conditions) && data.conditions.length) fail(400, 'Una aprobación sin restricciones no admite condiciones; usa «Aprobado con condiciones».');
  base.preauthorizedBy = e.itilType === 'Estándar' && e.standardReference ? e.standardReference : null;
  base.authorizedModules = (e.affectedModules || []).map(x => ({ ...x }));
  r.decisions.push(base);
  notify(r, `Solicitud ${decision === 'Aprobado' ? 'aprobada' : 'aprobada con condiciones'} por el CCC. La aprobación no implica que el cambio ya esté implementado.`);
  transition(db, r, user, C.DECISION_STATUS[decision], decision === 'Aprobado' ? 'Aprobación' : 'Aprobación condicionada', `${justification}${base.conditions.length ? ` · Condiciones: ${base.conditions.map(c => c.text).join(' | ')}` : ''} · Módulos autorizados: ${base.authorizedModules.map(x => x.module).join(', ')}`);
}
function supersede(db, r, number, user, reason) {
  const auth = currentAuthorization(r);
  if (auth) Object.assign(auth, { superseded: true, supersededAt: now(), supersededBy: user.name, supersededReason: reason });
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
  const assignment = { n: r.assignments.length + 1, developerId: dev.id, developerName: dev.name, assignedBy: user.name, assignedById: user.id, at: now(), targetDate: isoDate(str(data, 'targetDate', { max: 10 }), 'Fecha objetivo', localDate()), notes: str(data, 'notes', { max: 3000, label: 'Observaciones de implementación' }), priority: pick(data.priority || r.priority || 'Media', C.LEVELS, 'una prioridad', { field: 'priority' }), decisionN: auth.n, reason, previous: previous ? previous.developerName : null };
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
  const activity = { id: `ACT-${r.implementation.rounds.reduce((n, x) => n + x.activities.length, 0) + 1}`, date: isoDate(str(data, 'date', { max: 10 }), 'Fecha de la actividad') || localDate(), description: str(data, 'description', { required: true, min: 5, max: 3000, label: 'Descripción de la actividad' }), hours: num(data, 'hours', { required: true, label: 'Tiempo utilizado (horas)', max: 1000 }), status: pick(data.status || 'Completada', C.ACTIVITY_STATES, 'un estado de actividad', { field: 'status' }), observations: str(data, 'observations', { max: 2000 }), evidence: str(data, 'evidence', { max: 1000 }), by: user.name, at: now() };
  round.activities.push(activity);
  log(db, r, user, 'Registro de actividad', `${activity.id}: ${activity.description} (${activity.hours} h, ${activity.status}).`);
}
function gitAction(db, r, user, data) {
  requireAssignee(r, user);
  requireState(r, ['En implementación', 'En pruebas', 'En revisión', 'Correcciones requeridas']);
  const { kind, value, url } = gitInput(data);
  const v = data[GITHUB_RESULT] || null;
  const ref = { id: nextId(r.gitRefs, 'GIT'), kind, value, url: url || v?.details?.url || '', note: str(data, 'note', { max: 1000 }), by: user.name, at: now(), verified: v?.ok === true, verification: v };
  r.gitRefs.push(ref);
  log(db, r, user, 'Registro de evidencia', `${kind}: ${value}${ref.url ? ` (${ref.url})` : ''}. ${ref.verified ? `Verificado en GitHub${v.details?.state ? ` (${v.details.state})` : ''}.` : v?.message || 'Sin verificación en GitHub.'}`);
}
// Validación de la referencia antes de consultarla en GitHub (también la usa el servidor).
function gitInput(data) {
  const kind = pick(data.kind, C.GIT_KINDS, 'un tipo de referencia', { field: 'kind' });
  const value = str(data, 'value', { required: true, max: 300, label: 'Referencia' });
  const url = link(str(data, 'url', { max: 500, label: 'Enlace' }), 'Enlace');
  if (kind === 'Commit' && !/^[0-9a-f]{7,40}$/i.test(value)) fail(400, 'Commit: indica el identificador SHA (7 a 40 caracteres hexadecimales).', 'value');
  if (kind === 'Pull request' && !/^#?\d+$/.test(value) && !(url && /\/pull\/\d+/.test(new URL(url).pathname))) fail(400, 'Pull request: indica el número (#42) o la URL …/pull/42.', 'value');
  if (kind === 'Rama' && !/^[\w.\/-]{1,200}$/.test(value)) fail(400, 'Rama: nombre inválido.', 'value');
  if (kind === 'Enlace de evidencia' && !url) fail(400, 'Enlace de evidencia: indica la URL.', 'url');
  return { kind, value, url };
}
function gitRefreshAction(db, r, user, data) {
  if (!isDev(user) && !isCCC(user)) fail(403, 'No puedes verificar referencias.');
  const ref = r.gitRefs.find(g => g.id === data.refId);
  if (!ref) fail(404, 'Referencia no encontrada.');
  const v = data[GITHUB_RESULT];
  if (!v) fail(409, 'No se pudo consultar GitHub.');
  const before = ref.verification?.details?.state || (ref.verified ? 'verificada' : 'sin verificar');
  Object.assign(ref, { verified: v.ok === true, verification: v });
  if (ref.kind === 'Pull request' && r.pullRequest && `#${r.pullRequest.number}` === ref.value && v.details) Object.assign(r.pullRequest, { state: v.details.state || r.pullRequest.state, verified: v.ok === true, verification: v });
  log(db, r, user, 'Verificación de referencia', `${ref.id} ${ref.kind} ${ref.value}: ${v.ok ? `verificada${v.details?.state ? ` (${v.details.state})` : ''}` : v.message}.`, { field: ref.id, oldValue: before, newValue: v.details?.state || v.status });
}
// Formato de la rama: identificador-titulo-descripcionCorta (p. ej. CRF-000001-cancelar-boletos-liberar-asiento).
const slug = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function branchName(r, shortDescription) {
  const title = slug(r.title).split('-').slice(0, 6).join('-'), short = slug(shortDescription).split('-').slice(0, 6).join('-');
  return `${r.id}-${title}-${short}`.replace(/-+/g, '-').slice(0, 100).replace(/-+$/, '');
}
function branchInput(r, data) {
  const shortDescription = str(data, 'shortDescription', { required: true, min: 3, max: 60, label: 'Descripción corta' });
  if (slug(shortDescription).length < 3) fail(400, 'Descripción corta: usa letras o números.', 'shortDescription');
  const base = str(data, 'base', { max: 100, label: 'Rama base' }) || 'main';
  if (!/^[\w.\/-]{1,100}$/.test(base)) fail(400, 'Rama base: nombre inválido.', 'base');
  return { name: branchName(r, shortDescription), base, shortDescription, create: bool(data.create) };
}
function branchAction(db, r, user, data) {
  requireAssignee(r, user);
  requireState(r, ['En implementación']);
  if (r.pullRequest && r.pullRequest.state !== 'cerrado sin fusionar') fail(409, 'La rama ya tiene un pull request; no puede reemplazarse.');
  const input = branchInput(r, data), v = data[GITHUB_RESULT] || null;
  const previous = r.workBranch?.name || null;
  r.workBranch = { name: input.name, base: input.base, shortDescription: input.shortDescription, created: !!v?.created, verified: v?.ok === true, verification: v, by: user.name, at: now() };
  r.gitRefs.push({ id: nextId(r.gitRefs, 'GIT'), kind: 'Rama', value: input.name, url: v?.details?.url || '', note: `Rama de trabajo (base ${input.base})`, by: user.name, at: now(), verified: v?.ok === true, verification: v });
  log(db, r, user, 'Rama de trabajo', `${v?.created ? 'Creada en GitHub' : 'Registrada'}: ${input.name} (desde ${input.base}). ${v?.ok ? 'Verificada en GitHub.' : v?.message || 'Sin verificación en GitHub.'}`, { field: 'rama', oldValue: previous, newValue: input.name });
}
// El PR debe ir de la rama de trabajo a la rama base acordada; el servidor verifica head y base en GitHub.
function pullRequestAction(db, r, user, data) {
  requireAssignee(r, user);
  requireState(r, ['En implementación']);
  if (!r.workBranch) fail(409, 'Registra primero la rama de trabajo del cambio.');
  const v = data[GITHUB_RESULT] || null, d = v?.details || {};
  const number = Number(d.number || String(data.number || '').replace('#', ''));
  if (!Number.isInteger(number) || number < 1) fail(400, 'Indica el número del pull request.', 'number');
  const head = d.head || r.workBranch.name, base = d.base || str(data, 'base', { max: 100 }) || r.workBranch.base;
  if (head !== r.workBranch.name) fail(400, `El PR #${number} sale de la rama «${head}», pero la rama de trabajo es «${r.workBranch.name}».`, 'number');
  r.pullRequest = { number, url: d.url || '', title: d.title || '', head, base, state: d.state || 'sin verificar', created: !!v?.created, verified: v?.ok === true, verification: v, by: user.name, at: now() };
  r.gitRefs.push({ id: nextId(r.gitRefs, 'GIT'), kind: 'Pull request', value: `#${number}`, url: d.url || '', note: `${head} → ${base}`, by: user.name, at: now(), verified: v?.ok === true, verification: v });
  log(db, r, user, 'Pull request', `${v?.created ? 'Creado en GitHub' : 'Registrado'}: #${number} de ${head} a ${base}${d.state ? ` (${d.state})` : ''}. ${v?.ok ? 'Verificado en GitHub.' : v?.message || 'Sin verificación en GitHub.'}`);
}
function moduleChangeAction(db, r, user, data) {
  requireAssignee(r, user);
  requireState(r, ['En implementación']);
  const [module] = parseModules({ module: data.module }, { field: 'module', label: 'Módulo modificado', allowUnsure: false });
  const change = { id: nextId(r.changes, 'MOD'), round: currentRound(r).n, module, operation: pick(data.operation, C.OPERATIONS, 'un tipo de operación', { field: 'operation' }), description: str(data, 'description', { required: true, min: 5, max: 3000, label: 'Descripción de la modificación' }), evidence: str(data, 'evidence', { max: 1000, label: 'Evidencia asociada' }), by: user.name, at: now() };
  change.inScope = authorizedModules(r).includes(module);
  (r.changes ||= []).push(change);
  if (!change.inScope) {
    r.deviations.push({ id: nextId(r.deviations, 'DES'), module, description: `Modificación de «${module}» fuera de los módulos autorizados: ${change.description}`, status: 'Pendiente', by: user.name, at: now() });
    log(db, r, user, 'Desviación de alcance', `«${module}» no estaba autorizado. Requiere decisión del CCC antes de continuar.`);
  }
  log(db, r, user, 'Registro de módulo modificado', `${change.id} ${module} · ${change.operation}: ${change.description}`, { field: module, newValue: change.operation });
}
function deviationAction(db, r, user, data) {
  requireAssignee(r, user);
  requireState(r, ['En implementación', 'En pruebas', 'Correcciones requeridas']);
  const description = str(data, 'description', { required: true, min: 10, max: 3000, label: 'Descripción de la desviación' });
  r.deviations.push({ id: nextId(r.deviations, 'DES'), module: null, description, status: 'Pendiente', by: user.name, at: now() });
  log(db, r, user, 'Desviación de alcance', description);
}
function scopeAction(db, r, user, data) {
  requireCCC(r, user);
  requireState(r, ['En implementación', 'En pruebas', 'En revisión', 'Correcciones requeridas']);
  const d = r.deviations.find(x => x.id === data.deviationId);
  if (!d || d.status !== 'Pendiente') fail(409, 'La desviación no existe o ya fue decidida.');
  const decision = pick(data.decision, ['Autorizada', 'No autorizada'], 'una decisión de alcance', { field: 'decision' });
  const justification = str(data, 'justification', { required: true, min: 10, max: 3000, label: 'Justificación' });
  Object.assign(d, { status: decision, decidedBy: user.name, decidedAt: now(), justification });
  const record = { n: r.decisions.length + 1, kind: 'Ampliación de alcance', decision: decision === 'Autorizada' ? 'Aprobado' : 'Rechazado', justification, deviationId: d.id, module: d.module || null, conditions: [], decidedBy: user.name, decidedById: user.id, at: now() };
  r.decisions.push(record);
  if (decision === 'Autorizada' && d.module) for (const c of r.changes || []) if (c.module === d.module) c.inScope = true;
  log(db, r, user, 'Decisión de alcance', `${d.id} ${decision.toLowerCase()}: ${justification}`);
}
function sendToTests(db, r, user, data) {
  requireAssignee(r, user);
  requireState(r, ['En implementación']);
  const round = currentRound(r);
  if (!round.activities.length) fail(409, 'Registra al menos una actividad de implementación en esta ronda.');
  if (!(r.changes || []).length) fail(409, 'Registra los módulos realmente modificados antes de enviar a pruebas.');
  if (!r.workBranch) fail(409, 'Registra la rama de trabajo antes de enviar a pruebas.');
  if (!r.pullRequest) fail(409, 'Crea o registra el pull request de la rama de trabajo antes de enviar a pruebas.');
  if (r.deviations.some(d => d.status === 'Pendiente')) fail(409, 'Hay desviaciones de alcance pendientes de decisión del CCC.');
  round.sentToTestsAt = now();
  transition(db, r, user, 'En pruebas', 'Envío a pruebas', str(data, 'note', { max: 2000 }) || `Ronda ${round.n} lista para pruebas.`);
}
function testAction(db, r, user, data) {
  if (!isDev(user)) fail(403, 'Las pruebas las registran los desarrolladores.');
  requireState(r, ['En pruebas']);
  const status = pick(data.status, C.TEST_STATES, 'un estado de prueba', { field: 'status' });
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
  const outcome = pick(data.outcome, C.TEST_OUTCOMES, 'un resultado de pruebas', { field: 'outcome' });
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
  const b = { id: nextId(r.backouts, 'BKO'), round: currentRound(r)?.n || null, trigger: str(data, 'trigger', { required: true, min: 10, max: 2000, label: 'Motivo de activación' }), at: now(), by: user.name, actions: str(data, 'actions', { required: true, min: 10, max: 3000, label: 'Acciones realizadas' }), recovered: str(data, 'recovered', { required: true, max: 300, label: 'Configuración o versión recuperada' }), result: pick(data.result, C.BACKOUT_RESULTS, 'un resultado de reversión', { field: 'result' }), evidence: str(data, 'evidence', { max: 1000 }), systemState: str(data, 'systemState', { required: true, max: 2000, label: 'Estado posterior del sistema' }) };
  r.backouts.push(b);
  log(db, r, user, 'Ejecución de backout', `${b.id}: ${b.result}. Recuperado: ${b.recovered}. El sistema solo documenta la reversión; no restaura código ni datos.`);
}
function reviewCriteria(r) { return [...new Set([...(r.acceptanceCriteria || []), ...(r.evaluation?.testCriteria || [])])]; }
function reviewAction(db, r, user, data) {
  if (!isDev(user)) fail(403, 'La revisión postimplementación la registra un desarrollador.');
  requireState(r, ['En revisión']);
  const criteria = reviewCriteria(r), auth = currentAuthorization(r);
  const rawCriteria = Array.isArray(data.criteria) ? data.criteria : [];
  if (rawCriteria.length !== criteria.length) fail(400, 'Indica el cumplimiento de cada criterio de aceptación.');
  const criteriaResult = criteria.map((text, i) => ({ text, met: bool(rawCriteria[i]?.met), note: str(rawCriteria[i] || {}, 'note', { max: 1000 }) }));
  const rawConditions = Array.isArray(data.conditions) ? data.conditions : [];
  const conditions = (auth?.conditions || []).map(c => { const x = rawConditions.find(y => y?.id === c.id) || {}; return { id: c.id, text: c.text, verification: c.verification, met: bool(x.met), evidence: str(x, 'evidence', { max: 1000 }) }; });
  const decision = pick(data.decision, C.REVIEW_DECISIONS, 'una decisión de revisión', { field: 'decision' });
  const lastTests = r.testRounds.at(-1);
  const review = { n: r.reviews.length + 1, round: currentRound(r).n, reviewer: user.name, reviewerId: user.id, independent: currentAssignment(r)?.developerId !== user.id, at: now(), summary: str(data, 'summary', { required: true, min: 10, max: 3000, label: 'Resumen de implementación' }), testResult: lastTests?.outcome || 'Sin pruebas', criteria: criteriaResult, rolloutCompliance: pick(data.rolloutCompliance, C.ROLLOUT_COMPLIANCE, 'el cumplimiento del rollout', { field: 'rolloutCompliance' }), conditions, modifiedModules: (r.changes || []).map(c => `${c.module} · ${c.operation}${c.inScope ? '' : ' (fuera de alcance)'}`), deviationsFound: str(data, 'deviationsFound', { max: 3000 }), pendingIssues: str(data, 'pendingIssues', { max: 3000 }), recommendation: str(data, 'recommendation', { required: true, max: 3000, label: 'Recomendación final' }), evidence: str(data, 'evidence', { max: 1000 }), decision };
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
function closeAction(db, r, user, data) {
  requireAssignee(r, user);
  requireState(r, ['En revisión']);
  const round = currentRound(r).n, review = r.reviews.at(-1);
  if (!review || review.round !== round) fail(409, 'Registra la revisión postimplementación de esta ronda antes de cerrar.');
  const result = pick(data.result, C.CLOSURE_RESULTS, 'un resultado de cierre', { field: 'result' });
  const justification = str(data, 'justification', { required: result !== 'Exitoso', min: result !== 'Exitoso' ? 10 : 0, max: 3000, label: 'Justificación del cierre' });
  if (result === 'Exitoso') {
    if (review.decision !== 'Conforme') fail(409, 'El cierre exitoso requiere una revisión «Conforme».');
    if (r.backouts.some(b => b.round === round)) fail(409, 'Se ejecutó un backout en esta ronda; el cierre no puede ser exitoso.');
  }
  const resultingVersion = str(data, 'resultingVersion', { max: 40, label: 'Versión resultante' });
  version(resultingVersion, 'Versión resultante', 'resultingVersion', { greaterThan: r.currentVersion });
  r.closure = { result, administrative: 'Cerrada', by: user.name, byId: user.id, at: now(), summary: str(data, 'summary', { required: true, min: 10, max: 3000, label: 'Resumen del trabajo' }), modifications: (r.changes || []).map(c => `${c.module} · ${c.operation}: ${c.description}`), evidence: str(data, 'evidence', { max: 1000 }), testsResult: r.testRounds.at(-1)?.outcome || 'Sin pruebas', reviewResult: review.decision, gitRefs: r.gitRefs.map(g => `${g.kind}: ${g.value}${g.verified ? ' (verificada)' : ''}`), modulesModified: [...new Set((r.changes || []).map(c => c.module))], resultingVersion, justification };
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

// Comprobación previa (sin guardar) de las acciones que crean algo en GitHub.
function preflight(db, id, user, action, data) {
  const { r } = getRequest(db, id, user);
  if (data.revision !== r.revision) fail(409, 'La solicitud cambió. Actualiza el expediente antes de guardar.');
  requireAssignee(r, user);
  requireState(r, ['En implementación']);
  if (action === 'pull-request' && !r.workBranch) fail(409, 'Registra primero la rama de trabajo del cambio.');
  if (action === 'branch' && r.pullRequest && r.pullRequest.state !== 'cerrado sin fusionar') fail(409, 'La rama ya tiene un pull request; no puede reemplazarse.');
  return present(r);
}
// ---------- Despachador ----------
function mutate(db, id, action, user, data) {
  const { r, number } = getRequest(db, id, user);
  if (data.revision !== r.revision) fail(409, 'La solicitud cambió. Actualiza el expediente antes de guardar.');
  switch (action) {
    case 'edit': case 'delete': {
      if (action === 'edit' && isCCC(user)) { cccCorrection(db, r, number, user, data); break; }
      if (r.ownerId !== user.id) fail(403, 'Solo el solicitante puede modificar esta petición.');
      if (r.status !== 'Registrada' || r.history.some(h => h.action && !['Creación de CRF', 'Petición actualizada', 'Migración'].includes(h.action))) fail(409, 'La petición está bloqueada porque el CCC ya la recibió. Su contenido original se conserva.');
      if (action === 'delete') {
        files.removeFiles(db, number);
        db.prepare('DELETE FROM requests WHERE id=?').run(number);
        audit(db, { entityType: 'CRF', entityId: r.id, action: 'Eliminación de CRF', actor: user, from: r.status, justification: `Eliminada por su solicitante antes de la recepción del CCC: ${r.title}` });
        return null;
      }
      const { fields } = requestFields(db, data, r.requesterType, r.date);
      auditChanges(db, { entityType: 'CRF', entityId: r.id, action: 'Modificación de información', actor: user, from: r.status, to: r.status }, r, fields, Object.keys(fields));
      Object.assign(r, fields);
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
    case 'git-refresh': gitRefreshAction(db, r, user, data); break;
    case 'branch': branchAction(db, r, user, data); break;
    case 'pull-request': pullRequestAction(db, r, user, data); break;
    case 'module-change': moduleChangeAction(db, r, user, data); break;
    case 'deviation': deviationAction(db, r, user, data); break;
    case 'scope': scopeAction(db, r, user, data); break;
    case 'send-to-tests': sendToTests(db, r, user, data); break;
    case 'test': testAction(db, r, user, data); break;
    case 'finish-tests': finishTests(db, r, user, data); break;
    case 'backout': backoutAction(db, r, user, data); break;
    case 'review': reviewAction(db, r, user, data); break;
    case 'close': closeAction(db, r, user, data); break;
    case 'close-rejected': closeRejected(db, r, user, data); break;
    case 'reopen': reopenAction(db, r, number, user, data); break;
    default: fail(404, 'Acción no encontrada.');
  }
  return present(save(db, r));
}
// El CCC puede corregir cualquier CRF abierto. Los datos originales se conservan en `original`
// y cada corrección queda registrada con su motivo y los campos modificados (RN-22, RN-35).
const CRF_KEYS = ['project', 'modules', 'module', 'title', 'currentBehavior', 'featureMissing', 'description', 'justification', 'result', 'desiredDate', 'observations', 'proposedItilType', 'modificationType', 'environment', 'currentVersion', 'targetVersion', 'spec', 'specUrl', 'businessRulesAffected', 'businessRules', 'acceptanceCriteria', 'components', 'proposedPriority'];
function cccCorrection(db, r, number, user, data) {
  requireCCC(r, user);
  if (r.status === 'Cerrada') fail(409, 'La solicitud está cerrada; reábrela para corregirla.');
  const reason = str(data, 'correctionReason', { required: true, min: 10, max: 2000, label: 'Motivo de la corrección' });
  if (!r.modules) r.modules = modulesOf(r);
  const { fields } = requestFields(db, data, r.requesterType, r.date);
  const changed = Object.keys(fields).filter(k => k !== 'module' && JSON.stringify(r[k] ?? null) !== JSON.stringify(fields[k] ?? null));
  if (!changed.length) fail(400, 'No hay cambios que guardar.');
  r.original ||= { ...Object.fromEntries(CRF_KEYS.filter(k => k in r && k !== 'module').map(k => [k, r[k]])), savedAt: now() };
  auditChanges(db, { entityType: 'CRF', entityId: r.id, action: 'Corrección del CCC', actor: user, from: r.status, to: r.status, justification: reason }, r, fields, Object.keys(fields).filter(k => k !== 'module'));
  Object.assign(r, fields);
  (r.corrections ||= []).push({ by: user.name, byId: user.id, at: now(), reason, fields: changed });
  notify(r, `El CCC corrigió datos de tu solicitud: ${reason}`);
  log(db, r, user, 'Corrección del CCC', `Campos: ${changed.join(', ')}. Motivo: ${reason}`);
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
  const context = pick(data.context || 'Evidencia', ['Solicitud', 'Información adicional', 'Evidencia'], 'un contexto de adjunto', { field: 'context' });
  if (r.status === 'Cerrada') fail(409, 'La solicitud está cerrada; sus evidencias ya no pueden ampliarse.');
  if (!isCCC(user) && r.ownerId !== user.id && !isDev(user)) fail(403, 'No puedes adjuntar archivos a esta solicitud.');
  const saved = files.storeFiles(db, { requestNumber: number, requestCode: r.id, context, files: data.files, user, fail });
  if (!saved.length) fail(400, 'Selecciona al menos un archivo.');
  log(db, r, user, 'Registro de evidencia', `${saved.length} archivo(s) adjuntado(s): ${saved.map(s => s.filename).join(', ')}.`);
  return present(save(db, r));
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
// Solo información comunicable al solicitante: nada del análisis interno ni de los planes.
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
// Respuesta para el cliente: sin el hash de seguimiento y con la lista de módulos normalizada.
function present(r) { return { ...clean(r), modules: modulesOf(r) }; }
function allVisible(db, user) {
  return db.prepare('SELECT id,document FROM requests ORDER BY id').all().map(x => ({ number: x.id, r: JSON.parse(x.document) })).filter(x => canView(x.r, user));
}
function snapshot(db, user) { return { requests: allVisible(db, user).map(({ r }) => present(r)) }; }
function requestDetail(db, id, user) {
  const { r, number } = getRequest(db, id, user);
  return { request: present(r), attachments: files.listAttachments(db, number), audit: db.prepare("SELECT * FROM audit_events WHERE entity_type='CRF' AND entity_id=? ORDER BY id").all(r.id), reviewCriteria: reviewCriteria(r), authorizedModules: authorizedModules(r) };
}
// ---------- Issue de GitHub asociada al CRF ----------
// La creación y la sincronización ocurren fuera de la transacción (red); aquí solo se guarda el resultado.
function recordIssue(db, id, result) {
  const { r } = getRequest(db, id, null);
  const before = r.github?.issue?.number || null;
  r.github = { ...(r.github || {}), ...(result.issue ? { issue: result.issue } : {}), lastSync: { at: now(), ok: result.ok, message: result.message || '', state: result.issue?.state || r.github?.issue?.state || null } };
  if (result.issue && !before) log(db, r, null, 'Issue de GitHub', `Issue #${result.issue.number} creada en ${result.issue.repo}: ${result.issue.url}`);
  else if (!result.ok) audit(db, { entityType: 'CRF', entityId: r.id, action: 'Sincronización con GitHub', actor: null, justification: result.message });
  return present(save(db, r));
}
function findGitRef(db, id, user, refId) {
  const { r } = getRequest(db, id, user);
  const ref = (r.gitRefs || []).find(g => g.id === refId);
  if (!ref) fail(404, 'Referencia no encontrada.');
  return ref;
}
function issueData(db, id) { return present(getRequest(db, id, null).r); }
function attachmentFor(db, attachmentId, user) {
  const file = files.readAttachment(db, attachmentId);
  if (!file) fail(404, 'Adjunto no encontrado.');
  const r = file.row.request_id ? load(db, file.row.request_id) : null;
  if (!r || !canView(r, user)) fail(403, 'No tienes acceso a este adjunto.');
  return file;
}
function users(db) { return db.prepare("SELECT id,name,email,role FROM users WHERE active=1 AND role IN ('experto','ccc') ORDER BY name").all(); }

module.exports = { preflight, branchInput, slug, HttpError, fail, str, pick, list, num, link, isoDate, bool, now, isCCC, isDev, parseCode, canView, snapshot, createRequest, mutate, uploadAttachments, trackRequest, publicClarification, requestDetail, attachmentFor, users, allVisible, modulesOf, authorizedModules, currentAuthorization, currentAssignment, reviewCriteria, gitInput, findGitRef, recordIssue, issueData, GITHUB_RESULT, EVAL_TEXT, EVAL_LIST, EVAL_NUM };

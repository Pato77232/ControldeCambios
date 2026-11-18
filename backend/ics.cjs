'use strict';
// Identificación de la configuración: catálogo de ICS, revisiones, relaciones y líneas base.
const C = require('./catalog.cjs');
const { audit, auditChanges } = require('./audit.cjs');
const { fail, str, pick, link, now, isCCC, isDev } = require('./service.cjs');
const { crfCode } = require('./migrate.cjs');

const pad = n => String(n).padStart(3, '0');
function categories(db) { return db.prepare('SELECT id,name FROM ics_categories ORDER BY id').all(); }
function addCategory(db, user, data) {
  if (!isCCC(user)) fail(403, 'Solo el CCC administra las categorías de ICS.');
  const name = str(data, 'name', { required: true, min: 3, max: 80, label: 'Nombre de la categoría' });
  if (db.prepare('SELECT 1 FROM ics_categories WHERE name=?').get(name)) fail(409, 'La categoría ya existe.');
  db.prepare('INSERT INTO ics_categories(name,created_by,created_at) VALUES(?,?,?)').run(name, user.id, now());
  audit(db, { entityType: 'Categoría ICS', entityId: name, action: 'Creación de categoría', actor: user });
  return categories(db);
}
const SELECT = `SELECT i.*, c.name AS category, o.name AS owner, a.name AS author, r.revision AS currentRevision, r.date AS revisionDate, r.git_ref AS revisionGitRef, p.code AS parentCode
  FROM ics i JOIN ics_categories c ON c.id=i.category_id LEFT JOIN users o ON o.id=i.owner_id LEFT JOIN users a ON a.id=i.author_id
  LEFT JOIN ics_revisions r ON r.id=i.current_revision_id LEFT JOIN ics p ON p.id=i.parent_id`;
function listIcs(db) {
  const counts = new Map(db.prepare('SELECT ics_id, COUNT(DISTINCT request_id) AS n FROM request_ics GROUP BY ics_id').all().map(x => [x.ics_id, x.n]));
  const inBaselines = new Map(db.prepare("SELECT bi.ics_id, GROUP_CONCAT(b.code) AS codes FROM baseline_items bi JOIN baselines b ON b.id=bi.baseline_id WHERE b.status='Aprobada' GROUP BY bi.ics_id").all().map(x => [x.ics_id, x.codes]));
  return db.prepare(`${SELECT} ORDER BY i.id`).all().map(i => ({ ...i, requests: counts.get(i.id) || 0, baselines: inBaselines.get(i.id) ? inBaselines.get(i.id).split(',') : [] }));
}
function findIcs(db, code) {
  const ics = db.prepare(`${SELECT} WHERE i.code=?`).get(String(code));
  if (!ics) fail(404, 'ICS no encontrado.');
  return ics;
}
function icsDetail(db, code, user) {
  const ics = findIcs(db, code);
  const visible = new Set(require('./service.cjs').allVisible(db, user).map(x => x.number));
  const requests = db.prepare(`SELECT ri.kind, ri.operation, ri.from_revision AS fromRevision, ri.to_revision AS toRevision, ri.description, ri.in_scope AS inScope, ri.active, ri.request_id AS number, ri.created_at AS createdAt
    FROM request_ics ri WHERE ri.ics_id=? ORDER BY ri.id`).all(ics.id).filter(x => visible.has(x.number)).map(x => {
    const doc = JSON.parse(db.prepare('SELECT document FROM requests WHERE id=?').get(x.number).document);
    return { ...x, code: crfCode(x.number), title: doc.title, status: doc.status, result: doc.closure?.result || null, gitRefs: x.kind === 'modificado' ? (doc.gitRefs || []).map(g => `${g.kind}: ${g.value}`) : [] };
  });
  return {
    ics,
    revisions: db.prepare('SELECT r.*, u.name AS createdByName FROM ics_revisions r LEFT JOIN users u ON u.id=r.created_by WHERE ics_id=? ORDER BY r.id').all(ics.id).map(r => ({ ...r, requestCode: r.request_id ? crfCode(r.request_id) : null })),
    relations: db.prepare('SELECT rel.id, rel.type, rel.from_id, rel.to_id, f.code AS fromCode, f.name AS fromName, t.code AS toCode, t.name AS toName FROM ics_relations rel JOIN ics f ON f.id=rel.from_id JOIN ics t ON t.id=rel.to_id WHERE rel.from_id=? OR rel.to_id=?').all(ics.id, ics.id),
    children: db.prepare('SELECT code,name,status FROM ics WHERE parent_id=? ORDER BY code').all(ics.id),
    requests,
    baselines: db.prepare('SELECT b.code, b.name, b.status, b.decided_at, r.revision FROM baseline_items bi JOIN baselines b ON b.id=bi.baseline_id JOIN ics_revisions r ON r.id=bi.revision_id WHERE bi.ics_id=? ORDER BY b.id').all(ics.id),
    audit: db.prepare("SELECT * FROM audit_events WHERE entity_type='ICS' AND entity_id=? ORDER BY id").all(ics.code)
  };
}
function checkParent(db, id, parentId) {
  if (!parentId) return null;
  const parent = db.prepare('SELECT id,kind,status FROM ics WHERE id=?').get(parentId);
  if (!parent) fail(400, 'El ICS contenedor no existe.');
  if (parent.kind !== 'Agregado') fail(400, 'El contenedor debe ser un objeto agregado.');
  for (let cursor = parent.id, depth = 0; cursor; depth++) {
    if (cursor === id || depth > 50) fail(400, 'La relación padre-hijo crearía un ciclo en la jerarquía.');
    cursor = db.prepare('SELECT parent_id FROM ics WHERE id=?').get(cursor)?.parent_id;
  }
  return parent.id;
}
function icsFields(db, data, id) {
  const category = db.prepare('SELECT id FROM ics_categories WHERE id=?').get(Number(data.categoryId));
  if (!category) fail(400, 'Selecciona una categoría de ICS válida.');
  const owner = data.ownerId ? db.prepare("SELECT id FROM users WHERE id=? AND active=1 AND role IN ('experto','ccc')").get(String(data.ownerId)) : null;
  if (data.ownerId && !owner) fail(400, 'El responsable debe ser un integrante activo del equipo.');
  const f = {
    name: str(data, 'name', { required: true, min: 3, max: 150, label: 'Nombre' }),
    description: str(data, 'description', { required: true, min: 10, max: 3000, label: 'Descripción' }),
    category_id: category.id, kind: pick(data.kind, C.ICS_KINDS, 'un tipo de objeto (básico o agregado)'),
    owner_id: owner?.id || null, path: str(data, 'path', { max: 500, label: 'Ruta en el proyecto' }),
    url: link(str(data, 'url', { max: 500, label: 'URL' }), 'URL del repositorio o documento'), reference: str(data, 'reference', { max: 500, label: 'Referencia técnica' })
  };
  f.parent_id = checkParent(db, id, data.parentId ? Number(data.parentId) : null);
  if (db.prepare('SELECT code FROM ics WHERE project=? AND name=? COLLATE NOCASE AND id IS NOT ?').get(C.PROJECT, f.name, id ?? null)) fail(409, `Ya existe un ICS llamado «${f.name}». Evita duplicados: reutiliza el existente.`);
  if (f.path) { const dup = db.prepare('SELECT code FROM ics WHERE path=? AND id IS NOT ?').get(f.path, id ?? null); if (dup) fail(409, `La ruta ya está identificada como ${dup.code}.`); }
  return f;
}
function createIcs(db, user, data) {
  if (!isCCC(user) && !isDev(user)) fail(403, 'No puedes registrar ICS.');
  const f = icsFields(db, data, null);
  // Un desarrollador solo puede proponer; el CCC identifica. «Bajo control» solo llega con una línea base aprobada.
  const status = isCCC(user) ? pick(data.status || 'Identificado', ['Propuesto', 'Identificado'], 'un estado inicial') : 'Propuesto';
  const revision = str(data, 'revision', { max: 60, label: 'Revisión identificada' }) || 'No determinada';
  const temp = `TMP-${Date.now()}-${Math.random()}`;
  const id = Number(db.prepare('INSERT INTO ics(code,name,description,project,category_id,kind,parent_id,owner_id,author_id,created_at,path,url,reference,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(temp, f.name, f.description, C.PROJECT, f.category_id, f.kind, f.parent_id, f.owner_id, user.id, now(), f.path, f.url, f.reference, status).lastInsertRowid);
  const code = `ICS-BUS-${pad(id)}`;
  db.prepare('UPDATE ics SET code=? WHERE id=?').run(code, id);
  const revId = Number(db.prepare("INSERT INTO ics_revisions(ics_id,revision,git_ref,date,notes,status,created_by) VALUES(?,?,?,?,?,'Vigente',?)").run(id, revision, str(data, 'gitRef', { max: 200, label: 'Referencia Git' }), now(), 'Revisión identificada al registrar el ICS.', user.id).lastInsertRowid);
  db.prepare('UPDATE ics SET current_revision_id=? WHERE id=?').run(revId, id);
  audit(db, { entityType: 'ICS', entityId: code, action: 'Identificación de ICS', actor: user, to: status, justification: `${f.name} · revisión ${revision}` });
  return findIcs(db, code);
}
function updateIcs(db, user, code, data) {
  const ics = findIcs(db, code);
  if (data.version !== ics.version) fail(409, 'El ICS cambió. Actualiza antes de guardar.');
  const proposer = isDev(user) && ics.author_id === user.id && ics.status === 'Propuesto';
  if (!isCCC(user) && !proposer) fail(403, 'Solo el CCC modifica los metadatos de un ICS identificado.');
  if (ics.status === 'Retirado') fail(409, 'El ICS está retirado.');
  const f = icsFields(db, data, ics.id);
  let status = ics.status;
  if (data.status && data.status !== ics.status) {
    if (!isCCC(user)) fail(403, 'Solo el CCC cambia el estado de un ICS.');
    const allowed = { 'Propuesto': ['Identificado', 'Retirado'], 'Identificado': ['Retirado'], 'Bajo control de configuración': ['Retirado'] }[ics.status] || [];
    if (!allowed.includes(data.status)) fail(409, `No se puede pasar de «${ics.status}» a «${data.status}». «Bajo control de configuración» se obtiene al aprobar una línea base.`);
    status = data.status;
  }
  const justification = str(data, 'justification', { required: status !== ics.status || ics.status === 'Bajo control de configuración', min: 10, max: 2000, label: 'Justificación del cambio' });
  db.prepare('UPDATE ics SET name=?,description=?,category_id=?,kind=?,parent_id=?,owner_id=?,path=?,url=?,reference=?,status=?,version=version+1 WHERE id=?')
    .run(f.name, f.description, f.category_id, f.kind, f.parent_id, f.owner_id, f.path, f.url, f.reference, status, ics.id);
  auditChanges(db, { entityType: 'ICS', entityId: code, action: 'Modificación de metadatos', actor: user, justification }, ics, { ...f, status }, [...Object.keys(f), 'status']);
  return findIcs(db, code);
}
// Revisión manual solo para ICS que aún no están bajo control; los controlados cambian mediante un CRF autorizado.
function addRevision(db, user, code, data) {
  if (!isCCC(user)) fail(403, 'Solo el CCC registra revisiones manuales.');
  const ics = findIcs(db, code);
  if (ics.status !== 'Propuesto' && ics.status !== 'Identificado') fail(409, 'Un ICS bajo control de configuración solo cambia mediante un CRF autorizado.');
  const revision = str(data, 'revision', { required: true, max: 60, label: 'Revisión' });
  if (db.prepare('SELECT 1 FROM ics_revisions WHERE ics_id=? AND revision=?').get(ics.id, revision)) fail(409, 'La revisión ya existe.');
  const id = Number(db.prepare("INSERT INTO ics_revisions(ics_id,revision,git_ref,date,notes,status,created_by) VALUES(?,?,?,?,?,'Vigente',?)").run(ics.id, revision, str(data, 'gitRef', { max: 200 }), now(), str(data, 'notes', { required: true, min: 5, max: 2000, label: 'Notas' }), user.id).lastInsertRowid);
  if (ics.current_revision_id) db.prepare("UPDATE ics_revisions SET status='Reemplazada' WHERE id=?").run(ics.current_revision_id);
  db.prepare('UPDATE ics SET current_revision_id=?, version=version+1 WHERE id=?').run(id, ics.id);
  audit(db, { entityType: 'ICS', entityId: code, action: 'Registro de revisión', actor: user, field: 'revisión', oldValue: ics.currentRevision, newValue: revision });
  return findIcs(db, code);
}
function addRelation(db, user, code, data) {
  if (!isCCC(user)) fail(403, 'Solo el CCC registra relaciones entre ICS.');
  const from = findIcs(db, code), to = db.prepare('SELECT id,code FROM ics WHERE code=?').get(String(data.target || ''));
  if (!to) fail(400, 'El ICS relacionado no existe.');
  if (to.id === from.id) fail(400, 'Un ICS no puede relacionarse consigo mismo.');
  const type = pick(data.type, C.RELATION_TYPES, 'un tipo de relación');
  if (db.prepare('SELECT 1 FROM ics_relations WHERE from_id=? AND to_id=? AND type=?').get(from.id, to.id, type)) fail(409, 'La relación ya existe.');
  if (type === 'depende de' && db.prepare("SELECT 1 FROM ics_relations WHERE from_id=? AND to_id=? AND type='depende de'").get(to.id, from.id)) fail(409, 'Dependencia circular directa: el otro ICS ya depende de este.');
  db.prepare('INSERT INTO ics_relations(from_id,to_id,type,created_by,created_at) VALUES(?,?,?,?,?)').run(from.id, to.id, type, user.id, now());
  audit(db, { entityType: 'ICS', entityId: code, action: 'Relación de ICS', actor: user, newValue: `${from.code} ${type} ${to.code}` });
  return icsDetail(db, code, user);
}
function removeRelation(db, user, code, relationId) {
  if (!isCCC(user)) fail(403, 'Solo el CCC elimina relaciones entre ICS.');
  const ics = findIcs(db, code);
  const rel = db.prepare('SELECT rel.*, f.code AS fc, t.code AS tc FROM ics_relations rel JOIN ics f ON f.id=rel.from_id JOIN ics t ON t.id=rel.to_id WHERE rel.id=? AND (from_id=? OR to_id=?)').get(Number(relationId), ics.id, ics.id);
  if (!rel) fail(404, 'Relación no encontrada.');
  db.prepare('DELETE FROM ics_relations WHERE id=?').run(rel.id);
  audit(db, { entityType: 'ICS', entityId: code, action: 'Eliminación de relación', actor: user, oldValue: `${rel.fc} ${rel.type} ${rel.tc}` });
  return icsDetail(db, code, user);
}

// ---------- Líneas base ----------
function baselineItems(db, id) {
  return db.prepare('SELECT bi.ics_id AS icsId, i.code, i.name, r.id AS revisionId, r.revision, r.status AS revisionStatus FROM baseline_items bi JOIN ics i ON i.id=bi.ics_id JOIN ics_revisions r ON r.id=bi.revision_id WHERE bi.baseline_id=? ORDER BY i.code').all(id);
}
function listBaselines(db) {
  return db.prepare('SELECT b.*, u.name AS createdByName, d.name AS decidedByName, p.code AS derivedFromCode FROM baselines b LEFT JOIN users u ON u.id=b.created_by LEFT JOIN users d ON d.id=b.decided_by LEFT JOIN baselines p ON p.id=b.derived_from ORDER BY b.id').all().map(b => ({ ...b, items: baselineItems(db, b.id) }));
}
function findBaseline(db, code) {
  const b = db.prepare('SELECT * FROM baselines WHERE code=?').get(String(code));
  if (!b) fail(404, 'Línea base no encontrada.');
  return b;
}
function setItems(db, baseline, items) {
  if (!Array.isArray(items) || items.length > 200) fail(400, 'Selección de ICS inválida.');
  db.prepare('DELETE FROM baseline_items WHERE baseline_id=?').run(baseline.id);
  const seen = new Set();
  for (const it of items) {
    const rev = db.prepare('SELECT r.id, r.ics_id, r.status, i.status AS icsStatus, i.code FROM ics_revisions r JOIN ics i ON i.id=r.ics_id WHERE r.id=?').get(Number(it?.revisionId));
    if (!rev) fail(400, 'Una de las revisiones seleccionadas no existe.');
    if (seen.has(rev.ics_id)) fail(400, `${rev.code} aparece más de una vez.`);
    if (rev.icsStatus === 'Retirado' || rev.icsStatus === 'Propuesto') fail(400, `${rev.code} debe estar identificado para formar parte de una línea base.`);
    if (!['Vigente', 'Reemplazada'].includes(rev.status)) fail(400, `La revisión seleccionada de ${rev.code} no está aprobada.`);
    seen.add(rev.ics_id);
    db.prepare('INSERT INTO baseline_items(baseline_id,ics_id,revision_id) VALUES(?,?,?)').run(baseline.id, rev.ics_id, rev.id);
  }
}
function createBaseline(db, user, data) {
  if (!isCCC(user)) fail(403, 'Solo el CCC propone líneas base.');
  const name = str(data, 'name', { required: true, min: 3, max: 150, label: 'Nombre' });
  const version = str(data, 'softwareVersion', { max: 40, label: 'Versión de software relacionada' });
  if (version && !C.SEMVER.test(version)) fail(400, 'Versión de software: usa MAJOR.MINOR.PATCH.');
  let derived = null;
  if (data.derivedFrom) { derived = findBaseline(db, data.derivedFrom); if (derived.status !== 'Aprobada') fail(400, 'Solo se puede derivar de una línea base aprobada.'); }
  const temp = `TMP-${Date.now()}-${Math.random()}`;
  const id = Number(db.prepare("INSERT INTO baselines(code,name,description,software_version,status,derived_from,created_by,created_at) VALUES(?,?,?,?,'Borrador',?,?,?)").run(temp, name, str(data, 'description', { max: 3000 }), version, derived?.id ?? null, user.id, now()).lastInsertRowid);
  const code = `LB-BUS-${pad(id)}`;
  db.prepare('UPDATE baselines SET code=? WHERE id=?').run(code, id);
  const baseline = findBaseline(db, code);
  // Una línea base derivada parte de las revisiones vigentes de los ICS de la anterior.
  const items = Array.isArray(data.items) ? data.items : derived ? baselineItems(db, derived.id).map(i => ({ revisionId: db.prepare('SELECT current_revision_id AS id FROM ics WHERE id=?').get(i.icsId).id })) : [];
  setItems(db, baseline, items);
  audit(db, { entityType: 'Línea base', entityId: code, action: 'Propuesta de línea base', actor: user, to: 'Borrador', justification: `${name}${derived ? ` (derivada de ${derived.code})` : ''}` });
  return code;
}
function baselineAction(db, user, code, action, data) {
  if (!isCCC(user)) fail(403, 'Solo el CCC gestiona líneas base.');
  const b = findBaseline(db, code);
  if (action === 'items') {
    if (b.status !== 'Borrador') fail(409, 'Solo se puede modificar la composición de una línea base en borrador.');
    setItems(db, b, data.items);
    audit(db, { entityType: 'Línea base', entityId: code, action: 'Composición de línea base', actor: user, newValue: baselineItems(db, b.id).map(i => `${i.code}@${i.revision}`).join(', ') });
  } else if (action === 'submit') {
    if (b.status !== 'Borrador') fail(409, 'La línea base no está en borrador.');
    if (!baselineItems(db, b.id).length) fail(409, 'Agrega al menos un ICS con su revisión.');
    db.prepare("UPDATE baselines SET status='En revisión', submitted_at=?, reviewer_id=? WHERE id=?").run(now(), user.id, b.id);
    audit(db, { entityType: 'Línea base', entityId: code, action: 'Envío a revisión', actor: user, from: 'Borrador', to: 'En revisión' });
  } else if (action === 'decide') {
    if (b.status !== 'En revisión') fail(409, 'La línea base no está en revisión.');
    const decision = pick(data.decision, ['Aprobada', 'Rechazada'], 'una decisión');
    const note = str(data, 'note', { required: true, min: 10, max: 3000, label: 'Justificación de la decisión' });
    if (decision === 'Aprobada') {
      const stale = baselineItems(db, b.id).filter(i => i.revisionStatus !== 'Vigente');
      if (stale.length && !data.allowHistorical) fail(409, `Hay revisiones que ya no son vigentes: ${stale.map(i => `${i.code}@${i.revision}`).join(', ')}. Confirma que se aprueba una configuración histórica.`);
      for (const i of baselineItems(db, b.id)) db.prepare("UPDATE ics SET status='Bajo control de configuración', version=version+1 WHERE id=? AND status='Identificado'").run(i.icsId);
    }
    db.prepare('UPDATE baselines SET status=?, decided_by=?, decided_at=?, decision_note=? WHERE id=?').run(decision, user.id, now(), note, b.id);
    audit(db, { entityType: 'Línea base', entityId: code, action: decision === 'Aprobada' ? 'Aprobación de línea base' : 'Rechazo de línea base', actor: user, from: 'En revisión', to: decision, justification: note });
  } else if (action === 'delete') {
    if (b.status !== 'Borrador') fail(409, 'Solo se puede eliminar un borrador.');
    db.prepare('DELETE FROM baseline_items WHERE baseline_id=?').run(b.id);
    db.prepare('DELETE FROM baselines WHERE id=?').run(b.id);
    audit(db, { entityType: 'Línea base', entityId: code, action: 'Eliminación de borrador', actor: user });
  } else fail(404, 'Acción no encontrada.');
  return listBaselines(db);
}
module.exports = { categories, addCategory, listIcs, icsDetail, createIcs, updateIcs, addRevision, addRelation, removeRelation, listBaselines, createBaseline, baselineAction };

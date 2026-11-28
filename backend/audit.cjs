'use strict';
// Registro de auditoría persistente (solo inserción, protegido por disparadores en SQLite).
const clip = v => v === null || v === undefined ? null : (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 1000);
const actorOf = user => ({ id: user?.id ?? null, name: user ? (user.id ? user.name : `${user.name} (sin cuenta)`) : 'Sistema' });
function audit(db, { entityType, entityId, action, actor, from = null, to = null, field = null, oldValue = null, newValue = null, justification = null }) {
  const who = actorOf(actor);
  db.prepare('INSERT INTO audit_events(at,entity_type,entity_id,action,actor_id,actor_name,from_status,to_status,field,old_value,new_value,justification) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(new Date().toISOString(), entityType, String(entityId), action, who.id, who.name, from, to, field, clip(oldValue), clip(newValue), clip(justification));
}
// Un evento por campo modificado, con valor anterior y nuevo.
function auditChanges(db, base, before, after, keys) {
  for (const key of keys) {
    const a = JSON.stringify(before?.[key] ?? null), b = JSON.stringify(after?.[key] ?? null);
    if (a !== b) audit(db, { ...base, field: key, oldValue: before?.[key] ?? null, newValue: after?.[key] ?? null });
  }
}
function listAudit(db, { entityType, entityId, entityIds, action, limit = 300 } = {}) {
  const where = [], params = [];
  if (entityType) { where.push('entity_type=?'); params.push(entityType); }
  if (entityId) { where.push('entity_id=?'); params.push(String(entityId).trim().toUpperCase()); }
  if (action) { where.push('action LIKE ?'); params.push(`%${action}%`); }
  let rows = db.prepare(`SELECT * FROM audit_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).all(...params, Math.min(Number(limit) || 300, 2000));
  if (entityIds) rows = rows.filter(r => r.entity_type !== 'CRF' || entityIds.has(r.entity_id));
  return rows;
}
module.exports = { audit, auditChanges, actorOf, listAudit };

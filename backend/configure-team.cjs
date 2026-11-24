'use strict';
const path = require('node:path');
const { openDatabase, transaction } = require('./database.cjs');
const { hashPassword } = require('./auth.cjs');
const { audit } = require('./audit.cjs');
const { TEAM } = require('./team.cjs');
const EVALUATING = ['En análisis', 'En planificación', 'Pendiente de aprobación'];
function configureTeam(db, password) {
  if (typeof password !== 'string' || password.length < 12) throw Error('SEED_PASSWORD debe contener al menos 12 caracteres.');
  // Hashes calculados antes de abrir la transacción para reducir el bloqueo.
  const members = TEAM.map(([id, name, email, role, github]) => [id, name, email, role, hashPassword(password), github || null]);
  return transaction(db, () => {
    db.prepare('UPDATE users SET active=0').run();
    const upsert = db.prepare('INSERT INTO users(id,name,email,role,password_hash,github,active) VALUES(?,?,?,?,?,?,1) ON CONFLICT(email) DO UPDATE SET name=excluded.name,role=excluded.role,password_hash=excluded.password_hash,github=excluded.github,active=1');
    for (const member of members) upsert.run(...member);
    db.prepare('DELETE FROM sessions').run();
    const ccc = new Set(db.prepare("SELECT id FROM users WHERE role='ccc' AND active=1").all().map(u => u.id));
    let reopened = 0;
    for (const row of db.prepare('SELECT id,document FROM requests').all()) {
      const r = JSON.parse(row.document);
      // Una ficha en curso a cargo de un antiguo integrante se conserva y se reinicia con el CCC actual.
      if (!EVALUATING.includes(r.status) || !r.evaluation?.memberId || ccc.has(r.evaluation.memberId)) continue;
      (r.previousEvaluations ||= []).push(r.evaluation);
      r.evaluation = null; r.revision++;
      const note = 'Cambio de integrantes del CCC: se conserva la ficha anterior y se requiere un nuevo análisis del responsable actual.';
      r.history.push({ status: 'En validación', from: r.status, date: new Date().toISOString(), responsible: 'Administración', action: 'Cambio de responsable', note });
      audit(db, { entityType: 'CRF', entityId: r.id, action: 'Cambio de responsable del CCC', actor: null, from: r.status, to: 'En validación', justification: note });
      r.status = 'En validación';
      db.prepare('UPDATE requests SET document=? WHERE id=?').run(JSON.stringify(r), row.id); reopened++;
    }
    return { users: db.prepare('SELECT name,email,role FROM users WHERE active=1 ORDER BY email').all(), reopened };
  });
}
if (require.main === module) {
  const db = openDatabase(process.env.DB_PATH || path.join(__dirname, 'data', 'changeflow.sqlite'));
  try { const result = configureTeam(db, process.env.SEED_PASSWORD); console.table(result.users); console.log(`Expedientes en evaluación que requieren nuevo análisis: ${result.reopened}. Sesiones anteriores revocadas.`); } finally { db.close(); }
}
module.exports = { configureTeam };

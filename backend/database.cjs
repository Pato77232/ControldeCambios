'use strict';
const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const { dirname } = require('node:path');
const { migrateDocument } = require('./migrate.cjs');

function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  // WAL por defecto; DELETE en Docker cuando la carpeta de datos está montada desde Windows o macOS.
  const journal = process.env.SQLITE_JOURNAL_MODE === 'DELETE' ? 'DELETE' : 'WAL';
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=${journal};
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,role TEXT NOT NULL CHECK(role IN ('usuario','experto','ccc')),password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id TEXT REFERENCES users(id),document TEXT NOT NULL);`);
  // Versión 2: propietario opcional (solicitudes sin cuenta) conservando datos y contador de códigos.
  if (db.prepare('PRAGMA table_info(requests)').all().find(c => c.name === 'owner_id').notnull) {
    const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name='requests'").get()?.seq || 0;
    transaction(db, () => {
      db.exec(`CREATE TABLE requests_new(id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id TEXT REFERENCES users(id),document TEXT NOT NULL);
        INSERT INTO requests_new SELECT * FROM requests;
        DROP TABLE requests; ALTER TABLE requests_new RENAME TO requests;`);
      db.prepare("UPDATE sqlite_sequence SET seq=? WHERE name='requests'").run(sequence);
    });
  }
  if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'active')) db.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
  // Usuario de GitHub de cada integrante (para asignar issues). Se completa desde team.cjs sin tocar otros datos.
  if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'github')) db.exec('ALTER TABLE users ADD COLUMN github TEXT');
  const { TEAM } = require('./team.cjs');
  for (const [, , email, , github] of TEAM) if (github) db.prepare('UPDATE users SET github=? WHERE email=? AND github IS NULL').run(github, email);
  // Versión 4: adjuntos reales y auditoría persistente. Las tablas de ICS y líneas base ya no se usan
  // (la gestión se hace por módulos), pero se conservan para no perder datos registrados anteriormente.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ics_categories(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE COLLATE NOCASE,created_by TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ics(
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL,
      project TEXT NOT NULL, category_id INTEGER NOT NULL REFERENCES ics_categories(id),
      kind TEXT NOT NULL CHECK(kind IN ('Básico','Agregado')), parent_id INTEGER REFERENCES ics(id),
      owner_id TEXT REFERENCES users(id), author_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
      path TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', reference TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('Propuesto','Identificado','Bajo control de configuración','Retirado')),
      current_revision_id INTEGER, version INTEGER NOT NULL DEFAULT 0, UNIQUE(project,name), CHECK(parent_id IS NULL OR parent_id<>id));
    CREATE TABLE IF NOT EXISTS ics_revisions(
      id INTEGER PRIMARY KEY AUTOINCREMENT, ics_id INTEGER NOT NULL REFERENCES ics(id), revision TEXT NOT NULL, git_ref TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK(status IN ('Vigente','En cambio','Reemplazada','Descartada')), created_by TEXT NOT NULL, UNIQUE(ics_id,revision));
    CREATE TABLE IF NOT EXISTS ics_relations(
      id INTEGER PRIMARY KEY AUTOINCREMENT, from_id INTEGER NOT NULL REFERENCES ics(id), to_id INTEGER NOT NULL REFERENCES ics(id),
      type TEXT NOT NULL CHECK(type IN ('depende de','relacionado con')), created_by TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(from_id,to_id,type), CHECK(from_id<>to_id));
    CREATE TABLE IF NOT EXISTS request_ics(
      id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      ics_id INTEGER NOT NULL REFERENCES ics(id), kind TEXT NOT NULL CHECK(kind IN ('sugerido','potencial','autorizado','modificado')),
      operation TEXT CHECK(operation IS NULL OR operation IN ('Adición','Modificación','Eliminación')),
      from_revision TEXT, to_revision TEXT, revision_id INTEGER REFERENCES ics_revisions(id), description TEXT NOT NULL DEFAULT '',
      evidence TEXT NOT NULL DEFAULT '', in_scope INTEGER, active INTEGER NOT NULL DEFAULT 1, decision_n INTEGER, round INTEGER,
      created_by TEXT, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS request_ics_request ON request_ics(request_id);
    CREATE INDEX IF NOT EXISTS request_ics_ics ON request_ics(ics_id);
    CREATE TABLE IF NOT EXISTS baselines(
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      software_version TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('Borrador','En revisión','Aprobada','Rechazada')),
      derived_from INTEGER REFERENCES baselines(id), created_by TEXT NOT NULL, created_at TEXT NOT NULL, submitted_at TEXT,
      reviewer_id TEXT, decided_by TEXT, decided_at TEXT, decision_note TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS baseline_items(
      baseline_id INTEGER NOT NULL REFERENCES baselines(id), ics_id INTEGER NOT NULL REFERENCES ics(id),
      revision_id INTEGER NOT NULL REFERENCES ics_revisions(id), PRIMARY KEY(baseline_id,ics_id));
    CREATE TABLE IF NOT EXISTS attachments(
      id TEXT PRIMARY KEY, request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE, context TEXT NOT NULL,
      filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, stored_name TEXT NOT NULL UNIQUE,
      uploaded_by TEXT, uploader_name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
      actor_id TEXT, actor_name TEXT NOT NULL, from_status TEXT, to_status TEXT, field TEXT, old_value TEXT, new_value TEXT, justification TEXT);
    CREATE INDEX IF NOT EXISTS audit_entity ON audit_events(entity_type,entity_id);
    -- La auditoría es de solo inserción: las correcciones generan eventos nuevos.
    CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'La auditoría no puede modificarse.'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'La auditoría no puede eliminarse.'); END;
    -- Una revisión identificada conserva su contenido; solo cambia su estado.
    CREATE TRIGGER IF NOT EXISTS revision_immutable BEFORE UPDATE OF ics_id,revision,git_ref,date ON ics_revisions BEGIN SELECT RAISE(ABORT,'Una revisión registrada no puede modificarse.'); END;
    CREATE TRIGGER IF NOT EXISTS revision_no_delete BEFORE DELETE ON ics_revisions BEGIN SELECT RAISE(ABORT,'Una revisión registrada no puede eliminarse.'); END;
    -- La composición de una línea base solo cambia mientras está en borrador.
    CREATE TRIGGER IF NOT EXISTS baseline_items_insert BEFORE INSERT ON baseline_items WHEN (SELECT status FROM baselines WHERE id=NEW.baseline_id)<>'Borrador' BEGIN SELECT RAISE(ABORT,'La composición de la línea base ya no puede modificarse.'); END;
    CREATE TRIGGER IF NOT EXISTS baseline_items_update BEFORE UPDATE ON baseline_items WHEN (SELECT status FROM baselines WHERE id=OLD.baseline_id)<>'Borrador' BEGIN SELECT RAISE(ABORT,'La composición de la línea base ya no puede modificarse.'); END;
    CREATE TRIGGER IF NOT EXISTS baseline_items_delete BEFORE DELETE ON baseline_items WHEN (SELECT status FROM baselines WHERE id=OLD.baseline_id)<>'Borrador' BEGIN SELECT RAISE(ABORT,'La composición de la línea base ya no puede modificarse.'); END;
    CREATE TRIGGER IF NOT EXISTS baseline_closed BEFORE UPDATE ON baselines WHEN OLD.status IN ('Aprobada','Rechazada') BEGIN SELECT RAISE(ABORT,'Una línea base decidida no puede modificarse.'); END;
    CREATE TRIGGER IF NOT EXISTS baseline_no_delete BEFORE DELETE ON baselines WHEN OLD.status<>'Borrador' BEGIN SELECT RAISE(ABORT,'Solo se puede eliminar una línea base en borrador.'); END;
  `);
  if (db.prepare('PRAGMA user_version').get().user_version < 4) {
    transaction(db, () => {
      const update = db.prepare('UPDATE requests SET document=? WHERE id=?');
      const audit = db.prepare('INSERT INTO audit_events(at,entity_type,entity_id,action,actor_id,actor_name,from_status,to_status,justification) VALUES(?,?,?,?,?,?,?,?,?)');
      for (const row of db.prepare('SELECT id,document FROM requests').all()) {
        const old = JSON.parse(row.document), migrated = migrateDocument(old, row.id);
        if (!migrated) continue;
        update.run(JSON.stringify(migrated), row.id);
        audit.run(new Date().toISOString(), 'CRF', migrated.id, 'Migración al modelo 4', null, 'Sistema', old.status, migrated.status, `Código anterior ${old.id}. Datos previos conservados en «legacy».`);
      }
      db.exec('PRAGMA user_version=4');
    });
  }
  return db;
}
function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
module.exports = { openDatabase, transaction };

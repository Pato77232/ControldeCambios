'use strict';
// Adjuntos reales: se reciben en base64 dentro de JSON, se validan y se guardan fuera de la carpeta pública.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { ATTACHMENT_TYPES, ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_FILES } = require('./catalog.cjs');
const { audit } = require('./audit.cjs');

function uploadsDir(db) {
  const file = db.prepare('PRAGMA database_list').all().find(d => d.name === 'main')?.file;
  // Cada base tiene su carpeta de adjuntos (la demostración no comparte archivos con la base real).
  return file ? path.join(path.dirname(file), `${path.basename(file, path.extname(file))}-uploads`) : null;
}
function parseFiles(files, fail) {
  if (files === undefined || files === null) return [];
  if (!Array.isArray(files) || files.length > ATTACHMENT_MAX_FILES) fail(400, `Adjunta como máximo ${ATTACHMENT_MAX_FILES} archivos por envío.`);
  return files.map(f => {
    if (!f || typeof f.name !== 'string' || typeof f.data !== 'string') fail(400, 'Archivo adjunto inválido.');
    const name = path.basename(f.name).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 150);
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    if (!ATTACHMENT_TYPES[ext]) fail(400, `Tipo de archivo no permitido: ${name}. Usa ${Object.keys(ATTACHMENT_TYPES).join(', ')}.`);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(f.data)) fail(400, `Contenido inválido en ${name}.`);
    const buffer = Buffer.from(f.data, 'base64');
    if (!buffer.length) fail(400, `El archivo ${name} está vacío.`);
    if (buffer.length > ATTACHMENT_MAX_BYTES) fail(400, `El archivo ${name} supera ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB.`);
    return { name, mime: ATTACHMENT_TYPES[ext], buffer };
  });
}
function storeFiles(db, { requestNumber, requestCode, context, files, user, fail }) {
  const parsed = parseFiles(files, fail);
  if (!parsed.length) return [];
  const dir = uploadsDir(db);
  if (!dir) fail(400, 'Esta base de datos no admite archivos adjuntos.');
  fs.mkdirSync(dir, { recursive: true });
  const saved = [];
  for (const f of parsed) {
    const id = randomBytes(12).toString('hex'), stored = `${id}.bin`;
    fs.writeFileSync(path.join(dir, stored), f.buffer, { flag: 'wx' });
    const row = { id, filename: f.name, mime: f.mime, size: f.buffer.length, sha256: createHash('sha256').update(f.buffer).digest('hex'), context, uploader_name: user?.name || 'Solicitante', created_at: new Date().toISOString() };
    db.prepare('INSERT INTO attachments(id,request_id,context,filename,mime,size,sha256,stored_name,uploaded_by,uploader_name,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, requestNumber, context, row.filename, row.mime, row.size, row.sha256, stored, user?.id ?? null, row.uploader_name, row.created_at);
    audit(db, { entityType: 'CRF', entityId: requestCode, action: 'Registro de evidencia', actor: user, field: 'adjunto', newValue: `${row.filename} (${context}, sha256 ${row.sha256.slice(0, 12)}…)` });
    saved.push(row);
  }
  return saved;
}
function listAttachments(db, requestNumber) {
  return db.prepare('SELECT id,context,filename,mime,size,sha256,uploader_name,created_at FROM attachments WHERE request_id=? ORDER BY created_at').all(requestNumber);
}
function readAttachment(db, id) {
  if (!/^[a-f0-9]{24}$/.test(id)) return null;
  const row = db.prepare('SELECT * FROM attachments WHERE id=?').get(id);
  if (!row) return null;
  const file = path.join(uploadsDir(db), row.stored_name);
  return fs.existsSync(file) ? { row, content: fs.readFileSync(file) } : null;
}
function removeFiles(db, requestNumber) {
  const dir = uploadsDir(db);
  for (const row of db.prepare('SELECT stored_name FROM attachments WHERE request_id=?').all(requestNumber)) {
    try { fs.unlinkSync(path.join(dir, row.stored_name)); } catch { /* el registro se elimina igualmente */ }
  }
}
module.exports = { storeFiles, listAttachments, readAttachment, removeFiles };

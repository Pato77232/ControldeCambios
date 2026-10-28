'use strict';
const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const { dirname } = require('node:path');
function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), {recursive:true});
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,role TEXT NOT NULL CHECK(role IN ('usuario','experto','ccc')),password_hash TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)));
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id TEXT REFERENCES users(id),document TEXT NOT NULL);
    `);
  if (!db.prepare("PRAGMA table_info(users)").all().some(c=>c.name==='active')) {
    db.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))');
  }
  // Migración compatible con las solicitudes y códigos existentes.
  if (db.prepare("PRAGMA table_info(requests)").all().find(c=>c.name==='owner_id').notnull) {
    const sequence=db.prepare("SELECT seq FROM sqlite_sequence WHERE name='requests'").get()?.seq || 0;
    transaction(db,()=>{
      db.exec(`CREATE TABLE requests_new(id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id TEXT REFERENCES users(id),document TEXT NOT NULL);
        INSERT INTO requests_new SELECT * FROM requests;
        DROP TABLE requests; ALTER TABLE requests_new RENAME TO requests;`);
      db.prepare("UPDATE sqlite_sequence SET seq=? WHERE name='requests'").run(sequence);
    });
  }
  db.exec("PRAGMA user_version=2");
  return db;
}
function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try { const result=work(); db.exec('COMMIT'); return result; }
  catch(error) { db.exec('ROLLBACK'); throw error; }
}
module.exports={openDatabase,transaction};

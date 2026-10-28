'use strict';
const { randomBytes, scryptSync, timingSafeEqual, createHash } = require('node:crypto');
const publicUser = u => ({id:u.id,name:u.name,email:u.email,role:u.role});
function hashPassword(password) {
  const salt=randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;
}
function verifyPassword(password, hash) {
  const [salt,key]=hash.split(':');
  return timingSafeEqual(Buffer.from(key,'hex'),scryptSync(password,salt,64));
}
const digest = value => createHash('sha256').update(value).digest('hex');
function seedUsers(db, password) {
  if(db.prepare('SELECT COUNT(*) AS n FROM users').get().n) return;
  if(!password || password.length<12) throw Error('Define SEED_PASSWORD con al menos 12 caracteres para crear las cuentas iniciales.');
  const users=[['user-ana','Ana Martínez','ana@changeflow.local','usuario'],['expert-diego','Diego Sánchez','diego@changeflow.local','experto'],['ccc-carlos','Carlos Pérez','carlos@changeflow.local','ccc'],['ccc-maria','María López','maria@changeflow.local','ccc']];
  const statement=db.prepare('INSERT INTO users VALUES(?,?,?,?,?)');
  db.exec('BEGIN');
  try { for(const u of users) statement.run(...u,hashPassword(password)); db.exec('COMMIT'); }
  catch(e){db.exec('ROLLBACK');throw e;}
}
function createSession(db,userId) {
  const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token),userId,csrf,Date.now()+8*60*60*1000);
  return {token,csrf};
}
function getSession(db,req) {
  const token=(req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('changeflow_session='))?.slice('changeflow_session='.length);
  if(!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare('SELECT s.token_hash,s.csrf,u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?').get(digest(token),Date.now()) || null;
}
module.exports={publicUser,hashPassword,verifyPassword,seedUsers,createSession,getSession};

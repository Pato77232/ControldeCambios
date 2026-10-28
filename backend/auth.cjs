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
const PEOPLE=['Leslie','David','Edwin','Pablo','Shirley'];
function initialUsers() {
  return PEOPLE.flatMap(name=>{
    const key=name.toLowerCase();
    return [
      {id:`expert-${key}`,name,email:`${key}@uta.edu.ec`,role:'experto',active:1},
      {id:`ccc-${key}`,name:`${name}MiembroCCC`,email:`${key}miembroccc@uta.edu.ec`,role:'ccc',active:Number(key==='david')}
    ];
  });
}
function seedUsers(db, password) {
  if(db.prepare('SELECT COUNT(*) AS n FROM users').get().n) return;
  if(!password || password.length<12) throw Error('Define SEED_PASSWORD con al menos 12 caracteres para crear las cuentas iniciales.');
  db.exec('BEGIN');
  try { insertInitialUsers(db,password); db.exec('COMMIT'); }
  catch(e){db.exec('ROLLBACK');throw e;}
}
function insertInitialUsers(db,password) {
  const statement=db.prepare('INSERT INTO users(id,name,email,role,password_hash,active) VALUES(?,?,?,?,?,?)');
  for(const u of initialUsers())statement.run(u.id,u.name,u.email,u.role,hashPassword(password),u.active);
}
function resetData(db,password) {
  if(!password || password.length<12)throw Error('Define SEED_PASSWORD con al menos 12 caracteres antes de reiniciar los datos.');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec("DELETE FROM sessions; DELETE FROM requests; DELETE FROM users; DELETE FROM sqlite_sequence WHERE name='requests'");
    insertInitialUsers(db,password);
    db.exec('COMMIT');
  } catch(e) {db.exec('ROLLBACK');throw e;}
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
  return db.prepare('SELECT s.token_hash,s.csrf,u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>? AND u.active=1').get(digest(token),Date.now()) || null;
}
module.exports={publicUser,hashPassword,verifyPassword,seedUsers,resetData,createSession,getSession};

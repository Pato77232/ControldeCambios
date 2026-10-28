'use strict';
const path=require('node:path');
const {openDatabase,transaction}=require('./database.cjs');
const {hashPassword}=require('./auth.cjs');
const {TEAM}=require('./team.cjs');
function configureTeam(db,password){
  if(typeof password!=='string'||password.length<12)throw Error('SEED_PASSWORD debe contener al menos 12 caracteres.');
  // Hashes calculados antes de abrir la transacción para reducir el bloqueo.
  const members=TEAM.map(u=>[...u,hashPassword(password)]);
  return transaction(db,()=>{
    db.prepare('UPDATE users SET active=0').run();
    const upsert=db.prepare('INSERT INTO users(id,name,email,role,password_hash,active) VALUES(?,?,?,?,?,1) ON CONFLICT(email) DO UPDATE SET name=excluded.name,role=excluded.role,password_hash=excluded.password_hash,active=1');
    for(const member of members)upsert.run(...member);
    db.prepare('DELETE FROM sessions').run();
    const david=db.prepare("SELECT id FROM users WHERE email='david@uta.edu.ec'").get();
    let reopened=0;
    for(const row of db.prepare('SELECT id,document FROM requests').all()){
      const r=JSON.parse(row.document);
      if(!['Pendiente','Más información'].includes(r.status))continue;
      const reviewer=r.reviewerId||r.analysis?.analystId;
      if(reviewer && reviewer!==david.id){
        if(r.analysis)(r.previousAnalyses ||= []).push(r.analysis);
        r.analysis=null;delete r.reviewerId;r.committeeVotes=[];r.revision++;
        r.history.push({status:r.status,date:new Date().toISOString(),responsible:'Administración',note:'Cambio de integrantes del CCC: se conserva el análisis anterior y se requiere un nuevo análisis del responsable actual.'});
        db.prepare('UPDATE requests SET document=? WHERE id=?').run(JSON.stringify(r),row.id);reopened++;
      }
    }
    return {users:db.prepare('SELECT name,email,role FROM users WHERE active=1 ORDER BY email').all(),reopened};
  });
}
if(require.main===module){
  const db=openDatabase(process.env.DB_PATH||path.join(__dirname,'data','changeflow.sqlite'));
  try{const result=configureTeam(db,process.env.SEED_PASSWORD);console.table(result.users);console.log(`Expedientes pendientes que requieren nuevo análisis: ${result.reopened}. Sesiones anteriores revocadas.`);}finally{db.close();}
}
module.exports={configureTeam};

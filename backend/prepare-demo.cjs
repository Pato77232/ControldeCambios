'use strict';
const path=require('node:path');
const {openDatabase,transaction}=require('./database.cjs');

function prepareDemo(db) {
  const david=db.prepare("SELECT id FROM users WHERE id='ccc-david' AND role='ccc'").get();
  if(!david)throw Error('No existe la cuenta DavidMiembroCCC en esta base.');
  return transaction(db,()=>{
    const removed=db.prepare('SELECT COUNT(*) AS n FROM requests').get().n;
    db.prepare('DELETE FROM sessions').run();
    db.prepare('DELETE FROM requests').run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name='requests'").run();
    db.prepare("UPDATE users SET active=CASE WHEN id='ccc-david' THEN 1 ELSE 0 END WHERE role='ccc'").run();
    return {removed,activeCommittee:db.prepare("SELECT name FROM users WHERE role='ccc' AND active=1").get().name};
  });
}

if(require.main===module){
  if(!process.argv.includes('--confirm')){
    console.error('Para borrar todas las solicitudes y cerrar sesiones, ejecuta npm run prepare:demo -- --confirm.');
    process.exitCode=1;
  } else {
    const filename=process.env.DB_PATH||path.join(__dirname,'data','changeflow.sqlite');
    const db=openDatabase(filename);
    try {
      const result=prepareDemo(db);
      console.log(`Solicitudes eliminadas: ${result.removed}. CCC activo: ${result.activeCommittee}. Sesiones cerradas.`);
    } finally {db.close();}
  }
}
module.exports={prepareDemo};

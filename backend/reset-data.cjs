'use strict';
const path=require('node:path');
const {openDatabase}=require('./database.cjs');
const {resetData}=require('./auth.cjs');
const filename=process.env.DB_PATH||path.join(__dirname,'data','changeflow.sqlite');
const password=process.env.SEED_PASSWORD;
if(!password||password.length<12){
  console.error('Define SEED_PASSWORD con al menos 12 caracteres antes de reiniciar los datos.');
  process.exitCode=1;
} else {
  const db=openDatabase(filename);
  try {
    resetData(db,password);
    console.log('Base reiniciada: 5 expertos, 5 cuentas CCC; solo DavidMiembroCCC activa.');
  } finally {db.close();}
}

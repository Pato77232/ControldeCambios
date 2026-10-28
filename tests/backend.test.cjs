'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createApp}=require('../backend/server.cjs');
const {openDatabase}=require('../backend/database.cjs');
const {resetData}=require('../backend/auth.cjs');
const PASSWORD='Test-ChangeFlow-2026!';
const names=['leslie','david','edwin','pablo','shirley'];
const common={requesterType:'usuario',project:'ProyectoBusesUTA',module:'Autenticación y usuarios',title:'Mensajes de inicio de sesión',currentBehavior:'El mensaje resulta confuso.',description:'Mejorar los mensajes del proceso de inicio de sesión.',justification:'Los usuarios necesitan comprender cómo corregir sus datos.',result:'Mensajes comprensibles.',attachments:[]};
const expertRequest={...common,requesterType:'experto',type:'Refactorización',proposedPriority:'Alta',components:'auth',environment:'Pruebas',acceptanceCriteria:'Dado un usuario, recibe un mensaje comprensible',currentVersion:'0.1.0'};
const analysis={impact:'Medio',technicalImpact:'Textos y pruebas de autenticación',risks:'Compatibilidad de mensajes',feasibility:'Viable',effort:'24 horas',resources:'Un desarrollador y un tester',considerations:'Verificar accesibilidad',priority:'Media'};
async function start(filename=':memory:') {
  const app=createApp({filename,seedPassword:PASSWORD});
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
  app.url=`http://127.0.0.1:${app.server.address().port}`;
  return app;
}
async function stop(app){await new Promise(resolve=>app.server.close(resolve));}
async function client(app,email) {
  let cookie='',csrf='';
  const call=async(path,method='GET',body,headers={})=>{
    const response=await fetch(app.url+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
    const responseText=await response.text();let data;
    try{data=JSON.parse(responseText);}catch{data=responseText;}
    if(data.csrf)csrf=data.csrf;
    return {status:response.status,data,headers:response.headers};
  };
  if(email){const result=await call('/api/auth/login','POST',{email,password:PASSWORD});assert.equal(result.status,200);assert.match(result.headers.get('set-cookie'),/HttpOnly/);}
  return {call};
}
test('cinco expertos, cinco CCC, solo Pablo activo y permisos por rol',async()=>{
  const app=await start();
  try {
    const users=app.db.prepare('SELECT id,name,email,role,active,password_hash FROM users ORDER BY id').all();
    assert.equal(users.length,10);
    for(const name of names){
      assert.ok(users.some(u=>u.id===`expert-${name}`&&u.email===`${name}@uta.edu.ec`&&u.role==='experto'&&u.active===1));
      assert.ok(users.some(u=>u.id===`ccc-${name}`&&u.email===`${name}miembroccc@uta.edu.ec`&&u.role==='ccc'&&u.active===Number(name==='pablo')));
    }
    assert.equal(users.filter(u=>u.role==='usuario').length,0);
    assert.ok(users.every(u=>u.password_hash!==PASSWORD));
    assert.equal(new Set(users.map(u=>u.password_hash)).size,10);
    const guest=await client(app);
    for(const name of names.filter(n=>n!=='pablo'))assert.equal((await guest.call('/api/auth/login','POST',{email:`${name}miembroccc@uta.edu.ec`,password:PASSWORD})).status,401);
    assert.equal((await guest.call('/api/auth/login','POST',{email:'ana@changeflow.local',password:PASSWORD})).status,401);
    const ccc=await client(app,'pablomiembroccc@uta.edu.ec');
    assert.deepEqual((await ccc.call('/api/committee')).data.users.map(u=>u.id),['ccc-pablo']);
    assert.equal((await ccc.call('/api/requests','POST',{...common,requesterType:'experto'})).status,403);
    const expert=await client(app,'leslie@uta.edu.ec');
    assert.equal((await expert.call('/api/committee')).data.users.length,0);
    assert.equal((await expert.call('/api/requests','POST',{...expertRequest,requesterType:'usuario'})).status,403);
    assert.equal((await expert.call('/api/requests','POST',expertRequest,{'X-CSRF-Token':'incorrecto'})).status,403);
    const created=await expert.call('/api/requests','POST',expertRequest);
    assert.equal(created.status,201);let request=created.data.request;
    assert.equal(request.ownerId,'expert-leslie');
    const other=await client(app,'david@uta.edu.ec');
    assert.equal((await other.call('/api/requests')).data.requests.length,0);
    assert.equal((await other.call(`/api/requests/${request.id}`,'PATCH',{...expertRequest,revision:request.revision})).status,403);
    assert.equal((await expert.call(`/api/requests/${request.id}/analysis`,'POST',{...analysis,revision:request.revision})).status,403);
    assert.equal((await ccc.call(`/api/requests/${request.id}/resolution`,'POST',{members:['ccc-pablo'],decision:'Aprobado',decisionNote:'Sin análisis',revision:request.revision})).status,409);
    let result=await ccc.call(`/api/requests/${request.id}/analysis`,'POST',{...analysis,revision:request.revision});
    assert.equal(result.status,200);request=result.data.request;
    assert.equal(request.analysis.analyst,'PabloMiembroCCC');
    result=await ccc.call(`/api/requests/${request.id}/vote`,'POST',{decision:'Aprobado',revision:request.revision});
    assert.equal(result.status,200);request=result.data.request;
    result=await ccc.call(`/api/requests/${request.id}/resolution`,'POST',{members:['ccc-pablo'],decision:'Aprobado',decisionNote:'Cambio viable',revision:request.revision});
    assert.equal(result.status,200);request=result.data.request;
    assert.equal(request.status,'Aprobada');
    app.db.prepare("UPDATE users SET active=0 WHERE id='ccc-pablo'").run();
    assert.equal((await ccc.call('/api/auth/me')).status,401);
  } finally {await stop(app);}
});
test('la solicitud pública no crea cuenta y solo el CCC activo la ve',async()=>{
  const app=await start();
  try {
    const guest=await client(app),ccc=await client(app,'pablomiembroccc@uta.edu.ec');
    const payload={...common,name:'Visitante',email:'visitante@example.com'};
    assert.equal((await guest.call('/backend/data/changeflow.sqlite')).status,404);
    assert.equal((await guest.call('/.env')).status,404);
    assert.equal((await guest.call('/api/public/requests','POST',{...payload,name:''})).status,400);
    assert.equal((await guest.call('/api/public/requests','POST',{...payload,email:'incorrecto'})).status,400);
    assert.equal((await guest.call('/api/public/requests','POST',{...payload,requesterType:'experto'})).status,403);
    assert.equal((await guest.call('/api/public/requests','POST',payload,{Origin:'https://otro.example'})).status,403);
    const response=await guest.call('/api/public/requests','POST',payload);
    assert.equal(response.status,201);
    assert.deepEqual(Object.keys(response.data),['receipt']);
    assert.equal((await guest.call('/api/requests')).status,401);
    const request=(await ccc.call('/api/requests')).data.requests[0];
    assert.equal(request.ownerId,null);assert.equal(request.name,'Visitante');
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,10);
    for(let i=0;i<16;i++)assert.equal((await guest.call('/api/public/requests','POST',payload)).status,201);
    assert.equal((await guest.call('/api/public/requests','POST',payload)).status,429);
  } finally {await stop(app);}
});
test('validación, identidad, edición y códigos de solicitud siguen protegidos',async()=>{
  const app=await start();
  try {
    const expert=await client(app,'shirley@uta.edu.ec'),ccc=await client(app,'pablomiembroccc@uta.edu.ec');
    assert.equal((await expert.call('/api/requests','POST',{...expertRequest,description:'corto'})).status,400);
    assert.equal((await expert.call('/api/requests','POST',{...expertRequest,proposedPriority:'No válida'})).status,400);
    assert.equal((await expert.call('/api/requests','POST',expertRequest,{Origin:'https://otro.example'})).status,403);
    const created=await expert.call('/api/requests','POST',{...expertRequest,name:'Suplantado',ownerId:'ccc-pablo',status:'Aprobada'});
    assert.equal(created.status,201);
    let request=created.data.request;
    assert.equal(request.name,'Shirley');assert.equal(request.ownerId,'expert-shirley');assert.equal(request.status,'Pendiente');
    assert.equal((await expert.call(`/api/requests/${request.id}`,'PATCH',{...expertRequest,revision:request.revision-1})).status,409);
    const edited=await expert.call(`/api/requests/${request.id}`,'PATCH',{...expertRequest,title:'Nuevo título',revision:request.revision});
    assert.equal(edited.status,200);request=edited.data.request;assert.equal(request.title,'Nuevo título');
    const removed=await expert.call(`/api/requests/${request.id}`,'DELETE',{revision:request.revision});
    assert.equal(removed.status,200);
    const next=await expert.call('/api/requests','POST',expertRequest);
    assert.notEqual(next.data.request.id,request.id);
    assert.equal((await ccc.call(`/api/requests/${next.data.request.id}`,'DELETE',{revision:next.data.request.revision})).status,403);
  } finally {await stop(app);}
});
test('login limita intentos y logout revoca la sesión',async()=>{
  const app=await start();
  try {
    const guest=await client(app);
    const expert=await client(app,'pablo@uta.edu.ec');
    assert.equal((await expert.call('/api/auth/logout','POST',{})).status,200);
    assert.equal((await expert.call('/api/auth/me')).status,401);
    for(let i=0;i<10;i++)assert.equal((await guest.call('/api/auth/login','POST',{email:'nadie@example.com',password:'incorrecta'})).status,401);
    assert.equal((await guest.call('/api/auth/login','POST',{email:'nadie@example.com',password:'incorrecta'})).status,429);
  } finally {await stop(app);}
});
test('el reinicio borra solicitudes y sesiones, conserva las diez cuentas nuevas',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'changeflow-test-')),filename=join(folder,'app.sqlite');let app;
  try {
    app=await start(filename);const expert=await client(app,'edwin@uta.edu.ec');
    assert.equal((await expert.call('/api/requests','POST',expertRequest)).status,201);
    await stop(app);app=null;app=await start(filename);
    const priorSession=await client(app,'edwin@uta.edu.ec');
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM requests').get().n,1);
    resetData(app.db,PASSWORD);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM requests').get().n,0);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,10);
    assert.equal((await priorSession.call('/api/auth/me')).status,401);
    const fresh=await client(app,'edwin@uta.edu.ec');
    assert.equal((await fresh.call('/api/requests')).data.requests.length,0);
    assert.equal((await fresh.call('/api/requests','POST',expertRequest)).data.request.id,'SCR-0001');
  } finally {if(app)await stop(app);rmSync(folder,{recursive:true,force:true});}
});
test('la base anterior migra y el reinicio elimina sus usuarios y expedientes',()=>{
  const folder=mkdtempSync(join(tmpdir(),'changeflow-migration-')),filename=join(folder,'old.sqlite');let db;
  try {
    db=new DatabaseSync(filename);
    db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,role TEXT NOT NULL,password_hash TEXT NOT NULL);
      INSERT INTO users VALUES('old-user','Nombre','correo@example.com','usuario','hash');
      CREATE TABLE requests(id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id TEXT NOT NULL REFERENCES users(id),document TEXT NOT NULL);
      INSERT INTO requests VALUES(1,'old-user','{"id":"SCR-0001"}');`);
    db.close();db=openDatabase(filename);
    assert.equal(db.prepare("SELECT active FROM users WHERE id='old-user'").get().active,1);
    resetData(db,PASSWORD);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE id='old-user'").get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM requests').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n,10);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {db?.close();rmSync(folder,{recursive:true,force:true});}
});

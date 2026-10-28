'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {createApp}=require('../backend/server.cjs');
const LEGACY_USERS=[['user-ana','Ana Martínez','ana@changeflow.local','usuario'],['expert-diego','Diego Sánchez','diego@changeflow.local','experto'],['ccc-carlos','Carlos Pérez','carlos@changeflow.local','ccc'],['ccc-maria','María López','maria@changeflow.local','ccc']];
const PASSWORD='Test-ChangeFlow-2026!';
const common={requesterType:'usuario',project:'ProyectoBusesUTA',module:'Autenticación y usuarios',title:'Mensajes de inicio de sesión',currentBehavior:'El mensaje resulta confuso.',description:'Mejorar los mensajes del proceso de inicio de sesión.',justification:'Los usuarios necesitan comprender cómo corregir sus datos.',result:'Mensajes comprensibles.',attachments:[]};
const analysis={impact:'Medio',technicalImpact:'Textos y pruebas de autenticación',risks:'Compatibilidad de mensajes',feasibility:'Viable',effort:'24 horas',resources:'Un desarrollador y un tester',considerations:'Verificar accesibilidad',priority:'Media'};
async function start(filename=':memory:') {
  const app=createApp({filename,seedPassword:PASSWORD,initialUsers:LEGACY_USERS});await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
  app.url=`http://127.0.0.1:${app.server.address().port}`;return app;
}
async function stop(app){await new Promise(resolve=>app.server.close(resolve));}
async function client(app,email) {
  let cookie='',csrf='';
  const call=async(path,method='GET',body,headers={})=>{
    const response=await fetch(app.url+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];
    const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
    if(data.csrf)csrf=data.csrf;return {status:response.status,data,headers:response.headers};
  };
  if(email){const result=await call('/api/auth/login','POST',{email,password:PASSWORD});assert.equal(result.status,200);assert.match(result.headers.get('set-cookie'),/HttpOnly/);}
  return {call};
}
test('sesiones, permisos y resolución por un único responsable del CCC',async()=>{
  const app=await start();
  try {
    const anonymous=await client(app);
    assert.equal((await anonymous.call('/api/requests')).status,401);
    assert.equal((await anonymous.call('/backend/data/changeflow.sqlite')).status,404);
    assert.equal((await anonymous.call('/.env')).status,404);
    const ana=await client(app,'ana@changeflow.local'),diego=await client(app,'diego@changeflow.local'),carlos=await client(app,'carlos@changeflow.local'),maria=await client(app,'maria@changeflow.local');
    assert.equal((await ana.call('/api/requests','POST',{...common,requesterType:'experto'})).status,403);
    assert.equal((await ana.call('/api/requests','POST',{...common,description:'corto'})).status,400);
    assert.equal((await ana.call('/api/requests','POST',{...common,type:'No válido'})).status,400);
    assert.equal((await ana.call('/api/requests','POST',common,{'X-CSRF-Token':'falso'})).status,403);
    assert.equal((await ana.call('/api/requests','POST',common,{Origin:'https://malicioso.example'})).status,403);
    let result=await ana.call('/api/requests','POST',{...common,type:'Mejora',name:'Identidad falsa',ownerId:'ccc-carlos',status:'Aprobada',history:[{note:'falso'}]});assert.equal(result.status,201);
    let r=result.data.request;assert.equal(r.name,'Ana Martínez');assert.equal(r.status,'Pendiente');assert.equal(r.history.length,1);
    assert.equal(r.type,'Mejora');
    const id=r.id;
    const action=async(who,kind,body={})=>{
      const response=await who.call(`/api/requests/${id}/${kind}`,'POST',{...body,revision:r.revision});if(response.status===200)r=response.data.request;return response;
    };
    assert.equal((await diego.call('/api/requests')).data.requests.length,0);
    assert.equal((await diego.call(`/api/requests/${id}`,'PATCH',{...common,revision:r.revision})).status,403);
    assert.equal((await action(ana,'analysis',analysis)).status,403);
    assert.equal((await action(carlos,'resolution',{members:['ccc-carlos'],decision:'Aprobado',decisionNote:'Sin análisis'})).status,409);
    assert.equal((await action(carlos,'analysis',{...analysis,analyst:'Identidad falsa'})).status,200);assert.equal(r.analysis.analyst,'Carlos Pérez');
    assert.equal((await ana.call(`/api/requests/${id}`,'PATCH',{...common,revision:r.revision})).status,409);
    const oldRevision=r.revision;
    assert.equal(r.reviewerId,'ccc-carlos');
    assert.equal((await action(maria,'analysis',analysis)).status,403);
    assert.equal((await action(maria,'resolution',{decision:'Aprobado',decisionNote:'Resolver análisis ajeno'})).status,403);
    assert.equal((await action(carlos,'vote',{decision:'Aprobado'})).status,404);
    // Los votos históricos de la versión anterior no condicionan las nuevas decisiones.
    r.committeeVotes=[{id:'ccc-maria',name:'María López',decision:'Rechazado'}];
    app.db.prepare('UPDATE requests SET document=? WHERE id=?').run(JSON.stringify(r),Number(id.slice(4)));
    assert.equal((await action(carlos,'resolution',{decision:'Más información',decisionNote:'Aclarar los impactos'})).status,200);
    assert.equal(r.status,'Más información');assert.equal(r.resolutions.length,1);assert.equal(r.decision.votes,undefined);
    assert.equal((await action(carlos,'clarification',{note:'Respuesta ajena'})).status,403);
    assert.equal((await action(ana,'clarification',{note:'La propuesta contempla pruebas de accesibilidad.'})).status,200);
    assert.equal(r.status,'Pendiente');assert.equal(r.analysis,null);assert.equal(r.clarifications.length,1);
    assert.equal((await action(maria,'analysis',analysis)).status,403);
    assert.equal((await action(carlos,'resolution',{decision:'Aprobado',decisionNote:'Sin nuevo análisis'})).status,409);
    assert.equal((await carlos.call(`/api/requests/${id}/analysis`,'POST',{...analysis,revision:oldRevision})).status,409);
    assert.equal((await action(carlos,'analysis',analysis)).status,200);
    const resolution={decision:'Aprobado con condiciones',decisionNote:'Implementar bajo restricciones'};
    assert.equal((await action(carlos,'resolution',resolution)).status,400);
    assert.equal((await action(carlos,'resolution',{...resolution,conditions:'Completar pruebas de accesibilidad',responsible:'Falso',date:'1990-01-01',members:['ccc-maria']})).status,200);
    assert.equal(r.status,'Aprobada con condiciones');assert.equal(r.decision.responsible,'Carlos Pérez');assert.notEqual(r.decision.date,'1990-01-01');assert.equal(r.resolutions.length,2);
    assert.equal(r.decision.analysisSnapshot.analystId,r.decision.responsibleId);
    assert.equal((await action(carlos,'analysis',analysis)).status,409);
    assert.equal((await action(carlos,'resolution',resolution)).status,409);
    assert.equal((await ana.call(`/api/requests/${id}`,'DELETE',{revision:r.revision})).status,409);
    assert.equal((await carlos.call('/api/requests')).data.requests[0].status,'Aprobada con condiciones');
    // Un miembro del CCC puede solicitar, pero no evaluar ni resolver su propio cambio.
    result=await carlos.call('/api/requests','POST',common);const own=result.data.request;
    assert.equal((await carlos.call(`/api/requests/${own.id}/analysis`,'POST',{...analysis,revision:own.revision})).status,403);
    let independent=(await maria.call(`/api/requests/${own.id}/analysis`,'POST',{...analysis,revision:own.revision})).data.request;
    assert.equal((await carlos.call(`/api/requests/${own.id}/resolution`,'POST',{decision:'Aprobado',decisionNote:'Propia',revision:independent.revision})).status,403);
    result=await maria.call(`/api/requests/${own.id}/resolution`,'POST',{members:['ccc-maria'],decision:'Rechazado',decisionNote:'No es viable',revision:independent.revision});assert.equal(result.status,200);assert.equal(result.data.request.status,'Rechazada');
    // Petición técnica, edición y eliminación solo del dueño y código no reutilizado.
    const expert={...common,requesterType:'experto',type:'Refactorización',proposedPriority:'Alta',components:'auth',environment:'Pruebas',acceptanceCriteria:'Dado un usuario, recibe un mensaje comprensible',currentVersion:'0.1.0'};
    assert.equal((await diego.call('/api/requests','POST',{...expert,proposedPriority:'No válida'})).status,400);
    result=await diego.call('/api/requests','POST',expert);assert.equal(result.status,201);let technical=result.data.request;assert.equal(technical.type,'Refactorización');assert.equal(technical.proposedPriority,'Alta');assert.equal(technical.priority,'Media');
    result=await diego.call(`/api/requests/${technical.id}`,'PATCH',{...expert,title:'Revisar mensajes',revision:technical.revision});assert.equal(result.status,200);technical=result.data.request;
    assert.equal((await diego.call(`/api/requests/${technical.id}`,'DELETE',{revision:technical.revision})).status,200);
    result=await diego.call('/api/requests','POST',expert);assert.notEqual(result.data.request.id,technical.id);
    // Aprobación simple con un único integrante sin votos.
    let single=result.data.request;
    for(const [kind,body] of [['analysis',analysis],['resolution',{members:['ccc-carlos'],decision:'Aprobado',decisionNote:'Cambio viable'}]]) {
      result=await carlos.call(`/api/requests/${single.id}/${kind}`,'POST',{...body,revision:single.revision});assert.equal(result.status,200);single=result.data.request;
    }
    assert.equal(single.status,'Aprobada');
    assert.equal((await ana.call('/api/auth/logout','POST',{})).status,200);assert.equal((await ana.call('/api/requests')).status,401);
  }finally{await stop(app);}
});
test('persistencia SQLite, contraseñas protegidas y reanudación sin reseed',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'changeflow-test-')),filename=join(folder,'app.sqlite');let app;
  try {
    app=await start(filename);let ana=await client(app,'ana@changeflow.local');const created=await ana.call('/api/requests','POST',common);assert.equal(created.status,201);
    const hashes=app.db.prepare('SELECT password_hash FROM users').all();assert.ok(hashes.every(x=>x.password_hash!==PASSWORD));assert.equal(new Set(hashes.map(x=>x.password_hash)).size,4);
    await stop(app);app=null;
    app=await start(filename);ana=await client(app,'ana@changeflow.local');assert.equal((await ana.call('/api/requests')).data.requests[0].id,created.data.request.id);
    const anonymous=await client(app);for(let i=0;i<10;i++)assert.equal((await anonymous.call('/api/auth/login','POST',{email:'inexistente@example.com',password:'incorrecta'})).status,401);
    assert.equal((await anonymous.call('/api/auth/login','POST',{email:'inexistente@example.com',password:'incorrecta'})).status,429);
  } finally {if(app)await stop(app);rmSync(folder,{recursive:true,force:true});}
});

test('solicitud pública sin cuenta: validación, privacidad y revisión del CCC',async()=>{
  const app=await start();
  try {
    const guest=await client(app),ana=await client(app,'ana@changeflow.local'),ccc=await client(app,'carlos@changeflow.local'),developer=await client(app,'diego@changeflow.local');
    const payload={...common,name:'Visitante de prueba',email:'ana@changeflow.local',ownerId:'ccc-carlos',status:'Aprobada'};
    const submit=(body=payload,headers={})=>guest.call('/api/public/requests','POST',body,headers);
    assert.equal((await submit({...payload,name:''})).status,400);
    assert.equal((await submit({...payload,email:'incorrecto'})).status,400);
    assert.equal((await submit({...payload,requesterType:'experto'})).status,403);
    assert.equal((await submit(payload,{Origin:'https://otro.example'})).status,403);
    const response=await submit();assert.equal(response.status,201);
    assert.deepEqual(Object.keys(response.data),['receipt']);
    assert.deepEqual(Object.keys(response.data.receipt).sort(),['date','id','status']);
    const id=response.data.receipt.id;
    assert.equal((await guest.call('/api/requests')).status,401);
    assert.equal((await guest.call('/api/committee')).status,401);
    assert.equal((await guest.call(`/api/requests/${id}/analysis`,'POST',analysis)).status,401);
    assert.equal((await ana.call('/api/requests')).data.requests.length,0);
    const visible=(await developer.call('/api/requests')).data.requests;
    assert.equal(visible.length,1);assert.equal(visible[0].id,id);
    assert.equal((await developer.call(`/api/requests/${id}`,'PATCH',{...common,revision:1})).status,403);
    assert.equal((await developer.call(`/api/requests/${id}`,'DELETE',{revision:1})).status,403);
    assert.equal((await developer.call(`/api/requests/${id}/analysis`,'POST',{...analysis,revision:1})).status,403);

    assert.equal((await ana.call(`/api/requests/${id}`,'PATCH',{...common,revision:1})).status,403);
    let r=(await ccc.call('/api/requests')).data.requests.find(r=>r.id===id);
    assert.equal(r.ownerId,null);assert.equal(r.submittedWithoutAccount,true);assert.equal(r.name,payload.name);assert.equal(r.status,'Pendiente');
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,4);
    let result=await ccc.call(`/api/requests/${id}/analysis`,'POST',{...analysis,revision:r.revision});assert.equal(result.status,200);r=result.data.request;
    result=await ccc.call(`/api/requests/${id}/resolution`,'POST',{members:['ccc-carlos'],decision:'Aprobado',decisionNote:'Revisión de solicitud pública',revision:r.revision});assert.equal(result.status,200);
    assert.equal((await guest.call('/api/auth/me')).status,401);
    for(let i=0;i<16;i++)assert.equal((await submit()).status,201);
    assert.equal((await submit()).status,429);
  }finally{await stop(app);}
});

test('migra propietarios opcionales conservando datos y contador de códigos',async()=>{
  const {DatabaseSync}=require('node:sqlite');
  const {openDatabase}=require('../backend/database.cjs');
  const folder=mkdtempSync(join(tmpdir(),'buses-migration-')),filename=join(folder,'old.sqlite');
  let db;
  try {
    db=new DatabaseSync(filename);
    db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,role TEXT NOT NULL,password_hash TEXT NOT NULL);
      INSERT INTO users VALUES('old-user','Nombre','correo@example.com','usuario','hash');
      CREATE TABLE requests(id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id TEXT NOT NULL REFERENCES users(id),document TEXT NOT NULL);
      INSERT INTO requests VALUES(1,'old-user','{"id":"SCR-0001"}');
      INSERT INTO requests VALUES(15,'old-user','{}');DELETE FROM requests WHERE id=15;`);
    db.close();db=openDatabase(filename);
    assert.equal(db.prepare('SELECT document FROM requests WHERE id=1').get().document,'{"id":"SCR-0001"}');
    assert.equal(db.prepare('INSERT INTO requests(owner_id,document) VALUES(NULL,?)').run('{}').lastInsertRowid,16);
    db.close();db=openDatabase(filename);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM requests').get().n,2);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db?.close();rmSync(folder,{recursive:true,force:true});}
});

test('equipo: cinco cuentas personales, solo David CCC y cuentas antiguas desactivadas',async()=>{
  const {configureTeam}=require('../backend/configure-team.cjs');
  const app=await start();
  try{
    const old=await client(app,'carlos@changeflow.local');
    const ana=await client(app,'ana@changeflow.local');
    const created=await ana.call('/api/requests','POST',common);let r=created.data.request;
    r=(await old.call(`/api/requests/${r.id}/analysis`,'POST',{...analysis,revision:r.revision})).data.request;
    const result=configureTeam(app.db,PASSWORD);
    assert.equal(result.users.length,5);assert.equal(result.users.filter(u=>u.role==='ccc').length,1);
    assert.equal(result.users.find(u=>u.role==='ccc').email,'david@uta.edu.ec');
    assert.equal((await old.call('/api/requests')).status,401);
    const anonymous=await client(app);
    assert.equal((await anonymous.call('/api/auth/login','POST',{email:'carlos@changeflow.local',password:PASSWORD})).status,401);
    for(const who of ['leslie','edwin','pablo','shirley']){
      const account=await client(app,`${who}@uta.edu.ec`);
      assert.equal((await account.call('/api/auth/me')).data.user.role,'experto');
      const current=JSON.parse(app.db.prepare('SELECT document FROM requests WHERE id=?').get(Number(r.id.slice(4))).document);
      assert.equal((await account.call(`/api/requests/${r.id}/analysis`,'POST',{...analysis,revision:current.revision})).status,403);
    }
    const david=await client(app,'david@uta.edu.ec');
    assert.deepEqual((await david.call('/api/committee')).data.users.map(u=>u.email),['david@uta.edu.ec']);
    r=(await david.call('/api/requests')).data.requests[0];assert.equal(r.analysis,null);assert.equal(r.previousAnalyses.length,1);
    let response=await david.call(`/api/requests/${r.id}/analysis`,'POST',{...analysis,revision:r.revision});assert.equal(response.status,200);r=response.data.request;
    response=await david.call(`/api/requests/${r.id}/resolution`,'POST',{decision:'Aprobado',decisionNote:'Evaluado por el responsable actual.',revision:r.revision});assert.equal(response.status,200);
    const ids=app.db.prepare('SELECT id FROM users WHERE active=1 ORDER BY id').all().map(u=>u.id);
    configureTeam(app.db,PASSWORD);assert.deepEqual(app.db.prepare('SELECT id FROM users WHERE active=1 ORDER BY id').all().map(u=>u.id),ids);
  }finally{await stop(app);}
});

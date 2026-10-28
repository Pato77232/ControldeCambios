'use strict';
// Prueba de los manejadores del cliente con respuestas de API controladas.
// Las autorizaciones y las transacciones reales se prueban en backend.test.cjs.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const nodes=new Map();
function node(id){
  if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',hidden:false,dataset:{},classList:{toggle(){}},setAttribute(){},removeAttribute(){},addEventListener(){},focus(){},querySelector:node,querySelectorAll:()=>[],showModal(){}});
  return nodes.get(id);
}
const user={id:'user-ana',name:'Ana Martínez',email:'ana@changeflow.local',role:'usuario'};
const committee=[{id:'ccc-carlos',name:'Carlos Pérez',role:'ccc'},{id:'ccc-maria',name:'María López',role:'ccc'}];
let active=user,requests=[],calls=[];
const fetch=async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):{};calls.push({url,...options,data:body});
  let result;
  if(url==='/api/auth/me'||url==='/api/auth/login')result={user:active,csrf:'csrf-from-server'};
  else if(url==='/api/public/requests')result={receipt:{id:'SCR-0008',date:'2026-10-27',status:'Pendiente'}};
  else if(url==='/api/committee')result={users:active.role==='ccc'?committee:[]};
  else if(url==='/api/requests'&&!options.body)result={nextId:1,requests};
  else if(url==='/api/auth/logout')result={ok:true};
  else if(url==='/api/requests'){
    const r={...body,id:'SCR-0007',ownerId:active.id,name:active.name,email:active.email,date:'2026-10-23',revision:1,status:'Pendiente',priority:'Media',history:[],resolutions:[]};requests=[r];result={request:r,store:{nextId:8,requests}};
  } else result={request:requests[0],store:{nextId:8,requests}};
  return {ok:true,status:200,json:async()=>result};
};
class FormDataMock {static data={};constructor(){return Object.entries(FormDataMock.data)[Symbol.iterator]();}}
const context=vm.createContext({console,Date,Intl,Set,Map,String,Number,Array,Object,Math,JSON,Error,Promise,fetch,FormData:FormDataMock,setTimeout:()=>0,clearTimeout(){},location:{hash:'#panel'},window:{scrollTo(){},addEventListener(){}},document:{querySelector:id=>id==='#clarification-form'?null:node(id),querySelectorAll:()=>[],addEventListener(){},getElementById:id=>node('#'+id)}});
const run=source=>vm.runInContext(source,context);
const submit=async(id,data)=>{FormDataMock.data=data;await node(id).onsubmit({preventDefault(){},currentTarget:node(id)});};
(async()=>{
  run(fs.readFileSync('js/app.js','utf8').replace(/bootstrap\(\);\s*$/,'const ready=bootstrap();'));
  await run('ready');assert.equal(run('currentUser.id'),user.id);assert.equal(run('csrfToken'),'csrf-from-server');
  run("location.hash='#nueva';route()");assert.match(node('main').innerHTML,/Solicitud de cambio – Usuario final/);assert.doesNotMatch(node('main').innerHTML,/id="specId"/);
  assert.match(node('main').innerHTML,/id="name"[^>]*readonly/);
  const common={name:user.name,email:user.email,project:'Proyecto',module:'Autenticación y usuarios',title:'Solicitud de prueba',currentBehavior:'Mensaje confuso',description:'Necesitamos mensajes de error comprensibles.',justification:'Ayudará a los usuarios a corregir sus datos.',result:'Mensaje claro'};
  await submit('#request-form',{});assert.match(node('#name-error').textContent,/obligatorio/);
  await submit('#request-form',common);assert.equal(context.location.hash,'detalle/SCR-0007');
  const create=calls.find(c=>c.url==='/api/requests'&&c.method==='POST');assert.equal(create.data.requesterType,'usuario');assert.equal(create.headers['X-CSRF-Token'],'csrf-from-server');
  run('committeeForm(store.requests[0])');assert.match(node('main').innerHTML,/Solo un miembro independiente/);
  active=committee[0];context.committeeUser=active;run('currentUser=committeeUser');await run('loadStore()');
  requests[0].analysis={analyst:'Carlos Pérez',impact:'Medio',feasibility:'Viable',effort:'24 horas',considerations:'Revisar pruebas'};requests[0].committeeVotes=[];
  run('resolutionForm(store.requests[0])');assert.match(node('main').innerHTML,/id="own-vote"/);assert.doesNotMatch(node('main').innerHTML,/id="vote2"/);
  node('#own-vote').value='Aprobado';await submit('#vote-form',{});
  const vote=calls.find(c=>c.url.endsWith('/vote'));assert.deepEqual(vote.data,{decision:'Aprobado',revision:1});assert.equal(vote.data.id,undefined);
  await submit('#resolution-form',{member1:'ccc-carlos',member2:'ccc-maria',decision:'Aprobado',decisionNote:'Ambos están de acuerdo'});
  const resolution=calls.find(c=>c.url.endsWith('/resolution'));assert.deepEqual(resolution.data.members,['ccc-carlos','ccc-maria']);assert.equal(resolution.data.votes,undefined);assert.equal(resolution.data.responsible,undefined);
  run("currentUser=null;location.hash='#login';route()");assert.match(node('main').innerHTML,/id="login-form"/);
  run("location.hash='#nueva/usuario';route()");assert.match(node('main').innerHTML,/id="request-form"/);
  assert.doesNotMatch(node('main').innerHTML,/id="name"[^>]*readonly/);
  assert.doesNotMatch(node('main').innerHTML,/id="email"[^>]*readonly/);
  await submit('#request-form',{...common,name:'Visitante',email:'visitante@example.com'});
  assert.equal(calls.find(c=>c.url==='/api/public/requests').data.requesterType,'usuario');
  assert.match(node('main').innerHTML,/Solicitud enviada/);assert.match(node('main').innerHTML,/SCR-0008/);
  run("location.hash='#nueva/experto';route()");assert.match(node('main').innerHTML,/id="login-form"/);
  assert.equal(run("esc('<script>')"),'&lt;script&gt;');
  console.log('OK cliente: sesión, formulario por perfil, identidad de solo lectura, rutas protegidas y envío de voto propio/resolución a la API.');
})().catch(error=>{console.error(error);process.exitCode=1;});

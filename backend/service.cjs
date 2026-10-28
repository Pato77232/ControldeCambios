'use strict';
const {randomBytes}=require('node:crypto');
const { publicUser } = require('./auth.cjs');
class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
const fail=(status,message)=>{throw new HttpError(status,message);};
const RESOLUTIONS=['Aprobado','Aprobado con condiciones','Rechazado','Más información'];
const STATUS={'Aprobado':'Aprobada','Aprobado con condiciones':'Aprobada con condiciones','Rechazado':'Rechazada','Más información':'Más información'};
const MODULES=['Autenticación y usuarios','Cooperativas','Frecuencias y precios por tramo','Buses y plantillas de asientos','Hojas de ruta','Búsqueda de viajes','Reservas y pasajeros','Pagos y comprobantes','Boletos QR e historial','Notificaciones','Configuración de la aplicación'];
const PRIORITIES=['Baja','Media','Alta','Crítica'];
const open=r=>['Pendiente','Más información'].includes(r.status);
function text(data,key,required=false,max=5000) {
  if(data[key]!==undefined && typeof data[key]!=='string') fail(400,`Campo inválido: ${key}.`);
  const value=(data[key] || '').trim();
  if((required&&!value) || value.length>max) fail(400,`Revisa el campo ${key}.`);
  return value;
}
function option(value,values,label){if(!values.includes(value)) fail(400,`Selecciona ${label} válido.`);return value;}
function getRequest(db,id,user) {
  if(!/^SCR-\d{4,}$/.test(id)) fail(404,'Solicitud no encontrada.');
  const row=db.prepare('SELECT document FROM requests WHERE id=?').get(Number(id.slice(4)));
  if(!row) fail(404,'Solicitud no encontrada.');
  const r=JSON.parse(row.document);
  if(user.role!=='ccc' && r.ownerId!==user.id) fail(403,'No tienes acceso a esta solicitud.');
  return r;
}
function snapshot(db,user) {
  const rows=user.role==='ccc' ? db.prepare('SELECT document FROM requests ORDER BY id').all() : db.prepare('SELECT document FROM requests WHERE owner_id=? ORDER BY id').all(user.id);
  const seq=db.prepare("SELECT seq FROM sqlite_sequence WHERE name='requests'").get();
  return {nextId:Number(seq?.seq || 0)+1,requests:rows.map(x=>JSON.parse(x.document))};
}
function publicStatus(db,input) {
  const code=String(input||'').trim().toUpperCase();
  const isTracking=/^CONS-(?:[A-F0-9]{4}-){4}[A-F0-9]{4}$/.test(code);
  const isLegacy=/^SCR-\d{4,}$/.test(code);
  if(!isTracking&&!isLegacy)fail(404,'No encontramos una solicitud con ese código.');
  const legacyId=isLegacy?Number(code.slice(4)):null;
  if(isLegacy&&(!Number.isSafeInteger(legacyId)||legacyId<1))fail(404,'No encontramos una solicitud con ese código.');
  const row=isTracking
    ? db.prepare('SELECT document FROM requests WHERE tracking_code=? AND owner_id IS NULL').get(code)
    : db.prepare('SELECT document FROM requests WHERE id=? AND tracking_code IS NULL AND owner_id IS NULL').get(legacyId);
  if(!row)fail(404,'No encontramos una solicitud con ese código.');
  const r=JSON.parse(row.document);
  if(isLegacy&&r.id!==code)fail(404,'No encontramos una solicitud con ese código.');
  const decided=r.status!=='Pendiente';
  const stage=decided?'Decisión ya tomada':r.analysis?'Analizada':'No analizada';
  const result=decided?(r.decision?.decision||({'Aprobada':'Aprobado','Aprobada con condiciones':'Aprobado con condiciones','Rechazada':'Rechazado','Más información':'Más información'}[r.status]||null)):null;
  const timeline=[{stage:'No analizada',date:r.history?.[0]?.date||r.date,summary:'Solicitud registrada.'}];
  if(r.analysis?.date)timeline.push({stage:'Analizada',date:r.analysis.date,summary:'Análisis completado.'});
  if(decided&&r.decision?.date)timeline.push({stage:'Decisión ya tomada',date:r.decision.date,summary:`Resultado: ${result}.`});
  return {id:r.id,stage,result,timeline,contactNotice:result==='Más información'?'Para aclaraciones, comunícate con un experto o miembro del CCC.':null};
}
function committee(db){return db.prepare("SELECT id,name,email,role FROM users WHERE role='ccc' AND active=1 ORDER BY id").all().map(publicUser);}
function authorizeCommittee(r,user){if(user.role!=='ccc')fail(403,'Solo el CCC puede realizar esta acción.');if(r.ownerId===user.id)fail(403,'No puedes evaluar ni resolver tu propia solicitud.');if(!open(r))fail(409,'Esta solicitud ya tiene una resolución definitiva.');}
function checkRevision(r,data){if(data.revision!==r.revision)fail(409,'La solicitud cambió. Actualiza el expediente antes de guardar.');}
function history(r,user,note){r.history.push({status:r.status,date:new Date().toISOString(),responsible:user.name,responsibleId:user.id,note});}
function save(db,r){r.revision++;db.prepare('UPDATE requests SET document=? WHERE id=?').run(JSON.stringify(r),Number(r.id.slice(4)));return r;}
function requestFields(data,kind,date) {
  const result={};
  for(const k of ['project','module','title','currentBehavior','description','justification','result'])result[k]=text(data,k,true,['project','module','title'].includes(k)?200:5000);
  option(result.module,MODULES,'un módulo');
  result.type=option(text(data,'type') || (kind==='experto'?'Defecto':'Error'),kind==='experto'?['Defecto','Mejora','Nueva funcionalidad','Refactorización','Seguridad']:['Error','Mejora','Nueva funcionalidad'],'un tipo de solicitud');
  if(kind==='experto') result.proposedPriority=option(text(data,'proposedPriority') || 'Media',PRIORITIES,'una prioridad propuesta');
  for(const k of ['description','justification'])if(result[k].length<20)fail(400,`${k}: escribe al menos 20 caracteres.`);
  for(const k of ['desiredDate','observations'])result[k]=text(data,k);
  if(result.desiredDate && (!/^\d{4}-\d{2}-\d{2}$/.test(result.desiredDate) || Number.isNaN(Date.parse(result.desiredDate)) || new Date(result.desiredDate).toISOString().slice(0,10)!==result.desiredDate || result.desiredDate<date))fail(400,'La fecha deseada debe ser válida y no anterior a la solicitud.');
  if(!Array.isArray(data.attachments) || data.attachments.length>20 || data.attachments.some(x=>typeof x!=='string'||x.length>255))fail(400,'Adjuntos inválidos (máximo 20 nombres).');
  result.attachments=data.attachments;
  if(kind==='experto') {
    for(const k of ['components','environment','acceptanceCriteria'])result[k]=text(data,k,true,k==='acceptanceCriteria'?5000:200);
    option(result.environment,['Desarrollo','Pruebas','Producción'],'un entorno');
    for(const k of ['currentVersion','targetVersion','specId','businessRules'])result[k]=text(data,k,false,200);
    for(const k of ['currentVersion','targetVersion'])if(result[k]&&!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(result[k]))fail(400,'Versión inválida: usa MAJOR.MINOR.PATCH.');
    if(result.specId&&!/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+$/.test(result.specId))fail(400,'Referencia de spec inválida.');
    if(result.businessRules&&!/^RN-\d{2}(?:\s*,\s*RN-\d{2})*$/.test(result.businessRules))fail(400,'Referencias RN inválidas.');
  }
  return result;
}
function createRequest(db,user,data) {
  const guest=!user;
  if(user?.role==='ccc')fail(403,'El CCC solo revisa solicitudes.');
  if(guest) {
    if(data.requesterType!=='usuario')fail(403,'Solo las solicitudes de usuario final pueden enviarse sin cuenta.');
    const name=text(data,'name',true,200),email=text(data,'email',true,200).toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Ingresa un correo válido.');
    user={id:null,name,email,role:'usuario'};
  }
  const kind=user.role;
  if(data.requesterType!==kind)fail(403,'El tipo de petición no corresponde a tu perfil.');
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const fields=requestFields(data,kind,date);
  let trackingCode=null;
  if(guest){
    do {const hex=randomBytes(10).toString('hex').toUpperCase();trackingCode=`CONS-${hex.match(/.{4}/g).join('-')}`;}
    while(db.prepare('SELECT 1 FROM requests WHERE tracking_code=?').get(trackingCode));
  }
  const inserted=db.prepare('INSERT INTO requests(owner_id,document,tracking_code) VALUES(?,?,?)').run(user.id,'{}',trackingCode);
  const r={...fields,id:`SCR-${String(inserted.lastInsertRowid).padStart(4,'0')}`,date,name:user.name,email:user.email,ownerId:user.id,...(guest?{submittedWithoutAccount:true,trackingCode}:{}),requesterType:kind,priority:'Media',status:'Pendiente',revision:0,history:[],resolutions:[],committeeVotes:[]};
  history(r,user,'Solicitud registrada.');save(db,r);return r;
}
function mutate(db,id,action,user,data) {
  const r=getRequest(db,id,user);checkRevision(r,data);
  if(action==='clarification') {
    if(r.ownerId!==user.id)fail(403,'Solo el solicitante puede aportar la información adicional.');
    if(r.status!=='Más información')fail(409,'No hay una solicitud de información pendiente.');
    const note=text(data,'note',true);
    (r.clarifications ||= []).push({note,responsible:user.name,date:new Date().toISOString()});
    r.analysis=null;r.committeeVotes=[];r.status='Pendiente';history(r,user,'Información adicional: '+note);
  } else if(action==='edit'||action==='delete') {
    if(r.ownerId!==user.id)fail(403,'Solo el solicitante puede modificar esta petición.');
    if(r.analysis||r.status!=='Pendiente')fail(409,'La petición está bloqueada porque ya fue analizada.');
    if(action==='delete'){db.prepare('DELETE FROM requests WHERE id=?').run(Number(id.slice(4)));return null;}
    Object.assign(r,requestFields(data,r.requesterType,r.date));history(r,user,'Petición actualizada.');
  } else {
    authorizeCommittee(r,user);
    if(action==='analysis') {
      const analysis={};
      for(const k of ['impact','technicalImpact','risks','feasibility','effort','resources','considerations','priority'])analysis[k]=text(data,k,true);
      option(analysis.impact,['Bajo','Medio','Alto'],'un impacto');option(analysis.feasibility,['Viable','Viable con condiciones','No viable'],'una viabilidad');option(analysis.priority,PRIORITIES,'una prioridad');
      r.analysis={...analysis,analyst:user.name,analystId:user.id,date:new Date().toISOString()};r.priority=analysis.priority;r.committeeVotes=[];r.status='Pendiente';history(r,user,'Análisis del CCC actualizado. Los votos anteriores deben renovarse.');
    } else {
      if(!r.analysis)fail(409,'Completa primero el análisis del CCC.');
      if(action==='vote') {
        const decision=option(data.decision,RESOLUTIONS,'una decisión');
        r.committeeVotes=[...(r.committeeVotes||[]).filter(v=>v.id!==user.id),{id:user.id,name:user.name,decision,date:new Date().toISOString()}];
        history(r,user,`Voto individual: ${decision}.`);
      } else if(action==='resolution') {
        const members=data.members;
        if(!Array.isArray(members)||members.length<1||members.length>2||new Set(members).size!==members.length||members.some(x=>typeof x!=='string'))fail(400,'Selecciona uno o dos integrantes distintos.');
        const authorized=new Set(committee(db).map(u=>u.id));
        if(members.some(id=>!authorized.has(id)||id===r.ownerId)||!members.includes(user.id))fail(403,'Los participantes deben pertenecer al CCC, incluir al responsable y excluir al solicitante.');
        if((r.committeeVotes||[]).some(v=>!members.includes(v.id)))fail(409,'Incluye a todos los integrantes que ya registraron su voto.');
        const votes=members.map(id=>(r.committeeVotes||[]).find(v=>v.id===id));
        if(votes.some(v=>!v))fail(409,'Cada participante debe iniciar sesión y registrar su propio voto.');
        const expected=votes.every(v=>v.decision===votes[0].decision)?votes[0].decision:'Más información';
        const decision=option(data.decision,RESOLUTIONS,'una decisión');
        if(expected!==decision)fail(409,'La resolución debe coincidir con los votos. Ante desacuerdo, solicita más información.');
        const decisionNote=text(data,'decisionNote',true),conditions=decision==='Aprobado con condiciones'?text(data,'conditions',true):'';
        const resolution={decision,decisionNote,conditions,responsible:user.name,responsibleId:user.id,date:new Date().toISOString(),votes,analysisSnapshot:{...r.analysis},requestId:r.id,requestSummary:r.title};
        r.decision=resolution;r.resolutions.push(resolution);r.status=STATUS[decision];r.committeeVotes=[];
        history(r,user,`${decision}: ${decisionNote}${conditions?' Condiciones: '+conditions:''}. Votos: ${votes.map(v=>v.name+': '+v.decision).join('; ')}`);
      } else fail(404,'Acción no encontrada.');
    }
  }
  return save(db,r);
}
module.exports={HttpError,fail,snapshot,publicStatus,committee,createRequest,mutate};

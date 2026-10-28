'use strict';
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
  if(user.role!=='ccc' && !(user.role==='experto' && r.submittedWithoutAccount===true && r.ownerId===null) && r.ownerId!==user.id) fail(403,'No tienes acceso a esta solicitud.');
  return r;
}
function snapshot(db,user) {
  const rows=user.role==='ccc' ? db.prepare('SELECT document FROM requests ORDER BY id').all() : user.role==='experto' ? db.prepare("SELECT document FROM requests WHERE owner_id=? OR (owner_id IS NULL AND json_extract(document,'$.submittedWithoutAccount')=1) ORDER BY id").all(user.id) : db.prepare('SELECT document FROM requests WHERE owner_id=? ORDER BY id').all(user.id);
  const seq=db.prepare("SELECT seq FROM sqlite_sequence WHERE name='requests'").get();
  return {nextId:Number(seq?.seq || 0)+1,requests:rows.map(x=>JSON.parse(x.document))};
}
function committee(db){return db.prepare("SELECT id,name,email,role FROM users WHERE role='ccc' AND active=1 ORDER BY id").all().map(publicUser);}
function authorizeCommittee(r,user){if(user.role!=='ccc')fail(403,'Solo el CCC puede realizar esta acción.');if(r.ownerId===user.id)fail(403,'No puedes evaluar ni resolver tu propia solicitud.');if(!open(r))fail(409,'Esta solicitud ya tiene una resolución definitiva.');const reviewer=r.reviewerId || r.analysis?.analystId;if(reviewer && reviewer!==user.id)fail(403,'Esta petición está a cargo de otro integrante del CCC.');}
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
  if(guest) {
    if(data.requesterType!=='usuario')fail(403,'Solo las solicitudes de usuario final pueden enviarse sin cuenta.');
    const name=text(data,'name',true,200),email=text(data,'email',true,200).toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Ingresa un correo válido.');
    user={id:null,name,email,role:'usuario'};
  }
  const kind=user.role==='ccc' ? option(data.requesterType,['usuario','experto'],'un tipo de petición') : user.role;
  if(user.role!=='ccc' && data.requesterType!==kind)fail(403,'El tipo de petición no corresponde a tu perfil.');
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const fields=requestFields(data,kind,date);
  const inserted=db.prepare('INSERT INTO requests(owner_id,document) VALUES(?,?)').run(user.id,'{}');
  const r={...fields,id:`SCR-${String(inserted.lastInsertRowid).padStart(4,'0')}`,date,name:user.name,email:user.email,ownerId:user.id,...(guest?{submittedWithoutAccount:true}:{}),requesterType:kind,priority:'Media',status:'Pendiente',revision:0,history:[],resolutions:[]};
  history(r,user,'Solicitud registrada.');save(db,r);return r;
}
function mutate(db,id,action,user,data) {
  const r=getRequest(db,id,user);checkRevision(r,data);
  if(action==='clarification') {
    if(r.ownerId!==user.id)fail(403,'Solo el solicitante puede aportar la información adicional.');
    if(r.status!=='Más información')fail(409,'No hay una solicitud de información pendiente.');
    const note=text(data,'note',true);
    (r.clarifications ||= []).push({note,responsible:user.name,date:new Date().toISOString()});
    r.reviewerId ||= r.analysis?.analystId;
    r.analysis=null;r.status='Pendiente';history(r,user,'Información adicional: '+note);
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
      r.analysis={...analysis,analyst:user.name,analystId:user.id,date:new Date().toISOString()};r.reviewerId=user.id;r.priority=analysis.priority;r.status='Pendiente';history(r,user,'Análisis registrado por el responsable del CCC.');
    } else {
      if(!r.analysis)fail(409,'Completa primero el análisis del CCC.');
      if(action==='resolution') {
        if(r.analysis.analystId!==user.id)fail(403,'La resolución debe registrarla el integrante que realizó el análisis.');
        const decision=option(data.decision,RESOLUTIONS,'una decisión');
        const decisionNote=text(data,'decisionNote',true),conditions=decision==='Aprobado con condiciones'?text(data,'conditions',true):'';
        const resolution={decision,decisionNote,conditions,responsible:user.name,responsibleId:user.id,date:new Date().toISOString(),analysisSnapshot:{...r.analysis},requestId:r.id,requestSummary:r.title};
        r.decision=resolution;r.resolutions.push(resolution);r.status=STATUS[decision];
        history(r,user,`${decision}: ${decisionNote}${conditions?' Condiciones: '+conditions:''}.`);
      } else fail(404,'Acción no encontrada.');
    }
  }
  return save(db,r);
}
module.exports={HttpError,fail,snapshot,committee,createRequest,mutate};

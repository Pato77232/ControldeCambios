/* ChangeFlow: prototipo sin dependencias. Los datos y el contador se guardan juntos. */
'use strict';
const STATES = ['Pendiente', 'Aprobada', 'Rechazada', 'Aprobada con condiciones', 'Más información'];
const RESOLUTIONS = ['Aprobado', 'Aprobado con condiciones', 'Rechazado', 'Más información'];
const RESOLUTION_STATES = { 'Aprobado': 'Aprobada', 'Aprobado con condiciones': 'Aprobada con condiciones', 'Rechazado': 'Rechazada', 'Más información': 'Más información' };
let CCC_USERS = [], currentUser = null, csrfToken = '', saving = false;
function canReview(r) { return ['Pendiente', 'Más información'].includes(r.status); }

const PRIORITIES = ['Baja', 'Media', 'Alta', 'Crítica'];
const TYPES = ['Corrección de error', 'Nueva funcionalidad', 'Mejora', 'Seguridad', 'Otro'];
// Catálogo funcional tomado de docs/business-rules.md y de los módulos del repositorio.
// Incluir un módulo planificado permite documentar propuestas, no afirma que esté implementado.
const PROJECT_NAME = 'ProyectoBusesUTA · Venta de pasajes interprovinciales';
const MODULES = ['Autenticación y usuarios', 'Cooperativas', 'Frecuencias y precios por tramo', 'Buses y plantillas de asientos', 'Hojas de ruta', 'Búsqueda de viajes', 'Reservas y pasajeros', 'Pagos y comprobantes', 'Boletos QR e historial', 'Notificaciones', 'Configuración de la aplicación'];
const ROLES = ['Administrador del Sistema', 'Usuario de Cooperativa', 'Oficinista', 'Cliente', 'Varios roles'];
const CHANGE_CLASSES = ['Normal', 'Estándar', 'Emergencia'];
const SCOPES = ['Toda la plataforma', 'Una cooperativa'];
const ENVIRONMENTS = ['Desarrollo', 'Pruebas', 'Producción'];
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const paths = {
  dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',

  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',

  plus: 'M12 5v14M5 12h14',
  book: 'M4 3h12l4 4v14H4z M8 8h6M8 12h8M8 16h6',

  check: 'm5 12 4 4L19 6',
  clock: 'M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',

  close: 'm6 6 12 12M6 18 18 6',
  arrow: 'M5 12h14m-5-5 5 5-5 5',

  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',

  edit: 'm16 3 5 5-12 12-6 1 1-6z M14 5l5 5',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',

  search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',

  info: 'M12 11v6M12 7h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',

  back: 'M19 12H5m5-5-5 5 5 5',
  save: 'M4 3h13l4 4v14H3V3z M7 3v6h10V3M7 21v-8h10v8'

};
function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<path d="${paths[name] || paths.book}"/>
</svg>`;

}
// Todo valor del usuario se escapa antes de incorporarlo al HTML, también en atributos.
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() +
    1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

}
function dateLabel(value, time = false) {
  if (!value)
    return 'No especificada';
  const d = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(d.getTime()) ? 'Fecha no disponible' : new Intl.DateTimeFormat('es-EC', { day: '2-digit', month: 'short', year: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(d);

}
function code(number) {
  return `SCR-${String(number).padStart(4, '0')}`;

}
let store = {nextId:1,requests:[]}, filter = {search:'',status:'',priority:''}, toastTimer;
const main = document.querySelector('main');
const isCommittee = () => currentUser?.role === 'ccc';
const canEdit = r => currentUser?.id === r.ownerId && !r.analysis && r.status === 'Pendiente';
const canEvaluate = r => isCommittee() && r.ownerId !== currentUser.id;
async function api(path, {method='GET', body} = {}) {
  const response = await fetch('/api'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json',...(csrfToken ? {'X-CSRF-Token':csrfToken} : {})},...(body === undefined ? {} : {body:JSON.stringify(body)})});
  const result = await response.json();
  if (!response.ok) {
    if(response.status === 401 && !['/auth/login','/auth/me'].includes(path)) {currentUser=null;csrfToken='';store={nextId:1,requests:[]};renderSession();location.hash='nueva/usuario';route();}
    const error = new Error(result.error || 'No se pudo completar la operación.');error.status=response.status;throw error;
  }
  return result;
}
async function loadStore() {
  const [data,committee] = await Promise.all([api('/requests'),api('/committee')]);
  store=data;CCC_USERS=committee.users;
  document.querySelector('#nav-count').textContent=store.requests.length;
}
async function saveAction(path,body,method='POST') {
  if(saving) return null;
  saving=true;
  try {const result=await api(path,{method,body});store=result.store;document.querySelector('#nav-count').textContent=store.requests.length;return result;}
  catch(error){
    if(error.status===409){try{await loadStore();route();}catch{}}
    toast(error.message,true);return null;
  } finally {saving=false;}
}
function renderSession() {
  document.querySelector('#session-controls').innerHTML=currentUser ? `<span class="session-avatar" aria-hidden="true">${esc(currentUser.name.split(' ').map(p=>p[0]).slice(0,2).join(''))}</span><span class="session-identity"><strong>${esc(currentUser.name)}</strong><small>${esc({usuario:'Usuario final',experto:'Desarrollador',ccc:'Miembro del CCC'}[currentUser.role])}</small></span><button class="btn" id="refresh-data">Actualizar</button><button class="btn" id="logout">Cerrar sesión</button>` : '<a class="btn" href="#login">Iniciar sesión</a>';
  document.querySelector('#nav-count').textContent=store.requests.length;
  document.querySelector('[data-nav="nueva"]').hidden=isCommittee();
  if(!currentUser)return;
  document.querySelector('#refresh-data').onclick=async()=>{try{await loadStore();route();toast('Datos actualizados.');}catch(e){toast(e.message,true);}};
  document.querySelector('#logout').onclick=async()=>{try{await api('/auth/logout',{method:'POST',body:{}});currentUser=null;csrfToken='';CCC_USERS=[];store={nextId:1,requests:[]};renderSession();location.hash='nueva/usuario';route();}catch(e){toast(e.message,true);}};
}
function loginScreen(message='') {
  main.innerHTML=heading('Iniciar sesión','Accede con tu cuenta para registrar o revisar solicitudes de cambio.')+`<form id="login-form" class="card login-card"><div class="detail-body"><h2>Acceso a BusesUTA</h2><label for="login-email">Correo electrónico</label><input id="login-email" name="email" type="email" autocomplete="username" required maxlength="200"><label for="login-password">Contraseña</label><input id="login-password" name="password" type="password" autocomplete="current-password" required maxlength="512"><p class="error" id="login-error" role="alert">${esc(message)}</p><button class="btn primary" type="submit">Entrar</button><p><a class="text-link" href="#nueva/usuario">Presentar una solicitud sin cuenta</a></p></div></form>`;
  document.querySelector('#login-form').onsubmit=async event=>{
    event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;
    try{const data=await api('/auth/login',{method:'POST',body:Object.fromEntries(new FormData(event.currentTarget))});currentUser=data.user;csrfToken=data.csrf;await loadStore();renderSession();route();}
    catch(e){document.querySelector('#login-error').textContent=e.message;}
    finally{button.disabled=false;}
  };
}
async function bootstrap() {
  try{const data=await api('/auth/me');currentUser=data.user;csrfToken=data.csrf;await loadStore();renderSession();route();}
  catch(e){renderSession();if(e.status===401)route();else loginScreen('No se pudo conectar con el servidor. Inicia el proyecto con npm start.');}
}
function toast(message, failure = false) {
  const el = document.querySelector('#toast');
  el.textContent = message;
  el.classList.toggle('failure', failure);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.hidden = true, 6500);

}
function badge(status) {
  return `<span class="badge status-${status.toLowerCase().replaceAll(' ', '-')}">${esc(status)}</span>`;

}
function priority(value) {
  return `<span class="priority priority-${value.toLowerCase()}">${esc(value)}</span>`;

}
function heading(title, subtitle, action = '') {
  return `<div class="page-heading">
<div>
<p class="eyebrow">CONTROL DE CAMBIOS</p>
<h1>${title}</h1>
<p class="subtitle">${subtitle}</p>
</div>${action}</div>`;

}
const FORM_GUIDES = {
 usuario: ['Información', [['book','Describa el problema o mejora','Sea claro y específico en el título y la descripción de su solicitud.'],['attach','Adjunte capturas si es necesario','Las evidencias ayudan a comprender mejor su solicitud.'],['users','El CCC analizará su solicitud','Su solicitud será revisada por el Comité de Control de Cambios (CCC).']], 'Mientras más información proporcione, mejor podremos atender su solicitud.'],
 experto: ['Guía técnica', [['cube','Ítems de configuración (ICS)','Incluya los componentes del sistema afectados: servicios, bases de datos, archivos o librerías.'],['layers','Versión / línea base','Especifique la versión actual del sistema para facilitar el análisis de impacto.'],['attach','Trazabilidad','Relacione este cambio con requerimientos o incidencias existentes.'],['book','Evidencia técnica','Adjunte referencias de logs, capturas o documentación que ayuden a analizar el cambio.']], 'Mientras más información técnica proporcione, más rápida y precisa será la evaluación de su solicitud.'],
 analisis: ['Criterios de evaluación', [['settings','Impacto técnico','Evalúe los componentes, integraciones y servicios del sistema que podrían verse afectados.'],['book','Impacto funcional','Analice cómo el cambio afecta los procesos de negocio y la experiencia de los usuarios.'],['warning','Riesgo','Identifique los posibles riesgos y su nivel de criticidad.'],['clock','Costo y esfuerzo','Estime el esfuerzo y los recursos necesarios.'],['check','Viabilidad','Determine si el cambio es técnicamente viable y qué condiciones podrían aplicar.'],['users','Trazabilidad','Documente el análisis para facilitar las decisiones del CCC.']], 'Sea objetivo, documente su análisis con evidencias y considere tanto los beneficios como los riesgos del cambio.'],
 decision: ['Resultado esperado', [['book','Registrar la decisión del CCC','Formalice la aprobación, aprobación con condiciones, rechazo o solicitud de más información.'],['attach','Justificar la decisión','Documente las razones y condiciones del Comité de Control de Cambios.'],['users','Mantener trazabilidad','Esta resolución quedará vinculada con la solicitud y el análisis previo.']], 'Una decisión bien documentada facilita la implementación y el seguimiento posterior del cambio.']
};
Object.assign(paths, {
 user:'M20 21v-2a7 7 0 0 0-14 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
 mail:'M3 5h18v14H3z m0 0 9 8 9-8',
 layers:'m12 3 10 5-10 5L2 8z M2 12l10 5 10-5M2 16l10 5 10-5',
 attach:'m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l9-9 M6 15l9-9',
 cube:'m12 2 9 5v10l-9 5-9-5V7z M3 7l9 5 9-5M12 12v10',
 users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M17 4a4 4 0 0 1 0 7M22 21v-2a4 4 0 0 0-3-4',
 warning:'m12 3 10 18H2z M12 9v5m0 3v1',
 settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 4 4 1v8l-4 1-1 4H9l-1-4-4-1V8l4-1z',
 bulb:'M9 18h6m-6 3h6M8 14a7 7 0 1 1 8 0l-1 4H9z',
 send:'m22 2-7 20-4-9L2 9z M11 13 22 2'
});
function formShell(kind, title, description, content, request) {
 const stage=kind==='decision'?3:kind==='analisis'?2:1, number={usuario:1,experto:2,analisis:3,decision:4}[kind];
 const guide=FORM_GUIDES[kind];
 const summary=request && stage>1 ? `<section class="request-summary"><h2>${icon('book')} Resumen de la solicitud</h2><dl>${[['ID-CAMBIO',request.id],['Origen de la solicitud',request.requesterType==='usuario'?'Usuario final':'Experto desarrollador'],['Título',request.title],['Módulo afectado',request.module],['Solicitante',request.name],['Estado',request.status]].map(([k,v])=>`<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section>`:'';
 return `<div class="workflow"><ol>${['Solicitud','Análisis','Decisión'].map((label,i)=>`<li class="${i+1===stage?'current':i+1<stage?'complete':''}" ${i+1===stage?'aria-current="step"':''}><span>${i+1}</span>${label}</li>`).join('')}</ol><small>Formulario ${number} de 4</small></div><div class="mockup-layout"><article class="form-paper"><header class="form-intro"><span class="intro-icon">${icon(stage===2?'search':'book')}</span><div><h1>${title}</h1><p>${description}</p></div></header>${stage===3 ? `<div class="summary-pair">${summary}<section class="request-summary"><h2>${icon('layers')} Resumen del análisis</h2><dl>${[['Nivel de impacto',request.analysis.impact],['Esfuerzo estimado',request.analysis.effort],['Viabilidad técnica',request.analysis.feasibility],['Recomendación',request.analysis.considerations]].map(([k,v])=>`<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section></div>` : summary}${content}</article><aside class="guide-card"><h2>${icon('info')} ${guide[0]}</h2><div class="guide-body">${guide[1].map(([ico,t,p])=>`<div class="guide-item"><span>${icon(ico)}</span><div><h3>${t}</h3><p>${p}</p></div></div>`).join('')}<div class="guide-tip"><h3>${icon('bulb')} Consejo</h3><p>${guide[2]}</p></div></div></aside></div>`;
}
function radioCards(key, values, current, descriptions) {
 return `<fieldset class="field full choice-field"><legend>${fieldLabels[key] || esc(key)} <span class="required">*</span></legend><div class="choice-grid">${values.map((v,i)=>`<label class="choice-card"><input type="radio" name="${key}" id="${i===0?key:key+'-'+i}" value="${esc(v)}" ${current===v?'checked':''} required><span><strong>${esc(v)}</strong><small>${descriptions[i]||''}</small></span></label>`).join('')}</div><span class="error" id="${key}-error"></span></fieldset>`;
}
function newButton() {
  return isCommittee() ? '' : `<a class="btn primary" href="#nueva">${icon('plus')} Nueva solicitud</a>`;

}
function rows(requests) {
  return requests.map(r => `<tr>
<td>
<a class="code" href="#detalle/${r.id}">${esc(r.id)}</a>
</td>
<td>
<a class="request-title" href="#detalle/${r.id}" title="${esc(r.title)}">${esc(r.title)}</a>
<span class="request-type">${esc(r.requesterType === 'usuario' ? 'Usuario final' : r.requesterType === 'experto' ? 'Experto desarrollador' : r.type)}</span>
</td>
<td>
<span class="request-title" title="${esc(r.project)}">${esc(r.project)}</span>
<span class="request-type">${esc(r.module || 'Módulo por especificar')}</span>
</td>
<td>${esc(r.name)}</td>
<td>${dateLabel(r.date)}</td>
<td>${priority(r.priority)}</td>
<td>${badge(r.status)}</td>
<td>
<div class="row-actions">
<a class="icon-btn" href="#detalle/${r.id}" aria-label="Ver ${r.id}" title="Ver detalles">${icon('eye')}</a>
${canEdit(r) ? `<a class="icon-btn" href="#editar/${r.id}" aria-label="Editar ${r.id}" title="Editar">${icon('edit')}</a>
<button class="icon-btn" data-delete="${r.id}" aria-label="Eliminar ${r.id}" title="Eliminar">${icon('trash')}</button>` : ''}
</div>
</td>
</tr>`).join('');

}
function table(requests, emptyText = 'Todavía no hay solicitudes.') {
  return requests.length ? `<div class="table-wrap">
<table>
<thead>
<tr>
<th>CÓDIGO</th>
<th>SOLICITUD</th>
<th>PROYECTO / MÓDULO</th>
<th>SOLICITANTE</th>
<th>FECHA</th>
<th>PRIORIDAD</th>
<th>ESTADO</th>
<th>ACCIONES</th>
</tr>
</thead>
<tbody>${rows(requests)}</tbody>
</table>
</div>` : `<div class="empty">${icon('search')}<h3>${emptyText}</h3>
<p>Crea una solicitud o ajusta los filtros para continuar.</p>${newButton()}</div>`;

}
function dashboard() {
  const counts = [store.requests.length, store.requests.filter(r=>canReview(r)).length, store.requests.filter(r=>['Aprobada','Aprobada con condiciones'].includes(r.status)).length, store.requests.filter(r=>r.status === 'Rechazada').length];
  main.innerHTML = heading('Panel principal', 'Peticiones de cambio del sistema de venta de pasajes interprovinciales.', newButton()) +
    `<div class="stats">${['Total de solicitudes', 'Pendientes / Más información', 'Aprobadas (incluye condiciones)', 'Rechazadas'].map((label, i) => `<div class="stat">
<div class="stat-top">${label}<span class="stat-icon">${icon(['book', 'clock', 'check', 'close'][i])}</span>
</div>
<div class="stat-value">${String(counts[i]).padStart(2, '0')}</div>
<small>${['Registradas en el sistema', 'En espera de evaluación', 'Listas para su planificación', 'Evaluadas y no aprobadas'][i]}</small>
</div>`).join('')}</div>
<section class="card">
<div class="card-head">
<div>
<h2>Solicitudes recientes</h2>
<p>Las últimas peticiones de cambio registradas.</p>
</div>
<a class="text-link" href="#solicitudes">Ver todas ${icon('arrow')}</a>
</div>${table([...store.requests].reverse().slice(0, 5))}<div class="table-foot">
<span>Mostrando ${Math.min(store.requests.length, 5)} de ${store.requests.length} solicitudes</span>
<span>Datos del servidor · Usa Actualizar para consultar cambios</span>
</div>
</section>
<div class="bottom-grid">
<section class="card">
<div class="card-head">
<div>
<h2>Un proceso claro, de principio a fin</h2>
<p>Organiza cada cambio antes de llevarlo al desarrollo.</p>
</div>
</div>
<div class="info-body steps">${[['01', 'Registra', 'Describe el cambio, su motivo y el impacto esperado.'], ['02', 'Evalúa', 'El CCC analiza impacto, riesgos, viabilidad y recursos.'], ['03', 'Decide', 'Aprueba o rechaza con motivos después del análisis.']].map(s => `<div class="step">
<span class="step-num">${s[0]}</span>
<h3>${s[1]}</h3>
<p>${s[2]}</p>
</div>`).join('')}</div>
</section>
<section class="card notice">
<h2>${icon('info')} Tu espacio de demostración</h2>
<p>Documenta cambios de ProyectoBusesUTA. Las solicitudes, análisis, votos y resoluciones se conservan en el servidor.</p>
<small>Acceso según el perfil de la cuenta</small>
</section>
</div>`;

}
function options(values, current, placeholder = '') {
  return `${placeholder ? `<option value="">${placeholder}</option>` : ''}${values.map(v => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(v)}</option>`).join('')}`;

}
function listing() {
  main.innerHTML = heading('Solicitudes de cambio', 'Consulta, organiza y evalúa los cambios de ProyectoBusesUTA.', newButton()) +
    `<section class="card">
<div class="toolbar">
<div class="search">${icon('search')}<input id="search" type="search" aria-label="Buscar por código o título" placeholder="Buscar por código o título…" value="${esc(filter.search)}">
</div>
<select id="status-filter" aria-label="Filtrar por estado">${options(STATES, filter.status, 'Todos los estados')}</select>
<select id="priority-filter" aria-label="Filtrar por prioridad">${options(PRIORITIES, filter.priority, 'Todas las prioridades')}</select>
<button class="btn" id="clear-filters">Limpiar</button>
</div>
<div id="list-results" aria-live="polite">
</div>
</section>`;
  refreshResults();
  ['search', 'status-filter', 'priority-filter'].forEach(id => document.getElementById(id).addEventListener(id === 'search' ? 'input' : 'change', () => {
    filter = { search: document.querySelector('#search').value, status: document.querySelector('#status-filter').value, priority: document.querySelector('#priority-filter').value };
    refreshResults();

  }));
  document.querySelector('#clear-filters').onclick = () => {
    filter = { search: '', status: '', priority: '' };
    listing();

  };

}
function refreshResults() {
  const query = filter.search.trim().toLocaleLowerCase('es');
  const matches = [...store.requests].reverse().filter(r => (!query || `${r.id} ${r.title}`.toLocaleLowerCase('es').includes(query)) && (!filter.status || r.status === filter.status) && (!filter.priority || r.priority === filter.priority));
  document.querySelector('#list-results').innerHTML = table(matches, 'No se encontraron solicitudes.') +
    `<div class="table-foot">
<span>${matches.length} de ${store.requests.length} solicitudes</span>
<span>Selecciona el icono de ojo para ver los detalles</span>
</div>`;

}
const fieldLabels = {
  id: 'ID-CAMBIO',
  date: 'Fecha de solicitud',
  name: 'Nombre del solicitante',
  email: 'Correo electrónico',
  department: 'Departamento o área',
  project: 'Proyecto o sistema',
  title: 'Título de la solicitud',
  type: 'Tipo de solicitud',
  proposedPriority: 'Prioridad propuesta',
  description: 'Descripción del cambio',
  justification: 'Motivo de la solicitud',
  result: 'Resultado esperado',
  components: 'Componentes o módulos afectados',
  priority: 'Prioridad',
  urgency: 'Urgencia',
  impact: 'Impacto estimado',
  risks: 'Riesgos identificados',
  desiredDate: 'Fecha deseada de implementación',
  status: 'Estado',
  assignee: 'Responsable asignado',
  observations: 'Observaciones',
  module: 'Módulo principal afectado',
  changeClass: 'Clasificación de gestión',
  specId: 'ID de especificación local',
  businessRules: 'Reglas de negocio relacionadas',
  affectedRole: 'Rol afectado',
  scope: 'Alcance organizacional',
  cooperativeName: 'Nombre de la cooperativa',
  cooperativeId: 'ID de cooperativa (referencia)',
  environment: 'Entorno afectado',
  currentVersion: 'Versión actual',
  targetVersion: 'Versión propuesta',
  entityReference: 'Registros afectados (referencias)',
  currentBehavior: 'Comportamiento actual',
  acceptanceCriteria: 'Criterios de aceptación',
  technicalImpact: 'Impacto técnico previsto'
};
const requiredFields = ['member1','vote1','name','email','project','module','title','currentBehavior','description','justification','result','components','environment','acceptanceCriteria','analyst','impact','technicalImpact','risks','feasibility','effort','resources','considerations','priority','responsible','decision','decisionNote'];
Object.assign(fieldLabels,{analyst:'Miembro del CCC',feasibility:'Viabilidad',effort:'Esfuerzo y tiempo estimados',resources:'Recursos necesarios',considerations:'Consideraciones y recomendación',responsible:'Responsable de la decisión',decision:'Decisión',decisionNote:'Motivos de la decisión',requesterType:'Tipo de solicitante',analysisDate:'Fecha del análisis'});
function field(key, value = '', config = {}) {
  const required = requiredFields.includes(key);
  const attrs = `id="${key}" name="${key}" aria-describedby="${key}-error${config.hint ? ' ' +
    key +
    '-hint' : ''}" ${required ? 'required' : ''} ${config.readonly ? 'readonly' : ''}`;
  let control;
  if (config.options)
    control = `<select ${attrs}>${options(config.options, value, config.placeholder || '')}</select>`;
  else if (config.area)
    control = `<textarea ${attrs} maxlength="5000" ${['description', 'justification'].includes(key) ? 'minlength="20"' : ''} placeholder="${esc(config.placeholder || ({description:'Describa detalladamente el problema, la mejora o la nueva funcionalidad que solicita…',justification:'Explique por qué es necesario este cambio y qué beneficio espera obtener…',currentBehavior:'Describa cómo funciona actualmente y cuál es el problema…',result:'Describa el resultado que espera obtener con este cambio…',observations:'Incluya cualquier información adicional que considere relevante…',technicalImpact:'Describa el impacto técnico del cambio en los componentes del sistema…',risks:'Detalle los principales riesgos identificados…',considerations:'Explique su recomendación, considerando el análisis realizado…',decisionNote:'Explique las razones que sustentan la decisión del Comité…',conditions:'Detalle las condiciones específicas para la implementación del cambio…'})[key] || 'Escriba aquí…')}">${esc(value)}</textarea>`;
  else
    control = `<input ${attrs} type="${config.type || 'text'}" value="${esc(value)}" ${config.min ? `min="${esc(config.min)}"` : ''} ${!config.readonly && (!config.type || config.type === 'text' || config.type === 'email') ? 'maxlength="200"' : ''} placeholder="${esc(config.placeholder || ({title:'Ingrese un título breve y descriptivo',components:'Ej. servicios, bases de datos, archivos, servidores…'})[key] || '')}">`;
  return `<div class="field ${config.full ? 'full' : ''}">
<label for="${key}">${fieldLabels[key] || esc(key)} ${required ? '<span class="required" aria-label="obligatorio">*</span>' : ''}</label><div class="input-shell"><span class="input-icon">${icon(({name:'user',email:'mail',module:'layers',components:'cube',justification:'info',desiredDate:'clock',analyst:'user',registeredBy:'user'})[key] || 'book')}</span>${control}</div>${config.area ? `<small class="char-count" data-counter="${key}">${String(value || '').length}/5000</small>` : ''}${config.hint ? `<small class="hint" id="${key}-hint">${config.hint}</small>` : ''}<span class="error" id="${key}-error">
</span>
</div>`;

}
function section(letter, title, subtitle, content) {
  return `<section class="card form-section">
<div class="section-title">
<span class="section-letter">${letter}</span>
<div>
<h2>${title}</h2>
<p>${subtitle}</p>
</div>
</div>
<div class="fields">${content}</div>
</section>`;

}
function chooseRequest() {
  if(isCommittee()) {main.innerHTML=heading('Acción no disponible','El CCC solo revisa solicitudes.');return;}
  editForm(null,currentUser.role);
}
function editForm(request, kind = 'usuario') {
  if ((request && !canEdit(request)) || (!request && (isCommittee() || kind !== (currentUser?.role || 'usuario')))) {
    main.innerHTML = heading('Petición bloqueada', 'Una petición analizada o resuelta conserva su información original.') + `<a class="btn" href="#detalle/${request?.id || ''}">Volver al detalle</a>`;
    return;
  }
  const editing = !!request;
  const r = request || { id: currentUser ? code(store.nextId) : 'Se generará al enviar', date: today(), name:currentUser?.name || '', email:currentUser?.email || '', project: PROJECT_NAME, priority: 'Media', status: 'Pendiente', attachments: [] };
  kind = request ? (r.requesterType || 'experto') : kind;
  const expert = kind === 'experto';
  const common = ['name','email','project','module','title','currentBehavior','description','justification','result'];
  const technical = ['components','environment','currentVersion','targetVersion','specId','businessRules','acceptanceCriteria'];
  const keys = [...common, ...(expert ? [...technical,'proposedPriority'] : []), 'type','desiredDate','observations'];
  const areas = ['currentBehavior','description','justification','result','acceptanceCriteria','observations'];
  const render = k => field(k,r[k], { area: areas.includes(k), full: areas.includes(k) || ['module','title','project'].includes(k), readonly:!!currentUser && ['name','email'].includes(k), ...(k === 'email' ? {type:'email'} : {}), ...(k === 'desiredDate' ? {type:'date',min:r.date} : {}), ...(k === 'module' ? {options:MODULES,placeholder:'Selecciona un módulo'} : {}), ...(k === 'environment' ? {options:ENVIRONMENTS,placeholder:'Selecciona un entorno'} : {}) });
  main.innerHTML = heading(editing ? 'Editar petición' : `Petición del ${expert ? 'experto desarrollador' : 'usuario final'}`, `${r.id} · La petición se enviará al CCC para su análisis.`) +
    `<form id="request-form" class="form-layout" novalidate><p class="form-note">Los campos con * son obligatorios.</p>${section('1','Datos de la petición','Código y fecha automáticos.',field('id',r.id,{readonly:true,full:true,hint:'Identificador generado automáticamente'}) + common.slice(0,2).map(render).join('') + radioCards('type',expert ? ['Defecto','Mejora','Nueva funcionalidad','Refactorización','Seguridad'] : ['Error','Mejora','Nueva funcionalidad'],r.type || (expert ? 'Defecto' : 'Error'),expert ? ['Corrección de un error en el sistema','Optimización de funcionalidad','Implementación de nueva funcionalidad','Mejora en el código sin cambio funcional','Cambios para mitigar riesgos'] : ['Reporta un problema en el sistema','Solicitud de mejora en una funcionalidad','Propuesta de una nueva funcionalidad']) + common.slice(2).map(render).join(''))}${expert ? section('2','Propuesta técnica','Información aportada por el desarrollador; el CCC realizará su propia evaluación.',technical.map(render).join('') + radioCards('proposedPriority',PRIORITIES,r.proposedPriority || 'Media',['Impacto bajo','Impacto moderado','Impacto alto','Impacto muy alto'])) : ''}${section(expert ? '3' : '2','Información complementaria','Fecha deseada y evidencias opcionales.',render('desiredDate') + render('observations') + `<div class="field full"><label for="attachments">Adjuntar evidencia</label><label class="upload-zone" for="attachments">${icon('attach')}<span><strong>Haga clic para adjuntar archivos</strong><small>Seleccione las evidencias de su solicitud</small></span><input id="attachments" type="file" multiple></label><small class="hint">En este prototipo se registran únicamente los nombres de los archivos.</small><p id="file-names" class="hint">${r.attachments.map(esc).join(', ')}</p><button class="btn" id="clear-files" type="button">Quitar adjuntos</button></div>`)}<div class="form-actions"><a class="btn" href="#solicitudes">Cancelar</a><button class="btn primary">${icon('send')} Enviar solicitud</button></div></form>`;
  main.innerHTML = formShell(kind, `Solicitud de cambio – ${expert ? 'Experto desarrollador' : 'Usuario final'}`, expert ? 'Este formulario está dirigido al personal técnico que puede proporcionar información detallada sobre software y configuraciones del sistema.' : 'Solicita un cambio en el sistema BusesUTA o reporta un problema. Puedes enviar tu solicitud sin cuenta, indicando tu nombre y correo electrónico.', main.innerHTML.slice(main.innerHTML.indexOf('<form')), r);
  let attachments = [...r.attachments];
  const files = document.querySelector('#attachments');
  files.onchange = () => { attachments = Array.from(files.files,f => f.name); document.querySelector('#file-names').textContent = attachments.join(', '); };
  document.querySelector('#clear-files').onclick = () => { attachments = []; files.value = ''; document.querySelector('#file-names').textContent = ''; };
  document.querySelector('#request-form').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget, data = Object.fromEntries(new FormData(form)), errors = {};
    keys.forEach(k => data[k] = String(data[k] || '').trim());
    const required = [...common, ...(expert ? ['components','environment','acceptanceCriteria'] : [])];
    required.forEach(k => { if (!data[k]) errors[k] = 'Este campo es obligatorio.'; });
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.email = 'Ingresa un correo válido.';
    ['description','justification'].forEach(k => { if (data[k] && data[k].length < 20) errors[k] = 'Escribe al menos 20 caracteres.'; });
    if (!MODULES.includes(data.module)) errors.module = 'Selecciona un módulo válido.';
    if (expert && !ENVIRONMENTS.includes(data.environment)) errors.environment = 'Selecciona un entorno válido.';
    ['currentVersion','targetVersion'].forEach(k => { if (expert && data[k] && !SEMVER.test(data[k])) errors[k] = 'Usa MAJOR.MINOR.PATCH, por ejemplo 0.1.0.'; });
    if (expert && data.specId && !/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+$/.test(data.specId)) errors.specId = 'Usa un ID como AUTH-01.';
    if (expert && data.businessRules && !/^RN-\d{2}(?:\s*,\s*RN-\d{2})*$/.test(data.businessRules)) errors.businessRules = 'Usa referencias como RN-02, RN-20.';
    if (data.desiredDate && data.desiredDate < r.date) errors.desiredDate = 'La fecha no puede ser anterior a la petición.';
    if (!showErrors(form,errors)) return;
    if(!currentUser) {
      if(saving)return;
      saving=true;
      const button=form.querySelector('button.primary');button.disabled=true;
      try {
        const result=await api('/public/requests',{method:'POST',body:{...data,requesterType:'usuario',attachments}});
        main.innerHTML=heading('Solicitud enviada','El Comité de Control de Cambios recibió tu solicitud.')+`<section class="card info-body receipt"><h2>${icon('check')} Solicitud ${esc(result.receipt.id)}</h2><label for="receipt-code">Código de seguimiento</label><input id="receipt-code" value="${esc(result.receipt.trackingCode)}" readonly aria-describedby="receipt-help"><p id="receipt-help">Guarda este código para consultar después el estado sin iniciar sesión. Selecciónalo y cópialo.</p><p>Fecha: ${dateLabel(result.receipt.date)} · Estado: ${esc(result.receipt.status)}</p><p>La solicitud quedó registrada con los datos de contacto que proporcionaste.</p><button class="btn primary" id="another-request" type="button">Presentar otra solicitud</button></section>`;
        document.querySelector('#another-request').onclick=()=>editForm(null,'usuario');
        window.scrollTo(0,0);main.focus({preventScroll:true});
      } catch(error){toast(error.message,true);}finally{saving=false;button.disabled=false;}
      return;
    }
    const result = await saveAction(editing ? `/requests/${r.id}` : '/requests',{...data,requesterType:kind,attachments,revision:r.revision},editing ? 'PATCH' : 'POST');
    if(result){location.hash=`detalle/${result.request.id}`;route();toast('Petición guardada en el servidor.');}

  };
}
function committeeForm(r, decision = false) {
  if(decision){resolutionForm(r);return;}
  if(!canEvaluate(r)||!canReview(r)){main.innerHTML=heading('Etapa no disponible','Solo un miembro independiente del CCC puede analizar una solicitud pendiente.')+`<a class="btn" href="#detalle/${r.id}">Volver</a>`;return;}
  const keys=['impact','technicalImpact','risks','feasibility','effort','resources','considerations','priority'];
  const values={...(r.analysis || {}),analyst:currentUser.name};
  const selects={impact:['Bajo','Medio','Alto'],feasibility:['Viable','Viable con condiciones','No viable'],priority:PRIORITIES};
  main.innerHTML=heading('Análisis del CCC',`${r.id} · ${esc(r.title)}`,`<a class="btn" href="#detalle/${r.id}">Consultar petición</a>`)+`<form id="committee-form" class="form-layout" novalidate>${section('2','Impacto y consideraciones','Todos los campos son obligatorios. Guardar el análisis invalida los votos anteriores.',field('analyst',values.analyst,{readonly:true})+field('analysisDate',values.date ? dateLabel(values.date) : 'Automática al guardar',{readonly:true})+keys.map(k=>['feasibility','priority','impact'].includes(k) ? radioCards(k,selects[k],values[k],k==='feasibility'?['El cambio puede implementarse sin limitaciones significativas.','Requiere condiciones o ajustes adicionales.','No es viable con la infraestructura actual.']:[]) : field(k,values[k],{options:selects[k],placeholder:selects[k]?'Selecciona una opción':'',area:['technicalImpact','risks','resources','considerations'].includes(k),full:['resources','considerations'].includes(k)})).join(''))}<div class="form-actions"><a class="btn" href="#detalle/${r.id}">Cancelar</a><button class="btn primary">Guardar análisis</button></div></form>`;
  main.innerHTML = formShell('analisis','Análisis de impacto del cambio – CCC','Un miembro o analista asignado por el Comité de Control de Cambios evalúa la solicitud antes de la decisión final.',main.innerHTML.slice(main.innerHTML.indexOf('<form')),r);
  document.querySelector('#committee-form').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget,data=Object.fromEntries(new FormData(form)),errors={};
    keys.forEach(k=>{data[k]=String(data[k]||'').trim();if(!data[k])errors[k]='Este campo es obligatorio.';else if(selects[k]&&!selects[k].includes(data[k]))errors[k]='Selecciona una opción válida.';});
    if(!showErrors(form,errors))return;
    const result=await saveAction(`/requests/${r.id}/analysis`,{...data,revision:r.revision});
    if(result){location.hash=`detalle/${r.id}`;route();toast('Análisis guardado. Cada miembro puede registrar su voto.');}
  };
}
function resolutionDetails(d) {
  return `<h3>Resolución del CCC · ${esc(d.decision)}</h3><p>${esc(d.responsible)} · ${dateLabel(d.date,true)}</p><p>${esc(d.decisionNote)}</p>${d.conditions ? `<h4>Condiciones de aprobación</h4><p>${esc(d.conditions)}</p>` : ''}${d.votes ? `<h4>Participantes y votos</h4><ul>${d.votes.map(v=>`<li>${esc(v.name)}: ${esc(v.decision)}</li>`).join('')}</ul>` : ''}`;
}
function resolutionForm(r) {
  if(!canEvaluate(r)||!canReview(r)||!r.analysis){main.innerHTML=heading('Etapa no disponible','Se requiere un análisis previo y un miembro independiente del CCC.')+`<a class="btn" href="#detalle/${r.id}">Volver</a>`;return;}
  Object.assign(fieldLabels,{conditions:'Condiciones de aprobación',resolutionId:'ID del cambio',requestSummary:'Resumen de solicitud',analysisSummary:'Resultado del análisis',registeredBy:'Responsable de la resolución',decisionDate:'Fecha de decisión',ownVote:'Mi voto',decision:'Decisión final',decisionNote:'Motivo de la decisión'});
  const members=CCC_USERS.filter(u=>u.id!==r.ownerId),votes=r.committeeVotes || [];
  const optionsMembers=`<option value="">Selecciona un integrante</option>${members.map(u=>`<option value="${u.id}" ${u.id===currentUser.id?'selected':''}>${esc(u.name)}</option>`).join('')}`;
  const own= votes.find(v=>v.id===currentUser.id);
  main.innerHTML=heading('Resolución del CCC','Cada integrante registra su propio voto con su sesión.',`<a class="btn" href="#detalle/${r.id}">Consultar expediente</a>`)+
    `<section class="card info-body"><h2>Votos registrados</h2><p>${votes.length?votes.map(v=>`${esc(v.name)}: ${esc(v.decision)}`).join('<br>'):'Todavía no hay votos.'}</p><form id="vote-form"><label for="own-vote">Mi voto · ${esc(currentUser.name)}</label><select id="own-vote" required>${options(RESOLUTIONS,own?.decision,'Selecciona tu voto')}</select><button class="btn" type="submit">Guardar mi voto</button></form><p class="hint">Usa Actualizar para consultar el voto de otro integrante. Un cambio en el análisis requiere renovar todos los votos.</p></section>`+
    `<form id="resolution-form" class="form-layout" novalidate>${section('4','Resolución del Comité','El responsable y la fecha se obtienen del servidor.',
      `<div class="field"><label for="member1">Primer integrante *</label><select id="member1" name="member1" required>${optionsMembers}</select><span class="error" id="member1-error"></span></div><div class="field"><label for="member2">Segundo integrante (opcional)</label><select id="member2" name="member2">${optionsMembers.replaceAll(' selected','')}</select><span class="error" id="member2-error"></span></div><p class="hint full">Con dos integrantes se requiere unanimidad. Ante desacuerdo, solicita más información. El responsable debe participar y nadie puede resolver su propia solicitud.</p>`+
      `<fieldset class="field full resolution-options"><legend>Decisión final *</legend>${RESOLUTIONS.map((d,i)=>`<label><input type="radio" name="decision" id="${i===0?'decision':'decision-'+i}" value="${esc(d)}" required><span><span class="decision-symbol symbol-${i}">${icon(['check','clock','close','info'][i])}</span><strong>${d==='Más información'?'Solicitar más información':d}</strong><small>${['Se aprueba la implementación del cambio.','Se aprueba sujeto a condiciones específicas.','Se rechaza la solicitud de cambio.','Se requiere información adicional antes de decidir.'][i]}</small></span></label>`).join('')}<span class="error" id="decision-error"></span></fieldset>`+
      field('decisionNote','',{area:true,full:true})+`<div id="conditions-wrap" class="full" hidden>${field('conditions','',{area:true,full:true,hint:'Obligatorio al aprobar con condiciones.'})}</div>`+
      field('registeredBy',currentUser.name,{readonly:true})+field('decisionDate','Automática al guardar',{readonly:true}))}<div class="form-actions"><a class="btn" href="#detalle/${r.id}">Cancelar</a><button class="btn primary">Guardar resolución</button></div></form>`;
  main.innerHTML = formShell('decision','Resolución del Comité de Control de Cambios','El Comité de Control de Cambios (CCC) emite la aprobación formal, aprobación con condiciones, rechazo o solicitud de más información sobre la solicitud de cambio.',main.innerHTML.slice(main.innerHTML.indexOf('<section')),r);
  document.querySelector('#vote-form').onsubmit=async event=>{
    event.preventDefault();const decision=document.querySelector('#own-vote').value;
    const result=await saveAction(`/requests/${r.id}/vote`,{decision,revision:r.revision});
    if(result){resolutionForm(result.request);toast('Tu voto quedó registrado.');}
  };
  const form=document.querySelector('#resolution-form');
  form.addEventListener('change',()=>{const conditional=form.querySelector('input[name="decision"]:checked')?.value==='Aprobado con condiciones';form.querySelector('#conditions-wrap').hidden=!conditional;form.querySelector('#conditions').required=conditional;});
  form.onsubmit=async event=>{
    event.preventDefault();const data=Object.fromEntries(new FormData(form)),errors={};
    const participants=[data.member1,data.member2].filter(Boolean);
    if(!data.member1)errors.member1='Selecciona un integrante.';
    if(participants.length===2&&participants[0]===participants[1])errors.member2='Selecciona un integrante diferente.';
    if(!participants.includes(currentUser.id))errors.member1='El responsable debe participar.';
    if(!RESOLUTIONS.includes(data.decision))errors.decision='Selecciona la decisión final.';
    if(!String(data.decisionNote||'').trim())errors.decisionNote='Explica el motivo de la decisión.';
    if(data.decision==='Aprobado con condiciones'&&!String(data.conditions||'').trim())errors.conditions='Especifica las condiciones.';
    if(!showErrors(form,errors))return;
    const result=await saveAction(`/requests/${r.id}/resolution`,{members:participants,decision:data.decision,decisionNote:data.decisionNote,conditions:data.conditions||'',revision:r.revision});
    if(result){location.hash=`detalle/${r.id}`;route();toast('Resolución registrada por el CCC.');}
  };
}
function showErrors(form, errors) {
  form.querySelectorAll('.error').forEach(el => el.textContent = '');
  form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  Object.entries(errors).forEach(([key, message]) => {
    form.querySelector(`#${key}-error`).textContent = message;
    form.querySelector(`#${key}`).setAttribute('aria-invalid', 'true');

  });
  const first = Object.keys(errors)[0];
  if (first) {
    form.querySelector(`#${first}`).focus();
    return false;

  }
  return true;

}
function definition(key, value, wide = false) {
  return `<div class="${wide ? 'wide' : ''}">
<dt>${fieldLabels[key] || esc(key)}</dt>
<dd>${esc(value || 'No especificado')}</dd>
</div>`;

}
function detail(r) {
  main.innerHTML = heading('Detalle de solicitud', `${r.id} · Registrada el ${dateLabel(r.date)}`, `<div class="actions" style="margin:0">
<a class="btn" href="#solicitudes">${icon('back')} Volver</a>
${canEdit(r) ? `<a class="btn primary" href="#editar/${r.id}">${icon('edit')} Editar</a>` : ''}
</div>`) +
    `<div class="detail-layout">
<div>
<section class="card">
<div class="card-head">
<div>
<h2 class="detail-title">${esc(r.title)}</h2>
<p>${esc(r.project)} · ${r.requesterType === 'usuario' ? 'Usuario final' : 'Experto desarrollador / registro anterior'}</p>
</div>${badge(r.status)}</div>
<div class="detail-body">
<dl class="detail-grid">${['name', 'email', 'project', 'type', 'module', 'date'].map(k => definition(k, k === 'date' ? dateLabel(r[k]) : r[k])).join('')}</dl>
</div>
</section>
<section class="card">
<div class="card-head">
<h2>Descripción del cambio</h2>
</div>
<div class="detail-body">
<dl class="detail-grid">${['currentBehavior', 'description', 'justification', 'result', ...(r.requesterType === 'usuario' ? [] : ['acceptanceCriteria', 'components'])].map(k => definition(k, r[k], true)).join('')}</dl>
</div>
</section>
<section class="card">
<div class="card-head">
<h2>Información aportada en la petición</h2>
</div>
<div class="detail-body">
<dl class="detail-grid">${(r.requesterType === 'usuario' ? [] : ['environment', 'specId', 'businessRules', 'currentVersion', 'targetVersion', 'proposedPriority']).map(k => definition(k, r[k])).join('')}${definition('desiredDate', dateLabel(r.desiredDate))}${definition('observations', r.observations, true)}<div class="wide">
<dt>Adjuntos (solo nombres)</dt>
<dd>${r.attachments.length ? r.attachments.map(n => `<span class="file-chip">${esc(n)}</span>`).join(' ') : 'Sin adjuntos'}</dd>
<small class="hint">No se almacenan archivos reales.</small>
</div>
</dl>
</div>
</section>
</div>
<div>
<section class="card evaluation"><div class="detail-body"><h2>Flujo del CCC</h2><p>1. Petición registrada · ${r.requesterType === 'usuario' ? 'Usuario final' : 'Experto desarrollador (o registro anterior)'}</p><p>2. Análisis: ${r.analysis ? 'Completado' : 'Pendiente'}</p><p>3. Decisión: ${r.status === 'Pendiente' ? 'Pendiente' : esc(r.status)}</p>${canReview(r) && canEvaluate(r) ? `<a class="btn primary" href="#analisis/${r.id}">${r.analysis ? 'Revisar análisis' : 'Completar análisis'}</a>${r.analysis ? `<a class="btn" href="#decision/${r.id}">Registrar decisión</a>` : '<p class="hint">Completa el análisis para habilitar la decisión.</p>'}` : (canReview(r)?'<p>En espera de revisión del CCC.</p>':'<p>El proceso de esta petición ha finalizado.</p>')}${!r.requesterType ? '<p class="hint">Registro anterior: conserva sus datos e historial; puede no contener un análisis separado.</p>' : ''}${r.analysis ? `<h3>Análisis del CCC</h3><dl>${Object.keys(r.analysis).filter(k=>k!=='analystId').map(k=>definition(k==='date'?'analysisDate':k,k==='date'?dateLabel(r.analysis[k],true):r.analysis[k])).join('')}</dl>` : ''}${r.decision ? resolutionDetails(r.decision) : ''}${r.clarifications?.length ? `<h3>Información adicional</h3>${r.clarifications.map(c=>`<p>${esc(c.note)}</p><small>${esc(c.responsible)} · ${dateLabel(c.date,true)}</small>`).join('')}` : ''}${r.status==='Más información' && r.ownerId===currentUser.id ? '<form id="clarification-form"><label for="clarification-note">Información solicitada por el CCC</label><textarea id="clarification-note" required maxlength="5000"></textarea><button class="btn primary">Enviar información</button></form>' : ''}${r.resolutions?.length > 1 ? `<details><summary>Resoluciones anteriores (${r.resolutions.length-1})</summary>${r.resolutions.slice(0,-1).map(resolutionDetails).join('')}</details>` : ''}</div></section>
<section class="card">
<div class="card-head">
<div>
<h2>Historial de la solicitud</h2>
<p>Trazabilidad de registros y decisiones.</p>
</div>
</div>
<div class="detail-body">
<ol class="history">${[...r.history].reverse().map(h => `<li>
<strong>${esc(h.status)} · ${esc(h.responsible)}</strong>
<small>${dateLabel(h.date, true)}</small>
<p>${esc(h.note)}</p>
</li>`).join('')}</ol>
</div>
</section>
</div>
</div>`;
  const clarification=document.querySelector('#clarification-form');
  if(clarification)clarification.onsubmit=async event=>{event.preventDefault();const note=document.querySelector('#clarification-note').value.trim();if(!note)return;const result=await saveAction(`/requests/${r.id}/clarification`,{note,revision:r.revision});if(result){detail(result.request);toast('Información enviada. El CCC debe revisar nuevamente el análisis.');}};
}

function route() {
  if(!currentUser){
    const publicView=location.hash.slice(1);
    if(publicView==='login' || (publicView && !['panel','nueva','nueva/usuario'].includes(publicView)))loginScreen();
    else editForm(null,'usuario');
    window.scrollTo(0,0);main.focus({preventScroll:true});return;
  }
  const [view = 'panel', id] = location.hash.slice(1).split('/');
  const selected = store.requests.find(r => r.id === id);
  const nav = view === 'nueva' ? 'nueva' : ['solicitudes', 'detalle', 'editar', 'analisis', 'decision'].includes(view) ? 'solicitudes' : 'panel';
  document.querySelectorAll('[data-nav]').forEach(a => {
    const active = a.dataset.nav === nav;
    a.classList.toggle('active', active);
    if (active)
      a.setAttribute('aria-current', 'page');
    else
      a.removeAttribute('aria-current');

  });
  document.querySelector('#breadcrumb').textContent = ({
    panel: 'Panel principal',
    solicitudes: 'Solicitudes',
    nueva: 'Nueva solicitud',
    detalle: 'Detalle de solicitud',
    editar: 'Editar solicitud', analisis: 'Análisis del CCC', decision: 'Decisión del CCC'
  })[view] || 'Panel principal';
  document.querySelector('#nav-count').textContent = store.requests.length;
  if (view === 'solicitudes')
    listing();
  else if (view === 'nueva')
    isCommittee() ? chooseRequest() : ['usuario','experto'].includes(id) ? editForm(null,id) : chooseRequest();
  else if (['detalle', 'editar', 'analisis', 'decision'].includes(view)) {
    if (selected)
      view === 'detalle' ? detail(selected) : view === 'editar' ? editForm(selected) : committeeForm(selected,view === 'decision');
    else
      main.innerHTML = heading('Solicitud no encontrada', 'Puede que esta solicitud haya sido eliminada.') +
        '<a class="btn primary" href="#solicitudes">Volver al listado</a>';

  }
  else
    dashboard();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });

}
// El diálogo nativo permite confirmar o cancelar con teclado, sin borrar accidentalmente.
let deleteId = null;
document.addEventListener('click', event => {
  const button = event.target.closest('[data-delete]');
  if (!button)
    return;
  deleteId = button.dataset.delete;
  const r = store.requests.find(item => item.id === deleteId);
  document.querySelector('#delete-description').textContent = `Se eliminará ${r.id}: ${r.title}.`;
  document.querySelector('#delete-dialog').showModal();

});
document.querySelector('#delete-dialog').addEventListener('close', async event => {
  if (event.target.returnValue === 'delete' && deleteId) {
    const r=store.requests.find(r=>r.id===deleteId);
    if (r && await saveAction(`/requests/${deleteId}`,{revision:r.revision},'DELETE')) {
      route();
      toast('Solicitud eliminada correctamente.');

    }

  }
  deleteId = null;
  event.target.returnValue = '';

});
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
document.addEventListener('input', event => { if(event.target.tagName === 'TEXTAREA') { const counter = document.querySelector(`[data-counter="${event.target.id}"]`); if(counter) counter.textContent = `${event.target.value.length}/${event.target.maxLength}`; } });
window.addEventListener('hashchange', route);
bootstrap();

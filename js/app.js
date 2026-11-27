/* Transviajes · Control de cambios de BusesUTA. Cliente sin dependencias: refleja las reglas que valida el servidor. */
'use strict';
let CAT = null, currentUser = null, csrfToken = '', saving = false, TEAM = [], GH = null;
let viewSeq = 0; // Evita que una vista asíncrona antigua sobrescriba la pantalla actual.
const stale = seq => seq !== viewSeq;
let store = { requests: [] }, filter = { search: '', status: '', itilType: '', priority: '', module: '' }, toastTimer, current = null;
const main = document.querySelector('main');
const ROLE = { usuario: 'Usuario final', experto: 'Desarrollador', ccc: 'Miembro del CCC' };
const isCommittee = () => currentUser?.role === 'ccc';
const isDeveloper = () => currentUser?.role === 'experto';
const ask = message => (typeof window.confirm === 'function' ? window.confirm(message) : true);

// ---------- Iconos y utilidades ----------
const paths = {
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4 M12 15v3', dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', plus: 'M12 5v14M5 12h14', book: 'M4 3h12l4 4v14H4z M8 8h6M8 12h8M8 16h6',
  check: 'm5 12 4 4L19 6', clock: 'M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', close: 'm6 6 12 12M6 18 18 6', arrow: 'M5 12h14m-5-5 5 5-5 5',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0', edit: 'm16 3 5 5-12 12-6 1 1-6z M14 5l5 5',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7', search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  info: 'M12 11v6M12 7h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', back: 'M19 12H5m5-5-5 5 5 5', save: 'M4 3h13l4 4v14H3V3z M7 3v6h10V3M7 21v-8h10v8',
  user: 'M20 21v-2a7 7 0 0 0-14 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0', mail: 'M3 5h18v14H3z m0 0 9 8 9-8', layers: 'm12 3 10 5-10 5L2 8z M2 12l10 5 10-5M2 16l10 5 10-5',
  attach: 'm8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l9-9', cube: 'm12 2 9 5v10l-9 5-9-5V7z M3 7l9 5 9-5M12 12v10',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M17 4a4 4 0 0 1 0 7M22 21v-2a4 4 0 0 0-3-4',
  warning: 'm12 3 10 18H2z M12 9v5m0 3v1', settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 4 4 1v8l-4 1-1 4H9l-1-4-4-1V8l4-1z',
  git: 'M6 3v12 M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M18 9a9 9 0 0 1-9 9', chart: 'M3 3v18h18 M7 15v3M12 10v8M17 6v12',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z', flag: 'M5 21V4h11l-2 4 2 4H5', send: 'm22 2-7 20-4-9L2 9z M11 13 22 2'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.book}"/></svg>`;
// Todo valor del usuario se escapa antes de incorporarlo al HTML, también en atributos.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function dateLabel(value, time = false) {
  if (!value) return 'No especificada';
  const d = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(d.getTime()) ? 'Fecha no disponible' : new Intl.DateTimeFormat('es-EC', { day: '2-digit', month: 'short', year: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(d);
}
function toast(message, failure = false) {
  const el = document.querySelector('#toast');
  el.textContent = message; el.classList.toggle('failure', failure); el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 6500);
}
const STATUS_CLASS = { 'Verificada': 'status-aprobada', 'Fusionado': 'status-aprobada', 'Abierto': 'status-progreso', 'Borrador': 'status-pendiente', 'Cerrado sin fusionar': 'status-rechazada', 'Abierta': 'status-progreso', 'Pendiente de información': 'status-más-información', 'Correcciones requeridas': 'status-más-información', 'Aprobada': 'status-aprobada', 'Aprobada con condiciones': 'status-aprobada-con-condiciones', 'Rechazada': 'status-rechazada', 'Asignada': 'status-progreso', 'En implementación': 'status-progreso', 'En pruebas': 'status-progreso', 'En revisión': 'status-progreso', 'Cerrada': 'status-cerrada', 'Exitoso': 'status-aprobada', 'Fallido': 'status-rechazada', 'Incompleto': 'status-más-información', 'Superada': 'status-aprobada', 'Fallida': 'status-rechazada', 'Bloqueada': 'status-más-información', 'Vigente': 'status-aprobada', 'Bajo control de configuración': 'status-aprobada', 'Retirado': 'status-cerrada', 'Descartada': 'status-cerrada', 'Reemplazada': 'status-cerrada', 'Autorizada': 'status-aprobada', 'No autorizada': 'status-rechazada', 'Conforme': 'status-aprobada' };
const badge = status => `<span class="badge ${STATUS_CLASS[status] || 'status-pendiente'}">${esc(status)}</span>`;
const priority = value => value ? `<span class="priority priority-${esc(String(value).toLowerCase())}">${esc(value)}</span>` : '<span class="hint">Por definir</span>';
const heading = (title, subtitle, action = '') => `<div class="page-heading"><div><p class="eyebrow">CONTROL DE CAMBIOS · BUSESUTA</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${action}</div>`;
const options = (values, current, placeholder = '') => `${placeholder ? `<option value="">${esc(placeholder)}</option>` : ''}${values.map(v => { const [value, label] = Array.isArray(v) ? v : [v, v]; return `<option value="${esc(value)}" ${String(value) === String(current ?? '') ? 'selected' : ''}>${esc(label)}</option>`; }).join('')}`;
const text = v => v === null || v === undefined || v === '' ? '<span class="hint">No especificado</span>' : esc(v).replace(/\n/g, '<br>');
const listHtml = items => items?.length ? `<ol class="plain-list">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ol>` : '<span class="hint">Sin elementos</span>';
const dl = pairs => `<dl class="detail-grid">${pairs.filter(Boolean).map(([k, v, wide]) => `<div class="${wide ? 'wide' : ''}"><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
const card = (title, body, { subtitle = '', id = '', actions = '' } = {}) => `<section class="card" ${id ? `id="${id}"` : ''}><div class="card-head"><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${actions}</div><div class="detail-body">${body}</div></section>`;
const callout = (kind, html) => `<div class="callout callout-${kind}" role="${kind === 'danger' ? 'alert' : 'note'}">${icon(kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'warning')}<div>${html}</div></div>`;
const table = (headers, rows, empty = 'Sin registros.') => rows.length ? `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<p class="hint">${esc(empty)}</p>`;
function setNavCount() { const el = document.querySelector('#nav-count'); if (el) el.textContent = currentUser ? store.requests.length : ''; }

// ---------- Markdown ----------
// Markdown básico y seguro: primero se escapa todo; luego títulos, listas, negrita, cursiva, código y enlaces http(s).
function md(source) {
  const lines = esc(source || '').split(/\r?\n/); let html = '', list = null;
  const inline = t => t.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:]|$)/g, '$1<em>$2</em>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a class="text-link" href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const line of lines) {
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) { close(); const n = Math.min(6, m[1].length + 3); html += `<h${n}>${inline(m[2])}</h${n}>`; }
    else if ((m = /^\s*[-*+]\s+(?:\[( |x)\]\s+)?(.*)$/.exec(line))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${m[1] ? (m[1] === 'x' ? '☑ ' : '☐ ') : ''}${inline(m[2])}</li>`; }
    else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
    else if (!line.trim()) close();
    else { close(); html += `<p>${inline(line)}</p>`; }
  }
  close();
  return html ? `<div class="markdown">${html}</div>` : '<span class="hint">No especificado</span>';
}
const ROLLOUT_TEMPLATE = '## Objetivo\n\n\n## Actividades (en orden)\n1. \n2. \n\n## Dependencias\n\n\n## Responsables\n\n\n## Verificaciones y criterio de finalización\n- ';
const BACKOUT_TEMPLATE = '## Condiciones de activación\n- \n\n## Acciones de reversión\n1. \n2. \n\n## Versión o configuración a recuperar\n\n\n## Precauciones con los datos\n\n\n## Responsable y verificación posterior\n- ';
// Las fichas anteriores guardaban el plan en campos separados: se presentan como Markdown.
function planText(e, kind) {
  if (!e) return '';
  if (e[`${kind}Plan`]) return e[`${kind}Plan`];
  const parts = kind === 'rollout'
    ? [['Objetivo', e.rolloutObjective], ['Actividades (en orden)', (e.rolloutSteps || []).map((x, i) => `${i + 1}. ${x}`).join('\n')], ['Dependencias', e.rolloutDependencies], ['Responsables', e.rolloutResponsibles], ['Verificaciones iniciales', e.rolloutChecks], ['Implementación completada cuando', e.rolloutCompletion]]
    : [['Condiciones de activación', e.backoutTriggers], ['Acciones de reversión', (e.backoutActions || []).map((x, i) => `${i + 1}. ${x}`).join('\n')], ['Versión o configuración a recuperar', e.backoutVersion], ['Precauciones con los datos', e.backoutData], ['Responsable', e.backoutResponsible], ['Verificación posterior', e.backoutVerification], ['Estrategia alternativa', e.backoutAlternative]];
  return parts.filter(([, v]) => v).map(([t, v]) => `## ${t}\n${v}`).join('\n\n');
}
const mdField = (name, label, value, hint, prefix) => `<div class="field full md-field"><div class="md-head"><label for="${prefix}-${name}">${esc(label)} <span class="required" aria-label="obligatorio">*</span></label><div class="md-tabs"><button type="button" class="chip active" data-md-edit="${prefix}-${name}">Escribir</button><button type="button" class="chip" data-md-preview="${prefix}-${name}">Vista previa</button></div></div><textarea id="${prefix}-${name}" name="${name}" rows="12" maxlength="20000" class="md-input" aria-describedby="${prefix}-${name}-error ${prefix}-${name}-hint">${esc(value)}</textarea><div class="md-preview" id="${prefix}-${name}-preview" hidden></div><small class="hint" id="${prefix}-${name}-hint">${hint}</small><span class="error" id="${prefix}-${name}-error"></span></div>`;
function bindMarkdown() {
  document.querySelectorAll('[data-md-preview]').forEach(b => b.onclick = () => {
    const id = b.dataset.mdPreview, input = document.getElementById(id), preview = document.getElementById(`${id}-preview`);
    preview.innerHTML = md(input.value); preview.hidden = false; input.hidden = true;
    b.classList.add('active'); document.querySelector(`[data-md-edit="${id}"]`)?.classList.remove('active');
  });
  document.querySelectorAll('[data-md-edit]').forEach(b => b.onclick = () => {
    const id = b.dataset.mdEdit; document.getElementById(id).hidden = false; document.getElementById(`${id}-preview`).hidden = true;
    b.classList.add('active'); document.querySelector(`[data-md-preview="${id}"]`)?.classList.remove('active');
  });
}
// Mismo formato de rama que el servidor: identificador-titulo-descripcionCorta.
const slug = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const branchPrefix = r => `${CAT.BRANCH_PREFIX[r.evaluation?.itilType] || 'feature'}/${r.id}-`;

// ---------- API ----------
async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch('/api' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !['/auth/login', '/auth/me'].includes(path)) { currentUser = null; csrfToken = ''; store = { requests: [] }; renderSession(); location.hash = 'login'; route(); }
    const error = new Error(result.error || 'No se pudo completar la operación.'); error.status = response.status; error.field = result.field; throw error;
  }
  return result;
}
async function loadStore() {
  const calls = [api('/requests'), api('/users')];
  if (currentUser.role !== 'usuario') calls.push(api('/github/status').catch(() => null));
  const [data, users, github] = await Promise.all(calls);
  store = data; TEAM = users.users; GH = github || null;
  setNavCount();
}
// Guarda en el servidor; muestra el error dentro del formulario y conserva los datos escritos.
async function saveAction(path, body, method = 'POST', form = null) {
  if (saving) return null;
  saving = true;
  const button = form?.querySelector('button[type="submit"]:not([disabled])') || null;
  const label = button?.innerHTML;
  if (button) { button.disabled = true; button.textContent = 'Guardando…'; }
  const alert = form?.querySelector('.form-alert');
  if (alert) alert.textContent = '';
  try {
    const result = await api(path, { method, body });
    if (result.store) { store = result.store; setNavCount(); }
    return result;
  } catch (error) {
    if (alert) alert.textContent = error.message;
    // El servidor indica el campo con error: se marca en rojo y se lleva la vista hasta él.
    if (form && error.field) {
      const el = form.querySelector(`[name="${error.field}"]`) || form.querySelector(`[data-group="${error.field}"]`)?.closest('.ics-picker');
      if (el) { markField(form, el, error.message); el.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); el.focus?.({ preventScroll: true }); }
    } else alert?.focus?.();
    toast(error.message, true);
    if (error.status === 409 && /cambió/.test(error.message)) { try { await loadStore(); } catch { /* se reintenta con Actualizar */ } }
    return null;
  } finally { saving = false; if (button) { button.disabled = false; button.innerHTML = label; } }
}
function toBase64(buffer) { let s = ''; const bytes = new Uint8Array(buffer); for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(s); }
async function readFiles(input) {
  const list = [...(input?.files || [])];
  if (list.length > CAT.ATTACHMENT_MAX_FILES) throw new Error(`Adjunta como máximo ${CAT.ATTACHMENT_MAX_FILES} archivos.`);
  for (const f of list) {
    const ext = f.name.includes('.') ? f.name.split('.').pop().toLowerCase() : '';
    if (!CAT.EXTENSIONS.includes(ext)) throw new Error(`Tipo de archivo no permitido: ${f.name}.`);
    if (f.size > CAT.ATTACHMENT_MAX_BYTES) throw new Error(`${f.name} supera ${CAT.ATTACHMENT_MAX_BYTES / 1048576} MB.`);
  }
  return Promise.all(list.map(async f => ({ name: f.name, data: toBase64(await f.arrayBuffer()) })));
}

// ---------- Formularios ----------
// fld: control con etiqueta, ayuda y mensaje de error asociado (id = prefijo-nombre).
function fld(name, label, { value = '', type = 'text', required = false, options: opts, area = false, hint = '', full = false, readonly = false, placeholder = '', min, max, step, prefix = 'f', rows = 3, maxlength, attrs: extra = '' } = {}) {
  const id = `${prefix}-${name}`;
  const attrs = `id="${id}" name="${name}" aria-describedby="${id}-error${hint ? ` ${id}-hint` : ''}" ${required ? 'required' : ''} ${readonly ? 'readonly' : ''} ${placeholder ? `placeholder="${esc(placeholder)}"` : ''} ${extra}`;
  let control;
  if (opts) control = `<select ${attrs}>${options(opts, value, 'Selecciona una opción')}</select>`;
  else if (area) control = `<textarea ${attrs} rows="${rows}" maxlength="${maxlength || 5000}">${esc(Array.isArray(value) ? value.join('\n') : value)}</textarea>`;
  else control = `<input ${attrs} type="${type}" value="${esc(value ?? '')}" ${min !== undefined ? `min="${esc(min)}"` : ''} ${max !== undefined ? `max="${esc(max)}"` : ''} ${step ? `step="${step}"` : ''} ${maxlength ? `maxlength="${maxlength}"` : type === 'text' || type === 'email' ? 'maxlength="200"' : ''}>`;
  return `<div class="field ${full || area ? 'full' : ''}"><label for="${id}">${esc(label)} ${required ? '<span class="required" aria-label="obligatorio">*</span>' : ''}</label>${control}${hint ? `<small class="hint" id="${id}-hint">${hint}</small>` : ''}<span class="error" id="${id}-error"></span></div>`;
}
function check(name, label, checked = false, { prefix = 'f', hint = '' } = {}) {
  return `<div class="field full"><label class="check"><input type="checkbox" id="${prefix}-${name}" name="${name}" ${checked ? 'checked' : ''}> ${esc(label)}</label>${hint ? `<small class="hint">${hint}</small>` : ''}<span class="error" id="${prefix}-${name}-error"></span></div>`;
}
function radios(name, label, values, current, { prefix = 'f', descriptions = {}, required = true } = {}) {
  return `<fieldset class="field full choice-field"><legend>${esc(label)} ${required ? '<span class="required">*</span>' : ''}</legend><div class="choice-grid">${values.map((v, i) => `<label class="choice-card"><input type="radio" name="${name}" id="${i === 0 ? `${prefix}-${name}` : `${prefix}-${name}-${i}`}" value="${esc(v)}" data-err="${prefix}-${name}" ${current === v ? 'checked' : ''} ${required ? 'required' : ''}><span><strong>${esc(v)}</strong>${descriptions[v] ? `<small>${esc(descriptions[v])}</small>` : ''}</span></label>`).join('')}</div><span class="error" id="${prefix}-${name}-error"></span></fieldset>`;
}
const fileField = (name, label, prefix = 'f', hint = '') => `<div class="field full"><label for="${prefix}-${name}">${esc(label)}</label><input type="file" id="${prefix}-${name}" name="${name}" multiple accept="${CAT.EXTENSIONS.map(e => '.' + e).join(',')}"><small class="hint">${hint || `Hasta ${CAT.ATTACHMENT_MAX_FILES} archivos de ${CAT.ATTACHMENT_MAX_BYTES / 1048576} MB (${CAT.EXTENSIONS.join(', ')}). Se almacenan en el servidor con acceso restringido.`}</small><span class="error" id="${prefix}-${name}-error"></span></div>`;
const section = (letter, title, subtitle, content) => `<section class="card form-section"><div class="section-title"><span class="section-letter">${letter}</span><div><h2>${title}</h2><p>${subtitle}</p></div></div><div class="fields">${content}</div></section>`;
const formAlert = () => '<p class="error form-alert request-error" role="alert" tabindex="-1"></p>';
function collect(form) {
  const d = {};
  for (const el of form.elements) {
    // Las tarjetas de selección no tienen `name`: se agrupan por data-group antes del filtro por nombre.
    if (el.dataset?.group && !el.disabled) { (d[el.dataset.group] ||= []); if (el.type !== 'checkbox' || el.checked) d[el.dataset.group].push(el.value); continue; }
    if (!el.name || el.disabled || el.type === 'file' || el.type === 'submit' || el.type === 'button') continue;
    if (el.type === 'checkbox') d[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) d[el.name] = el.value; else if (!(el.name in d)) d[el.name] = ''; }
    else d[el.name] = el.value.trim();
  }
  return d;
}
// Versiones semánticas: mismo criterio que el servidor.
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const semverCmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
function versionError(value, { allow = [], gt } = {}) {
  if (!value || allow.includes(value)) return '';
  if (!SEMVER_RE.test(value) || value.split('.').some(n => n.length > 6)) return `Usa el formato MAJOR.MINOR.PATCH, por ejemplo 1.4.0${allow.length ? ` (o «${allow.join('» / «')}»)` : ''}.`;
  if (gt && SEMVER_RE.test(gt) && semverCmp(value, gt) <= 0) return `Debe ser mayor que la versión actual ${gt}.`;
  return '';
}
const versionAttr = rule => `data-version='${esc(JSON.stringify(rule))}'`;
// Error de un control según sus reglas (obligatorio, correo, longitud mínima, versión).
function fieldError(el) {
  if (!el || el.disabled || el.type === 'radio' || el.type === 'checkbox' || el.type === 'file') return '';
  const value = String(el.value || '').trim();
  if (el.required && !value) return 'Este campo es obligatorio.';
  if (el.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return 'Ingresa un correo válido.';
  if (el.minLength > 0 && value && value.length < el.minLength) return `Escribe al menos ${el.minLength} caracteres.`;
  if (el.dataset?.version) { let rule = {}; try { rule = JSON.parse(el.dataset.version); } catch { /* sin regla */ } if (rule.gtFrom) rule.gt = el.form?.querySelector(`[name="${rule.gtFrom}"]`)?.value.trim(); return versionError(value, rule); }
  return '';
}
const errorKey = el => el.dataset?.err || el.id;
// Dibuja el campo en rojo y muestra el mensaje junto a él.
function markField(form, el, message) {
  const key = errorKey(el), holder = key ? form.querySelector(`#${key}-error`) : null;
  if (holder) holder.textContent = message;
  el.setAttribute('aria-invalid', 'true');
  el.closest('.field, .choice-field')?.classList.add('invalid');
}
function clearField(form, el) {
  const key = errorKey(el), holder = key ? form.querySelector(`#${key}-error`) : null;
  if (holder) holder.textContent = '';
  el.removeAttribute('aria-invalid');
  el.closest('.field, .choice-field')?.classList.remove('invalid');
}
// Validación en el cliente antes de enviar; el servidor vuelve a validar todo.
function validate(form, extra = {}) {
  const errors = { ...extra };
  for (const el of form.elements) {
    if (!el.name || el.disabled || !el.id) continue;
    const key = errorKey(el);
    if (errors[key]) continue;
    if (el.type === 'radio') { if (el.required && !form.querySelector(`input[name="${el.name}"]:checked`)) errors[key] = 'Selecciona una opción.'; continue; }
    const message = fieldError(el);
    if (message) errors[key] = message;
  }
  form.querySelectorAll('.error:not(.form-alert)').forEach(el => el.textContent = '');
  form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  form.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));
  for (const [id, message] of Object.entries(errors)) {
    const control = form.querySelector(`#${id}`);
    if (control) markField(form, control, message);
    else { const holder = form.querySelector(`#${id}-error`); if (holder) holder.textContent = message; }
  }
  const first = Object.keys(errors)[0];
  if (first) { const el = form.querySelector(`#${first}`); el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); el?.focus?.({ preventScroll: true }); const alert = form.querySelector('.form-alert'); if (alert) alert.textContent = 'Revisa los campos marcados en rojo.'; return false; }
  return true;
}
// Selector visual de tarjetas con búsqueda y contador de seleccionados (módulos afectados).
const MODULE_ICONS = { 'Autenticación y usuarios': 'lock', 'Cooperativas': 'users', 'Frecuencias y precios por tramo': 'clock', 'Buses y plantillas de asientos': 'cube', 'Hojas de ruta': 'list', 'Búsqueda de viajes': 'search', 'Reservas y pasajeros': 'user', 'Pagos y comprobantes': 'book', 'Boletos QR e historial': 'layers', 'Notificaciones': 'send', 'Configuración de la aplicación': 'settings', 'No estoy seguro': 'info' };
const moduleItems = (exclude = []) => CAT.MODULES.filter(m => !exclude.includes(m)).map(m => ({ value: m, title: m, icon: MODULE_ICONS[m] || 'cube', meta: m === 'No estoy seguro' ? 'El CCC determinará los módulos' : 'Módulo de BusesUTA' }));
function cardPicker({ group, id = '', items = [], checked = () => false, operation = null, note = () => '', empty = 'No hay opciones disponibles.' }) {
  if (!items.length) return `<div class="ics-empty" ${id ? `id="${id}"` : ''}>${icon('cube')}<p>${esc(empty)}</p></div>`;
  return `<div class="ics-picker" ${id ? `id="${id}" tabindex="-1"` : ''} data-picker><div class="ics-picker-bar"><div class="search">${icon('search')}<input type="search" data-picker-search placeholder="Filtrar módulos…" aria-label="Filtrar módulos"></div><span class="ics-count" data-picker-count aria-live="polite"></span></div><div class="ics-grid">${items.map((i, n) => {
    const on = checked(i), extra = note(i);
    return `<div class="ics-card${on ? ' selected' : ''}" data-search="${esc(`${i.title} ${i.meta || ''}`.toLowerCase())}"><label class="ics-card-main"><input type="checkbox" class="ics-check" data-group="${group}" value="${esc(i.value)}" ${on ? 'checked' : ''}><span class="ics-tick" aria-hidden="true">${icon('check')}</span><span class="ics-card-body"><span class="ics-card-top"><span class="module-icon">${icon(i.icon || 'cube')}</span></span><strong class="ics-name">${esc(i.title)}</strong>${i.meta ? `<small class="ics-meta">${esc(i.meta)}</small>` : ''}${extra ? `<small class="ics-note">${esc(extra)}</small>` : ''}</span></label>${operation ? `<label class="ics-op"><span>Operación</span><select name="op-${n}" data-op-for="${esc(i.value)}" aria-label="Operación prevista para ${esc(i.title)}">${options(CAT.OPERATIONS, operation(i) || 'Modificación')}</select></label>` : ''}</div>`;
  }).join('')}</div></div>`;
}
function bindPickers() {
  document.querySelectorAll('[data-picker]').forEach(p => {
    const cards = [...p.querySelectorAll('.ics-card')], count = p.querySelector('[data-picker-count]');
    const update = () => {
      let n = 0;
      cards.forEach(c => { const on = c.querySelector('.ics-check').checked; n += on; c.classList.toggle('selected', on); });
      if (count) count.textContent = n ? `${n} seleccionado${n === 1 ? '' : 's'}` : 'Ninguno seleccionado';
      if (n && p.getAttribute('aria-invalid') === 'true') { const form = p.closest('form'); if (form) clearField(form, p); }
    };
    p.addEventListener('change', update); update();
    const search = p.querySelector('[data-picker-search]');
    search?.addEventListener('input', () => { const q = search.value.trim().toLowerCase(); cards.forEach(c => c.hidden = !!q && !c.dataset.search.includes(q)); });
  });
}
function bindForm(selector, handler) {
  const form = document.querySelector(selector);
  if (!form) return;
  form.onsubmit = async event => { event.preventDefault(); await handler(event.currentTarget, event.submitter); };
}

// ---------- Sesión ----------
function renderNav() {
  const items = currentUser ? [['panel', 'Panel'], ['solicitudes', `Solicitudes <span id="nav-count">${store.requests.length}</span>`], ...(isCommittee() ? [] : [['nueva', 'Nueva solicitud']]), ...(currentUser.role !== 'usuario' ? [['reportes', 'Reportes'], ['auditoria', 'Auditoría']] : [])]
    : [['login', 'Iniciar sesión'], ['nueva', 'Nueva solicitud'], ['seguimiento', 'Seguimiento']];
  document.querySelector('.app-nav').innerHTML = items.map(([key, label]) => `<a data-nav="${key}" href="#${key}">${label}</a>`).join('') + '<span id="breadcrumb" class="visually-hidden">Panel</span>';
}
function renderSession() {
  document.querySelector('#session-controls').innerHTML = currentUser ? `<span class="session-avatar" aria-hidden="true">${esc(currentUser.name.split(' ').map(p => p[0]).slice(0, 2).join(''))}</span><span class="session-identity"><strong>${esc(currentUser.name)}</strong><small>${esc(ROLE[currentUser.role])}</small></span><button class="btn" id="refresh-data">Actualizar</button><button class="btn" id="logout">Cerrar sesión</button>` : '<a class="btn" href="#login">Iniciar sesión</a>';
  renderNav();
  if (!currentUser) return;
  document.querySelector('#refresh-data').onclick = async () => { try { await loadStore(); route(); toast('Datos actualizados. Los campos sin guardar se descartaron.'); } catch (e) { toast(e.message, true); } };
  document.querySelector('#logout').onclick = async () => { try { await api('/auth/logout', { method: 'POST', body: {} }); currentUser = null; csrfToken = ''; store = { requests: [] }; renderSession(); location.hash = 'login'; route(); } catch (e) { toast(e.message, true); } };
}
function loginScreen(message = '') {
  main.innerHTML = `<div class="login-layout"><aside class="login-story"><a class="login-wordmark" href="#login"><span class="login-mark" aria-hidden="true">${icon('arrow')}</span><span>Trans<strong>viajes</strong></span></a><p class="login-kicker">SISTEMA DE CONTROL DE CAMBIOS</p><h1>Un mejor sistema.<br>Un cambio a la vez.</h1><p class="login-description">Solicitud, análisis, autorización, implementación, pruebas, revisión y cierre de los cambios de BusesUTA.</p><div class="login-features">${[['layers', 'Integración con GitHub', 'Cada solicitud tiene su issue y sus referencias verificadas.'], ['check', 'Trazabilidad', 'Cada decisión queda auditada.'], ['user', 'Trabajo en equipo', 'Usuarios, desarrolladores y CCC.']].map(([i, t, d]) => `<div><span>${icon(i)}</span><p><strong>${t}</strong><small>${d}</small></p></div>`).join('')}</div><small class="login-story-footer">Transviajes · Control de Cambios</small></aside><section class="login-access"><form id="login-form" class="login-form" novalidate><p class="login-eyebrow">BIENVENIDO A TRANSVIAJES</p><h2>Iniciar sesión</h2><p class="login-subtitle">Accede al sistema de control de cambios.</p><label for="login-email">Correo electrónico</label><div class="login-input"><span aria-hidden="true">${icon('user')}</span><input id="login-email" name="email" type="email" autocomplete="username" placeholder="Ingresa tu correo electrónico" required maxlength="200"></div><label for="login-password">Contraseña</label><div class="login-input"><span aria-hidden="true">${icon('lock')}</span><input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="Ingresa tu contraseña" required maxlength="512"><button id="toggle-password" type="button" aria-label="Mostrar contraseña" aria-pressed="false">${icon('eye')}</button></div><p class="error" id="login-error" role="alert">${esc(message)}</p><button class="btn primary login-submit" type="submit">Iniciar sesión ${icon('arrow')}</button><div class="login-divider"><span>o</span></div><div class="login-guest"><span class="login-guest-icon" aria-hidden="true">${icon('book')}</span><div><h3>¿No tienes una cuenta?</h3><p>Como usuario final puedes presentar una solicitud y consultar su estado con tu clave de seguimiento.</p></div><a class="btn login-guest-link" href="#nueva">Registrar solicitud sin cuenta ${icon('arrow')}</a><a class="btn login-guest-link" href="#seguimiento">Consultar una solicitud ${icon('search')}</a></div><p class="login-note">El acceso del equipo técnico y del CCC requiere una cuenta autorizada.</p></form></section></div>`;
  document.querySelector('#toggle-password').onclick = () => {
    const input = document.querySelector('#login-password'), button = document.querySelector('#toggle-password'), show = input.type === 'password';
    input.type = show ? 'text' : 'password'; button.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña'); button.setAttribute('aria-pressed', String(show));
  };
  document.querySelector('#login-form').onsubmit = async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true;
    try { const data = await api('/auth/login', { method: 'POST', body: collect(event.currentTarget) }); currentUser = data.user; csrfToken = data.csrf; await loadStore(); renderSession(); location.hash = 'panel'; route(); }
    catch (e) { document.querySelector('#login-error').textContent = e.message; }
    finally { button.disabled = false; }
  };
}
async function bootstrap() {
  try { CAT = await api('/catalog'); } catch { loginScreen('No se pudo conectar con el servidor. Inicia el proyecto con npm start.'); return; }
  try { const data = await api('/auth/me'); currentUser = data.user; csrfToken = data.csrf; await loadStore(); }
  catch (e) { if (e.status !== 401) { loginScreen('No se pudo conectar con el servidor. Inicia el proyecto con npm start.'); return; } }
  renderSession(); route();
}
let refreshing = false;
async function refreshPanel() {
  const view = location.hash.slice(1).split('/')[0];
  if (!currentUser || !['', 'panel', 'solicitudes'].includes(view) || document.visibilityState === 'hidden' || refreshing || saving) return;
  refreshing = true;
  try { const data = await api('/requests'); const changed = JSON.stringify(store) !== JSON.stringify(data); store = data; setNavCount(); if (changed && ['', 'panel', 'solicitudes'].includes(location.hash.slice(1).split('/')[0])) route(); }
  catch (error) { if (error.status !== 401) toast('No se pudo actualizar el panel. Usa Actualizar para reintentar.', true); }
  finally { refreshing = false; }
}

// ---------- Línea de progreso ----------
function progress(r) {
  const stages = CAT.STAGES, idx = stages.findIndex(([, states]) => states.includes(r.status));
  const rejected = r.status === 'Rechazada' || (r.status === 'Cerrada' && !r.closure?.result);
  return `<div class="progress-line" aria-label="Avance de la solicitud"><ol>${stages.map(([label], i) => {
    let cls = i < idx ? 'complete' : i === idx ? 'current' : '';
    if (rejected && label === 'Aprobación') cls = 'rejected';
    if (rejected && i > 3 && i < stages.length - 1) cls = 'skipped';
    const sub = i === idx ? r.status : label === 'Cierre' && r.closure ? (r.closure.result || r.closure.administrative) : rejected && label === 'Aprobación' ? 'Rechazada' : '';
    return `<li class="${cls}" ${i === idx ? 'aria-current="step"' : ''}><span>${i + 1}</span>${label}${sub ? `<small>${esc(sub)}</small>` : ''}</li>`;
  }).join('')}</ol></div>`;
}

// ---------- Paneles ----------
function statTiles(items) {
  return `<div class="stats">${items.map(([label, value, note, ico]) => `<div class="stat"><div class="stat-top">${esc(label)}<span class="stat-icon">${icon(ico || 'book')}</span></div><div class="stat-value">${value === null || value === undefined ? '—' : esc(value)}</div><small>${esc(note || '')}</small></div>`).join('')}</div>`;
}
function requestRows(requests) {
  return table(['Código', 'Solicitud', 'Módulo', 'Solicitante', 'Fecha', 'Tipo ITIL', 'Prioridad', 'Estado', ''], requests.map(r => [
    `<a class="code" href="#detalle/${esc(r.id)}">${esc(r.id)}</a>${r.legacyCode ? `<small class="hint">antes ${esc(r.legacyCode)}</small>` : ''}`,
    `<a class="request-title" href="#detalle/${esc(r.id)}">${esc(r.title)}</a><span class="request-type">${r.requesterType === 'usuario' ? 'Usuario final' : 'Desarrollador'}</span>`,
    esc((r.modules || [r.module]).join(', ')), esc(r.name), dateLabel(r.date), esc(r.evaluation?.itilType || '—'), priority(r.priority), badge(r.status),
    `<a class="icon-btn" href="#detalle/${esc(r.id)}" aria-label="Ver ${esc(r.id)}" title="Ver detalle">${icon('eye')}</a>`
  ]), 'No hay solicitudes que coincidan.');
}
function tasksFor(user) {
  const mine = r => r.assignments?.at(-1)?.developerId === user.id && !r.assignments.at(-1).releasedAt;
  const t = [];
  for (const r of store.requests) {
    if (user.role === 'ccc') {
      if (r.status === 'Registrada') t.push([r, 'Recibir el CRF']);
      else if (r.status === 'En validación') t.push([r, 'Validar la información']);
      else if (['En análisis', 'En planificación'].includes(r.status)) t.push([r, 'Completar la ficha del CCC']);
      else if (r.status === 'Pendiente de aprobación') t.push([r, 'Decidir la autorización']);
      else if (['Aprobada', 'Aprobada con condiciones'].includes(r.status)) t.push([r, r.decisions?.at(-1)?.needsReevaluation ? 'Reevaluar aprobación anterior' : 'Asignar desarrollador']);
      else if (r.status === 'Rechazada') t.push([r, 'Cerrar administrativamente']);
      if (r.deviations?.some(d => d.status === 'Pendiente')) t.push([r, 'Decidir desviación de alcance']);
    } else {
      if (mine(r) && ['Asignada', 'Correcciones requeridas'].includes(r.status)) t.push([r, 'Iniciar implementación', `trabajo/${r.id}`]);
      else if (mine(r) && r.status === 'En implementación') t.push([r, r.pullRequest ? 'Enviar a pruebas' : r.workBranch ? 'Continuar desarrollo y crear PR' : 'Registrar rama de trabajo', `trabajo/${r.id}`]);
      else if (r.status === 'En pruebas') t.push([r, mine(r) ? 'Pruebas (preferible otro desarrollador)' : 'Ejecutar pruebas']);
      else if (r.status === 'En revisión') t.push([r, r.reviews?.at(-1)?.round === r.implementation?.rounds?.length && mine(r) ? 'Cerrar la solicitud' : 'Revisión postimplementación']);
      if (r.ownerId === user.id && r.status === 'Pendiente de información') t.push([r, 'Responder solicitud de información']);
    }
  }
  return t;
}
async function dashboard() {
  const seq = viewSeq, params = new URLSearchParams(location.hash.split('?')[1] || '');
  main.innerHTML = heading('Panel principal', 'Cargando indicadores…');
  let rep = null;
  if (currentUser.role !== 'usuario') { try { rep = await api(`/reports?${params}`); } catch (e) { toast(e.message, true); } }
  if (stale(seq)) return;
  const c = rep?.counts, f = rep?.filters || {}, tasks = tasksFor(currentUser), filtered = Object.keys(f).length;
  const filters = rep ? `<section class="card"><form id="panel-filter" class="toolbar wrap" novalidate>${fld('from', 'Desde', { type: 'date', value: f.from, prefix: 'pf' })}${fld('to', 'Hasta', { type: 'date', value: f.to, prefix: 'pf' })}${fld('user', 'Usuario', { options: TEAM.map(u => [u.id, `${u.name} (${ROLE[u.role]})`]), value: f.user, prefix: 'pf', hint: 'Solicitó, fue asignado o registró un hito.' })}${fld('status', 'Estado', { options: CAT.STATES, value: f.status, prefix: 'pf' })}${fld('module', 'Módulo', { options: CAT.MODULES, value: f.module, prefix: 'pf' })}${fld('itilType', 'Tipo ITIL', { options: [...Object.keys(CAT.ITIL), 'Sin clasificar'], value: f.itilType, prefix: 'pf' })}${fld('priority', 'Prioridad', { options: [...CAT.LEVELS, 'Sin definir'], value: f.priority, prefix: 'pf' })}<div class="form-actions full"><button class="btn primary" type="submit">${icon('search')} Filtrar</button>${filtered ? '<a class="btn" href="#panel">Quitar filtros</a>' : ''}</div></form></section>` : '';
  main.innerHTML = heading('Panel principal', `${esc(ROLE[currentUser.role])} · ${filtered ? `${rep.total} solicitudes con los filtros aplicados` : 'Control de cambios de BusesUTA'}.`, isCommittee() ? '' : `<a class="btn primary" href="#nueva">${icon('plus')} Nueva solicitud</a>`) + filters +
    (c ? statTiles([['Solicitudes abiertas', c.open, `${c.total} en total`, 'book'], ['Pendientes de análisis', c.pendingAnalysis, `${c.pendingInfo} esperan información`, 'search'], ['Pendientes de aprobación', c.pendingApproval, `${c.approved} aprobadas sin asignar`, 'shield'], ['En implementación / pruebas', `${c.implementing} / ${c.testing}`, `${c.reviewing} en revisión`, 'git'], ['Cerradas', c.closed, `${c.success} exitosas · ${c.failed} fallidas · ${c.incomplete} incompletas`, 'check'], ['Rechazadas', c.rejected, 'Viabilidad y decisión son distintas', 'close']]) : '') +
    (filtered ? '' : card('Mis tareas', tasks.length ? table(['Código', 'Solicitud', 'Estado', 'Acción pendiente'], tasks.map(([r, what, href]) => [`<a class="code" href="#detalle/${esc(r.id)}">${esc(r.id)}</a>`, esc(r.title), badge(r.status), `<a class="text-link" href="#${esc(href || `detalle/${r.id}`)}">${esc(what)} ${icon('arrow')}</a>`])) : '<p class="hint">No tienes acciones pendientes.</p>', { subtitle: 'Calculadas según tu rol y el estado de cada solicitud.' })) +
    (rep ? `<div class="chart-grid">${bars('Por estado', rep.groups.status)}${bars('Por prioridad', rep.groups.priority)}${bars('Por módulo', rep.groups.module)}${bars('Por tipo ITIL', rep.groups.itilType)}</div>` +
      card(filtered ? 'Solicitudes filtradas' : 'Solicitudes', table(['Código', 'Título', 'Módulos', 'Estado', 'Prioridad', 'Solicitante', 'Desarrollador', 'Fecha'], [...rep.rows].reverse().slice(0, filtered ? 200 : 8).map(x => [`<a class="code" href="#detalle/${esc(x.id)}">${esc(x.id)}</a>`, esc(x.title), esc(x.modules.join(', ')), badge(x.status), priority(x.priority === 'Sin definir' ? null : x.priority), esc(x.requester), esc(x.developer), dateLabel(x.date)]), 'No hay solicitudes con estos filtros.'), { actions: `<a class="text-link" href="#solicitudes">Ver listado completo ${icon('arrow')}</a>` })
      : card('Solicitudes recientes', requestRows([...store.requests].reverse().slice(0, 6))));
  bindForm('#panel-filter', form => { location.hash = `panel?${new URLSearchParams(Object.entries(collect(form)).filter(([, v]) => v))}`; });
}

// ---------- Listado ----------
function listing() {
  main.innerHTML = heading('Solicitudes de cambio', 'Consulta las solicitudes que tu perfil puede ver.', isCommittee() ? '' : `<a class="btn primary" href="#nueva">${icon('plus')} Nueva solicitud</a>`) +
    `<section class="card"><div class="toolbar"><div class="search">${icon('search')}<input id="search" type="search" aria-label="Buscar por código o título" placeholder="Buscar por código o título…" value="${esc(filter.search)}"></div>
    <select id="status-filter" aria-label="Estado">${options(CAT.STATES, filter.status, 'Todos los estados')}</select>
    <select id="itil-filter" aria-label="Tipo ITIL">${options(Object.keys(CAT.ITIL), filter.itilType, 'Todos los tipos ITIL')}</select>
    <select id="priority-filter" aria-label="Prioridad">${options(CAT.LEVELS, filter.priority, 'Todas las prioridades')}</select>
    <select id="module-filter" aria-label="Módulo">${options(CAT.MODULES, filter.module, 'Todos los módulos')}</select>
    <button class="btn" id="clear-filters">Limpiar</button></div><div id="list-results" aria-live="polite"></div></section>`;
  const refresh = () => {
    const q = filter.search.trim().toLocaleLowerCase('es');
    const matches = [...store.requests].reverse().filter(r => (!q || `${r.id} ${r.legacyCode || ''} ${r.title}`.toLocaleLowerCase('es').includes(q)) && (!filter.status || r.status === filter.status) && (!filter.itilType || r.evaluation?.itilType === filter.itilType) && (!filter.priority || r.priority === filter.priority) && (!filter.module || (r.modules || [r.module]).includes(filter.module)));
    document.querySelector('#list-results').innerHTML = requestRows(matches) + `<div class="table-foot"><span>${matches.length} de ${store.requests.length} solicitudes</span></div>`;
  };
  refresh();
  const ids = { search: 'search', status: 'status-filter', itilType: 'itil-filter', priority: 'priority-filter', module: 'module-filter' };
  for (const [key, id] of Object.entries(ids)) document.getElementById(id).addEventListener(key === 'search' ? 'input' : 'change', e => { filter[key] = e.target.value; refresh(); });
  document.querySelector('#clear-filters').onclick = () => { filter = { search: '', status: '', itilType: '', priority: '', module: '' }; listing(); };
}

// ---------- CRF: formulario compartido de usuario final y desarrollador ----------
const GUIDES = {
  usuario: ['Antes de enviar', [['book', 'Describe la situación', 'Cuenta qué ocurre hoy o indica que la funcionalidad todavía no existe.'], ['attach', 'Adjunta evidencias', 'Capturas o documentos ayudan a comprender la solicitud.'], ['users', 'El CCC la evaluará', 'El comité clasifica, analiza y decide. Tú podrás consultar el estado.']]],
  experto: ['Guía técnica', [['cube', 'Módulos afectados', 'Marca todos los módulos de BusesUTA que el cambio toca; el CCC los confirma en su análisis.'], ['layers', 'Versiones', 'Indica la versión conocida o «No determinada». No se asume una versión 1.0.'], ['check', 'Criterios de aceptación', 'Uno por línea, verificables. Se reutilizan en las pruebas y la revisión.'], ['shield', 'Proponer no es aprobar', 'El CCC conserva tu propuesta original y registra sus conclusiones por separado.']]]
};
function requestForm(request, kind) {
  if (!request && currentUser && isCommittee()) { main.innerHTML = heading('Nueva solicitud', 'El CCC recibe y evalúa las solicitudes; no puede presentarlas porque nadie más podría evaluarlas de forma independiente.') + '<a class="btn" href="#solicitudes">Ver solicitudes</a>'; return; }
  kind = request ? request.requesterType : (currentUser?.role || 'usuario');
  const expert = kind === 'experto', editing = !!request;
  const r = request || { name: currentUser?.name || '', email: currentUser?.email || '', acceptanceCriteria: [], currentVersion: 'No determinada' };
  const chosen = new Set(r.modules || (r.module ? [r.module] : []));
  const modulePick = `<div class="field full"><span class="field-label">Módulos afectados <span class="required">*</span></span><small class="hint">Selecciona uno o varios módulos de BusesUTA. Si no lo sabes, elige «No estoy seguro».</small>${cardPicker({ group: 'modules', id: 'f-modules', items: moduleItems(), checked: i => chosen.has(i.value) })}<span class="error" id="f-modules-error"></span></div>`;
  const correcting = editing && isCommittee();
  const backTo = `${new URLSearchParams(location.hash.split('?')[1] || '').get('desde') === 'ficha' ? 'ficha' : 'detalle'}/${r.id}`;
  const auto = `El código CRF, la fecha y el proyecto (${esc(CAT.PROJECT)}) se asignan automáticamente al enviar.`;
  // Los datos automáticos no se muestran como campos: solo se informa quién registra la solicitud.
  const identity = currentUser || editing ? `<div class="identity-note full">${icon('user')}<div><strong>${esc(r.name)}</strong><span>${esc(r.email)}${editing ? ` · ${r.requesterType === 'usuario' ? 'Usuario final' : 'Desarrollador'}` : ''}</span><small>${editing ? 'La identidad del solicitante no se modifica.' : `Se registrará con tu cuenta. ${auto}`}</small></div></div>`
    : fld('name', 'Nombre del solicitante', { value: r.name, required: true }) + fld('email', 'Correo electrónico', { value: r.email, type: 'email', required: true, hint: 'Se usa como medio de contacto; no se verifica su titularidad.' }) + `<p class="hint full">${auto}</p>`;
  const guide = GUIDES[expert ? 'experto' : 'usuario'];
  main.innerHTML = `<div class="mockup-layout"><article class="form-paper"><header class="form-intro"><span class="intro-icon">${icon('book')}</span><div><h1>${correcting ? `Corregir ${esc(r.id)}` : editing ? `Editar ${esc(r.id)}` : `Solicitud de cambio (CRF) · ${expert ? 'Desarrollador' : 'Usuario final'}`}</h1><p>${expert ? 'Solicitud técnica: además de los datos comunes, documenta tu propuesta técnica.' : 'Describe el cambio que necesitas en BusesUTA. No necesitas conocer términos técnicos.'}</p></div></header>
  <form id="request-form" class="form-layout" novalidate>${formAlert()}<p class="form-note">Los campos con * son obligatorios.</p>
  ${correcting ? section('!', 'Corrección del CCC', 'Los datos originales del solicitante se conservan y cada campo corregido queda en la auditoría.', fld('correctionReason', 'Motivo de la corrección', { area: true, required: true, rows: 2, attrs: 'minlength="10"' })) : ''}
  ${section('1', editing ? 'Solicitante' : 'Identificación', editing ? 'Datos registrados al crear la solicitud.' : '¿Quién solicita y qué parte del sistema se ve afectada?', identity + check('featureMissing', 'La funcionalidad solicitada todavía no existe', r.featureMissing, { hint: 'Márcalo si pides algo nuevo y no la corrección de algo que ya funciona. Así el CCC lo distingue de la corrección de un error.' }) + modulePick)}
  ${section('2', 'Cambio solicitado', 'Qué se desea y por qué.', fld('title', 'Título', { value: r.title, required: true, full: true, maxlength: 120, placeholder: 'Breve y descriptivo' }) + fld('description', 'Descripción del cambio', { value: r.description, required: true, area: true, hint: 'Adición, modificación o eliminación que deseas. Mínimo 20 caracteres.', attrs: 'minlength="20"' }) + fld('justification', 'Justificación', { value: r.justification, required: true, area: true, hint: 'Por qué se necesita. Mínimo 20 caracteres.', attrs: 'minlength="20"' }) + fld('result', 'Resultado esperado', { value: r.result, required: true, area: true }))}
  ${expert ? section('3', 'Propuesta técnica', 'Información adicional del desarrollador. No sustituye la clasificación ITIL del CCC.', radios('proposedItilType', 'Tipo de cambio ITIL propuesto', Object.keys(CAT.ITIL), r.proposedItilType, { descriptions: CAT.ITIL }) + radios('modificationType', 'Tipo de modificación solicitada', CAT.OPERATIONS, r.modificationType, { descriptions: { 'Adición': 'Agrega un componente o funcionalidad.', 'Modificación': 'Cambia algo existente.', 'Eliminación': 'Retira un componente o funcionalidad.' } }) + fld('components', 'Componentes técnicos afectados', { value: r.components, area: true, rows: 2, hint: 'Opcional: servicios, archivos, tablas o pantallas que prevés modificar.' }) + fld('environment', 'Entorno afectado', { value: r.environment, options: CAT.ENVIRONMENTS, required: true }) + fld('currentVersion', 'Versión actual', { value: r.currentVersion === 'No determinada' ? '' : r.currentVersion, hint: 'Opcional. MAJOR.MINOR.PATCH, p. ej. 1.2.0; si la dejas vacía se registra «No determinada».', attrs: versionAttr({ allow: ['No determinada'] }) }) + fld('targetVersion', 'Versión propuesta', { value: r.targetVersion, hint: 'Opcional. Debe ser mayor que la versión actual; el CCC puede revisarla.', attrs: versionAttr({ gtFrom: 'currentVersion' }) }) + fld('proposedPriority', 'Prioridad propuesta', { value: r.proposedPriority || 'Media', options: CAT.LEVELS }) + fld('spec', 'Especificación técnica (Spec)', { value: r.spec, area: true, rows: 2 }) + fld('specUrl', 'Enlace a la especificación', { value: r.specUrl, type: 'url', placeholder: 'https://…' }) + check('businessRulesAffected', 'Hay reglas de negocio afectadas', r.businessRulesAffected) + fld('businessRules', 'Reglas de negocio afectadas', { value: r.businessRules === 'No aplica' ? '' : r.businessRules, area: true, rows: 2, hint: 'Obligatorio si marcaste la casilla anterior; si no, se registra «No aplica».' }) + fld('acceptanceCriteria', 'Criterios de aceptación', { value: r.acceptanceCriteria, area: true, required: true, hint: 'Uno por línea, claros y verificables.' })) : ''}
  ${section(expert ? '4' : '3', 'Información complementaria', 'Opcional.', fld('desiredDate', 'Fecha deseada', { value: r.desiredDate, type: 'date', min: correcting ? r.date : today(), hint: 'Preferencia del solicitante; no es una fecha autorizada.' }) + fld('observations', 'Observaciones', { value: r.observations, area: true, rows: 2 }) + (editing ? '<p class="hint full">Para agregar archivos usa la sección de evidencias del expediente.</p>' : fileField('files', 'Archivos adjuntos')))}
  <div class="form-actions">${editing ? `<a class="btn" href="#${esc(backTo)}">Cancelar</a>` : ''}<button class="btn primary" type="submit">${icon('send')} ${correcting ? 'Guardar corrección' : editing ? 'Guardar cambios' : 'Enviar solicitud'}</button></div></form></article>
  <aside class="guide-card"><h2>${icon('info')} ${guide[0]}</h2><div class="guide-body">${guide[1].map(([ico, t, p]) => `<div class="guide-item"><span>${icon(ico)}</span><div><h3>${t}</h3><p>${p}</p></div></div>`).join('')}</div></aside></div>`;
  bindForm('#request-form', async form => {
    const data = collect(form), errors = {};
    if (data.description && data.description.length < 20) errors['f-description'] = 'Escribe al menos 20 caracteres.';
    if (data.justification && data.justification.length < 20) errors['f-justification'] = 'Escribe al menos 20 caracteres.';
    if (data.desiredDate && data.desiredDate < (correcting ? r.date : today())) errors['f-desiredDate'] = 'No puede ser anterior a la fecha de la solicitud.';
    const mods = data.modules || [];
    if (!mods.length) errors['f-modules'] = 'Selecciona al menos un módulo.';
    else if (mods.includes('No estoy seguro') && mods.length > 1) errors['f-modules'] = 'No combines «No estoy seguro» con otros módulos.';
    data.modules = mods;
    if (expert && data.businessRulesAffected && !data.businessRules) errors['f-businessRules'] = 'Describe las reglas de negocio afectadas.';
    if (!validate(form, errors)) return;
    try { data.files = editing ? undefined : await readFiles(form.querySelector('#f-files')); } catch (e) { validate(form, { 'f-files': e.message }); return; }
    data.requesterType = kind;
    if (!currentUser) {
      const result = await saveAction('/public/requests', data, 'POST', form);
      if (result) receipt(result.receipt);
      return;
    }
    const result = await saveAction(editing ? `/requests/${r.id}` : '/requests', { ...data, revision: r.revision }, editing ? 'PATCH' : 'POST', form);
    if (result) { toast(correcting ? 'Corrección registrada; los datos originales se conservan.' : editing ? 'Solicitud actualizada.' : `Solicitud ${result.request.id} registrada.`); location.hash = editing ? backTo : `detalle/${result.request.id}`; }
  });
  bindPickers();
  if (correcting) markOriginals(r);
}
// Junto a cada campo ya corregido por el CCC muestra el valor que escribió el solicitante.
const ORIGINAL_FIELDS = { modules: 'f-modules', title: 'f-title', currentBehavior: 'f-currentBehavior', description: 'f-description', justification: 'f-justification', result: 'f-result', desiredDate: 'f-desiredDate', observations: 'f-observations', modificationType: 'f-modificationType', environment: 'f-environment', currentVersion: 'f-currentVersion', targetVersion: 'f-targetVersion', spec: 'f-spec', specUrl: 'f-specUrl', businessRules: 'f-businessRules', acceptanceCriteria: 'f-acceptanceCriteria', components: 'f-components', proposedPriority: 'f-proposedPriority', featureMissing: 'f-featureMissing', businessRulesAffected: 'f-businessRulesAffected' };
function markOriginals(r) {
  if (!r.original) return;
  const show = v => Array.isArray(v) ? v.join(' · ') : typeof v === 'boolean' ? (v ? 'Sí' : 'No') : (v || '(vacío)');
  for (const [key, id] of Object.entries(ORIGINAL_FIELDS)) {
    if (!(key in r.original) || JSON.stringify(r.original[key] ?? null) === JSON.stringify(r[key] ?? null)) continue;
    const field = document.getElementById(id)?.closest('.field, .choice-field');
    if (!field || field.querySelector('.original-hint')) continue;
    field.insertAdjacentHTML('beforeend', `<small class="original-hint">${icon('clock')} Original del solicitante: ${esc(show(r.original[key]))}</small>`);
  }
}
function receipt(rc) {
  main.innerHTML = heading('Solicitud enviada', 'El Comité de Control de Cambios recibió tu solicitud.') + `<section class="card info-body receipt"><h2>${icon('check')} Solicitud ${esc(rc.id)}</h2><p>Fecha: ${dateLabel(rc.date)} · Estado: ${badge(rc.status)}</p>${callout('warn', `<strong>Guarda tu clave de seguimiento.</strong> Es la única forma de consultar el estado y responder al CCC sin cuenta. No se muestra de nuevo.<br><code class="token">${esc(rc.trackingToken)}</code>`)}<div class="actions"><a class="btn primary" href="#seguimiento">Consultar estado</a><button class="btn" id="another-request" type="button">Presentar otra solicitud</button></div></section>`;
  sessionTracking = { code: rc.id, token: rc.trackingToken };
  document.querySelector('#another-request').onclick = () => requestForm(null, 'usuario');
}
let sessionTracking = { code: '', token: '' };
function tracking() {
  main.innerHTML = heading('Seguimiento de una solicitud', 'Consulta el estado con el código y la clave de seguimiento que recibiste al enviarla.') + `<section class="card"><div class="detail-body"><form id="track-form" class="fields" novalidate>${formAlert()}${fld('code', 'Código de solicitud', { value: sessionTracking.code, required: true, placeholder: 'CRF-000001', prefix: 't' })}${fld('token', 'Clave de seguimiento', { value: sessionTracking.token, required: true, prefix: 't', type: 'password' })}<div class="form-actions full"><button class="btn primary" type="submit">${icon('search')} Consultar</button></div></form></div></section><div id="track-result"></div>`;
  bindForm('#track-form', async form => {
    if (!validate(form)) return;
    const data = collect(form); sessionTracking = { code: data.code.toUpperCase(), token: data.token };
    const result = await saveAction('/public/track', sessionTracking, 'POST', form);
    if (result) showTracked(result.request);
  });
  if (sessionTracking.code && sessionTracking.token) document.querySelector('#track-form').requestSubmit?.();
}
function showTracked(p) {
  document.querySelector('#track-result').innerHTML = card(`${esc(p.id)} · ${esc(p.title)}`, dl([['Estado', badge(p.status)], ['Fecha', dateLabel(p.date)], p.decision && ['Decisión del CCC', `${esc(p.decision.decision)} · ${dateLabel(p.decision.at, true)}`], p.decision && ['Justificación', text(p.decision.justification), true], p.decision?.conditions.length && ['Condiciones', listHtml(p.decision.conditions), true], p.closure && ['Cierre', esc(p.closure.result || p.closure.administrative)]]) +
    (p.pendingInfo ? callout('info', `<strong>El CCC solicita información:</strong> ${esc(p.pendingInfo)}`) + `<form id="public-clarification" class="fields" novalidate>${formAlert()}${fld('note', 'Tu respuesta', { area: true, required: true, prefix: 'pc' })}${fileField('files', 'Archivos de apoyo', 'pc')}<div class="form-actions full"><button class="btn primary" type="submit">Enviar respuesta</button></div></form>` : '') +
    `<h3>Avisos</h3>${p.notices.length ? `<ol class="history">${[...p.notices].reverse().map(n => `<li><strong>${dateLabel(n.at, true)}</strong><p>${esc(n.message)}</p><small>${esc(n.channel)}</small></li>`).join('')}</ol>` : '<p class="hint">Sin avisos todavía.</p>'}`);
  bindForm('#public-clarification', async form => {
    if (!validate(form)) return;
    let filesData; try { filesData = await readFiles(form.querySelector('#pc-files')); } catch (e) { validate(form, { 'pc-files': e.message }); return; }
    const result = await saveAction('/public/track/clarification', { ...sessionTracking, note: collect(form).note, files: filesData, revision: p.revision }, 'POST', form);
    if (result) { toast('Respuesta enviada al CCC.'); showTracked(result.request); }
  });
}

// ---------- Detalle del CRF ----------
async function detail(id) {
  const seq = viewSeq;
  main.innerHTML = heading('Expediente', 'Cargando…');
  let d;
  try { d = await api(`/requests/${id}`); } catch (e) { if (stale(seq)) return; main.innerHTML = heading('Solicitud no disponible', esc(e.message)) + '<a class="btn primary" href="#solicitudes">Volver al listado</a>'; return; }
  if (stale(seq)) return;
  current = d; renderDetail();
}
const lastAssignment = r => { const a = r.assignments?.at(-1); return a && !a.releasedAt ? a : null; };
const authorization = r => [...(r.decisions || [])].reverse().find(x => x.kind === 'Autorización' && x.decision !== 'Más información' && !x.superseded) || null;
function renderDetail() {
  const { request: r, attachments } = current;
  const ccc = isCommittee() && r.ownerId !== currentUser.id, assignee = lastAssignment(r), iAmAssignee = isDeveloper() && assignee?.developerId === currentUser.id;
  const owner = r.ownerId === currentUser.id, editable = owner && r.status === 'Registrada';
  const auth = authorization(r), round = r.implementation?.rounds?.at(-1);
  const actions = [];
  if (ccc && r.status !== 'Cerrada') actions.push(`<a class="btn" href="#editar/${esc(r.id)}">${icon('edit')} Corregir solicitud</a>`);
  if (editable) actions.push(`<a class="btn" href="#editar/${esc(r.id)}">${icon('edit')} Editar</a><button class="btn danger" id="delete-request" type="button">${icon('trash')} Eliminar</button>`);
  if (ccc && ['En análisis', 'En planificación', 'Pendiente de aprobación', 'Aprobada', 'Aprobada con condiciones', 'Asignada'].includes(r.status)) actions.push(`<a class="btn primary" href="#ficha/${esc(r.id)}">${icon('shield')} Ficha del CCC</a>`);
  const stageIdx = CAT.STAGES.findIndex(([, states]) => states.includes(r.status));
  const phase = (from, to) => stageIdx > to ? 'done' : stageIdx >= from ? 'current' : '';
  const lastReview = r.reviews?.at(-1), issue = r.github?.issue;
  const actionsHtml = stageActions(r, { ccc, iAmAssignee, owner });
  const jump = [
    actionsHtml && ['sec-actions', 'Acciones', 'flag', 'Tareas de tu rol', 'current'],
    ['sec-solicitud', 'Solicitud', 'book', r.corrections?.length ? 'Corregida por el CCC' : r.requesterType === 'usuario' ? 'Usuario final' : 'Desarrollador', phase(0, 0)],
    ['sec-ccc', 'Evaluación', 'shield', auth ? auth.decision : r.evaluation?.planningCompletedAt ? 'Planificada' : r.evaluation ? 'En curso' : 'Pendiente', phase(1, 3)],
    ['sec-impl', 'Implementación', 'git', round ? `Ronda ${round.n} · ${(r.changes || []).length} cambios` : 'Sin iniciar', phase(4, 4)],
    ['sec-review', 'Revisión y cierre', 'flag', r.closure ? (r.closure.result || r.closure.administrative) : lastReview ? lastReview.decision : r.tests?.length ? `${r.tests.length} pruebas` : 'Pendiente', phase(5, 6)],
    ['sec-audit', 'Auditoría', 'search', `${current.audit.length} eventos`, ''],
    ['sec-history', 'Historial', 'clock', `${r.history.length} hitos`, '']
  ].filter(Boolean);
  main.innerHTML = heading(`${esc(r.id)} · ${esc(r.title)}`, `${r.requesterType === 'usuario' ? 'CRF de usuario final' : 'CRF técnico'} · ${esc(r.name)} · ${dateLabel(r.createdAt, true)}${r.legacyCode ? ` · código anterior ${esc(r.legacyCode)}` : ''}`, `<div class="actions" style="margin:0"><a class="btn" href="#solicitudes">${icon('back')} Volver</a>${actions.join('')}</div>`) +
    progress(r) +
    (r.flags?.length ? callout('warn', `<strong>Información heredada marcada para revisión:</strong>${listHtml(r.flags)}`) : '') +
    `<div class="case-layout"><aside class="case-nav"><nav aria-label="Fases del expediente"><p class="case-nav-title">Fases del expediente</p><ul>${jump.map(([sid, label, ico, meta, cls]) => `<li><button type="button" class="case-nav-item ${cls}" data-jump="${sid}">${icon(ico)}<span><strong>${label}</strong><small>${esc(meta)}</small></span></button></li>`).join('')}</ul></nav></aside><div class="detail-stack">${actionsHtml}
    ${card('Solicitud original', dl([['Estado', badge(r.status)], ['Prioridad oficial', priority(r.priority)], ['Solicitante', `${esc(r.name)} · ${esc(r.email)}${r.submittedWithoutAccount ? ' <small class="hint">(sin cuenta, contacto no verificado)</small>' : ''}`], ['Proyecto', esc(r.project)], ['Módulos afectados', moduleChips(r.modules)], ['Issue de GitHub', issue ? `<a class="text-link" href="${esc(issue.url)}" target="_blank" rel="noopener noreferrer">${icon('git')} #${esc(issue.number)}</a> ${badge(issue.state === 'closed' ? 'Cerrada' : 'Abierta')}` : `<span class="hint">${r.github?.lastSync && !r.github.lastSync.ok ? `No se creó: ${esc(r.github.lastSync.message)}` : GH?.canCreateIssues ? (authorization(r)?.decision?.startsWith('Aprobado') ? 'Sin issue' : 'Se creará cuando el CCC apruebe') : 'GitHub sin configurar'}</span>`], ['Fecha deseada', r.desiredDate ? `${dateLabel(r.desiredDate)} <small class="hint">(preferencia, no autorizada)</small>` : text('')], r.currentBehavior && ['Situación actual', text(r.currentBehavior), true], ['Tipo de solicitud', r.featureMissing ? 'Funcionalidad nueva (todavía no existe)' : 'Cambio sobre algo existente'], ['Descripción del cambio', text(r.description), true], ['Justificación', text(r.justification), true], ['Resultado esperado', text(r.result), true], ['Observaciones', text(r.observations), true]]) +
      (r.corrections?.length ? callout('info', `<strong>Corregida por el CCC:</strong><ul class="plain-list">${r.corrections.map(c => `<li>${esc(c.by)} · ${dateLabel(c.at, true)} · ${esc(c.fields.join(', '))}: ${esc(c.reason)}</li>`).join('')}</ul>`) + (r.original ? `<details class="original-data"><summary>Ver los datos originales del solicitante</summary>${dl(Object.entries(r.original).filter(([k]) => k !== 'savedAt').map(([k, v]) => [k, Array.isArray(v) ? listHtml(v) : text(typeof v === 'boolean' ? (v ? 'Sí' : 'No') : v), true]))}</details>` : '') : '') +
      (r.requesterType === 'experto' ? `<h3>Propuesta técnica del desarrollador</h3>${dl([['Tipo de modificación', text(r.modificationType)], ['Tipo ITIL propuesto', text(r.proposedItilType)], ['Entorno', text(r.environment)], ['Versión actual', text(r.currentVersion)], ['Versión propuesta', text(r.targetVersion)], ['Prioridad propuesta', priority(r.proposedPriority)], ['Spec', `${text(r.spec)}${r.specUrl ? `<br><a class="text-link" href="${esc(r.specUrl)}" target="_blank" rel="noopener noreferrer">${esc(r.specUrl)}</a>` : ''}`, true], ['Reglas de negocio afectadas', text(r.businessRules), true], ['Criterios de aceptación', listHtml(r.acceptanceCriteria), true], ['Componentes técnicos', text(r.components || r.legacy?.components), true]])}` : '') +
      `<h3>Adjuntos y evidencias</h3>${attachments.length ? table(['Archivo', 'Contexto', 'Tamaño', 'Registrado por', 'Fecha'], attachments.map(a => [`<a class="text-link" href="/api/attachments/${esc(a.id)}">${icon('attach')} ${esc(a.filename)}</a><small class="hint">sha256 ${esc(a.sha256.slice(0, 12))}…</small>`, esc(a.context), `${Math.ceil(a.size / 1024)} KB`, esc(a.uploader_name), dateLabel(a.created_at, true)])) : '<p class="hint">Sin archivos adjuntos.</p>'}${r.legacy?.attachmentNames?.length ? `<p class="hint">Nombres registrados en la versión anterior (sin archivo real): ${r.legacy.attachmentNames.map(n => `<span class="file-chip">${esc(n)}</span>`).join(' ')}</p>` : ''}
      ${r.status !== 'Cerrada' ? `<form id="upload-form" class="inline-form" novalidate>${formAlert()}${fileField('files', 'Agregar archivos', 'up')}<div class="form-actions full"><button class="btn" type="submit">${icon('attach')} Subir archivos</button></div></form>` : ''}` +
      (r.infoRequests?.length ? `<h3>Solicitudes de información</h3>${r.infoRequests.map(i => `<div class="info-thread"><p><strong>${esc(i.by)} · ${dateLabel(i.at, true)}</strong> (desde «${esc(i.from)}»)</p><p>${text(i.missing)}</p>${i.response ? `<p class="reply"><strong>Respuesta de ${esc(i.respondedBy)} · ${dateLabel(i.respondedAt, true)}:</strong> ${text(i.response)}</p>` : '<p class="hint">Pendiente de respuesta.</p>'}</div>`).join('')}` : ''), { id: 'sec-solicitud', subtitle: 'Datos del iniciador. Se conservan sin cambios; las conclusiones del CCC se registran por separado.' })}
    ${card('Evaluación y autorización del CCC', evaluationSummary(r), { id: 'sec-ccc', actions: ccc && ['En análisis', 'En planificación', 'Pendiente de aprobación'].includes(r.status) ? `<a class="btn primary" href="#ficha/${esc(r.id)}">Abrir ficha</a>` : '' })}
    ${card('Asignación e implementación', implementationSection(r), { id: 'sec-impl' })}
    ${card('Pruebas, revisión y cierre', testsSection(r) + reviewSection(r), { id: 'sec-review', subtitle: 'Las pruebas verifican el comportamiento; la revisión evalúa si se cumplió lo autorizado; el cierre registra el resultado.' })}
    ${card('Auditoría', auditSummary(r) + `<h3>Eventos</h3>` + auditTable(current.audit), { id: 'sec-audit', subtitle: 'Eventos de solo inserción: quién, qué, cuándo, estado anterior y nuevo, y cada campo modificado.' })}
    ${card('Historial', `<ol class="history">${[...r.history].reverse().map(h => `<li><strong>${esc(h.action || h.status)} · ${esc(h.responsible)}</strong><small>${dateLabel(h.date, true)}${h.from && h.from !== h.status ? ` · ${esc(h.from)} → ${esc(h.status)}` : ` · ${esc(h.status)}`}</small><p>${esc(h.note)}</p></li>`).join('')}</ol>`, { id: 'sec-history', subtitle: 'Hitos del expediente; el historial no se modifica.' })}</div></div>`;
  const navItems = [...document.querySelectorAll('[data-jump]')];
  const activate = sid => navItems.forEach(b => b.classList.toggle('active', b.dataset.jump === sid));
  navItems.forEach(b => b.onclick = () => { activate(b.dataset.jump); document.getElementById(b.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  // Resalta la fase visible mientras se desplaza el expediente.
  if (typeof IntersectionObserver === 'function') {
    const observer = new IntersectionObserver(entries => { const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (visible) activate(visible.target.id); }, { rootMargin: '-15% 0px -70% 0px' });
    navItems.forEach(b => { const target = document.getElementById(b.dataset.jump); if (target) observer.observe(target); });
  }
  if (navItems[0]) activate(navItems[0].dataset.jump);
  bindDetail(r);
}
// Resumen de la rama de trabajo y del PR del cambio, con su estado en GitHub.
function workSummary(r) {
  const b = r.workBranch, pr = r.pullRequest;
  const prState = pr ? badge({ fusionado: 'Fusionado', abierto: 'Abierto', borrador: 'Borrador', 'cerrado sin fusionar': 'Cerrado sin fusionar' }[pr.state] || 'Sin verificar') : '';
  return `<div class="flow-refs">${b ? `<div class="ref-box">${icon('git')}<div><small>Rama de trabajo</small><code>${esc(b.name)}</code><span class="hint">desde ${esc(b.base)} · ${b.verified ? (b.created ? 'creada en GitHub' : 'verificada en GitHub') : 'sin verificar'}</span></div></div>` : '<p class="hint">Todavía no se registró la rama de trabajo.</p>'}${pr ? `<div class="ref-arrow" aria-hidden="true">${icon('arrow')}</div><div class="ref-box">${icon('send')}<div><small>Pull request</small><a class="text-link" href="${esc(pr.url || '#')}" target="_blank" rel="noopener noreferrer">#${esc(pr.number)} ${esc(pr.title || '')}</a><span class="hint"><code>${esc(pr.head)}</code> → <code>${esc(pr.base)}</code></span>${prState}</div></div>` : ''}</div>`;
}
const moduleChips = list => list?.length ? `<span class="chip-list">${list.map(m => `<span class="module-chip">${icon(MODULE_ICONS[m] || 'cube')} ${esc(m)}</span>`).join('')}</span>` : '<span class="hint">Sin módulos</span>';
function evaluationSummary(r) {
  const e = r.evaluation, out = [];
  if (!e) out.push('<p class="hint">El CCC todavía no inició el análisis.</p>');
  else {
    out.push(`<p class="hint">Responsable: ${esc(e.member)} · inicio ${dateLabel(e.startedAt, true)}${e.analysisCompletedAt ? ` · análisis completado ${dateLabel(e.analysisCompletedAt, true)}` : ' · análisis en borrador'}${e.planningCompletedAt ? ` · planificación completada ${dateLabel(e.planningCompletedAt, true)}` : ''}</p>`);
    out.push(`<h3>A. Identificación y clasificación</h3>${dl([['Tipo ITIL', e.itilType ? `${esc(e.itilType)} <small class="hint">${esc(CAT.ITIL[e.itilType])}</small>` : text('')], e.standardReference && ['Procedimiento estándar de referencia', `${esc(e.standardReference)} ${e.standardSameConditions ? '(condiciones confirmadas)' : ''}`], ['Módulos afectados (confirmados por el CCC)', e.affectedModules?.length ? `<ul class="plain-list">${e.affectedModules.map(x => `<li>${esc(x.module)} · ${esc(x.operation)}</li>`).join('')}</ul>` : text(''), true]])}`);
    out.push(`<h3>B. Impacto y riesgos</h3>${dl([['Impacto', text(e.impact)], ['Urgencia', text(e.urgency)], ['Prioridad', priority(e.priority)], e.feasibility && ['Viabilidad (decisión)', text(e.feasibility)], ['Riesgos', listHtml(e.risks), true], e.functionalImpact && ['Impacto en los usuarios', text(e.functionalImpact), true], e.resources && ['Recursos', text(e.resources), true], e.considerations && ['Consideraciones', text(e.considerations), true]])}`);
    out.push(`<h3>C. Planificación</h3><div class="plan-grid"><div><h4>Plan de rollout</h4>${md(planText(e, 'rollout'))}</div><div><h4>Plan de backout</h4>${md(planText(e, 'backout'))}</div></div>${dl([['Fecha límite de implementación', e.deadline ? dateLabel(e.deadline) : text('')]])}`);
  }
  out.push(`<h3>D. Decisiones</h3>${r.decisions?.length ? r.decisions.map(d => `<div class="decision ${d.superseded ? 'superseded' : ''}"><p><strong>${esc(d.kind)} ${d.n}: ${esc(d.decision)}</strong> · ${esc(d.decidedBy)} · ${dateLabel(d.at, true)}${d.superseded ? ` <span class="badge status-cerrada">sustituida</span>` : ''}${d.legacy ? ' <span class="badge status-más-información">versión anterior</span>' : ''}${d.preauthorizedBy ? ` <span class="badge status-aprobada">preautorización ${esc(d.preauthorizedBy)}</span>` : ''}</p>${d.justification ? `<p>${text(d.justification)}</p>` : ''}${d.authorizedModules?.length ? `<p><strong>Módulos autorizados:</strong> ${esc(d.authorizedModules.map(x => `${x.module} (${x.operation})`).join(', '))}</p>` : ''}${d.module ? `<p><strong>Módulo:</strong> ${esc(d.module)}</p>` : ''}${d.feasibility ? `<p><strong>Viabilidad:</strong> ${esc(d.feasibility)}</p>` : ''}${d.conditions?.length ? `<p><strong>Condiciones:</strong></p><ul class="plain-list">${d.conditions.map(c => `<li>${esc(c.id)}: ${esc(c.text)} <small class="hint">Verificación: ${esc(c.verification)}</small></li>`).join('')}</ul>` : ''}${d.feasibilityException ? callout('warn', `<strong>Excepción de viabilidad:</strong> ${esc(d.feasibilityException)}`) : ''}${d.superseded ? `<p class="hint">Sustituida por ${esc(d.supersededBy)} el ${dateLabel(d.supersededAt, true)}: ${esc(d.supersededReason)}</p>` : ''}</div>`).join('') : '<p class="hint">Sin decisiones registradas.</p>'}`);
  return out.join('');
}
function implementationSection(r) {
  const out = [];
  out.push(`<h3>E. Asignación</h3>${r.assignments?.length ? table(['#', 'Desarrollador', 'Asignó', 'Fecha', 'Fecha límite', 'Prioridad', 'Observaciones', 'Estado'], r.assignments.map(a => [a.n, esc(a.developerName), esc(a.assignedBy), dateLabel(a.at, true), a.targetDate ? dateLabel(a.targetDate) : '—', priority(a.priority), esc([a.notes, a.reason && `Motivo: ${a.reason}`].filter(Boolean).join(' · ')), a.releasedAt ? `Liberada ${dateLabel(a.releasedAt)}` : '<strong>Vigente</strong>'])) : '<p class="hint">Sin asignación.</p>'}`);
  const auth = authorization(r);
  if (auth && ['Aprobado', 'Aprobado con condiciones'].includes(auth.decision) && r.evaluation) out.push(callout('info', `<strong>Plan aprobado (decisión ${auth.n}):</strong> planes de rollout, backout y pruebas en la sección de evaluación.${auth.conditions?.length ? ` <strong>Condiciones:</strong> ${esc(auth.conditions.map(c => c.text).join(' | '))}` : ''}`));
  for (const rd of r.implementation?.rounds || []) out.push(`<h3>Ronda ${rd.n} · iniciada ${dateLabel(rd.startedAt, true)} por ${esc(rd.startedBy)}${rd.sentToTestsAt ? ` · enviada a pruebas ${dateLabel(rd.sentToTestsAt, true)}` : ''}</h3>${rd.note ? `<p>${esc(rd.note)}</p>` : ''}${table(['Actividad', 'Fecha', 'Descripción', 'Estado', 'Evidencia / observaciones'], rd.activities.map(a => [esc(a.id), dateLabel(a.date), esc(a.description), esc(a.status), esc([a.evidence, a.observations].filter(Boolean).join(' · '))]), 'Sin actividades registradas.')}`);
  out.push(`<h3>Rama de trabajo y pull request</h3>${workSummary(r)}`);
  out.push(`<h3>Módulos autorizados</h3>${moduleChips(current.authorizedModules)}`);
  out.push(`<h3>Módulos realmente modificados</h3>${table(['ID', 'Módulo', 'Operación', 'Descripción', 'Ronda', 'Registró', 'Alcance'], (r.changes || []).map(c => [esc(c.id), esc(c.module), esc(c.operation), `${esc(c.description)}${c.evidence ? `<small class="hint">${esc(c.evidence)}</small>` : ''}`, esc(c.round), `${esc(c.by)} · ${dateLabel(c.at)}`, c.inScope ? badge('Autorizada') : badge('No autorizada')]), 'Todavía no se registraron módulos modificados.')}`);
  const canVerify = isDeveloper() || isCommittee();
  out.push(`<h3>Referencias de GitHub</h3><p class="hint">${GH ? esc(GH.configured ? `${GH.message}${GH.configured && !GH.reachable ? '' : ''}` : GH.message) : 'Estado de GitHub no disponible.'}</p>${table(['Tipo', 'Referencia', 'Estado en GitHub', 'Registrado por', ''], (r.gitRefs || []).map(g => { const v = g.verification, d = v?.details || {}; return [esc(g.kind), `<code>${esc(g.value)}</code>${g.url ? `<a class="text-link" href="${esc(g.url)}" target="_blank" rel="noopener noreferrer">${icon('arrow')} abrir</a>` : ''}${d.title || d.message ? `<small class="hint">${esc(d.title || d.message)}</small>` : ''}`, g.verified ? `${badge('Verificada')}${d.state ? ` ${badge(d.state === 'fusionado' ? 'Fusionado' : d.state === 'abierto' ? 'Abierto' : d.state === 'borrador' ? 'Borrador' : 'Cerrado sin fusionar')}` : ''}<small class="hint">${dateLabel(v.at, true)}</small>` : `<span class="hint">${esc(v?.message || 'Registrado manualmente; no verificado.')}</span>`, `${esc(g.by)} · ${dateLabel(g.at)}`, canVerify && GH?.configured && g.kind !== 'Enlace de evidencia' && r.status !== 'Cerrada' ? `<button class="btn" type="button" data-git-refresh="${esc(g.id)}">Verificar</button>` : '']; }), 'Sin referencias registradas.')}`);
  if (r.deviations?.length) out.push(`<h3>Desviaciones de alcance</h3>${table(['ID', 'Descripción', 'Registró', 'Estado', 'Decisión'], r.deviations.map(d => [esc(d.id), esc(d.description), `${esc(d.by)} · ${dateLabel(d.at)}`, badge(d.status), d.decidedBy ? `${esc(d.decidedBy)}: ${esc(d.justification)}` : '—']))}`);
  return out.join('');
}
function testsSection(r) {
  const e = r.evaluation || {};
  return `<h3>Criterios de aceptación a verificar</h3>${listHtml(current.reviewCriteria)}
    <h3>Ejecuciones registradas</h3>${table(['ID', 'Ronda', 'Prueba', 'Esperado', 'Obtenido', 'Estado', 'Responsable', 'Evidencia'], (r.tests || []).map(t => [esc(t.id), esc(t.round), `${esc(t.name)}${t.criterion ? `<small class="hint">${esc(t.criterion)}</small>` : ''}`, esc(t.expected), esc(t.obtained), badge(t.status), `${esc(t.responsible)}${t.independent ? '' : ' <small class="hint">(implementador)</small>'}<small class="hint">${dateLabel(t.date, true)}</small>`, esc([t.evidence, t.observations].filter(Boolean).join(' · '))]), 'Sin pruebas registradas.')}
    <h3>Resultados por ronda</h3>${table(['Ronda', 'Resultado', 'Incidencia / observaciones', 'Registró'], (r.testRounds || []).map(t => [esc(t.round), esc(t.outcome), esc([t.incident, t.note].filter(Boolean).join(' · ')), `${esc(t.by)} · ${dateLabel(t.at, true)}`]), 'Sin resultados de pruebas.')}`;
}
function reviewSection(r) {
  const out = [];
  out.push(`<h3>Revisiones</h3>${(r.reviews || []).map(v => `<div class="decision"><p><strong>Revisión ${v.n} (ronda ${v.round}): ${esc(v.decision)}</strong> · ${esc(v.reviewer)}${v.independent ? '' : ' (implementador)'} · ${dateLabel(v.at, true)}</p>${dl([['Resumen', text(v.summary), true], ['Resultado de pruebas', esc(v.testResult)], ['Rollout', esc(v.rolloutCompliance)], ['Criterios', `<ul class="plain-list">${v.criteria.map(c => `<li>${c.met ? '✔' : '✘'} ${esc(c.text)}${c.note ? ` · ${esc(c.note)}` : ''}</li>`).join('')}</ul>`, true], v.conditions.length && ['Condiciones del CCC', `<ul class="plain-list">${v.conditions.map(c => `<li>${c.met ? '✔' : '✘'} ${esc(c.text)}${c.evidence ? ` · ${esc(c.evidence)}` : ''}</li>`).join('')}</ul>`, true], ['Módulos modificados', esc((v.modifiedModules || v.modifiedIcs || []).join(', ') || '—'), true], ['Desviaciones', text(v.deviationsFound)], ['Incidencias pendientes', text(v.pendingIssues)], ['Recomendación', text(v.recommendation), true]])}</div>`).join('') || '<p class="hint">Sin revisiones.</p>'}`);
  out.push(`<h3>Backout ejecutado</h3>${table(['ID', 'Fecha', 'Motivo', 'Acciones', 'Recuperado', 'Resultado', 'Estado posterior'], (r.backouts || []).map(b => [esc(b.id), `${dateLabel(b.at, true)}<small class="hint">${esc(b.by)}</small>`, esc(b.trigger), esc(b.actions), esc(b.recovered), esc(b.result), esc(b.systemState)]), 'No se ejecutó ningún backout (el plan de backout es solo una previsión).')}`);
  const closures = [...(r.closures || []), r.closure].filter(Boolean);
  out.push(`<h3>Cierre</h3>${closures.map(c => `<div class="decision ${c === r.closure ? '' : 'superseded'}">${dl([['Resultado de implementación', c.result ? badge(c.result) : '<span class="hint">No aplica (sin implementación)</span>'], ['Resultado administrativo', esc(c.administrative)], ['Resultado de autorización', esc(authorization(r)?.decision || (r.decisions || []).at(-1)?.decision || '—')], ['Responsable', `${esc(c.by)} · ${dateLabel(c.at, true)}`], ['Resumen', text(c.summary), true], c.justification && ['Justificación', text(c.justification), true], (c.modulesModified || c.icsModified)?.length && ['Módulos modificados', esc((c.modulesModified || c.icsModified).join(', ')), true], c.gitRefs?.length && ['Referencias Git', esc(c.gitRefs.join(' · ')), true], c.resultingVersion && ['Versión resultante', esc(c.resultingVersion)], c.testsResult && ['Pruebas', esc(c.testsResult)], c.reviewResult && ['Revisión', esc(c.reviewResult)]])}</div>`).join('') || '<p class="hint">La solicitud no está cerrada.</p>'}`);
  if (r.reopenings?.length) out.push(`<h3>Reaperturas</h3>${table(['Fecha', 'Responsable', 'Motivo', 'Nuevo estado'], r.reopenings.map(x => [dateLabel(x.at, true), esc(x.by), esc(x.reason), esc(x.newStatus)]))}`);
  return out.join('');
}
// Lo que se revisa en la auditoría: rama, pull request, commits y módulos realmente cambiados.
function auditSummary(r) {
  const rows = [];
  if (r.workBranch) rows.push(['Rama de trabajo', `<code>${esc(r.workBranch.name)}</code>`, `desde ${esc(r.workBranch.base)}`, r.workBranch.verified ? badge('Verificada') : '<span class="hint">sin verificar</span>', `${esc(r.workBranch.by)} · ${dateLabel(r.workBranch.at, true)}`]);
  if (r.pullRequest) rows.push(['Pull request', `#${esc(r.pullRequest.number)}`, `<code>${esc(r.pullRequest.head)}</code> → <code>${esc(r.pullRequest.base)}</code>`, r.pullRequest.verified ? badge({ fusionado: 'Fusionado', abierto: 'Abierto', borrador: 'Borrador', 'cerrado sin fusionar': 'Cerrado sin fusionar' }[r.pullRequest.state] || 'Verificada') : '<span class="hint">sin verificar</span>', `${esc(r.pullRequest.by)} · ${dateLabel(r.pullRequest.at, true)}`]);
  for (const g of (r.gitRefs || []).filter(g => !['Rama', 'Pull request'].includes(g.kind))) rows.push([esc(g.kind), `<code>${esc(g.value)}</code>`, esc(g.verification?.details?.message || g.note || ''), g.verified ? badge('Verificada') : '<span class="hint">sin verificar</span>', `${esc(g.by)} · ${dateLabel(g.at, true)}`]);
  for (const c of r.changes || []) rows.push(['Módulo modificado', esc(c.module), `${esc(c.operation)}: ${esc(c.description)}`, c.inScope ? badge('Autorizada') : badge('No autorizada'), `${esc(c.by)} · ${dateLabel(c.at, true)}`]);
  return `<h3>Cambios y ramas registrados</h3>${table(['Elemento', 'Referencia', 'Detalle', 'Estado', 'Registró'], rows, 'Todavía no se registraron ramas, commits ni módulos modificados.')}`;
}
const auditTable = events => table(['Fecha', 'Entidad', 'Evento', 'Actor', 'Estado', 'Campo', 'Anterior', 'Nuevo', 'Justificación'], events.map(e => [dateLabel(e.at, true), `${esc(e.entity_type)} <code>${esc(e.entity_id)}</code>`, esc(e.action), esc(e.actor_name), e.from_status || e.to_status ? `${esc(e.from_status || '—')} → ${esc(e.to_status || '—')}` : '—', esc(e.field || ''), `<small>${esc(e.old_value || '')}</small>`, `<small>${esc(e.new_value || '')}</small>`, `<small>${esc(e.justification || '')}</small>`]), 'Sin eventos.');

// Formularios de la etapa actual según el rol (el servidor vuelve a comprobar cada permiso).
function stageActions(r, { ccc, iAmAssignee, owner }) {
  const forms = [], devs = TEAM.filter(u => u.role === 'experto'), assignee = lastAssignment(r), auth = authorization(r);
  const box = (title, id, content, button, note = '') => `<form id="${id}" class="action-form" novalidate><h3>${title}</h3>${note ? `<p class="hint">${note}</p>` : ''}${formAlert()}<div class="fields">${content}</div><div class="form-actions"><button class="btn primary" type="submit">${button}</button></div></form>`;
  if (ccc && r.status === 'Registrada') forms.push(box('Recepción del CRF', 'act-receive', '', `${icon('check')} Recibir solicitud`, 'Registra que el CCC recibió la solicitud y comienza la verificación de completitud.'));
  if (ccc && r.status === 'En validación') forms.push(box('Validación de la información', 'act-validate', fld('note', 'Observación de la validación', { area: true, rows: 2, prefix: 'va' }), `${icon('check')} Información completa: iniciar análisis`) + box('Solicitar correcciones o información', 'act-info', fld('missing', 'Qué información falta', { area: true, required: true, prefix: 'in' }), 'Solicitar información', 'No equivale a un rechazo: el iniciador podrá responder.'));
  if (ccc && ['En análisis', 'En planificación', 'Pendiente de aprobación'].includes(r.status)) forms.push(`<div class="action-form"><h3>Ficha del CCC</h3><p>Clasificación, impacto, planificación y decisión se registran en una única ficha.</p><a class="btn primary" href="#ficha/${esc(r.id)}">${icon('shield')} Abrir ficha del CCC</a></div>`);
  if (owner && r.status === 'Pendiente de información') forms.push(box('Responder al CCC', 'act-clarify', `${callout('info', esc(r.infoRequests?.at(-1)?.missing || ''))}${fld('note', 'Tu respuesta', { area: true, required: true, prefix: 'cl' })}`, 'Enviar respuesta', 'La solicitud volverá a validación del CCC.'));
  if (ccc && ['Aprobada', 'Aprobada con condiciones', 'Asignada', 'En implementación', 'En pruebas', 'Correcciones requeridas'].includes(r.status) && auth && !auth.needsReevaluation) {
    forms.push(box(assignee ? 'Reasignar implementación' : 'Asignar implementación', 'act-assign', fld('developerId', 'Desarrollador responsable', { options: devs.filter(u => u.id !== assignee?.developerId).map(u => [u.id, u.name]), required: true, prefix: 'as' }) + fld('priority', 'Prioridad', { options: CAT.LEVELS, value: r.priority, prefix: 'as' }) + fld('notes', 'Observaciones de implementación', { area: true, rows: 2, prefix: 'as' }) + (assignee ? fld('reason', 'Motivo de la reasignación', { area: true, rows: 2, required: true, prefix: 'as' }) : ''), `${icon('users')} ${assignee ? 'Reasignar' : 'Asignar'}`, `Plan aprobado en la decisión ${auth.n} (${esc(auth.decision)}). Fecha límite: ${r.evaluation?.deadline ? dateLabel(r.evaluation.deadline) : 'sin definir'}.`));
  }
  if (ccc && ['Aprobada', 'Aprobada con condiciones', 'Asignada'].includes(r.status)) forms.push(box('Reevaluar la autorización', 'act-reevaluate', fld('reason', 'Motivo de la reevaluación', { area: true, required: true, prefix: 're' }), 'Reevaluar', auth?.needsReevaluation ? 'La aprobación proviene de la versión anterior sin rollout ni backout: debe reevaluarse antes de asignar.' : 'La decisión vigente quedará sustituida, pero se conserva en el historial.'));
  if (ccc && r.status === 'Rechazada') forms.push(box('Cierre administrativo', 'act-close-rejected', fld('justification', 'Observación de cierre', { area: true, rows: 2, prefix: 'cr' }), 'Cerrar como rechazada', 'Una solicitud rechazada no pasa por implementación ni recibe resultado exitoso.'));
  if (ccc && r.status === 'Cerrada') forms.push(box('Reabrir solicitud', 'act-reopen', fld('reason', 'Motivo de la reapertura', { area: true, required: true, prefix: 'ro' }), 'Reabrir', 'Volverá a análisis; el cierre anterior se conserva.'));
  for (const d of (r.deviations || []).filter(x => x.status === 'Pendiente')) if (ccc) forms.push(box(`Decidir desviación ${esc(d.id)}`, `act-scope-${d.id}`, `<p>${esc(d.description)}</p><input type="hidden" name="deviationId" value="${esc(d.id)}">` + radios('decision', 'Decisión', ['Autorizada', 'No autorizada'], '', { prefix: `sc${d.id}` }) + fld('justification', 'Justificación', { area: true, required: true, prefix: `sc${d.id}` }), 'Registrar decisión', 'El nuevo alcance requiere autorización explícita del CCC.'));
  if (iAmAssignee && ['Asignada', 'En implementación', 'Correcciones requeridas'].includes(r.status)) forms.push(`<div class="action-form"><h3>Seguimiento del cambio</h3><p>Inicia la implementación, registra la rama de trabajo, documenta el desarrollo, crea el pull request y envía a pruebas, paso a paso.</p><a class="btn primary" href="#trabajo/${esc(r.id)}">${icon('git')} Abrir seguimiento paso a paso</a></div>`);
  if (isDeveloper() && r.status === 'En pruebas') {
    const criteria = [...new Set([...(r.acceptanceCriteria || []), ...(r.evaluation?.testCriteria || [])])];
    forms.push(box('Registrar ejecución de prueba', 'act-test', (assignee?.developerId === currentUser.id ? callout('info', 'Eres el implementador: se recomienda que otro desarrollador ejecute las pruebas.') : '') + fld('name', 'Nombre de la prueba', { required: true, prefix: 'te' }) + fld('criterion', 'Criterio que verifica', { options: criteria, prefix: 'te' }) + fld('description', 'Descripción', { prefix: 'te' }) + fld('expected', 'Resultado esperado', { required: true, prefix: 'te' }) + fld('obtained', 'Resultado obtenido', { prefix: 'te' }) + fld('status', 'Estado', { options: CAT.TEST_STATES, required: true, prefix: 'te' }) + fld('evidence', 'Evidencia', { prefix: 'te' }) + fld('observations', 'Observaciones', { prefix: 'te' }), 'Registrar prueba', 'Cada ejecución se conserva; para repetir una prueba registra una nueva ejecución con el mismo nombre.'));
    forms.push(box('Resultado de las pruebas', 'act-finish', radios('outcome', 'Resultado', CAT.TEST_OUTCOMES, '', { prefix: 'fi' }) + fld('incident', 'Incidencia detectada (si hay fallos)', { area: true, rows: 2, prefix: 'fi' }) + fld('next', 'Con fallos, enviar a', { options: [['Correcciones', 'Correcciones (volver a implementación)'], ['Revisión', 'Revisión (evaluar como fallido o tras un backout)']], value: 'Correcciones', prefix: 'fi' }) + fld('note', 'Observaciones', { area: true, rows: 2, prefix: 'fi' }), 'Registrar resultado'));
  }
  if (iAmAssignee && ['En implementación', 'En pruebas', 'Correcciones requeridas', 'En revisión'].includes(r.status)) forms.push(`<details class="action-form"><summary><strong>Documentar backout ejecutado</strong></summary>${box('', 'act-backout', fld('trigger', 'Motivo de activación', { area: true, rows: 2, required: true, prefix: 'bo' }) + fld('actions', 'Acciones realizadas', { area: true, rows: 2, required: true, prefix: 'bo' }) + fld('recovered', 'Configuración o versión recuperada', { required: true, prefix: 'bo' }) + fld('result', 'Resultado de la reversión', { options: CAT.BACKOUT_RESULTS, required: true, prefix: 'bo' }) + fld('systemState', 'Estado posterior del sistema', { area: true, rows: 2, required: true, prefix: 'bo' }) + fld('evidence', 'Evidencias', { prefix: 'bo' }), 'Registrar backout', 'Solo documenta la reversión realizada fuera del sistema; no restaura código ni datos.')}</details>`);
  if (isDeveloper() && r.status === 'En revisión') {
    const criteria = current.reviewCriteria;
    forms.push(box('Revisión postimplementación', 'act-review', (assignee?.developerId === currentUser.id ? callout('info', 'Eres el implementador: se recomienda que otro desarrollador realice la revisión.') : '') + fld('summary', 'Resumen de implementación', { area: true, required: true, rows: 2, prefix: 'rv' }) + `<fieldset class="field full"><legend>Cumplimiento de criterios de aceptación</legend>${criteria.map((c, i) => `<label class="check"><input type="checkbox" data-group="criteria" value="${i}"> ${esc(c)}</label>`).join('') || '<p class="hint">Sin criterios.</p>'}</fieldset>` + (auth?.conditions?.length ? `<fieldset class="field full"><legend>Condiciones del CCC</legend>${auth.conditions.map(c => `<label class="check"><input type="checkbox" data-group="conditionsMet" value="${esc(c.id)}"> ${esc(c.text)} <small class="hint">${esc(c.verification)}</small></label><input name="cond-evidence-${esc(c.id)}" aria-label="Evidencia de ${esc(c.id)}" placeholder="Evidencia de ${esc(c.id)}" maxlength="1000">`).join('')}</fieldset>` : '') + fld('rolloutCompliance', 'Cumplimiento del plan de rollout', { options: CAT.ROLLOUT_COMPLIANCE, required: true, prefix: 'rv' }) + fld('deviationsFound', 'Desviaciones encontradas', { area: true, rows: 2, prefix: 'rv' }) + fld('pendingIssues', 'Incidencias pendientes', { area: true, rows: 2, prefix: 'rv' }) + fld('recommendation', 'Recomendación final', { area: true, rows: 2, required: true, prefix: 'rv' }) + fld('evidence', 'Evidencias', { prefix: 'rv' }) + radios('decision', 'Decisión de la revisión', CAT.REVIEW_DECISIONS, '', { prefix: 'rv' }), 'Registrar revisión', 'Evalúa si la ejecución, el alcance, las condiciones y los resultados son conformes con lo autorizado.'));
  }
  if (iAmAssignee && r.status === 'En revisión' && r.reviews?.at(-1)?.round === r.implementation.rounds.length) forms.push(box('Cierre de la solicitud', 'act-close', radios('result', 'Resultado final', CAT.CLOSURE_RESULTS, r.reviews.at(-1).decision === 'Conforme' ? 'Exitoso' : '', { prefix: 'cz', descriptions: { 'Exitoso': 'Requiere revisión conforme.', 'Fallido': 'Exige justificación.', 'Incompleto': 'Exige justificación.' } }) + fld('summary', 'Resumen del trabajo', { area: true, required: true, rows: 2, prefix: 'cz' }) + fld('resultingVersion', 'Versión resultante', { prefix: 'cz', placeholder: 'MAJOR.MINOR.PATCH', hint: r.currentVersion && r.currentVersion !== 'No determinada' ? `Debe ser mayor que ${esc(r.currentVersion)}.` : '', attrs: versionAttr({ gt: r.currentVersion }) }) + fld('justification', 'Justificación del cierre', { area: true, rows: 2, prefix: 'cz' }) + fld('evidence', 'Evidencias', { prefix: 'cz' }), `${icon('flag')} Cerrar solicitud`, `Última revisión: ${esc(r.reviews.at(-1).decision)}. El resultado de autorización, el de implementación y el administrativo se guardan por separado.`));
  if (ccc && GH?.canCreateIssues) forms.push(box(r.github?.issue ? `Issue #${esc(r.github.issue.number)} de GitHub` : 'Issue de GitHub', 'act-issue', r.github?.issue ? `<p>Se actualiza sola con cada hito. Usa este botón si GitHub no respondió en algún momento.</p>` : `<p>${r.github?.lastSync?.message ? esc(r.github.lastSync.message) : 'Esta solicitud todavía no tiene issue.'}</p>`, r.github?.issue ? `${icon('git')} Sincronizar issue` : `${icon('git')} Crear issue`, `Repositorio ${esc(GH.repo)}. A GitHub solo se envían los datos del cambio, nunca el correo ni el nombre del solicitante.`));
  return forms.length ? card('Acciones disponibles', `<div class="action-grid">${forms.join('')}</div>`, { id: 'sec-actions', subtitle: `Tu rol: ${esc(ROLE[currentUser.role])}. El servidor valida cada transición.` }) : '';
}
function bindDetail(r) {
  const post = async (form, action, body, { confirm: confirmText, success } = {}) => {
    if (confirmText && !ask(confirmText)) return;
    const result = await saveAction(`/requests/${r.id}/${action}`, { ...body, revision: r.revision }, 'POST', form);
    if (result) { toast(success || 'Registro guardado.'); await detail(r.id); }
  };
  const simple = (sel, action, opts = {}, build = collect) => bindForm(sel, async form => { if (!validate(form, opts.errors?.(collect(form)) || {})) return; await post(form, action, build(form), opts); });
  simple('#act-receive', 'receive', { success: 'CRF recibido; en validación.' });
  simple('#act-validate', 'validate', { success: 'Análisis iniciado.' });
  simple('#act-info', 'request-info', { success: 'Información solicitada al iniciador.' });
  simple('#act-clarify', 'clarification', { success: 'Respuesta enviada al CCC.' });
  simple('#act-assign', 'assign', { confirm: '¿Registrar la asignación?', success: 'Asignación registrada.' });
  simple('#act-reevaluate', 'reevaluate', { confirm: 'La decisión vigente quedará sustituida. ¿Continuar?', success: 'Solicitud devuelta a evaluación.' });
  simple('#act-close-rejected', 'close-rejected', { confirm: '¿Cerrar administrativamente la solicitud rechazada?', success: 'Solicitud cerrada.' });
  simple('#act-reopen', 'reopen', { confirm: '¿Reabrir la solicitud? Volverá a análisis.', success: 'Solicitud reabierta.' });
  simple('#act-start', 'start', { success: 'Implementación iniciada.' });
  simple('#act-activity', 'activity', { success: 'Actividad registrada.' });
  simple('#act-module', 'module-change', { success: 'Modificación de módulo registrada.' });
  simple('#act-send', 'send-to-tests', { confirm: '¿Enviar a pruebas?', success: 'Enviada a pruebas.' });
  simple('#act-git', 'git', { success: GH?.configured ? 'Referencia verificada y registrada.' : 'Referencia registrada sin verificar.' });
  bindForm('#act-issue', async form => { const result = await saveAction(`/requests/${r.id}/github-issue`, {}, 'POST', form); if (result) { toast(`Issue #${result.request.github.issue.number} al día en GitHub.`); await detail(r.id); } });
  document.querySelectorAll('[data-git-refresh]').forEach(b => b.onclick = async () => { b.disabled = true; const result = await saveAction(`/requests/${r.id}/git-refresh`, { refId: b.dataset.gitRefresh, revision: r.revision }); b.disabled = false; if (result) { toast('Referencia consultada en GitHub.'); await detail(r.id); } });
  simple('#act-deviation', 'deviation', { success: 'Desviación registrada; espera decisión del CCC.' });
  simple('#act-test', 'test', { success: 'Prueba registrada.' });
  simple('#act-finish', 'finish-tests', { success: 'Resultado de pruebas registrado.', errors: d => d.outcome === 'Existen fallos' && !d.incident ? { 'fi-incident': 'Describe la incidencia.' } : {} });
  simple('#act-backout', 'backout', { confirm: '¿Registrar la ejecución del backout?', success: 'Backout documentado.' });
  simple('#act-review', 'review', { success: 'Revisión registrada.' }, form => {
    const d = collect(form), met = new Set(d.criteria || []), conds = new Set(d.conditionsMet || []);
    return { ...d, criteria: current.reviewCriteria.map((_, i) => ({ met: met.has(String(i)) })), conditions: (authorization(r)?.conditions || []).map(c => ({ id: c.id, met: conds.has(c.id), evidence: d[`cond-evidence-${c.id}`] || '' })) };
  });
  simple('#act-close', 'close', { confirm: 'El cierre es definitivo salvo reapertura del CCC. ¿Cerrar?', success: 'Solicitud cerrada.', errors: d => d.result && d.result !== 'Exitoso' && !d.justification ? { 'cz-justification': 'Justifica un cierre fallido o incompleto.' } : {} });
  for (const d of (r.deviations || []).filter(x => x.status === 'Pendiente')) simple(`#act-scope-${d.id}`, 'scope', { success: 'Decisión de alcance registrada.' });
  bindForm('#upload-form', async form => {
    let filesData; try { filesData = await readFiles(form.querySelector('#up-files')); } catch (e) { validate(form, { 'up-files': e.message }); return; }
    if (!filesData.length) { validate(form, { 'up-files': 'Selecciona al menos un archivo.' }); return; }
    const result = await saveAction(`/requests/${r.id}/attachments`, { files: filesData, context: r.ownerId === currentUser.id && r.status === 'Pendiente de información' ? 'Información adicional' : 'Evidencia' }, 'POST', form);
    if (result) { toast('Archivos adjuntados.'); await detail(r.id); }
  });
  const del = document.querySelector('#delete-request');
  if (del) del.onclick = () => { document.querySelector('#delete-description').textContent = `Se eliminará ${r.id}: ${r.title}. La eliminación queda registrada en la auditoría.`; document.querySelector('#delete-dialog').showModal(); };
}

// ---------- Seguimiento del cambio (desarrollador asignado, paso a paso) ----------
let workStep = null;
async function trabajo(id) {
  const seq = viewSeq;
  main.innerHTML = heading('Seguimiento del cambio', 'Cargando…');
  let loaded;
  try { loaded = await api(`/requests/${id}`); } catch (e) { if (!stale(seq)) main.innerHTML = heading('Solicitud no disponible', esc(e.message)); return; }
  if (stale(seq)) return;
  if (current?.request?.id !== loaded.request.id) workStep = null;
  current = loaded; renderTrabajo();
}
function workSteps(r) {
  const round = r.implementation?.rounds?.at(-1), started = !['Asignada', 'Correcciones requeridas'].includes(r.status);
  const sent = !!round?.sentToTestsAt && r.status !== 'En implementación';
  return [
    { key: 'inicio', title: 'Iniciar', icon: 'flag', done: started },
    { key: 'rama', title: 'Rama de trabajo', icon: 'git', done: !!r.workBranch },
    { key: 'desarrollo', title: 'Desarrollo', icon: 'edit', done: !!(round?.activities?.length && r.changes?.length) },
    { key: 'pr', title: 'Pull request', icon: 'send', done: !!r.pullRequest },
    { key: 'pruebas', title: 'Enviar a pruebas', icon: 'check', done: sent }
  ];
}
function renderTrabajo() {
  const { request: r } = current, assignee = lastAssignment(r), auth = authorization(r);
  if (!(isDeveloper() && assignee?.developerId === currentUser.id)) { main.innerHTML = heading('Seguimiento no disponible', 'Solo el desarrollador asignado puede llevar el seguimiento de la implementación.') + `<a class="btn" href="#detalle/${esc(r.id)}">Ver expediente</a>`; return; }
  const steps = workSteps(r), active = steps.find(x => !x.done) || steps.at(-1);
  const shown = steps.find(x => x.key === workStep) || active, idx = steps.indexOf(shown), activeIdx = steps.indexOf(active);
  const implementing = r.status === 'En implementación', round = r.implementation?.rounds?.at(-1), e = r.evaluation || {};
  const box = (id, content, button, note = '') => `<form id="${id}" class="step-form" novalidate>${note ? `<p class="hint">${note}</p>` : ''}${formAlert()}<div class="fields">${content}</div><div class="form-actions"><button class="btn primary" type="submit">${button}</button></div></form>`;
  const locked = msg => callout('info', msg);
  let body = '';
  if (shown.key === 'inicio') {
    body = `<div class="plan-grid"><div><h4>Plan de rollout aprobado</h4>${md(planText(e, 'rollout'))}</div><div><h4>Plan de backout</h4>${md(planText(e, 'backout'))}</div></div>${dl([['Módulos autorizados', moduleChips(current.authorizedModules), true], ['Decisión', `${esc(auth?.decision || '—')} · ${esc(auth?.decidedBy || '')}`], ['Fecha límite', (assignee.targetDate || e.deadline) ? dateLabel(assignee.targetDate || e.deadline) : '—'], auth?.conditions?.length && ['Condiciones del CCC', listHtml(auth.conditions.map(c => `${c.text} (verificación: ${c.verification})`)), true], assignee.notes && ['Observaciones del CCC', text(assignee.notes), true]])}` +
      (['Asignada', 'Correcciones requeridas'].includes(r.status) ? box('w-start', (auth?.conditions?.length ? check('conditionsAcknowledged', 'Leí las condiciones de aprobación y el plan aprobado', false, { prefix: 'ws' }) : '') + fld('note', 'Observación', { area: true, rows: 2, prefix: 'ws' }), `${icon('flag')} ${r.status === 'Asignada' ? 'Iniciar implementación' : 'Iniciar correcciones'}`, r.status === 'Correcciones requeridas' ? 'Las pruebas o la revisión pidieron correcciones: se abre una nueva ronda.' : '') : `<p class="hint">Ronda ${esc(round?.n)} iniciada el ${dateLabel(round?.startedAt, true)}.</p>`);
  } else if (shown.key === 'rama') {
    const b = r.workBranch, canCreate = !!GH?.canCreateIssues, base = b?.base || GH?.defaultBranch || 'main';
    body = `<p>Cada cambio se trabaja en su propia rama. El tipo de cambio define el prefijo: <code>feature/</code> para cambios normales y estándar, <code>hotfix/</code> para emergencias.</p>${b ? workSummary(r) : ''}` +
      (!implementing ? locked('Inicia la implementación para registrar la rama.') : r.pullRequest && r.pullRequest.state !== 'cerrado sin fusionar' ? locked('La rama ya tiene un pull request; no puede reemplazarse.') :
      box('w-branch', `<div class="field full"><label for="wb-name">Nombre de la rama <span class="required" aria-label="obligatorio">*</span></label><div class="branch-input"><span class="branch-prefix">${esc(branchPrefix(r))}</span><input id="wb-name" name="name" required maxlength="60" placeholder="validar-formularios" value="${esc(b?.label || '')}" aria-describedby="wb-name-error wb-name-hint"></div><small class="hint" id="wb-name-hint">${r.evaluation?.itilType === 'Emergencia' ? 'Cambio de emergencia: se trabaja como <strong>hotfix</strong>.' : `Cambio ${esc((r.evaluation?.itilType || 'normal').toLowerCase())}: se trabaja como <strong>feature</strong>.`} Escribe solo el nombre; el resto lo pone el sistema.</small><span class="error" id="wb-name-error"></span></div><div class="field full"><span class="field-label">Rama completa</span><code class="branch-preview" id="wb-preview">${esc(branchPrefix(r) + slug(b?.label || ''))}</code></div><p class="hint full">${GH?.configured ? (GH.canCreateIssues ? `Se crea en ${esc(GH.repo)} desde ${esc(GH.defaultBranch || 'main')}.` : `Debe existir en ${esc(GH.repo)} (el token no permite crearla).`) : 'GitHub no está configurado: la rama se registra sin verificar.'}</p>`, `${icon('git')} ${b ? 'Reemplazar rama' : 'Registrar rama'}`));
  } else if (shown.key === 'desarrollo') {
    const authorized = new Set(current.authorizedModules || []);
    body = `<h4>Actividades de la ronda ${esc(round?.n || '')}</h4>${table(['Actividad', 'Fecha', 'Descripción', 'Estado'], (round?.activities || []).map(a => [esc(a.id), dateLabel(a.date), esc(a.description), esc(a.status)]), 'Sin actividades todavía.')}<h4>Módulos modificados</h4>${table(['Módulo', 'Operación', 'Descripción', 'Alcance'], (r.changes || []).map(c => [esc(c.module), esc(c.operation), esc(c.description), c.inScope ? badge('Autorizada') : badge('No autorizada')]), 'Sin módulos registrados.')}` +
      (r.deviations?.some(d => d.status === 'Pendiente') ? callout('warn', 'Hay desviaciones de alcance pendientes de decisión del CCC.') : '') +
      (!implementing ? locked('Inicia la implementación para documentar el desarrollo.') : `<div class="action-grid">${box('w-activity', fld('description', 'Actividad realizada', { area: true, required: true, rows: 2, prefix: 'wa' }) + fld('status', 'Estado', { options: CAT.ACTIVITY_STATES, value: 'Completada', prefix: 'wa' }) + fld('evidence', 'Evidencia', { prefix: 'wa', placeholder: 'commit, archivo, enlace' }), 'Agregar actividad')}${box('w-module', fld('module', 'Módulo', { options: CAT.MODULES.filter(m => m !== 'No estoy seguro').map(m => [m, `${m}${authorized.has(m) ? '' : ' (no autorizado)'}`]), required: true, prefix: 'wm' }) + fld('operation', 'Operación', { options: CAT.OPERATIONS, required: true, prefix: 'wm' }) + fld('description', 'Descripción', { area: true, rows: 2, required: true, prefix: 'wm' }), 'Registrar módulo', 'Un módulo no autorizado genera una desviación que el CCC debe decidir.')}${box('w-git', fld('kind', 'Tipo', { options: CAT.GIT_KINDS.filter(k => !['Rama', 'Pull request'].includes(k)), required: true, value: 'Commit', prefix: 'wg' }) + fld('value', 'Referencia', { required: true, prefix: 'wg', placeholder: 'SHA del commit, tag…' }) + fld('url', 'Enlace', { type: 'url', prefix: 'wg' }), `${icon('git')} Registrar referencia`, GH?.configured ? `Se verifica en ${esc(GH.repo)}.` : 'Sin GitHub configurado: se registra sin verificar.')}${box('w-deviation', fld('description', 'Desviación de alcance', { area: true, rows: 2, required: true, prefix: 'wd' }), 'Registrar desviación')}</div>`);
  } else if (shown.key === 'pr') {
    const b = r.workBranch, pr = r.pullRequest;
    body = (b ? `<div class="flow-refs"><div class="ref-box">${icon('git')}<div><small>Desde (head)</small><code>${esc(b.name)}</code></div></div><div class="ref-arrow">${icon('arrow')}</div><div class="ref-box">${icon('layers')}<div><small>Hacia (base)</small><code>${esc(pr?.base || b.base)}</code></div></div></div>` : '') + (pr ? workSummary(r) + `<button class="btn" type="button" data-git-refresh-pr="${esc(r.gitRefs.find(g => g.kind === 'Pull request' && g.value === `#${pr.number}`)?.id || '')}">Verificar estado en GitHub</button>` : '') +
      (!implementing ? '' : !b ? locked('Registra primero la rama de trabajo.') :
      box('w-pr', radios('mode', 'Pull request', GH?.canCreateIssues ? ['Crear en GitHub', 'Registrar uno existente'] : ['Registrar uno existente'], GH?.canCreateIssues ? 'Crear en GitHub' : 'Registrar uno existente', { prefix: 'wp' }) + fld('base', 'Rama base (destino)', { value: pr?.base || b.base, required: true, prefix: 'wp' }) + fld('number', 'Número del PR existente', { prefix: 'wp', placeholder: '42', hint: 'Solo si registras uno existente; se comprueba que vaya de la rama de trabajo a la base.' }), `${icon('send')} ${pr ? 'Actualizar pull request' : 'Crear / registrar PR'}`, `Título: [${esc(r.id)}] ${esc(r.title)}. La descripción enlaza la issue y los criterios de aceptación.`));
  } else {
    const checks = [['Actividades en esta ronda', round?.activities?.length], ['Módulos modificados registrados', r.changes?.length], ['Rama de trabajo', r.workBranch], ['Pull request', r.pullRequest], ['Sin desviaciones pendientes', !r.deviations?.some(d => d.status === 'Pendiente')]];
    body = `<ul class="checklist">${checks.map(([label, ok]) => `<li class="${ok ? 'ok' : ''}">${icon(ok ? 'check' : 'close')} ${label}</li>`).join('')}</ul>` +
      (implementing ? box('w-send', fld('note', 'Observación', { area: true, rows: 2, prefix: 'wt' }), `${icon('send')} Enviar a pruebas`, 'Enviar a pruebas no es cerrar: otro desarrollador registrará las pruebas en el expediente.') : callout('ok', `Estado actual: <strong>${esc(r.status)}</strong>. Las pruebas, la revisión y el cierre continúan en el <a class="text-link" href="#detalle/${esc(r.id)}">expediente</a>.`));
  }
  main.innerHTML = heading(`Seguimiento · ${esc(r.id)}`, `${esc(r.title)} · ${badge(r.status)}`, `<a class="btn" href="#detalle/${esc(r.id)}">${icon('back')} Expediente</a>`) +
    `<ol class="stepper">${steps.map((x, i) => `<li class="${x.done ? 'done' : ''} ${x === shown ? 'shown' : ''} ${i > activeIdx ? 'locked' : ''}"><button type="button" data-step="${x.key}" ${i > activeIdx ? 'disabled' : ''}><span class="step-dot">${x.done ? icon('check') : i + 1}</span><span>${x.title}</span></button></li>`).join('')}</ol>` +
    card(`Paso ${idx + 1}. ${shown.title}`, body, { subtitle: { inicio: 'Revisa lo autorizado antes de empezar.', rama: 'Una rama por cambio, con nombre trazable al CRF.', desarrollo: 'Documenta el trabajo y los módulos que realmente tocaste.', pr: 'Al terminar, abre el PR de la rama de trabajo hacia la base acordada.', pruebas: 'Comprueba que todo esté listo y pasa el cambio a pruebas.' }[shown.key] }) +
    `<div class="step-nav">${idx > 0 ? `<button class="btn" type="button" data-step="${steps[idx - 1].key}">${icon('back')} Anterior</button>` : '<span></span>'}${idx < steps.length - 1 && idx < activeIdx ? `<button class="btn" type="button" data-step="${steps[idx + 1].key}">Siguiente ${icon('arrow')}</button>` : ''}</div>`;
  document.querySelectorAll('[data-step]').forEach(b => b.onclick = () => { workStep = b.dataset.step; renderTrabajo(); window.scrollTo(0, 0); });
  const post = async (form, action, body, msg, next) => { const result = await saveAction(`/requests/${r.id}/${action}`, { ...body, revision: r.revision }, 'POST', form); if (result) { toast(msg); workStep = next || null; await trabajo(r.id); } };
  bindForm('#w-start', form => validate(form) && post(form, 'start', collect(form), 'Implementación iniciada.', 'rama'));
  bindForm('#w-branch', form => validate(form) && post(form, 'branch', collect(form), 'Rama de trabajo registrada.', 'desarrollo'));
  const nameInput = document.querySelector('#wb-name');
  if (nameInput) nameInput.addEventListener('input', () => { document.querySelector('#wb-preview').textContent = branchPrefix(r) + slug(nameInput.value).slice(0, 60); });
  bindForm('#w-activity', form => validate(form) && post(form, 'activity', collect(form), 'Actividad registrada.', 'desarrollo'));
  bindForm('#w-module', form => validate(form) && post(form, 'module-change', collect(form), 'Módulo registrado.', 'desarrollo'));
  bindForm('#w-git', form => validate(form) && post(form, 'git', collect(form), 'Referencia registrada.', 'desarrollo'));
  bindForm('#w-deviation', form => validate(form) && post(form, 'deviation', collect(form), 'Desviación registrada; espera decisión del CCC.', 'desarrollo'));
  bindForm('#w-pr', form => {
    const d = collect(form), create = d.mode === 'Crear en GitHub';
    if (!validate(form, !create && !/^#?\d+$/.test(d.number || '') ? { 'wp-number': 'Indica el número del PR.' } : {})) return;
    return post(form, 'pull-request', { mode: create ? 'create' : 'link', base: d.base, number: d.number }, 'Pull request registrado.', 'pruebas');
  });
  bindForm('#w-send', form => ask('¿Enviar el cambio a pruebas?') && post(form, 'send-to-tests', collect(form), 'Enviado a pruebas.', 'pruebas'));
  document.querySelector('[data-git-refresh-pr]')?.addEventListener('click', async ev => { const refId = ev.currentTarget.dataset.gitRefreshPr; if (!refId) return; const result = await saveAction(`/requests/${r.id}/git-refresh`, { refId, revision: r.revision }); if (result) { toast('Estado del PR actualizado.'); await trabajo(r.id); } });
}

// ---------- Ficha única del CCC (secciones A–E) ----------
const suggestPriority = (impact, urgency) => { const s = CAT.IMPACT.indexOf(impact) + CAT.LEVELS.indexOf(urgency); return impact && urgency ? CAT.LEVELS[s <= 1 ? 0 : s === 2 ? 1 : s <= 4 ? 2 : 3] : ''; };
async function ficha(id) {
  const seq = viewSeq;
  main.innerHTML = heading('Ficha del CCC', 'Cargando…');
  let loaded;
  try { loaded = await api(`/requests/${id}`); } catch (e) { if (!stale(seq)) main.innerHTML = heading('Solicitud no disponible', esc(e.message)); return; }
  if (stale(seq)) return;
  current = loaded;
  const { request: r } = current, e = r.evaluation || {};
  if (!isCommittee() || r.ownerId === currentUser.id) { main.innerHTML = heading('Ficha no disponible', 'Solo el miembro autorizado del CCC, distinto del iniciador, puede evaluar esta solicitud.') + `<a class="btn" href="#detalle/${esc(r.id)}">Volver</a>`; return; }
  const editable = ['En análisis', 'En planificación', 'Pendiente de aprobación'].includes(r.status);
  const requested = new Set(r.modules || []), affected = new Map((e.affectedModules?.length ? e.affectedModules : (r.modules || []).filter(m => m !== 'No estoy seguro').map(module => ({ module, operation: r.modificationType || 'Modificación' }))).map(x => [x.module, x.operation]));
  const p = 'ev';
  const moduleRows = cardPicker({ group: 'affectedIds', id: 'ev-affectedModules', items: moduleItems(['No estoy seguro']), checked: i => affected.has(i.value), operation: i => affected.get(i.value), note: i => requested.has(i.value) ? 'Indicado por el solicitante' : '' });
  const auth = authorization(r);
  main.innerHTML = heading(`Ficha del CCC · ${esc(r.id)}`, `${esc(r.title)} · ${badge(r.status)}`, `<a class="btn" href="#detalle/${esc(r.id)}">${icon('back')} Expediente</a>`) + progress(r) +
    `<section class="card request-summary"><div class="summary-head"><h2>${icon('book')} Solicitud del iniciador</h2>${r.status !== 'Cerrada' ? `<a class="btn" href="#editar/${esc(r.id)}?desde=ficha">${icon('edit')} Corregir solicitud</a>` : ''}</div>${r.corrections?.length ? `<p class="hint">Corregida por el CCC ${r.corrections.length} ${r.corrections.length === 1 ? 'vez' : 'veces'}; los datos originales se conservan en el expediente.</p>` : '<p class="hint">Si falta información o algo es impreciso, corrígelo indicando el motivo; el original del solicitante se conserva.</p>'}${dl([['Solicitante', `${esc(r.name)} · ${r.requesterType === 'usuario' ? 'Usuario final' : 'Desarrollador'}`], ['Módulos indicados', moduleChips(r.modules)], ['Descripción', text(r.description), true], ['Justificación', text(r.justification), true], r.requesterType === 'experto' && ['Propuesta técnica', `${esc(r.modificationType)} · ${esc(r.environment)} · versión ${esc(r.currentVersion)} → ${esc(r.targetVersion || '—')} · prioridad propuesta ${esc(r.proposedPriority)}`, true], r.acceptanceCriteria?.length && ['Criterios de aceptación', listHtml(r.acceptanceCriteria), true]])}</section>` +
    `<form id="eval-form" class="form-layout" novalidate>${formAlert()}<fieldset ${editable ? '' : 'disabled'} class="plain-fieldset">
    ${section('A', 'Identificación y clasificación', `Miembro del CCC: ${esc(e.member || currentUser.name)} · inicio del análisis ${dateLabel(e.startedAt, true)}`, radios('itilType', 'Tipo de cambio ITIL', Object.keys(CAT.ITIL), e.itilType || r.proposedItilType, { prefix: p, descriptions: CAT.ITIL }) + (r.proposedItilType ? `<p class="hint full">Propuesto por el desarrollador: <strong>${esc(r.proposedItilType)}</strong>. Confírmalo o cámbialo.</p>` : '') + `<div id="standard-box" class="full fields">${fld('standardReference', 'Procedimiento estándar de referencia (CRF)', { value: e.standardReference, prefix: p, placeholder: 'CRF-000001', hint: 'Opcional: un cambio estándar cerrado con éxito cuya autorización se reutiliza.' })}${check('standardSameConditions', 'Corresponde exactamente al procedimiento aprobado y sus condiciones no cambiaron', e.standardSameConditions, { prefix: p })}<div class="field"><button class="btn" type="button" id="copy-standard">Copiar planes del procedimiento</button></div></div>` + `<div class="field full"><span class="field-label">Módulos afectados <span class="required">*</span></span><small class="hint">Confirma los módulos que indicó el solicitante (o corrígelos) e indica la operación prevista en cada uno.</small>${moduleRows}<span class="error" id="ev-affectedModules-error"></span></div>`)}
    ${section('B', 'Impacto y riesgos', 'Lo indispensable para priorizar el cambio. La viabilidad se decide en la sección D.', radios('impact', 'Impacto estimado', CAT.IMPACT, e.impact, { prefix: p }) + radios('urgency', 'Urgencia', CAT.LEVELS, e.urgency, { prefix: p }) + `<div class="field full">${radios('priority', 'Prioridad', CAT.LEVELS, e.priority, { prefix: p })}<small class="hint" id="priority-suggestion"></small></div>` + fld('functionalImpact', 'Impacto en los usuarios', { value: e.functionalImpact, area: true, rows: 2, prefix: p, hint: 'Opcional: venta de boletos, asientos, procesos de las cooperativas…' }) + fld('risks', 'Riesgos identificados', { value: e.risks, area: true, required: true, prefix: p, hint: 'Uno por línea.' }) + fld('resources', 'Recursos necesarios', { value: e.resources, area: true, rows: 2, prefix: p, hint: 'Opcional.' }) + fld('considerations', 'Consideraciones adicionales', { value: e.considerations, area: true, rows: 2, prefix: p }))}
    ${section('C', 'Planificación del cambio', 'Rollout, backout y fecha límite para el desarrollador. No es obligatoria para rechazar; sí para aprobar. En emergencia se admite una versión resumida.', mdField('rolloutPlan', 'Plan de rollout', planText(e, 'rollout') || ROLLOUT_TEMPLATE, 'Markdown: objetivo, actividades en orden, dependencias, responsables y cómo se verifica que terminó. Usa la vista previa para revisarlo.', p) + mdField('backoutPlan', 'Plan de backout', planText(e, 'backout') || BACKOUT_TEMPLATE, 'Markdown: cuándo se revierte, acciones de reversión, versión a recuperar, cuidado de los datos y verificación posterior.', p) + fld('deadline', 'Fecha límite de implementación', { value: e.deadline, type: 'date', min: today(), required: true, prefix: p, hint: 'Fecha en la que el desarrollador asignado debe terminar.' }))}
    </fieldset>${editable ? `<div class="form-actions sticky-actions"><button class="btn" type="submit" name="step" value="draft">${icon('save')} Guardar borrador</button>${r.status === 'En análisis' ? `<button class="btn primary" type="submit" name="step" value="analysis">Completar análisis</button>` : ''}<button class="btn primary" type="submit" name="step" value="planning">Completar análisis y planificación</button></div>` : ''}</form>
    ${section('D', 'Decisión y autorización', r.status === 'Pendiente de aprobación' ? 'Una única decisión oficial vigente; las anteriores se conservan.' : 'Aprobar requiere completar la planificación. Rechazar o pedir información está disponible durante la evaluación.', editable ? `<form id="decision-form" class="full fields" novalidate>${formAlert()}${radios('decision', 'Decisión', CAT.DECISIONS, '', { prefix: 'de', descriptions: { 'Aprobado': 'Autoriza la ejecución sin restricciones.', 'Aprobado con condiciones': 'Autoriza sujeto a condiciones verificables.', 'Rechazado': 'No se autoriza; exige motivo.', 'Más información': 'Devuelve al iniciador; no es un rechazo.' } })}<div id="feasibility-box" class="full" hidden>${radios('feasibility', 'Viabilidad técnica', CAT.FEASIBILITY, e.feasibility || '', { prefix: 'de', required: false, descriptions: { 'Viable': 'Se puede implementar como se planificó.', 'Viable con condiciones': 'Requiere ajustes o condiciones.', 'No viable': 'No puede aprobarse: se rechaza.' } })}</div><div id="reason-box" class="full" hidden>${fld('justification', 'Motivo', { area: true, prefix: 'de', hint: 'Lo verá el solicitante.' })}</div><div id="conditions-box" class="full" hidden>${fld('conditions', 'Condiciones (una por línea: condición | cómo se comprobará)', { area: true, rows: 3, prefix: 'de', placeholder: 'Respaldar la base antes de migrar | Evidencia del respaldo en la revisión' })}</div><div id="exception-box" class="full" hidden>${callout('danger', '<strong>No se puede aprobar:</strong> la viabilidad técnica es «No viable». Rechaza la solicitud.')}</div><div class="form-actions full"><button class="btn primary" type="submit">${icon('shield')} Registrar decisión</button></div></form>` : `<div class="full">${auth ? `<p><strong>Decisión vigente:</strong> ${esc(auth.decision)} · ${esc(auth.decidedBy)} · ${dateLabel(auth.at, true)}</p>` : '<p class="hint">Sin decisión vigente.</p>'}</div>`)}
    ${section('E', 'Asignación del desarrollador', 'Disponible después de aprobar, desde el expediente.', `<div class="full">${(r.assignments || []).length ? `<p>Responsable vigente: <strong>${esc(lastAssignment(r)?.developerName || 'ninguno')}</strong></p>` : '<p class="hint">Sin asignación.</p>'}<a class="btn" href="#detalle/${esc(r.id)}">Ir al expediente para asignar</a></div>`)}`;
  const form = document.querySelector('#eval-form');
  const refreshUi = () => {
    const d = collect(form);
    document.querySelector('#standard-box').hidden = d.itilType !== 'Estándar';
    const s = suggestPriority(d.impact, d.urgency);
    document.querySelector('#priority-suggestion').textContent = s ? `Sugerencia orientativa según impacto y urgencia: ${s}. El CCC decide la prioridad.` : '';
    const dec = document.querySelector('#decision-form');
    if (dec) {
      const dd = collect(dec), v = dd.decision, approving = !!v?.startsWith('Aprobado'), blocked = approving && dd.feasibility === 'No viable';
      document.querySelector('#feasibility-box').hidden = !approving;
      document.querySelector('#reason-box').hidden = !['Rechazado', 'Más información'].includes(v);
      const reasonLabel = dec.querySelector('label[for="de-justification"]');
      if (reasonLabel) reasonLabel.innerHTML = `${v === 'Más información' ? 'Información que falta' : 'Motivo del rechazo'} <span class="required" aria-label="obligatorio">*</span>`;
      document.querySelector('#conditions-box').hidden = v !== 'Aprobado con condiciones';
      document.querySelector('#exception-box').hidden = !blocked;
      const submit = dec.querySelector('button[type="submit"]'); if (submit) submit.disabled = blocked;
      const radio = dec.querySelector('#de-feasibility');
      if (radio) { if (blocked) markField(dec, radio, 'Un cambio no viable no puede aprobarse.'); else if (radio.getAttribute('aria-invalid') === 'true') clearField(dec, radio); }
    }
  };
  form.addEventListener('change', refreshUi); document.querySelector('#decision-form')?.addEventListener('change', refreshUi); bindPickers(); bindMarkdown(); refreshUi();
  const evalBody = () => {
    const d = collect(form), chosenModules = d.affectedIds || [];
    const ops = Object.fromEntries([...form.querySelectorAll('[data-op-for]')].map(sel => [sel.dataset.opFor, sel.value]));
    const body = { ...d, affectedModules: chosenModules.map(module => ({ module, operation: ops[module] || 'Modificación' })) };
    for (const k of Object.keys(body)) if (k.startsWith('op-') || k === 'affectedIds') delete body[k];
    return body;
  };
  document.querySelector('#copy-standard').onclick = async () => {
    const ref = collect(form).standardReference;
    if (!ref) { toast('Indica el CRF de referencia.', true); return; }
    try {
      const src = (await api(`/requests/${encodeURIComponent(ref.toUpperCase())}`)).request.evaluation || {};
      for (const kind of ['rollout', 'backout']) { const el = form.querySelector(`#${p}-${kind}Plan`), text = planText(src, kind); if (el && text) el.value = text; }
      toast('Planes copiados del procedimiento de referencia. Revísalos antes de guardar.');
    } catch (err) { toast(err.message, true); }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    const step = event.submitter?.value || 'draft';
    const vErr = fieldError(form.querySelector(`#${p}-targetVersion`));
    if (vErr) { validate(form, { [`${p}-targetVersion`]: vErr }); return; }
    const result = await saveAction(`/requests/${r.id}/evaluation`, { ...evalBody(), step, revision: r.revision }, 'POST', form);
    if (result) { toast({ draft: 'Borrador guardado: no se marca como completado.', analysis: 'Análisis completado; continúa con la planificación.', planning: 'Ficha completa: pendiente de decisión.' }[step]); await ficha(r.id); }
  };
  bindForm('#decision-form', async dec => {
    const d = collect(dec), errors = {};
    if (d.decision === 'Aprobado con condiciones' && !d.conditions) errors['de-conditions'] = 'Indica al menos una condición.';
    if (d.decision?.startsWith('Aprobado') && !d.feasibility) errors['de-feasibility'] = 'Indica la viabilidad técnica.';
    if (['Rechazado', 'Más información'].includes(d.decision) && (d.justification || '').length < 10) errors['de-justification'] = 'Escribe al menos 10 caracteres.';
    if (!validate(dec, errors)) return;
    const conditions = d.decision === 'Aprobado con condiciones' ? d.conditions.split(/\n+/).map(l => l.trim()).filter(Boolean).map(l => { const [textValue, verification] = l.split('|').map(x => (x || '').trim()); return { text: textValue, verification }; }) : [];
    if (conditions.some(c => !c.verification)) { validate(dec, { 'de-conditions': 'Cada condición necesita «| cómo se comprobará».' }); return; }
    if (!ask(`¿Registrar la decisión «${d.decision}»? Quedará en el historial y no podrá borrarse.`)) return;
    const result = await saveAction(`/requests/${r.id}/decision`, { decision: d.decision, feasibility: d.feasibility, justification: d.justification, conditions, revision: r.revision }, 'POST', dec);
    if (result) { toast('Decisión registrada.'); location.hash = `detalle/${r.id}`; }
  });
}

// ---------- Auditoría y reportes ----------
async function auditView() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  main.innerHTML = heading('Auditoría', 'Eventos persistentes de solo inserción: quién, qué, cuándo, estado anterior y nuevo.') + `<section class="card"><form id="audit-filter" class="toolbar"><select name="action" aria-label="Tipo de evento">${options(['Rama de trabajo', 'Pull request', 'Registro de referencia Git', 'Registro de módulo modificado', 'Desviación de alcance', 'Aprobación', 'Rechazo', 'Asignación', 'Cierre', 'Corrección del CCC'], params.get('action') || '', 'Todos los eventos')}</select><div class="search">${icon('search')}<input name="entityId" type="search" aria-label="Código del CRF" placeholder="Código del CRF (p. ej. CRF-000006)" value="${esc(params.get('entityId') || '')}"></div><button class="btn" type="submit">Filtrar</button></form><div id="audit-results"><p class="hint">Cargando…</p></div></section>`;
  bindForm('#audit-filter', form => { const d = collect(form); location.hash = `auditoria?${new URLSearchParams(Object.entries(d).filter(([, v]) => v))}`; });
  const seq = viewSeq;
  try { const { events } = await api(`/audit?${params}`); if (stale(seq)) return; document.querySelector('#audit-results').innerHTML = auditTable(events) + `<div class="table-foot"><span>${events.length} eventos (máximo 300)</span></div>`; }
  catch (e) { document.querySelector('#audit-results').innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}
const bars = (title, items) => `<section class="card chart-card"><h3>${esc(title)}</h3>${items.length ? `<ul class="bars">${items.map(i => { const max = Math.max(...items.map(x => x.value)); return `<li><span class="bar-label">${esc(i.label)}</span><span class="bar-track"><span class="bar-fill" style="width:${Math.max(4, i.value / max * 100)}%"></span></span><span class="bar-value">${i.value}</span></li>`; }).join('')}</ul>` : '<p class="hint">Sin datos.</p>'}</section>`;
async function reports() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  main.innerHTML = heading('Reportes de estado', 'Indicadores calculados con los datos almacenados.') + '<p class="hint">Cargando…</p>';
  const seq = viewSeq;
  let rep; try { rep = await api(`/reports?${params}`); } catch (e) { if (!stale(seq)) main.innerHTML += `<p class="error">${esc(e.message)}</p>`; return; }
  if (stale(seq)) return;
  const c = rep.counts, m = rep.metrics, f = rep.filters, days = v => v === null ? 'Sin datos' : `${v} días`, pct = v => v === null ? 'Sin datos' : `${v} %`;
  main.innerHTML = heading('Reportes de estado', `${rep.total} solicitudes con los filtros actuales.`, `<div class="actions" style="margin:0"><a class="btn" href="/api/reports.csv?${esc(params.toString())}">${icon('save')} Exportar CSV</a><button class="btn" type="button" id="print-report">Imprimir</button></div>`) +
    `<section class="card"><form id="report-filter" class="toolbar wrap">${fld('from', 'Desde', { type: 'date', value: f.from, prefix: 'rp' })}${fld('to', 'Hasta', { type: 'date', value: f.to, prefix: 'rp' })}${fld('status', 'Estado', { options: CAT.STATES, value: f.status, prefix: 'rp' })}${fld('itilType', 'Tipo ITIL', { options: [...Object.keys(CAT.ITIL), 'Sin clasificar'], value: f.itilType, prefix: 'rp' })}${fld('priority', 'Prioridad', { options: [...CAT.LEVELS, 'Sin definir'], value: f.priority, prefix: 'rp' })}${fld('module', 'Módulo', { options: CAT.MODULES, value: f.module, prefix: 'rp' })}${fld('developer', 'Desarrollador', { options: TEAM.filter(u => u.role === 'experto').map(u => [u.id, u.name]), value: f.developer, prefix: 'rp' })}${fld('requester', 'Solicitante', { value: f.requester, prefix: 'rp' })}${fld('result', 'Resultado', { options: [...CAT.CLOSURE_RESULTS, 'Cerrada por rechazo', 'Sin cierre'], value: f.result, prefix: 'rp' })}<div class="form-actions full"><button class="btn primary" type="submit">Aplicar filtros</button><a class="btn" href="#reportes">Limpiar</a></div></form></section>` +
    statTiles([['Total', c.total, `${c.open} abiertas`, 'book'], ['Pendientes de análisis', c.pendingAnalysis, `${c.pendingInfo} esperan información`, 'search'], ['Pendientes de aprobación', c.pendingApproval, '', 'shield'], ['Aprobadas sin asignar', c.approved, '', 'check'], ['Rechazadas', c.rejected, '', 'close'], ['En implementación', c.implementing, '', 'git'], ['En pruebas', c.testing, `${c.reviewing} en revisión`, 'list'], ['Cerradas', c.closed, `${c.success} exitosas · ${c.failed} fallidas · ${c.incomplete} incompletas`, 'flag']]) +
    statTiles([['Solicitud → decisión', days(m.avgDecisionDays), `Promedio de ${m.decided} decididas`, 'clock'], ['Implementación', days(m.avgImplementationDays), 'Inicio → envío a pruebas', 'clock'], ['Solicitud → cierre', days(m.avgClosureDays), 'Promedio', 'clock'], ['Aprobadas', pct(m.approvedPct), 'Sobre las decididas', 'check'], ['Rechazadas', pct(m.rejectedPct), 'Sobre las decididas', 'close'], ['Cambios exitosos', pct(m.successPct), `Sobre ${m.closedWithImplementation} cierres con implementación`, 'flag']]) +
    `<div class="chart-grid">${bars('Por tipo ITIL', rep.groups.itilType)}${bars('Por prioridad', rep.groups.priority)}${bars('Por estado', rep.groups.status)}${bars('Por módulo', rep.groups.module)}${bars('Por desarrollador', rep.groups.developer)}${bars('Resultados de implementación', rep.groups.result)}${bars('Solicitudes por mes', rep.groups.month)}</div>` +
    card('Solicitudes del reporte', table(['Código', 'Título', 'Módulos', 'Estado', 'Tipo ITIL', 'Prioridad', 'Desarrollador', 'Decisión', 'Resultado', 'Issue'], rep.rows.map(x => [`<a class="code" href="#detalle/${esc(x.id)}">${esc(x.id)}</a>`, esc(x.title), esc(x.modules.join(', ')), badge(x.status), esc(x.itilType), priority(x.priority), esc(x.developer), esc(x.decision), esc(x.result), esc(x.issue || '—')]), 'Sin solicitudes para estos filtros.'));
  bindForm('#report-filter', form => { location.hash = `reportes?${new URLSearchParams(Object.entries(collect(form)).filter(([, v]) => v))}`; });
  document.querySelector('#print-report').onclick = () => window.print();
}

// ---------- Enrutador ----------
function route() {
  if (!CAT) return;
  viewSeq++;
  const [path] = location.hash.slice(1).split('?');
  const [view = 'panel', id] = path.split('/');
  document.querySelectorAll('[data-nav]').forEach(a => { const active = a.dataset.nav === ({ detalle: 'solicitudes', editar: 'solicitudes', ficha: 'solicitudes', trabajo: 'solicitudes' }[view] || view); a.classList.toggle('active', active); if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (!currentUser) {
    if (view === 'nueva') requestForm(null, 'usuario');
    else if (view === 'seguimiento') tracking();
    else { if (view !== 'login') window.history?.replaceState?.(null, '', '#login'); loginScreen(); }
  } else if (view === 'solicitudes') listing();
  else if (view === 'nueva') requestForm(null, currentUser.role);
  else if (view === 'editar') { const r = store.requests.find(x => x.id === id); if (r && ((r.ownerId === currentUser.id && r.status === 'Registrada') || (isCommittee() && r.ownerId !== currentUser.id && r.status !== 'Cerrada'))) requestForm(r); else main.innerHTML = heading('Petición bloqueada', 'El solicitante solo puede editarla antes de que el CCC la reciba; el CCC puede corregirla mientras no esté cerrada.') + `<a class="btn" href="#detalle/${esc(id || '')}">Volver</a>`; }
  else if (view === 'detalle' && id) detail(id);
  else if (view === 'ficha' && id) ficha(id);
  else if (view === 'trabajo' && id) trabajo(id);
  else if (view === 'auditoria') auditView();
  else if (view === 'reportes') reports();
  else if (view === 'seguimiento') tracking();
  else dashboard();
  window.scrollTo(0, 0); main.focus({ preventScroll: true });
}
document.querySelector('#delete-dialog').addEventListener('close', async event => {
  if (event.target.returnValue === 'delete' && current?.request) {
    const r = current.request;
    if (await saveAction(`/requests/${r.id}`, { revision: r.revision }, 'DELETE')) { toast('Solicitud eliminada. El evento queda en la auditoría.'); location.hash = 'solicitudes'; }
  }
  event.target.returnValue = '';
});
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
// Validación en vivo: al salir de un campo se marca en rojo si está mal; al corregirlo se limpia.
document.addEventListener('focusout', event => { const el = event.target; if (!el?.form || !el.id || !el.name || el.type === 'radio') return; const message = fieldError(el); if (message) markField(el.form, el, message); else if (el.getAttribute('aria-invalid') === 'true') clearField(el.form, el); });
document.addEventListener('input', event => { const el = event.target; if (el?.form && el.getAttribute?.('aria-invalid') === 'true' && !fieldError(el)) clearField(el.form, el); });
document.addEventListener('change', event => { const el = event.target; if (el?.type === 'radio' && el.form) { const first = el.form.querySelector(`#${el.dataset.err}`); if (first?.getAttribute('aria-invalid') === 'true' && el.form.querySelector(`#${el.dataset.err}-error`)?.textContent === 'Selecciona una opción.') clearField(el.form, first); } });
window.addEventListener('hashchange', () => { route(); refreshPanel(); });
window.addEventListener('focus', refreshPanel);
document.addEventListener('visibilitychange', refreshPanel);
setInterval(refreshPanel, 15000);
bootstrap();

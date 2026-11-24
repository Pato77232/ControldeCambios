'use strict';
// Integración con GitHub (API REST v3).
// - Verifica que las ramas, commits, pull requests y tags registrados existan en el repositorio de BusesUTA.
// - Crea una issue cuando el CCC aprueba el CRF (como un ticket) y la mantiene sincronizada: etiquetas de
//   estado, responsable asignado, comentarios en los hitos y cierre de la issue cuando el CRF se cierra.
// - Crea la rama de trabajo y el pull request del cambio, o verifica los existentes.
// Configuración (.env): GITHUB_REPO=propietario/repositorio, GITHUB_TOKEN (opcional para repos públicos;
// obligatorio para crear issues), GITHUB_API_URL (por defecto https://api.github.com).
// A GitHub solo se envían datos del cambio: nunca correos ni nombres de solicitantes.

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const STATUS_LABEL_PREFIX = 'estado: ';

function createGithub({ repo = '', token = '', apiUrl = 'https://api.github.com', fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  repo = String(repo || '').trim();
  const configured = REPO_RE.test(repo);
  const base = String(apiUrl || 'https://api.github.com').replace(/\/+$/, '');
  let statusCache = null;

  async function call(path, { method = 'GET', body } = {}) {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'changeflow-uta' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    try {
      const res = await fetchImpl(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
      const data = res.status === 204 ? null : await res.json().catch(() => null);
      return { status: res.status, data, rateLimited: res.headers?.get?.('x-ratelimit-remaining') === '0' };
    } catch (error) {
      return { status: 0, data: null, error: error.name === 'TimeoutError' ? 'GitHub no respondió a tiempo.' : 'No se pudo conectar con GitHub.' };
    }
  }
  const repoPath = `/repos/${repo}`;
  const failure = (res, notFound) => {
    if (res.status === 404) return { checked: true, ok: false, status: 'no encontrada', message: notFound };
    if (res.status === 401) return { checked: true, ok: false, status: 'error', message: 'GitHub rechazó el token (GITHUB_TOKEN inválido o vencido).' };
    if (res.status === 403 || res.status === 429) return { checked: true, ok: false, status: 'error', message: res.rateLimited ? 'Se alcanzó el límite de consultas de la API de GitHub. Configura GITHUB_TOKEN o espera unos minutos.' : 'El token no tiene permisos suficientes en el repositorio.' };
    if (res.status === 422) return { checked: true, ok: false, status: 'error', message: res.data?.message || 'GitHub rechazó los datos enviados.' };
    return { checked: true, ok: false, status: 'error', message: res.error || `GitHub respondió con el estado ${res.status}.` };
  };
  const at = () => new Date().toISOString();

  // Extrae propietario/repositorio y el objeto de una URL de github.com.
  function parseUrl(url) {
    if (!url) return null;
    let u; try { u = new URL(url); } catch { return null; }
    if (!/(^|\.)github\.com$/i.test(u.hostname)) return null;
    const [owner, name, type, ...rest] = u.pathname.split('/').filter(Boolean);
    if (!owner || !name) return null;
    return { repo: `${owner}/${name}`, type, rest };
  }

  async function verify(kind, value, url) {
    if (!configured) return { checked: false, ok: false, status: 'sin configurar', message: 'GitHub no está configurado (GITHUB_REPO); la referencia se registra sin verificar.', at: at() };
    if (kind === 'Enlace de evidencia') return { checked: false, ok: false, status: 'no aplica', message: 'Los enlaces de evidencia no se verifican.', at: at() };
    const parsed = parseUrl(url);
    if (parsed && parsed.repo.toLowerCase() !== repo.toLowerCase()) return { checked: true, ok: false, status: 'otro repositorio', message: `El enlace apunta a ${parsed.repo}, pero el repositorio configurado es ${repo}.`, at: at() };
    let res, details;
    if (kind === 'Repositorio') {
      res = await call(repoPath);
      if (res.status === 200) details = { fullName: res.data.full_name, defaultBranch: res.data.default_branch, private: res.data.private, url: res.data.html_url };
    } else if (kind === 'Rama') {
      res = await call(`${repoPath}/branches/${encodeURIComponent(value)}`);
      if (res.status === 200) details = { sha: res.data.commit?.sha, url: res.data._links?.html || `https://github.com/${repo}/tree/${value}`, protected: !!res.data.protected };
    } else if (kind === 'Commit') {
      res = await call(`${repoPath}/commits/${encodeURIComponent(value)}`);
      if (res.status === 200) details = { sha: res.data.sha, message: String(res.data.commit?.message || '').split('\n')[0].slice(0, 200), author: res.data.commit?.author?.name || '', date: res.data.commit?.author?.date || '', url: res.data.html_url };
    } else if (kind === 'Pull request') {
      const number = (/^#?(\d+)$/.exec(value) || /\/pull\/(\d+)/.exec(parsed ? `/${parsed.type}/${parsed.rest.join('/')}` : ''))?.[1];
      if (!number) return { checked: false, ok: false, status: 'error', message: 'No se pudo determinar el número del pull request.', at: at() };
      res = await call(`${repoPath}/pulls/${number}`);
      if (res.status === 200) details = pullDetails(res.data);
    } else if (kind === 'Versión o tag') {
      res = await call(`${repoPath}/git/ref/tags/${encodeURIComponent(value)}`);
      if (res.status === 200) details = { sha: res.data.object?.sha, url: `https://github.com/${repo}/releases/tag/${encodeURIComponent(value)}` };
    } else return { checked: false, ok: false, status: 'no aplica', message: 'Tipo de referencia no verificable.', at: at() };
    if (details) return { checked: true, ok: true, status: 'verificada', message: `Verificada en ${repo}.`, details, at: at() };
    return { ...failure(res, `${kind} «${value}» no existe en ${repo}.`), at: at() };
  }

  // Crea la rama de trabajo desde la rama base (o confirma que ya existe).
  async function createBranch(name, base) {
    if (!configured || !token) return { checked: false, ok: false, status: 'sin configurar', message: 'Para crear ramas configura GITHUB_REPO y GITHUB_TOKEN.', at: at() };
    const existing = await call(`${repoPath}/branches/${encodeURIComponent(name)}`);
    if (existing.status === 200) return { checked: true, ok: true, created: false, status: 'verificada', message: `La rama ya existía en ${repo}.`, details: { sha: existing.data.commit?.sha, url: `https://github.com/${repo}/tree/${name}` }, at: at() };
    const ref = await call(`${repoPath}/git/ref/heads/${base.split('/').map(encodeURIComponent).join('/')}`);
    if (ref.status !== 200) return { ...failure(ref, `La rama base «${base}» no existe en ${repo}.`), field: 'base', at: at() };
    const created = await call(`${repoPath}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${name}`, sha: ref.data.object?.sha } });
    if (created.status === 201) return { checked: true, ok: true, created: true, status: 'verificada', message: `Rama creada en ${repo} desde ${base}.`, details: { sha: ref.data.object?.sha, url: `https://github.com/${repo}/tree/${name}` }, at: at() };
    const f = failure(created, 'No se pudo crear la rama.');
    return { ...f, message: created.status === 403 ? 'El token no puede crear ramas: dale el permiso «Contents: Read and write».' : f.message, at: at() };
  }
  // Crea el pull request de la rama de trabajo hacia la base (o reutiliza uno abierto con la misma dirección).
  async function createPull({ head, base, title, body }) {
    if (!configured || !token) return { checked: false, ok: false, status: 'sin configurar', message: 'Para crear pull requests configura GITHUB_REPO y GITHUB_TOKEN.', at: at() };
    const owner = repo.split('/')[0];
    const open = await call(`${repoPath}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}&base=${encodeURIComponent(base)}`);
    if (open.status === 200 && Array.isArray(open.data) && open.data.length) return { checked: true, ok: true, created: false, status: 'verificada', message: `Ya existía el PR #${open.data[0].number} de ${head} a ${base}.`, details: pullDetails(open.data[0]), at: at() };
    const res = await call(`${repoPath}/pulls`, { method: 'POST', body: { title: title.slice(0, 250), head, base, body: body.slice(0, 60000) } });
    if (res.status === 201) return { checked: true, ok: true, created: true, status: 'verificada', message: `PR #${res.data.number} creado de ${head} a ${base}.`, details: pullDetails(res.data), at: at() };
    const detail = res.data?.errors?.map(e => e.message).filter(Boolean).join(' ') || '';
    const message = res.status === 403 ? 'El token no puede crear pull requests: dale el permiso «Pull requests: Read and write».'
      : /No commits between/i.test(detail) ? `La rama ${head} no tiene commits nuevos respecto de ${base}: sube tus cambios antes de crear el PR.`
      : detail || failure(res, 'No se pudo crear el pull request.').message;
    return { checked: true, ok: false, status: 'error', message, at: at() };
  }
  async function status() {
    if (!configured) return { configured: false, repo: repo || null, canCreateIssues: false, message: 'Define GITHUB_REPO=propietario/repositorio en .env para activar la integración.' };
    if (statusCache && Date.now() - statusCache.time < 60000) return statusCache.value;
    const res = await call(repoPath);
    const value = res.status === 200
      ? { configured: true, repo, reachable: true, private: res.data.private, defaultBranch: res.data.default_branch, url: res.data.html_url, tokenConfigured: !!token, canCreateIssues: !!token && res.data.has_issues !== false && (res.data.permissions ? !!(res.data.permissions.push || res.data.permissions.triage || res.data.permissions.maintain || res.data.permissions.admin) : true), issuesEnabled: res.data.has_issues !== false, message: `Conectado a ${repo}.` }
      : { configured: true, repo, reachable: false, tokenConfigured: !!token, canCreateIssues: false, message: failure(res, `El repositorio ${repo} no existe o es privado (configura GITHUB_TOKEN).`).message };
    statusCache = { time: Date.now(), value };
    return value;
  }

  // ---------- Issues ----------
  const statusLabel = s => `${STATUS_LABEL_PREFIX}${s.toLowerCase()}`;
  function issueBody(r, appUrl) {
    const e = r.evaluation || {};
    const lines = [
      `> Solicitud de cambio **${r.id}** registrada en el Sistema de Control de Cambios (Transviajes).`,
      `> El estado oficial y la autorización se gestionan en ese sistema; esta issue es su ticket de trabajo.`,
      '',
      `| Campo | Valor |`, `|---|---|`,
      `| Código | ${r.id} |`, `| Origen | ${r.requesterType === 'experto' ? 'Desarrollador (CRF técnico)' : 'Usuario final'} |`,
      `| Módulos afectados | ${(r.modules || []).join(', ')} |`, `| Fecha | ${r.date} |`,
      ...(r.requesterType === 'experto' ? [`| Tipo de modificación | ${r.modificationType || '—'} |`, `| Entorno | ${r.environment || '—'} |`, `| Versión actual → propuesta | ${r.currentVersion || '—'} → ${r.targetVersion || '—'} |`] : []),
      ...(e.itilType ? [`| Tipo ITIL | ${e.itilType} |`, `| Prioridad | ${e.priority || '—'} |`] : []),
      '', '### Situación actual', r.currentBehavior || '—', '', '### Cambio solicitado', r.description || '—', '', '### Justificación', r.justification || '—', '', '### Resultado esperado', r.result || '—',
      ...(r.acceptanceCriteria?.length ? ['', '### Criterios de aceptación', ...r.acceptanceCriteria.map(c => `- [ ] ${c}`)] : []),
      ...(appUrl ? ['', `[Abrir el expediente ${r.id}](${appUrl.replace(/\/+$/, '')}/#detalle/${r.id})`] : [])
    ];
    return lines.join('\n').slice(0, 60000);
  }
  const issueRef = d => ({ number: d.number, url: d.html_url, state: d.state, repo, createdAt: d.created_at });
  async function createIssue(r, appUrl) {
    if (!configured || !token) return { ok: false, message: 'Para crear issues configura GITHUB_REPO y GITHUB_TOKEN.' };
    const res = await call(`${repoPath}/issues`, { method: 'POST', body: { title: `[${r.id}] ${r.title}`.slice(0, 250), body: issueBody(r, appUrl), labels: ['control-de-cambios', statusLabel(r.status), ...(r.modules || []).filter(m => m !== 'No estoy seguro').map(m => `módulo: ${m.toLowerCase()}`).slice(0, 5)] } });
    if (res.status === 201) return { ok: true, issue: issueRef(res.data), message: `Issue #${res.data.number} creada.` };
    return { ok: false, message: failure(res, `No se encontró el repositorio ${repo}.`).message };
  }
  // Sincroniza la etiqueta de estado, la abre o cierra y comenta el último hito del historial.
  async function syncIssue(r, { comment = '', assignees = null } = {}) {
    const issue = r.github?.issue;
    if (!configured || !token || !issue) return { ok: false, message: 'La solicitud no tiene una issue asociada o falta GITHUB_TOKEN.' };
    const current = await call(`${repoPath}/issues/${issue.number}`);
    if (current.status !== 200) return { ok: false, message: failure(current, `La issue #${issue.number} ya no existe en ${repo}.`).message };
    const labels = (current.data.labels || []).map(l => typeof l === 'string' ? l : l.name).filter(l => !l.startsWith(STATUS_LABEL_PREFIX));
    const closed = r.status === 'Cerrada';
    const reason = closed ? (r.closure?.result === 'Exitoso' ? 'completed' : 'not_planned') : undefined;
    const body = { labels: [...labels, statusLabel(r.status)], state: closed ? 'closed' : 'open', ...(reason ? { state_reason: reason } : {}), ...(assignees ? { assignees } : {}) };
    let update = await call(`${repoPath}/issues/${issue.number}`, { method: 'PATCH', body });
    let warning = '';
    // Si GitHub no acepta al responsable (no es colaborador), se actualiza el resto y se informa.
    if (update.status === 422 && assignees) { delete body.assignees; update = await call(`${repoPath}/issues/${issue.number}`, { method: 'PATCH', body }); warning = ` No se pudo asignar a ${assignees.join(', ')}: debe ser colaborador del repositorio.`; }
    if (update.status !== 200) return { ok: false, message: failure(update, 'No se pudo actualizar la issue.').message };
    if (comment) {
      const c = await call(`${repoPath}/issues/${issue.number}/comments`, { method: 'POST', body: { body: comment.slice(0, 60000) } });
      if (c.status !== 201) return { ok: false, issue: issueRef(update.data), message: failure(c, 'No se pudo comentar la issue.').message };
    }
    return { ok: !warning, issue: issueRef(update.data), message: `Issue #${issue.number} sincronizada (${statusLabel(r.status)}).${warning}` };
  }
  return { configured, repo, verify, status, createIssue, syncIssue, createBranch, createPull, canIssue: () => configured && !!token };
}
// Comentario para la issue a partir del último evento del historial (sin datos personales del solicitante).
const MILESTONES = ['Rama de trabajo', 'Pull request', 'Recepción del CRF', 'Inicio del análisis', 'Solicitud de información adicional', 'Respuesta del iniciador', 'Planificación completada', 'Aprobación', 'Aprobación condicionada', 'Rechazo', 'Reevaluación', 'Asignación', 'Reasignación', 'Inicio de implementación', 'Inicio de correcciones', 'Envío a pruebas', 'Resultado de pruebas', 'Revisión postimplementación', 'Cierre', 'Cierre administrativo', 'Reapertura', 'Decisión de alcance'];
function pullDetails(d) {
  return { number: d.number, title: String(d.title || '').slice(0, 200), state: d.merged_at ? 'fusionado' : d.state === 'open' ? (d.draft ? 'borrador' : 'abierto') : 'cerrado sin fusionar', merged: !!d.merged_at, mergedAt: d.merged_at, head: d.head?.ref, base: d.base?.ref, url: d.html_url };
}
function milestoneComment(r, before) {
  const events = r.history.slice(before).filter(h => MILESTONES.includes(h.action));
  if (!events.length) return '';
  return events.map(h => `**${h.action}** · ${h.from && h.from !== h.status ? `${h.from} → ` : ''}${h.status}${h.responsibleId ? ` · ${h.responsible}` : ''}\n\n${String(h.note || '').slice(0, 2000)}`).join('\n\n---\n\n');
}
module.exports = { createGithub, milestoneComment, MILESTONES };

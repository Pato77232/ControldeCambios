'use strict';
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { openDatabase, transaction } = require('./database.cjs');
const { publicUser, verifyPassword, hashPassword, seedUsers, createSession, getSession } = require('./auth.cjs');
const S = require('./service.cjs');
const { createGithub, milestoneComment } = require('./github.cjs');
const R = require('./reports.cjs');
const C = require('./catalog.cjs');
const { listAudit } = require('./audit.cjs');
const { HttpError, fail } = S;

const ROOT = path.resolve(__dirname, '..');
const STATIC = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/wireframe.html', 'wireframe.html'], ['/js/app.js', 'js/app.js'], ['/js/print.js', 'js/print.js'], ['/css/styles.css', 'css/styles.css']]);
const ACTIONS = ['receive', 'validate', 'request-info', 'clarification', 'evaluation', 'decision', 'reevaluate', 'assign', 'start', 'activity', 'git', 'git-refresh', 'module-change', 'deviation', 'scope', 'send-to-tests', 'test', 'finish-tests', 'backout', 'review', 'close', 'close-rejected', 'reopen'];
const KB = 1024, MB = 1024 * KB;
async function readJson(req, limit = 200 * KB) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Se requiere application/json.');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) fail(413, 'Solicitud demasiado grande. Revisa el tamaño de los adjuntos.'); chunks.push(chunk); }
  let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'JSON inválido.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'Objeto JSON inválido.');
  return data;
}
function limiter(max, windowMs) {
  const hits = new Map();
  return ip => {
    const t = Date.now();
    for (const [k, v] of hits) if (v.until < t) hits.delete(k);
    const entry = hits.get(ip) || { count: 0, until: t + windowMs };
    return { blocked: entry.count >= max, add() { entry.count++; hits.set(ip, entry); }, clear() { hits.delete(ip); } };
  };
}
function catalog() {
  const { PROJECT, MODULES, STATES, ITIL, IMPACT, LEVELS, FEASIBILITY, DECISIONS, OPERATIONS, ENVIRONMENTS, DOWNTIME_UNITS, ACTIVITY_STATES, GIT_KINDS, TEST_STATES, TEST_OUTCOMES, ROLLOUT_COMPLIANCE, REVIEW_DECISIONS, BACKOUT_RESULTS, CLOSURE_RESULTS, STAGES, ATTACHMENT_TYPES, ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_FILES } = C;
  return { PROJECT, MODULES, STATES, ITIL, IMPACT, LEVELS, FEASIBILITY, DECISIONS, OPERATIONS, ENVIRONMENTS, DOWNTIME_UNITS, ACTIVITY_STATES, GIT_KINDS, TEST_STATES, TEST_OUTCOMES, ROLLOUT_COMPLIANCE, REVIEW_DECISIONS, BACKOUT_RESULTS, CLOSURE_RESULTS, STAGES, EXTENSIONS: Object.keys(ATTACHMENT_TYPES), ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_FILES };
}
function createApp({ filename = process.env.DB_PATH || path.join(__dirname, 'data', 'changeflow.sqlite'), seedPassword = process.env.SEED_PASSWORD, secureCookies = process.env.COOKIE_SECURE === 'true', initialUsers, github = createGithub({ repo: process.env.GITHUB_REPO, token: process.env.GITHUB_TOKEN, apiUrl: process.env.GITHUB_API_URL }), appUrl = process.env.APP_URL || '' } = {}) {
  const db = openDatabase(filename);
  try { seedUsers(db, seedPassword, initialUsers); } catch (e) { db.close(); throw e; }
  const loginLimit = limiter(10, 15 * 60 * 1000), publicLimit = limiter(20, 60 * 60 * 1000), trackLimit = limiter(30, 60 * 60 * 1000);
  const dummyHash = hashPassword('Unused-Dummy-Password');
  const cookie = token => `changeflow_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 28800 : 0}${secureCookies ? '; Secure' : ''}`;
  const tx = work => transaction(db, work);
  // ---------- GitHub: fuera de las transacciones (red) ----------
  // Crea la issue del CRF; un fallo no impide registrar la solicitud y puede reintentarse desde el expediente.
  async function openIssue(id) {
    if (!github.canIssue()) return null;
    const r = S.issueData(db, id);
    if (r.github?.issue) return r;
    const result = await github.createIssue(r, appUrl);
    if (!result.ok) console.error(`GitHub: no se pudo crear la issue de ${id}: ${result.message}`);
    return tx(() => S.recordIssue(db, id, result));
  }
  // Tras una acción con hitos (decisión, asignación, pruebas, cierre…) actualiza etiquetas y estado y comenta en la issue.
  async function syncIssue(id, historyBefore, force = false) {
    const r = S.issueData(db, id);
    if (!github.canIssue() || !r.github?.issue) return r;
    const comment = milestoneComment(r, historyBefore);
    if (!comment && !force) return r;
    const result = await github.syncIssue(r, { comment });
    if (!result.ok) console.error(`GitHub: no se pudo sincronizar la issue de ${id}: ${result.message}`);
    return tx(() => S.recordIssue(db, id, result));
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://localhost'), route = url.pathname, method = req.method, ip = req.socket.remoteAddress;
      if (!route.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(method)) fail(405, 'Método no permitido.');
        const file = STATIC.get(route); if (!file) fail(404, 'Página no encontrada.');
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
        res.writeHead(200, { 'Content-Type': `${types[path.extname(file)]}; charset=utf-8`, 'Cache-Control': 'no-cache' });
        res.end(method === 'HEAD' ? undefined : fs.readFileSync(path.join(ROOT, file))); return;
      }
      const mutation = !['GET', 'HEAD'].includes(method);
      if (mutation) {
        const origin = req.headers.origin;
        if (origin && origin !== `${secureCookies ? 'https' : 'http'}://${req.headers.host}`) fail(403, 'Origen no permitido.');
      }
      // ---------- Rutas sin sesión ----------
      if (route === '/api/catalog' && method === 'GET') { json(200, catalog()); return; }
      if (route === '/api/auth/login' && method === 'POST') {
        const data = await readJson(req), attempt = loginLimit(ip);
        if (attempt.blocked) fail(429, 'Demasiados intentos. Espera 15 minutos.');
        if (typeof data.email !== 'string' || typeof data.password !== 'string' || data.email.length > 200 || data.password.length > 512) fail(400, 'Credenciales inválidas.');
        const user = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(data.email.trim().toLowerCase());
        if (!verifyPassword(data.password, user?.password_hash || dummyHash)) { attempt.add(); fail(401, 'Correo o contraseña incorrectos.'); }
        attempt.clear();
        const previous = getSession(db, req); if (previous) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(previous.token_hash);
        const session = createSession(db, user.id); res.setHeader('Set-Cookie', cookie(session.token)); json(200, { user: publicUser(user), csrf: session.csrf }); return;
      }
      if (route === '/api/public/requests' && method === 'POST') {
        const attempt = publicLimit(ip);
        if (attempt.blocked) fail(429, 'Has enviado demasiadas solicitudes. Intenta más tarde.');
        attempt.add();
        const data = await readJson(req, 8 * MB), { request, trackingToken } = tx(() => S.createRequest(db, null, data));
        await openIssue(request.id);
        json(201, { receipt: { id: request.id, date: request.date, status: request.status, trackingToken } }); return;
      }
      if ((route === '/api/public/track' || route === '/api/public/track/clarification') && method === 'POST') {
        const attempt = trackLimit(ip);
        if (attempt.blocked) fail(429, 'Demasiadas consultas. Intenta más tarde.');
        const data = await readJson(req, route.endsWith('clarification') ? 8 * MB : 10 * KB);
        try {
          if (route.endsWith('clarification')) {
            const view = tx(() => S.publicClarification(db, data));
            await syncIssue(view.id, Math.max(0, S.issueData(db, view.id).history.length - 1));
            json(200, { request: view });
          } else json(200, { request: S.trackRequest(db, data) });
        }
        catch (e) { if (e.status === 404) attempt.add(); throw e; }
        return;
      }
      // ---------- Rutas con sesión ----------
      const session = getSession(db, req); if (!session) fail(401, 'Inicia sesión para continuar.');
      if (mutation && req.headers['x-csrf-token'] !== session.csrf) fail(403, 'Sesión de formulario inválida. Actualiza la página.');
      const user = session;
      const store = () => S.snapshot(db, user);
      if (route === '/api/auth/me' && method === 'GET') { json(200, { user: publicUser(session), csrf: session.csrf }); return; }
      if (route === '/api/auth/logout' && method === 'POST') { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.token_hash); res.setHeader('Set-Cookie', cookie('')); json(200, { ok: true }); return; }
      if (route === '/api/committee' && method === 'GET') { json(200, { users: S.users(db).filter(u => u.role === 'ccc' && user.role === 'ccc').map(publicUser) }); return; }
      if (route === '/api/users' && method === 'GET') { json(200, { users: user.role === 'usuario' ? [] : S.users(db).map(publicUser) }); return; }
      if (route === '/api/requests' && method === 'GET') { json(200, store()); return; }
      if (route === '/api/requests' && method === 'POST') {
        const data = await readJson(req, 8 * MB), created = tx(() => S.createRequest(db, user, data));
        const request = (await openIssue(created.request.id)) || created.request;
        json(201, { request, store: store() }); return;
      }
      let m = /^\/api\/requests\/((?:CRF|SCR)-\d+)(?:\/([a-z-]+))?$/.exec(route);
      if (m) {
        const [, id, action] = m;
        if (!action && method === 'GET') { json(200, S.requestDetail(db, id, user)); return; }
        if (action === 'attachments' && method === 'POST') { const data = await readJson(req, 12 * MB); const r = tx(() => S.uploadAttachments(db, id, user, data)); json(200, { request: r, store: store() }); return; }
        if (action === 'github-issue' && method === 'POST') {
          if (user.role !== 'ccc') fail(403, 'Solo el CCC gestiona la issue de GitHub.');
          await readJson(req, 10 * KB);
          const current = S.requestDetail(db, id, user).request;
          if (!github.canIssue()) fail(409, 'Configura GITHUB_REPO y GITHUB_TOKEN para crear issues.');
          const r = current.github?.issue ? await syncIssue(current.id, current.history.length, true) : await openIssue(current.id);
          if (!r.github?.lastSync?.ok) fail(502, `GitHub: ${r.github?.lastSync?.message || 'no se pudo completar la operación.'}`);
          json(200, { request: r, store: store() }); return;
        }
        if ((!action && ['PATCH', 'DELETE'].includes(method)) || (action && method === 'POST' && ACTIONS.includes(action))) {
          const data = await readJson(req), name = action || (method === 'DELETE' ? 'delete' : 'edit');
          delete data[S.GITHUB_RESULT];
          // Las referencias Git se consultan en GitHub antes de la transacción; el resultado lo adjunta el servidor.
          if (name === 'git') {
            const { kind, value, url: link } = S.gitInput(data);
            const result = await github.verify(kind, value, link);
            if (result.status === 'no encontrada') fail(400, result.message, 'value');
            if (result.status === 'otro repositorio') fail(400, result.message, 'url');
            data[S.GITHUB_RESULT] = result;
          } else if (name === 'git-refresh') {
            const ref = S.findGitRef(db, id, user, data.refId);
            data[S.GITHUB_RESULT] = await github.verify(ref.kind, ref.value, ref.url);
          }
          const before = name === 'delete' ? 0 : S.issueData(db, id).history.length;
          const r = tx(() => S.mutate(db, id, name, user, data));
          json(200, { request: r ? await syncIssue(r.id, before) : r, store: store() }); return;
        }
      }
      m = /^\/api\/attachments\/([a-f0-9]{24})$/.exec(route);
      if (m && method === 'GET') {
        const { row, content } = S.attachmentFor(db, m[1], user);
        res.writeHead(200, { 'Content-Type': row.mime, 'Content-Length': content.length, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`, 'Cache-Control': 'private, no-store' });
        res.end(content); return;
      }
      if (user.role === 'usuario') fail(403, 'Esta sección está reservada al equipo técnico y al CCC.');
      if (route === '/api/github/status' && method === 'GET') { json(200, await github.status()); return; }
      if ((route === '/api/reports' || route === '/api/reports.csv') && method === 'GET') {
        const filters = Object.fromEntries([...url.searchParams].filter(([k, v]) => ['from', 'to', 'status', 'itilType', 'requester', 'developer', 'module', 'priority', 'result'].includes(k) && v).map(([k, v]) => [k, v.slice(0, 200)]));
        const data = R.report(db, user, filters);
        if (route.endsWith('.csv')) { res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="reporte-cambios.csv"', 'Cache-Control': 'no-store' }); res.end(R.csv(data.rows)); return; }
        json(200, data); return;
      }
      if (route === '/api/audit' && method === 'GET') {
        const visible = new Set(S.allVisible(db, user).map(x => x.r.id));
        json(200, { events: listAudit(db, { entityType: url.searchParams.get('entityType') || '', action: url.searchParams.get('action') || '', entityIds: user.role === 'ccc' ? null : visible }) }); return;
      }
      fail(404, 'Ruta no encontrada.');
    } catch (error) {
      const sqliteRule = /RAISE|constraint/i.test(String(error?.message)) && error?.code === 'ERR_SQLITE_ERROR';
      const status = error instanceof HttpError ? error.status : sqliteRule ? 409 : 500;
      if (status === 500) console.error(error);
      const message = status === 500 ? 'No se pudo completar la operación.' : sqliteRule ? `Regla de integridad: ${String(error.message).replace(/^.*?:\s*/, '')}` : error.message;
      if (!res.headersSent) json(status, { error: message, ...(error?.field && status < 500 ? { field: error.field } : {}) }); else res.end();
    }
  });
  server.on('close', () => db.close());
  return { server, db };
}
if (require.main === module) {
  try {
    // --demo: usa la base de demostración separada (npm run demo:reset la crea).
    if (process.argv.includes('--demo')) process.env.DB_PATH = require('./demo.cjs').DEMO;
    const { server } = createApp();
    const port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1';
    server.on('error', error => { console.error(`No se pudo iniciar el servidor: ${error.code}. Revisa HOST y PORT en .env.`); process.exitCode = 1; server.close(); });
    server.listen(port, host, () => console.log(`Transviajes · Control de cambios disponible en http://${host}:${port}`));
    const close = () => server.close(() => process.exit(0)); process.on('SIGINT', close); process.on('SIGTERM', close);
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { createApp };

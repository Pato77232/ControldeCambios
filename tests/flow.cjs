'use strict';
// Prueba del cliente con una API real (servidor efímero y base de demostración en memoria) y un DOM mínimo.
// Verifica que cada pantalla se genere sin errores y que la interfaz muestre solo las opciones de cada rol.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const { createApp } = require('../backend/server.cjs');
const { createGithub } = require('../backend/github.cjs');
const { buildDemo } = require('../backend/demo.cjs');
const PASSWORD = 'Test-ChangeFlow-2026!';

function dom() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { id, value: '', textContent: '', innerHTML: '', hidden: false, dataset: {}, elements: [], files: [], classList: { toggle() {} }, setAttribute() {}, removeAttribute() {}, getAttribute: () => null, closest: () => null, addEventListener() {}, focus() {}, querySelector: sel => node(`${id} ${sel}`), querySelectorAll: () => [], showModal() {}, scrollIntoView() {} });
    return nodes.get(id);
  };
  return { nodes, node };
}
(async () => {
  const app = createApp({ filename: ':memory:', seedPassword: PASSWORD, github: createGithub({}) });
  buildDemo(app.db);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    for (const [email, role] of [[null, 'invitado'], ['david@uta.edu.ec', 'ccc'], ['edwin@uta.edu.ec', 'experto']]) {
      let cookie = '';
      if (email) {
        const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
        assert.equal(res.status, 200); cookie = res.headers.get('set-cookie').split(';')[0];
      }
      const { node } = dom();
      const fetchWithCookie = (url, options = {}) => fetch(base + url, { ...options, headers: { ...(options.headers || {}), ...(cookie ? { Cookie: cookie } : {}) } });
      const context = vm.createContext({ console, Date, Intl, Set, Map, String, Number, Array, Object, Math, JSON, Error, Promise, URLSearchParams, Buffer, btoa: s => Buffer.from(s, 'binary').toString('base64'), fetch: fetchWithCookie, setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, location: { hash: '#panel' }, window: { scrollTo() {}, addEventListener() {}, confirm: () => true, print() {} }, document: { querySelector: id => node(id), querySelectorAll: () => [], addEventListener() {}, getElementById: id => node('#' + id), visibilityState: 'visible' } });
      const run = source => vm.runInContext(source, context);
      run(fs.readFileSync('js/app.js', 'utf8').replace(/bootstrap\(\);\s*$/, 'globalThis.ready = bootstrap();'));
      await run('ready');
      const html = () => node('main').innerHTML;
      const show = async hash => { run(`location.hash = ${JSON.stringify(hash)}; route();`); await new Promise(r => setImmediate(r)); await new Promise(r => setTimeout(r, 60)); return html(); };
      const nav = () => node('.app-nav').innerHTML;
      // Las tarjetas (sin atributo name) deben enviarse agrupadas por data-group.
      const collected = run("collect({ elements: [{ dataset: { group: 'modules' }, type: 'checkbox', checked: true, value: 'Cooperativas' }, { dataset: { group: 'modules' }, type: 'checkbox', checked: false, value: 'Notificaciones' }, { dataset: {}, name: 'title', type: 'text', value: ' Título ' }] })");
      assert.deepEqual(JSON.parse(JSON.stringify(collected)), { modules: ['Cooperativas'], title: 'Título' });
      if (role === 'invitado') {
        assert.match(nav(), /Seguimiento/); assert.doesNotMatch(nav(), /Catálogo de ICS|data-nav="panel"/);
        const start = await show('#panel');
        assert.match(start, /login-form/, 'sin sesión se inicia en el login'); assert.doesNotMatch(start, /stat-value/, 'no se muestra el panel');
        const form = await show('#nueva');
        assert.match(form, /CRF\) · Usuario final/); assert.doesNotMatch(form, /modificationType/); assert.match(form, /id="f-name"[^>]*required/); assert.doesNotMatch(form, /id="f-code"|id="f-created"|id="f-project"/, 'los datos automáticos no se muestran como campos');
        assert.doesNotMatch(form, /itilType|rolloutSteps|developerId/, 'el usuario final no fija datos internos');
        assert.match(await show('#seguimiento'), /Clave de seguimiento/);
        assert.match(await show('#detalle/CRF-000001'), /Iniciar sesión|login/);
      } else if (role === 'ccc') {
        assert.doesNotMatch(nav(), /Catálogo de ICS|Líneas base/); assert.match(nav(), /Auditoría/); assert.doesNotMatch(nav(), /Nueva solicitud/);
        assert.match(await show('#nueva'), /no puede presentarlas/);
        const d4 = await show('#detalle/CRF-000004');
        assert.match(d4, /Recibir solicitud/); assert.match(d4, /Solicitud original/); assert.match(d4, /case-nav/); assert.match(d4, /Corregir solicitud/);
        const fix = await show('#editar/CRF-000004');
        assert.match(fix, /Motivo de la corrección/); assert.match(fix, /data-group="modules"/); assert.match(fix, /value="Notificaciones" checked/);
        const d1 = await show('#detalle/CRF-000001');
        assert.match(d1, /Reabrir solicitud/); assert.match(d1, /Pruebas, revisión y cierre/); assert.doesNotMatch(d1, /Auditoría de configuración|data-jump="sec-tests"|data-jump="sec-ics"/); assert.match(d1, /data-jump="sec-audit"/); assert.match(d1, /Rama de trabajo y pull request/); assert.match(d1, /feature\/CRF-000001-liberar-asiento/); assert.match(d1, /class="markdown"/); assert.match(d1, /Módulos realmente modificados/); assert.match(d1, /GitHub sin configurar/); assert.match(d1, /Define GITHUB_REPO/);
        assert.doesNotMatch(d1, /Registrar ejecución de prueba/);
        assert.match(await show('#ics'), /Mis tareas/, 'las rutas de ICS vuelven al panel');
        const rep = await show('#reportes');
        assert.match(rep, /Por tipo ITIL/); assert.match(rep, /Exportar CSV/);
        assert.match(await show('#auditoria'), /Eventos persistentes/);
        const fichaHtml = await show('#ficha/CRF-000002');
        assert.match(fichaHtml, /Esta ficha|Ficha del CCC/); assert.match(fichaHtml, /md-field/); assert.match(fichaHtml, /Vista previa/);
        const panel = await show('#panel?priority=Alta');
        assert.match(panel, /id="panel-filter"/); assert.match(panel, /con los filtros aplicados/); assert.match(panel, /Por prioridad/);
      } else {
        assert.match(nav(), /Nueva solicitud/); assert.doesNotMatch(nav(), /Catálogo de ICS/);
        const form = await show('#nueva');
        assert.match(form, /Propuesta técnica/); assert.match(form, /identity-note/); assert.doesNotMatch(form, /id="f-name"|id="f-code"/); assert.match(form, /data-group="modules"/); assert.doesNotMatch(form, /suggestedIcs|ICS/); assert.match(form, /data-version/);
        assert.match(form, /name="proposedItilType"/); assert.ok(form.indexOf('featureMissing') < form.indexOf('data-group="modules"'), 'la casilla va antes de los módulos');
        assert.match(form, /id="f-currentVersion"/); assert.doesNotMatch(form, /id="f-currentVersion"[^>]*required/);
        const work = await show('#trabajo/CRF-000001');
        assert.match(work, /class="stepper"/); assert.match(work, /Rama de trabajo/); assert.match(work, /Pull request/);
        assert.match(await show('#trabajo/CRF-000003'), /Seguimiento no disponible/, 'solo el asignado');
        assert.match(await show('#ficha/CRF-000001'), /Ficha no disponible/);
        const d = await show('#detalle/CRF-000001');
        assert.doesNotMatch(d, /Reabrir solicitud|Decidir la autorización/);
        assert.match(await show('#panel'), /Mis tareas/);
      }
    }
    console.log('OK cliente: pantallas por rol, formularios CRF, ficha del CCC, módulos, GitHub, reportes y auditoría generados con la API real.');
  } finally { await new Promise(resolve => app.server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

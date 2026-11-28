'use strict';
// Reporte de estado: indicadores, agrupaciones y métricas calculadas solo con datos almacenados.
const { allVisible, modulesOf, currentAuthorization, currentAssignment } = require('./service.cjs');

const DAY = 86400000;
const OPEN_ANALYSIS = ['Registrada', 'En validación', 'En análisis', 'En planificación'];
const IMPLEMENTING = ['Asignada', 'En implementación', 'Correcciones requeridas'];
function rowsFor(db, user, filters = {}) {
  return allVisible(db, user).map(({ r }) => {
    const auth = currentAuthorization(r), assignee = currentAssignment(r) || r.assignments?.at(-1);
    const finalDecision = (r.decisions || []).find(d => d.kind === 'Autorización' && ['Aprobado', 'Aprobado con condiciones', 'Rechazado'].includes(d.decision));
    const rounds = r.implementation?.rounds || [];
    return {
      id: r.id, title: r.title, date: r.date, createdAt: r.createdAt, status: r.status, module: r.module, priority: r.priority || 'Sin definir',
      itilType: r.evaluation?.itilType || 'Sin clasificar', requester: r.name, participants: [...new Set([r.ownerId, ...(r.assignments || []).map(x => x.developerId), ...(r.history || []).map(h => h.responsibleId)].filter(Boolean))], requesterType: r.requesterType === 'experto' ? 'Desarrollador' : 'Usuario final',
      developer: assignee?.developerName || 'Sin asignar', developerId: assignee?.developerId || '', decision: auth?.decision || 'Sin decisión',
      result: r.closure?.result || (r.closure ? r.closure.administrative : 'Sin cierre'), modules: modulesOf(r), issue: r.github?.issue ? `#${r.github.issue.number}` : '',
      decisionDays: finalDecision ? (Date.parse(finalDecision.at) - Date.parse(r.createdAt)) / DAY : null,
      implementationDays: rounds.length && (rounds.at(-1).sentToTestsAt || r.closure?.at) ? (Date.parse(rounds.at(-1).sentToTestsAt || r.closure.at) - Date.parse(rounds[0].startedAt)) / DAY : null,
      closureDays: r.closure?.at ? (Date.parse(r.closure.at) - Date.parse(r.createdAt)) / DAY : null,
      everDecided: !!finalDecision, everApproved: (r.decisions || []).some(d => d.kind === 'Autorización' && d.decision.startsWith('Aprobado')), rejected: auth?.decision === 'Rechazado'
    };
  }).filter(x => (!filters.from || x.date >= filters.from) && (!filters.to || x.date <= filters.to) && (!filters.status || x.status === filters.status) && (!filters.itilType || x.itilType === filters.itilType)
    && (!filters.requester || x.requester.toLowerCase().includes(String(filters.requester).toLowerCase())) && (!filters.developer || x.developerId === filters.developer) && (!filters.user || x.participants.includes(filters.user))
    && (!filters.module || x.modules.includes(filters.module)) && (!filters.priority || x.priority === filters.priority) && (!filters.result || x.result === filters.result));
}
const group = (rows, key) => Object.entries(rows.reduce((acc, r) => { for (const k of [].concat(r[key])) acc[k] = (acc[k] || 0) + 1; return acc; }, {})).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
const avg = values => { const v = values.filter(x => x !== null && x >= 0); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null; };
const pct = (part, total) => total ? Math.round(part / total * 1000) / 10 : null;
function report(db, user, filters) {
  const rows = rowsFor(db, user, filters);
  const count = fn => rows.filter(fn).length;
  const decided = count(r => r.everDecided), closedImpl = count(r => ['Exitoso', 'Fallido', 'Incompleto'].includes(r.result));
  return {
    filters, total: rows.length,
    counts: {
      total: rows.length, open: count(r => r.status !== 'Cerrada'), pendingAnalysis: count(r => OPEN_ANALYSIS.includes(r.status)), pendingInfo: count(r => r.status === 'Pendiente de información'),
      pendingApproval: count(r => r.status === 'Pendiente de aprobación'), approved: count(r => ['Aprobada', 'Aprobada con condiciones'].includes(r.status)), rejected: count(r => r.rejected),
      implementing: count(r => IMPLEMENTING.includes(r.status)), testing: count(r => r.status === 'En pruebas'), reviewing: count(r => r.status === 'En revisión'), closed: count(r => r.status === 'Cerrada'),
      success: count(r => r.result === 'Exitoso'), failed: count(r => r.result === 'Fallido'), incomplete: count(r => r.result === 'Incompleto')
    },
    groups: { itilType: group(rows, 'itilType'), priority: group(rows, 'priority'), status: group(rows, 'status'), module: group(rows, 'modules'), developer: group(rows, 'developer'), result: group(rows, 'result'), month: group(rows.map(r => ({ ...r, month: r.date.slice(0, 7) })), 'month').sort((a, b) => a.label.localeCompare(b.label)) },
    metrics: {
      avgDecisionDays: avg(rows.map(r => r.decisionDays)), avgImplementationDays: avg(rows.map(r => r.implementationDays)), avgClosureDays: avg(rows.map(r => r.closureDays)),
      approvedPct: pct(count(r => r.everDecided && r.everApproved), decided), rejectedPct: pct(count(r => r.everDecided && r.rejected), decided), successPct: pct(count(r => r.result === 'Exitoso'), closedImpl),
      decided, closedWithImplementation: closedImpl
    },
    rows
  };
}
function csv(rows) {
  const cols = [['id', 'Código'], ['date', 'Fecha'], ['title', 'Título'], ['requester', 'Solicitante'], ['requesterType', 'Origen'], ['module', 'Módulo'], ['itilType', 'Tipo ITIL'], ['priority', 'Prioridad'], ['status', 'Estado'], ['decision', 'Decisión vigente'], ['developer', 'Desarrollador'], ['result', 'Resultado'], ['modules', 'Módulos'], ['issue', 'Issue de GitHub']];
  const cell = v => { const s = Array.isArray(v) ? v.join(' ') : String(v ?? ''); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return `"${safe.replace(/"/g, '""')}"`; };
  return '﻿' + [cols.map(c => cell(c[1])).join(';'), ...rows.map(r => cols.map(c => cell(r[c[0]])).join(';'))].join('\r\n');
}
// ---------- Panel de auditoría ----------
// Distingue solicitudes (todo lo registrado) de cambios realizados (cerrados con resultado exitoso),
// y resume el control de versiones (ramas, PR, tags, commits leídos de GitHub).
const TYPES = ['Estándar', 'Normal', 'Emergencia'];
const PENDING = 'Pendiente de clasificar';
function auditDashboard(db, user, { developer = '', from = '', to = '' } = {}) {
  const docs = allVisible(db, user).map(x => x.r).filter(r => (!from || r.date >= from) && (!to || r.date <= to));
  const typeOf = r => r.evaluation?.itilType || PENDING;
  const devOf = r => (currentAssignment(r) || r.assignments?.at(-1))?.developerName || '';
  const devIdOf = r => (currentAssignment(r) || r.assignments?.at(-1))?.developerId || '';
  const done = docs.filter(r => r.closure?.result === 'Exitoso');
  const inProgress = docs.filter(r => r.status !== 'Cerrada' && ['Aprobado', 'Aprobado con condiciones'].includes(currentAuthorization(r)?.decision));
  const byType = list => Object.fromEntries([...TYPES, PENDING].map(t => [t, list.filter(r => typeOf(r) === t).length]));
  const team = db.prepare("SELECT id,name FROM users WHERE active=1 AND role='experto' ORDER BY name").all();
  const people = team.map(u => {
    const mine = done.filter(r => devIdOf(r) === u.id);
    return { id: u.id, name: u.name, requested: docs.filter(r => r.ownerId === u.id).length, assigned: docs.filter(r => (r.assignments || []).some(a => a.developerId === u.id)).length, done: mine.length, ...Object.fromEntries(TYPES.map(t => [t, mine.filter(r => typeOf(r) === t).length])) };
  });
  const selected = developer ? people.find(p => p.id === developer) || null : null;
  const scoped = developer ? docs.filter(r => devIdOf(r) === developer) : docs;
  const prs = docs.filter(r => r.pullRequest);
  return {
    totals: { requests: docs.length, done: done.length, failed: docs.filter(r => ['Fallido', 'Incompleto'].includes(r.closure?.result)).length, inProgress: inProgress.length, rejected: docs.filter(r => (r.decisions || []).some(d => d.kind === 'Autorización' && d.decision === 'Rechazado') && !r.closure?.result).length, pending: docs.filter(r => typeOf(r) === PENDING && r.status !== 'Cerrada').length },
    requestsByType: byType(scoped), doneByType: byType(developer ? done.filter(r => devIdOf(r) === developer) : done),
    resultBreakdown: ['Exitoso', 'Fallido', 'Incompleto'].map(k => ({ label: k, value: scoped.filter(r => r.closure?.result === k).length })).concat([{ label: 'Rechazada', value: scoped.filter(r => r.closure && !r.closure.result).length }, { label: 'En curso', value: scoped.filter(r => r.status !== 'Cerrada').length }]),
    people, selected,
    versionControl: { branches: docs.filter(r => r.workBranch).length, branchesCreated: docs.filter(r => r.workBranch?.created).length, pullRequests: prs.length, merged: prs.filter(r => r.pullRequest.state === 'fusionado').length, open: prs.filter(r => ['abierto', 'borrador'].includes(r.pullRequest.state)).length, tags: docs.filter(r => r.releaseTag).length, issues: docs.filter(r => r.github?.issue).length, commitsRegistered: docs.reduce((n, r) => n + (r.gitRefs || []).filter(g => g.kind === 'Commit').length, 0) },
    changes: done.map(r => ({ id: r.id, title: r.title, type: typeOf(r), developer: devOf(r), closedAt: r.closure.at, branch: r.workBranch?.name || '', pr: r.pullRequest ? `#${r.pullRequest.number}` : '', tag: r.releaseTag?.name || r.closure.resultingVersion || '' })).filter(x => !developer || done.find(r => r.id === x.id && devIdOf(r) === developer)),
    branches: docs.filter(r => r.workBranch).map(r => ({ id: r.id, branch: r.workBranch.name, base: r.workBranch.base })),
    types: [...TYPES, PENDING]
  };
}
module.exports = { report, csv, auditDashboard };

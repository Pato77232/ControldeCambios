'use strict';
// Reporte de estado: indicadores, agrupaciones y métricas calculadas solo con datos almacenados.
const { allVisible, linkSummary, currentAuthorization, currentAssignment } = require('./service.cjs');

const DAY = 86400000;
const OPEN_ANALYSIS = ['Registrada', 'En validación', 'En análisis', 'En planificación'];
const IMPLEMENTING = ['Asignada', 'En implementación', 'Correcciones requeridas'];
function rowsFor(db, user, filters = {}) {
  const summary = linkSummary(db);
  return allVisible(db, user).map(({ number, r }) => {
    const auth = currentAuthorization(r), assignee = currentAssignment(r) || r.assignments?.at(-1);
    const finalDecision = (r.decisions || []).find(d => d.kind === 'Autorización' && ['Aprobado', 'Aprobado con condiciones', 'Rechazado'].includes(d.decision));
    const rounds = r.implementation?.rounds || [];
    return {
      id: r.id, title: r.title, date: r.date, createdAt: r.createdAt, status: r.status, module: r.module, priority: r.priority || 'Sin definir',
      itilType: r.evaluation?.itilType || 'Sin clasificar', requester: r.name, requesterType: r.requesterType === 'experto' ? 'Desarrollador' : 'Usuario final',
      developer: assignee?.developerName || 'Sin asignar', developerId: assignee?.developerId || '', decision: auth?.decision || 'Sin decisión',
      result: r.closure?.result || (r.closure ? r.closure.administrative : 'Sin cierre'), ics: [...new Set([...(summary.get(number)?.potencial || []), ...(summary.get(number)?.autorizado || []), ...(summary.get(number)?.modificado || [])])],
      decisionDays: finalDecision ? (Date.parse(finalDecision.at) - Date.parse(r.createdAt)) / DAY : null,
      implementationDays: rounds.length && (rounds.at(-1).sentToTestsAt || r.closure?.at) ? (Date.parse(rounds.at(-1).sentToTestsAt || r.closure.at) - Date.parse(rounds[0].startedAt)) / DAY : null,
      closureDays: r.closure?.at ? (Date.parse(r.closure.at) - Date.parse(r.createdAt)) / DAY : null,
      everDecided: !!finalDecision, everApproved: (r.decisions || []).some(d => d.kind === 'Autorización' && d.decision.startsWith('Aprobado')), rejected: auth?.decision === 'Rechazado'
    };
  }).filter(x => (!filters.from || x.date >= filters.from) && (!filters.to || x.date <= filters.to) && (!filters.status || x.status === filters.status) && (!filters.itilType || x.itilType === filters.itilType)
    && (!filters.requester || x.requester.toLowerCase().includes(String(filters.requester).toLowerCase())) && (!filters.developer || x.developerId === filters.developer)
    && (!filters.ics || x.ics.includes(filters.ics)) && (!filters.module || x.module === filters.module) && (!filters.priority || x.priority === filters.priority) && (!filters.result || x.result === filters.result));
}
const group = (rows, key) => Object.entries(rows.reduce((acc, r) => { const k = r[key]; acc[k] = (acc[k] || 0) + 1; return acc; }, {})).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
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
    groups: { itilType: group(rows, 'itilType'), priority: group(rows, 'priority'), status: group(rows, 'status'), module: group(rows, 'module'), developer: group(rows, 'developer'), result: group(rows, 'result'), month: group(rows.map(r => ({ ...r, month: r.date.slice(0, 7) })), 'month').sort((a, b) => a.label.localeCompare(b.label)) },
    metrics: {
      avgDecisionDays: avg(rows.map(r => r.decisionDays)), avgImplementationDays: avg(rows.map(r => r.implementationDays)), avgClosureDays: avg(rows.map(r => r.closureDays)),
      approvedPct: pct(count(r => r.everDecided && r.everApproved), decided), rejectedPct: pct(count(r => r.everDecided && r.rejected), decided), successPct: pct(count(r => r.result === 'Exitoso'), closedImpl),
      decided, closedWithImplementation: closedImpl
    },
    rows
  };
}
function csv(rows) {
  const cols = [['id', 'Código'], ['date', 'Fecha'], ['title', 'Título'], ['requester', 'Solicitante'], ['requesterType', 'Origen'], ['module', 'Módulo'], ['itilType', 'Tipo ITIL'], ['priority', 'Prioridad'], ['status', 'Estado'], ['decision', 'Decisión vigente'], ['developer', 'Desarrollador'], ['result', 'Resultado'], ['ics', 'ICS']];
  const cell = v => { const s = Array.isArray(v) ? v.join(' ') : String(v ?? ''); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return `"${safe.replace(/"/g, '""')}"`; };
  return '﻿' + [cols.map(c => cell(c[1])).join(';'), ...rows.map(r => cols.map(c => cell(r[c[0]])).join(';'))].join('\r\n');
}
module.exports = { report, csv };

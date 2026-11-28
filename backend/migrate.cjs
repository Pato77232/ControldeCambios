'use strict';
// Migración de documentos de solicitud al modelo 4 (ficha única del CCC y flujo completo).
// Nada se descarta: los datos anteriores se conservan en `legacy` y las incoherencias quedan marcadas.
const SCHEMA = 4;
const crfCode = n => `CRF-${String(n).padStart(6, '0')}`;
const LEGACY_DECISION = { 'Aprobado': 'Aprobado', 'Aprobado con condiciones': 'Aprobado con condiciones', 'Rechazado': 'Rechazado', 'Más información': 'Más información' };

function migrateDocument(doc, number) {
  if (doc.schema === SCHEMA) return null;
  const at = new Date().toISOString();
  const legacy = {
    code: doc.id, status: doc.status, type: doc.type, components: doc.components, specId: doc.specId,
    acceptanceCriteria: doc.acceptanceCriteria, attachmentNames: doc.attachments, analysis: doc.analysis || null,
    resolutions: doc.resolutions || [], decision: doc.decision || null, previousAnalyses: doc.previousAnalyses,
    committeeVotes: doc.committeeVotes, reviewerId: doc.reviewerId, clarifications: doc.clarifications, project: doc.project
  };
  for (const key of Object.keys(legacy)) if (legacy[key] === undefined) delete legacy[key];
  const r = {
    schema: SCHEMA, id: crfCode(number), legacyCode: doc.id, date: doc.date, createdAt: doc.history?.[0]?.date || `${doc.date}T12:00:00.000Z`,
    name: doc.name, email: doc.email, ownerId: doc.ownerId ?? null, ...(doc.submittedWithoutAccount ? { submittedWithoutAccount: true } : {}),
    requesterType: doc.requesterType || 'experto', project: doc.project || 'BusesUTA', module: doc.module, title: doc.title,
    currentBehavior: doc.currentBehavior, featureMissing: false, description: doc.description, justification: doc.justification,
    result: doc.result, desiredDate: doc.desiredDate || '', observations: doc.observations || '',
    priority: doc.analysis?.priority || doc.priority || null, status: 'Registrada', revision: (doc.revision || 0) + 1,
    history: Array.isArray(doc.history) ? doc.history : [], infoRequests: [], evaluation: null, previousEvaluations: [],
    decisions: [], assignments: [], implementation: { rounds: [] }, gitRefs: [], deviations: [], tests: [], testRounds: [],
    reviews: [], backouts: [], closure: null, closures: [], reopenings: [], notices: [], legacy, flags: []
  };
  if (r.requesterType === 'experto') {
    Object.assign(r, {
      modificationType: '', environment: doc.environment || '', currentVersion: doc.currentVersion || 'No determinada',
      targetVersion: doc.targetVersion || '', spec: doc.specId ? `Referencia anterior: ${doc.specId}` : '', specUrl: '',
      businessRulesAffected: !!doc.businessRules, businessRules: doc.businessRules || 'No aplica',
      acceptanceCriteria: String(doc.acceptanceCriteria || '').split(/\r?\n+/).map(x => x.trim()).filter(Boolean),
      suggestedIcsText: doc.components || '', proposedPriority: doc.proposedPriority || 'Media'
    });
    if (!r.modificationType) r.flags.push('Registro anterior sin tipo de modificación (adición/modificación/eliminación).');
  }
  const analysis = doc.analysis;
  if (analysis) {
    r.evaluation = {
      startedAt: analysis.date, member: analysis.analyst, memberId: analysis.analystId, updatedAt: analysis.date, migrated: true,
      itilType: '', classificationJustification: '', impact: analysis.impact || '', technicalImpact: analysis.technicalImpact || '',
      functionalImpact: '', risks: analysis.risks ? [analysis.risks] : [], urgency: '', priority: analysis.priority || '',
      feasibility: analysis.feasibility || '', feasibilityJustification: '', effortHours: null, durationDays: null,
      resources: analysis.resources || '', considerations: [analysis.considerations, analysis.effort ? `Esfuerzo registrado anteriormente: ${analysis.effort}` : ''].filter(Boolean).join('\n'),
      rolloutSteps: [], backoutActions: [], testCriteria: r.acceptanceCriteria || []
    };
  }
  const lastResolution = (doc.resolutions || []).at(-1);
  if (doc.status === 'Más información') {
    r.status = 'Pendiente de información';
    r.infoRequests.push({ id: 'INF-1', at: lastResolution?.date || at, by: lastResolution?.responsible || 'CCC', from: analysis ? 'En análisis' : 'En validación', missing: lastResolution?.decisionNote || 'Información solicitada en la versión anterior.', legacy: true });
  } else if (['Aprobada', 'Aprobada con condiciones', 'Rechazada'].includes(doc.status) && lastResolution) {
    r.status = doc.status;
    const conditions = lastResolution.conditions ? [{ id: 'C1', text: lastResolution.conditions, verification: 'Por definir: condición registrada en la versión anterior.' }] : [];
    r.decisions.push({ n: 1, kind: 'Autorización', decision: LEGACY_DECISION[lastResolution.decision] || lastResolution.decision, justification: lastResolution.decisionNote, conditions, decidedBy: lastResolution.responsible, decidedById: lastResolution.responsibleId, at: lastResolution.date, evaluationSnapshot: lastResolution.analysisSnapshot || null, legacy: true });
    if (doc.status !== 'Rechazada') {
      r.decisions[0].needsReevaluation = true;
      r.flags.push('Aprobación registrada en la versión anterior sin clasificación ITIL ni planes de rollout, backout y pruebas. Debe reevaluarse antes de asignar la implementación.');
    }
  } else if (analysis || doc.reviewerId) {
    r.status = 'En análisis';
  } else if (doc.status !== 'Pendiente') {
    r.status = 'En validación';
    r.flags.push(`Estado anterior no reconocido («${doc.status}»); se devolvió a validación para revisión.`);
  }
  r.history.push({ status: r.status, from: doc.status, date: at, responsible: 'Sistema', action: 'Migración', note: `Migración al modelo 4: código ${doc.id} → ${r.id}; estado «${doc.status}» → «${r.status}». Los datos anteriores se conservan.` });
  return r;
}
module.exports = { SCHEMA, crfCode, migrateDocument };

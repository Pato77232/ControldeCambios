'use strict';
// Catálogos compartidos por el servidor y el cliente (el cliente los recibe en GET /api/catalog).
const PROJECT = 'BusesUTA';
const MODULES = ['Autenticación y usuarios', 'Cooperativas', 'Frecuencias y precios por tramo', 'Buses y plantillas de asientos', 'Hojas de ruta', 'Búsqueda de viajes', 'Reservas y pasajeros', 'Pagos y comprobantes', 'Boletos QR e historial', 'Notificaciones', 'Configuración de la aplicación', 'No estoy seguro'];
const STATES = ['Registrada', 'En validación', 'Pendiente de información', 'En análisis', 'En planificación', 'Pendiente de aprobación', 'Aprobada', 'Aprobada con condiciones', 'Rechazada', 'Asignada', 'En implementación', 'En pruebas', 'En revisión', 'Correcciones requeridas', 'Cerrada'];
const ITIL = {
  'Estándar': 'Rutinario, documentado, de bajo riesgo y con un procedimiento previamente autorizado.',
  'Normal': 'Requiere evaluación, análisis de riesgos, planificación y autorización ordinaria del CCC.',
  'Emergencia': 'Urgente: evaluación y autorización aceleradas, con planes resumidos pero trazables.'
};
const IMPACT = ['Bajo', 'Medio', 'Alto'];
const LEVELS = ['Baja', 'Media', 'Alta', 'Crítica'];
const FEASIBILITY = ['Viable', 'Viable con condiciones', 'No viable'];
const DECISIONS = ['Aprobado', 'Aprobado con condiciones', 'Rechazado', 'Más información'];
const DECISION_STATUS = { 'Aprobado': 'Aprobada', 'Aprobado con condiciones': 'Aprobada con condiciones', 'Rechazado': 'Rechazada', 'Más información': 'Pendiente de información' };
const OPERATIONS = ['Adición', 'Modificación', 'Eliminación'];
const ENVIRONMENTS = ['Desarrollo', 'Pruebas', 'Producción'];
const DOWNTIME_UNITS = ['minutos', 'horas'];
const ACTIVITY_STATES = ['Pendiente', 'En curso', 'Completada'];
const GIT_KINDS = ['Repositorio', 'Rama', 'Commit', 'Pull request', 'Versión o tag', 'Enlace de evidencia'];
const TEST_STATES = ['Pendiente', 'En ejecución', 'Superada', 'Fallida', 'Bloqueada'];
const TEST_OUTCOMES = ['Todas superadas', 'Existen fallos', 'Pruebas incompletas'];
const ROLLOUT_COMPLIANCE = ['Cumplido', 'Cumplido con desviaciones', 'No cumplido'];
const REVIEW_DECISIONS = ['Conforme', 'Requiere correcciones', 'Implementación fallida', 'Implementación incompleta'];
const BACKOUT_RESULTS = ['Reversión exitosa', 'Reversión parcial', 'Reversión fallida'];
const CLOSURE_RESULTS = ['Exitoso', 'Fallido', 'Incompleto'];
// Etapas de la línea de progreso y estados que agrupan (flujo de referencia: envío → cierre).
const STAGES = [
  ['Solicitud', ['Registrada', 'En validación', 'Pendiente de información']],
  ['Análisis', ['En análisis']],
  ['Planificación', ['En planificación']],
  ['Aprobación', ['Pendiente de aprobación', 'Aprobada', 'Aprobada con condiciones', 'Rechazada']],
  ['Implementación', ['Asignada', 'En implementación', 'Correcciones requeridas']],
  ['Pruebas y revisión', ['En pruebas', 'En revisión']],
  ['Cierre', ['Cerrada']]
];
// Prefijo de la rama de trabajo según el tipo de cambio ITIL.
const BRANCH_PREFIX = { 'Normal': 'feature', 'Estándar': 'feature', 'Emergencia': 'hotfix' };
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ATTACHMENT_TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', log: 'text/plain', json: 'application/json', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip: 'application/zip' };
const ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024;
const ATTACHMENT_MAX_FILES = 5;
module.exports = { BRANCH_PREFIX, PROJECT, MODULES, STATES, ITIL, IMPACT, LEVELS, FEASIBILITY, DECISIONS, DECISION_STATUS, OPERATIONS, ENVIRONMENTS, DOWNTIME_UNITS, ACTIVITY_STATES, GIT_KINDS, TEST_STATES, TEST_OUTCOMES, ROLLOUT_COMPLIANCE, REVIEW_DECISIONS, BACKOUT_RESULTS, CLOSURE_RESULTS, STAGES, SEMVER, ATTACHMENT_TYPES, ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_FILES };

# Transviajes · Control de cambios de BusesUTA

Aplicación académica de la asignatura **Manejo y Configuración del Software** (UTA). Simula de principio a fin el control de cambios de **BusesUTA**, una aplicación de venta de pasajes interprovinciales: solicitud (CRF), análisis, planificación, autorización, asignación, implementación, pruebas, revisión postimplementación y cierre. Incluye además auditoría, reportes e integración con GitHub (una issue por solicitud y verificación de referencias).

Esta aplicación administra las solicitudes; no implementa funciones de BusesUTA como la compra de boletos o los pagos. Es una simulación académica sustentada en buenas prácticas de ACS e ITIL, no una implementación certificada de esos marcos.

El documento [docs/proceso-acs.md](docs/proceso-acs.md) contiene el proceso ACS, la relación teoría–funcionalidad, el diagrama de estados, la matriz de permisos, el diccionario de datos, las decisiones técnicas y la guía de demostración.

## Tecnologías

- **Backend:** Node.js 22.13 o superior (`node:http`, `node:sqlite`, `node:crypto`), sin dependencias externas.
- **Frontend:** HTML, CSS y JavaScript sin framework, servidos por el mismo proceso.
- **Base de datos:** SQLite con transacciones, claves foráneas y disparadores que impiden modificar o borrar la auditoría.
- **GitHub (opcional):** API REST de GitHub para crear una issue por solicitud y verificar ramas, commits, pull requests y tags. Ver [docs/github.md](docs/github.md).

Verificado con Node.js 24 y 25. Algunas versiones muestran una advertencia experimental de SQLite.

## Instalación y ejecución

1. Copia `.env.example` a `.env` y define `SEED_PASSWORD` (mínimo 12 caracteres). Se usa solo al crear una base vacía.
2. Inicia la aplicación (no hace falta `npm install`):

```powershell
npm start
```

3. Abre la dirección que muestra la consola (por defecto `http://127.0.0.1:3000`). Sin sesión se abre el inicio de sesión; desde ahí se puede presentar o consultar una solicitud sin cuenta. Abrir `index.html` directamente no funciona: la autenticación y la API requieren el servidor.

Otros comandos:

```powershell
npm test
```

```powershell
npm run check
```

```powershell
npm run demo:reset
```

```powershell
npm run start:demo
```

```powershell
npm run accounts:sync
```

- `npm test`: pruebas de integración HTTP con bases temporales, más la prueba del cliente por rol.
- `npm run demo:reset`: crea `backend/data/demo.sqlite`, separada de la base real, con los cuatro casos de la defensa.
- `npm run start:demo`: inicia el servidor sobre la base de demostración.
- `npm run accounts:sync`: aplica el equipo de cinco cuentas a una base existente con la contraseña de `.env`, revoca las sesiones y desactiva cuentas antiguas.

## Roles y cuentas

| Cuenta | Perfil |
|---|---|
| `david@uta.edu.ec` | Único miembro del CCC |
| `leslie@uta.edu.ec`, `edwin@uta.edu.ec`, `pablo@uta.edu.ec`, `shirley@uta.edu.ec` | Desarrolladores |

- **Usuario final:** presenta solicitudes sin cuenta. Recibe un código `CRF-000001` y una **clave de seguimiento** para consultar el estado y responder al CCC en **Seguimiento**. El rol `usuario` con cuenta sigue admitido por el modelo.
- **Desarrollador:** presenta CRF técnicos, implementa lo que se le asigna, registra pruebas y revisiones y cierra las solicitudes asignadas.
- **CCC:** recibe, valida, clasifica, analiza, planifica, autoriza, asigna, decide las desviaciones de alcance y puede reabrir solicitudes.

Concentrar análisis y autorización en el CCC es una simplificación académica deliberada; no existe un rol de gestor del cambio. El único miembro del CCC no puede presentar solicitudes, porque nadie podría evaluarlas de forma independiente. La matriz completa está en la documentación.

## Funcionalidades

- **CRF de usuario final y técnico** con una estructura compartida. El servidor genera el código, la fecha y la identidad; estos datos no aparecen como campos del formulario. La casilla «La funcionalidad solicitada todavía no existe» distingue una funcionalidad nueva de un error o ajuste. El formulario técnico añade el tipo de modificación (adición/modificación/eliminación), los componentes técnicos afectados, entorno, versiones (o «No determinada»), spec, reglas de negocio y criterios de aceptación. El solicitante no lo modifica después de la recepción; el CCC puede corregir cualquier campo indicando el motivo, y los datos originales se conservan.
- **Ficha única del CCC** (secciones A–E): clasificación ITIL estándar/normal/emergencia, impacto técnico y funcional, riesgos, urgencia, prioridad (con una sugerencia orientativa), viabilidad, esfuerzo y duración, rollout, backout, plan de pruebas, inactividad, fecha y versión objetivo. Permite guardar borradores, y la decisión forma parte de la misma ficha.
- **Decisiones coherentes:** aprobar exige un análisis y una planificación completos. Un cambio no viable no puede aprobarse: el sistema informa el error. Las condiciones incluyen su forma de verificación. «Más información» no es un rechazo. Las reevaluaciones conservan las decisiones anteriores.
- **Módulos afectados:** el solicitante marca uno o varios módulos de BusesUTA en tarjetas seleccionables; el CCC los confirma con la operación prevista y la decisión autoriza esos módulos.
- **Seguimiento paso a paso del desarrollador:** iniciar, rama de trabajo (`identificador-titulo-descripcionCorta`), desarrollo (actividades, módulos modificados, commits), pull request de la rama de trabajo hacia la base y envío a pruebas. Modificar un módulo no autorizado genera una desviación que el CCC debe decidir.
- **GitHub:** al aprobarse una solicitud se crea su issue, que se asigna al desarrollador, se comenta en cada hito y se cierra con el CRF. El sistema crea la rama de trabajo y el PR, o verifica los existentes. Ver [docs/github.md](docs/github.md).
- **Planes de rollout y backout en Markdown** dentro de la ficha del CCC, con vista previa. El CRF técnico propone el tipo ITIL y la versión actual es opcional.
- **Panel con filtros** por fechas, usuario, estado, módulo, tipo ITIL y prioridad, y **sección de auditoría** en cada expediente.
- **Pruebas, revisión y cierre** en una sola sección del expediente. Las ejecuciones de prueba se conservan y las fallidas devuelven la solicitud a correcciones.
- **Revisión postimplementación**, **backout ejecutado** (documentado, no simulado) y **cierre** exitoso, fallido o incompleto, separado del resultado de autorización y del administrativo. El CCC puede reabrir una solicitud cerrada.
- **Auditoría persistente** de solo inserción, un panel por rol y **reportes** con filtros, gráficos, métricas calculadas con datos reales y exportación a CSV.
- **Adjuntos reales** (5 archivos de 2 MB por envío, extensiones permitidas), guardados fuera de la carpeta pública y descargables solo con permiso.

## API principal

Las rutas autenticadas que modifican datos requieren el encabezado `X-CSRF-Token`. Las acciones sobre una solicitud requieren su `revision` actual.

| Método y ruta | Uso |
|---|---|
| `GET /api/catalog` | Catálogos (módulos, estados, ITIL, etc.) |
| `POST /api/public/requests` | CRF sin cuenta. Devuelve código, fecha, estado y clave de seguimiento |
| `POST /api/public/track` · `/api/public/track/clarification` | Consulta limitada y respuesta del solicitante sin cuenta (código y clave) |
| `POST /api/auth/login` · `GET /api/auth/me` · `POST /api/auth/logout` | Sesión |
| `GET /api/requests` · `POST /api/requests` | Listado visible según el rol · crear CRF |
| `GET /api/requests/:id` | Expediente con adjuntos, eventos de auditoría y módulos autorizados |
| `PATCH` / `DELETE /api/requests/:id` | Editar o eliminar un CRF propio aún no recibido; el CCC corrige con `PATCH` y `correctionReason` |
| `POST /api/requests/:id/:acción` | `receive`, `validate`, `request-info`, `clarification`, `evaluation` (`step`: draft/analysis/planning), `decision`, `reevaluate`, `assign`, `start`, `branch`, `pull-request`, `git-refresh`, `module-change`, `activity`, `git`, `deviation`, `scope`, `send-to-tests`, `test`, `finish-tests`, `backout`, `review`, `close`, `close-rejected`, `reopen` |
| `POST /api/requests/:id/attachments` · `GET /api/attachments/:id` | Subir y descargar archivos |
| `POST /api/requests/:id/github-issue` · `GET /api/github/status` | Crear o sincronizar la issue (CCC) · estado de la conexión con GitHub |
| `GET /api/reports` · `GET /api/reports.csv` · `GET /api/audit` | Reportes, CSV y auditoría |

No existe una ruta para fijar el estado libremente. El código, la identidad, los roles, las fechas, el estado y los responsables nunca se toman del cliente.

## Datos existentes y migración

Al abrir una base anterior se aplica una sola vez la migración al modelo 4:

- `SCR-0001` pasa a `CRF-000001` y la API acepta ambos códigos.
- Los análisis, resoluciones y nombres de adjuntos anteriores se conservan en `legacy`.
- Las aprobaciones antiguas sin rollout ni backout quedan marcadas y deben reevaluarse antes de asignar.
- Cada migración queda registrada en la auditoría.

## Seguridad

- Contraseñas con scrypt y sal.
- Cookie de sesión `HttpOnly` y `SameSite=Strict`, con el token guardado como hash. Duración de 8 horas.
- CSRF y verificación de origen en las escrituras.
- Límites de intentos de login, de envíos públicos y de consultas de seguimiento.
- Consultas parametrizadas, CSP estricta y lista explícita de archivos públicos.

`COOKIE_SECURE=true` activa la cookie `Secure` para HTTPS. El servidor escucha en `127.0.0.1` por defecto.

Limitaciones conocidas:

- No se envían correos: los avisos se ven en el expediente y en el seguimiento.
- No hay integración con la API de GitHub.
- Los límites de intentos se guardan en memoria y se reinician con el servidor.
- Si una transacción falla después de escribir un adjunto, el archivo queda en disco sin registro.

## Organización

```text
backend/
  server.cjs          HTTP, rutas y archivos públicos permitidos
  database.cjs        Esquema SQLite, disparadores y migraciones
  migrate.cjs         Conversión de documentos al modelo 4
  catalog.cjs         Catálogos compartidos
  service.cjs         CRF, ficha del CCC y flujo completo con permisos
  github.cjs          Issues y verificación de referencias en GitHub
  reports.cjs         Indicadores, métricas y CSV
  audit.cjs           Auditoría de solo inserción
  files.cjs           Adjuntos
  auth.cjs            Contraseñas, cuentas iniciales y sesiones
  configure-team.cjs  Sincronización del equipo
  demo.cjs            Base de demostración separada
js/app.js             Cliente (pantallas por rol)
css/styles.css        Estilos adaptables
docs/proceso-acs.md   Documentación del proceso y del modelo
tests/                Pruebas de integración y del cliente
wireframe.html        Boceto original de referencia
```

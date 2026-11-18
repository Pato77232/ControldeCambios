# Transviajes · Control de cambios de BusesUTA

Aplicación académica de la asignatura **Manejo y Configuración del Software** (UTA). Simula de principio a fin el control de cambios de **BusesUTA**, una aplicación de venta de pasajes interprovinciales: solicitud (CRF), análisis, planificación, autorización, asignación, implementación, pruebas, revisión postimplementación y cierre. Incluye además un catálogo de ICS, líneas base, auditoría y reportes.

Esta aplicación administra las solicitudes; no implementa funciones de BusesUTA como la compra de boletos o los pagos. Es una simulación académica sustentada en buenas prácticas de ACS e ITIL, no una implementación certificada de esos marcos.

El documento [docs/proceso-acs.md](docs/proceso-acs.md) contiene el proceso ACS, la relación teoría–funcionalidad, el diagrama de estados, la matriz de permisos, el diccionario de datos, las decisiones técnicas y la guía de demostración.

## Tecnologías

- **Backend:** Node.js 22.13 o superior (`node:http`, `node:sqlite`, `node:crypto`), sin dependencias externas.
- **Frontend:** HTML, CSS y JavaScript sin framework, servidos por el mismo proceso.
- **Base de datos:** SQLite con transacciones, claves foráneas, restricciones únicas y disparadores que protegen la auditoría, las revisiones y las líneas base aprobadas.

Verificado con Node.js 24 y 25. Algunas versiones muestran una advertencia experimental de SQLite.

## Instalación y ejecución

1. Copia `.env.example` a `.env` y define `SEED_PASSWORD` (mínimo 12 caracteres). Se usa solo al crear una base vacía.
2. Inicia la aplicación (no hace falta `npm install`):

```powershell
npm start
```

3. Abre la dirección que muestra la consola (por defecto `http://127.0.0.1:3000`). Abrir `index.html` directamente no funciona: la autenticación y la API requieren el servidor.

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
- **Desarrollador:** presenta CRF técnicos, propone ICS, implementa lo que se le asigna, registra pruebas y revisiones y cierra las solicitudes asignadas.
- **CCC:** recibe, valida, clasifica, analiza, planifica, autoriza, asigna, decide las desviaciones de alcance, gestiona ICS y líneas base, y puede reabrir solicitudes.

Concentrar análisis y autorización en el CCC es una simplificación académica deliberada; no existe un rol de gestor del cambio. El único miembro del CCC no puede presentar solicitudes, porque nadie podría evaluarlas de forma independiente. La matriz completa está en la documentación.

## Funcionalidades

- **CRF de usuario final y técnico** con una estructura compartida. El servidor genera el código, la fecha y la identidad. El formulario técnico añade el tipo de modificación (adición/modificación/eliminación), los ICS potencialmente afectados (del catálogo o sugeridos), entorno, versiones (o «No determinada»), spec, reglas de negocio y criterios de aceptación. El contenido original no se modifica después de la recepción.
- **Ficha única del CCC** (secciones A–E): clasificación ITIL estándar/normal/emergencia, impacto técnico y funcional, riesgos, urgencia, prioridad (con una sugerencia orientativa), viabilidad, esfuerzo y duración, rollout, backout, plan de pruebas, inactividad, fecha y versión objetivo. Permite guardar borradores, y la decisión forma parte de la misma ficha.
- **Decisiones coherentes:** aprobar exige un análisis y una planificación completos. Un cambio no viable requiere una excepción explícita. Las condiciones incluyen su forma de verificación. «Más información» no es un rechazo. Las reevaluaciones conservan las decisiones anteriores.
- **Implementación por rondas** con actividades, referencias de GitHub registradas manualmente (no verificadas), ICS realmente modificados con revisión anterior y nueva, y desviaciones de alcance que el CCC debe autorizar.
- **Pruebas** cuyas ejecuciones se conservan. Las fallidas devuelven la solicitud a correcciones.
- **Revisión postimplementación**, **backout ejecutado** (documentado, no simulado) y **cierre** exitoso, fallido o incompleto, separado del resultado de autorización y del administrativo. El CCC puede reabrir una solicitud cerrada.
- **Catálogo de ICS** (`ICS-BUS-###`): categorías configurables, objetos básicos y agregados, jerarquía sin ciclos, dependencias, revisiones inmutables y trazabilidad con las solicitudes.
- **Líneas base** (`LB-BUS-###`): borrador → revisión → aprobada o rechazada. La composición aprobada queda congelada y se pueden crear líneas base derivadas.
- **Auditoría persistente** de solo inserción, una vista de auditoría de configuración por solicitud, un panel por rol y **reportes** con filtros, gráficos, métricas calculadas con datos reales y exportación a CSV.
- **Adjuntos reales** (5 archivos de 2 MB por envío, extensiones permitidas), guardados fuera de la carpeta pública y descargables solo con permiso.

## API principal

Las rutas autenticadas que modifican datos requieren el encabezado `X-CSRF-Token`. Las acciones sobre una solicitud requieren su `revision` actual.

| Método y ruta | Uso |
|---|---|
| `GET /api/catalog` | Catálogos (módulos, estados, ITIL, etc.) |
| `POST /api/public/requests` | CRF sin cuenta. Devuelve código, fecha, estado y clave de seguimiento |
| `POST /api/public/track` · `/api/public/track/clarification` | Consulta limitada y respuesta del solicitante sin cuenta (código y clave) |
| `GET /api/public/dashboard` | Totales agregados, sin datos personales |
| `POST /api/auth/login` · `GET /api/auth/me` · `POST /api/auth/logout` | Sesión |
| `GET /api/requests` · `POST /api/requests` | Listado visible según el rol · crear CRF |
| `GET /api/requests/:id` | Expediente con ICS, adjuntos, auditoría y auditoría de configuración |
| `PATCH` / `DELETE /api/requests/:id` | Editar o eliminar un CRF propio aún no recibido |
| `POST /api/requests/:id/:acción` | `receive`, `validate`, `request-info`, `clarification`, `evaluation` (`step`: draft/analysis/planning), `decision`, `reevaluate`, `assign`, `start`, `activity`, `git`, `ics-change`, `deviation`, `scope`, `send-to-tests`, `test`, `finish-tests`, `backout`, `review`, `close`, `close-rejected`, `reopen` |
| `POST /api/requests/:id/attachments` · `GET /api/attachments/:id` | Subir y descargar archivos |
| `GET`/`POST /api/ics`, `GET`/`PATCH /api/ics/:código`, `POST /api/ics/:código/revisions`, `POST`/`DELETE /api/ics/:código/relations` | Catálogo de ICS |
| `GET`/`POST /api/baselines`, `POST /api/baselines/:código/(items\|submit\|decide\|delete)` | Líneas base |
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
  ics.cjs             ICS, revisiones, relaciones y líneas base
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

# ChangeFlow · Control de cambios de ProyectoBusesUTA

Aplicación académica de la UTA con frontend HTML/CSS/JavaScript, API Node.js y base SQLite. Incluye login, permisos por perfil, análisis del CCC, votos individuales y resolución formal. El backend utiliza módulos de Node.js, sin dependencias externas.

## Iniciar

Requisito: **Node.js 22.13 o superior**, con `node:sqlite` disponible. Verificado con Node.js 25.9.0; algunas versiones muestran una advertencia experimental de SQLite.

1. Para una instalación nueva, copia `.env.example` a `.env` y establece `SEED_PASSWORD` (mínimo 12 caracteres).
2. Ejecuta `npm start`. No hace falta `npm install` porque no hay dependencias.
3. Abre la dirección que muestra la consola. El puerto predeterminado es 3000.

```bash
npm start
npm run check
npm test
```

El frontend y la API se sirven desde el mismo proceso. Abrir `index.html` directamente o con Live Server no permite usar la autenticación ni guardar peticiones.

## Cuentas iniciales

Al crear una base vacía se generan diez cuentas, todas con la contraseña inicial definida localmente en `SEED_PASSWORD`:

| Cuenta | Perfil | Acceso |
|---|---|---|
| `leslie@uta.edu.ec`, `david@uta.edu.ec`, `edwin@uta.edu.ec`, `pablo@uta.edu.ec`, `shirley@uta.edu.ec` | Expertos | Cada uno crea y consulta sus propias solicitudes. |
| `pablomiembroccc@uta.edu.ec` | CCC activo | Consulta y revisa todas las solicitudes; no puede crear una propia. |
| `lesliemiembroccc@uta.edu.ec`, `davidmiembroccc@uta.edu.ec`, `edwinmiembroccc@uta.edu.ec`, `shirleymiembroccc@uta.edu.ec` | CCC inactivos | Existen en la base, pero no pueden iniciar sesión. |

La contraseña inicial de las cuentas se configura en `SEED_PASSWORD` dentro de tu `.env` local. `.env` y la base están excluidos de Git y no son accesibles desde el servidor de archivos.

Las cuentas se crean solo una vez. Cambiar `SEED_PASSWORD` no cambia las contraseñas de una base existente. No hay registro público, recuperación de contraseñas ni administración de cuentas en la interfaz. Para borrar **todos** los usuarios, sesiones y solicitudes anteriores y volver a cargar estas diez cuentas, ejecuta `SEED_PASSWORD=<clave-de-al-menos-12-caracteres> npm run reset:data` con el servidor detenido. El reinicio de datos no ocurre al arrancar normalmente.

## Flujo y permisos

```text
Formulario público → Petición del usuario final (sin cuenta)
Login → Petición del experto
      → Análisis del CCC
      → Voto individual de cada participante
      → Resolución: aprobado / condicionado / rechazado / más información
```

Con sesión iniciada, el nombre y correo del experto proceden de su sesión. Sin cuenta, el usuario final proporciona su nombre y correo, que se registran como datos de contacto sin verificar. El correo no vincula la solicitud a una cuenta existente. El CCC no puede crear solicitudes, ni siquiera mediante la API.

Cada solicitante ve exclusivamente sus peticiones. El CCC puede consultar todas. La edición y eliminación se permiten solo al dueño, mientras la petición esté pendiente y aún no tenga análisis. Las restricciones se validan en el servidor, incluso si alguien intenta saltarse los controles de la interfaz.

### Análisis

El CCC registra impacto, impacto técnico, riesgos, viabilidad, esfuerzo, recursos, consideraciones y prioridad. El servidor obtiene la identidad del analista y la fecha. Actualizar el análisis invalida los votos previos y exige votar nuevamente.

### Votos y resolución

El flujo de voto permanece temporalmente en esta versión: PabloMiembroCCC registra su propio voto antes de la resolución. La historia HU-08 del plan lo sustituirá por una decisión directa. El solicitante queda excluido por su ID de cuenta, no por comparar nombres.

La resolución actual debe coincidir con el voto registrado por la única cuenta CCC activa.

- **Aprobado:** finaliza la revisión; no significa que el cambio esté implementado.
- **Aprobado con condiciones:** exige un texto con las restricciones o requisitos y finaliza la revisión.
- **Rechazado:** exige motivo y finaliza la revisión.
- **Más información:** conserva la resolución y mantiene abierto el expediente. El solicitante puede responder desde el detalle; su respuesta requiere un nuevo análisis y nuevos votos.

El análisis, cada voto y las resoluciones se incorporan al historial. Cada resolución guarda la copia del análisis utilizado, participantes, votos, condiciones, responsable autenticado y fecha del servidor. Las resoluciones anteriores permanecen consultables.

El botón **Actualizar** consulta cambios de otros participantes. Cada petición tiene una revisión numérica: un intento de guardar desde una versión antigua recibe un conflicto y recarga el expediente para evitar sobrescribir cambios ajenos. Actualizar la vista descarta los campos que aún no se hayan guardado.

## Organización

```text
backend/
  server.cjs       HTTP, rutas de API y archivos públicos permitidos
  database.cjs     Esquema SQLite y transacciones
  auth.cjs         Contraseñas, cuentas iniciales y sesiones
  service.cjs      Validación, permisos y flujo de cambios
  data/            Base y archivos SQLite (privados, excluidos de Git)
js/
  app.js           Pantallas, sesión y comunicación con la API
  print.js         Impresión del boceto
css/styles.css     Estilos adaptables
index.html         Estructura del cliente
wireframe.html     Boceto de los cuatro formularios
.env.example       Configuración de referencia
package.json       Comandos de inicio y pruebas
tests/
  backend.test.cjs Integración HTTP y persistencia real
  flow.cjs         Manejadores del cliente con API controlada
```

## API

Las rutas de login, `POST /api/public/requests` y `GET /api/public/status` no requieren sesión; las demás rutas de API sí. Las modificaciones autenticadas, salvo login, requieren el encabezado `X-CSRF-Token`, obtenido al iniciar o recuperar la sesión. Todas las modificaciones de una petición existente requieren su `revision` actual en el cuerpo JSON.

| Método y ruta | Uso |
|---|---|
| `POST /api/public/requests` | Crear una solicitud de usuario final sin cuenta; devuelve solo un comprobante con código, fecha y estado. |
| `GET /api/public/status?code=...` | Consultar etapa, resultado y línea de tiempo pública con un código de seguimiento. |
| `POST /api/auth/login` | Correo y contraseña; establece cookie y devuelve usuario y token CSRF. |
| `GET /api/auth/me` | Recuperar identidad y token CSRF de la sesión vigente. |
| `POST /api/auth/logout` | Revocar la sesión. |
| `GET /api/committee` | Catálogo de miembros para el CCC. |
| `GET /api/requests` | Peticiones visibles según el perfil. |
| `POST /api/requests` | Registrar petición; genera código, fecha y propietario. |
| `PATCH /api/requests/:id` | Editar una petición propia antes del análisis. |
| `DELETE /api/requests/:id` | Eliminar una petición propia aún sin analizar. |
| `POST /api/requests/:id/analysis` | Registrar análisis del CCC y renovar la etapa de votación. |
| `POST /api/requests/:id/vote` | Voto del miembro autenticado. |
| `POST /api/requests/:id/resolution` | Resolución con `members`, `decision`, `decisionNote` y `conditions` si corresponde. |
| `POST /api/requests/:id/clarification` | Respuesta del solicitante: `note`. |

No hay una ruta para reemplazar todo el historial o alterar libremente el estado. Código, identidad, roles, fecha, estado y votos de otros integrantes no se toman de campos enviados por el cliente.

## Almacenamiento y sesiones

La base se crea en `backend/data/changeflow.sqlite`, o en `DB_PATH` si se configura. SQLite conserva usuarios, sesiones y peticiones entre reinicios. Usa transacciones para las modificaciones y un contador que no reutiliza los códigos eliminados. Las peticiones se almacenan como documentos JSON vinculados a un dueño; es una estructura sencilla para este prototipo.

Las contraseñas se almacenan mediante scrypt con sal independiente. Las sesiones duran ocho horas; el navegador recibe una cookie HttpOnly y SameSite=Strict, y el servidor guarda el hash del token. Logout revoca la sesión. Las escrituras validan CSRF y origen; el login limita los intentos fallidos. Se emplean consultas parametrizadas y una lista explícita de archivos públicos.

`COOKIE_SECURE=true` activa la cookie Secure para servir la aplicación mediante HTTPS. El servidor enlaza a `127.0.0.1` por defecto. No incluye infraestructura de despliegue, HTTPS, recuperación de cuentas ni administración empresarial de usuarios.

Los datos antiguos de `localStorage` no se importan automáticamente: no tienen identidad autenticada. La operación `reset:data` vacía la base SQLite y vuelve a crear las diez cuentas acordadas.

Los adjuntos continúan guardando únicamente nombres; no hay subida ni descarga real de archivos. El historial no es una auditoría externa inmutable.

## Validación

`npm test` utiliza bases temporales y servidores locales efímeros. Comprueba las diez cuentas iniciales, la única cuenta CCC activa, permisos por rol, registro público sin cuenta, análisis y resolución actuales, persistencia y reinicio explícito de datos.

La prueba del cliente verifica el formulario experto, el formulario público, la ausencia de «Nueva solicitud» para el CCC y el envío del voto y resolución actuales a la API.

Para demostrarlo manualmente: entra como Leslie y crea una solicitud; luego entra como PabloMiembroCCC para analizarla y resolverla. Las pestañas del mismo perfil de navegador comparten la cookie de sesión.

## Diseño BusesUTA

Los cuatro formularios utilizan la cabecera BusesUTA, las etapas Solicitud / Análisis / Decisión y las guías de los mockups. La guía lateral pasa debajo del formulario en pantallas pequeñas. Las áreas de texto incluyen contadores y la resolución muestra los resúmenes de solicitud y análisis.

El tipo de solicitud se conserva en el servidor. El desarrollador puede indicar una prioridad propuesta; el CCC conserva la responsabilidad de establecer la prioridad durante el análisis. Se mantienen los campos requeridos por el flujo existente, los votos individuales y las restricciones por perfil. Los adjuntos siguen registrando solo nombres. Los botones de envío guardan en el servidor; no se simulan borradores ni cargas de archivos.

## Solicitudes sin cuenta

Al abrir la aplicación sin sesión se muestra directamente el formulario de usuario final. El enlace **Iniciar sesión** permite entrar a las funciones de desarrollador, CCC y consulta de solicitudes propias de cuentas existentes.

El visitante indica nombre y correo, completa el formulario y recibe un código aleatorio `CONS-…` en el comprobante. Desde **Consultar estado** puede introducirlo después, sin cuenta, para ver únicamente etapa, fechas, resultado y resúmenes generales. No se permite editar ni eliminar la solicitud desde la consulta pública. Quien tenga el código puede consultar ese resumen: debe guardarlo. No se envían correos automáticos ni se verifica la titularidad del correo en este prototipo.

El endpoint de registro admite únicamente solicitudes de usuario final y no devuelve el expediente ni el listado. Valida campos, origen y contenido JSON, y limita los envíos a 20 por hora por dirección IP. La consulta pública limita los intentos a 30 por hora por dirección IP y nunca devuelve nombre, correo, título, descripción, justificación ni análisis completo. Los comprobantes anteriores que solo tenían `SCR-000n` pueden consultar su resumen si corresponden a una solicitud pública anterior sin código `CONS`; las solicitudes nuevas no se consultan por `SCR-000n`.

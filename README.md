# ChangeFlow · Control de cambios de ProyectoBusesUTA

Aplicación académica de la UTA con frontend HTML/CSS/JavaScript, API Node.js y base SQLite. Incluye login, permisos por perfil, análisis del CCC, votos individuales y resolución formal. El backend utiliza módulos de Node.js, sin dependencias externas.

## Iniciar

Requisito: **Node.js 22.13 o superior**, con `node:sqlite` disponible. Verificado con Node.js 25.9.0; algunas versiones muestran una advertencia experimental de SQLite.

1. Para una instalación nueva, copia `.env.example` a `.env` y establece `SEED_PASSWORD` (mínimo 12 caracteres).
2. Ejecuta `npm start`. No hace falta `npm install` porque no hay dependencias.
3. Abre la dirección que muestra la consola. El puerto predeterminado es 3000; en este equipo `.env` utiliza **3010** porque el 3000 estaba ocupado.

```bash
npm start
npm run check
npm test
```

El frontend y la API se sirven desde el mismo proceso. Abrir `index.html` directamente o con Live Server no permite usar la autenticación ni guardar peticiones.

## Cuentas iniciales

Al crear una base vacía se generan estas cuatro cuentas, todas con la contraseña inicial definida en `SEED_PASSWORD`:

| Cuenta | Perfil | Acceso |
|---|---|---|
| `ana@changeflow.local` | Usuario final | Crea peticiones de usuario, consulta y edita las suyas antes del análisis. |
| `diego@changeflow.local` | Desarrollador | Crea peticiones técnicas, consulta y edita las suyas antes del análisis. |
| `carlos@changeflow.local` | CCC | Consulta todas las peticiones, realiza análisis, registra su voto y resoluciones. |
| `maria@changeflow.local` | CCC | Los mismos permisos que Carlos, con sesión y voto independientes. |

La contraseña inicial de las cuentas se configura en `SEED_PASSWORD` dentro de tu `.env` local. `.env` y la base están excluidos de Git y no son accesibles desde el servidor de archivos.

Las cuentas se crean solo una vez. Cambiar `SEED_PASSWORD` no cambia las contraseñas de una base existente. No hay registro público, recuperación de contraseñas ni administración de cuentas en la interfaz.

## Flujo y permisos

```text
Formulario público → Petición del usuario final (sin cuenta)
Login → Petición del usuario final o del desarrollador
      → Análisis del CCC
      → Voto individual de cada participante
      → Resolución: aprobado / condicionado / rechazado / más información
```

Con sesión iniciada, el nombre y correo del solicitante proceden de su sesión. Sin cuenta, el usuario final proporciona su nombre y correo, que se registran como datos de contacto sin verificar. El correo no vincula la solicitud a una cuenta existente. Un usuario final no puede enviar una petición con perfil de desarrollador. Un miembro del CCC puede crear una petición, pero otro integrante debe analizarla y decidir sobre ella.

Cada solicitante ve exclusivamente sus peticiones. El CCC puede consultar todas. La edición y eliminación se permiten solo al dueño, mientras la petición esté pendiente y aún no tenga análisis. Las restricciones se validan en el servidor, incluso si alguien intenta saltarse los controles de la interfaz.

### Análisis

El CCC registra impacto, impacto técnico, riesgos, viabilidad, esfuerzo, recursos, consideraciones y prioridad. El servidor obtiene la identidad del analista y la fecha. Actualizar el análisis invalida los votos previos y exige votar nuevamente.

### Votos y resolución

Cada integrante inicia sesión y registra **su propio voto**. Nadie puede registrar el de otra persona. Se seleccionan uno o dos participantes para la resolución; todos deben haber votado y debe incluirse a todos los que ya emitieron un voto vigente. El responsable de registrar la resolución debe ser uno de ellos. El solicitante queda excluido por su ID de cuenta, no por comparar nombres.

Con un participante, la resolución coincide con su voto. Con dos, requiere unanimidad; ante desacuerdo solo se permite **Más información**. El servidor comprueba los votos almacenados, no acepta votos inventados en el formulario de resolución.

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

Las rutas de login y `POST /api/public/requests` no requieren sesión; las demás rutas de API sí. Las modificaciones autenticadas, salvo login, requieren el encabezado `X-CSRF-Token`, obtenido al iniciar o recuperar la sesión. Todas las modificaciones de una petición existente requieren su `revision` actual en el cuerpo JSON.

| Método y ruta | Uso |
|---|---|
| `POST /api/public/requests` | Crear una solicitud de usuario final sin cuenta; devuelve solo un comprobante con código, fecha y estado. |
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

Los datos antiguos de `localStorage` no se borran ni se importan automáticamente: no tienen identidad autenticada y no se pueden convertir sus nombres en autorizaciones reales. La base del servidor empieza vacía. Para verificar visualmente esta versión se creó una petición claramente marcada como **Demostración**, con aprobación condicionada y votos de ambas cuentas del CCC.

Los adjuntos continúan guardando únicamente nombres; no hay subida ni descarga real de archivos. La base contiene datos de demostración y el historial no es una auditoría externa inmutable.

## Validación

`npm test` utiliza una base temporal y servidores locales efímeros. Comprueba login, sesión y logout; intentos fallidos; CSRF; archivos privados; perfiles y visibilidad; validación de campos; identidad no falsificable; edición y eliminación; códigos; análisis previo; votos independientes; aprobación simple y condicionada; rechazo; desacuerdos; solicitud y respuesta de información; revisión independiente; conflictos de versiones; y persistencia al reiniciar.

La prueba del cliente verifica recuperación de sesión, formulario por perfil, identidad de solo lectura, rutas protegidas y envío de votos/resoluciones a la API. La revisión en navegador completó solicitud, análisis, dos sesiones del CCC, votos separados y aprobación con condiciones.

Para demostrarlo manualmente: entra como Ana y crea una solicitud; entra como Carlos para analizarla y votar; entra como María para votar y resolver. Para simular participantes simultáneos utiliza perfiles de navegador distintos, ya que las pestañas del mismo perfil comparten la cookie de sesión.

## Diseño BusesUTA

Los cuatro formularios utilizan la cabecera BusesUTA, las etapas Solicitud / Análisis / Decisión y las guías de los mockups. La guía lateral pasa debajo del formulario en pantallas pequeñas. Las áreas de texto incluyen contadores y la resolución muestra los resúmenes de solicitud y análisis.

El tipo de solicitud se conserva en el servidor. El desarrollador puede indicar una prioridad propuesta; el CCC conserva la responsabilidad de establecer la prioridad durante el análisis. Se mantienen los campos requeridos por el flujo existente, los votos individuales y las restricciones por perfil. Los adjuntos siguen registrando solo nombres. Los botones de envío guardan en el servidor; no se simulan borradores ni cargas de archivos.

## Solicitudes sin cuenta

Al abrir la aplicación sin sesión se muestra directamente el formulario de usuario final. El enlace **Iniciar sesión** permite entrar a las funciones de desarrollador, CCC y consulta de solicitudes propias de cuentas existentes.

El visitante indica nombre y correo, completa el formulario y recibe un código como comprobante. Su solicitud queda disponible para el CCC. No se crea una cuenta ni una sesión, y no se permite consultar, editar o eliminar solicitudes públicas desde el navegador anónimo. El código no es una credencial de acceso. No se envían correos automáticos ni se verifica la titularidad del correo en este prototipo.

El endpoint público admite únicamente solicitudes de usuario final y no devuelve el expediente ni el listado. Valida campos, origen y contenido JSON, y limita los intentos a 20 por hora por dirección IP. La migración a la versión 2 permite solicitudes sin propietario de cuenta conservando los registros y el contador de códigos anteriores.

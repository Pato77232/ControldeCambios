# Transviajes · Control de cambios de ProyectoBusesUTA

Aplicación académica de la UTA con frontend HTML/CSS/JavaScript, API Node.js y base SQLite. Incluye login, permisos por perfil, análisis y resolución formal a cargo de un único integrante del CCC. El backend utiliza módulos de Node.js, sin dependencias externas.

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

Al crear una base vacía se generan cinco cuentas personales. La contraseña inicial se define en `SEED_PASSWORD` dentro de `.env`:

| Cuenta | Perfil |
|---|---|
| `leslie@uta.edu.ec` | Desarrollador |
| `david@uta.edu.ec` | Único miembro del CCC |
| `edwin@uta.edu.ec` | Desarrollador |
| `pablo@uta.edu.ec` | Desarrollador |
| `shirley@uta.edu.ec` | Desarrollador |

Para aplicar este equipo a una base existente y establecer la contraseña de `.env`:

```bash
npm run accounts:sync
```

El comando activa estas cinco cuentas, asigna únicamente a David el rol CCC y desactiva las demás. No elimina solicitudes ni identidades históricas. Revoca las sesiones anteriores, por lo que todos deben iniciar sesión nuevamente. Las peticiones pendientes a cargo de un antiguo integrante requieren un nuevo análisis; el anterior se conserva en `previousAnalyses` y el cambio queda registrado en el historial. Las resoluciones ya finalizadas no se modifican.

La contraseña no se incluye en Git. Cambiar `.env` por sí solo no cambia contraseñas existentes: el comando anterior debe ejecutarse deliberadamente. No hay registro público de cuentas ni recuperación de contraseñas en la interfaz.

## Flujo y permisos

```text
Formulario público → Petición del usuario final (sin cuenta)
Login → Petición del usuario final o del desarrollador
      → Análisis del CCC
      → Resolución: aprobado / condicionado / rechazado / más información
```

Con sesión iniciada, el nombre y correo del solicitante proceden de su sesión. Sin cuenta, el usuario final proporciona su nombre y correo, que se registran como datos de contacto sin verificar. El correo no vincula la solicitud a una cuenta existente. Un usuario final no puede enviar una petición con perfil de desarrollador. Un miembro del CCC puede crear una petición, pero otro integrante debe analizarla y decidir sobre ella.

Cada solicitante con perfil de usuario final ve exclusivamente sus peticiones. El desarrollador consulta las propias y las presentadas sin cuenta. El CCC puede consultar todas. La edición y eliminación se permiten solo al dueño, mientras la petición esté pendiente y aún no tenga análisis. Las restricciones se validan en el servidor, incluso si alguien intenta saltarse los controles de la interfaz.

### Análisis

El CCC registra impacto, impacto técnico, riesgos, viabilidad, esfuerzo, recursos, consideraciones y prioridad. El servidor obtiene la identidad del analista y la fecha. El primer análisis asigna la petición a ese integrante, que será responsable de revisarla y resolverla. Otro integrante puede consultar el expediente, pero no modificar su análisis ni registrar su resolución.

### Resolución por el responsable del análisis

El mismo integrante del CCC que guardó el análisis registra la decisión final, su motivo y las condiciones cuando corresponda. No hay votaciones ni selección de participantes. El servidor comprueba la identidad autenticada y que el análisis pertenece al responsable; ningún integrante puede evaluar o resolver su propia petición.

- **Aprobado:** finaliza la revisión; no significa que el cambio esté implementado.
- **Aprobado con condiciones:** exige un texto con las restricciones o requisitos y finaliza la revisión.
- **Rechazado:** exige motivo y finaliza la revisión.
- **Más información:** conserva la resolución y mantiene abierto el expediente. El solicitante puede responder desde el detalle; su respuesta requiere un nuevo análisis del mismo responsable.

El análisis y las resoluciones se incorporan al historial. Cada resolución guarda la copia del análisis utilizado, las condiciones, el responsable autenticado y la fecha del servidor. Las votaciones de expedientes antiguos se conservan como datos históricos, sin intervenir en las nuevas resoluciones. Las resoluciones anteriores permanecen consultables.

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
| `POST /api/requests/:id/resolution` | Resolución con `decision`, `decisionNote` y `conditions` si corresponde; solo por el analista autenticado. |
| `POST /api/requests/:id/clarification` | Respuesta del solicitante: `note`. |

No hay una ruta para reemplazar todo el historial o alterar libremente el estado. Código, identidad, roles, fecha, estado y responsable del análisis no se toman de campos enviados por el cliente.

## Almacenamiento y sesiones

La base se crea en `backend/data/changeflow.sqlite`, o en `DB_PATH` si se configura. SQLite conserva usuarios, sesiones y peticiones entre reinicios. Usa transacciones para las modificaciones y un contador que no reutiliza los códigos eliminados. Las peticiones se almacenan como documentos JSON vinculados a un dueño; es una estructura sencilla para este prototipo.

Las contraseñas se almacenan mediante scrypt con sal independiente. Las sesiones duran ocho horas; el navegador recibe una cookie HttpOnly y SameSite=Strict, y el servidor guarda el hash del token. Logout revoca la sesión. Las escrituras validan CSRF y origen; el login limita los intentos fallidos. Se emplean consultas parametrizadas y una lista explícita de archivos públicos.

`COOKIE_SECURE=true` activa la cookie Secure para servir la aplicación mediante HTTPS. El servidor enlaza a `127.0.0.1` por defecto. No incluye infraestructura de despliegue, HTTPS, recuperación de cuentas ni administración empresarial de usuarios.

Los datos antiguos de `localStorage` no se borran ni se importan automáticamente: no tienen identidad autenticada y no se pueden convertir sus nombres en autorizaciones reales. La base del servidor empieza vacía. Para verificar visualmente esta versión se creó una petición claramente marcada como **Demostración**, con aprobación condicionada. Los registros de la versión anterior conservan su historial.

Los adjuntos continúan guardando únicamente nombres; no hay subida ni descarga real de archivos. La base contiene datos de demostración y el historial no es una auditoría externa inmutable.

## Validación

`npm test` utiliza una base temporal y servidores locales efímeros. Comprueba login, sesión y logout; intentos fallidos; CSRF; archivos privados; perfiles y visibilidad; validación de campos; identidad no falsificable; edición y eliminación; códigos; análisis previo; responsable único; aprobación simple y condicionada; rechazo; bloqueo de resolución por otro integrante; solicitud y respuesta de información; revisión independiente; conflictos de versiones; y persistencia al reiniciar.

La prueba del cliente verifica recuperación de sesión, formulario por perfil, identidad de solo lectura, rutas protegidas y resolución por el analista autenticado. La revisión comprueba que no existen controles de votación ni selección de participantes.

Para demostrarlo manualmente: presenta una solicitud sin cuenta o entra como Ana para crearla; entra como Carlos para analizarla y registrar directamente la resolución. María podrá consultar esa petición, pero no analizarla ni cerrarla. Para simular participantes simultáneos utiliza perfiles de navegador distintos, ya que las pestañas del mismo perfil comparten la cookie de sesión.

## Diseño Transviajes

Los cuatro formularios utilizan la cabecera Transviajes, las etapas Solicitud / Análisis / Decisión y las guías de los mockups. La guía lateral pasa debajo del formulario en pantallas pequeñas. Las áreas de texto incluyen contadores y la resolución muestra los resúmenes de solicitud y análisis.

El tipo de solicitud se conserva en el servidor. El desarrollador puede indicar una prioridad propuesta; el CCC conserva la responsabilidad de establecer la prioridad durante el análisis. Se mantienen los campos requeridos por el flujo existente, el responsable único y las restricciones por perfil. Los adjuntos siguen registrando solo nombres. Los botones de envío guardan en el servidor; no se simulan borradores ni cargas de archivos.

## Solicitudes sin cuenta

Al abrir la aplicación sin sesión se muestra directamente el formulario de usuario final. El enlace **Iniciar sesión** permite entrar a las funciones de desarrollador, CCC y consulta de solicitudes propias de cuentas existentes.

El visitante indica nombre y correo, completa el formulario y recibe un código como comprobante. Su solicitud queda disponible para el CCC. No se crea una cuenta ni una sesión, y no se permite consultar, editar o eliminar solicitudes públicas desde el navegador anónimo. El código no es una credencial de acceso. No se envían correos automáticos ni se verifica la titularidad del correo en este prototipo.

El endpoint público admite únicamente solicitudes de usuario final y no devuelve el expediente ni el listado. Valida campos, origen y contenido JSON, y limita los intentos a 20 por hora por dirección IP. La migración a la versión 2 permite solicitudes sin propietario de cuenta conservando los registros y el contador de códigos anteriores.

## Identidad visual

La aplicación de control de cambios se presenta como **Transviajes**. El login utiliza una composición de dos paneles, fondo azul sin fotografías, acceso mediante correo y contraseña, botón para mostrar u ocultar la contraseña y registro de solicitudes de usuario final sin cuenta. Las solicitudes anteriores conservan el nombre de proyecto con el que se registraron; las nuevas utilizan Transviajes.

### Recepción de solicitudes públicas en el panel técnico

Las solicitudes enviadas sin cuenta aparecen en el panel y listado de los desarrolladores, con acceso de consulta al expediente. La edición y eliminación siguen reservadas al propietario de una cuenta, y el análisis y la resolución al integrante responsable del CCC. Las solicitudes privadas de otras cuentas no se incorporan al panel del desarrollador.

El panel autenticado se actualiza al regresar a la pestaña, al entrar al panel o listado y cada 15 segundos mientras está visible. No se recargan formularios en edición. El envío público muestra los errores de forma persistente en el formulario y conserva los datos para corregirlos.

La configuración del equipo y las cuentas desactivadas se verifican con pruebas de login de las cinco cuentas, rechazo de cuentas antiguas, permisos del CCC, preservación del análisis anterior e idempotencia del comando de sincronización.

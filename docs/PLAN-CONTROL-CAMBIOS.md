# Plan e historias de usuario · ChangeFlow

Fecha: 28 de octubre de 2026. Base revisada: `51f2606` (`main`, 27 de octubre de 2026). Estado: planificación; estas historias no certifican que el comportamiento ya esté implementado.

## Objetivo y acuerdos confirmados

- El usuario final registra una solicitud sin cuenta. El comprobante entrega un código de seguimiento que puede copiar y usar para consultar el estado.
- El experto inicia sesión, registra solicitudes técnicas, vuelve a su listado al guardar y abre cualquiera de sus solicitudes para consultar su estado.
- La pantalla de estado comparte estructura y línea de tiempo para ambas personas. La vista pública se limita a información de seguimiento; la vista del experto puede mostrar los datos de su solicitud autenticada.
- Se preparan cinco cuentas de experto y cinco cuentas CCC para Leslie, David, Edwin, Pablo y Shirley. **PabloMiembroCCC** es la única cuenta CCC activa; las otras cuatro no pueden iniciar sesión. El CCC solo revisa solicitudes ajenas: no registra solicitudes propias.
- El CCC ve tres grupos: **No analizadas**, **Analizadas** y **Decisión ya tomada**. Una solicitud avanza en ese orden. El análisis y la decisión tienen formularios distintos.
- **Más información** es una decisión ya tomada. La consulta informa que la persona debe contactar fuera del sistema a un experto o al CCC; no existe respuesta pública dentro de la aplicación.

### Contrato de estados propuesto

| Etapa del flujo | Cuándo empieza | Acción permitida al CCC | Resultado mostrado al solicitante |
| --- | --- | --- | --- |
| No analizada | Al registrar la solicitud | Completar análisis | Pendiente de análisis |
| Analizada | Al guardar el análisis | Completar decisión | Análisis completado; pendiente de decisión |
| Decisión ya tomada | Al guardar la decisión | Ninguna en este flujo | Decisión: Aprobada, Aprobada con condiciones, Rechazada o Más información |

La **etapa** y el **resultado de la decisión** son datos distintos. Así se puede agrupar por etapa sin perder la decisión concreta. La fecha y el responsable de cada transición los asigna el servidor. La línea de tiempo muestra las transiciones en orden con un resumen breve. **Límite público acordado:** la consulta por código solo muestra etapa, fechas, resultado final y resúmenes generales como «Solicitud registrada» o «Análisis completado». No expone nombre, correo, título, descripción, justificación, análisis completo, votos ni documentos. El experto autenticado ve los datos de sus propias solicitudes.

El código público de seguimiento es aleatorio y difícil de adivinar, distinto del ID secuencial `SCR-000n`. Se entrega en el comprobante y se puede usar repetidamente para consultar. El formato implementado es `CONS-XXXX-XXXX-XXXX-XXXX-XXXX`, con caracteres hexadecimales. Como transición para comprobantes emitidos antes de HU-01, el ID `SCR-000n` permite consultar solo el resumen público de solicitudes anónimas anteriores que todavía no tienen código `CONS`. Las solicitudes nuevas no se consultan por ID secuencial.

## Diferencias comprobadas con la versión actual

| Área | Hoy en `51f2606` | Cambio requerido |
| --- | --- | --- |
| Cuentas | Se crean Ana (usuario final), Diego (experto), Carlos y María (CCC) | Cinco expertos y cinco cuentas CCC preparadas; una sola CCC activa; usuario final sin cuenta |
| Comprobante público | Devuelve `id`, fecha y estado | Añadir código de seguimiento reutilizable |
| Consulta pública | No existe | Consulta de solo lectura por código |
| Experto al guardar | Va al detalle | Ir a su listado |
| CCC | Panel general y listado sin grupos de etapa | Tres grupos y acciones según etapa |
| Análisis | Admite reanálisis | Guardar una transición de No analizada a Analizada |
| Decisión | Exige voto y permite uno o dos participantes | Un solo CCC decide sin votación ni selección de participantes |
| Historial | Registra eventos de actividad y estados finales | Línea de tiempo estructurada por etapas y visible según permisos |

Para esta instalación, el usuario autorizó borrar los usuarios y datos anteriores y empezar con una base vacía. La eliminación debe ejecutarse como una operación explícita de reinicio, no en cada arranque. Las cuentas nuevas se crean desde una lista fija en el código y sus contraseñas se almacenan como hashes; no habrá recuperación de cuenta. Las pruebas actuales que esperan dos miembros activos y votos se sustituirán por pruebas del contrato aprobado **cuando se implemente la historia correspondiente**, sin debilitarlas para ocultar errores.

## Historias de usuario y criterios de aceptación

### HU-01 · Comprobante público con seguimiento

**Como** usuario final sin cuenta, **quiero** registrar una solicitud y recibir un código de seguimiento, **para** consultar después su estado.

Rama prevista: `feature/HU-01-comprobante-publico`. Alcance: registro público, persistencia del código y comprobante. No incluye la consulta.

1. **GIVEN** una persona sin sesión con un formulario válido, **WHEN** envía la solicitud, **THEN** el servidor guarda una solicitud No analizada y muestra un comprobante con ID, código de seguimiento copiable, fecha y estado inicial.
2. **GIVEN** dos solicitudes distintas, **WHEN** se generan sus comprobantes, **THEN** cada una recibe un código de seguimiento único y no secuencial.
3. **GIVEN** que la página se recarga o el servidor reinicia, **WHEN** el CCC consulta la solicitud, **THEN** el código sigue asociado a la misma solicitud y el registro no se duplica.
4. **GIVEN** un visitante, **WHEN** intenta indicar identidad, etapa o código desde el cuerpo enviado, **THEN** el servidor asigna esos valores y no acepta suplantación.

### HU-02 · Consulta pública de estado

**Como** usuario final sin cuenta, **quiero** introducir mi código de seguimiento, **para** conocer el estado sin iniciar sesión.

Rama prevista: `feature/HU-02-consulta-publica`. Depende de HU-01. La consulta refleja los estados que existan; HU-08 completará el nuevo flujo de decisión.

1. **GIVEN** un código válido, **WHEN** se consulta, **THEN** se presenta la pantalla de estado con etapa, resultado si existe y fecha de la última transición de esa solicitud.
2. **GIVEN** un código inexistente o mal formado, **WHEN** se consulta, **THEN** se muestra un mensaje claro sin revelar si existe un ID secuencial concreto ni datos de otras solicitudes.
3. **GIVEN** únicamente el ID `SCR-000n` de una solicitud nueva o experta, o un código ajeno, **WHEN** se intenta consultar por la API pública, **THEN** no se devuelve el expediente completo ni datos personales; un ID de comprobante público anterior sin código `CONS` solo permite el resumen público.
4. **GIVEN** una decisión «Más información», **WHEN** el visitante consulta, **THEN** ve «Decisión ya tomada», el resultado y la indicación de contactar a un experto o al CCC; no aparece un formulario de respuesta.
5. **GIVEN** consultas automatizadas repetidas, **WHEN** superan el límite de la consulta pública, **THEN** el servidor limita las solicitudes sin exponer expedientes.

### HU-03 · Registro y listado del experto

**Como** experto registrado, **quiero** enviar una solicitud técnica y volver a mi listado, **para** encontrarla y seguirla sin guardar otro código.

Rama prevista: `feature/HU-03-listado-experto`. Depende de HU-01 para compartir el estado inicial. La autenticación y el filtro por propietario existen, pero deben adaptarse al recorrido nuevo.

1. **GIVEN** un experto con sesión vigente y formulario válido, **WHEN** guarda la solicitud, **THEN** se crea a su nombre y se le dirige a «Mis solicitudes» con la nueva fila visible.
2. **GIVEN** un experto con varias solicitudes, **WHEN** abre su listado, **THEN** solo aparecen las vinculadas a su cuenta, con ID, título, etapa, resultado si existe y fecha.
3. **GIVEN** un experto que abre una fila, **WHEN** selecciona la solicitud, **THEN** llega a la pantalla de estado de esa solicitud.
4. **GIVEN** una sesión vencida o el ID de una solicitud ajena, **WHEN** intenta consultar el listado o el detalle, **THEN** el servidor exige autenticación o deniega el acceso, respectivamente.

### HU-04 · Pantalla de estado y línea de tiempo compartidas

**Como** solicitante, **quiero** ver una secuencia breve y fechada de lo ocurrido con mi solicitud, **para** entender en qué etapa está y qué decisión se tomó.

Rama prevista: `feature/HU-04-estado-y-linea-de-tiempo`. Depende de HU-02, HU-03, HU-07 y HU-08.

1. **GIVEN** una solicitud recién registrada, **WHEN** se abre la vista de estado pública o experta, **THEN** ambas comparten la misma estructura visual y muestran «No analizada» con fecha y resumen de registro.
2. **GIVEN** una solicitud analizada, **WHEN** se abre la vista, **THEN** la línea de tiempo presenta registro y análisis en orden cronológico, con fecha asignada por el servidor.
3. **GIVEN** una decisión guardada, **WHEN** se abre la vista, **THEN** aparecen las tres etapas, el resultado concreto y un resumen breve de la decisión.
4. **GIVEN** la consulta pública, **WHEN** se construye la respuesta o la pantalla, **THEN** no se incluyen datos personales ni contenido interno del análisis; el experto autenticado sí puede ver los datos de su propia solicitud.
5. **GIVEN** un registro histórico con eventos anteriores al modelo nuevo, **WHEN** se muestra su estado, **THEN** no se inventan fechas o transiciones que no consten en los datos.

### HU-05 · Un único miembro del CCC

**Como** responsable del CCC, **quiero** que solo una de las cinco cuentas preparadas de comité esté activa, **para** analizar y decidir las solicitudes sin un flujo de votos entre integrantes.

Rama prevista: `feature/HU-05-ccc-unico`. Dependencia para HU-06 a HU-08.

1. **GIVEN** una base reiniciada, **WHEN** se crean las cuentas iniciales, **THEN** existen cinco cuentas expertas y cinco cuentas CCC con los nombres acordados; solo una CCC está activa y no se crea cuenta de usuario final.
2. **GIVEN** la cuenta CCC, **WHEN** intenta registrar una solicitud propia, **THEN** la interfaz no ofrece esa acción y la API la rechaza.
3. **GIVEN** una cuenta CCC inactiva, **WHEN** intenta iniciar sesión o usar una sesión anterior, **THEN** se deniega el acceso sin alterar solicitudes.
4. **GIVEN** una cuenta experta o un visitante, **WHEN** intenta abrir funciones del CCC, **THEN** el servidor deniega el acceso.
5. **GIVEN** la operación explícita de reinicio autorizada, **WHEN** se ejecuta una vez, **THEN** se eliminan usuarios, sesiones y solicitudes anteriores y se cargan solo las diez cuentas nuevas; los reinicios normales del servidor no borran datos.

### HU-06 · Bandejas del CCC por etapa

**Como** único miembro del CCC, **quiero** ver las solicitudes agrupadas por etapa, **para** elegir el siguiente trabajo permitido.

Rama prevista: `feature/HU-06-bandejas-ccc`. Depende de HU-05, HU-07 y HU-08.

1. **GIVEN** solicitudes en las tres etapas, **WHEN** el CCC abre su panel, **THEN** ve grupos y recuentos separados de No analizadas, Analizadas y Decisión ya tomada.
2. **GIVEN** una solicitud No analizada, **WHEN** el CCC la selecciona, **THEN** se abre el formulario de análisis.
3. **GIVEN** una solicitud Analizada, **WHEN** el CCC la selecciona, **THEN** se abre el formulario de decisión con los resúmenes de solicitud y análisis.
4. **GIVEN** una solicitud con Decisión ya tomada, **WHEN** el CCC la selecciona, **THEN** se abre una vista de solo lectura con la decisión registrada.
5. **GIVEN** un enlace o petición HTTP directa a una acción que no corresponde a la etapa, **WHEN** llega al servidor, **THEN** se rechaza sin cambiar la solicitud.

### HU-07 · Guardar análisis

**Como** miembro del CCC, **quiero** completar y guardar el análisis en su propio formulario, **para** dejar la solicitud lista para la decisión.

Rama prevista: `feature/HU-07-analisis-ccc`. Depende de HU-01 y HU-05; el formulario puede abrirse desde la ruta CCC existente hasta completar HU-06.

1. **GIVEN** una solicitud No analizada y un formulario de análisis válido, **WHEN** el CCC guarda, **THEN** el servidor registra contenido, responsable y fecha, y la etapa cambia a Analizada.
2. **GIVEN** una solicitud Analizada o Decidida, **WHEN** se intenta guardar otro análisis desde la interfaz o API, **THEN** se rechaza y se conserva el análisis previo.
3. **GIVEN** datos obligatorios ausentes o una revisión desactualizada, **WHEN** se intenta guardar, **THEN** se informa el error y no se cambia la etapa ni se registra un análisis parcial.
4. **GIVEN** un análisis guardado, **WHEN** se vuelve al listado CCC, **THEN** la solicitud figura como Analizada con la fecha de transición.

### HU-08 · Decisión final sin votación

**Como** miembro del CCC, **quiero** registrar la decisión en un formulario distinto del análisis, **para** cerrar la revisión de la solicitud.

Rama prevista: `feature/HU-08-decision-ccc`. Depende de HU-07.

1. **GIVEN** una solicitud Analizada, **WHEN** el CCC abre el formulario de decisión, **THEN** ve los resúmenes de solicitud y análisis y los campos para resultado y justificación, sin votos ni selección de participantes.
2. **GIVEN** una decisión válida, **WHEN** el CCC guarda, **THEN** el servidor registra responsable y fecha, cambia la etapa a Decisión ya tomada y conserva el resultado específico.
3. **GIVEN** una aprobación con condiciones o un rechazo, **WHEN** faltan condiciones o motivo, respectivamente, **THEN** la API rechaza el guardado y la solicitud permanece Analizada.
4. **GIVEN** una solicitud No analizada o ya Decidida, **WHEN** se intenta decidir o decidir de nuevo, **THEN** el servidor rechaza la operación sin alterar la decisión existente.
5. **GIVEN** el resultado «Más información», **WHEN** se guarda, **THEN** queda en Decisión ya tomada y la vista del solicitante indica contacto fuera de la aplicación; no se habilita respuesta ni reapertura automática.

## Secuencia de ramas y comprobación

1. Crear `develop` desde el commit actual de `main`, sin mezclar los archivos de capturas y mockups que ya están sin seguimiento. Guardar este plan en el árbol de trabajo de `develop`; su incorporación al historial requiere un cambio documental revisado por el equipo.
2. HU-05 se adelantó a petición del usuario para configurar las cuentas. HU-01 y HU-02 se implementaron después para entregar el comprobante y su acceso público. Orden restante: **HU-03 → HU-07 → HU-08 → HU-06 → HU-04**. Para cada HU, crear su rama `feature/HU-xx-descripcion` **desde el `develop` actualizado**. Trabajar una historia a la vez; no crear todas las ramas por adelantado.
3. En cada rama, actualizar los contratos y pruebas afectados junto con la implementación. Ejecutar `npm run check` y `npm test`, y recorrer en navegador los escenarios Given/When/Then de la historia. Usar una base temporal o de prueba; no depender de `.env` real.
4. Revisar el diff y el resultado con una persona del equipo. Solo si los criterios pasan y hay revisión humana, integrar la rama en `develop`. Luego continuar con la siguiente. No declarar integrada una historia por pasar pruebas locales.
5. Antes de una entrega, comprobar migración de datos existentes, aislamiento de solicitudes, arranque real y recorridos completos de visitante, experto y CCC.

## Decisiones y riesgos antes de codificar

- **Cuenta CCC activa:** el usuario eligió PabloMiembroCCC. Las otras cuatro cuentas CCC permanecen inactivas.
- **Reinicio de datos:** la petición actual autoriza eliminar todos los usuarios, sesiones y solicitudes anteriores. Ejecutarlo una sola vez y verificar la base resultante antes de continuar con historias de flujo.
- **Código extraviado:** el prototipo no envía correos ni verifica identidad. Definir un procedimiento humano de recuperación o declarar que no habrá recuperación en esta fase.
- **Contenido público:** está acordado mostrar únicamente etapa, resultado, fechas y resúmenes neutros. El título, la descripción, la justificación y el análisis completo quedan fuera de la consulta por código.
- **Cuentas fijas:** usar `nombre@uta.edu.ec` para expertos y `nombremiembroccc@uta.edu.ec` para CCC, con nombres visibles `NombreMiembroCCC`. La clave inicial se configura localmente al poblar la base y se almacena como hash; no habrá recuperación de cuenta.

No se modificó el comportamiento del producto al redactar este plan.

## Avance comprobado

- **HU-05 integrada en `develop` (commit `2a0a63b`, 28 de octubre de 2026):** cinco expertos y cinco cuentas CCC; solo PabloMiembroCCC activa; el CCC no puede registrar solicitudes. El reinicio explícito de la base local dejó diez cuentas, cero sesiones y cero solicitudes. `npm run check` y `npm test` pasaron; las seis pruebas de backend y la prueba del cliente cubren cuentas, permisos y reinicio. Las demás historias siguen pendientes.
- **HU-01 integrada en `develop` (commit `fe1f64c`, 28 de octubre de 2026):** el comprobante público entrega un código aleatorio `CONS` que persiste con la solicitud. `npm run check` y `npm test` pasaron.
- **HU-02 integrada en `develop` (28 de octubre de 2026):** enlace «Consultar estado» visible sin cuenta, formulario por código, resultado público limitado y consulta de comprobantes anteriores. `npm run check`, `npm test` y recorrido real en navegador con `SCR-0001` pasaron.

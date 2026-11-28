# Integración con GitHub: guía paso a paso

Con esta integración, el Sistema de Control de Cambios trabaja con el repositorio de **BusesUTA** de forma parecida a Jira:

- **Cuando el CCC aprueba una solicitud de cambio (CRF) se crea su issue** en GitHub, con el código `[CRF-000001]`, los módulos afectados, la descripción y los criterios de aceptación como lista de tareas. Las solicitudes rechazadas o en evaluación no generan issues.
- **La issue se asigna sola** al desarrollador que el CCC elige, usando su usuario de GitHub, y cambia si hay una reasignación.
- **Rama de trabajo por cambio.** El desarrollador la crea desde el sistema con el formato `identificador-titulo-descripcionCorta` (por ejemplo `CRF-000001-cancelar-boletos-liberar-asiento`), a partir de la rama base acordada.
- **Hotfix con versión.** En un cambio de emergencia el CCC fija la versión (por ejemplo `v1.2.1`) y el desarrollador la publica como tag desde el commit de fusión del PR (o desde la punta de la rama si aún no se fusionó).
- **Commits leídos de GitHub.** Cuando el cambio tiene issue, los commits no se registran a mano: el seguimiento y la auditoría los leen de la rama de trabajo comparándola con la base.
- **Pull request al terminar.** El sistema crea el PR de la rama de trabajo hacia la base, o verifica uno existente y comprueba de qué rama a qué rama va.
- **La issue sigue el flujo del CRF.** En cada hito (asignación, inicio de implementación, rama, PR, pruebas, revisión, cierre) la issue recibe un comentario y cambia su etiqueta `estado: …`. Al cerrar el CRF, la issue se cierra: como *completada* si el resultado fue exitoso y como *no planificada* en los demás casos.
- **Las referencias de Git se verifican de verdad.** Cuando el desarrollador registra una rama, un commit, un pull request o un tag, el sistema consulta GitHub. Si no existe, no se registra. Si existe, guarda su estado; por ejemplo, un PR «abierto» o «fusionado». El botón **Verificar** vuelve a consultarlo más tarde.

El estado oficial y la autorización siguen viviendo en el Sistema de Control de Cambios. La issue es el ticket de trabajo del equipo.

## Paso 1. Ten el repositorio de BusesUTA en GitHub

Necesitas el nombre en formato `propietario/repositorio`, por ejemplo `uta-software/busesuta`, y que la pestaña **Issues** esté activada: *Settings → General → Features → Issues*.

## Paso 2. Crea un token de acceso fino (fine-grained)

1. En GitHub: foto de perfil → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. **Resource owner:** la cuenta u organización dueña del repositorio.
3. **Repository access:** *Only select repositories* → elige solo el repositorio de BusesUTA.
4. **Permissions → Repository permissions:**
   - **Issues:** *Read and write* (para crear y actualizar las issues).
   - **Contents:** *Read and write* (para crear la rama de trabajo y los tags de versión, y leer commits, ramas y tags).
   - **Pull requests:** *Read and write* (para crear el PR y consultar su estado).

   Si ya creaste el token con permisos de solo lectura, edítalo en GitHub y cambia esos dos permisos: no hace falta generar uno nuevo.
   - **Metadata:** *Read-only* (GitHub lo exige siempre).
5. Elige una fecha de vencimiento razonable, por ejemplo el final del semestre, y genera el token.
6. Cópialo en ese momento: GitHub no vuelve a mostrarlo.

Si el repositorio pertenece a una organización, puede que un administrador deba aprobar el token.

## Paso 3. Configura `.env`

En la carpeta del proyecto, copia `.env.example` a `.env` si aún no lo hiciste, y completa:

```text
GITHUB_REPO=propietario/busesuta
GITHUB_TOKEN=github_pat_...
APP_URL=http://127.0.0.1:3000
```

- `.env` está en `.gitignore`: el token **nunca** debe subirse al repositorio ni compartirse por chat.
- `APP_URL` es opcional: sirve para que la issue enlace al expediente.

## Paso 4. Reinicia y comprueba

```powershell
npm start
```

Entra con cualquier cuenta del equipo y abre el expediente de una solicitud. En **Implementación → Referencias de GitHub** debe aparecer «Conectado a propietario/busesuta». También puedes consultar `GET /api/github/status` con la sesión iniciada.

## Paso 5. Prueba el flujo

1. Crea una solicitud y, como CCC, recíbela, valídala, completa la ficha y apruébala. En ese momento se crea la issue y el expediente muestra el enlace `#N`.
2. Asigna un desarrollador: la issue queda asignada a su usuario de GitHub.
3. Como desarrollador asignado, abre **Seguimiento paso a paso** (desde *Mis tareas* o el expediente):
   1. **Iniciar**: revisa los planes aprobados y empieza la implementación.
   2. **Rama de trabajo**: escribe una descripción corta y marca «Crear la rama en GitHub». Se crea `CRF-000001-titulo-descripcion-corta` desde la rama base.
   3. **Desarrollo**: trabaja en esa rama, sube tus commits y registra actividades y módulos modificados.
   4. **Pull request**: «Crear en GitHub» abre el PR de la rama de trabajo hacia la base, con `Refs #N` a la issue. También puedes registrar uno existente; el sistema verifica que vaya de la rama correcta a la base acordada.
   5. **Enviar a pruebas**.
4. Al cerrar el CRF, la issue se cierra sola.

**Usuarios de GitHub del equipo:** están en `backend/team.cjs`. Si alguien cambia de cuenta, actualízala ahí y ejecuta `npm run accounts:sync`. Para que GitHub permita asignarle la issue, esa persona debe ser colaboradora del repositorio.

## Si algo falla

- **GitHub no responde o rechaza el token:** la solicitud se registra igual. El expediente muestra el motivo y el CCC puede pulsar **Crear issue** o **Sincronizar issue** para reintentarlo.
- **«El token no tiene permisos suficientes» / «no puede crear ramas o pull requests»:** revisa los permisos del paso 2 (Contents y Pull requests en *Read and write*) y que el token incluya ese repositorio.
- **«No se pudo asignar a …»:** ese usuario de GitHub no es colaborador del repositorio o está mal escrito en `backend/team.cjs`.
- **«La rama no tiene commits nuevos»:** GitHub no permite un PR vacío; sube tus cambios a la rama de trabajo antes de crearlo.
- **«Se alcanzó el límite de consultas»:** sin token, GitHub permite pocas consultas por hora; configura `GITHUB_TOKEN`.
- **La demostración** (`npm run start:demo`) no se conecta a GitHub para no crear issues de prueba en el repositorio real.

## Qué datos se envían a GitHub

Solo los datos del cambio: código, título, módulos, descripción, justificación, resultado esperado, criterios, tipo ITIL, prioridad y los hitos del flujo con el nombre del integrante del equipo que los registró. **Nunca** se envían el correo ni el nombre de quien presentó la solicitud. Ten en cuenta que, si el repositorio es público, las issues también lo son.

## Próximos pasos posibles

- Recibir *webhooks* de GitHub para actualizar automáticamente el estado de los PR. Requiere publicar la aplicación con una URL accesible desde internet.

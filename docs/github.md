# Integración con GitHub: guía paso a paso

Con esta integración, el Sistema de Control de Cambios trabaja con el repositorio de **BusesUTA** de forma parecida a Jira:

- **Cada solicitud de cambio (CRF) crea una issue** en GitHub, con el código `[CRF-000001]`, los módulos afectados, la descripción y los criterios de aceptación como lista de tareas.
- **La issue sigue el flujo del CRF.** En cada hito (recepción, aprobación o rechazo, asignación, inicio de implementación, pruebas, revisión, cierre) la issue recibe un comentario y cambia su etiqueta `estado: …`. Al cerrar el CRF, la issue se cierra: como *completada* si el resultado fue exitoso y como *no planificada* en los demás casos (por ejemplo, un rechazo).
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
   - **Contents:** *Read-only* (para verificar ramas, commits y tags).
   - **Pull requests:** *Read-only* (para consultar el estado de los PR).
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

1. Crea una solicitud. En su expediente, **Issue de GitHub** muestra el enlace `#N`. En GitHub verás la issue con las etiquetas `control-de-cambios`, `estado: registrada` y una por cada módulo; GitHub las crea automáticamente la primera vez.
2. Como CCC, recibe la solicitud. La issue recibe un comentario y pasa a `estado: en validación`.
3. Como desarrollador asignado, registra la rama de trabajo (por ejemplo `feature/CRF-000001-cancelacion`) y luego el PR. Si escribes una rama que no existe, el sistema lo rechaza y marca el campo en rojo.
4. Al cerrar el CRF, la issue se cierra sola.

**Recomendación para el equipo:** nombra las ramas y los PR con el código del CRF (`feature/CRF-000001-...`, «CRF-000001: …») y menciona la issue en el PR (`Refs #N`). Así GitHub muestra el vínculo entre el PR y la issue.

## Si algo falla

- **GitHub no responde o rechaza el token:** la solicitud se registra igual. El expediente muestra el motivo y el CCC puede pulsar **Crear issue** o **Sincronizar issue** para reintentarlo.
- **«El token no tiene permisos suficientes»:** revisa los permisos del paso 2 y que el token incluya ese repositorio.
- **«Se alcanzó el límite de consultas»:** sin token, GitHub permite pocas consultas por hora; configura `GITHUB_TOKEN`.
- **La demostración** (`npm run start:demo`) no se conecta a GitHub para no crear issues de prueba en el repositorio real.

## Qué datos se envían a GitHub

Solo los datos del cambio: código, título, módulos, descripción, justificación, resultado esperado, criterios, tipo ITIL, prioridad y los hitos del flujo con el nombre del integrante del equipo que los registró. **Nunca** se envían el correo ni el nombre de quien presentó la solicitud. Ten en cuenta que, si el repositorio es público, las issues también lo son.

## Próximos pasos posibles

- Asignar la issue al desarrollador (requiere registrar el usuario de GitHub de cada integrante).
- Recibir *webhooks* de GitHub para actualizar automáticamente el estado de los PR. Requiere publicar la aplicación con una URL accesible desde internet.

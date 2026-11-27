# Guía de presentación: CRF-000006 «Validación del ingreso de información en los formularios»

Recorrido completo de un cambio pedido por el ingeniero, desde la solicitud hasta el cierre, con la issue, la rama y el pull request reales en GitHub.

## Antes de empezar

1. Inicia la aplicación sobre la base de demostración:

   ```powershell
   npm run start:demo
   ```

   **No ejecutes `npm run demo:reset`**: borra la base y con ella el CRF-000006.
2. Abre `http://127.0.0.1:3000`. Todas las cuentas usan la contraseña de `SEED_PASSWORD` de tu `.env`.
3. Tu token de GitHub debe tener **Contents** y **Pull requests** en *Read and write* (ver `docs/github.md`).
4. Ten a mano un clon de **ProyectoBusesUTA** para subir un commit a la rama de trabajo.
5. **Consejo:** abre cada rol en un perfil de navegador distinto (o una ventana normal y otra privada) para no cerrar sesión a cada rato.

| Rol en la demostración | Cuenta |
|---|---|
| Solicitante (desarrolladora) | `leslie@uta.edu.ec` |
| CCC | `david@uta.edu.ec` |
| Desarrollador asignado | `edwin@uta.edu.ec` (GitHub: Pato77232) |
| Quien prueba y revisa | `pablo@uta.edu.ec` |

## 1. La solicitud (Leslie, opcional)

En **Solicitudes**, abre **CRF-000006** y muestra lo que Leslie registró:

- Cinco módulos afectados (es un cambio sobre algo existente).
- Tipo ITIL propuesto *Normal*.
- Reglas de negocio (cédula, correo, fechas, precios).
- Cuatro criterios de aceptación.

Está en *Registrada*: todavía no tiene issue en GitHub.

## 2. Recepción y validación (David, CCC)

1. Abre CRF-000006. En **Acciones disponibles** pulsa **Recibir solicitud** y luego **Información completa: iniciar análisis**.
2. *(Opcional)* Muestra **Corregir solicitud**: el CCC puede precisar cualquier campo con un motivo, y el original del solicitante queda guardado.

## 3. Ficha del CCC (David)

Pulsa **Ficha del CCC**. Solo tiene lo indispensable.

**A. Clasificación**
- *Normal* ya viene preseleccionado (lo propuso Leslie).
- Los módulos ya vienen marcados; revisa la operación (*Modificación*).

**B. Impacto y riesgos**
- Impacto *Medio*, urgencia *Alta*, prioridad *Alta* (mira la sugerencia orientativa).
- Riesgos (uno por línea): «Rechazar datos válidos por reglas demasiado estrictas» y «Mensajes inconsistentes entre módulos».

Pulsa **Completar análisis**.

**C. Planificación.** Reemplaza las plantillas con este contenido y usa **Vista previa**.

Plan de rollout:

```markdown
## Objetivo
Validar todos los formularios de BusesUTA sin afectar a los usuarios actuales.

## Actividades (en orden)
1. Crear la rama de trabajo
2. Validadores comunes (cédula, correo, teléfono, placa, fechas, montos)
3. Aplicarlos en los formularios de cada módulo
4. Validación equivalente en el backend
5. Pruebas y pull request

## Verificaciones y criterio de finalización
- Los cuatro criterios de aceptación se cumplen
```

Plan de backout:

```markdown
## Condiciones de activación
- Se rechazan datos válidos o falla el registro de usuarios

## Acciones de reversión
1. Revertir el merge del pull request
2. Desplegar de nuevo la versión anterior

## Verificación posterior
- Registro, reserva y pago funcionan como antes
```

Elige la **fecha límite de implementación**: la fecha en que el desarrollador debe terminar. Pulsa **Completar análisis y planificación**.

**D. Decisión**
- Elige **Aprobado con condiciones** y marca la **viabilidad técnica**: *Viable*.
  - *(Opcional)* Para mostrar que un cambio no viable no se aprueba: marca *No viable*. Aparece el error en rojo y el botón se desactiva. Vuelve a *Viable*.
- Condición: `Probar los formularios de compra con datos reales | Capturas de cada formulario mostrando los errores en rojo`
- Al aprobar no hace falta justificación. Solo se pide un **motivo** al rechazar o al pedir más información.
- Registra la decisión. **En ese momento se crea la issue en ProyectoBusesUTA**: muéstrala en GitHub con su etiqueta `estado: aprobada`.

## 4. Asignación (David)

En el expediente, **Asignar implementación** a **Edwin**. La fecha límite es la que pusiste en la ficha.

En GitHub, la issue queda asignada a **Pato77232** y recibe un comentario.

## 5. Seguimiento paso a paso (Edwin)

En **Mis tareas** pulsa «Iniciar implementación»: se abre **Seguimiento · CRF-000006**.

1. **Iniciar.** Muestra los planes aprobados, la condición y la fecha límite. Marca «Leí las condiciones» e inicia.
2. **Rama de trabajo.** Como es un cambio *Normal*, el prefijo ya viene configurado: `feature/CRF-000006-` (en una emergencia sería `hotfix/`). Escribe solo el nombre, `validar-formularios`, y regístrala. Se crea `feature/CRF-000006-validar-formularios` en ProyectoBusesUTA, desde la rama principal.
3. **Desarrollo.**
   - En tu clon de ProyectoBusesUTA, sube al menos un commit a esa rama; GitHub no permite un PR sin cambios:

     ```powershell
     git fetch origin
     ```

     ```powershell
     git switch feature/CRF-000006-validar-formularios
     ```

     Haz el cambio, luego `git commit` y `git push`.
   - En el sistema registra:
     - una **actividad**;
     - el **módulo modificado** (por ejemplo «Autenticación y usuarios»);
     - el **commit** (su SHA), que se verifica en GitHub.
   - *(Opcional)* Registra un módulo **no autorizado** (por ejemplo «Notificaciones») para mostrar la **desviación de alcance**. David debe autorizarla o rechazarla en el expediente antes de continuar.
4. **Pull request.** «Crear en GitHub» abre el PR de la rama de trabajo hacia la rama principal, con `Refs #N` a la issue. Se ve claramente de qué rama a qué rama va.
5. **Enviar a pruebas.** La lista de verificación debe estar en verde.

## 6. Pruebas (Pablo)

En el expediente → **Revisión y cierre**:

1. Registra una prueba por criterio con estado *Superada*. El sistema marca si quien prueba es el implementador.
2. *(Opcional, muy útil en la defensa)* Registra una prueba *Fallida* y el resultado «Existen fallos» → la solicitud vuelve a **Correcciones requeridas**. Edwin inicia una nueva ronda en el seguimiento y la envía otra vez a pruebas. Las ejecuciones anteriores se conservan.
3. Resultado de las pruebas: **Todas superadas**.

## 7. Revisión postimplementación (Pablo)

Antes de la revisión, **fusiona el PR en GitHub** y pulsa **Verificar** en las referencias: el estado cambia a *Fusionado*.

Registra la revisión:
- Marca los cuatro criterios y la condición del CCC (con su evidencia).
- Rollout *Cumplido*, recomendación y decisión **Conforme**.

Si algo no se cumple, el sistema no deja declararla conforme.

## 8. Cierre (Edwin)

Registra el cierre:
- Resultado **Exitoso**.
- Resumen del trabajo.
- Versión resultante, si la tienen definida.

El CRF queda *Cerrado* y **la issue se cierra sola en GitHub** como completada.

## 9. Para terminar la presentación

- **Expediente → Auditoría:** primero la tabla **Cambios y ramas registrados** (rama, PR, commits y módulos modificados, con su verificación en GitHub) y después cada evento con quién, cuándo, estado anterior y nuevo, y cada campo modificado.
- **Menú Auditoría:** filtra por «Rama de trabajo», «Pull request» o «Registro de módulo modificado», o por el código CRF-000006.
- **Expediente → Historial:** los hitos del cambio.
- **Panel:** filtra por usuario *Edwin* y prioridad *Alta*.
- **Reportes:** exporta el CSV.
- **GitHub:** la issue con sus comentarios por hito, la rama y el PR fusionado.

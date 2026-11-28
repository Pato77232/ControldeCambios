# Publicar la aplicación en un hosting

## Por qué no InfinityFree

InfinityFree (y otros hostings gratuitos de PHP) **no puede ejecutar esta aplicación**: solo ofrece PHP y MySQL. No admite Node.js, procesos que queden encendidos ni contenedores Docker.

Esta aplicación necesita:
- un servicio que construya el `Dockerfile` o ejecute Node.js 22.13 o superior;
- un **disco persistente** para `/data`, donde están la base SQLite y los adjuntos. Sin disco, la información se pierde en cada reinicio.

## Opción recomendada: Railway

Railway construye el `Dockerfile` del repositorio, ofrece HTTPS y permite montar un volumen persistente. El archivo `railway.json` ya configura la construcción y la comprobación de salud. Railway funciona con créditos: revisa el plan vigente y cuánto consume el servicio antes de dejarlo encendido.

1. Entra en [railway.com](https://railway.com) con tu cuenta de GitHub y elige **New Project → Deploy from GitHub repo → Pato77232/ControldeCambios**. Selecciona la rama `feature/control-cambios-completo`, o `main` cuando la fusionen.
2. En el servicio, abre **Settings → Volumes → New Volume** y móntalo en **`/data`**.
3. En **Variables**, agrega:

   | Variable | Valor |
   |---|---|
   | `SEED_PASSWORD` | Contraseña inicial de las cuentas (mínimo 12 caracteres) |
   | `COOKIE_SECURE` | `true` |
   | `TRUST_PROXY` | `true` |
   | `APP_URL` | La dirección pública, por ejemplo `https://control-cambios.up.railway.app` |
   | `GITHUB_REPO` | `pato77232/ProyectoBusesUTA` |
   | `GITHUB_TOKEN` | Tu token fine-grained (no lo subas al repositorio) |

   `PORT` lo asigna Railway y la aplicación lo respeta. `DB_PATH` y `DEMO_DB_PATH` ya apuntan a `/data` desde el `Dockerfile`.
4. En **Settings → Networking → Generate Domain** obtienes la URL pública. Ponla en `APP_URL` y vuelve a desplegar.
5. Abre la URL e inicia sesión con las cuentas del equipo y la contraseña de `SEED_PASSWORD`.

Cada `git push` a la rama configurada vuelve a desplegar la aplicación; los datos del volumen se conservan.

### Datos de prueba en el hosting

El hosting empieza con una base vacía, con las cinco cuentas del equipo. Si quieren la base de demostración allí:

- Agrega `DEMO_MODE=true` y ejecuta una vez, desde la consola del servicio, `node backend/demo.cjs`. Esto crea `/data/demo.sqlite` con los casos de ejemplo.
- Las solicitudes que crearon en su equipo, como el CRF-000006, viven en su `backend/data` local y **no se suben** solas. Para la presentación lo más simple es volver a cargarlas en el hosting.

## Alternativas

- **Render:** «New → Web Service» desde GitHub con entorno Docker. Para no perder datos necesita un **Persistent Disk** montado en `/data`, disponible solo en planes de pago. En el plan gratuito el servicio se suspende y los datos se pierden.
- **Fly.io:** `fly launch` detecta el `Dockerfile`. Crea un volumen con `fly volumes create data` y móntalo en `/data` en `fly.toml`; configura las mismas variables con `fly secrets set`.

## Comprobaciones de seguridad antes de publicar

- `COOKIE_SECURE=true`: la cookie de sesión solo viaja por HTTPS.
- `TRUST_PROXY=true`: los límites de intentos de inicio de sesión usan la IP real del visitante y la verificación de origen usa el dominio público.
- Cambia `SEED_PASSWORD` por una contraseña robusta. Cada integrante debería usar una cuenta propia.
- El token de GitHub va solo en las variables del hosting.

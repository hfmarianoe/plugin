# Muro de notas — sandbox para plugins y skills

Página mínima sin build: `public/index.html` + función serverless `api/notes.js` + Supabase (Postgres).

## Modo demo
Sin variables de entorno funciona con memoria (se reinicia entre invocaciones). Útil para probar rápido.

## Con base de datos (Supabase)
1. Crea un proyecto en Supabase y ejecuta `supabase/schema.sql` en el SQL editor.
2. En Vercel define las variables `SUPABASE_URL` y `SUPABASE_KEY` (clave publishable; también acepta `SUPABASE_SERVICE_ROLE_KEY`).

## Despliegue
Importa el repo en Vercel (sin framework). `vercel.json` ya apunta a `public/`. Local: `npx vercel dev`.

## Pruebas
- `npm test`: suite de `node:test` (API en modo memoria, con Supabase simulado y en producción).
- `npm run test:coverage`: igual, pero falla si `api/notes.js` baja de 95 % de líneas o 90 % de ramas.
- Los helpers para llamar al handler están en `testing/` (fuera de `test/` porque `node --test` ejecuta todo lo que haya en `test/`).

### Pruebas de la base de datos
`supabase/tests/notes.test.sql` prueba RLS, restricciones `check` y el trigger de tope (30 notas por minuto). Pégalo completo en el SQL Editor de Supabase. Corre en una transacción que siempre se revierte, así que no deja datos. El mensaje del error final empieza con `PASS: N pruebas` o `FAIL: X de N pruebas: ...`. Cualquier otro error significa que el propio script falló.

### Pruebas E2E y de accesibilidad
Viven en `e2e/` con sus propias dependencias (Playwright y axe-core), para que el despliegue en Vercel no instale nada extra.
```
cd e2e
npm ci
npx playwright install chromium   # solo la primera vez
npx playwright test
```
`e2e/server.js` sirve `public/` y ejecuta el handler real de `api/notes.js` en modo memoria; los errores del servidor (429, 400, 500) se simulan con `page.route`. Las pruebas cubren el flujo de publicar, teclado y foco, errores, seguridad (HTML escapado y honeypot), diseño a 320/390/768 px y axe-core WCAG 2.1 A/AA en tema claro y oscuro.

### CI
`.github/workflows/ci.yml` corre en cada PR y en cada push a `main`: las pruebas del API con umbral de cobertura (`npm run test:coverage`) y las pruebas E2E con Playwright. Si falla E2E se sube el reporte como artefacto.

Las acciones de GitHub están fijadas por hash de commit (con la versión como comentario), no por etiqueta: una etiqueta como `@v7` puede moverse, un hash no. `.github/dependabot.yml` revisa cada lunes si hay versiones nuevas y abre **un solo PR** con todas las acciones que se puedan actualizar (cambia el hash y el comentario de versión a la vez). Ese PR pasa por el mismo CI que los demás: revisa el resultado antes de fusionarlo.

Para actualizar una a mano, busca el commit de la versión nueva y cambia hash y comentario a la vez:
```
git ls-remote --tags https://github.com/actions/checkout.git 'refs/tags/v7*'
```

### Prueba de humo (después del despliegue)
`scripts/smoke.js` comprueba un sitio desplegado sin dejar notas reales: carga de la página, lectura de la API en el modo esperado (`supabase` en producción), ordenamiento y forma de las notas, tiempo de respuesta, rechazo de POST sin JSON (415) y de notas vacías (400), descarte de bots por honeypot (verificando que no se guardó) y 405 con `Allow`. Reintenta ante errores de red y 502/503/504, y avisa si el sitio está protegido por Vercel Authentication.

```
node scripts/smoke.js https://tu-sitio.vercel.app                  # espera modo supabase
node scripts/smoke.js http://127.0.0.1:3100 --expect-mode memory   # contra el servidor local de e2e/
```
Opciones: `--expect-mode supabase|memory`, `--timeout ms` (10000), `--retries n` (2). Sale con código 1 si algo falla.

`.github/workflows/smoke.yml` lo ejecuta solo cuando Vercel marca con éxito el despliegue de un commit de `main` (los previews de PR se omiten) (Vercel publica un estado de commit `Vercel`; no crea Deployments de GitHub, así que no sirve `deployment_status`). Prueba la URL de la variable del repositorio `SMOKE_URL` o, si no existe, `https://plugin-gamma-mauve.vercel.app`. También se puede lanzar a mano desde Actions > Smoke > Run workflow con la URL que quieras (útil para un preview, si no está protegido).

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

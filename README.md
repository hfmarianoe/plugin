# Muro de notas — sandbox para plugins y skills

Página mínima sin build: `public/index.html` + función serverless `api/notes.js` + Supabase (Postgres).

## Modo demo
Sin variables de entorno funciona con memoria (se reinicia entre invocaciones). Útil para probar rápido.

## Con base de datos (Supabase)
1. Crea un proyecto en Supabase y ejecuta `supabase/schema.sql` en el SQL editor.
2. En Vercel define las variables `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` (solo servidor; nunca en el frontend).

## Despliegue
Importa el repo en Vercel (sin framework). `vercel.json` ya apunta a `public/`. Local: `npx vercel dev`.

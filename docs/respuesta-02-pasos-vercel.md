# Respuesta 02 — Pasos para desplegar en Vercel

1. vercel.com/new → elegir equipo `the-net-and-me` o cuenta personal.
2. Importar `hfmarianoe/plugin` (si no aparece, ajustar permisos de la GitHub App).
3. Framework: Other · Build Command vacío · Output Directory: `public`.
4. Variables de entorno (Production, Preview, Development):
   - `SUPABASE_URL` = `https://xyiyrjzcqwmlfrfrbtak.supabase.co`
   - `SUPABASE_KEY` = clave publishable del proyecto `plugin-sandbox`
5. Deploy y abrir la URL; debe decir "Supabase (Postgres)".
6. Si dice "memoria (demo)": revisar variables y hacer Redeploy.
7. Si pide autenticación: Settings → Deployment Protection → desactivar.

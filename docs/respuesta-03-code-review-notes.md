# Code Review: `api/notes.js`

## Resumen
Handler serverless pequeño y legible, con validación básica, límites de longitud y escape de HTML en el frontend. Los problemas son de robustez y abuso, no de seguridad grave. Aceptable para un sandbox; conviene corregir los puntos 1 a 3 antes de usarlo con tráfico real.

## Problemas importantes
| # | Línea | Problema | Severidad |
|---|-------|----------|-----------|
| 1 | 39 | **Sin control de abuso.** Cualquiera puede publicar sin límite, y con la clave pública de Supabase también directo a la tabla (las políticas RLS `insert` son `with check (true)`). Riesgo de spam y de llenar la base. | 🟠 Media |
| 2 | 19, 50 | **Fuga de errores internos.** `err.message` incluye el cuerpo de la respuesta de Supabase (nombres de tablas, políticas, códigos) y se devuelve al cliente en el 500. | 🟠 Media |
| 3 | 33 | **JSON inválido da 500 en vez de 400.** `JSON.parse` lanza dentro del `try` y cae en el 500 genérico. | 🟡 Baja-media |

## Sugerencias
| # | Línea | Sugerencia | Categoría |
|---|-------|------------|-----------|
| 4 | 34-35 | `String(body.author)` convierte objetos en `"[object Object]"`. Rechazar valores que no sean string con 400. | Correctitud |
| 5 | 34-35 | `slice` cuenta unidades UTF-16 y puede partir un emoji por la mitad, dejando un surrogate suelto que Postgres rechaza (500). Usar `Array.from(text).slice(0, 280).join('')`. | Correctitud |
| 6 | 9 | `fetch` sin timeout: si Supabase no responde, la función queda colgada hasta el límite de Vercel. Usar `AbortSignal.timeout(5000)`. | Robustez |
| 7 | 4 | Si faltan las variables en producción, cae en silencio a memoria y las notas se pierden. Lanzar error cuando `process.env.VERCEL_ENV === 'production'` y no hay DB. | Robustez |
| 8 | 6, 43 | `memory` crece sin tope y el `id` por `length + 1` se repetiría si se recortara. Poner un tope (p. ej. 200) o un contador aparte. En Vercel además cada instancia tiene su propia memoria. | Mantenibilidad |
| 9 | 32 | Sin comprobación de `Origin`/`Content-Type`: un sitio ajeno puede enviar POST con `text/plain`. Exigir `application/json` reduce el abuso. | Seguridad |
| 10 | 15 | `Prefer: return=representation` se manda también en GET; solo hace falta en POST. | Menor |
| 11 | — | No hay pruebas. El smoke test manual de la sesión 1 podría pasar a `node --test` (GET, POST válido, POST vacío, método inválido). | Cobertura |

## Qué está bien
- Longitudes limitadas en el servidor (40 y 280) y también con `check` en la base de datos.
- Respuesta 405 con cabecera `Allow`.
- El frontend escapa HTML (`esc`), y la API devuelve solo JSON, así que no hay XSS almacenado.
- RLS activado y políticas mínimas: solo `select` e `insert`, sin `update` ni `delete`.
- Sin dependencias ni secretos en el código.
- Consulta acotada (`limit=50`), sin N+1.

## Veredicto
**Aprobar con cambios menores.** Para un sandbox está bien. Prioridad si se quiere endurecer: 2 (no filtrar errores), 3 (400 en JSON inválido) y 1 (limitar abuso, por ejemplo con rate limiting de Vercel o un captcha).

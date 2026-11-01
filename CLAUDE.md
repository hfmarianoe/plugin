# Modelos en la nube

## Modelo base

- **Proveedor:** OrcaRouter (`https://api.orcarouter.ai/v1`)
- **Modelo:** `orcarouter/auto`
- **Configuración:** `llm.config.json`
- **Estado:** probado, responde correctamente. El router lo enruta por debajo a `deepseek-v4-flash-ga-260731`.

## Resultados de las pruebas

| Proveedor | Modelo | Resultado |
|---|---|---|
| OrcaRouter | `orcarouter/auto` | OK (base) |
| cheaperinference | `beam-free` | OK, con al menos 400 tokens de salida (con 20 devuelve contenido vacío) |
| OpenRouter | `recursive/flint-v1.0:free` | No disponible: sin upstreams (503) |

Hosts con acceso verificado en el listado de modelos (HTTP 200): `api.cheaperinference.com`, `api.deepseek.com`, `api.openai.com`, `api.orcarouter.ai`, `integrate.api.nvidia.com`, `openrouter.ai`.

## Notas

- Los modelos gratis de OpenCode (`opencode/*-free`) dieron "Free usage exceeded". OpenCode ya no está instalado en el contenedor.
- Los modelos de Amazon Bedrock fallan con "The security token included in the request is invalid": hay que renovar las credenciales de AWS.
- No hay claves en este archivo; las credenciales las inyecta el proxy.

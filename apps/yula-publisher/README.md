# yula-publisher

`yula-publisher` is the registry and bundle generator for the Yula runtime.

It accepts published worker definitions, stores them on disk, and generates a zip bundle containing:

- each published JavaScript module,
- `_meta.json` with the route list,
- and `config.capnp` for `workerd`.

## Start locally

```bash
pnpm --filter @yula-xyz/publisher build
cd apps/yula-publisher
node dist/index.js
```

Default address:

```text
http://localhost:8086
```

## Endpoints

### `POST /api/publish`

Stores a worker definition.

Example request:

```bash
curl -X POST http://127.0.0.1:8086/api/publish \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "echo-v1",
    "compatibilityDate": "2023-02-28",
    "module": "export default { async fetch() { return new Response(\"hello\"); } }"
  }'
```

### `GET /api/config`

Returns the generated `workerd` bundle as a zip file.

This is the endpoint used by `apps/yula-worker` during `pnpm sync`.

## Environment

| Variable | Description |
| --- | --- |
| `DATA_PATH` | Required. Where published worker definitions are stored. |
| `PORT` | HTTP port. Defaults to `3000`, repo default is `8086`. |
| `FLY_AUTH_TOKEN` | Optional. Reserved for remote restart flows. |
| `FLY_WORKER_APP` | Optional. Reserved for remote restart flows. |

The repo ships with:

```env
PORT=8086
DATA_PATH=./functions
```

## Naming behavior

Published worker route names may contain dashes, such as `math-mcp-v1-0-0`.

When generating `config.capnp`, the publisher now normalizes those route names into valid camelCase Cap'n Proto identifiers internally, while preserving the original public route name for HTTP routing.

## Demo role

In the example MCP demo:

1. the example worker publishes its bundled source to `POST /api/publish`,
2. `yula-worker` downloads `GET /api/config`,
3. and `workerd` starts serving the published MCP server under `/<worker-name>/mcp`.

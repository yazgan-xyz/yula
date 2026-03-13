# yula-publisher

The **registry and configuration generator** for the Yula ecosystem.

This application runs a lightweight `Hono` API server that handles module tool submissions from AI agents, stores them, and generates a dynamically bundled `workerd` configuration artifact.

## Endpoints

### `POST /api/publish`
Accepts a JSON payload containing the worker definition and writes it to the local data store.

**Payload body:**
```json
{
  "name": "echo",
  "module": "export default { fetch(req) { return new Response('hello world'); } }"
}
```

### `GET /api/config`
Generates a Cloudflare `workerd` configuration format in-memory. 
It dynamically bundles all registered JSON worker definitions alongside an ad-hoc `config.capnp` file and returns it as an `application/zip` buffer using `fflate`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATA_PATH` | **Required.** The local file path where individual tool configurations will be serialized and saved. |
| `PORT` | Optional. The HTTP port to bind to. Defaults to `3000`. |
| `FLY_AUTH_TOKEN` | Optional. Used for background restarting instances remotely via Fly.io. |
| `FLY_WORKER_APP` | Optional. App identifier for remote execution via Fly.io. |
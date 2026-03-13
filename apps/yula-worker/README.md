# yula-worker

`yula-worker` is the runtime process that turns published worker modules into live HTTP endpoints using Cloudflare `workerd`.

It has two jobs:

1. build the shared router that dispatches requests by worker name,
2. sync the latest published config bundle from `yula-publisher`.

## Local flow

### Build the router

```bash
pnpm --filter @yula-xyz/worker build
```

This writes the router bundle directly to:

```text
apps/yula-worker/config/_router.js
```

### Sync published workers

```bash
cd apps/yula-worker
pnpm sync
```

This downloads `http://localhost:8086/api/config`, overwrites the local `config` directory contents, and refreshes:

- `config.capnp`
- `_meta.json`
- each published worker module

### Start `workerd`

```bash
pnpm serve
```

Default public address:

```text
http://localhost:8080
```

## Route model

Each published worker is exposed under its published name:

```text
http://localhost:8080/<worker-name>/...
```

For the demo MCP worker:

```text
http://localhost:8080/math-mcp-v1-0-0/mcp
```

## Demo smoke tests

Direct helper endpoint:

```bash
curl -X POST http://127.0.0.1:8080/math-mcp-v1-0-0/mcp/tools/add \
  -H 'Content-Type: application/json' \
  -d '{"a":12,"b":30}'
```

MCP initialize:

```bash
curl -X POST http://127.0.0.1:8080/math-mcp-v1-0-0/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"demo","version":"1.0.0"}}}'
```

MCP tool call:

```bash
curl -X POST http://127.0.0.1:8080/math-mcp-v1-0-0/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-03-26' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"add","arguments":{"a":7,"b":8}}}'
```

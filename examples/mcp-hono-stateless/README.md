# MCP worker example

This example is a runnable MCP server built with `@yula-xyz/core`.

It is intentionally simple: it exposes deterministic math tools so you can verify the whole Yula publish -> sync -> serve -> agent call chain.

## Tools

- `add`
- `multiply`
- `summarize-series`

## Local standalone development

If you only want to develop the worker itself without publishing into Yula:

```bash
pnpm --filter @yula-example/mcp-hono-stateless dev
```

Standalone endpoint:

```text
http://localhost:8790/mcp
```

Useful local routes:

- `GET /mcp/tools`
- `GET /mcp/docs`
- `GET /mcp/openapi.json`
- `POST /mcp/tools/add`

## Publish into Yula

### 1. Build the worker bundle

```bash
pnpm --filter @yula-example/mcp-hono-stateless build
```

This creates:

```text
examples/mcp-hono-stateless/dist/main.js
```

### 2. Publish to the local publisher

Make sure `apps/yula-publisher` is already running, then:

```bash
pnpm --filter @yula-example/mcp-hono-stateless publish:local
```

Default publish values:

- worker name: `math-mcp`
- worker version: `1.0.0`
- published route name: `math-mcp-v1-0-0`

## Full demo with Yula

### Terminal 1

```bash
pnpm --filter @yula-xyz/publisher build
cd apps/yula-publisher
node dist/index.js
```

### Terminal 2

```bash
pnpm --filter @yula-example/mcp-hono-stateless build
pnpm --filter @yula-example/mcp-hono-stateless publish:local
```

### Terminal 3

```bash
pnpm --filter @yula-xyz/worker build
cd apps/yula-worker
pnpm sync
pnpm serve
```

Final MCP URL:

```text
http://localhost:8080/math-mcp-v1-0-0/mcp
```

## Smoke tests

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

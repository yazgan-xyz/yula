# Math MCP example

This example is a runnable MCP server built with `@yula-xyz/core`.

It is intentionally simple: it exposes deterministic math tools so you can verify the whole Yula build -> deploy -> run -> agent call chain.

## Tools

- `add`
- `multiply`
- `summarize-series`

## Local standalone development

If you only want to develop the worker itself without publishing into Yula:

```bash
pnpm --filter @yula-example/math-mcp dev
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

## Deploy into Yula Registry

### 1. Build the worker bundle

```bash
pnpm --filter @yula-example/math-mcp build
```

This creates:

```text
examples/math-mcp/dist/main.js
```

### 2. Start the local registry runtime

Make sure the local registry runtime is running:

```bash
pnpm --filter @yula-xyz/registry serve
```

Then deploy the worker:

```bash
pnpm --filter @yula-example/math-mcp deploy:registry
```

Default deploy values:

- worker name: `math-mcp`
- worker version: `1.0.0`
- route name: `math-mcp-v1-0-0`

## Full demo with Yula

### Terminal 1

```bash
pnpm --filter @yula-xyz/registry serve
```

### Terminal 2

```bash
pnpm --filter @yula-example/math-mcp build
pnpm --filter @yula-example/math-mcp deploy:registry
```

Final MCP URL:

```text
http://localhost:8080/math-mcp-v1-0-0/mcp
```

## Smoke tests

CLI tool list:

```bash
node packages/yula-cli/bin/yula.js run math-mcp-v1-0-0
```

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

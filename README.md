# Yula

Yula is a dynamic JavaScript function registry and execution layer built on top of Cloudflare's `workerd`. It is designed for AI tooling use cases where you want to:

- publish fetch-native workers at runtime,
- serve them through a stable router,
- expose them as MCP servers,
- and let agents call them through LangChain or direct HTTP.

## Workspace layout

- `apps/yula-publisher`: accepts published worker modules and generates the `workerd` bundle (`config.capnp` + JS modules).
- `apps/yula-worker`: downloads that bundle, mounts it into `workerd`, and routes incoming requests by worker name.
- `packages/yula-core`: fetch-native SDK for building Yula-compatible MCP servers.
- `examples/mcp-hono-stateless`: example MCP worker built with `@yula-xyz/core`.
- `examples/mcp-live-weather`: example MCP worker that fetches live weather and local time from Open-Meteo.
- `examples/langchain-openai-agent`: example LangChain + OpenAI agent that connects to the published MCP server.
- `examples/langchain-ollama-agent`: example LangChain + Ollama agent that connects to the same MCP servers.

## Requirements

- Node.js `>= 22`
- pnpm `>= 10`

## Install

```bash
pnpm install
```

## Demo flow

This is the fastest path to see the new MCP flow end-to-end.

### 1. Start the publisher

Terminal 1:

```bash
pnpm --filter @yula-xyz/publisher build
cd apps/yula-publisher
node dist/index.js
```

Publisher listens on `http://localhost:8086`.

### 2. Build and publish the example MCP worker

Terminal 2:

```bash
pnpm --filter @yula-example/mcp-hono-stateless build
pnpm --filter @yula-example/mcp-hono-stateless publish:local
```

By default this publishes the worker as `math-mcp-v1-0-0`.

### 3. Sync and start the Yula runtime

Terminal 3:

```bash
pnpm --filter @yula-xyz/worker build
cd apps/yula-worker
pnpm sync
pnpm serve
```

The public worker runtime listens on `http://localhost:8080`.

## Smoke tests

### Direct HTTP helper endpoint

```bash
curl -X POST http://127.0.0.1:8080/math-mcp-v1-0-0/mcp/tools/add \
  -H 'Content-Type: application/json' \
  -d '{"a":12,"b":30}'
```

Expected result:

```json
{
  "structuredContent": {
    "total": 42
  }
}
```

### MCP initialize

```bash
curl -X POST http://127.0.0.1:8080/math-mcp-v1-0-0/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"demo","version":"1.0.0"}}}'
```

### MCP tool call

```bash
curl -X POST http://127.0.0.1:8080/math-mcp-v1-0-0/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-03-26' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"add","arguments":{"a":7,"b":8}}}'
```

Expected result:

```json
{
  "result": {
    "structuredContent": {
      "total": 15
    }
  }
}
```

## LangChain + OpenAI demo

After the three local services above are running:

```bash
export OPENAI_API_KEY=YOUR_KEY
export YULA_MCP_URL=http://localhost:8080/math-mcp-v1-0-0/mcp
pnpm --filter @yula-example/langchain-openai-agent start -- "127 ile 19'u carp ve sonucu bana soyle"
```

The agent will load tools from the MCP server via `MultiServerMCPClient`, let `ChatOpenAI` decide when to call them, and then return the final answer.

## LangChain + Ollama demo

If you want the exact same agent flow against your local Ollama instead of OpenAI:

```bash
export OLLAMA_MODEL=llama3.1
export OLLAMA_BASE_URL=http://127.0.0.1:11434
export YULA_MCP_URL=http://localhost:8080/math-mcp-v1-0-0/mcp
pnpm --filter @yula-example/langchain-ollama-agent start -- "127 ile 19'u carp ve sonucu bana soyle"
```

For the live weather MCP server:

```bash
export YULA_MCP_URL=http://localhost:8080/weather-live-mcp-v1-0-0/mcp
pnpm --filter @yula-example/langchain-ollama-agent start -- "Istanbul icin guncel hava durumunu ve saati kontrol et"
```

## Live weather demo

If you want a clearly real-time example instead of the deterministic math demo:

### 1. Publish the weather worker

```bash
pnpm --filter @yula-example/mcp-live-weather build
pnpm --filter @yula-example/mcp-live-weather publish:local
```

### 2. Resync and serve the runtime

```bash
cd apps/yula-worker
pnpm sync
pnpm serve
```

### 3. Call the live weather tool

```bash
curl -X POST http://127.0.0.1:8080/weather-live-mcp-v1-0-0/mcp/tools/current-weather \
  -H 'Content-Type: application/json' \
  -d '{"city":"Istanbul","countryCode":"TR"}'
```

Look for these two fields in the response:

- `observedAt`: timestamp returned by the weather provider for the live observation
- `fetchedAtUtc`: timestamp created by the MCP worker when it performed the fetch

That pair makes it easy to verify the result is being fetched live.

## Notes

- Published worker route names can include dashes like `math-mcp-v1-0-0`. The publisher now normalizes those names into valid Cap'n Proto identifiers internally.
- The example MCP worker also exposes:
  - `GET /math-mcp-v1-0-0/mcp/tools`
  - `GET /math-mcp-v1-0-0/mcp/docs`
  - `GET /math-mcp-v1-0-0/mcp/openapi.json`
- The live weather worker exposes the same helper routes under `weather-live-mcp-v1-0-0`.
- The live weather example requires outbound internet access because it calls Open-Meteo in real time.

## More detail

- [Publisher README](/Users/alperreha/Desktop/alper/workspace/ai/yula/apps/yula-publisher/README.md)
- [Worker README](/Users/alperreha/Desktop/alper/workspace/ai/yula/apps/yula-worker/README.md)
- [Core SDK README](/Users/alperreha/Desktop/alper/workspace/ai/yula/packages/yula-core/README.md)
- [MCP worker example](/Users/alperreha/Desktop/alper/workspace/ai/yula/examples/mcp-hono-stateless/README.md)
- [Live weather MCP example](/Users/alperreha/Desktop/alper/workspace/ai/yula/examples/mcp-live-weather/README.md)
- [LangChain agent example](/Users/alperreha/Desktop/alper/workspace/ai/yula/examples/langchain-openai-agent/README.md)
- [LangChain Ollama agent example](/Users/alperreha/Desktop/alper/workspace/ai/yula/examples/langchain-ollama-agent/README.md)

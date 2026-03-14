# Yula

Yula is a dynamic JavaScript function registry and execution layer built on top of Cloudflare's `workerd`. It is designed for AI tooling use cases where you want to:

- publish fetch-native workers at runtime,
- serve them through a stable router,
- expose them as MCP servers,
- and let agents call them through LangChain or direct HTTP.

## Local-first registry

Yula now also has a local-first flow built around:

- `apps/yula-registry`: the merged local runtime + config generator
- `packages/yula-cli`: the local control plane for create, deploy, pull, delete, list, and run

That means you can manage workers without the older multi-service publish/sync loop when you are working locally.
The registry stores definitions in SQLite, which makes it easier to copy, move, back up, or eventually sync with a remote registry.

## Workspace layout

- `apps/yula-registry`: merged runtime, SQLite-backed registry, and `workerd` config generator.
- `packages/yula-core`: fetch-native SDK for building Yula-compatible MCP servers.
- `packages/yula-cli`: CLI for deploy, pull, list, delete, and run.
- `examples/math-mcp`: example MCP worker built with `@yula-xyz/core`.
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

## Registry + CLI flow

This is the new local-first path.

By default the local registry state lives at:

```text
~/.yula/registry
```

That folder contains:

- `registry.sqlite`: local and pulled worker definitions
- `config/`: generated runtime files for `workerd`

If you want the registry in a custom path, use `YULA_REGISTRY_ROOT=/path/to/registry` or `--registry /path/to/registry`.

### 1. Start the registry runtime

Terminal 1:

```bash
pnpm --filter @yula-xyz/registry serve
```

### 2. Build and deploy a worker into the registry

Terminal 2:

```bash
pnpm --filter @yula-example/math-mcp build
pnpm --filter @yula-example/math-mcp deploy:registry
```

### 3. Inspect or run it through the CLI

```bash
node packages/yula-cli/bin/yula.js list --registry apps/yula-registry
node packages/yula-cli/bin/yula.js run math-mcp-v1-0-0
node packages/yula-cli/bin/yula.js run math-mcp-v1-0-0 --tool add --input '{"a":12,"b":30}'
```

For the live weather example:

```bash
pnpm --filter @yula-example/mcp-live-weather build
pnpm --filter @yula-example/mcp-live-weather deploy:registry
node packages/yula-cli/bin/yula.js run weather-live-v1-0-0 --tool current-weather --input '{"city":"Istanbul","countryCode":"TR"}'
```

### 4. Pull a remote-style artifact into the local registry

This is the beginning of the Docker-like flow. Today `pull` expects an artifact manifest from a file or URL, then stores it in SQLite so it becomes runnable locally.

Example:

```bash
node packages/yula-cli/bin/yula.js pull demo/shared-math:2.0.0 --file /tmp/shared-math.json
node packages/yula-cli/bin/yula.js list
node packages/yula-cli/bin/yula.js run shared-math-v2-0-0 --tool add --input '{"a":1,"b":2}'
```

The reference format is designed to grow toward:

```text
owner/package:version
```

That maps well to future `yula login`, remote S3-backed artifact storage, and `yula pull` semantics similar to container registries.

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

After the registry runtime is running and the math worker is deployed:

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
export YULA_MCP_URL=http://localhost:8080/weather-live-v1-0-0/mcp
pnpm --filter @yula-example/langchain-ollama-agent start -- "Istanbul icin guncel hava durumunu ve saati kontrol et"
```

## Live weather demo

If you want a clearly real-time example instead of the deterministic math demo:

### 1. Build and deploy the weather worker

```bash
pnpm --filter @yula-example/mcp-live-weather build
pnpm --filter @yula-example/mcp-live-weather deploy:registry
```

### 2. Call the live weather tool

```bash
curl -X POST http://127.0.0.1:8080/weather-live-v1-0-0/mcp/tools/current-weather \
  -H 'Content-Type: application/json' \
  -d '{"city":"Istanbul","countryCode":"TR"}'
```

Look for these two fields in the response:

- `observedAt`: timestamp returned by the weather provider for the live observation
- `fetchedAtUtc`: timestamp created by the MCP worker when it performed the fetch

That pair makes it easy to verify the result is being fetched live.

## Notes

- Published worker route names can include dashes like `math-mcp-v1-0-0`. Yula normalizes those names into valid `workerd` config identifiers internally.
- The local-first registry uses Node's `node:sqlite`, which is still marked experimental in Node 22, but it gives Yula a portable single-file local registry.
- The example MCP worker also exposes:
  - `GET /math-mcp-v1-0-0/mcp/tools`
  - `GET /math-mcp-v1-0-0/mcp/docs`
  - `GET /math-mcp-v1-0-0/mcp/openapi.json`
- The live weather worker exposes the same helper routes under `weather-live-v1-0-0`.
- The live weather example requires outbound internet access because it calls Open-Meteo in real time.

## More detail

- [Registry README](/Users/alperreha/Desktop/alper/workspace/ai/yula/apps/yula-registry/README.md)
- [CLI README](/Users/alperreha/Desktop/alper/workspace/ai/yula/packages/yula-cli/README.md)
- [Core SDK README](/Users/alperreha/Desktop/alper/workspace/ai/yula/packages/yula-core/README.md)
- [MCP worker example](/Users/alperreha/Desktop/alper/workspace/ai/yula/examples/math-mcp/README.md)
- [Live weather MCP example](/Users/alperreha/Desktop/alper/workspace/ai/yula/examples/mcp-live-weather/README.md)
- [LangChain agent example](/Users/alperreha/Desktop/alper/workspace/ai/yula/examples/langchain-openai-agent/README.md)
- [LangChain Ollama agent example](/Users/alperreha/Desktop/alper/workspace/ai/yula/examples/langchain-ollama-agent/README.md)

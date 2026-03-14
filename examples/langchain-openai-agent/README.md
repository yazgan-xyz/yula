# LangChain OpenAI agent example

This example shows how to connect LangChain's `createAgent()` to a Yula-served MCP server.

It uses:

- `MultiServerMCPClient` from `@langchain/mcp-adapters`
- `ChatOpenAI` from `@langchain/openai`
- the MCP endpoint exposed by the published math demo worker

If you want the same flow with a local model instead, use the sibling Ollama example at [examples/langchain-ollama-agent](/Users/alperreha/Desktop/alper/workspace/ai/yula/examples/langchain-ollama-agent/README.md).

## Prerequisites

Before running this example, the local Yula registry runtime should already be up and serving an MCP worker:

```bash
pnpm --filter @yula-xyz/registry serve
pnpm --filter @yula-example/math-mcp build
pnpm --filter @yula-example/math-mcp deploy:registry
```

Target MCP URL:

```text
http://localhost:8080/math-mcp-v1-0-0/mcp
```

You can also point the same agent to the live weather example:

```text
http://localhost:8080/weather-live-v1-0-0/mcp
```

To deploy that worker:

```bash
pnpm --filter @yula-example/mcp-live-weather build
pnpm --filter @yula-example/mcp-live-weather deploy:registry
```

## Environment

Required:

```bash
export OPENAI_API_KEY=YOUR_KEY
export YULA_MCP_URL=http://localhost:8080/math-mcp-v1-0-0/mcp
```

Optional:

```bash
export OPENAI_MODEL=gpt-4.1-mini
export YULA_DEBUG=1
export YULA_AUTH_TOKEN=...
```

To switch to the live weather demo:

```bash
export YULA_MCP_URL=http://localhost:8080/weather-live-v1-0-0/mcp
```

## Run

```bash
pnpm --filter @yula-example/langchain-openai-agent start -- "127 ile 19'u carp ve sonucu bana soyle"
```

The agent will:

1. load tools from the remote Yula MCP endpoint,
2. decide when to call those tools,
3. feed the tool result back into the model,
4. and print the final answer.

If the model calls a tool but does not produce a final text answer, the example now falls back to printing the last MCP tool output. With `YULA_DEBUG=1`, it also prints the loaded tools and raw tool outputs.

## Suggested demo prompt

```bash
pnpm --filter @yula-example/langchain-openai-agent start -- "11 ile 13'u carp, sonra sonucu 5'e bol ve bana tek cumleyle soyle"
```

Weather-specific prompt:

```bash
pnpm --filter @yula-example/langchain-openai-agent start -- "Istanbul icin guncel hava durumunu ve saati kontrol et"
```

## Related files

- Agent entry: [src/index.ts](/Users/alperreha/Desktop/alper/workspace/ai/yula/examples/langchain-openai-agent/src/index.ts)
- MCP worker example: [examples/math-mcp](/Users/alperreha/Desktop/alper/workspace/ai/yula/examples/math-mcp/README.md)

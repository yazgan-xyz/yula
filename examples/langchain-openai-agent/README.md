# LangChain OpenAI agent example

This example shows how to connect LangChain's `createAgent()` to a Yula-served MCP server.

It uses:

- `MultiServerMCPClient` from `@langchain/mcp-adapters`
- `ChatOpenAI` from `@langchain/openai`
- the MCP endpoint exposed by the published math demo worker

## Prerequisites

Before running this example, the local Yula demo stack should already be up:

- `yula-publisher` running on `http://localhost:8086`
- the example MCP worker published as `math-mcp-v1-0-0`
- `yula-worker` serving on `http://localhost:8080`

Target MCP URL:

```text
http://localhost:8080/math-mcp-v1-0-0/mcp
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
export YULA_AUTH_TOKEN=...
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

## Suggested demo prompt

```bash
pnpm --filter @yula-example/langchain-openai-agent start -- "11 ile 13'u carp, sonra sonucu 5'e bol ve bana tek cumleyle soyle"
```

## Related files

- Agent entry: [src/index.ts](/Users/alperreha/Desktop/alper/workspace/ai/yula/examples/langchain-openai-agent/src/index.ts)
- MCP worker example: [examples/mcp-hono-stateless](/Users/alperreha/Desktop/alper/workspace/ai/yula/examples/mcp-hono-stateless/README.md)

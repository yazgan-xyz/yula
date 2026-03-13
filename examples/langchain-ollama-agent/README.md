# LangChain Ollama agent example

This example is the Ollama equivalent of the existing OpenAI agent demo.

It keeps the same MCP and prompt flow:

- load tools from Yula through `MultiServerMCPClient`
- create an agent with `createAgent()`
- let the model decide when to call MCP tools
- print the final answer

The only difference is the model provider: this example uses `ChatOllama` from `@langchain/ollama`.

## Prerequisites

Before running this example:

- your local Ollama server should be running
- the model you want to use should already be pulled in Ollama
- the local Yula MCP demo should already be up

Examples:

```bash
ollama serve
ollama list
ollama pull llama3.1
```

## Environment

Required:

```bash
export OLLAMA_MODEL=llama3.1
```

Optional:

```bash
export OLLAMA_BASE_URL=http://127.0.0.1:11434
export YULA_MCP_URL=http://localhost:8080/math-mcp-v1-0-0/mcp
export YULA_AUTH_TOKEN=...
```

You can also point it to the live weather MCP example:

```bash
export YULA_MCP_URL=http://localhost:8080/weather-live-mcp-v1-0-0/mcp
```

## Run

Math example:

```bash
pnpm --filter @yula-example/langchain-ollama-agent start -- "127 ile 19'u carp ve sonucu bana soyle"
```

Weather example:

```bash
pnpm --filter @yula-example/langchain-ollama-agent start -- "Istanbul icin guncel hava durumunu ve saati kontrol et"
```

## Notes

- Tool-calling quality depends on the Ollama model you choose.
- For the smoothest experience, use a model that supports tool calling well.
- The LangChain JS `ChatOllama` integration is documented here: [LangChain ChatOllama docs](https://docs.langchain.com/oss/javascript/integrations/chat/ollama)

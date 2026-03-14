# Chat Ollama example

This example is the Ollama equivalent of the OpenAI chat demo.

If you want to chat with your local Ollama model against a Yula MCP server, this is the example to run.

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
- the local Yula registry runtime should already be up with a deployed MCP worker

Examples:

```bash
ollama serve
ollama list
ollama pull llama3.1
pnpm --filter @yula-xyz/registry serve
pnpm --filter @yula-example/math-mcp build
pnpm --filter @yula-example/math-mcp deploy:registry
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
export YULA_DEBUG=1
export YULA_AUTH_TOKEN=...
```

You can also point it to the live weather MCP example:

```bash
export YULA_MCP_URL=http://localhost:8080/weather-live-v1-0-0/mcp
```

## Run

Math example:

```bash
pnpm --filter @yula-example/chat-ollama start -- "127 ile 19'u carp ve sonucu bana soyle"
```

Weather example:

```bash
pnpm --filter @yula-example/chat-ollama start -- "Istanbul icin guncel hava durumunu ve saati kontrol et"
```

## Notes

- Tool-calling quality depends on the Ollama model you choose.
- For the smoothest experience, use a model that supports tool calling well.
- `YULA_DEBUG=1` prints the loaded MCP tools and the raw tool outputs, so you can verify whether MCP returned data even if the model does not produce a final natural-language sentence.
- If an Ollama model emits a textual JSON tool request instead of a native LangChain `tool_call`, this example now detects that pattern, executes the MCP tool as a fallback, prints the raw tool result, and does one final model pass to turn that tool result into a user-facing answer.
- The LangChain JS `ChatOllama` integration is documented here: [LangChain ChatOllama docs](https://docs.langchain.com/oss/javascript/integrations/chat/ollama)

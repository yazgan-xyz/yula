# yula-core

`@yula-xyz/core` is the SDK for writing MCP servers that can be published through Yula and executed inside `workerd`.

It wraps the official MCP TypeScript SDK with a fetch-native API so authors can write worker-style modules and publish them without worrying about Node-only server adapters.

## What it gives you

- `createYulaMcpServer()` for defining a fetch-native MCP server
- `server.tool()` for registering MCP tools with Zod schemas
- `server.worker()` for exporting a Yula-compatible fetch handler
- built-in MCP transport at `POST /mcp`
- built-in discovery endpoints:
  - `GET /mcp/tools`
  - `GET /mcp/docs`
  - `GET /mcp/openapi.json`
- direct HTTP helper endpoints at `POST /mcp/tools/:toolName`
- `createPublisherDefinition()` for versioned Yula publish payloads

## Minimal example

```ts
import { createYulaMcpServer, z } from "@yula-xyz/core";

const server = createYulaMcpServer({
  name: "weather-mcp",
  version: "1.0.0",
  description: "Example fetch-native MCP server.",
});

server.tool(
  "echo",
  {
    description: "Echo back the incoming message.",
    inputSchema: {
      message: z.string().describe("Message to echo"),
    },
    outputSchema: {
      message: z.string(),
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  async ({ message }) => ({ message }),
);

export default server.worker();
```

## Runtime behavior

When a worker built with `@yula-xyz/core` is published into Yula, it ends up behind a worker-name prefix:

```text
http://localhost:8080/<worker-name>/mcp
```

Example:

```text
http://localhost:8080/math-mcp-v1-0-0/mcp
```

The SDK is aware of that route shape and correctly handles:

- MCP JSON-RPC requests under the prefixed path
- helper endpoints such as `/tools`, `/docs`, and `/openapi.json`

## Route helper

Use `createPublisherDefinition()` when you want a stable Yula route payload for the registry or for future remote artifact manifests:

```ts
import { createPublisherDefinition } from "@yula-xyz/core";

const payload = createPublisherDefinition({
  name: "math-mcp",
  version: "1.0.0",
  compatibilityDate: "2023-02-28",
  module: builtSource,
});
```

That generates a Yula-safe route name like `math-mcp-v1-0-0`.

## Full example

See the runnable demo worker at [examples/math-mcp](/Users/alperreha/Desktop/alper/workspace/ai/yula/examples/math-mcp/README.md).

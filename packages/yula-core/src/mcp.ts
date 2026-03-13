import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  getParseErrorMessage,
  normalizeObjectSchema,
  safeParseAsync,
  type AnyObjectSchema,
  type AnySchema,
  type SchemaOutput,
  type ShapeOutput,
  type ZodRawShapeCompat,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type {
  CallToolResult,
  Implementation,
  ServerNotification,
  ServerRequest,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";

type MaybePromise<T> = Promise<T> | T;
type JsonObject = Record<string, unknown>;

const DEFAULT_ALLOWED_HEADERS = [
  "Content-Type",
  "Mcp-Session-Id",
  "MCP-Protocol-Version",
  "Last-Event-ID",
];

const DEFAULT_ALLOWED_METHODS = ["GET", "POST", "DELETE", "OPTIONS"];
const JSON_RPC_METHOD_NOT_ALLOWED = {
  jsonrpc: "2.0",
  error: {
    code: -32000,
    message:
      "Method not allowed. Use POST on the MCP endpoint for Streamable HTTP JSON-RPC requests.",
  },
  id: null,
};

type YulaSchema = AnySchema | ZodRawShapeCompat;
type InferSchema<TSchema> = TSchema extends ZodRawShapeCompat
  ? ShapeOutput<TSchema>
  : TSchema extends AnySchema
    ? SchemaOutput<TSchema>
    : undefined;

export type YulaExecutionContext = {
  waitUntil?: (promise: Promise<unknown>) => void;
  passThroughOnException?: () => void;
};

export type YulaToolExample = {
  summary?: string;
  input: unknown;
};

export type YulaToolContext<TEnv = unknown> = {
  request: Request;
  env: TEnv;
  mode: "mcp" | "http";
  signal: AbortSignal;
  executionContext?: YulaExecutionContext;
  sessionId?: string;
};

export type YulaToolResult<TOutputSchema extends YulaSchema | undefined> =
  | CallToolResult
  | InferSchema<TOutputSchema>
  | string
  | number
  | boolean
  | null
  | undefined;

export type YulaToolConfig<
  TInputSchema extends YulaSchema | undefined = undefined,
  TOutputSchema extends YulaSchema | undefined = undefined,
> = {
  title?: string;
  description?: string;
  inputSchema?: TInputSchema;
  outputSchema?: TOutputSchema;
  annotations?: ToolAnnotations;
  examples?: YulaToolExample[];
  _meta?: JsonObject;
};

export type YulaServerSetupContext<TEnv = unknown> = {
  request: Request;
  env: TEnv;
  executionContext?: YulaExecutionContext;
};

export type YulaMcpServerOptions = {
  name: string;
  version: string;
  description?: string;
  basePath?: string;
  enableJsonResponse?: boolean;
  cors?: {
    origin?: string;
    allowHeaders?: string[];
    allowMethods?: string[];
  };
};

type RegisteredTool<TEnv> = {
  name: string;
  config: YulaToolConfig<YulaSchema | undefined, YulaSchema | undefined>;
  inputSchema?: AnyObjectSchema;
  outputSchema?: AnyObjectSchema;
  inputJsonSchema: JsonObject;
  outputJsonSchema?: JsonObject;
  handler: (
    input: unknown,
    context: YulaToolContext<TEnv>,
  ) => MaybePromise<YulaToolResult<YulaSchema | undefined>>;
};

function normalizeBasePath(basePath = "/mcp"): string {
  const normalized = `/${basePath}`.replace(/\/+/g, "/").replace(/\/$/, "");
  return normalized === "" ? "/mcp" : normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractRouteContext(pathname: string, basePath: string) {
  const cleanedPath = pathname.replace(/\/$/, "") || "/";
  const matcher = new RegExp(`^(.*)${escapeRegExp(basePath)}(?:/(.*))?$`);
  const match = cleanedPath.match(matcher);

  if (!match) {
    return null;
  }

  const prefixPath = match[1] || "";
  const relativePath = match[2] ? `/${match[2]}` : "/";
  return {
    prefixPath,
    relativePath,
  };
}

function ensureToolName(name: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error(
      `Tool name "${name}" contains unsupported characters. Use letters, numbers, ".", "_" or "-".`,
    );
  }

  return name;
}

function toObjectJsonSchema(
  schema: YulaSchema | undefined,
  fallbackTitle: string,
): {
  schema?: AnyObjectSchema;
  jsonSchema?: JsonObject;
} {
  if (!schema) {
    return {};
  }

  const normalized = normalizeObjectSchema(schema);

  if (!normalized) {
    throw new Error(`${fallbackTitle} must be an object-shaped schema.`);
  }

  const jsonSchema = toJsonSchemaCompat(normalized, {
    target: "draft-2020-12",
  }) as JsonObject;

  if (jsonSchema.type !== "object") {
    throw new Error(`${fallbackTitle} must resolve to a JSON object schema.`);
  }

  return {
    schema: normalized,
    jsonSchema,
  };
}

function isCallToolResult(value: unknown): value is CallToolResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.content) ||
    typeof candidate.isError === "boolean" ||
    typeof candidate.structuredContent === "object" ||
    typeof candidate._meta === "object"
  );
}

function asTextContent(text: string): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
}

function asJsonContent(value: unknown, fallbackText?: string): CallToolResult {
  return {
    structuredContent:
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : undefined,
    content: [
      {
        type: "text",
        text:
          fallbackText ??
          JSON.stringify(value, null, 2) ??
          "Tool completed successfully.",
      },
    ],
  };
}

function normalizeToolResult(
  value: unknown,
  outputJsonSchema?: JsonObject,
): CallToolResult {
  if (isCallToolResult(value)) {
    return value;
  }

  if (value === undefined) {
    return {
      content: [],
    };
  }

  if (typeof value === "string") {
    return asTextContent(value);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return asTextContent(String(value));
  }

  if (outputJsonSchema && typeof value === "object") {
    return asJsonContent(value);
  }

  return asTextContent(JSON.stringify(value, null, 2));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function parseRequestBody(request: Request): Promise<unknown> {
  const text = await request.text();

  if (!text.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Expected a JSON request body but parsing failed: ${(error as Error).message}`,
    );
  }
}

function appendVary(headers: Headers, value: string) {
  const current = headers.get("Vary");
  if (!current) {
    headers.set("Vary", value);
    return;
  }

  if (!current.split(",").map((item) => item.trim()).includes(value)) {
    headers.set("Vary", `${current}, ${value}`);
  }
}

export class YulaMcpServer<TEnv = unknown> {
  readonly info: Implementation;
  readonly description?: string;
  readonly basePath: string;

  private readonly enableJsonResponse: boolean;
  private readonly tools = new Map<string, RegisteredTool<TEnv>>();
  private readonly setupHooks: Array<
    (
      server: McpServer,
      context: YulaServerSetupContext<TEnv>,
    ) => MaybePromise<void>
  > = [];
  private readonly cors: Required<
    NonNullable<YulaMcpServerOptions["cors"]>
  > = {
    origin: "*",
    allowHeaders: DEFAULT_ALLOWED_HEADERS,
    allowMethods: DEFAULT_ALLOWED_METHODS,
  };

  constructor(options: YulaMcpServerOptions) {
    this.info = {
      name: options.name,
      version: options.version,
    };
    this.description = options.description;
    this.basePath = normalizeBasePath(options.basePath);
    this.enableJsonResponse = options.enableJsonResponse ?? true;

    if (options.cors) {
      this.cors = {
        origin: options.cors.origin ?? "*",
        allowHeaders:
          options.cors.allowHeaders ?? DEFAULT_ALLOWED_HEADERS,
        allowMethods:
          options.cors.allowMethods ?? DEFAULT_ALLOWED_METHODS,
      };
    }
  }

  configure(
    setup: (
      server: McpServer,
      context: YulaServerSetupContext<TEnv>,
    ) => MaybePromise<void>,
  ): this {
    this.setupHooks.push(setup);
    return this;
  }

  tool<
    TInputSchema extends YulaSchema | undefined = undefined,
    TOutputSchema extends YulaSchema | undefined = undefined,
  >(
    name: string,
    config: YulaToolConfig<TInputSchema, TOutputSchema>,
    handler: (
      input: InferSchema<TInputSchema>,
      context: YulaToolContext<TEnv>,
    ) => MaybePromise<YulaToolResult<TOutputSchema>>,
  ): this {
    const toolName = ensureToolName(name);

    if (this.tools.has(toolName)) {
      throw new Error(`Tool "${toolName}" is already registered.`);
    }

    const inputSpec = toObjectJsonSchema(
      config.inputSchema,
      `Tool "${toolName}" inputSchema`,
    );
    const outputSpec = toObjectJsonSchema(
      config.outputSchema,
      `Tool "${toolName}" outputSchema`,
    );

    this.tools.set(toolName, {
      name: toolName,
      config,
      inputSchema: inputSpec.schema,
      outputSchema: outputSpec.schema,
      inputJsonSchema: inputSpec.jsonSchema ?? {
        type: "object",
        properties: {},
      },
      outputJsonSchema: outputSpec.jsonSchema,
      handler: handler as RegisteredTool<TEnv>["handler"],
    });

    return this;
  }

  worker() {
    return {
      fetch: (
        request: Request,
        env: TEnv,
        executionContext?: YulaExecutionContext,
      ) => this.fetch(request, env, executionContext),
    };
  }

  listTools() {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      title: tool.config.title ?? tool.config.annotations?.title ?? tool.name,
      description: tool.config.description ?? "",
      annotations: tool.config.annotations,
      examples: tool.config.examples ?? [],
      inputSchema: tool.inputJsonSchema,
      outputSchema: tool.outputJsonSchema,
    }));
  }

  openApi(request?: Request): JsonObject {
    const routeContext = request
      ? extractRouteContext(new URL(request.url).pathname, this.basePath)
      : null;
    const serverBaseUrl = request
      ? `${new URL(request.url).origin}${routeContext?.prefixPath ?? ""}`
      : undefined;

    const paths: Record<string, JsonObject> = {
      [this.basePath]: {
        post: {
          summary: "MCP Streamable HTTP endpoint",
          description:
            "JSON-RPC entrypoint for MCP clients. LangChain MultiServerMCPClient should target this URL.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: true,
                },
              },
            },
          },
          responses: {
            200: {
              description: "MCP JSON-RPC response payload",
            },
          },
        },
      },
      [`${this.basePath}/tools`]: {
        get: {
          summary: "List registered tools",
          description:
            "Returns the Yula-side tool registry with JSON Schemas and examples.",
          responses: {
            200: {
              description: "Registered tools",
            },
          },
        },
      },
      [`${this.basePath}/openapi.json`]: {
        get: {
          summary: "OpenAPI document",
          description:
            "Machine-readable OpenAPI document for the direct HTTP helper endpoints.",
          responses: {
            200: {
              description: "OpenAPI 3.1 document",
            },
          },
        },
      },
    };

    for (const tool of this.tools.values()) {
      paths[`${this.basePath}/tools/${tool.name}`] = {
        get: {
          summary: `${tool.name} metadata`,
          description:
            tool.config.description ??
            `Returns documentation metadata for the "${tool.name}" tool.`,
          responses: {
            200: {
              description: "Tool metadata",
            },
          },
        },
        post: {
          summary:
            tool.config.title ?? tool.config.annotations?.title ?? tool.name,
          description:
            tool.config.description ??
            `Direct HTTP wrapper for the "${tool.name}" MCP tool.`,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: tool.inputJsonSchema,
                examples: Object.fromEntries(
                  (tool.config.examples ?? []).map((example, index) => [
                    `example_${index + 1}`,
                    {
                      summary:
                        example.summary ??
                        `${tool.name} example ${index + 1}`,
                      value: example.input,
                    },
                  ]),
                ),
              },
            },
          },
          responses: {
            200: {
              description:
                "CallToolResult-compatible response generated by the tool handler.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      content: {
                        type: "array",
                        items: {
                          type: "object",
                          additionalProperties: true,
                        },
                      },
                      structuredContent:
                        tool.outputJsonSchema ?? {
                          type: "object",
                          additionalProperties: true,
                        },
                      isError: {
                        type: "boolean",
                      },
                      _meta: {
                        type: "object",
                        additionalProperties: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      };
    }

    return {
      openapi: "3.1.0",
      info: {
        title: `${this.info.name} MCP Server`,
        version: this.info.version,
        description:
          this.description ??
          `${this.info.name} exposes AI tools over MCP and direct HTTP helper endpoints.`,
      },
      servers: serverBaseUrl
        ? [
            {
              url: serverBaseUrl,
            },
          ]
        : undefined,
      paths,
    };
  }

  async fetch(
    request: Request,
    env: TEnv,
    executionContext?: YulaExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const routeContext = extractRouteContext(url.pathname, this.basePath);

    if (!routeContext) {
      return this.json(
        {
          error: `Path "${url.pathname}" is not handled by this MCP worker.`,
        },
        404,
      );
    }

    if (request.method === "OPTIONS") {
      return this.noContent();
    }

    const { relativePath } = routeContext;

    if (relativePath === "/openapi.json") {
      if (request.method !== "GET") {
        return this.methodNotAllowed(["GET", "OPTIONS"]);
      }

      return this.json(this.openApi(request));
    }

    if (relativePath === "/docs") {
      if (request.method !== "GET") {
        return this.methodNotAllowed(["GET", "OPTIONS"]);
      }

      return this.html(this.renderDocsHtml(request));
    }

    if (relativePath === "/tools") {
      if (request.method !== "GET") {
        return this.methodNotAllowed(["GET", "OPTIONS"]);
      }

      return this.json({
        tools: this.listTools(),
      });
    }

    if (relativePath.startsWith("/tools/")) {
      const toolName = decodeURIComponent(
        relativePath.replace("/tools/", ""),
      );
      return this.handleDirectToolRequest(
        request,
        env,
        toolName,
        executionContext,
      );
    }

    return this.handleMcpTransportRequest(request, env, executionContext);
  }

  private async handleMcpTransportRequest(
    request: Request,
    env: TEnv,
    executionContext?: YulaExecutionContext,
  ) {
    if (request.method !== "POST") {
      return this.json(JSON_RPC_METHOD_NOT_ALLOWED, 405);
    }

    const server = await this.createServer({
      request,
      env,
      executionContext,
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: this.enableJsonResponse,
    });

    await server.connect(transport);
    return this.withCors(await transport.handleRequest(request));
  }

  private async handleDirectToolRequest(
    request: Request,
    env: TEnv,
    toolName: string,
    executionContext?: YulaExecutionContext,
  ): Promise<Response> {
    const tool = this.tools.get(toolName);

    if (!tool) {
      return this.json({ error: `Unknown tool "${toolName}".` }, 404);
    }

    if (request.method === "GET") {
      return this.json({
        name: tool.name,
        title: tool.config.title ?? tool.config.annotations?.title ?? tool.name,
        description: tool.config.description ?? "",
        annotations: tool.config.annotations,
        inputSchema: tool.inputJsonSchema,
        outputSchema: tool.outputJsonSchema,
        examples: tool.config.examples ?? [],
      });
    }

    if (request.method !== "POST") {
      return this.methodNotAllowed(["GET", "POST", "OPTIONS"]);
    }

    let parsedBody: unknown;
    try {
      parsedBody = await parseRequestBody(request);
    } catch (error) {
      return this.json({ error: (error as Error).message }, 400);
    }

    const parsedInput = await this.parseSchema(
      tool.inputSchema,
      parsedBody ?? (tool.inputSchema ? {} : undefined),
      `Tool "${tool.name}" input validation failed`,
    );

    try {
      const result = await this.executeTool(
        tool,
        parsedInput,
        request,
        env,
        executionContext,
        request.signal,
        "http",
      );
      return this.json(result);
    } catch (error) {
      return this.json(
        {
          error: (error as Error).message,
        },
        500,
      );
    }
  }

  private async createServer(context: YulaServerSetupContext<TEnv>) {
    const server = new McpServer(this.info);

    for (const tool of this.tools.values()) {
      server.registerTool(
        tool.name,
        {
          title: tool.config.title,
          description: tool.config.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          annotations: tool.config.annotations,
          _meta: tool.config._meta,
        },
        async (
          input: unknown,
          extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
        ) => {
          return this.executeTool(
            tool,
            input,
            context.request,
            context.env,
            context.executionContext,
            extra.signal,
            "mcp",
            extra.sessionId,
          );
        },
      );
    }

    for (const setup of this.setupHooks) {
      await setup(server, context);
    }

    return server;
  }

  private async executeTool(
    tool: RegisteredTool<TEnv>,
    input: unknown,
    request: Request,
    env: TEnv,
    executionContext: YulaExecutionContext | undefined,
    signal: AbortSignal,
    mode: "mcp" | "http",
    sessionId?: string,
  ): Promise<CallToolResult> {
    const rawResult = await tool.handler(input, {
      request,
      env,
      mode,
      signal,
      executionContext,
      sessionId,
    });
    const normalized = normalizeToolResult(
      rawResult,
      tool.outputJsonSchema,
    );

    if (tool.outputSchema && normalized.structuredContent !== undefined) {
      normalized.structuredContent = (await this.parseSchema(
        tool.outputSchema,
        normalized.structuredContent,
        `Tool "${tool.name}" output validation failed`,
      )) as Record<string, unknown>;
    }

    return normalized;
  }

  private async parseSchema(
    schema: AnyObjectSchema | undefined,
    value: unknown,
    label: string,
  ) {
    if (!schema) {
      return value;
    }

    const result = await safeParseAsync(schema, value);
    if (!result.success) {
      throw new Error(`${label}: ${getParseErrorMessage(result.error)}`);
    }

    return result.data;
  }

  private renderDocsHtml(request: Request): string {
    const routeContext = extractRouteContext(
      new URL(request.url).pathname,
      this.basePath,
    );
    const serverBase = `${new URL(request.url).origin}${routeContext?.prefixPath ?? ""}`;
    const toolCards = this.listTools()
      .map((tool) => {
        const examples = tool.examples.length
          ? `<pre>${escapeHtml(JSON.stringify(tool.examples, null, 2))}</pre>`
          : "<p>No examples provided.</p>";

        return `
          <section class="tool-card">
            <h2>${escapeHtml(tool.title)}</h2>
            <p>${escapeHtml(tool.description || "No description provided.")}</p>
            <p><strong>MCP tool:</strong> ${escapeHtml(tool.name)}</p>
            <p><strong>HTTP helper:</strong> <code>POST ${escapeHtml(this.basePath)}/tools/${escapeHtml(tool.name)}</code></p>
            <h3>Input Schema</h3>
            <pre>${escapeHtml(JSON.stringify(tool.inputSchema, null, 2))}</pre>
            <h3>Output Schema</h3>
            <pre>${escapeHtml(JSON.stringify(tool.outputSchema ?? { type: "object" }, null, 2))}</pre>
            <h3>Examples</h3>
            ${examples}
          </section>
        `;
      })
      .join("\n");

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(this.info.name)} MCP Docs</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f4ed;
        --card: #fffdf8;
        --ink: #1f1d1a;
        --muted: #665f57;
        --accent: #0f766e;
        --line: #ded6cb;
      }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: radial-gradient(circle at top, #fff8ea, var(--bg) 45%);
        color: var(--ink);
      }
      main {
        max-width: 960px;
        margin: 0 auto;
        padding: 48px 20px 80px;
      }
      h1, h2, h3 {
        font-family: "Space Grotesk", "Avenir Next", sans-serif;
      }
      a {
        color: var(--accent);
      }
      .hero, .tool-card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 24px;
        box-shadow: 0 12px 32px rgba(31, 29, 26, 0.06);
      }
      .hero {
        margin-bottom: 24px;
      }
      .tool-grid {
        display: grid;
        gap: 20px;
      }
      code, pre {
        font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
      }
      pre {
        background: #f3efe6;
        border-radius: 12px;
        padding: 14px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .links {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 16px;
      }
      .pill {
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 8px 12px;
        text-decoration: none;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <h1>${escapeHtml(this.info.name)} MCP Server</h1>
        <p>${escapeHtml(
          this.description ??
            "Fetch-native MCP server for Yula and workerd runtimes.",
        )}</p>
        <p><strong>MCP endpoint:</strong> <code>POST ${escapeHtml(serverBase)}${escapeHtml(this.basePath)}</code></p>
        <div class="links">
          <a class="pill" href="${escapeHtml(serverBase)}${escapeHtml(this.basePath)}/openapi.json">OpenAPI JSON</a>
          <a class="pill" href="${escapeHtml(serverBase)}${escapeHtml(this.basePath)}/tools">Tool Registry JSON</a>
        </div>
      </section>
      <section class="tool-grid">
        ${toolCards}
      </section>
    </main>
  </body>
</html>`;
  }

  private noContent() {
    return this.withCors(
      new Response(null, {
        status: 204,
      }),
    );
  }

  private methodNotAllowed(allow: string[]) {
    return this.withCors(
      new Response(
        JSON.stringify({
          error: "Method not allowed.",
          allow,
        }),
        {
          status: 405,
          headers: {
            Allow: allow.join(", "),
            "Content-Type": "application/json",
          },
        },
      ),
    );
  }

  private json(payload: unknown, status = 200) {
    return this.withCors(
      new Response(JSON.stringify(payload, null, 2), {
        status,
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
  }

  private html(payload: string, status = 200) {
    return this.withCors(
      new Response(payload, {
        status,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      }),
    );
  }

  private withCors(response: Response) {
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", this.cors.origin);
    headers.set(
      "Access-Control-Allow-Headers",
      this.cors.allowHeaders.join(", "),
    );
    headers.set(
      "Access-Control-Allow-Methods",
      this.cors.allowMethods.join(", "),
    );
    appendVary(headers, "Origin");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

export function createYulaMcpServer<TEnv = unknown>(
  options: YulaMcpServerOptions,
) {
  return new YulaMcpServer<TEnv>(options);
}

export function textToolResult(text: string): CallToolResult {
  return asTextContent(text);
}

export function jsonToolResult(
  value: Record<string, unknown>,
  summary?: string,
): CallToolResult {
  return asJsonContent(value, summary);
}

export { z };

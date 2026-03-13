import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { ChatOllama } from "@langchain/ollama";
import { createAgent } from "langchain";

type RunnableTool = {
  name: string;
  invoke: (input: unknown, config?: unknown) => Promise<unknown>;
};

type ManualToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

function isDebugEnabled() {
  return process.env.YULA_DEBUG === "1";
}

function getUserPrompt() {
  const prompt = process.argv.slice(2).join(" ").trim();
  return (
    prompt ||
    "11 ile 13'u carp, sonra sonucu 5'e bol ve bana tek cumleyle soyle."
  );
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the Ollama example.`);
  }

  return value;
}

function contentToText(content: unknown): string {
  if (content == null) {
    return "";
  }

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part === "object") {
          const candidate = part as Record<string, unknown>;
          if (typeof candidate.text === "string") {
            return candidate.text;
          }
        }

        const serialized = JSON.stringify(part);
        return typeof serialized === "string" ? serialized : "";
      })
      .filter((part) => part.trim().length > 0)
      .join("\n");
  }

  if (content && typeof content === "object") {
    const candidate = content as Record<string, unknown>;
    if (typeof candidate.text === "string") {
      return candidate.text.trim();
    }
  }

  const serialized = JSON.stringify(content, null, 2);
  return typeof serialized === "string" ? serialized : "";
}

function hasNamespace(record: Record<string, unknown>, expected: string) {
  const namespace = record.lc_namespace;
  return (
    namespace === expected ||
    (Array.isArray(namespace) && namespace.at(-1) === expected)
  );
}

function isAssistantMessage(record: Record<string, unknown>) {
  return (
    record.type === "ai" ||
    record.role === "assistant" ||
    hasNamespace(record, "AIMessage")
  );
}

function isToolMessage(record: Record<string, unknown>) {
  return (
    record.type === "tool" ||
    record.role === "tool" ||
    hasNamespace(record, "ToolMessage")
  );
}

function getMessages(result: unknown) {
  if (!result || typeof result !== "object") {
    return [];
  }

  const candidate = result as Record<string, unknown>;
  return Array.isArray(candidate.messages) ? candidate.messages : [];
}

function collectToolOutputs(result: unknown): string[] {
  const outputs: string[] = [];

  for (const message of getMessages(result)) {
    if (!message || typeof message !== "object") {
      continue;
    }

    const record = message as Record<string, unknown>;
    if (!isToolMessage(record)) {
      continue;
    }

    const text = contentToText(record.content).trim();
    if (text) {
      outputs.push(text);
    }
  }

  return outputs;
}

function tryParseJson<T>(value: string): T | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

function extractJsonFromMarkdownFence(value: string) {
  const match = value.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? null;
}

function coerceObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getToolCallFromObject(
  value: unknown,
  allowedToolNames: Set<string>,
): ManualToolCall | null {
  const record = coerceObject(value);
  if (!record) {
    return null;
  }

  const toolName =
    typeof record.name === "string"
      ? record.name
      : typeof record.tool === "string"
        ? record.tool
        : typeof record.toolName === "string"
          ? record.toolName
          : null;
  const argsCandidate =
    coerceObject(record.arguments) ??
    coerceObject(record.args) ??
    coerceObject(record.parameters) ??
    coerceObject(record.input);

  if (!toolName || !argsCandidate || !allowedToolNames.has(toolName)) {
    return null;
  }

  return {
    name: toolName,
    arguments: argsCandidate,
  };
}

function maybeUnwrapNestedArguments(argumentsRecord: Record<string, unknown>) {
  const entries = Object.entries(argumentsRecord);
  if (entries.length !== 1) {
    return null;
  }

  const nested = coerceObject(entries[0]?.[1]);
  return nested ?? null;
}

function collectToolCalls(result: unknown): ManualToolCall[] {
  const candidates: ManualToolCall[] = [];

  for (const message of getMessages(result)) {
    if (!message || typeof message !== "object") {
      continue;
    }

    const record = message as Record<string, unknown>;
    if (!isAssistantMessage(record)) {
      continue;
    }

    const toolCalls = Array.isArray(record.tool_calls) ? record.tool_calls : [];
    for (const toolCall of toolCalls) {
      const toolCallRecord = coerceObject(toolCall);
      const args = coerceObject(toolCallRecord?.args);
      const name =
        typeof toolCallRecord?.name === "string" ? toolCallRecord.name : null;

      if (name && args) {
        candidates.push({
          name,
          arguments: args,
        });
      }
    }
  }

  return candidates;
}

function findManualToolCallCandidate(
  result: unknown,
  tools: RunnableTool[],
): ManualToolCall | null {
  const allowedToolNames = new Set(tools.map((tool) => tool.name));
  const nativeToolCall = collectToolCalls(result).find((toolCall) =>
    allowedToolNames.has(toolCall.name),
  );

  if (nativeToolCall) {
    return nativeToolCall;
  }

  const messages = getMessages(result);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") {
      continue;
    }

    const record = message as Record<string, unknown>;
    if (!isAssistantMessage(record)) {
      continue;
    }

    const rawText = contentToText(record.content).trim();
    if (!rawText) {
      continue;
    }

    const fencedJson = extractJsonFromMarkdownFence(rawText);
    const parsed =
      tryParseJson<unknown>(rawText) ??
      (fencedJson ? tryParseJson<unknown>(fencedJson) : null);
    const toolCall = getToolCallFromObject(parsed, allowedToolNames);
    if (toolCall) {
      return toolCall;
    }
  }

  return null;
}

function outputToText(output: unknown): string {
  if (output == null) {
    return "";
  }

  if (typeof output === "string") {
    return output.trim();
  }

  const record = coerceObject(output);
  if (record) {
    if (typeof record.content === "string") {
      return record.content.trim();
    }

    if (Array.isArray(record.content)) {
      return contentToText(record.content).trim();
    }
  }

  const serialized = JSON.stringify(output, null, 2);
  return typeof serialized === "string" ? serialized : String(output);
}

async function invokeManualToolCall(
  tool: RunnableTool,
  toolCall: ManualToolCall,
) {
  const attemptedInputs: Record<string, unknown>[] = [toolCall.arguments];
  const unwrapped = maybeUnwrapNestedArguments(toolCall.arguments);

  if (unwrapped) {
    attemptedInputs.push(unwrapped);
  }

  let lastError: unknown;
  for (const attemptedInput of attemptedInputs) {
    try {
      const output = await tool.invoke({
        id: `manual-${Date.now()}`,
        name: tool.name,
        type: "tool_call",
        args: attemptedInput,
      });

      return {
        input: attemptedInput,
        output,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function synthesizeAnswerFromToolResult(
  model: ChatOllama,
  prompt: string,
  toolCall: ManualToolCall,
  toolOutputText: string,
) {
  const response = await model.invoke([
    {
      role: "system",
      content:
        "You are a Yula-enabled assistant. A tool has already been executed successfully. Use the tool result below and answer the user directly in Turkish. Do not emit JSON or ask to call another tool.",
    },
    {
      role: "user",
      content: [
        `Original user request: ${prompt}`,
        `Tool used: ${toolCall.name}`,
        `Tool arguments: ${JSON.stringify(toolCall.arguments, null, 2)}`,
        `Tool result: ${toolOutputText}`,
        "Respond to the user in 1-3 short sentences.",
      ].join("\n\n"),
    },
  ]);

  return contentToText(response.content).trim();
}

function pickFinalMessageText(result: unknown): string {
  if (!result || typeof result !== "object") {
    return String(result);
  }

  const messages = getMessages(result);
  let lastToolOutput = "";

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") {
      continue;
    }

    const record = message as Record<string, unknown>;
    if (isAssistantMessage(record)) {
      const text = contentToText(record.content).trim();
      if (text) {
        return text;
      }
    }

    if (!lastToolOutput && isToolMessage(record)) {
      const text = contentToText(record.content).trim();
      if (text) {
        lastToolOutput = text;
      }
    }
  }

  if (lastToolOutput) {
    return [
      "Model final bir metin uretmedi ama MCP tool'u basariyla yanit verdi:",
      lastToolOutput,
    ].join("\n\n");
  }

  return JSON.stringify(result, null, 2);
}

async function main() {
  const prompt = getUserPrompt();
  const debugEnabled = isDebugEnabled();
  const mcpUrl =
    process.env.YULA_MCP_URL ?? "http://localhost:8080/math-mcp-v1-0-0/mcp";
  const modelName = getRequiredEnv("OLLAMA_MODEL");
  const model = new ChatOllama({
    model: modelName,
    baseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
    temperature: 0,
    maxRetries: 2,
  });

  const client = new MultiServerMCPClient({
    yula: {
      transport: "http",
      url: mcpUrl,
      headers: process.env.YULA_AUTH_TOKEN
        ? {
            Authorization: `Bearer ${process.env.YULA_AUTH_TOKEN}`,
          }
        : undefined,
    },
  });

  try {
    const tools = await client.getTools();
    if (debugEnabled) {
      console.error(`[mcp] connected to ${mcpUrl}`);
      console.error(
        `[mcp] loaded tools: ${tools.map((tool) => tool.name).join(", ") || "(none)"}`,
      );
    }

    const agent = createAgent({
      model,
      tools,
      systemPrompt:
        "You are a Yula-enabled assistant. Use MCP tools whenever they can produce a deterministic answer. After using a tool, always give the user a short final answer.",
    });

    const result = await agent.invoke({
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    if (debugEnabled) {
      const toolOutputs = collectToolOutputs(result);
      if (toolOutputs.length > 0) {
        console.error("[mcp] tool outputs:");
        for (const output of toolOutputs) {
          console.error(output);
        }
      } else {
        console.error("[mcp] no tool output messages were captured.");
      }
    }

    const finalMessageText = pickFinalMessageText(result).trim();
    const manualToolCall = findManualToolCallCandidate(
      result,
      tools as RunnableTool[],
    );

    if (!collectToolOutputs(result).length && manualToolCall) {
      const tool = (tools as RunnableTool[]).find(
        (candidate) => candidate.name === manualToolCall.name,
      );

      if (!tool) {
        throw new Error(
          `The model requested unknown tool "${manualToolCall.name}".`,
        );
      }

      if (debugEnabled) {
        console.error(
          `[mcp] agent returned a textual tool request instead of a native tool_call. Executing fallback for "${manualToolCall.name}".`,
        );
      }

      const { input, output } = await invokeManualToolCall(tool, manualToolCall);
      const toolOutputText = outputToText(output);

      console.error("[mcp] fallback tool input:");
      console.error(JSON.stringify(input, null, 2));
      console.error("[mcp] fallback tool output:");
      console.error(toolOutputText);

      const synthesizedAnswer = await synthesizeAnswerFromToolResult(
        model,
        prompt,
        {
          ...manualToolCall,
          arguments: input,
        },
        toolOutputText,
      );

      console.log(
        synthesizedAnswer ||
          [
            "Tool calisti ama model son bir metin uretmedi.",
            toolOutputText,
          ].join("\n\n"),
      );
      return;
    }

    console.log(finalMessageText);
  } finally {
    if (typeof client.close === "function") {
      await client.close();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

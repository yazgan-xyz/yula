import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";

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
  const mcpUrl =
    process.env.YULA_MCP_URL ?? "http://localhost:8080/math-mcp-v1-0-0/mcp";
  const prompt = getUserPrompt();
  const debugEnabled = isDebugEnabled();
  const model = new ChatOpenAI({
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    temperature: 0,
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

    console.log(pickFinalMessageText(result));
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

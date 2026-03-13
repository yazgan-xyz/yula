import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent } from "langchain";

function getUserPrompt() {
  const prompt = process.argv.slice(2).join(" ").trim();
  return (
    prompt ||
    "11 ile 13'u carp, sonra sonucu 5'e bol ve bana tek cumleyle soyle."
  );
}

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
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

        return JSON.stringify(part);
      })
      .join("\n");
  }

  return JSON.stringify(content, null, 2);
}

function pickFinalMessageText(result: unknown): string {
  if (!result || typeof result !== "object") {
    return String(result);
  }

  const candidate = result as Record<string, unknown>;
  const messages = Array.isArray(candidate.messages) ? candidate.messages : [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") {
      continue;
    }

    const record = message as Record<string, unknown>;
    if (
      record.type === "ai" ||
      record.role === "assistant" ||
      record.lc_namespace === "AIMessage"
    ) {
      return contentToText(record.content);
    }
  }

  return JSON.stringify(result, null, 2);
}

async function main() {
  const mcpUrl =
    process.env.YULA_MCP_URL ?? "http://localhost:8080/math-mcp-v1-0-0/mcp";
  const prompt = getUserPrompt();
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
    const agent = createAgent({
      model,
      tools,
      systemPrompt:
        "You are a Yula-enabled assistant. Use MCP tools whenever they can produce a deterministic answer.",
    });

    const result = await agent.invoke({
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

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

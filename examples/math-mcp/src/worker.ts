import { createYulaMcpServer, z } from "@yula-xyz/core";

export const mathMcp = createYulaMcpServer({
  name: "yula-math-mcp",
  version: "1.0.0",
  description:
    "Example Yula MCP server that exposes deterministic math tools for LangChain and OpenAI agents.",
  basePath: "/mcp",
});

mathMcp.tool(
  "add",
  {
    title: "Add Numbers",
    description:
      "Adds two numbers together. Use this when the user asks for a direct sum.",
    inputSchema: {
      a: z.number().describe("First number to add"),
      b: z.number().describe("Second number to add"),
    },
    outputSchema: {
      total: z.number().describe("The sum of a and b"),
    },
    annotations: {
      title: "Addition",
      readOnlyHint: true,
      idempotentHint: true,
    },
    examples: [
      {
        summary: "Add two integers",
        input: {
          a: 12,
          b: 30,
        },
      },
    ],
  },
  async ({ a, b }) => ({
    total: a + b,
  }),
);

mathMcp.tool(
  "multiply",
  {
    title: "Multiply Numbers",
    description:
      "Multiplies two numbers together. Use this for deterministic arithmetic.",
    inputSchema: {
      a: z.number().describe("First factor"),
      b: z.number().describe("Second factor"),
    },
    outputSchema: {
      product: z.number().describe("The multiplication result"),
    },
    annotations: {
      title: "Multiplication",
      readOnlyHint: true,
      idempotentHint: true,
    },
    examples: [
      {
        summary: "Multiply two integers",
        input: {
          a: 7,
          b: 6,
        },
      },
    ],
  },
  async ({ a, b }) => ({
    product: a * b,
  }),
);

mathMcp.tool(
  "summarize-series",
  {
    title: "Summarize Number Series",
    description:
      "Computes sum, average, minimum and maximum for a list of numbers.",
    inputSchema: {
      values: z
        .array(z.number())
        .min(1)
        .describe("Series of numeric values to summarize"),
    },
    outputSchema: {
      count: z.number().describe("How many values were provided"),
      total: z.number().describe("Sum of all values"),
      average: z.number().describe("Arithmetic mean"),
      min: z.number().describe("Smallest value"),
      max: z.number().describe("Largest value"),
    },
    annotations: {
      title: "Series Summary",
      readOnlyHint: true,
      idempotentHint: true,
    },
    examples: [
      {
        summary: "Summarize four numbers",
        input: {
          values: [4, 8, 15, 16],
        },
      },
    ],
  },
  async ({ values }) => {
    const total = values.reduce((sum, current) => sum + current, 0);
    return {
      count: values.length,
      total,
      average: total / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  },
);

export default mathMcp.worker();

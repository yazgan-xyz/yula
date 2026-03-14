import postgres from "postgres";
import { createYulaMcpServer, z } from "@yula-xyz/core";

type PostgresEnv = {
  DB_DSN?: string;
};

type QueryParam = string | number | boolean | null;

function getDsn(env: PostgresEnv) {
  const dsn = env.DB_DSN?.trim();
  if (!dsn) {
    throw new Error(
      'Missing required env binding "DB_DSN". Deploy or run this worker with --env pointing at a file that contains DB_DSN=postgresql://...',
    );
  }

  return dsn;
}

function normalizeParameters(parameters?: QueryParam[]) {
  return Array.isArray(parameters) ? parameters : [];
}

const postgresMcp = createYulaMcpServer<PostgresEnv>({
  name: "yula-postgres-mcp",
  version: "1.0.0",
  description:
    "Example Yula MCP server that executes SQL queries against a PostgreSQL database using the DB_DSN env binding.",
  basePath: "/mcp",
});

postgresMcp.tool(
  "execute-sql",
  {
    title: "Execute SQL",
    description:
      "Executes a SQL statement against PostgreSQL using the DB_DSN env binding. This can read or mutate data depending on the query text.",
    inputSchema: {
      query: z
        .string()
        .min(1)
        .describe("Raw SQL query text to execute against the target PostgreSQL database."),
      parameters: z
        .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .optional()
        .describe("Optional positional parameters for the SQL query."),
    },
    outputSchema: {
      command: z
        .string()
        .describe("The PostgreSQL command that was executed, such as SELECT, UPDATE or INSERT."),
      rowCount: z
        .number()
        .describe("How many rows were returned or affected by the query."),
      rows: z
        .array(z.record(z.string(), z.unknown()))
        .describe("Returned rows serialized as JSON objects."),
      columns: z
        .array(z.string())
        .describe("Column names reported by PostgreSQL for the query result."),
    },
    annotations: {
      title: "PostgreSQL Query Execution",
      readOnlyHint: false,
      idempotentHint: false,
    },
    examples: [
      {
        summary: "Read the current PostgreSQL time",
        input: {
          query: "select now() as current_time",
        },
      },
      {
        summary: "Parameterized insert",
        input: {
          query: "insert into demo_users (email, active) values ($1, $2) returning id, email, active",
          parameters: ["alper@example.com", true],
        },
      },
    ],
  },
  async ({ query, parameters }, context) => {
    const sql = postgres(getDsn(context.env), {
      prepare: false,
      max: 1,
      idle_timeout: 5,
      connect_timeout: 10,
    });

    try {
      const normalizedParameters = normalizeParameters(parameters);
      const result =
        normalizedParameters.length > 0
          ? await sql.unsafe(query, normalizedParameters)
          : await sql.unsafe(query);

      return {
        command: result.command,
        rowCount: result.count,
        rows: result.map((row) => ({ ...row })),
        columns: result.columns.map((column) => column.name),
      };
    } finally {
      await sql.end({
        timeout: 5,
      });
    }
  },
);

export default postgresMcp.worker();

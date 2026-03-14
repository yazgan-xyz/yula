import { Client, type ClientConfig } from "pg";
import { createYulaMcpServer, z } from "@yula-xyz/core";

type PostgresEnv = {
  DB_URL?: string;
  DBDSN?: string;
  DB_DSN?: string;
  DB_USERNAME?: string;
  DB_USER?: string;
  DB_PASSWORD?: string;
  DB_HOST?: string;
  DB_PORT?: string | number;
  DB_NAME?: string;
  DB_SSL?: string | boolean;
  DB_SSL_REJECT_UNAUTHORIZED?: string | boolean;
};

type QueryParam = string | number | boolean | null;

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseBooleanFlag(
  value: unknown,
  envName: string,
): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(
    `Env binding "${envName}" must be one of true/false, yes/no, on/off, or 1/0.`,
  );
}

function parsePort(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  const normalized = normalizeText(value);
  if (!normalized) {
    return undefined;
  }

  const port = Number.parseInt(normalized, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(
      'Env binding "DB_PORT" must be a positive integer when provided.',
    );
  }

  return port;
}

function resolveSslConfig(env: PostgresEnv): ClientConfig["ssl"] | undefined {
  const sslEnabled = parseBooleanFlag(env.DB_SSL, "DB_SSL");
  if (sslEnabled === undefined) {
    return undefined;
  }

  if (!sslEnabled) {
    return false;
  }

  const rejectUnauthorized = parseBooleanFlag(
    env.DB_SSL_REJECT_UNAUTHORIZED,
    "DB_SSL_REJECT_UNAUTHORIZED",
  );

  if (rejectUnauthorized === false) {
    return {
      rejectUnauthorized: false,
    };
  }

  return true;
}

function getClientConfig(env: PostgresEnv): ClientConfig {
  const connectionString =
    normalizeText(env.DB_URL) ||
    normalizeText(env.DBDSN) ||
    normalizeText(env.DB_DSN);
  const ssl = resolveSslConfig(env);

  if (connectionString) {
    return ssl === undefined ? { connectionString } : { connectionString, ssl };
  }

  const user = normalizeText(env.DB_USERNAME) || normalizeText(env.DB_USER);
  const password = normalizeText(env.DB_PASSWORD);
  const host = normalizeText(env.DB_HOST);
  const database = normalizeText(env.DB_NAME);
  const port = parsePort(env.DB_PORT) ?? 5432;

  if (!user || !password || !host || !database) {
    throw new Error(
      'Missing PostgreSQL connection config. Provide "DB_URL" (or "DBDSN"/"DB_DSN") or set "DB_USERNAME", "DB_PASSWORD", "DB_HOST", and "DB_NAME".',
    );
  }

  return ssl === undefined
    ? {
        user,
        password,
        host,
        port,
        database,
      }
    : {
        user,
        password,
        host,
        port,
        database,
        ssl,
      };
}

function normalizeParameters(parameters?: QueryParam[]) {
  return Array.isArray(parameters) ? parameters : [];
}

function toSerializableValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Uint8Array) {
    return Array.from(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => toSerializableValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        toSerializableValue(nestedValue),
      ]),
    );
  }

  return String(value);
}

function inferCommand(query: string) {
  const [command = "QUERY"] = query.trim().split(/\s+/, 1);
  return command.toUpperCase();
}

const postgresMcp = createYulaMcpServer<PostgresEnv>({
  name: "yula-postgres-mcp",
  version: "1.0.0",
  description:
    "Example Yula MCP server that executes SQL queries against PostgreSQL using Cloudflare's official pg client pattern for Workers and workerd.",
  basePath: "/mcp",
});

postgresMcp.tool(
  "execute-sql",
  {
    title: "Execute SQL",
    description:
      "Executes a SQL statement against PostgreSQL using a DB_URL-style connection string or explicit DB_HOST/DB_PORT/DB_NAME credentials. This can read or mutate data depending on the query text.",
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
    const sql = new Client(getClientConfig(context.env));

    try {
      await sql.connect();

      const normalizedParameters = normalizeParameters(parameters);
      const result =
        normalizedParameters.length > 0
          ? await sql.query(query, normalizedParameters)
          : await sql.query(query);

      return {
        command: result.command || inferCommand(query),
        rowCount: result.rowCount ?? result.rows.length,
        rows: result.rows.map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              toSerializableValue(value),
            ]),
          ),
        ),
        columns: result.fields.map((field) => field.name),
      };
    } finally {
      await sql.end();
    }
  },
);

export default postgresMcp.worker();

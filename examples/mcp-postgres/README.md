# MCP Postgres example

This example is a Yula MCP server that executes SQL against PostgreSQL.

It reads the database connection string from the `DB_DSN` env binding and exposes one tool:

- `execute-sql`

## What it does

- accepts a raw SQL string
- optionally accepts positional parameters
- connects to PostgreSQL using `DB_DSN`
- executes the query
- returns the command, row count, rows, and column names

## Env file

Create a local env file:

```bash
cp examples/mcp-postgres/.env.example examples/mcp-postgres/.env.postgres
```

Expected env shape:

```text
DB_DSN=postgresql://username:password@host:5432/database
```

## Local standalone development

```bash
export DB_DSN=postgresql://postgres:postgres@127.0.0.1:5432/postgres
pnpm --filter @yula-example/mcp-postgres dev
```

Standalone endpoint:

```text
http://localhost:8792/mcp
```

## Deploy into Yula Registry

### 1. Build

```bash
pnpm --filter @yula-example/mcp-postgres build
```

### 2. Start the registry runtime

```bash
pnpm --filter @yula-xyz/registry serve
```

### 3. Deploy with env

```bash
node packages/yula-cli/bin/yula.js deploy examples/mcp-postgres/dist/main.js \
  --name postgres-mcp \
  --version 1.0.0 \
  --flag nodejs_compat \
  --env examples/mcp-postgres/.env.postgres
```

Final MCP URL:

```text
http://localhost:8080/postgres-mcp-v1-0-0/mcp
```

## Direct test

```bash
node packages/yula-cli/bin/yula.js run postgres-mcp-v1-0-0 \
  --tool execute-sql \
  --input '{"query":"select now() as current_time"}' \
  --env examples/mcp-postgres/.env.postgres
```

Parameterized query example:

```bash
node packages/yula-cli/bin/yula.js run postgres-mcp-v1-0-0 \
  --tool execute-sql \
  --input '{"query":"select $1::text as message, $2::int as value","parameters":["hello",42]}' \
  --env examples/mcp-postgres/.env.postgres
```

## Notes

- This example executes raw SQL, so it should only be used against databases you trust.
- The `DB_DSN` env file path is stored in the local Yula registry and turned into `workerd` env bindings during refresh.
- The deploy command enables `nodejs_compat`, because the underlying `postgres` (`Postgres.js`) driver uses Node-compatible sockets in the worker runtime.

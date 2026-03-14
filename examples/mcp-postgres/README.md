# MCP Postgres example

This example is a Yula MCP server that executes SQL against PostgreSQL using the same `pg` client pattern Cloudflare documents for Workers and `workerd`.

It exposes one tool:

- `execute-sql`

## What it does

- accepts a raw SQL string
- optionally accepts positional parameters
- creates a `pg` client inside the request
- connects, runs the query, and closes the connection
- returns the command, row count, rows, and column names

## Connection env

Create a local env file:

```bash
cp examples/mcp-postgres/.env.example examples/mcp-postgres/.env.postgres
```

The worker accepts either a single connection string:

```text
DB_URL=postgresql://username:password@host:5432/database
DB_SSL=false
```

or explicit fields:

```text
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=postgres
DB_SSL=false
```

For backward compatibility it also accepts `DBDSN` and `DB_DSN` as aliases for `DB_URL`.

## Local standalone development

```bash
export DB_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres
export DB_SSL=false
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
- The `.env` file path is stored in the local Yula registry and turned into `workerd` text bindings during refresh.
- The deploy command enables `nodejs_compat`, because the official Cloudflare `pg` flow relies on Worker TCP socket support and Node compatibility.
- This example is closest to the official Cloudflare tutorial at [developers.cloudflare.com/workers/tutorials/postgres](https://developers.cloudflare.com/workers/tutorials/postgres/).

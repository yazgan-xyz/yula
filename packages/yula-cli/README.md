# Yula CLI

`yula` is the local control plane for Yula Registry.

Commands:

- `yula create <file> --name <service-name> [--env .env] [--flag nodejs_compat]`
- `yula deploy <file> --name <service-name> [--env .env] [--flag nodejs_compat]`
- `yula pull <owner/name:version> --url <artifact.json> [--env .env] [--flag nodejs_compat]`
- `yula pull <owner/name:version> --file <artifact.json> [--env .env] [--flag nodejs_compat]`
- `yula delete <route-or-alias>`
- `yula list`
- `yula run <route> [--env .env]`
- `yula run <route> --tool <tool-name> --input '{"key":"value"}' [--env .env]`

Typical local flow:

```bash
pnpm --filter @yula-xyz/registry serve
pnpm exec yula deploy examples/mcp-live-weather/dist/main.js --name weather-live --version 1.0.0
pnpm exec yula pull demo/shared-math:2.0.0 --file /tmp/shared-math.json
pnpm exec yula list
pnpm exec yula run weather-live-v1-0-0 --tool current-weather --input '{"city":"Istanbul","countryCode":"TR"}'
```

Worker-level env example:

```bash
pnpm exec yula deploy dist/main.js --name postgres-mcp --version 1.0.0 --env .env.postgres
pnpm exec yula run postgres-mcp-v1-0-0 --tool execute-sql --input '{"query":"select now()"}' --env .env.postgres
```

Worker flag example:

```bash
pnpm exec yula deploy dist/main.js --name postgres-mcp --version 1.0.0 --flag nodejs_compat --env .env.postgres
```

Notes:

- `deploy` writes a local worker entry into the registry SQLite database.
- `--env` stores a local env file path on the worker entry and Yula turns those variables into `workerd` text bindings for that worker.
- `--flag` stores runtime compatibility flags on the worker entry and writes them into `workerd` config generation.
- `pull` is the bridge to the future remote registry flow. Today it imports an artifact manifest from a file or URL and stores it locally in SQLite.
- `run` can target a route name, alias, or a pulled reference that resolves to a route stored in SQLite.
- `run --env` updates the local worker entry before the call, so you can point the same MCP worker at a different local env file.

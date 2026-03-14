# Yula Registry

`@yula-xyz/registry` is the local-first runtime for Yula.

It merges the old publisher + worker responsibilities into one place:

- `registry.sqlite` stores local and pulled worker definitions
- `config/` stores generated workerd runtime files
- `data/` is only kept as a legacy import path for older JSON-based entries
- `pnpm --filter @yula-xyz/registry refresh` regenerates the runtime config
- `pnpm --filter @yula-xyz/registry serve` watches for changes and restarts workerd automatically
- worker-specific `.env` files are parsed and written into `workerd` as text bindings

Default local state root:

```text
~/.yula/registry
```

You can override it with `YULA_REGISTRY_ROOT=/custom/path` or `--registry /custom/path` from `yula`. The CLI also respects `YULA_REGISTRY_ROOT`, so `serve` and `yula run` can share the same SQLite file.

Default runtime URL:

```text
http://127.0.0.1:8080
```

Typical flow:

```bash
pnpm --filter @yula-xyz/registry serve
node packages/yula-cli/bin/yula.js deploy examples/mcp-live-weather/dist/main.js --name weather-live --version 1.0.0
node packages/yula-cli/bin/yula.js pull demo/shared-math:2.0.0 --file /tmp/shared-math.json
node packages/yula-cli/bin/yula.js list
node packages/yula-cli/bin/yula.js run weather-live-v1-0-0 --tool current-weather --input '{"city":"Istanbul","countryCode":"TR"}'
```

Env-backed worker example:

```bash
node packages/yula-cli/bin/yula.js deploy dist/main.js --name postgres-mcp --version 1.0.0 --flag nodejs_compat --env .env.postgres
node packages/yula-cli/bin/yula.js run postgres-mcp-v1-0-0 --tool execute-sql --input '{"query":"select now()"}'
```

If `.env.postgres` changes while `serve` is running, Yula watches that file and restarts `workerd` so the worker sees the new values.

The matching CLI lives in [packages/yula-cli](/Users/alperreha/Desktop/alper/workspace/ai/yula/packages/yula-cli/README.md).

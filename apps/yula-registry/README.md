# Yula Registry

`@yula-xyz/registry` is the local-first runtime for Yula.

It merges the old publisher + worker responsibilities into one place:

- `registry.sqlite` stores local and pulled worker definitions
- `config/` stores generated workerd runtime files
- `data/` is only kept as a legacy import path for older JSON-based entries
- `pnpm --filter @yula-xyz/registry refresh` regenerates the runtime config
- `pnpm --filter @yula-xyz/registry serve` watches for changes and restarts workerd automatically

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

The matching CLI lives in [packages/yula-cli](/Users/alperreha/Desktop/alper/workspace/ai/yula/packages/yula-cli/README.md).

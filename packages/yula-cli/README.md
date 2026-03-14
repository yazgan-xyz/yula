# Yula CLI

`yula` is the local control plane for Yula Registry.

Commands:

- `yula create <file> --name <service-name>`
- `yula deploy <file> --name <service-name>`
- `yula pull <owner/name:version> --url <artifact.json>`
- `yula pull <owner/name:version> --file <artifact.json>`
- `yula delete <route-or-alias>`
- `yula list`
- `yula run <route>`
- `yula run <route> --tool <tool-name> --input '{"key":"value"}'`

Typical local flow:

```bash
pnpm --filter @yula-xyz/registry serve
pnpm exec yula deploy examples/mcp-live-weather/dist/main.js --name weather-live --version 1.0.0
pnpm exec yula pull demo/shared-math:2.0.0 --file /tmp/shared-math.json
pnpm exec yula list
pnpm exec yula run weather-live-v1-0-0 --tool current-weather --input '{"city":"Istanbul","countryCode":"TR"}'
```

Notes:

- `deploy` writes a local worker entry into the registry SQLite database.
- `pull` is the bridge to the future remote registry flow. Today it imports an artifact manifest from a file or URL and stores it locally in SQLite.
- `run` can target a route name, alias, or a pulled reference that resolves to a route stored in SQLite.

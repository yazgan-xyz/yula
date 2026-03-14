# Yula CLI

`yula` is the local control plane for Yula Registry.

Commands:

- `yula create <file> --name <service-name>`
- `yula deploy <file> --name <service-name>`
- `yula delete <route-or-alias>`
- `yula list`
- `yula run <route>`
- `yula run <route> --tool <tool-name> --input '{"key":"value"}'`

Typical local flow:

```bash
pnpm --filter @yula-xyz/registry serve
pnpm exec yula deploy examples/mcp-live-weather/dist/main.js --name weather-live --version 1.0.0
pnpm exec yula list
pnpm exec yula run weather-live-v1-0-0 --tool current-weather --input '{"city":"Istanbul","countryCode":"TR"}'
```

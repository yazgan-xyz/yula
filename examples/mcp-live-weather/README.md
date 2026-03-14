# Live weather MCP example

This example is a real-time MCP server built with `@yula-xyz/core`.

It uses the Open-Meteo geocoding and forecast APIs to:

1. resolve a city name,
2. fetch the current weather,
3. return the current observation time together with the fetched weather data.

That makes it easy to see that the result is live rather than hardcoded.

## Tool

- `current-weather`

## What it returns

- resolved city and country
- coordinates and timezone
- live observation time from the weather API
- server fetch time in UTC
- temperature, feels-like temperature, humidity
- wind, precipitation, cloud cover, and pressure

## Standalone local development

```bash
pnpm --filter @yula-example/mcp-live-weather dev
```

Standalone endpoint:

```text
http://localhost:8791/mcp
```

## Deploy into Yula Registry

### 1. Build

```bash
pnpm --filter @yula-example/mcp-live-weather build
```

### 2. Start the registry runtime

```bash
pnpm --filter @yula-xyz/registry serve
```

### 3. Deploy

```bash
pnpm --filter @yula-example/mcp-live-weather deploy:registry
```

Default published route:

```text
weather-live-v1-0-0
```

Final MCP URL through Yula:

```text
http://localhost:8080/weather-live-v1-0-0/mcp
```

## Direct test after deploy

```bash
curl -X POST http://127.0.0.1:8080/weather-live-v1-0-0/mcp/tools/current-weather \
  -H 'Content-Type: application/json' \
  -d '{"city":"Istanbul","countryCode":"TR"}'
```

You should see both:

- `observedAt`: timestamp returned by the weather provider
- `fetchedAtUtc`: timestamp of the current fetch made by the worker

## MCP JSON-RPC test

```bash
curl -X POST http://127.0.0.1:8080/weather-live-v1-0-0/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-03-26' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"current-weather","arguments":{"city":"Berlin","countryCode":"DE"}}}'
```

## Notes

- This example depends on outbound internet access at runtime because it fetches live weather from Open-Meteo.
- It is intentionally non-deterministic across time, so the returned values should change as weather and timestamps change.

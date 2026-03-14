import path from "node:path";
import { parseArgs } from "node:util";
import {
  createRegistryDefinition,
  deleteRegistryDefinition,
  getRegistryBaseUrl,
  listRegistryDefinitions,
  refreshRegistry,
  resolveRegistryPaths,
  writeRegistryDefinition,
} from "@yula-xyz/registry";

type ParsedValues = Record<string, string | boolean | undefined>;

function printHelp() {
  console.log(`yula <command> [options]

Commands:
  yula create <file> --name <service-name> [--version 1.0.0]
  yula deploy <file> --name <service-name> [--version 1.0.0]
  yula delete <route-or-alias>
  yula list
  yula run <route> [--tool <tool-name>] [--input '{"key":"value"}']

Examples:
  yula create examples/mcp-live-weather/dist/main.js --name weather-live --version 1.0.0
  yula list
  yula run weather-live-v1-0-0
  yula run weather-live-v1-0-0 --tool current-weather --input '{"city":"Istanbul","countryCode":"TR"}'
`);
}

function getStringValue(values: ParsedValues, key: string) {
  const value = values[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requireStringValue(values: ParsedValues, key: string) {
  const value = getStringValue(values, key);
  if (!value) {
    throw new Error(`Missing required option "--${key}".`);
  }

  return value;
}

function toJsonBody(value: string | undefined) {
  if (!value) {
    return {};
  }

  return JSON.parse(value) as unknown;
}

function formatResponseBody(text: string) {
  if (!text.trim()) {
    return "(empty response body)";
  }

  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

async function handleCreate(command: "create" | "deploy", args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      name: { type: "string" },
      version: { type: "string" },
      registry: { type: "string" },
      alias: { type: "string" },
      "display-name": { type: "string" },
      "compatibility-date": { type: "string" },
      port: { type: "string" },
    },
  });
  const file = positionals[0];
  if (!file) {
    throw new Error(`"yula ${command}" requires a worker file path.`);
  }

  const definition = await createRegistryDefinition({
    file,
    name: requireStringValue(values, "name"),
    version: getStringValue(values, "version"),
    alias: getStringValue(values, "alias"),
    displayName: getStringValue(values, "display-name"),
    compatibilityDate: getStringValue(values, "compatibility-date"),
  });
  const paths = await resolveRegistryPaths(getStringValue(values, "registry"));
  await writeRegistryDefinition(paths, definition);

  const port = Number(getStringValue(values, "port") ?? "8080");
  const refreshed = await refreshRegistry(paths, { port });

  console.log(`[yula] deployed "${definition.name}" from ${path.resolve(file)}`);
  if (definition.alias) {
    console.log(`[yula] alias: ${definition.alias}`);
  }
  console.log(`[yula] registry root: ${paths.root}`);
  console.log(`[yula] runtime url: ${refreshed.baseUrl}/${definition.name}`);
}

async function handleDelete(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      registry: { type: "string" },
      port: { type: "string" },
    },
  });
  const routeOrAlias = positionals[0];
  if (!routeOrAlias) {
    throw new Error(`"yula delete" requires a route or alias.`);
  }

  const paths = await resolveRegistryPaths(getStringValue(values, "registry"));
  const deleted = await deleteRegistryDefinition(paths, routeOrAlias);
  const port = Number(getStringValue(values, "port") ?? "8080");
  await refreshRegistry(paths, { port });

  console.log(`[yula] deleted "${deleted.name}"`);
}

async function handleList(args: string[]) {
  const { values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      registry: { type: "string" },
      port: { type: "string" },
    },
  });
  const paths = await resolveRegistryPaths(getStringValue(values, "registry"));
  const definitions = await listRegistryDefinitions(paths);
  const baseUrl = getRegistryBaseUrl(
    Number(getStringValue(values, "port") ?? "8080"),
  );

  if (definitions.length === 0) {
    console.log("[yula] registry is empty.");
    return;
  }

  for (const definition of definitions) {
    console.log(
      [
        `- ${definition.name}`,
        definition.displayName ? `display=${definition.displayName}` : null,
        definition.alias ? `alias=${definition.alias}` : null,
        `${baseUrl}/${definition.name}`,
      ]
        .filter(Boolean)
        .join(" | "),
    );
  }
}

async function handleRun(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      tool: { type: "string" },
      input: { type: "string" },
      path: { type: "string" },
      method: { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
    },
  });
  const route = positionals[0];
  if (!route) {
    throw new Error(`"yula run" requires a route name.`);
  }

  const host = getStringValue(values, "host") ?? "127.0.0.1";
  const port = Number(getStringValue(values, "port") ?? "8080");
  const baseUrl = `http://${host}:${port}`;
  const toolName = getStringValue(values, "tool");
  const explicitPath = getStringValue(values, "path");
  const method = (getStringValue(values, "method") ?? (toolName ? "POST" : "GET"))
    .toUpperCase();

  let targetPath = explicitPath;
  let body: string | undefined;

  if (!targetPath && toolName) {
    targetPath = `/${route}/mcp/tools/${encodeURIComponent(toolName)}`;
    body = JSON.stringify(toJsonBody(getStringValue(values, "input")), null, 2);
  }

  if (!targetPath) {
    targetPath = `/${route}/mcp/tools`;
  }

  const response = await fetch(`${baseUrl}${targetPath}`, {
    method,
    headers:
      body !== undefined
        ? {
            "Content-Type": "application/json",
          }
        : undefined,
    body,
  });
  const text = await response.text();

  console.log(`[yula] ${method} ${baseUrl}${targetPath}`);
  console.log(`[yula] status: ${response.status}`);
  console.log(formatResponseBody(text));
}

async function handleCommand(command: string, args: string[]) {
  switch (command) {
    case "create":
    case "deploy":
      await handleCreate(command, args);
      return;
    case "delete":
      await handleDelete(args);
      return;
    case "list":
      await handleList(args);
      return;
    case "run":
      await handleRun(args);
      return;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      throw new Error(`Unknown command "${command}".`);
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    printHelp();
    return;
  }

  await handleCommand(command, args);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

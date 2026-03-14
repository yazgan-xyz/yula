import path from "node:path";
import { parseArgs } from "node:util";
import {
  createRegistryDefinition,
  deleteRegistryDefinition,
  getRegistryBaseUrl,
  listRegistryDefinitions,
  pullRegistryArtifact,
  refreshRegistry,
  resolveRegistryDefinition,
  resolveRegistryPaths,
  writeRegistryDefinition,
} from "@yula-xyz/registry";

type ParsedValues = Record<string, string | boolean | undefined>;

function getRegistryRootValue(values: ParsedValues) {
  return getStringValue(values, "registry") ?? process.env.YULA_REGISTRY_ROOT;
}

async function resolveCliRegistryPaths(values: ParsedValues) {
  return resolveRegistryPaths(getRegistryRootValue(values), {
    startDir: process.cwd(),
    stateRootBaseDir: process.cwd(),
  });
}

function printHelp() {
  console.log(`yula <command> [options]

Commands:
  yula create <file> --name <service-name> [--version 1.0.0] [--env .env]
  yula deploy <file> --name <service-name> [--version 1.0.0] [--env .env]
  yula pull <owner/name:version> --url <artifact.json> [--env .env]
  yula delete <route-or-alias>
  yula list
  yula run <route> [--tool <tool-name>] [--input '{"key":"value"}'] [--env .env]

Examples:
  yula create examples/mcp-live-weather/dist/main.js --name weather-live --version 1.0.0 --env .env.weather
  yula pull alper/weather-live:1.0.0 --url https://example.com/weather-live.json --env .env.weather
  yula list
  yula run weather-live-v1-0-0
  yula run weather-live-v1-0-0 --tool current-weather --input '{"city":"Istanbul","countryCode":"TR"}' --env .env.weather
`);
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
      env: { type: "string" },
      registry: { type: "string" },
      alias: { type: "string" },
      "display-name": { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
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
    env: getStringValue(values, "env"),
    alias: getStringValue(values, "alias"),
    displayName: getStringValue(values, "display-name"),
    title: getStringValue(values, "title"),
    description: getStringValue(values, "description"),
    compatibilityDate: getStringValue(values, "compatibility-date"),
  });
  const paths = await resolveCliRegistryPaths(values);
  await writeRegistryDefinition(paths, definition);

  const port = Number(getStringValue(values, "port") ?? "8080");
  const refreshed = await refreshRegistry(paths, { port });

  console.log(`[yula] deployed "${definition.name}" from ${path.resolve(file)}`);
  if (definition.alias) {
    console.log(`[yula] alias: ${definition.alias}`);
  }
  if (definition.envFilePath) {
    console.log(`[yula] env file: ${definition.envFilePath}`);
  }
  console.log(`[yula] registry state: ${paths.stateRoot}`);
  console.log(`[yula] sqlite: ${paths.dbPath}`);
  console.log(`[yula] runtime url: ${refreshed.baseUrl}/${definition.name}`);
}

async function handlePull(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      registry: { type: "string" },
      port: { type: "string" },
      url: { type: "string" },
      file: { type: "string" },
      env: { type: "string" },
      alias: { type: "string" },
      "display-name": { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      name: { type: "string" },
      version: { type: "string" },
    },
  });

  const reference = positionals[0];
  const definition = await pullRegistryArtifact({
    reference,
    url: getStringValue(values, "url"),
    file: getStringValue(values, "file"),
    env: getStringValue(values, "env"),
    alias: getStringValue(values, "alias"),
    displayName: getStringValue(values, "display-name"),
    title: getStringValue(values, "title"),
    description: getStringValue(values, "description"),
    name: getStringValue(values, "name"),
    version: getStringValue(values, "version"),
  });
  const paths = await resolveCliRegistryPaths(values);
  await writeRegistryDefinition(paths, definition);

  const port = Number(getStringValue(values, "port") ?? "8080");
  const refreshed = await refreshRegistry(paths, { port });

  console.log(`[yula] pulled "${definition.name}" into SQLite registry`);
  if (definition.sourceRef) {
    console.log(`[yula] source ref: ${definition.sourceRef}`);
  }
  if (definition.remoteUrl) {
    console.log(`[yula] remote url: ${definition.remoteUrl}`);
  }
  if (definition.envFilePath) {
    console.log(`[yula] env file: ${definition.envFilePath}`);
  }
  console.log(`[yula] sqlite: ${paths.dbPath}`);
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

  const paths = await resolveCliRegistryPaths(values);
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
  const paths = await resolveCliRegistryPaths(values);
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
        definition.title ? `title=${definition.title}` : null,
        definition.alias ? `alias=${definition.alias}` : null,
        definition.envFilePath ? `env=${definition.envFilePath}` : null,
        `source=${definition.sourceType}`,
        definition.sourceRef ? `ref=${definition.sourceRef}` : null,
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
      registry: { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
      env: { type: "string" },
    },
  });
  const selector = positionals[0];
  if (!selector) {
    throw new Error(`"yula run" requires a route name.`);
  }

  const host = getStringValue(values, "host") ?? "127.0.0.1";
  const port = Number(getStringValue(values, "port") ?? "8080");
  const baseUrl = `http://${host}:${port}`;
  const paths = await resolveCliRegistryPaths(values);
  const envFile = getStringValue(values, "env");
  let definition = await resolveRegistryDefinition(paths, selector);
  if (envFile) {
    definition = await writeRegistryDefinition(paths, {
      ...definition,
      envFilePath: path.resolve(envFile),
    });
    await refreshRegistry(paths, { port });
    console.log(`[yula] env file: ${definition.envFilePath}`);
    await wait(750);
  }
  const toolName = getStringValue(values, "tool");
  const explicitPath = getStringValue(values, "path");
  const method = (getStringValue(values, "method") ?? (toolName ? "POST" : "GET"))
    .toUpperCase();

  let targetPath = explicitPath;
  let body: string | undefined;

  if (!targetPath && toolName) {
    targetPath = `/${definition.name}/mcp/tools/${encodeURIComponent(toolName)}`;
    body = JSON.stringify(toJsonBody(getStringValue(values, "input")), null, 2);
  }

  if (!targetPath) {
    targetPath = `/${definition.name}/mcp/tools`;
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
    case "pull":
      await handlePull(args);
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

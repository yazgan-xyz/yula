import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createPublisherDefinition,
  sanitizeWorkerNameSegment,
  type YulaPublisherWorkerDefinition,
} from "@yula-xyz/core";
import { z } from "zod";

const DEFAULT_REGISTRY_APP_NAME = "@yula-xyz/registry";
const DEFAULT_REGISTRY_FALLBACK_DIR = ".yula/registry";
const DEFAULT_PORT = 8080;
const GENERATED_KEEP_FILES = new Set([
  ".gitignore",
  "_router.js",
  "_meta.json",
  "config.capnp",
]);

export const RegistryWorkerDefinitionSchema = z.object({
  name: z
    .string()
    .min(4)
    .max(64)
    .regex(/^[a-z0-9-_]+$/),
  module: z.string().min(1),
  flags: z.array(z.string().min(1)).optional(),
  compatibilityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  alias: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-_]+$/)
    .optional(),
  displayName: z.string().min(1).max(120).optional(),
});

export type RegistryWorkerDefinition = z.infer<
  typeof RegistryWorkerDefinitionSchema
>;

export type RegistryPaths = {
  root: string;
  dataDir: string;
  configDir: string;
  routerEntry: string;
  templatePath: string;
};

export type RegistryRefreshResult = {
  port: number;
  routes: string[];
  definitions: RegistryWorkerDefinition[];
  baseUrl: string;
};

export type CreateRegistryDefinitionOptions = {
  file: string;
  name?: string;
  version?: string;
  compatibilityDate?: string;
  alias?: string;
  displayName?: string;
};

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function findRegistryRootFrom(startDir: string) {
  let currentDir = path.resolve(startDir);

  while (true) {
    const directPackagePath = path.join(currentDir, "package.json");
    if (await pathExists(directPackagePath)) {
      try {
        const packageJson = await readJson<{ name?: string }>(directPackagePath);
        if (packageJson.name === DEFAULT_REGISTRY_APP_NAME) {
          return currentDir;
        }
      } catch {
        // Ignore malformed package.json files while walking the tree.
      }
    }

    const workspaceCandidate = path.join(currentDir, "apps", "yula-registry");
    if (await pathExists(path.join(workspaceCandidate, "package.json"))) {
      return workspaceCandidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  return path.resolve(startDir, DEFAULT_REGISTRY_FALLBACK_DIR);
}

function toCapnpIdentifier(name: string, usedIdentifiers: Set<string>) {
  const tokens = name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((token) => token.replace(/[^a-zA-Z0-9]/g, ""));
  const [firstToken = "worker", ...restTokens] = tokens;
  const firstIdentifierToken = firstToken.replace(/^[^a-zA-Z]+/, "");
  const normalized =
    [
      (firstIdentifierToken || "worker").replace(/^./, (char) =>
        char.toLowerCase(),
      ),
      ...restTokens.map((token) =>
        token.replace(/^./, (char) => char.toUpperCase()),
      ),
    ].join("") || "worker";

  let candidate = normalized;
  let suffix = 1;
  while (usedIdentifiers.has(candidate)) {
    candidate = `${normalized}_${suffix++}`;
  }

  usedIdentifiers.add(candidate);
  return candidate;
}

function insertIntoCapnpList(
  capnp: string,
  anchor: string,
  value: string,
): string {
  const anchorIndex = capnp.indexOf(anchor);
  if (anchorIndex === -1) {
    throw new Error(`Unable to find anchor "${anchor}" in config template.`);
  }

  return (
    capnp.slice(0, anchorIndex + anchor.length) +
    `\n    ${value},` +
    capnp.slice(anchorIndex + anchor.length)
  );
}

async function cleanGeneratedConfigDir(configDir: string) {
  if (!(await pathExists(configDir))) {
    return;
  }

  for (const entry of await fs.readdir(configDir)) {
    if (GENERATED_KEEP_FILES.has(entry)) {
      continue;
    }

    await fs.rm(path.join(configDir, entry), {
      recursive: true,
      force: true,
    });
  }
}

async function bundleRouter(paths: RegistryPaths) {
  await build({
    entryPoints: [paths.routerEntry],
    outfile: path.join(paths.configDir, "_router.js"),
    format: "esm",
    target: "esnext",
    bundle: true,
    minify: true,
    logLevel: "silent",
  });
}

export function getRegistryBaseUrl(port = DEFAULT_PORT) {
  return `http://127.0.0.1:${port}`;
}

export async function resolveRegistryPaths(
  explicitRoot?: string,
  startDir = process.cwd(),
): Promise<RegistryPaths> {
  const root = explicitRoot
    ? path.resolve(explicitRoot)
    : await findRegistryRootFrom(startDir);

  return {
    root,
    dataDir: path.join(root, "data"),
    configDir: path.join(root, "config"),
    routerEntry: path.join(root, "src", "router.ts"),
    templatePath: path.join(root, "config.template.capnp"),
  };
}

export async function ensureRegistryLayout(paths: RegistryPaths) {
  await fs.mkdir(paths.dataDir, { recursive: true });
  await fs.mkdir(paths.configDir, { recursive: true });
}

export async function listRegistryDefinitions(paths: RegistryPaths) {
  await ensureRegistryLayout(paths);

  const definitions: RegistryWorkerDefinition[] = [];
  for (const fileName of await fs.readdir(paths.dataDir)) {
    if (!fileName.endsWith(".json")) {
      continue;
    }

    const filePath = path.join(paths.dataDir, fileName);
    const rawDefinition = await readJson<unknown>(filePath);
    const definition = RegistryWorkerDefinitionSchema.parse(rawDefinition);
    definitions.push(definition);
  }

  return definitions.sort((left, right) => left.name.localeCompare(right.name));
}

export async function writeRegistryDefinition(
  paths: RegistryPaths,
  definition: RegistryWorkerDefinition | YulaPublisherWorkerDefinition,
) {
  await ensureRegistryLayout(paths);
  const normalized = RegistryWorkerDefinitionSchema.parse(definition);
  await fs.writeFile(
    path.join(paths.dataDir, `${normalized.name}.json`),
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );

  return normalized;
}

export async function deleteRegistryDefinition(
  paths: RegistryPaths,
  nameOrAlias: string,
) {
  const definitions = await listRegistryDefinitions(paths);
  const definition = definitions.find(
    (candidate) =>
      candidate.name === nameOrAlias || candidate.alias === nameOrAlias,
  );

  if (!definition) {
    throw new Error(`Registry worker "${nameOrAlias}" was not found.`);
  }

  await fs.rm(path.join(paths.dataDir, `${definition.name}.json`), {
    force: true,
  });

  return definition;
}

export async function createRegistryDefinition(
  options: CreateRegistryDefinitionOptions,
) {
  const filePath = path.resolve(options.file);
  const moduleSource = await fs.readFile(filePath, "utf8");
  const inferredName = path.parse(filePath).name;
  const publishedDefinition = createPublisherDefinition({
    name: options.name ?? inferredName,
    version: options.version ?? "1.0.0",
    module: moduleSource,
    compatibilityDate: options.compatibilityDate ?? "2023-02-28",
  });

  return RegistryWorkerDefinitionSchema.parse({
    ...publishedDefinition,
    alias: options.alias
      ? sanitizeWorkerNameSegment(options.alias)
      : undefined,
    displayName: options.displayName?.trim() || undefined,
  });
}

export async function refreshRegistry(
  paths: RegistryPaths,
  options?: {
    port?: number;
  },
): Promise<RegistryRefreshResult> {
  await ensureRegistryLayout(paths);
  await cleanGeneratedConfigDir(paths.configDir);
  await bundleRouter(paths);

  const definitions = await listRegistryDefinitions(paths);
  const usedIdentifiers = new Set<string>();
  let capnp = (await fs.readFile(paths.templatePath, "utf8")).replace(
    "__YULA_PORT__",
    String(options?.port ?? DEFAULT_PORT),
  );

  for (const definition of definitions) {
    const workerIdentifier = toCapnpIdentifier(definition.name, usedIdentifiers);
    await fs.writeFile(
      path.join(paths.configDir, `${definition.name}.js`),
      definition.module,
      "utf8",
    );

    capnp += `
const ${workerIdentifier} :Workerd.Worker = (
    compatibilityDate = "${definition.compatibilityDate || "2023-02-28"}",
    modules = [(name = "${definition.name}.js", esModule = embed "${definition.name}.js")],
);`;

    capnp = insertIntoCapnpList(
      capnp,
      "services = [",
      `(name = "${definition.name}", worker = .${workerIdentifier})`,
    );
    capnp = insertIntoCapnpList(
      capnp,
      "bindings = [",
      `(name = "${definition.name}", service = "${definition.name}")`,
    );
  }

  await fs.writeFile(
    path.join(paths.configDir, "_meta.json"),
    `${JSON.stringify({
      routes: definitions.map((definition) => definition.name),
    })}\n`,
    "utf8",
  );
  await fs.writeFile(path.join(paths.configDir, "config.capnp"), capnp, "utf8");

  return {
    port: options?.port ?? DEFAULT_PORT,
    routes: definitions.map((definition) => definition.name),
    definitions,
    baseUrl: getRegistryBaseUrl(options?.port ?? DEFAULT_PORT),
  };
}

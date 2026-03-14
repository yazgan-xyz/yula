import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { build } from "esbuild";
import {
  createPublisherDefinition,
  sanitizeWorkerNameSegment,
  type YulaPublisherWorkerDefinition,
} from "@yula-xyz/core";
import { z } from "zod";

const DEFAULT_REGISTRY_APP_NAME = "@yula-xyz/registry";
const DEFAULT_PORT = 8080;
const DEFAULT_SQLITE_FILE_NAME = "registry.sqlite";
const DEFAULT_STATE_DIR_NAME = ".yula/registry";
const GENERATED_KEEP_FILES = new Set([
  ".gitignore",
  "_router.js",
  "_meta.json",
  "config.capnp",
]);

const RegistrySourceTypeSchema = z.enum(["local", "pulled"]);

export const RegistryWorkerDefinitionSchema = z.object({
  name: z
    .string()
    .min(4)
    .max(64)
    .regex(/^[a-z0-9-_]+$/),
  module: z.string().min(1),
  flags: z.array(z.string().min(1)).default([]),
  compatibilityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  alias: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-_]+$/)
    .optional(),
  displayName: z.string().min(1).max(120).optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(4_000).optional(),
  sourceType: RegistrySourceTypeSchema.default("local"),
  sourceRef: z.string().min(1).max(200).optional(),
  owner: z.string().min(1).max(120).optional(),
  packageName: z.string().min(1).max(120).optional(),
  version: z.string().min(1).max(120).optional(),
  remoteUrl: z.string().url().optional(),
  envFilePath: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const RegistryPulledArtifactSchema = z.object({
  name: z.string().min(1).optional(),
  packageName: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  owner: z.string().min(1).optional(),
  module: z.string().min(1),
  compatibilityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  flags: z.array(z.string().min(1)).default([]),
  alias: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-_]+$/)
    .optional(),
  displayName: z.string().min(1).max(120).optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(4_000).optional(),
  remoteUrl: z.string().url().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type RegistryWorkerDefinition = z.infer<
  typeof RegistryWorkerDefinitionSchema
>;

export type RegistryPulledArtifact = z.infer<typeof RegistryPulledArtifactSchema>;

export type RegistryReference = {
  owner?: string;
  packageName: string;
  version?: string;
  sourceRef: string;
};

export type RegistryPaths = {
  appRoot: string;
  stateRoot: string;
  configDir: string;
  dbPath: string;
  routerEntry: string;
  templatePath: string;
};

export type ResolveRegistryPathsOptions = {
  startDir?: string;
  stateRootBaseDir?: string;
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
  env?: string;
  alias?: string;
  displayName?: string;
  title?: string;
  description?: string;
};

export type PullRegistryArtifactOptions = {
  reference?: string;
  url?: string;
  file?: string;
  name?: string;
  version?: string;
  env?: string;
  alias?: string;
  displayName?: string;
  title?: string;
  description?: string;
};

type RegistryRow = {
  name: string;
  module: string;
  compatibility_date: string | null;
  flags_json: string | null;
  alias: string | null;
  display_name: string | null;
  title: string | null;
  description: string | null;
  source_type: string;
  source_ref: string | null;
  owner: string | null;
  package_name: string | null;
  version: string | null;
  remote_url: string | null;
  env_file_path: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

const CREATE_WORKERS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS registry_workers (
  name TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  compatibility_date TEXT,
  flags_json TEXT NOT NULL DEFAULT '[]',
  alias TEXT UNIQUE,
  display_name TEXT,
  title TEXT,
  description TEXT,
  source_type TEXT NOT NULL DEFAULT 'local',
  source_ref TEXT,
  owner TEXT,
  package_name TEXT,
  version TEXT,
  remote_url TEXT,
  env_file_path TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_registry_workers_alias ON registry_workers(alias);
CREATE INDEX IF NOT EXISTS idx_registry_workers_source_ref ON registry_workers(source_ref);
`;

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

async function findRegistryAppRootFrom(startDir: string) {
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

  throw new Error(
    'Unable to locate the "@yula-xyz/registry" app from the current workspace.',
  );
}

function getDefaultRegistryStateRoot() {
  return path.join(os.homedir(), DEFAULT_STATE_DIR_NAME);
}

function openRegistryDatabase(dbPath: string) {
  const database = new DatabaseSync(dbPath);
  database.exec(CREATE_WORKERS_TABLE_SQL);
  const columns = database
    .prepare("PRAGMA table_info(registry_workers)")
    .all() as Array<{ name?: string }>;
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("env_file_path")) {
    database.exec("ALTER TABLE registry_workers ADD COLUMN env_file_path TEXT;");
  }
  return database;
}

function parseJsonColumn<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToRegistryDefinition(row: RegistryRow): RegistryWorkerDefinition {
  return RegistryWorkerDefinitionSchema.parse({
    name: row.name,
    module: row.module,
    compatibilityDate: row.compatibility_date ?? undefined,
    flags: parseJsonColumn<string[]>(row.flags_json, []),
    alias: row.alias ?? undefined,
    displayName: row.display_name ?? undefined,
    title: row.title ?? undefined,
    description: row.description ?? undefined,
    sourceType: row.source_type,
    sourceRef: row.source_ref ?? undefined,
    owner: row.owner ?? undefined,
    packageName: row.package_name ?? undefined,
    version: row.version ?? undefined,
    remoteUrl: row.remote_url ?? undefined,
    envFilePath: row.env_file_path ?? undefined,
    metadata: parseJsonColumn<Record<string, unknown> | undefined>(
      row.metadata_json,
      undefined,
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function upsertDefinition(
  database: DatabaseSync,
  definition: RegistryWorkerDefinition,
) {
  const now = new Date().toISOString();
  const existing = database
    .prepare("SELECT created_at FROM registry_workers WHERE name = ?")
    .get(definition.name) as { created_at?: string } | undefined;
  const createdAt = definition.createdAt ?? existing?.created_at ?? now;
  const updatedAt = now;

  database
    .prepare(
      `INSERT OR REPLACE INTO registry_workers (
        name,
        module,
        compatibility_date,
        flags_json,
        alias,
        display_name,
        title,
        description,
        source_type,
        source_ref,
        owner,
        package_name,
        version,
        remote_url,
        env_file_path,
        metadata_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      definition.name,
      definition.module,
      definition.compatibilityDate ?? null,
      JSON.stringify(definition.flags ?? []),
      definition.alias ?? null,
      definition.displayName ?? null,
      definition.title ?? null,
      definition.description ?? null,
      definition.sourceType,
      definition.sourceRef ?? null,
      definition.owner ?? null,
      definition.packageName ?? null,
      definition.version ?? null,
      definition.remoteUrl ?? null,
      definition.envFilePath ?? null,
      definition.metadata ? JSON.stringify(definition.metadata) : null,
      createdAt,
      updatedAt,
    );

  return RegistryWorkerDefinitionSchema.parse({
    ...definition,
    createdAt,
    updatedAt,
  });
}

async function maybeMigrateLegacyFileDefinitions(
  paths: RegistryPaths,
  database: DatabaseSync,
) {
  const legacyDataDir = path.join(paths.stateRoot, "data");
  if (!(await pathExists(legacyDataDir))) {
    return;
  }

  const countRow = database
    .prepare("SELECT COUNT(*) AS count FROM registry_workers")
    .get() as { count?: number };
  if ((countRow.count ?? 0) > 0) {
    return;
  }

  for (const fileName of await fs.readdir(legacyDataDir)) {
    if (!fileName.endsWith(".json")) {
      continue;
    }

    const rawDefinition = await readJson<unknown>(
      path.join(legacyDataDir, fileName),
    );
    const definition = RegistryWorkerDefinitionSchema.parse(rawDefinition);
    upsertDefinition(database, definition);
  }
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

function normalizeReferenceSegment(value: string) {
  return sanitizeWorkerNameSegment(value);
}

async function resolveEnvFilePath(envFile?: string) {
  if (!envFile?.trim()) {
    return undefined;
  }

  const resolvedPath = path.resolve(envFile.trim());
  try {
    await fs.access(resolvedPath);
  } catch {
    throw new Error(`Env file was not found: ${resolvedPath}`);
  }

  return resolvedPath;
}

function escapeCapnpString(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function validateEnvBindingName(name: string, envFilePath: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(
      `Env variable "${name}" in ${envFilePath} is not a valid workerd binding name.`,
    );
  }
}

async function loadEnvBindings(definition: RegistryWorkerDefinition) {
  if (!definition.envFilePath) {
    return [];
  }

  const envFilePath = path.resolve(definition.envFilePath);
  const envSource = await fs.readFile(envFilePath, "utf8");
  const parsed = parseEnv(envSource);

  return Object.entries(parsed).map(([name, value]) => {
    validateEnvBindingName(name, envFilePath);
    return {
      name,
      value: value ?? "",
    };
  });
}

function renderWorkerBindings(bindings: Array<{ name: string; value: string }>) {
  if (bindings.length === 0) {
    return "";
  }

  const renderedBindings = bindings
    .map(
      ({ name, value }) =>
        `      (name = "${escapeCapnpString(name)}", text = "${escapeCapnpString(value)}")`,
    )
    .join(",\n");

  return `\n    bindings = [\n${renderedBindings}\n    ],`;
}

export function parseRegistryReference(reference: string): RegistryReference {
  const trimmed = reference.trim();
  const match = trimmed.match(
    /^(?:(?<owner>[a-zA-Z0-9][a-zA-Z0-9-_]*)\/)?(?<packageName>[a-zA-Z0-9][a-zA-Z0-9-_]*)(?::(?<version>[a-zA-Z0-9][a-zA-Z0-9._-]*))?$/,
  );

  if (!match?.groups?.packageName) {
    throw new Error(
      `Invalid registry reference "${reference}". Expected "owner/name:version" or "name:version".`,
    );
  }

  const owner = match.groups.owner
    ? normalizeReferenceSegment(match.groups.owner)
    : undefined;
  const packageName = normalizeReferenceSegment(match.groups.packageName);
  const version = match.groups.version?.trim() || undefined;
  const sourceRef = owner
    ? `${owner}/${packageName}${version ? `:${version}` : ""}`
    : `${packageName}${version ? `:${version}` : ""}`;

  return {
    owner,
    packageName,
    version,
    sourceRef,
  };
}

async function loadPulledArtifact(
  options: PullRegistryArtifactOptions,
): Promise<RegistryPulledArtifact> {
  if (!options.url && !options.file) {
    throw new Error(
      '"yula pull" currently needs either "--url <artifact-json>" or "--file <artifact-json>".',
    );
  }

  let rawArtifact: unknown;
  if (options.url) {
    const response = await fetch(options.url);
    if (!response.ok) {
      throw new Error(
        `Failed to pull artifact from ${options.url}: ${response.status} ${response.statusText}`,
      );
    }

    rawArtifact = await response.json();
  } else {
    rawArtifact = await readJson<unknown>(path.resolve(options.file!));
  }

  return RegistryPulledArtifactSchema.parse(rawArtifact);
}

export function getRegistryBaseUrl(port = DEFAULT_PORT) {
  return `http://127.0.0.1:${port}`;
}

export async function resolveRegistryPaths(
  explicitStateRoot?: string,
  options: ResolveRegistryPathsOptions = {},
): Promise<RegistryPaths> {
  const startDir = options.startDir ?? process.cwd();
  const appRoot = await findRegistryAppRootFrom(startDir);
  const resolutionBase = options.stateRootBaseDir
    ? path.resolve(options.stateRootBaseDir)
    : path.resolve(startDir);
  const stateRoot = explicitStateRoot
    ? path.resolve(resolutionBase, explicitStateRoot)
    : getDefaultRegistryStateRoot();

  return {
    appRoot,
    stateRoot,
    configDir: path.join(stateRoot, "config"),
    dbPath: path.join(stateRoot, DEFAULT_SQLITE_FILE_NAME),
    routerEntry: path.join(appRoot, "src", "router.ts"),
    templatePath: path.join(appRoot, "config.template.capnp"),
  };
}

export async function ensureRegistryLayout(paths: RegistryPaths) {
  await fs.mkdir(paths.stateRoot, { recursive: true });
  await fs.mkdir(paths.configDir, { recursive: true });
}

export async function listRegistryDefinitions(paths: RegistryPaths) {
  await ensureRegistryLayout(paths);
  const database = openRegistryDatabase(paths.dbPath);
  try {
    await maybeMigrateLegacyFileDefinitions(paths, database);
    const rows = database
      .prepare(
        `SELECT
          name,
          module,
          compatibility_date,
          flags_json,
          alias,
          display_name,
          title,
          description,
          source_type,
          source_ref,
          owner,
          package_name,
          version,
          remote_url,
          env_file_path,
          metadata_json,
          created_at,
          updated_at
        FROM registry_workers
        ORDER BY name ASC`,
      )
      .all() as RegistryRow[];

    return rows.map(rowToRegistryDefinition);
  } finally {
    database.close();
  }
}

export async function resolveRegistryDefinition(
  paths: RegistryPaths,
  nameOrAliasOrReference: string,
) {
  const definitions = await listRegistryDefinitions(paths);
  const candidate = definitions.find(
    (definition) =>
      definition.name === nameOrAliasOrReference ||
      definition.alias === nameOrAliasOrReference ||
      definition.sourceRef === nameOrAliasOrReference,
  );

  if (!candidate) {
    throw new Error(
      `Registry worker "${nameOrAliasOrReference}" was not found in SQLite registry ${paths.dbPath}.`,
    );
  }

  return candidate;
}

export async function writeRegistryDefinition(
  paths: RegistryPaths,
  definition: RegistryWorkerDefinition | YulaPublisherWorkerDefinition,
) {
  await ensureRegistryLayout(paths);
  const candidate = definition as Partial<RegistryWorkerDefinition>;
  const normalized = RegistryWorkerDefinitionSchema.parse({
    ...candidate,
    sourceType: candidate.sourceType ?? "local",
  });
  const database = openRegistryDatabase(paths.dbPath);
  try {
    return upsertDefinition(database, normalized);
  } finally {
    database.close();
  }
}

export async function deleteRegistryDefinition(
  paths: RegistryPaths,
  nameOrAliasOrReference: string,
) {
  await ensureRegistryLayout(paths);
  const definition = await resolveRegistryDefinition(paths, nameOrAliasOrReference);
  const database = openRegistryDatabase(paths.dbPath);
  try {
    database
      .prepare("DELETE FROM registry_workers WHERE name = ?")
      .run(definition.name);
    return definition;
  } finally {
    database.close();
  }
}

export async function createRegistryDefinition(
  options: CreateRegistryDefinitionOptions,
) {
  const filePath = path.resolve(options.file);
  const moduleSource = await fs.readFile(filePath, "utf8");
  const inferredName = path.parse(filePath).name;
  const version = options.version ?? "1.0.0";
  const packageName = sanitizeWorkerNameSegment(options.name ?? inferredName);
  const envFilePath = await resolveEnvFilePath(options.env);
  const publishedDefinition = createPublisherDefinition({
    name: packageName,
    version,
    module: moduleSource,
    compatibilityDate: options.compatibilityDate ?? "2023-02-28",
  });

  return RegistryWorkerDefinitionSchema.parse({
    ...publishedDefinition,
    alias: options.alias
      ? sanitizeWorkerNameSegment(options.alias)
      : undefined,
    displayName: options.displayName?.trim() || undefined,
    title: options.title?.trim() || options.displayName?.trim() || undefined,
    description: options.description?.trim() || undefined,
    sourceType: "local",
    packageName,
    version,
    envFilePath,
  });
}

export async function pullRegistryArtifact(options: PullRegistryArtifactOptions) {
  const artifact = await loadPulledArtifact(options);
  const reference = options.reference
    ? parseRegistryReference(options.reference)
    : undefined;
  const packageName = sanitizeWorkerNameSegment(
    options.name ??
      artifact.packageName ??
      artifact.name ??
      reference?.packageName ??
      "worker",
  );
  const version =
    options.version ?? artifact.version ?? reference?.version ?? "1.0.0";
  const owner = artifact.owner ?? reference?.owner;
  const envFilePath = await resolveEnvFilePath(options.env);
  const sourceRef =
    reference?.sourceRef ??
    (owner
      ? `${owner}/${packageName}:${version}`
      : `${packageName}:${version}`);
  const publishedDefinition = createPublisherDefinition({
    name: packageName,
    version,
    module: artifact.module,
    compatibilityDate: artifact.compatibilityDate ?? "2023-02-28",
  });

  return RegistryWorkerDefinitionSchema.parse({
    ...publishedDefinition,
    flags: artifact.flags,
    compatibilityDate: artifact.compatibilityDate ?? "2023-02-28",
    alias: options.alias
      ? sanitizeWorkerNameSegment(options.alias)
      : artifact.alias,
    displayName:
      options.displayName?.trim() ||
      artifact.displayName?.trim() ||
      artifact.title?.trim() ||
      undefined,
    title:
      options.title?.trim() || artifact.title?.trim() || artifact.displayName,
    description:
      options.description?.trim() || artifact.description?.trim() || undefined,
    sourceType: "pulled",
    sourceRef,
    owner,
    packageName,
    version,
    remoteUrl: options.url ?? artifact.remoteUrl,
    envFilePath,
    metadata: {
      ...(artifact.metadata ?? {}),
      pulledFromFile: options.file ? path.resolve(options.file) : undefined,
    },
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
    const envBindings = await loadEnvBindings(definition);
    await fs.writeFile(
      path.join(paths.configDir, `${definition.name}.js`),
      definition.module,
      "utf8",
    );

    capnp += `
const ${workerIdentifier} :Workerd.Worker = (
    compatibilityDate = "${definition.compatibilityDate || "2023-02-28"}",
    modules = [(name = "${definition.name}.js", esModule = embed "${definition.name}.js")],${renderWorkerBindings(envBindings)}
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

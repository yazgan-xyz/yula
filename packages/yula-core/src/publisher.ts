const DEFAULT_MAX_NAME_LENGTH = 20;
const MIN_NAME_LENGTH = 4;
const NAME_PATTERN = /^[a-z0-9-_]+$/;

export type YulaPublisherWorkerDefinition = {
  name: string;
  module: string;
  flags?: string[];
  compatibilityDate?: string;
};

export type CreatePublisherDefinitionOptions = {
  name: string;
  module: string;
  version?: string;
  flags?: string[];
  compatibilityDate?: string;
  maxNameLength?: number;
  useVersionSuffix?: boolean;
};

export function sanitizeWorkerNameSegment(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!sanitized) {
    throw new Error("Worker name cannot be empty after sanitization.");
  }

  if (!NAME_PATTERN.test(sanitized)) {
    throw new Error(
      `Worker name "${value}" contains unsupported characters after sanitization.`,
    );
  }

  return sanitized;
}

export function buildVersionedWorkerName(
  name: string,
  version?: string,
  maxNameLength = DEFAULT_MAX_NAME_LENGTH,
): string {
  const baseName = sanitizeWorkerNameSegment(name);
  const versionSuffix = version
    ? `-v${sanitizeWorkerNameSegment(version).replace(/^v+/, "")}`
    : "";
  const combined = `${baseName}${versionSuffix}`;

  if (combined.length < MIN_NAME_LENGTH) {
    throw new Error(
      `Worker name "${combined}" is too short. Expected at least ${MIN_NAME_LENGTH} characters.`,
    );
  }

  if (combined.length > maxNameLength) {
    throw new Error(
      `Worker name "${combined}" is too long for the current publisher limit of ${maxNameLength} characters.`,
    );
  }

  return combined;
}

export function createPublisherDefinition(
  options: CreatePublisherDefinitionOptions,
): YulaPublisherWorkerDefinition {
  const {
    name,
    module,
    version,
    compatibilityDate,
    flags,
    maxNameLength = DEFAULT_MAX_NAME_LENGTH,
    useVersionSuffix = true,
  } = options;

  if (!module.trim()) {
    throw new Error("Worker module source cannot be empty.");
  }

  return {
    name: useVersionSuffix
      ? buildVersionedWorkerName(name, version, maxNameLength)
      : buildVersionedWorkerName(name, undefined, maxNameLength),
    module,
    compatibilityDate,
    flags,
  };
}

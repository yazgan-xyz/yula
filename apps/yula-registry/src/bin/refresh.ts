import {
  getRegistryBaseUrl,
  refreshRegistry,
  resolveRegistryPaths,
} from "../registry.js";

async function main() {
  const port = Number(process.env.YULA_PORT ?? "8080");
  const paths = await resolveRegistryPaths(process.env.YULA_REGISTRY_ROOT);
  const result = await refreshRegistry(paths, { port });

  console.log(`[registry] app root: ${paths.appRoot}`);
  console.log(`[registry] state root: ${paths.stateRoot}`);
  console.log(`[registry] sqlite: ${paths.dbPath}`);
  console.log(`[registry] runtime url: ${getRegistryBaseUrl(port)}`);
  console.log(
    `[registry] routes: ${result.routes.length ? result.routes.join(", ") : "(none)"}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

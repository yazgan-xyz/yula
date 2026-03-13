import { readFile } from "node:fs/promises";
import { createPublisherDefinition } from "@yula-xyz/core";

const publisherUrl =
  process.env.PUBLISHER_URL ?? "http://localhost:8086/api/publish";
const workerName = process.env.YULA_WORKER_NAME ?? "math-mcp";
const workerVersion = process.env.YULA_WORKER_VERSION ?? "1.0.0";
const compatibilityDate =
  process.env.YULA_COMPATIBILITY_DATE ?? "2023-02-28";

async function main() {
  const moduleSource = await readFile(new URL("../dist/main.js", import.meta.url), "utf8");
  const payload = createPublisherDefinition({
    name: workerName,
    version: workerVersion,
    module: moduleSource,
    compatibilityDate,
  });

  const response = await fetch(publisherUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(
      `Publish failed with ${response.status}: ${responseBody || response.statusText}`,
    );
  }

  console.log(`Published worker as "${payload.name}".`);
  console.log(`Suggested MCP URL: http://localhost:8080/${payload.name}/mcp`);
  console.log(responseBody || "{ success: true }");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

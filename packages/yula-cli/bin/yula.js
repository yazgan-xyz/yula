#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const entryPath = path.join(currentDirPath, "..", "src", "index.ts");
const require = createRequire(import.meta.url);
const tsxImportPath = require.resolve("tsx");

const child = spawn(
  process.execPath,
  ["--import", tsxImportPath, entryPath, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: process.env,
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

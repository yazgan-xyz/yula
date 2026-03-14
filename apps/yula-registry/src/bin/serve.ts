import { spawn } from "node:child_process";
import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import {
  refreshRegistry,
  resolveRegistryPaths,
  type RegistryPaths,
} from "../registry.js";

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function stopChild(
  child: ReturnType<typeof spawn> | null,
): Promise<void> {
  if (!child) {
    return;
  }

  const closePromise = new Promise<void>((resolve) => {
    child.once("close", () => resolve());
  });

  child.kill("SIGTERM");
  const timedOut = wait(2_000).then(() => "timeout");
  const result = await Promise.race([closePromise.then(() => "closed"), timedOut]);
  if (result === "timeout") {
    child.kill("SIGKILL");
    await closePromise;
  }
}

function startWorkerd(paths: RegistryPaths) {
  console.log("[registry] starting workerd...");
  return spawn("pnpm", ["workerd", "serve", "config/config.capnp", "--verbose"], {
    cwd: paths.root,
    stdio: "inherit",
    env: process.env,
  });
}

async function main() {
  const port = Number(process.env.YULA_PORT ?? "8080");
  const paths = await resolveRegistryPaths(process.env.YULA_REGISTRY_ROOT);
  let child: ReturnType<typeof spawn> | null = null;
  let disposed = false;
  let restarting = false;
  let restartQueued = false;
  let restartTimer: NodeJS.Timeout | undefined;
  const watchers: FSWatcher[] = [];

  const restart = async (reason: string) => {
    if (disposed) {
      return;
    }

    if (restarting) {
      restartQueued = true;
      return;
    }

    restarting = true;
    try {
      console.log(`[registry] refreshing after ${reason}`);
      await refreshRegistry(paths, { port });
      await stopChild(child);
      if (!disposed) {
        child = startWorkerd(paths);
      }
    } finally {
      restarting = false;
      if (restartQueued && !disposed) {
        restartQueued = false;
        await restart("queued change");
      }
    }
  };

  const scheduleRestart = (reason: string) => {
    if (restartTimer) {
      clearTimeout(restartTimer);
    }

    restartTimer = setTimeout(() => {
      void restart(reason);
    }, 250);
  };

  await refreshRegistry(paths, { port });
  child = startWorkerd(paths);

  watchers.push(
    watch(paths.dataDir, () => scheduleRestart("registry data change")),
    watch(paths.routerEntry, () => scheduleRestart("router change")),
    watch(paths.templatePath, () => scheduleRestart("config template change")),
  );

  const dispose = async () => {
    if (disposed) {
      return;
    }

    disposed = true;
    if (restartTimer) {
      clearTimeout(restartTimer);
    }

    for (const watcher of watchers) {
      watcher.close();
    }

    await stopChild(child);
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void dispose().finally(() => {
        process.exit(0);
      });
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

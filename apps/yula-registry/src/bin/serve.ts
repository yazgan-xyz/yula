import { spawn } from "node:child_process";
import { existsSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import path from "node:path";
import {
  ensureRegistryLayout,
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
  return spawn(
    "pnpm",
    [
      "workerd",
      "serve",
      path.join(paths.configDir, "config.capnp"),
      "--verbose",
    ],
    {
      cwd: paths.appRoot,
      stdio: "inherit",
      env: process.env,
    },
  );
}

async function main() {
  const port = Number(process.env.YULA_PORT ?? "8080");
  const paths = await resolveRegistryPaths(process.env.YULA_REGISTRY_ROOT, {
    startDir: process.cwd(),
    stateRootBaseDir: process.env.INIT_CWD ?? process.cwd(),
  });
  let child: ReturnType<typeof spawn> | null = null;
  let disposed = false;
  let restarting = false;
  let restartQueued = false;
  let restartTimer: NodeJS.Timeout | undefined;
  const watchers: FSWatcher[] = [];
  const envWatchers = new Map<string, FSWatcher>();

  const syncEnvWatchers = (envFilePaths: string[]) => {
    const nextPaths = new Set(
      envFilePaths
        .filter(Boolean)
        .map((envFilePath) => path.resolve(envFilePath)),
    );

    for (const [envFilePath, watcher] of envWatchers) {
      if (nextPaths.has(envFilePath)) {
        continue;
      }

      watcher.close();
      envWatchers.delete(envFilePath);
    }

    for (const envFilePath of nextPaths) {
      if (envWatchers.has(envFilePath) || !existsSync(envFilePath)) {
        continue;
      }

      const watcher = watch(envFilePath, () => {
        scheduleRestart(`env file change: ${path.basename(envFilePath)}`);
      });
      envWatchers.set(envFilePath, watcher);
    }
  };

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
      const result = await refreshRegistry(paths, { port });
      syncEnvWatchers(
        result.definitions
          .map((definition) => definition.envFilePath)
          .filter((envFilePath): envFilePath is string => Boolean(envFilePath)),
      );
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

  await ensureRegistryLayout(paths);
  const initialResult = await refreshRegistry(paths, { port });
  syncEnvWatchers(
    initialResult.definitions
      .map((definition) => definition.envFilePath)
      .filter((envFilePath): envFilePath is string => Boolean(envFilePath)),
  );
  child = startWorkerd(paths);

  console.log(`[registry] app root: ${paths.appRoot}`);
  console.log(`[registry] state root: ${paths.stateRoot}`);
  console.log(`[registry] sqlite: ${paths.dbPath}`);

  watchers.push(
    watch(paths.stateRoot, (_eventType, filename) => {
      if (!filename || filename.toString() === path.basename(paths.dbPath)) {
        scheduleRestart("registry sqlite change");
      }
    }),
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
    for (const watcher of envWatchers.values()) {
      watcher.close();
    }
    envWatchers.clear();

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

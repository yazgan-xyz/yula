import fs from "fs/promises";
import path from "path";
import { WorkerDefinitionSchema } from "./models.js";
import type { Context } from "hono";

export const publish = async (c: Context) => {
  // steps
  // 1- write the definition
  // 2- restart all running workers

  const body = await c.req.json();
  const validationResult = WorkerDefinitionSchema.safeParse(body);

  if (!validationResult.success) {
    return c.json({ error: "Invalid worker definition", details: validationResult.error }, 400);
  }

  const definition = validationResult.data;

  const dataPath = process.env.DATA_PATH;
  if (!dataPath) {
    return c.json({ error: "DATA_PATH is required" }, 500);
  }

  await fs.mkdir(dataPath, { recursive: true });
  await fs.writeFile(
    path.join(dataPath, definition.name + ".json"),
    JSON.stringify(definition),
    "utf-8"
  );

  console.log("Published worker %s", definition.name);

  // run restart in the bg
  // we don't need to wait to be completed
  // Promise.resolve()
  //   .then(async () => {
  //     const workerApp = process.env.FLY_WORKER_APP;
  //     if (!workerApp) {
  //         console.error("FLY_WORKER_APP is missing, skipping restart process.");
  //         return;
  //     }

  //     console.log("Restarting app %s", workerApp);

  //     const machines = await flyApi(`/v1/apps/${workerApp}/machines`);

  //     for (const machine of machines as any) {
  //       // skip non started machine
  //       if (machine.state !== "started") continue;

  //       console.log("Machine %s: restarting", machine.id);

  //       await flyApi(
  //         `/v1/apps/${workerApp}/machines/${machine.id}/stop`,
  //         null
  //       );
  //       await new Promise((r) => setTimeout(r, 2000));
  //       await flyApi(
  //         `/v1/apps/${workerApp}/machines/${machine.id}/start`,
  //         null
  //       );

  //       console.log("Machine %s: restarted", machine.id);
  //     }
  //   })
  //   .catch((err) => {
  //     console.error(err);
  //   });

  return c.json({ success: true });
};

async function flyApi(path: string, data?: any) {
  const endpoint = "http://_api.internal:4280";
  const flyToken = process.env.FLY_AUTH_TOKEN;

  if (!flyToken) {
    throw new Error("FLY_AUTH_TOKEN is missing");
  }

  const response = await fetch(`${endpoint}${path}`, {
    method: arguments.length === 1 ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${flyToken}`,
      ...(data !== undefined
        ? { "content-type": "application/json" }
        : undefined),
    },
    body:
      data !== undefined && data !== null ? JSON.stringify(data) : undefined,
  });

  return await response.json();
}

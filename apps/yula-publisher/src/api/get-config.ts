import fs from "fs/promises";
import path from "path";
import { strToU8, zipSync } from "fflate";
import type { WorkerConfig, WorkerDefinition } from "./models.js";
import type { Context } from "hono";

function toCapnpIdentifier(name: string, usedIdentifiers: Set<string>) {
    const tokens = name
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((token) => token.replace(/[^a-zA-Z0-9]/g, ""));

    const [firstToken = "worker", ...restTokens] = tokens;
    const firstIdentifierToken = firstToken.replace(/^[^a-zA-Z]+/, "");
    const normalized = [
        (firstIdentifierToken || "worker").replace(/^./, (char) => char.toLowerCase()),
        ...restTokens.map((token) => token.replace(/^./, (char) => char.toUpperCase())),
    ].join("") || "worker";

    let candidate = normalized || "worker";
    let suffix = 1;
    while (usedIdentifiers.has(candidate)) {
        candidate = `${normalized}_${suffix++}`;
    }

    usedIdentifiers.add(candidate);
    return candidate;
}

export const getConfig = async (c: Context) => {

    // 1- read all worker definitions
    // 2- create workerd config.capnp file and js
    // 3- zip all and return

    const dataPath = process.env.DATA_PATH;
    if (!dataPath) {
        return c.json({ error: "DATA_PATH is required" }, 500);
    }
    
    let capnp = await fs.readFile("config.template.capnp", "utf8");

    const modules = new Map<string, Uint8Array>();
    const usedIdentifiers = new Set<string>();
    const config: WorkerConfig = {
        routes: []
    };

    for (const file of await fs.readdir(dataPath)) {
        if (!file.endsWith(".json")) continue;

        const definition: WorkerDefinition = JSON.parse(await fs.readFile(path.join(dataPath, file), "utf8"));

        config.routes.push(definition.name);
        modules.set(`${definition.name}.js`, strToU8(definition.module));
        const workerIdentifier = toCapnpIdentifier(definition.name, usedIdentifiers);


        // generate capnp workerd config
        // 1- append workerd config
        // 2- define service
        // 3- add a binding to the router service
        capnp += `
const ${workerIdentifier} :Workerd.Worker = (
    compatibilityDate = "${definition.compatibilityDate || "2023-02-28"}",
    modules = [(name = "${definition.name}.js", esModule = embed "${definition.name}.js")],
);`;

        const serviceStr = "services = [";
        const serviceIdx = capnp.indexOf(serviceStr);
        capnp = capnp.substring(0, serviceIdx + serviceStr.length) +
            `\n    (name = "${definition.name}", worker = .${workerIdentifier}),` +
            capnp.substring(serviceIdx + serviceStr.length);

        const bindingStr = "bindings = [";
        const bindingIdx = capnp.indexOf(bindingStr);
        capnp = capnp.substring(0, bindingIdx + bindingStr.length) +
            `\n    (name = "${definition.name}", service = "${definition.name}"),` +
            capnp.substring(bindingIdx + bindingStr.length);
    }

    const zipped = zipSync({
        ...Object.fromEntries(modules),
        "_meta.json": strToU8(JSON.stringify(config)),
        "config.capnp": strToU8(capnp)
    }, {
        level: 9
    });
    
    c.header("Content-Type", "application/zip");
    return c.body(zipped as any);
};

import { Hono } from "hono";
import { publish } from "./publish.js";
import { getConfig } from "./get-config.js";

export const api = new Hono();

api.post("/publish", publish);
api.get("/config", getConfig);

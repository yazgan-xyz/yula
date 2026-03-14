import { serve } from "@hono/node-server";
import worker from "./worker.js";

const port = Number(process.env.PORT ?? 8792);

serve(
  {
    fetch(request) {
      return worker.fetch(request, {
        DB_DSN: process.env.DB_DSN,
      });
    },
    port,
  },
  (info) => {
    console.log(`Postgres MCP example listening on http://localhost:${info.port}`);
    console.log(`Docs: http://localhost:${info.port}/mcp/docs`);
  },
);

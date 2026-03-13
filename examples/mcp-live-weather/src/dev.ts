import { serve } from "@hono/node-server";
import worker from "./worker.js";

const port = Number(process.env.PORT ?? 8791);

serve(
  {
    fetch(request) {
      return worker.fetch(request, {});
    },
    port,
  },
  (info) => {
    console.log(
      `Live weather MCP worker listening on http://localhost:${info.port}`,
    );
    console.log(`Docs: http://localhost:${info.port}/mcp/docs`);
  },
);

import { serve } from "@hono/node-server";
import worker from "./worker.js";

const port = Number(process.env.PORT ?? 8792);

serve(
  {
    fetch(request) {
      return worker.fetch(request, {
        DB_URL: process.env.DB_URL,
        DBDSN: process.env.DBDSN,
        DB_DSN: process.env.DB_DSN,
        DB_USERNAME: process.env.DB_USERNAME,
        DB_USER: process.env.DB_USER,
        DB_PASSWORD: process.env.DB_PASSWORD,
        DB_HOST: process.env.DB_HOST,
        DB_PORT: process.env.DB_PORT,
        DB_NAME: process.env.DB_NAME,
        DB_SSL: process.env.DB_SSL,
        DB_SSL_REJECT_UNAUTHORIZED: process.env.DB_SSL_REJECT_UNAUTHORIZED,
      });
    },
    port,
  },
  (info) => {
    console.log(`Postgres MCP example listening on http://localhost:${info.port}`);
    console.log(`Docs: http://localhost:${info.port}/mcp/docs`);
  },
);

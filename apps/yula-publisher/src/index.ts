import "dotenv/config";
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { api } from './api/index.js'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

app.route('/api', api)

// Pre-flight environment check
const requiredEnvs = ['DATA_PATH'];
for (const env of requiredEnvs) {
  if (!process.env[env]) {
    console.error(`Missing required environment variable: ${env}`);
    process.exit(1);
  }
}

const port = Number(process.env.PORT) || 3000;

serve({
  fetch: app.fetch,
  port
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})

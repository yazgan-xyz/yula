# yula - workerd based mcp save-call manager

![License](https://img.shields.io/badge/license-Apache%202.0-blue)

Yula is a serverless-style functional execution engine built on top of Cloudflare's `workerd` runtime, designed specifically to provide a flexible and dynamic call registry for AI agents. 

By operating as a Model Context Protocol (MCP) server integration backend, Yula allows AI agents to dynamically generate, serialize, and execute modular JavaScript functions on the fly. 

## Architecture

The Yula ecosystem consists of two core applications working in tandem:

1. **`yula-publisher`**: A centralized registry and configuration generator. AI agents hit this API to register new ECMAScript modules (tools/functions). The publisher persists these modules and bundles them on the fly into a `workerd` ZIP-compatible payload (`config.capnp` + JavaScript modules) using `fflate`.
2. **`yula-worker`**: The execution runtime. It fetches the dynamically generated bundled configuration from the publisher, inflates it, and instantly routes incoming requests to the respective in-memory instantiated background workers via the `workerd` engine.

## Use Case

Rather than hardcoding static predefined tool functions for an LLM agent, Yula allows the agent to iteratively write **single-file JavaScript functions** that instantly become executable HTTP endpoints. 

This enables self-healing and evolving capabilities for agents to write their *own* tools dynamically across conversational memory.

## Development & Setup

Yula is a monorepo managed by `pnpm` workspaces.

### Pre-requisites
- Node.js >= 22
- pnpm >= 10.x

### Quick Start
1. Clone the repository and install dependencies:
   ```bash
   pnpm install
   ```

2. Start the entire ecosystem:
   ```bash
   pnpm dev:all
   ```
   
*(Alternatively, you can run `pnpm publisher` to start the registry or `pnpm worker` to start the execution environment separately).*

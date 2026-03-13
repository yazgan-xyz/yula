# yula-worker

The **execution engine** for the Yula ecosystem, powered by Cloudflare's `workerd`.

This system is responsible for pulling bundled tool definitions from the [yula-publisher](../yula-publisher) and serving them continuously as lightning-fast V8 isolates.

## Lifecycle

1. **Sync**: The worker requests `GET /api/config` from the publisher, fetching the bundled `config.zip` containing all user-defined JavaScript modules and bindings.
2. **Unpack**: It unzips the payload into its local `/config` directory.
3. **Execute**: The `workerd` engine starts routing HTTP requests against the dynamic `config.capnp` mapping to the unzipped localized workers.

## Commands

### `pnpm sync`
Hits the publisher (`http://localhost:8086/api/config`), downloads the ZIP bundle, extracts its contents into `./config`, and cleans up the initial compressed file.

### `pnpm serve`
Starts the local Cloudflare `workerd` instance against the `config.capnp` definition unpacked from the publisher.

### `pnpm build`
Builds internal router mechanisms (if utilized dynamically) using `esbuild`.
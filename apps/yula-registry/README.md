# Yula Registry

`@yula-xyz/registry` is the local-first runtime for Yula.

It merges the old publisher + worker responsibilities into one place:

- `data/` stores published worker definitions
- `config/` stores generated workerd runtime files
- `pnpm --filter @yula-xyz/registry refresh` regenerates the runtime config
- `pnpm --filter @yula-xyz/registry serve` watches for changes and restarts workerd automatically

Default runtime URL:

```text
http://127.0.0.1:8080
```

The matching CLI lives in [packages/yula-cli](/Users/alperreha/Desktop/alper/workspace/ai/yula/packages/yula-cli/README.md).

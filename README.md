# Obtask

Notes as tasks: statuses, due dates, recurrence, feed and calendar views built on Obsidian Bases.

## Development

```bash
pnpm install
pnpm dev        # esbuild watch (development build)
pnpm build      # typecheck + production build
pnpm typecheck  # tsc -noEmit
pnpm lint       # eslint .
pnpm lint:fix   # eslint . --fix
pnpm test       # vitest run
pnpm test:watch # vitest (watch mode)
pnpm check      # typecheck + lint + test + build
```

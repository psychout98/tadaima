# Claude Code Project Instructions

## Critical Rules

- **NEVER look in the `archive/` folder.** It contains obsolete planning documents and deprecated fix plans that are no longer relevant. Ignore it completely.
- The `archive/` folder is in `.gitignore` and should not be committed.

## Project Overview

Tadaima is a self-hosted media download orchestrator. See `README.md` and `ARCHITECTURE.md` for details.

## Monorepo Structure

- `packages/relay/` — Hono API server + WebSocket relay (Node.js)
- `packages/web/` — React 19 + Vite SPA
- `packages/agent/` — CLI download daemon
- `packages/shared/` — Zod schemas, TypeScript types, Drizzle DB schema
- `e2e/` — Playwright end-to-end tests

## Development Commands

- `pnpm install` — Install dependencies
- `pnpm dev` — Start all packages in dev mode
- `pnpm build` — Build all packages
- `pnpm test` — Run unit tests (Vitest)
- `pnpm test:e2e` — Run Playwright E2E tests
- `pnpm dev:e2e` — Build web + start relay for E2E testing
- `pnpm lint` — ESLint
- `pnpm typecheck` — TypeScript strict checking

## Key Conventions

- All WebSocket messages must conform to Zod schemas in `packages/shared/src/messages.ts`
- The relay validates messages with `messageSchema.safeParse()` and silently drops invalid ones
- Extra fields (like `_meta`) are stripped by Zod validation unless `.passthrough()` is used
- UI elements that tests interact with must have `data-testid` attributes matching `e2e/helpers/selectors.ts`
- E2E test fixtures are in `e2e/fixtures/` — mock agents, auth helpers, API mocks
- Tests run in parallel with worker-scoped resources (profiles, devices)

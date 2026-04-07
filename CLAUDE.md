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

## E2E Testing — IMPORTANT

### Required Reading Before Fixing Tests

Before making ANY changes to e2e tests, **always read these specs first**:
- `specs/E2E_TESTING_PLAN.md` — Full spec for all test suites (TS-01 through TS-20)
- `specs/E2E_FIX_PLAN.md` — Known issues and tiered fix plan
- `e2e/helpers/selectors.ts` — All `data-testid` selectors the tests use
- `e2e/helpers/constants.ts` — Test data, credentials, worker-scoping helpers
- `e2e/fixtures/auth.fixture.ts` — How `adminPage` and `profilePage` are set up

### Parallel Execution Rules (20 workers)

Tests run with `fullyParallel: true` and up to 20 workers. Every test must be **fully isolated**. Follow these rules strictly:

1. **Never operate on shared/indexed resources.** Don't use `profiles[0]`, `devices[0]`, or `profiles.find(p => !p.hasPin)`. Instead, create a dedicated resource for each test.
2. **Always use worker-scoped names.** Use `uniqueDeviceName(workerIndex, "label")` or `workerProfileName(workerIndex)` for any resource you create. This prevents name collisions between workers.
3. **Worker-scope job IDs.** Any jobId, requestId, or event identifier sent through WebSocket/MockAgent must include the worker index (e.g., `` `my-job-w${wIdx}` ``).
4. **Don't delete resources you didn't create.** The `adminPage` fixture cleanup only deletes profiles whose names end with the current worker's suffix. Follow the same pattern.
5. **Use `mode: "serial"` for shared global state.** If a test suite modifies truly global state (like admin settings), mark it with `test.describe.configure({ mode: "serial" })`.
6. **Tests must not depend on other tests' side effects.** Each test should create its own preconditions via API calls in the test body or `beforeEach`.

### Workflow for Debugging Failures

Since e2e tests require a running server + database and can't run in most AI coding environments:

1. **Run tests locally:** `pnpm test:e2e` (starts server automatically)
2. **Run a single file:** `pnpm exec playwright test e2e/some-test.spec.ts`
3. **View the HTML report:** `pnpm test:e2e:report`
4. **Share failures with AI tools** by providing: the test name, the error message, and the relevant spec from `specs/E2E_TESTING_PLAN.md`

### Test Architecture Quick Reference

- **Fixtures:** `auth.fixture.ts` provides `adminPage`, `profilePage`, `workerIndex`, `adminLogin`, `profileSelect`
- **Mock agents:** `ws-mock.fixture.ts` provides `MockAgent` for simulating paired devices over WebSocket
- **API mocks:** `api-mock.fixture.ts` provides `mockExternalApis()` for TMDB/stream endpoints
- **Selectors:** All in `e2e/helpers/selectors.ts` — never hardcode `data-testid` strings in tests
- **Worker helpers:** `ensureWorkerProfile()`, `pairWorkerDevice()`, `uniqueDeviceName()` in `e2e/helpers/constants.ts`

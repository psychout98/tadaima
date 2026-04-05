# Contributing to Tadaima

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Development Setup

### Prerequisites

- Node.js 22+
- pnpm 9+
- PostgreSQL 16 (via Docker or local install)

### Getting Started

```bash
git clone https://github.com/psychout98/tadaima.git
cd tadaima
pnpm install
```

### Start Local Postgres

```bash
docker compose up -d
```

This starts PostgreSQL on port 5432 and Adminer on port 8080.

### Push Database Schema

```bash
cd packages/shared
DATABASE_URL="postgres://tadaima:tadaima@localhost:5432/tadaima_dev" npx drizzle-kit push
```

### Start Development

```bash
pnpm dev
```

This starts all packages in watch mode:
- Relay: http://localhost:3000
- Web: http://localhost:5173
- Agent: watching for changes
- Shared: compiling types

### Environment Variables

Copy the example files:

```bash
cp .env.example .env
cp packages/relay/.env.example packages/relay/.env
```

Required for the relay:
- `DATABASE_URL` — PostgreSQL connection string
- `ENCRYPTION_MASTER_KEY` — generate with `openssl rand -hex 32`

## Project Structure

```
packages/
  shared/    # Zod schemas, types, Drizzle schema, utilities
  relay/     # Hono API + WebSocket server
  web/       # React SPA (Vite + Tailwind)
  agent/     # CLI download agent
```

The build order is: `shared` -> `relay`, `web`, `agent` (shared is a dependency of all others).

## Code Style

- TypeScript everywhere, strict mode
- ESLint + Prettier (run `pnpm lint` to check)
- Functional style preferred over classes where practical
- Zod schemas as the source of truth for types

## Running Tests

```bash
pnpm test          # All packages
pnpm --filter @tadaima/shared test    # Just shared
pnpm --filter @tadaima/agent test     # Just agent
```

## Pull Request Process

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Ensure `pnpm build && pnpm typecheck && pnpm lint && pnpm test` all pass
4. Write a clear PR description explaining what and why
5. Submit the PR

## Commit Messages

Use clear, descriptive commit messages. Convention:

```
Add search result caching with 1-hour TTL

The TMDB search proxy now caches results in memory for 1 hour,
reducing API calls for repeated queries.
```

## Reporting Issues

Use [GitHub Issues](https://github.com/psychout98/tadaima/issues) with the provided templates. Include:
- Steps to reproduce
- Expected vs actual behavior
- Environment (OS, Node version, browser)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

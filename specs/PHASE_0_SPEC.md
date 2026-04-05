# Phase 0: Local Dev Environment — Detailed Spec

> **Goal**: Stand up the monorepo with all four packages, local Postgres, and a dev workflow where every package hot-reloads. After this phase, `pnpm dev` starts everything and the relay health endpoint responds.

---

## 1. Prerequisites

Ensure the following are installed on the development machine before starting:

| Tool | Version | Check command |
|------|---------|---------------|
| Node.js | 22.x LTS | `node -v` |
| pnpm | 10.x | `pnpm -v` |
| Docker + Docker Compose | Latest stable | `docker compose version` |
| Git | 2.x+ | `git -v` |

**Docker must be running** before executing any `pnpm db:*` commands. Verify with `docker info`.

ESLint, Prettier, and Turborepo are installed as **root-level devDependencies only**. Individual packages inherit them through the pnpm workspace — they do NOT need these in their own `devDependencies`.

---

## 2. Monorepo Initialization

### 2.1 Root `package.json`

```jsonc
{
  "name": "tadaima",
  "private": true,
  "packageManager": "pnpm@10.33.0",
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "lint:fix": "turbo run lint:fix",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "db:up": "docker compose up -d postgres",
    "db:down": "docker compose down",
    "db:studio": "docker compose up -d adminer",
    "clean": "turbo run clean && rm -rf node_modules"
  }
}
```

### 2.2 `pnpm-workspace.yaml`

```yaml
packages:
  - "packages/*"
```

### 2.3 `.npmrc`

```ini
auto-install-peers=true
strict-peer-dependencies=false
```

---

## 3. Turborepo Configuration

### 3.1 `turbo.json`

```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true,
      "dependsOn": ["^build"]
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "lint:fix": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "clean": {
      "cache": false
    }
  }
}
```

**Key behavior**: `build` respects dependency order (`shared` builds first since other packages depend on it). `dev` is persistent (long-running watch processes). Nothing caches `dev`.

---

## 4. TypeScript Configuration

### 4.1 `tsconfig.base.json` (root)

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true
  },
  "exclude": ["node_modules", "dist"]
}
```

### 4.2 `packages/shared/tsconfig.json`

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": true
  },
  "include": ["src"]
}
```

### 4.3 `packages/relay/tsconfig.json`

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"],
  "references": [{ "path": "../shared" }]
}
```

### 4.4 `packages/web/tsconfig.json`

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client"]
  },
  "include": ["src"],
  "references": [{ "path": "../shared" }]
}
```

### 4.5 `packages/agent/tsconfig.json`

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"],
  "references": [{ "path": "../shared" }]
}
```

---

## 5. Package Configurations

Each package is an ES module (`"type": "module"` in package.json).

### 5.1 `packages/shared/package.json`

```jsonc
{
  "name": "@tadaima/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc --build",
    "dev": "tsc --build --watch",
    "clean": "rm -rf dist",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "~5.8.0",
    "vitest": "~4.1.0"
  }
}
```

**Entry point**: `src/index.ts` — barrel export, initially empty:

```typescript
// @tadaima/shared — types, schemas, and utilities
// Populated in Phase 1
export {};
```

### 5.2 `packages/relay/package.json`

```jsonc
{
  "name": "@tadaima/relay",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc --build",
    "dev": "tsx watch src/index.ts",
    "clean": "rm -rf dist",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@tadaima/shared": "workspace:*",
    "hono": "~4.12.0",
    "@hono/node-server": "~1.19.0"
  },
  "devDependencies": {
    "@types/node": "~22.0.0",
    "tsx": "~4.19.0",
    "typescript": "~5.8.0",
    "vitest": "~4.1.0"
  }
}
```

**Entry point**: `src/index.ts`:

```typescript
import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/api/health", (c) => {
  return c.json({ status: "ok" });
});

const port = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Relay listening on http://localhost:${info.port}`);
});

export default app;
```

**Environment**: `.env` file (and `.env.example`):

```env
# Relay environment variables
PORT=3000
DATABASE_URL=postgres://tadaima:tadaima@localhost:5432/tadaima_dev
```

### 5.3 `packages/web/package.json`

```jsonc
{
  "name": "@tadaima/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "dev": "vite",
    "preview": "vite preview",
    "clean": "rm -rf dist",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "~19.1.0",
    "react-dom": "~19.1.0"
  },
  "devDependencies": {
    "@types/react": "~19.1.0",
    "@types/react-dom": "~19.1.0",
    "@vitejs/plugin-react": "~4.5.0",
    "tailwindcss": "~4.2.0",
    "@tailwindcss/vite": "~4.2.0",
    "typescript": "~5.8.0",
    "vite": "~6.3.0",
    "vitest": "~4.1.0"
  }
}
```

> **Note on Vite version**: Pin Vite to `~6.3.0` (latest Vite 6.x LTS) rather than Vite 8.x. Vite 8 was just released and plugin ecosystem compatibility (especially `@vitejs/plugin-react`) may not be fully stable yet. Upgrade to Vite 8 in a later phase once the ecosystem settles.

**`vite.config.ts`**:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
```

**`src/index.css`**:

```css
@import "tailwindcss";

/* Custom theme tokens — applied in Phase 2+ */
```

> **Important**: Tailwind v4 uses `@import "tailwindcss"` instead of the old `@tailwind base/components/utilities` directives. No `tailwind.config.js` file is needed — Tailwind v4 auto-detects content files.

**`src/main.tsx`**:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

**`src/App.tsx`**:

```tsx
export function App() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f0f0f] text-white">
      <div className="text-center">
        <h1 className="text-4xl font-bold">
          <span className="text-indigo-500">tadaima</span>
        </h1>
        <p className="mt-2 text-sm text-gray-500">ただいま — I'm home.</p>
      </div>
    </div>
  );
}
```

**`src/vite-env.d.ts`**:

```typescript
/// <reference types="vite/client" />
```

**`index.html`** (in `packages/web/`):

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tadaima</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### 5.4 `packages/agent/package.json`

```jsonc
{
  "name": "@tadaima/agent",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": {
    "tadaima": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc --build",
    "dev": "tsx watch src/index.ts",
    "clean": "rm -rf dist",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@tadaima/shared": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "~22.0.0",
    "tsx": "~4.19.0",
    "typescript": "~5.8.0",
    "vitest": "~4.1.0"
  }
}
```

**Entry point**: `src/index.ts`:

```typescript
const version = "0.0.0";

console.log(`tadaima agent v${version}`);
console.log("Run 'tadaima setup' to configure. (Not yet implemented)");
process.exit(0);
```

**Environment**: `.env.example`:

```env
# Agent environment variables (populated during setup)
RELAY_URL=http://localhost:3000
DEVICE_TOKEN=
```

---

## 6. Docker Compose (Local Development)

### 6.1 `docker-compose.yml` (root)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: tadaima-postgres
    environment:
      POSTGRES_DB: tadaima_dev
      POSTGRES_USER: tadaima
      POSTGRES_PASSWORD: tadaima
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tadaima -d tadaima_dev"]
      interval: 5s
      timeout: 5s
      retries: 5

  adminer:
    image: adminer:latest
    container_name: tadaima-adminer
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy
    profiles:
      - debug

volumes:
  pgdata:
```

**Usage**:
- `pnpm db:up` → starts Postgres only (always needed for dev)
- `pnpm db:studio` → starts Adminer for visual DB inspection (optional, on-demand via `debug` profile: `docker compose --profile debug up -d adminer`)
- `pnpm db:down` → stops everything

> **Note**: Adminer uses the `debug` profile so it doesn't start by default with `docker compose up`. The `db:studio` script in root package.json should be: `docker compose --profile debug up -d adminer`.

---

## 7. ESLint Configuration

### 7.1 `eslint.config.js` (root)

ESLint v10 uses flat config only. No `.eslintrc` files.

```javascript
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.js", "**/*.mjs"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
    },
  }
);
```

### 7.2 Root devDependencies for linting

These are installed at the workspace root:

```jsonc
{
  "devDependencies": {
    "turbo": "~2.9.0",
    "eslint": "~10.1.0",
    "@eslint/js": "~10.1.0",
    "typescript-eslint": "~8.30.0",
    "prettier": "~3.8.0",
    "typescript": "~5.8.0"
  }
}
```

---

## 8. Prettier Configuration

### 8.1 `.prettierrc` (root)

```json
{
  "semi": true,
  "singleQuote": false,
  "tabWidth": 2,
  "trailingComma": "all",
  "printWidth": 100
}
```

### 8.2 `.prettierignore` (root)

```
dist
node_modules
pnpm-lock.yaml
*.md
```

---

## 9. Git Configuration

### 9.1 `.gitignore` (root)

```gitignore
# Dependencies
node_modules/

# Build outputs
dist/
.turbo/

# Environment
.env
.env.local
.env.*.local

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Docker volumes
pgdata/

# Debug logs
*.log
npm-debug.log*
pnpm-debug.log*
```

### 9.2 Repository initialization

```bash
git init
git add .
git commit -m "Phase 0: Initialize monorepo with relay, web, agent, shared packages"
```

**License**: Create `LICENSE` file with MIT license text, copyright holder: the repo owner.

---

## 10. Complete File Tree

After Phase 0, the repo should contain exactly these files:

```
tadaima/
├── packages/
│   ├── relay/
│   │   ├── src/
│   │   │   └── index.ts              # Hono server + /api/health
│   │   ├── .env                       # Local dev (gitignored)
│   │   ├── .env.example               # Template
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── web/
│   │   ├── src/
│   │   │   ├── App.tsx                # Placeholder component
│   │   │   ├── index.css              # Tailwind v4 import
│   │   │   ├── main.tsx               # React entry
│   │   │   └── vite-env.d.ts          # Vite client types
│   │   ├── index.html                 # HTML shell
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   ├── agent/
│   │   ├── src/
│   │   │   └── index.ts              # CLI stub (prints version)
│   │   ├── .env.example
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── shared/
│       ├── src/
│       │   └── index.ts              # Empty barrel export
│       ├── package.json
│       └── tsconfig.json
├── .env.example                       # Root env template (empty, for reference)
├── .gitignore
├── .npmrc
├── .prettierrc
├── .prettierignore
├── docker-compose.yml
├── eslint.config.js
├── LICENSE
├── package.json                       # Workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── turbo.json
```

**Root `.env.example`** (empty reference file):

```env
# Root environment variables
# Package-specific env files are in packages/relay/.env and packages/agent/.env
```

**Files NOT to create** (they come in later phases):
- No `drizzle.config.ts` (Phase 1)
- No `Dockerfile` (Phase 10)
- No `railway.json` (Phase 10)
- No test files yet (each package gets a `__tests__/` directory when it has something to test, starting Phase 1)

---

## 11. Dependency Version Reference

All versions pinned with `~` (patch-range) to avoid breaking changes.

| Package | Version | Scope |
|---------|---------|-------|
| `turbo` | ~2.9.0 | Root devDep |
| `eslint` | ~10.1.0 | Root devDep |
| `@eslint/js` | ~10.1.0 | Root devDep |
| `typescript-eslint` | ~8.30.0 | Root devDep |
| `prettier` | ~3.8.0 | Root devDep |
| `typescript` | ~5.8.0 | Root + all packages devDep |
| `hono` | ~4.12.0 | Relay dep |
| `@hono/node-server` | ~1.19.0 | Relay dep |
| `tsx` | ~4.19.0 | Relay + Agent devDep |
| `react` | ~19.1.0 | Web dep |
| `react-dom` | ~19.1.0 | Web dep |
| `@vitejs/plugin-react` | ~4.5.0 | Web devDep |
| `vite` | ~6.3.0 | Web devDep |
| `tailwindcss` | ~4.2.0 | Web devDep |
| `@tailwindcss/vite` | ~4.2.0 | Web devDep |
| `vitest` | ~4.1.0 | All packages devDep |
| `@types/node` | ~22.0.0 | Relay + Agent devDep |
| `@types/react` | ~19.1.0 | Web devDep |
| `@types/react-dom` | ~19.1.0 | Web devDep |

---

## 12. Execution Order

Claude Code should execute these steps in this exact order:

1. **Create root config files**: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `turbo.json`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.gitignore`, `LICENSE`, `docker-compose.yml`
2. **Create `packages/shared/`**: `package.json`, `tsconfig.json`, `src/index.ts`
3. **Create `packages/relay/`**: `package.json`, `tsconfig.json`, `.env.example`, `src/index.ts`
4. **Create `packages/web/`**: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/vite-env.d.ts`
5. **Create `packages/agent/`**: `package.json`, `tsconfig.json`, `.env.example`, `src/index.ts`
6. **Run `pnpm install`** from root — this installs all dependencies and links workspace packages
7. **Copy `.env.example` → `.env`** in `packages/relay/` (local dev only)
8. **Start Postgres**: `pnpm db:up` — verify with `docker compose ps` (status should be "healthy", takes ~25 seconds)
9. **Run `pnpm build`** — verify shared builds first, then all packages compile
10. **Run `pnpm typecheck`** — verify zero type errors
11. **Run `pnpm lint`** — verify zero lint errors
12. **Run `pnpm dev`** — verify all four packages start concurrently
13. **Verify endpoints**:
    - `curl http://localhost:3000/api/health` → `{"status":"ok"}`
    - Open `http://localhost:5173` → see "tadaima" in indigo text with subtitle
14. **Stop dev servers and Postgres** (`Ctrl+C`, then `pnpm db:down`)

---

## 13. Verification Checklist

Every item must pass before Phase 0 is considered complete:

| # | Check | How to verify |
|---|-------|---------------|
| 1 | `pnpm install` succeeds from clean state | Delete `node_modules`, run `pnpm install` |
| 2 | `pnpm build` exits 0 | Run and check exit code |
| 3 | `pnpm typecheck` exits 0 | Run and check exit code |
| 4 | `pnpm lint` exits 0 | Run and check exit code |
| 5 | `pnpm format:check` exits 0 | Run and check exit code |
| 6 | Relay health endpoint responds | `curl -s http://localhost:3000/api/health \| jq .status` → `"ok"` |
| 7 | Web dev server renders | `curl -s http://localhost:5173 \| grep tadaima` → matches |
| 8 | Agent CLI prints version | `pnpm --filter @tadaima/agent exec tsx src/index.ts` → contains "v0.0.0" |
| 9 | Shared package exports | `cd packages/shared && pnpm build` → `dist/index.js` + `dist/index.d.ts` exist |
| 10 | Postgres container healthy | `docker compose ps` → postgres status is "healthy" |
| 11 | Vite proxies /api to relay | With both running: `curl http://localhost:5173/api/health` → `{"status":"ok"}` |
| 12 | Workspace references work | Relay and agent can import from `@tadaima/shared` without error |

---

## 14. Common Pitfalls to Avoid

1. **Do NOT use `@tailwind base; @tailwind components; @tailwind utilities;`** — that's Tailwind v3 syntax. Tailwind v4 uses `@import "tailwindcss"`.
2. **Do NOT create a `tailwind.config.js`** — Tailwind v4 auto-detects content. Config-based customization is done in CSS with `@theme`.
3. **Do NOT use `.eslintrc.cjs` or `.eslintrc.json`** — ESLint v10 only supports flat config (`eslint.config.js`).
4. **Do NOT use `"module": "commonjs"`** — all packages are ESM (`"type": "module"`).
5. **Do NOT install dependencies globally** — everything runs through pnpm workspace.
6. **Do NOT create test files yet** — there's nothing to test. Test infrastructure (vitest) is installed but test files come in Phase 1+.
7. **Do NOT add Drizzle, ws, jose, zustand, TanStack Query, or any Phase 1+ dependencies** — those are not needed yet and would just add unused code.
8. **Do NOT create a `src/components/` directory in web** — there's only a single `App.tsx` placeholder right now. Component structure comes in Phase 2.
9. **The `db:studio` script** must use `docker compose --profile debug up -d adminer` (not just `docker compose up -d adminer`) because Adminer is behind the `debug` profile to avoid starting it by default.
10. **The relay uses `tsx watch`** for dev mode (not `nodemon` or `ts-node`). `tsx` is the modern TypeScript execution tool that supports ESM natively.

# ── Stage 1: Install dependencies ─────────────────────────────
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/relay/package.json packages/relay/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

# ── Stage 2: Build ────────────────────────────────────────────
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/relay/node_modules ./packages/relay/node_modules
COPY --from=deps /app/packages/web/node_modules ./packages/web/node_modules
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/relay/ packages/relay/
COPY packages/web/ packages/web/
RUN pnpm build

# ── Stage 3: Production ──────────────────────────────────────
FROM node:22-alpine AS production
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy built artifacts
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/shared/drizzle ./packages/shared/drizzle
COPY --from=build /app/packages/relay/dist ./packages/relay/dist
COPY --from=build /app/packages/relay/package.json ./packages/relay/
COPY --from=build /app/packages/web/dist ./packages/web/dist

# Copy workspace config for pnpm
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Install production deps only
RUN pnpm install --frozen-lockfile --prod

# Copy startup script
COPY scripts/start-relay.sh ./scripts/start-relay.sh
RUN chmod +x ./scripts/start-relay.sh

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -q --spider http://localhost:3000/api/health || exit 1

CMD ["./scripts/start-relay.sh"]

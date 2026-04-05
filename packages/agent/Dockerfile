FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/agent/package.json packages/agent/

# Install deps
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/agent/ packages/agent/

# Build
RUN pnpm --filter @tadaima/shared build && pnpm --filter @tadaima/agent build

ENV NODE_ENV=production

ENTRYPOINT ["node", "packages/agent/dist/index.js"]
CMD ["start"]

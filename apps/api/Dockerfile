# Master Office API (docs/INSTALL.md). Build from the repository root:
#   docker build -f apps/api/Dockerfile -t master-office-api .
# Chromium (PDF export, slide pictures) comes from Playwright; sharp and tesseract.js ship their own binaries.
FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages ./packages
# The API and the shared packages/* it compiles in (their tiptap / katex / yjs deps must be present); the web app is built in its own image.
RUN pnpm install --frozen-lockfile --filter '!@workos/web'
COPY apps/api ./apps/api
RUN pnpm --filter @workos/api build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages ./packages
# Chromium goes to a shared path (not root's home) so the unprivileged `node` user can launch it; the version is the lockfile's.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN pnpm install --frozen-lockfile --prod --filter '!@workos/web' \
 && pnpm --filter @workos/api exec playwright install --with-deps chromium \
 && chmod -R a+rX /ms-playwright \
 && rm -rf /root/.cache/pnpm /var/lib/apt/lists/*
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY apps/api/drizzle ./apps/api/drizzle
WORKDIR /repo/apps/api
# Encrypted settings key and OCR language data live on volumes (see infra/docker-compose.prod.yml).
RUN mkdir -p .secrets .cache && chown -R node:node /repo/apps/api
USER node
EXPOSE 4000 4001 2525
# Migrations run on every start (idempotent), then the server.
CMD ["sh", "-c", "node dist/apps/api/src/db/migrate.js && node dist/apps/api/src/main.js"]

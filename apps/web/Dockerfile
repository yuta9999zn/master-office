# Master Office web app (docs/INSTALL.md). Build from the repository root:
#   docker build -f apps/web/Dockerfile -t master-office-web .
# The browser reaches the API through Next's /api proxy (same origin), so only API_URL is needed at run time.
FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages ./packages
RUN pnpm install --frozen-lockfile --filter '!@workos/api'
COPY apps/web ./apps/web
# Baked into the bundle: browsers call the API at /api on the site's own origin (the proxy forwards it), and the
# server-side rewrite falls back to the API container for anything the proxy did not catch.
ARG NEXT_PUBLIC_API_URL=/api
ARG API_URL=http://api:4000
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL API_URL=$API_URL
RUN pnpm --filter @workos/web build

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
# Next's standalone output: the server, its traced node_modules, and the static files beside it.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

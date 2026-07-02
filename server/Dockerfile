# Build context is the repo root (`docker build -f server/Dockerfile -t harness-os:latest .`),
# not server/ alone — the plan's original §3.6 example built from server/ as
# context, but this image has to bundle packages/core and cli/ too (the
# harness_gate_daemon service and the CLI subcommands run from this same
# image, dispatched by CMD). A server/-only context can't see its sibling
# workspace packages, so the build command changed; the Dockerfile itself
# stays at this path to match the tree layout in the plan.

FROM node:22-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.base.json tsconfig.json ./
COPY packages/core/package.json packages/core/
COPY server/package.json server/
COPY cli/package.json cli/
RUN npm ci

COPY packages/core packages/core
COPY server server
COPY cli cli
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY server/package.json server/
COPY cli/package.json cli/
RUN npm ci --omit=dev

COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/server/dist server/dist
COPY --from=builder /app/cli/dist cli/dist
COPY server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["mcp-serve"]

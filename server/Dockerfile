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

# git is required by config-integrity.ts's commitTrackedConfig, called from
# every recordVerifiedConfig invocation (reconcile-config, and now
# harness-init) — see plan Open Item #13. Installing it alone isn't
# sufficient for the daemon (its /workspaces mount is read-only), but it is
# necessary for harness-init's own writable-mount `docker run` invocation.
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY server/package.json server/
COPY cli/package.json cli/
RUN npm ci --omit=dev

COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/server/dist server/dist
COPY --from=builder /app/cli/dist cli/dist
# Static schema data, not compiled — specs.ts resolves this path at runtime
# relative to its own dist/src location (same directory depth in the image
# as in the repo, see specs.ts's SCHEMA_DIR comment). Learned from Phase 1's
# gate-daemon read-only-mount gap: anything the daemon touches must be baked
# into the image or mounted, never assumed present on disk (plan §12.2).
COPY specs/schema specs/schema
# harness-init.ts reads scaffold/.claude/{hooks,settings.json} at runtime and
# stamps them into a governed project — same "bake into the image" reasoning
# as specs/schema above, resolved relative to its own dist location.
COPY scaffold scaffold
COPY server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["mcp-serve"]

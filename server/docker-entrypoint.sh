#!/bin/sh
# One shared image, dispatched by CMD/first arg — see §2.2's topology:
# harness-os:latest runs `mcp-serve` (ephemeral, one per Claude Code session)
# while harness_gate_daemon runs `gate-daemon` (persistent, reached via
# `docker exec`). CLI subcommands (gate-check/approve/reconcile-config/
# harness-init) share the same image so gate logic in packages/core is never
# duplicated between the MCP surface and the CLI surface.
set -e

case "$1" in
  mcp-serve)
    exec node server/dist/index.js
    ;;
  gate-daemon)
    exec node cli/dist/gate-daemon.js
    ;;
  gate-check)
    shift
    exec node cli/dist/gate-check.js "$@"
    ;;
  approve)
    shift
    exec node cli/dist/approve.js "$@"
    ;;
  reconcile-config)
    shift
    exec node cli/dist/reconcile-config.js "$@"
    ;;
  log-revert)
    shift
    exec node cli/dist/log-revert.js "$@"
    ;;
  harness-init)
    shift
    exec node cli/dist/harness-init.js "$@"
    ;;
  *)
    echo "Unknown command: $1" >&2
    echo "Expected one of: mcp-serve | gate-daemon | gate-check | approve | reconcile-config | log-revert | harness-init" >&2
    exit 1
    ;;
esac

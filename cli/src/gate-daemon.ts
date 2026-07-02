#!/usr/bin/env node
import { createPool } from '@harness-os/core';

/**
 * Keeps harness_gate_daemon's container warm so `docker exec harness_gate_daemon
 * ... gate-check` avoids `docker run`'s cold-start (image/container setup +
 * node boot, §2.2). Design clarification vs. the plan's original phrasing:
 * `docker exec` spawns a brand-new OS process for cli/dist/gate-check.js —
 * it cannot share this process's in-memory pg.Pool. What's actually saved is
 * container creation time, not connection setup; each gate-check invocation
 * still opens its own short-lived connection over the container-local
 * network, which is inexpensive on its own.
 */
const HEARTBEAT_INTERVAL_MS = 60_000;

export async function main(): Promise<void> {
  const pool = createPool();
  await pool.query('SELECT 1'); // fail fast at startup if DATABASE_URL is wrong

  // Deliberately NOT unref'd: this interval is the only thing keeping the
  // event loop (and therefore this process) alive. unref() previously caused
  // the daemon to exit almost immediately after startup — invisible under
  // docker-compose's `restart: unless-stopped`, which just kept
  // resurrecting it every few seconds, defeating the "warm container" design
  // this file exists for (§2.2). Confirmed via a real fire: RestartCount
  // climbed from 0 to 1 within 8 seconds of a fresh start.
  const heartbeat = setInterval(() => {
    pool.query('SELECT 1').catch((error: unknown) => {
      console.error('harness_gate_daemon heartbeat query failed:', error);
    });
  }, HEARTBEAT_INTERVAL_MS);

  const shutdown = (): void => {
    clearInterval(heartbeat);
    void pool.end().then(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error('harness_gate_daemon failed to start:', error);
    process.exit(1);
  });
}

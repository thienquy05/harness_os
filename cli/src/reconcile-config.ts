#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { createPool, recordVerifiedConfig, verifyConfigIntegrity } from '@harness-os/core';

/**
 * `harness reconcile-config --project-path <path>` — the only way out of a
 * config-integrity fail-closed state (§2.1, §3.5a). TTY-required, same
 * rationale as `harness approve`.
 */
export async function main(
  argv: string[] = process.argv.slice(2),
  isTTY: boolean = Boolean(process.stdin.isTTY),
): Promise<number> {
  const projectPathIndex = argv.indexOf('--project-path');
  const projectPath = projectPathIndex >= 0 ? argv[projectPathIndex + 1] : undefined;
  if (!projectPath) {
    console.error('Usage: harness reconcile-config --project-path <path>');
    return 2;
  }
  if (!isTTY) {
    console.error('harness reconcile-config requires an interactive TTY.');
    return 1;
  }

  const pool = createPool();
  try {
    const before = await verifyConfigIntegrity(pool, projectPath);
    if (before.initialized && before.ok) {
      console.log('No drift detected — nothing to reconcile.');
      return 0;
    }

    console.log(
      before.initialized
        ? `Drift detected in: ${before.mismatches.join(', ')}`
        : 'Project has never been initialized (no verified config_checksums rows).',
    );
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      'Re-verify and trust the current on-disk files as the new baseline? [y/N] ',
    );
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('Not reconciled.');
      return 1;
    }

    const verifiedBy = process.env.USER ?? process.env.USERNAME ?? 'unknown-human';
    const { committed } = await recordVerifiedConfig(pool, projectPath, verifiedBy);
    if (!committed) {
      // Open Item #22: this command still runs via `docker exec
      // harness_gate_daemon` against its read-only `:ro` mount (Open Item
      // #13's still-unmigrated half), so the commit above did not happen —
      // the checksum row was still inserted, but git HEAD wasn't updated to
      // match. Reporting success here would let post-bash-revert.sh's next
      // Bash call revert the file back to stale HEAD content, which then
      // mismatches the *new* DB hash and blocks every gated write
      // (recordVerifiedConfig's own doc comment, failure mode 2). Refuse to
      // claim success instead.
      console.error(
        'Checksums were re-verified and trusted in the database, but the git commit failed ' +
          '(see the warning above) — .claude is now DB-trusted but not committed to HEAD. ' +
          'The next gated write may be reverted and then blocked. Re-run this from a writable ' +
          'mount of the project (not via harness_gate_daemon) to commit the change, or commit ' +
          'the .claude changes manually.',
      );
      return 1;
    }
    console.log('Config re-verified and trusted.');
    return 0;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}

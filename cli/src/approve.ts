#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { createPool, getDecisionById, recordDecision } from '@harness-os/core';

/**
 * `harness approve <decision_id>` — architecturally unreachable by Claude
 * Code's Bash tool: refuses to run unless stdin is an interactive TTY
 * (§2.1, §3.5a). A tool-invoked shell command is never attached to a
 * human's TTY, so this check is a hard boundary, not just a prompt.
 */
export async function main(
  argv: string[] = process.argv.slice(2),
  isTTY: boolean = Boolean(process.stdin.isTTY),
): Promise<number> {
  const decisionId = Number(argv[0]);
  if (!Number.isInteger(decisionId)) {
    console.error('Usage: harness approve <decision_id>');
    return 2;
  }
  if (!isTTY) {
    console.error(
      'harness approve requires an interactive TTY — refusing to run non-interactively (§2.1, §3.5a).',
    );
    return 1;
  }

  const pool = createPool();
  try {
    const original = await getDecisionById(pool, decisionId);
    if (!original) {
      console.error(`No decision with id ${decisionId} found.`);
      return 1;
    }
    if (original.status !== 'pending_approval') {
      console.error(`Decision ${decisionId} is not pending_approval (status=${original.status}).`);
      return 1;
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `Approve decision ${decisionId} — "${original.rationale}" (risk=${original.risk_level})? [y/N] `,
    );
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('Not approved.');
      return 1;
    }

    const approverIdentity = process.env.USER ?? process.env.USERNAME ?? 'unknown-human';
    await recordDecision(pool, {
      actor: `human:${approverIdentity}`,
      action: 'approve_decision',
      rationale: 'Approved via harness approve (TTY-confirmed).',
      riskLevel: original.risk_level,
      projectPath: original.project_path,
      relatedDecisionId: original.id,
      status: 'approved',
    });
    console.log(`Decision ${decisionId} approved.`);
    return 0;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}

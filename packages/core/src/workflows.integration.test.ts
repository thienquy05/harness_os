import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client, type Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordDecision } from './audit.js';
import { createPool } from './db.js';
import { assessAndRecordRisk } from './risk.js';
import { runWorkflow, workflowStatus } from './workflows.js';

// Real Postgres, real db/init SQL, real workflow_runs + decisions +
// risk_assessments rows — proves the engine actually advances only on real
// state (plan §6's server-authoritative decision), not on a mocked pool that
// might silently accept a query that matches zero real rows. Walks 'hotfix'
// (the shortest of the three defined workflows: risk -> approval ->
// implement -> finalize) end to end, including the human-approval reuse of
// Phase 1's isDecisionApproved mechanism.
describe('workflow engine against a real Postgres instance', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('harness_os')
      .withUsername('harness_admin')
      .withPassword('harness_admin')
      .start();

    const adminClient = new Client({ connectionString: container.getConnectionUri() });
    await adminClient.connect();

    const repoRoot = join(import.meta.dirname, '..', '..', '..');
    const initDir = join(repoRoot, 'db', 'init');
    const initFiles = (await readdir(initDir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of initFiles) {
      const sql = await readFile(join(initDir, file), 'utf-8');
      await adminClient.query(sql);
    }
    await adminClient.end();

    pool = createPool({ connectionString: container.getConnectionUri() });
  }, 60_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it('advances a hotfix run one real stage at a time, never skipping ahead of real evidence', async () => {
    const projectPath = '/fake/hotfix-project';

    const started = await runWorkflow(pool, { workflowName: 'hotfix', projectPath });
    expect(started.stage).toBe('risk');
    expect(started.status).toBe('in_progress');

    // No risk assessment recorded yet — re-polling must not advance.
    const stillRisk = await workflowStatus(pool, { runId: started.runId });
    expect(stillRisk.stage).toBe('risk');

    await assessAndRecordRisk(pool, { projectPath, requestDescription: 'bump a dependency version' });
    const afterRisk = await workflowStatus(pool, { runId: started.runId });
    expect(afterRisk.stage).toBe('approval');
    expect(afterRisk.directive?.action).toBe('record_pending_approval');

    // Claude records its own pending-approval decision and reports the id.
    const { id: pendingDecisionId } = await recordDecision(pool, {
      actor: 'claude',
      action: 'hotfix_approval_request',
      rationale: 'requesting human sign-off for a hotfix',
      riskLevel: 'low',
      status: 'pending_approval',
      projectPath,
    });
    const withPending = await workflowStatus(pool, { runId: started.runId, decisionId: pendingDecisionId });
    expect(withPending.stage).toBe('approval');
    expect(withPending.directive?.action).toBe('require_human_approval');
    expect(withPending.directive?.decisionId).toBe(pendingDecisionId);

    // Still not approved — must not advance.
    const stillPending = await workflowStatus(pool, { runId: started.runId });
    expect(stillPending.stage).toBe('approval');

    // A human runs `harness approve` — a new row referencing the original (§3.5), never an UPDATE.
    await recordDecision(pool, {
      actor: 'human',
      action: 'approve_decision',
      rationale: 'approved',
      riskLevel: 'low',
      status: 'approved',
      relatedDecisionId: pendingDecisionId,
      projectPath,
    });

    const afterApproval = await workflowStatus(pool, { runId: started.runId });
    expect(afterApproval.stage).toBe('implement');

    await recordDecision(pool, {
      actor: 'claude',
      action: 'workflow:hotfix:implement',
      rationale: 'implemented the fix',
      riskLevel: 'low',
      projectPath,
    });
    const afterImplement = await workflowStatus(pool, { runId: started.runId });
    expect(afterImplement.stage).toBe('finalize');

    await recordDecision(pool, {
      actor: 'claude',
      action: 'workflow:hotfix:finalize',
      rationale: 'done',
      riskLevel: 'low',
      projectPath,
    });
    const finished = await workflowStatus(pool, { runId: started.runId });
    expect(finished.status).toBe('completed');
    expect(finished.directive).toBeUndefined();

    const rows = await pool.query('SELECT status, completed_at FROM workflow_runs WHERE id = $1', [started.runId]);
    expect(rows.rows[0].status).toBe('completed');
    expect(rows.rows[0].completed_at).not.toBeNull();
  });
});

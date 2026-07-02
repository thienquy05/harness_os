import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  advanceWorkflowRun,
  completeWorkflowRun,
  createWorkflowRun,
  getWorkflowRun,
  setPendingDecisionId,
} from './workflow-runs.js';

function fakePool(): { pool: Pool; rows: Map<number, Record<string, unknown>> } {
  const rows = new Map<number, Record<string, unknown>>();
  let nextId = 1;
  const pool = {
    query: async (text: string, params: unknown[] = []) => {
      if (text.includes('INSERT INTO workflow_runs')) {
        const [workflowName, specId, projectPath, currentStage] = params as [string, string | null, string, string];
        const id = nextId++;
        const now = new Date().toISOString();
        rows.set(id, {
          id,
          workflow_name: workflowName,
          spec_id: specId,
          project_path: projectPath,
          status: 'in_progress',
          current_stage: currentStage,
          stage_started_at: now,
          pending_decision_id: null,
          started_at: now,
          completed_at: null,
        });
        return { rows: [{ id }] };
      }
      if (text.includes('SELECT') && text.includes('FROM workflow_runs WHERE id')) {
        const [id] = params as [number];
        const row = rows.get(id);
        return { rows: row ? [row] : [] };
      }
      if (text.includes('UPDATE workflow_runs SET current_stage')) {
        const [currentStage, id] = params as [string, number];
        const row = rows.get(id);
        if (row) {
          row.current_stage = currentStage;
          row.stage_started_at = new Date().toISOString();
        }
        return { rows: [] };
      }
      if (text.includes("UPDATE workflow_runs SET status = 'completed'")) {
        const [id] = params as [number];
        const row = rows.get(id);
        if (row) {
          row.status = 'completed';
          row.completed_at = new Date().toISOString();
        }
        return { rows: [] };
      }
      if (text.includes('UPDATE workflow_runs SET pending_decision_id')) {
        const [decisionId, id] = params as [number, number];
        const row = rows.get(id);
        if (row) row.pending_decision_id = decisionId;
        return { rows: [] };
      }
      throw new Error(`Unexpected query in fake pool: ${text}`);
    },
  } as unknown as Pool;
  return { pool, rows };
}

describe('workflow-runs persistence', () => {
  it('creates a run in the first stage and reads it back', async () => {
    const { pool } = fakePool();
    const created = await createWorkflowRun(pool, {
      workflowName: 'new-feature',
      specId: 'APX-DOM-001',
      projectPath: '/p',
      firstStage: 'spec',
    });
    expect(created.currentStage).toBe('spec');
    expect(created.status).toBe('in_progress');

    const fetched = await getWorkflowRun(pool, created.id);
    expect(fetched?.workflowName).toBe('new-feature');
    expect(fetched?.specId).toBe('APX-DOM-001');
  });

  it('returns null for a run that does not exist', async () => {
    const { pool } = fakePool();
    expect(await getWorkflowRun(pool, 999)).toBeNull();
  });

  it('advances to a new stage and resets stage_started_at', async () => {
    const { pool } = fakePool();
    const created = await createWorkflowRun(pool, {
      workflowName: 'new-feature',
      specId: null,
      projectPath: '/p',
      firstStage: 'spec',
    });
    const before = created.stageStartedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await advanceWorkflowRun(pool, created.id, 'risk');
    const advanced = await getWorkflowRun(pool, created.id);
    expect(advanced?.currentStage).toBe('risk');
    expect(advanced?.stageStartedAt).not.toBe(before);
  });

  it('marks a run completed', async () => {
    const { pool } = fakePool();
    const created = await createWorkflowRun(pool, {
      workflowName: 'hotfix',
      specId: null,
      projectPath: '/p',
      firstStage: 'risk',
    });
    await completeWorkflowRun(pool, created.id);
    const completed = await getWorkflowRun(pool, created.id);
    expect(completed?.status).toBe('completed');
    expect(completed?.completedAt).not.toBeNull();
  });

  it('records the pending decision id for the approval stage', async () => {
    const { pool } = fakePool();
    const created = await createWorkflowRun(pool, {
      workflowName: 'hotfix',
      specId: null,
      projectPath: '/p',
      firstStage: 'approval',
    });
    await setPendingDecisionId(pool, created.id, 42);
    const updated = await getWorkflowRun(pool, created.id);
    expect(updated?.pendingDecisionId).toBe(42);
  });
});

import type { Pool } from 'pg';
import { query } from './db.js';

export type WorkflowRunStatus = 'in_progress' | 'completed';

export interface WorkflowRunRow {
  id: number;
  workflowName: string;
  specId: string | null;
  projectPath: string;
  status: WorkflowRunStatus;
  currentStage: string;
  stageStartedAt: string;
  pendingDecisionId: number | null;
  startedAt: string;
  completedAt: string | null;
}

export interface CreateWorkflowRunInput {
  workflowName: string;
  specId: string | null;
  projectPath: string;
  firstStage: string;
}

function toWorkflowRunRow(row: {
  id: number;
  workflow_name: string;
  spec_id: string | null;
  project_path: string;
  status: WorkflowRunStatus;
  current_stage: string;
  stage_started_at: string;
  pending_decision_id: number | null;
  started_at: string;
  completed_at: string | null;
}): WorkflowRunRow {
  return {
    id: row.id,
    workflowName: row.workflow_name,
    specId: row.spec_id,
    projectPath: row.project_path,
    status: row.status,
    currentStage: row.current_stage,
    stageStartedAt: row.stage_started_at,
    pendingDecisionId: row.pending_decision_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export async function createWorkflowRun(pool: Pool, input: CreateWorkflowRunInput): Promise<WorkflowRunRow> {
  const rows = await query<{ id: number }>(
    pool,
    `INSERT INTO workflow_runs (workflow_name, spec_id, project_path, current_stage)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [input.workflowName, input.specId, input.projectPath, input.firstStage],
  );
  const created = await getWorkflowRun(pool, rows[0].id);
  if (!created) {
    throw new Error(`workflow_runs row ${rows[0].id} vanished immediately after insert`);
  }
  return created;
}

export async function getWorkflowRun(pool: Pool, id: number): Promise<WorkflowRunRow | null> {
  const rows = await query(
    pool,
    `SELECT id, workflow_name, spec_id, project_path, status, current_stage, stage_started_at,
            pending_decision_id, started_at, completed_at
     FROM workflow_runs WHERE id = $1`,
    [id],
  );
  return rows.length > 0 ? toWorkflowRunRow(rows[0] as Parameters<typeof toWorkflowRunRow>[0]) : null;
}

/** Resets stage_started_at so evidence from the stage just left can't satisfy the new one. */
export async function advanceWorkflowRun(pool: Pool, id: number, nextStage: string): Promise<void> {
  await query(
    pool,
    `UPDATE workflow_runs SET current_stage = $1, stage_started_at = now() WHERE id = $2`,
    [nextStage, id],
  );
}

export async function completeWorkflowRun(pool: Pool, id: number): Promise<void> {
  await query(pool, `UPDATE workflow_runs SET status = 'completed', completed_at = now() WHERE id = $1`, [id]);
}

/**
 * Threads a Claude-reported decision id (from its own record_decision call,
 * status='pending_approval') onto the run so the approval stage's isComplete
 * check can call the existing isDecisionApproved(pool, id) — reusing Phase
 * 1's human-ack mechanism rather than reinventing approval tracking here.
 */
export async function setPendingDecisionId(pool: Pool, id: number, decisionId: number): Promise<void> {
  await query(pool, `UPDATE workflow_runs SET pending_decision_id = $1 WHERE id = $2`, [decisionId, id]);
}

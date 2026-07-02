import type { Pool } from 'pg';
import { query } from './db.js';
import type { RiskLevel } from './risk.js';

export type DecisionStatus = 'approved' | 'pending_approval' | 'rejected';

export interface DecisionInput {
  actor: string;
  action: string;
  rationale: string;
  riskLevel: RiskLevel;
  projectPath: string;
  constitutionRulesApplied?: string[];
  status?: DecisionStatus;
  relatedDecisionId?: number;
}

export interface DecisionRow {
  id: number;
  actor: string;
  action: string;
  rationale: string;
  constitution_rules_applied: string[];
  risk_level: RiskLevel;
  status: DecisionStatus;
  approvals: unknown;
  related_decision_id: number | null;
  project_path: string;
  created_at: string;
}

/** Append-only: harness_app has SELECT + INSERT only on `decisions` (enforced at the role level, not here). */
export async function recordDecision(pool: Pool, input: DecisionInput): Promise<{ id: number }> {
  const rows = await query<{ id: number }>(
    pool,
    `INSERT INTO decisions
       (actor, action, rationale, constitution_rules_applied, risk_level, status, project_path, related_decision_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      input.actor,
      input.action,
      input.rationale,
      input.constitutionRulesApplied ?? [],
      input.riskLevel,
      input.status ?? 'approved',
      input.projectPath,
      input.relatedDecisionId ?? null,
    ],
  );
  return rows[0];
}

export async function getDecisionById(pool: Pool, id: number): Promise<DecisionRow | null> {
  const rows = await query<DecisionRow>(pool, 'SELECT * FROM decisions WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function auditReport(pool: Pool, projectPath: string): Promise<DecisionRow[]> {
  return query<DecisionRow>(
    pool,
    'SELECT * FROM decisions WHERE project_path = $1 ORDER BY created_at DESC',
    [projectPath],
  );
}

/** True if `decisionId` is approved directly, or superseded by an approval row referencing it (§3.5). */
export async function isDecisionApproved(pool: Pool, decisionId: number): Promise<boolean> {
  const rows = await query<{ status: DecisionStatus }>(
    pool,
    `SELECT status FROM decisions WHERE id = $1
     UNION ALL
     SELECT status FROM decisions WHERE related_decision_id = $1 AND status = 'approved'`,
    [decisionId],
  );
  return rows.some((row) => row.status === 'approved');
}

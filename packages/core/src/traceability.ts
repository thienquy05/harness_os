import type { Pool } from 'pg';
import { query, type Queryable } from './db.js';

export interface TraceabilityEdgeInput {
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  projectPath: string;
}

export interface TraceabilityEdgeRow {
  id: number;
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  stale: boolean;
  projectPath: string;
  createdAt: string;
}

function toEdgeRow(row: {
  id: number;
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  stale: boolean;
  project_path: string;
  created_at: string;
}): TraceabilityEdgeRow {
  return {
    id: row.id,
    fromType: row.from_type,
    fromId: row.from_id,
    toType: row.to_type,
    toId: row.to_id,
    stale: row.stale,
    projectPath: row.project_path,
    createdAt: row.created_at,
  };
}

export async function recordTraceabilityEdge(db: Queryable, input: TraceabilityEdgeInput): Promise<TraceabilityEdgeRow> {
  const rows = await query(
    db,
    `INSERT INTO traceability_edges (from_type, from_id, to_type, to_id, project_path)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, from_type, from_id, to_type, to_id, stale, project_path, created_at`,
    [input.fromType, input.fromId, input.toType, input.toId, input.projectPath],
  );
  return toEdgeRow(rows[0] as Parameters<typeof toEdgeRow>[0]);
}

/**
 * Called from specs.ts's createSpec, in the same transaction as the version
 * bump (plan §5.2): a spec-version supersede marks every edge that names the
 * *old* row's id — on either end — stale, so verify-green/request_review can
 * refuse to treat code as "passing" against a spec version that no longer
 * exists. `id` is the string form of the superseded row's numeric PK,
 * matching how recordTraceabilityEdge stores it (see traceability_edges.sql:
 * from_id/to_id are TEXT because edges span heterogeneous entities, not just
 * spec rows).
 */
export async function markEdgesStaleForEntity(db: Queryable, entityType: string, entityId: string): Promise<void> {
  await query(
    db,
    `UPDATE traceability_edges SET stale = true
     WHERE (from_type = $1 AND from_id = $2) OR (to_type = $1 AND to_id = $2)`,
    [entityType, entityId],
  );
}

export async function listTraceabilityEdges(pool: Pool, projectPath: string): Promise<TraceabilityEdgeRow[]> {
  const rows = await query(
    pool,
    `SELECT id, from_type, from_id, to_type, to_id, stale, project_path, created_at
     FROM traceability_edges WHERE project_path = $1 ORDER BY created_at`,
    [projectPath],
  );
  return rows.map((r) => toEdgeRow(r as Parameters<typeof toEdgeRow>[0]));
}

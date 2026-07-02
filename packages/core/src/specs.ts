// Plain `Ajv` (the package's default export) only knows the draft-07
// meta-schema. Our spec schemas declare `"$schema": ".../2020-12/schema"`,
// so compiling them needs the dedicated Ajv2020 class — found by a test
// failure ("no schema with key or ref .../2020-12/schema"), not by reading
// ajv's docs ahead of time.
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { query, withTransaction, type Queryable } from './db.js';
import { markEdgesStaleForEntity } from './traceability.js';

export type SpecType = 'product' | 'domain' | 'api' | 'data' | 'infra';
export type SpecStatus = 'draft' | 'active' | 'superseded' | 'deprecated';

export const SPEC_TYPES: SpecType[] = ['product', 'domain', 'api', 'data', 'infra'];

export interface SpecRow {
  id: number;
  specId: string;
  type: SpecType;
  title: string;
  status: SpecStatus;
  content: Record<string, unknown>;
  version: number;
  projectPath: string;
  createdAt: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// Same directory depth from packages/core/{src,dist} to specs/schema, both in
// dev (repo root) and in the Docker image (/app) — see plan §12.2 for why
// this must be baked into the image, not just present on the host disk.
const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../specs/schema');

const ajv = new Ajv2020({ allErrors: true, strict: true });
// Caches the in-flight Promise, not the resolved ValidateFunction — found by
// a real race in a manual MCP round trip: two concurrent tools/call requests
// for the same spec type (e.g. create_spec then validate_spec arriving close
// together) both saw an empty cache and both called ajv.compile on the same
// $id, which ajv rejects the second time. Caching the promise synchronously,
// before the first `await`, means a second concurrent caller sees the cache
// populated immediately and awaits the same compile instead of starting one.
const validatorCache = new Map<SpecType, Promise<ValidateFunction>>();

function getValidator(type: SpecType): Promise<ValidateFunction> {
  const cached = validatorCache.get(type);
  if (cached) return cached;

  const pending = (async () => {
    const schemaPath = join(SCHEMA_DIR, `${type}.schema.json`);
    const schema = JSON.parse(await readFile(schemaPath, 'utf-8'));
    return ajv.compile(schema);
  })();
  validatorCache.set(type, pending);
  return pending;
}

export async function validateSpecContent(type: SpecType, content: unknown): Promise<ValidationResult> {
  const validator = await getValidator(type);
  const valid = validator(content);
  if (valid) return { valid: true, errors: [] };

  const errors = (validator.errors ?? []).map((e) => `${e.instancePath || '(root)'} ${e.message}`);
  return { valid: false, errors };
}

export class SpecValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Spec content failed schema validation: ${errors.join('; ')}`);
    this.name = 'SpecValidationError';
  }
}

export interface CreateSpecInput {
  specId: string;
  type: SpecType;
  title: string;
  content: Record<string, unknown>;
  projectPath: string;
  /** Business spec_ids of specs this one depends on. Each must already exist as an active spec. */
  dependsOn?: string[];
}

export class SpecDependencyError extends Error {
  constructor(public readonly missingSpecId: string) {
    super(`Cannot record dependency on "${missingSpecId}" — no active spec exists with that spec_id.`);
    this.name = 'SpecDependencyError';
  }
}

function toSpecRow(row: {
  id: number;
  spec_id: string;
  type: SpecType;
  title: string;
  status: SpecStatus;
  content: Record<string, unknown>;
  version: number;
  project_path: string;
  created_at: string;
}): SpecRow {
  return {
    id: row.id,
    specId: row.spec_id,
    type: row.type,
    title: row.title,
    status: row.status,
    content: row.content,
    version: row.version,
    projectPath: row.project_path,
    createdAt: row.created_at,
  };
}

/**
 * Rejects invalid content before it ever reaches a row — the Phase 2 part B
 * spec-validation gate (§5.1) checks "does an active spec row exist", not
 * "is this content valid", precisely because invalid content can never
 * become an active row in the first place.
 *
 * Bumping a version (a prior active row already exists for this spec_id)
 * supersedes the old row and inserts the new one as active in a single
 * transaction — the same transaction that will also mark dependent
 * traceability_edges stale once Phase 2 part B's traceability graph exists
 * (§5.2's spec-version propagation; not yet wired here, see plan §12.2).
 */
export async function createSpec(pool: Pool, input: CreateSpecInput): Promise<SpecRow> {
  const validation = await validateSpecContent(input.type, input.content);
  if (!validation.valid) {
    throw new SpecValidationError(validation.errors);
  }

  return withTransaction(pool, async (client) => {
    const existing = await query<{ id: number; version: number }>(
      client,
      `SELECT id, version FROM specs WHERE spec_id = $1 ORDER BY version DESC LIMIT 1`,
      [input.specId],
    );
    const nextVersion = existing.length > 0 ? existing[0].version + 1 : 1;

    if (existing.length > 0) {
      await query(
        client,
        `UPDATE specs SET status = 'superseded' WHERE spec_id = $1 AND status = 'active'`,
        [input.specId],
      );
      // Same transaction as the version bump (plan §5.2): every
      // traceability_edges row naming the *old* row's id on either end goes
      // stale, so verify-green/request_review can tell code was proven
      // against a spec version that no longer exists.
      await markEdgesStaleForEntity(client, 'spec', String(existing[0].id));
    }

    const rows = await query(
      client,
      `INSERT INTO specs (spec_id, type, title, status, content, version, project_path)
       VALUES ($1, $2, $3, 'active', $4, $5, $6)
       RETURNING id, spec_id, type, title, status, content, version, project_path, created_at`,
      [input.specId, input.type, input.title, JSON.stringify(input.content), nextVersion, input.projectPath],
    );
    const spec = toSpecRow(rows[0] as Parameters<typeof toSpecRow>[0]);

    for (const dependencySpecId of input.dependsOn ?? []) {
      const dependencyRows = await query<{ id: number }>(
        client,
        `SELECT id FROM specs WHERE spec_id = $1 AND status = 'active'`,
        [dependencySpecId],
      );
      if (dependencyRows.length === 0) {
        throw new SpecDependencyError(dependencySpecId);
      }
      await addSpecDependency(client, spec.id, dependencyRows[0].id);
    }

    return spec;
  });
}

export async function getActiveSpec(pool: Pool, specId: string): Promise<SpecRow | null> {
  const rows = await query(
    pool,
    `SELECT id, spec_id, type, title, status, content, version, project_path, created_at
     FROM specs WHERE spec_id = $1 AND status = 'active'`,
    [specId],
  );
  return rows.length > 0 ? toSpecRow(rows[0] as Parameters<typeof toSpecRow>[0]) : null;
}

export async function listSpecs(pool: Pool, projectPath: string): Promise<SpecRow[]> {
  const rows = await query(
    pool,
    `SELECT id, spec_id, type, title, status, content, version, project_path, created_at
     FROM specs WHERE project_path = $1 AND status = 'active' ORDER BY spec_id`,
    [projectPath],
  );
  return rows.map((r) => toSpecRow(r as Parameters<typeof toSpecRow>[0]));
}

export async function addSpecDependency(db: Queryable, dependentId: number, dependencyId: number): Promise<void> {
  await query(
    db,
    `INSERT INTO spec_dependencies (dependent_id, dependency_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [dependentId, dependencyId],
  );
}

export interface DependencyEdge {
  dependentId: number;
  dependencyId: number;
}

/**
 * Pure BFS over an in-memory edge list — deliberately separated from the DB
 * query that fetches those edges so the traversal logic (the part actually
 * worth getting right: cycles, multi-hop chains, excluding the target
 * itself) is testable without a database.
 */
export function findTransitiveDependents(edges: DependencyEdge[], targetId: number): number[] {
  const dependentsOf = new Map<number, number[]>();
  for (const edge of edges) {
    const list = dependentsOf.get(edge.dependencyId) ?? [];
    list.push(edge.dependentId);
    dependentsOf.set(edge.dependencyId, list);
  }

  // Seed with the target itself so a dependency cycle can't re-discover and
  // include the target in its own impact set (found by a test, not by
  // inspection — see plan §12.2).
  const visited = new Set<number>([targetId]);
  const queue = [targetId];
  while (queue.length > 0) {
    const current = queue.shift() as number;
    for (const dependent of dependentsOf.get(current) ?? []) {
      if (!visited.has(dependent)) {
        visited.add(dependent);
        queue.push(dependent);
      }
    }
  }
  visited.delete(targetId);
  return [...visited];
}

export async function impactAnalysis(pool: Pool, specId: string): Promise<SpecRow[]> {
  const target = await getActiveSpec(pool, specId);
  if (!target) return [];

  const edgeRows = await query<{ dependent_id: number; dependency_id: number }>(
    pool,
    `SELECT dependent_id, dependency_id FROM spec_dependencies`,
  );
  const edges = edgeRows.map((r) => ({ dependentId: r.dependent_id, dependencyId: r.dependency_id }));
  const dependentIds = findTransitiveDependents(edges, target.id);
  if (dependentIds.length === 0) return [];

  const rows = await query(
    pool,
    `SELECT id, spec_id, type, title, status, content, version, project_path, created_at
     FROM specs WHERE id = ANY($1::int[])`,
    [dependentIds],
  );
  return rows.map((r) => toSpecRow(r as Parameters<typeof toSpecRow>[0]));
}

export interface StateMachine {
  name: string;
  states: string[];
  transitions: Array<{ from: string; to: string }>;
}

export interface StateTransitionCase {
  from: string;
  to: string;
  expected: 'valid' | 'invalid';
}

/**
 * Direct implementation of the "Specifying State Transitions" pattern
 * (domain.schema.json's stateMachines field): every listed transition is
 * valid; every other ordered pair — including ones that "skip" a state,
 * e.g. Authorized -> Refunded without going through Settled — is invalid by
 * omission. generate-tests.ts (Phase 2 part B) turns each case into a test.
 */
export function enumerateStateMachineTestCases(machine: StateMachine): StateTransitionCase[] {
  const validPairs = new Set(machine.transitions.map((t) => `${t.from}->${t.to}`));
  const cases: StateTransitionCase[] = [];
  for (const from of machine.states) {
    for (const to of machine.states) {
      if (from === to) continue;
      cases.push({ from, to, expected: validPairs.has(`${from}->${to}`) ? 'valid' : 'invalid' });
    }
  }
  return cases;
}

export interface TestGenerationPlan {
  specId: string;
  specType: SpecType;
  stateMachineCases: Array<{ machine: string; cases: StateTransitionCase[] }>;
}

/**
 * generate_tests's core logic: the only spec shape harness-os can turn into
 * an exhaustive, mechanically-derived case list is a domain spec's
 * stateMachines (enumerateStateMachineTestCases). Every other spec type
 * returns an empty stateMachineCases — the MCP tool still returns a
 * write_tests directive naming the spec, but doesn't pretend to have
 * enumerated cases it didn't actually derive (see generate-tests.ts).
 */
export function buildTestGenerationPlan(spec: SpecRow): TestGenerationPlan {
  const stateMachineCases: TestGenerationPlan['stateMachineCases'] = [];
  if (spec.type === 'domain') {
    const machines = (spec.content.stateMachines as StateMachine[] | undefined) ?? [];
    for (const machine of machines) {
      stateMachineCases.push({ machine: machine.name, cases: enumerateStateMachineTestCases(machine) });
    }
  }
  return { specId: spec.specId, specType: spec.type, stateMachineCases };
}

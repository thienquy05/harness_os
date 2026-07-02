import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  buildTestGenerationPlan,
  createSpec,
  enumerateStateMachineTestCases,
  findTransitiveDependents,
  impactAnalysis,
  SpecDependencyError,
  SpecValidationError,
  validateSpecContent,
} from './specs.js';

const validDomainContent = {
  id: 'APX-DOM-001',
  title: 'Order Lifecycle',
  entities: [{ name: 'Order', fields: [{ name: 'id', type: 'uuid' }] }],
};

describe('enumerateStateMachineTestCases', () => {
  it('emits a valid case for every listed transition', () => {
    const cases = enumerateStateMachineTestCases({
      name: 'OrderStatus',
      states: ['Pending', 'Authorized', 'Settled'],
      transitions: [
        { from: 'Pending', to: 'Authorized' },
        { from: 'Authorized', to: 'Settled' },
      ],
    });

    expect(cases).toContainEqual({ from: 'Pending', to: 'Authorized', expected: 'valid' });
    expect(cases).toContainEqual({ from: 'Authorized', to: 'Settled', expected: 'valid' });
  });

  it('emits an invalid case for every ordered pair not explicitly listed, including transitions that skip a state', () => {
    const cases = enumerateStateMachineTestCases({
      name: 'OrderStatus',
      states: ['Pending', 'Authorized', 'Settled', 'Refunded'],
      transitions: [
        { from: 'Pending', to: 'Authorized' },
        { from: 'Authorized', to: 'Settled' },
        { from: 'Settled', to: 'Refunded' },
      ],
    });

    // Authorized -> Refunded skips Settled and must be flagged invalid by omission.
    expect(cases).toContainEqual({ from: 'Authorized', to: 'Refunded', expected: 'invalid' });
    // Reverse of a valid transition is not itself valid.
    expect(cases).toContainEqual({ from: 'Authorized', to: 'Pending', expected: 'invalid' });
  });

  it('never emits a self-transition case', () => {
    const cases = enumerateStateMachineTestCases({
      name: 'OrderStatus',
      states: ['Pending', 'Authorized'],
      transitions: [{ from: 'Pending', to: 'Authorized' }],
    });

    expect(cases.some((c) => c.from === c.to)).toBe(false);
  });

  it('covers every ordered pair exactly once: n states -> n*(n-1) cases', () => {
    const cases = enumerateStateMachineTestCases({
      name: 'Three',
      states: ['A', 'B', 'C'],
      transitions: [{ from: 'A', to: 'B' }],
    });

    expect(cases).toHaveLength(6);
  });
});

describe('findTransitiveDependents', () => {
  it('returns direct dependents of the target', () => {
    const edges = [
      { dependentId: 2, dependencyId: 1 },
      { dependentId: 3, dependencyId: 1 },
    ];
    expect(new Set(findTransitiveDependents(edges, 1))).toEqual(new Set([2, 3]));
  });

  it('returns transitive dependents across multiple hops', () => {
    // 3 depends on 2, 2 depends on 1 -> changing 1 impacts both 2 and 3.
    const edges = [
      { dependentId: 2, dependencyId: 1 },
      { dependentId: 3, dependencyId: 2 },
    ];
    expect(new Set(findTransitiveDependents(edges, 1))).toEqual(new Set([2, 3]));
  });

  it('does not include the target itself or unrelated nodes', () => {
    const edges = [
      { dependentId: 2, dependencyId: 1 },
      { dependentId: 5, dependencyId: 4 },
    ];
    const result = findTransitiveDependents(edges, 1);
    expect(result).not.toContain(1);
    expect(result).not.toContain(5);
  });

  it('handles a cycle without infinite looping', () => {
    const edges = [
      { dependentId: 2, dependencyId: 1 },
      { dependentId: 1, dependencyId: 2 },
    ];
    expect(new Set(findTransitiveDependents(edges, 1))).toEqual(new Set([2]));
  });

  it('returns an empty array when nothing depends on the target', () => {
    const edges = [{ dependentId: 2, dependencyId: 1 }];
    expect(findTransitiveDependents(edges, 99)).toEqual([]);
  });
});

describe('validateSpecContent', () => {
  it('accepts content matching its schema', async () => {
    const result = await validateSpecContent('domain', validDomainContent);
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('rejects content missing a required field, with a readable error', async () => {
    const { title: _title, ...withoutTitle } = validDomainContent;
    const result = await validateSpecContent('domain', withoutTitle);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a spec id that does not match the type-specific naming convention', async () => {
    const result = await validateSpecContent('domain', { ...validDomainContent, id: 'APX-API-001' });
    expect(result.valid).toBe(false);
  });

  it('handles concurrent first-time validation of the same type without a double-compile race', async () => {
    // Reproduces a real bug found via a manual MCP round trip: two 'tools/call'
    // requests for the same spec type (e.g. create_spec then validate_spec)
    // arriving close together both see the validator cache empty and both
    // call ajv.compile on the same $id, which ajv rejects the second time.
    // Uses 'infra' here so this test doesn't depend on 'domain' already being
    // warm from an earlier test in this file.
    const infraContent = {
      id: 'APX-INFRA-001',
      title: 'Stack',
      components: [{ name: 'api', type: 'service', description: 'x' }],
    };
    const [a, b] = await Promise.all([
      validateSpecContent('infra', infraContent),
      validateSpecContent('infra', infraContent),
    ]);
    expect(a.valid).toBe(true);
    expect(b.valid).toBe(true);
  });
});

/** Fake pool + client whose responses branch on the SQL text, since createSpec drives a transaction. */
function fakeTransactionalPool(
  options: { existingVersion?: number; existingActiveSpecIds?: Record<string, number> } = {},
) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  let nextId = 1;
  const client = {
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      if (text.includes('SELECT id, version FROM specs')) {
        return { rows: options.existingVersion ? [{ id: 99, version: options.existingVersion }] : [] };
      }
      if (text.includes('UPDATE specs SET status')) {
        return { rows: [] };
      }
      if (text.includes('UPDATE traceability_edges')) {
        return { rows: [] };
      }
      if (text.includes('INSERT INTO specs')) {
        return {
          rows: [
            {
              id: nextId++,
              spec_id: params[0],
              type: params[1],
              title: params[2],
              status: 'active',
              content: JSON.parse(params[3] as string),
              version: params[4],
              project_path: params[5],
              created_at: '2026-07-01T00:00:00.000Z',
            },
          ],
        };
      }
      if (text.includes(`SELECT id FROM specs WHERE spec_id`)) {
        const id = options.existingActiveSpecIds?.[params[0] as string];
        return { rows: id === undefined ? [] : [{ id }] };
      }
      if (text.includes('INSERT INTO spec_dependencies')) {
        return { rows: [] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  } as unknown as PoolClient;
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, client, calls };
}

describe('createSpec', () => {
  it('rejects invalid content before touching the database at all', async () => {
    const { pool, client } = fakeTransactionalPool();
    await expect(
      createSpec(pool, {
        specId: 'APX-DOM-001',
        type: 'domain',
        title: 'Order Lifecycle',
        content: { id: 'APX-DOM-001' }, // missing required "entities"
        projectPath: '/fake/project',
      }),
    ).rejects.toThrow(SpecValidationError);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('creates version 1 with no supersede when no prior version exists', async () => {
    const { pool, client, calls } = fakeTransactionalPool();
    const spec = await createSpec(pool, {
      specId: 'APX-DOM-001',
      type: 'domain',
      title: 'Order Lifecycle',
      content: validDomainContent,
      projectPath: '/fake/project',
    });

    expect(spec.version).toBe(1);
    expect(spec.status).toBe('active');
    expect(calls.some((c) => c.text.includes('UPDATE specs SET status'))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('supersedes the prior active version and bumps the version number', async () => {
    const { pool, calls } = fakeTransactionalPool({ existingVersion: 1 });
    const spec = await createSpec(pool, {
      specId: 'APX-DOM-001',
      type: 'domain',
      title: 'Order Lifecycle v2',
      content: validDomainContent,
      projectPath: '/fake/project',
    });

    expect(spec.version).toBe(2);
    expect(calls.some((c) => c.text.includes('UPDATE specs SET status'))).toBe(true);
    const staleCall = calls.find((c) => c.text.includes('UPDATE traceability_edges'));
    expect(staleCall?.params).toEqual(['spec', '99']);
  });

  it('records a dependency edge when dependsOn names an existing active spec', async () => {
    const { pool, calls } = fakeTransactionalPool({ existingActiveSpecIds: { 'APX-DOM-001': 5 } });
    const spec = await createSpec(pool, {
      specId: 'APX-API-001',
      type: 'api',
      title: 'Orders API',
      content: { id: 'APX-API-001', title: 'Orders API', endpoints: [{ method: 'GET', path: '/x', description: 'd' }] },
      projectPath: '/fake/project',
      dependsOn: ['APX-DOM-001'],
    });

    const depInsert = calls.find((c) => c.text.includes('INSERT INTO spec_dependencies'));
    expect(depInsert?.params).toEqual([spec.id, 5]);
  });

  it('throws SpecDependencyError when dependsOn names a spec with no active version', async () => {
    const { pool } = fakeTransactionalPool();
    await expect(
      createSpec(pool, {
        specId: 'APX-API-001',
        type: 'api',
        title: 'Orders API',
        content: { id: 'APX-API-001', title: 'Orders API', endpoints: [{ method: 'GET', path: '/x', description: 'd' }] },
        projectPath: '/fake/project',
        dependsOn: ['APX-DOM-999'],
      }),
    ).rejects.toThrow(SpecDependencyError);
  });
});

describe('impactAnalysis', () => {
  it('returns transitive dependents of the given spec', async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes(`status = 'active'`)) {
        return { rows: [{ id: 1, spec_id: 'APX-DOM-001', type: 'domain', title: 'Order', status: 'active', content: {}, version: 1, project_path: '/p', created_at: 'now' }] };
      }
      if (text.includes('FROM spec_dependencies')) {
        return { rows: [{ dependent_id: 2, dependency_id: 1 }] };
      }
      if (text.includes('id = ANY')) {
        return { rows: [{ id: 2, spec_id: 'APX-API-001', type: 'api', title: 'Orders API', status: 'active', content: {}, version: 1, project_path: '/p', created_at: 'now' }] };
      }
      return { rows: [] };
    });
    const pool = { query } as unknown as Pool;

    const result = await impactAnalysis(pool, 'APX-DOM-001');
    expect(result).toHaveLength(1);
    expect(result[0].specId).toBe('APX-API-001');
  });

  it('returns an empty array when the target spec does not exist', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;
    expect(await impactAnalysis(pool, 'APX-DOM-999')).toEqual([]);
  });
});

describe('buildTestGenerationPlan', () => {
  const baseSpec = {
    id: 1,
    specId: 'APX-DOM-001',
    type: 'domain' as const,
    title: 'Order Lifecycle',
    status: 'active' as const,
    version: 1,
    projectPath: '/fake/project',
    createdAt: 'now',
  };

  it('enumerates state-transition cases for every state machine on a domain spec', () => {
    const plan = buildTestGenerationPlan({
      ...baseSpec,
      content: {
        id: 'APX-DOM-001',
        title: 'Order Lifecycle',
        entities: [],
        stateMachines: [
          { name: 'OrderStatus', states: ['Pending', 'Settled'], transitions: [{ from: 'Pending', to: 'Settled' }] },
        ],
      },
    });

    expect(plan.stateMachineCases).toHaveLength(1);
    expect(plan.stateMachineCases[0].machine).toBe('OrderStatus');
    expect(plan.stateMachineCases[0].cases).toContainEqual({ from: 'Pending', to: 'Settled', expected: 'valid' });
  });

  it('returns no state-machine cases for a domain spec with none declared', () => {
    const plan = buildTestGenerationPlan({ ...baseSpec, content: { id: 'APX-DOM-001', title: 'x', entities: [] } });
    expect(plan.stateMachineCases).toEqual([]);
  });

  it('returns no state-machine cases for a non-domain spec type', () => {
    const plan = buildTestGenerationPlan({
      ...baseSpec,
      type: 'api',
      content: { id: 'APX-API-001', title: 'x', endpoints: [] },
    });
    expect(plan.stateMachineCases).toEqual([]);
  });
});

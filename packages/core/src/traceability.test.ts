import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { listTraceabilityEdges, markEdgesStaleForEntity, recordTraceabilityEdge } from './traceability.js';

describe('recordTraceabilityEdge', () => {
  it('inserts an edge row and returns it', async () => {
    const query = vi.fn(async (_text: string, params: unknown[] = []) => ({
      rows: [
        {
          id: 1,
          from_type: params[0],
          from_id: params[1],
          to_type: params[2],
          to_id: params[3],
          stale: false,
          project_path: params[4],
          created_at: '2026-07-02T00:00:00.000Z',
        },
      ],
    }));
    const db = { query } as unknown as Pool;
    const edge = await recordTraceabilityEdge(db, {
      fromType: 'test',
      fromId: 'src/foo.test.ts',
      toType: 'spec',
      toId: '5',
      projectPath: '/fake/project',
    });
    expect(edge).toEqual({
      id: 1,
      fromType: 'test',
      fromId: 'src/foo.test.ts',
      toType: 'spec',
      toId: '5',
      stale: false,
      projectPath: '/fake/project',
      createdAt: '2026-07-02T00:00:00.000Z',
    });
  });
});

describe('markEdgesStaleForEntity', () => {
  it('updates edges where the entity appears as either endpoint', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const db = { query } as unknown as Pool;
    await markEdgesStaleForEntity(db, 'spec', '5');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE traceability_edges'), ['spec', '5']);
  });
});

describe('listTraceabilityEdges', () => {
  it('returns edges scoped to the given project', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          id: 1,
          from_type: 'test',
          from_id: 'a',
          to_type: 'spec',
          to_id: '5',
          stale: true,
          project_path: '/fake/project',
          created_at: 'now',
        },
      ],
    }));
    const pool = { query } as unknown as Pool;
    const edges = await listTraceabilityEdges(pool, '/fake/project');
    expect(edges).toHaveLength(1);
    expect(edges[0].stale).toBe(true);
  });
});

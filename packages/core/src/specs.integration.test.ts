import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client, type Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from './db.js';
import { createSpec } from './specs.js';
import { recordTraceabilityEdge } from './traceability.js';

// Real Postgres, real db/init SQL, real createSpec — proves the stale-
// propagation transaction (plan §5.2) actually changes on-disk state, not
// just that a mocked pool saw the right query text. See plan §12.3: a fake
// pool asserting "the UPDATE ran" would pass even if the WHERE clause typed
// the id as an int against a TEXT column and silently matched zero rows.
describe('spec-version stale propagation against a real Postgres instance', () => {
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

  it('marks a real traceability edge stale when the spec it points at is superseded', async () => {
    const v1 = await createSpec(pool, {
      specId: 'APX-DOM-100',
      type: 'domain',
      title: 'Order Lifecycle',
      content: {
        id: 'APX-DOM-100',
        title: 'Order Lifecycle',
        entities: [{ name: 'Order', fields: [{ name: 'id', type: 'uuid' }] }],
      },
      projectPath: '/fake/project',
    });

    const edge = await recordTraceabilityEdge(pool, {
      fromType: 'test',
      fromId: 'src/order.test.ts',
      toType: 'spec',
      toId: String(v1.id),
      projectPath: '/fake/project',
    });
    expect(edge.stale).toBe(false);

    await createSpec(pool, {
      specId: 'APX-DOM-100',
      type: 'domain',
      title: 'Order Lifecycle v2',
      content: {
        id: 'APX-DOM-100',
        title: 'Order Lifecycle v2',
        entities: [{ name: 'Order', fields: [{ name: 'id', type: 'uuid' }] }],
      },
      projectPath: '/fake/project',
    });

    const rows = await pool.query('SELECT stale FROM traceability_edges WHERE id = $1', [edge.id]);
    expect(rows.rows[0].stale).toBe(true);
  });

  it('does not mark unrelated edges stale', async () => {
    const other = await createSpec(pool, {
      specId: 'APX-DOM-200',
      type: 'domain',
      title: 'Unrelated Spec',
      content: {
        id: 'APX-DOM-200',
        title: 'Unrelated Spec',
        entities: [{ name: 'Thing', fields: [{ name: 'id', type: 'uuid' }] }],
      },
      projectPath: '/fake/project',
    });
    const unrelatedEdge = await recordTraceabilityEdge(pool, {
      fromType: 'test',
      fromId: 'src/thing.test.ts',
      toType: 'spec',
      toId: String(other.id),
      projectPath: '/fake/project',
    });

    await createSpec(pool, {
      specId: 'APX-DOM-100',
      type: 'domain',
      title: 'Order Lifecycle v3',
      content: {
        id: 'APX-DOM-100',
        title: 'Order Lifecycle v3',
        entities: [{ name: 'Order', fields: [{ name: 'id', type: 'uuid' }] }],
      },
      projectPath: '/fake/project',
    });

    const rows = await pool.query('SELECT stale FROM traceability_edges WHERE id = $1', [unrelatedEdge.id]);
    expect(rows.rows[0].stale).toBe(false);
  });
});

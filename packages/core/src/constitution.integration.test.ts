import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from './db.js';
import { getConstitution } from './constitution.js';

// Real Postgres, real db/init + db/seed SQL — proves the schema and seed this
// repo ships actually produce what packages/core reads, not just that the
// mocked unit tests agree with themselves.
describe('getConstitution against a real Postgres instance', () => {
  let container: StartedPostgreSqlContainer;

  beforeAll(async () => {
    // Database name must match db/init/0000_roles.sql's hardcoded
    // `GRANT CONNECT ON DATABASE harness_os` so the unmodified init scripts
    // (the same ones docker-compose mounts into the real container) apply
    // cleanly here too — proving what actually ships, not a test-only variant.
    container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('harness_os')
      .withUsername('harness_admin')
      .withPassword('harness_admin')
      .start();

    const adminClient = new Client({ connectionString: container.getConnectionUri() });
    await adminClient.connect();

    const repoRoot = join(import.meta.dirname, '..', '..', '..');
    const initDir = join(repoRoot, 'db', 'init');
    const seedDir = join(repoRoot, 'db', 'seed');

    const initFiles = (await readdir(initDir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of initFiles) {
      const sql = await readFile(join(initDir, file), 'utf-8');
      await adminClient.query(sql);
    }
    const seedFiles = (await readdir(seedDir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of seedFiles) {
      const sql = await readFile(join(seedDir, file), 'utf-8');
      await adminClient.query(sql);
    }
    await adminClient.end();
  }, 60_000);

  afterAll(async () => {
    await container.stop();
  });

  it('returns version 1.0.0 with all 18 seeded rules', async () => {
    const pool = createPool({ connectionString: container.getConnectionUri() });
    const constitution = await getConstitution(pool);
    expect(constitution.version).toBe('1.0.0');
    expect(constitution.rules).toHaveLength(18);
    expect(constitution.rules.map((r) => r.ruleId)).toContain('CONST-CORE-001');
    const coreGate = constitution.rules.find((r) => r.ruleId === 'CONST-CORE-002');
    expect(coreGate?.enforcement).toBe('gate');
    expect(coreGate?.severity).toBe('critical');
    await pool.end();
  });

  it('gate-tagged rules match exactly the CONST-*-002/004-style enforcement design', async () => {
    const pool = createPool({ connectionString: container.getConnectionUri() });
    const constitution = await getConstitution(pool);
    const gateRules = constitution.rules.filter((r) => r.enforcement === 'gate').map((r) => r.ruleId);
    expect(gateRules.sort()).toEqual(['CONST-AI-002', 'CONST-CORE-001', 'CONST-CORE-002', 'CONST-CORE-004']);
    await pool.end();
  });
});

import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createPool, withTransaction } from './db.js';

describe('createPool', () => {
  it('throws when no connection string is available', () => {
    const originalEnv = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(() => createPool()).toThrow(/DATABASE_URL/);
    } finally {
      if (originalEnv !== undefined) process.env.DATABASE_URL = originalEnv;
    }
  });

  it('accepts an explicit connection string override', () => {
    const pool = createPool({ connectionString: 'postgres://user:pass@localhost:5432/db' });
    expect(pool).toBeDefined();
    void pool.end();
  });
});

function fakePoolWithClient() {
  const queries: string[] = [];
  const client = {
    query: vi.fn(async (text: string) => {
      queries.push(text);
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, client, queries };
}

describe('withTransaction', () => {
  it('runs BEGIN, the callback, then COMMIT, and releases the client', async () => {
    const { pool, client, queries } = fakePoolWithClient();

    const result = await withTransaction(pool, async (tx) => {
      await tx.query('SELECT 1');
      return 'callback-result';
    });

    expect(result).toBe('callback-result');
    expect(queries).toEqual(['BEGIN', 'SELECT 1', 'COMMIT']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back and rethrows if the callback throws, and still releases the client', async () => {
    const { pool, client, queries } = fakePoolWithClient();

    await expect(
      withTransaction(pool, async () => {
        throw new Error('callback failed');
      }),
    ).rejects.toThrow('callback failed');

    expect(queries).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

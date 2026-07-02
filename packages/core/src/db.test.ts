import { describe, expect, it } from 'vitest';
import { createPool } from './db.js';

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

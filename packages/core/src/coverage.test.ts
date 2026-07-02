import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { validateCoverage } from './coverage.js';

describe('validateCoverage', () => {
  it('passes when coverage meets the 80% default threshold', async () => {
    const decisions: unknown[] = [];
    const pool = {
      query: vi.fn(async (text: string, params: unknown[] = []) => {
        if (text.includes('INSERT INTO decisions')) {
          decisions.push(params);
          return { rows: [{ id: 1 }] };
        }
        throw new Error(`Unexpected query: ${text}`);
      }),
    } as unknown as Pool;

    const result = await validateCoverage(pool, { projectPath: '/p', coveragePercent: 85 });
    expect(result.pass).toBe(true);
    expect(decisions).toHaveLength(1);
  });

  it('fails when coverage is below the 80% default threshold', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ id: 1 }] })) } as unknown as Pool;
    const result = await validateCoverage(pool, { projectPath: '/p', coveragePercent: 65 });
    expect(result.pass).toBe(false);
    expect(result.threshold).toBe(80);
  });

  it('honors an explicit threshold override', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ id: 1 }] })) } as unknown as Pool;
    const result = await validateCoverage(pool, { projectPath: '/p', coveragePercent: 85, threshold: 90 });
    expect(result.pass).toBe(false);
  });
});

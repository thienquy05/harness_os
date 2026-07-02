import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { assessAndRecordRisk, assessRisk } from './risk.js';

describe('assessRisk', () => {
  it('classifies financial/trading keywords as critical', () => {
    const result = assessRisk({ requestDescription: 'Add a new order execution path for live trading' });
    expect(result.level).toBe('critical');
    expect(result.requiredGates).toContain('human-ack');
  });

  it('classifies auth/security keywords as high when no critical keyword matches', () => {
    const result = assessRisk({ requestDescription: 'Refactor the session token refresh flow' });
    expect(result.level).toBe('high');
  });

  it('prefers critical over high when both keyword sets match', () => {
    const result = assessRisk({ requestDescription: 'Add auth check before withdraw' });
    expect(result.level).toBe('critical');
  });

  it('classifies a gated path with no sensitive keyword as medium', () => {
    const result = assessRisk({ requestDescription: 'Add a new UI card', touchedPaths: ['frontend/js/dashboard.jsx'] });
    expect(result.level).toBe('medium');
  });

  it('classifies everything else as low', () => {
    const result = assessRisk({ requestDescription: 'Fix a typo in the README' });
    expect(result.level).toBe('low');
    expect(result.requiredGates).toEqual([]);
  });
});

describe('assessAndRecordRisk', () => {
  it('persists the assessment and returns it with an id', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 42 }] });
    const pool = { query } as unknown as Pool;

    const result = await assessAndRecordRisk(pool, {
      requestDescription: 'Add a payment retry path',
      projectPath: '/fake/project',
    });

    expect(result.id).toBe(42);
    expect(result.level).toBe('critical');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO risk_assessments'),
      expect.arrayContaining(['Add a payment retry path', expect.any(String), 'critical', expect.any(String), expect.any(Array), '/fake/project']),
    );
  });
});

import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { auditReport, getDecisionById, isDecisionApproved, recordDecision } from './audit.js';

describe('recordDecision', () => {
  it('inserts a decision row and returns its id', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 7 }] });
    const pool = { query } as unknown as Pool;

    const result = await recordDecision(pool, {
      actor: 'gate-daemon',
      action: 'block_write',
      rationale: 'drift detected',
      riskLevel: 'critical',
      projectPath: '/fake/project',
    });

    expect(result.id).toBe(7);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO decisions'),
      ['gate-daemon', 'block_write', 'drift detected', [], 'critical', 'approved', '/fake/project', null],
    );
  });

  it('defaults status to pending_approval only when explicitly requested', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 1 }] });
    const pool = { query } as unknown as Pool;

    await recordDecision(pool, {
      actor: 'server',
      action: 'critical_write',
      rationale: 'financial logic touched',
      riskLevel: 'critical',
      projectPath: '/fake/project',
      status: 'pending_approval',
    });

    expect(query).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['pending_approval']));
  });
});

describe('auditReport', () => {
  it('queries decisions for a project ordered by most recent first', async () => {
    const rows = [{ id: 2 }, { id: 1 }];
    const query = vi.fn().mockResolvedValue({ rows });
    const pool = { query } as unknown as Pool;

    const result = await auditReport(pool, '/fake/project');
    expect(result).toBe(rows);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY created_at DESC'), ['/fake/project']);
  });
});

describe('getDecisionById', () => {
  it('returns the row when found', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 5, status: 'pending_approval' }] });
    const pool = { query } as unknown as Pool;
    expect(await getDecisionById(pool, 5)).toEqual({ id: 5, status: 'pending_approval' });
  });

  it('returns null when not found', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;
    expect(await getDecisionById(pool, 999)).toBeNull();
  });
});

describe('isDecisionApproved', () => {
  it('is true when the decision itself is approved', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ status: 'approved' }] });
    const pool = { query } as unknown as Pool;
    expect(await isDecisionApproved(pool, 5)).toBe(true);
  });

  it('is true when a later row references it with related_decision_id and status approved', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ status: 'pending_approval' }, { status: 'approved' }] });
    const pool = { query } as unknown as Pool;
    expect(await isDecisionApproved(pool, 5)).toBe(true);
  });

  it('is false when nothing approved exists for the decision', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ status: 'pending_approval' }] });
    const pool = { query } as unknown as Pool;
    expect(await isDecisionApproved(pool, 5)).toBe(false);
  });
});

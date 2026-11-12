import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  // Keywords matched as substrings: "border"/"reorder" contain "order" (critical), "author" contains
  // "auth" (high). They are whole words now, across camelCase, snake_case and path segments.
  it('does not match a keyword inside another word', () => {
    expect(assessRisk({ requestDescription: 'Fix the card border radius and reorder the list' }).level).toBe('low');
    expect(assessRisk({ requestDescription: 'Show the author name on each note' }).level).toBe('low');
  });

  it('matches keywords as words in identifiers and paths, including plurals', () => {
    expect(assessRisk({ requestDescription: 'Refactor', touchedPaths: ['src/authService.ts'] }).level).toBe('high');
    expect(assessRisk({ requestDescription: 'Refactor', touchedPaths: ['src/session_store.ts'] }).level).toBe('high');
    expect(assessRisk({ requestDescription: 'List all payments' }).level).toBe('critical');
    expect(assessRisk({ requestDescription: 'Add OAuth sign-in' }).level).toBe('high');
  });

  it('applies project overrides: ignored keywords and extra keywords', () => {
    const risk = { ignoreKeywords: ['financial'], extraHigh: ['nfc'] };
    expect(assessRisk({ requestDescription: 'Show financial cost estimates' }, risk).level).toBe('low');
    expect(assessRisk({ requestDescription: 'Write the NFC tag payload' }, risk).level).toBe('high');
    expect(assessRisk({ requestDescription: 'Add a payment retry path' }, risk).level).toBe('critical');
  });
});

describe('assessAndRecordRisk', () => {
  it('loads risk overrides from the project harness.config.json', async () => {
    const project = await mkdtemp(join(tmpdir(), 'harness-risk-'));
    await mkdir(join(project, '.claude'));
    await writeFile(join(project, '.claude', 'harness.config.json'), JSON.stringify({ risk: { ignoreKeywords: ['financial'] } }));
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 7 }] });
    const result = await assessAndRecordRisk({ query } as unknown as Pool, {
      requestDescription: 'Show financial cost estimates',
      projectPath: project,
    });
    await rm(project, { recursive: true, force: true });
    expect(result.level).toBe('low');
    expect(result.factors).toMatchObject({ overrides: { ignoreKeywords: ['financial'] } });
  });

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

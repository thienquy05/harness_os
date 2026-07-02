import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { getConstitution, mergeRuleSets, parseConstitutionMarkdown } from './constitution.js';

function fakePool(rows: { versionRows: unknown[]; ruleRows: unknown[] }): Pool {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: rows.versionRows })
    .mockResolvedValueOnce({ rows: rows.ruleRows });
  return { query } as unknown as Pool;
}

describe('parseConstitutionMarkdown', () => {
  it('parses a single rule block into a ConstitutionRule', () => {
    const md = `
## CONST-CORE-001 — Spec required before gated code
- severity: critical
- enforcement: gate
- domain: core

No implementation code may be written without a validated spec.
Second line of body.
`;
    const rules = parseConstitutionMarkdown(md);
    expect(rules).toEqual([
      {
        ruleId: 'CONST-CORE-001',
        domain: 'core',
        severity: 'critical',
        enforcement: 'gate',
        text: 'No implementation code may be written without a validated spec. Second line of body.',
      },
    ]);
  });

  it('parses multiple rule blocks and ignores non-rule headings', () => {
    const md = `
## Rule format
Some prose that is not a rule.

## CONST-SEC-001 — No hardcoded secrets
- severity: critical
- enforcement: review
- domain: security

No API keys in source code.

## CONST-SEC-002 — No client-side LLM calls
- severity: critical
- enforcement: review
- domain: security

Proxy through a server-side endpoint.
`;
    const rules = parseConstitutionMarkdown(md);
    expect(rules.map((r) => r.ruleId)).toEqual(['CONST-SEC-001', 'CONST-SEC-002']);
  });

  it('drops an incomplete block missing a required field', () => {
    const md = `
## CONST-CORE-999 — Missing enforcement
- severity: low
- domain: core

Incomplete rule, no enforcement field.
`;
    expect(parseConstitutionMarkdown(md)).toEqual([]);
  });
});

describe('mergeRuleSets', () => {
  const base = [
    { ruleId: 'CONST-SEC-001', domain: 'security', text: 'global', severity: 'critical' as const, enforcement: 'review' as const },
    { ruleId: 'CONST-SEC-002', domain: 'security', text: 'global 2', severity: 'high' as const, enforcement: 'review' as const },
  ];

  it('lets a project override replace a global rule with the same id', () => {
    const overrides = [{ ...base[0], text: 'project-specific override' }];
    const merged = mergeRuleSets(base, overrides);
    expect(merged.find((r) => r.ruleId === 'CONST-SEC-001')?.text).toBe('project-specific override');
    expect(merged).toHaveLength(2);
  });

  it('appends a project-only rule that has no global counterpart', () => {
    const overrides = [{ ruleId: 'CONST-PROJ-001', domain: 'project', text: 'project only', severity: 'medium' as const, enforcement: 'review' as const }];
    const merged = mergeRuleSets(base, overrides);
    expect(merged).toHaveLength(3);
    expect(merged.map((r) => r.ruleId)).toContain('CONST-PROJ-001');
  });
});

describe('getConstitution', () => {
  it('returns the latest version and its rules', async () => {
    const pool = fakePool({
      versionRows: [{ version: '1.0.0' }],
      ruleRows: [
        { rule_id: 'CONST-CORE-001', domain: 'core', text: 'rule text', severity: 'critical', enforcement: 'gate' },
      ],
    });
    const result = await getConstitution(pool);
    expect(result.version).toBe('1.0.0');
    expect(result.rules).toEqual([
      { ruleId: 'CONST-CORE-001', domain: 'core', text: 'rule text', severity: 'critical', enforcement: 'gate' },
    ]);
  });

  it('throws when no constitution version has been seeded', async () => {
    const pool = fakePool({ versionRows: [], ruleRows: [] });
    await expect(getConstitution(pool)).rejects.toThrow(/seed/);
  });

  it('merges project-local overrides when projectPath + a reader are provided', async () => {
    const pool = fakePool({
      versionRows: [{ version: '1.0.0' }],
      ruleRows: [
        { rule_id: 'CONST-SEC-001', domain: 'security', text: 'global text', severity: 'critical', enforcement: 'review' },
      ],
    });
    const overrideMd = `
## CONST-SEC-001 — No hardcoded secrets
- severity: critical
- enforcement: review
- domain: security

Project-specific tightened wording.
`;
    const result = await getConstitution(pool, {
      projectPath: '/fake/project',
      readProjectOverrides: async () => [overrideMd],
    });
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].text).toBe('Project-specific tightened wording.');
  });
});

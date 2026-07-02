import type { Pool } from 'pg';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@harness-os/core', () => ({
  assessAndRecordRisk: vi.fn(async (_pool: unknown, input: Record<string, unknown>) => ({
    id: 1,
    level: 'critical',
    rationale: 'stub',
    factors: {},
    requiredGates: ['human-ack'],
    ...input,
  })),
  recordDecision: vi.fn(async () => ({ id: 99 })),
  auditReport: vi.fn(async () => [{ id: 1, action: 'block_write' }]),
  getConstitution: vi.fn(async () => ({ version: '1.0.0', rules: [] })),
}));

import { registerAssessRiskTool } from '../../src/tools/assess-risk.js';
import { registerRecordDecisionTool } from '../../src/tools/record-decision.js';
import { registerAuditReportTool } from '../../src/tools/audit-report.js';
import { registerEvaluateGovernanceTool } from '../../src/tools/evaluate-governance.js';
import { assessAndRecordRisk, recordDecision, auditReport, getConstitution } from '@harness-os/core';

function newServerAndPool(): { server: McpServer; pool: Pool } {
  return { server: new McpServer({ name: 'test', version: '0.0.0' }), pool: {} as Pool };
}

describe('assess_risk tool', () => {
  it('forwards args to assessAndRecordRisk and returns JSON text', async () => {
    const { server, pool } = newServerAndPool();
    registerAssessRiskTool(server, pool);
    // @ts-expect-error -- private registry access, see get-constitution.test.ts
    const tool = server._registeredTools['assess_risk'];
    const result = await tool.handler(
      { project_path: '/p', request_description: 'add trading order path' },
      {} as never,
    );
    expect(assessAndRecordRisk).toHaveBeenCalledWith(pool, {
      projectPath: '/p',
      requestDescription: 'add trading order path',
      touchedPaths: undefined,
    });
    expect(JSON.parse(result.content[0].text as string).level).toBe('critical');
  });
});

describe('record_decision tool', () => {
  it('forwards args to recordDecision', async () => {
    const { server, pool } = newServerAndPool();
    registerRecordDecisionTool(server, pool);
    // @ts-expect-error -- private registry access
    const tool = server._registeredTools['record_decision'];
    await tool.handler(
      { project_path: '/p', actor: 'claude-code', action: 'write', rationale: 'r', risk_level: 'low' },
      {} as never,
    );
    expect(recordDecision).toHaveBeenCalledWith(pool, {
      projectPath: '/p',
      actor: 'claude-code',
      action: 'write',
      rationale: 'r',
      riskLevel: 'low',
      constitutionRulesApplied: undefined,
      status: undefined,
      relatedDecisionId: undefined,
    });
  });
});

describe('audit_report tool', () => {
  it('forwards project_path to auditReport', async () => {
    const { server, pool } = newServerAndPool();
    registerAuditReportTool(server, pool);
    // @ts-expect-error -- private registry access
    const tool = server._registeredTools['audit_report'];
    const result = await tool.handler({ project_path: '/p' }, {} as never);
    expect(auditReport).toHaveBeenCalledWith(pool, '/p');
    expect(JSON.parse(result.content[0].text as string)).toEqual([{ id: 1, action: 'block_write' }]);
  });
});

describe('evaluate_governance tool', () => {
  it('combines getConstitution and assessAndRecordRisk', async () => {
    const { server, pool } = newServerAndPool();
    registerEvaluateGovernanceTool(server, pool);
    // @ts-expect-error -- private registry access
    const tool = server._registeredTools['evaluate_governance'];
    const result = await tool.handler(
      { project_path: '/p', request_description: 'add a feature' },
      {} as never,
    );
    expect(getConstitution).toHaveBeenCalledWith(pool, { projectPath: '/p' });
    expect(assessAndRecordRisk).toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.constitution.version).toBe('1.0.0');
    expect(parsed.riskAssessment.level).toBe('critical');
  });
});

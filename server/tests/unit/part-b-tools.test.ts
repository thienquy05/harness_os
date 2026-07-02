import type { Pool } from 'pg';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@harness-os/core', () => ({
  getActiveSpec: vi.fn(async (_pool: unknown, specId: string) =>
    specId === 'APX-DOM-999'
      ? null
      : { id: 1, specId, type: 'domain', title: 'Order', status: 'active', version: 1, projectPath: '/p', content: {} },
  ),
  buildTestGenerationPlan: vi.fn(() => ({ specId: 'APX-DOM-001', specType: 'domain', stateMachineCases: [] })),
  validateCoverage: vi.fn(async () => ({ pass: true, coveragePercent: 85, threshold: 80 })),
  requestReviewDirective: vi.fn((riskLevel: string, files: string[]) => ({
    action: riskLevel === 'low' ? 'no_review_required' : 'invoke_agent',
    reason: 'r',
    agent: 'security-reviewer',
    files,
  })),
  recordDecision: vi.fn(async () => ({ id: 1 })),
  recordTraceabilityEdge: vi.fn(async (_pool: unknown, input: Record<string, unknown>) => ({
    id: 1,
    ...input,
    stale: false,
  })),
}));

import { registerGenerateTestsTool } from '../../src/tools/generate-tests.js';
import { registerValidateCoverageTool } from '../../src/tools/validate-coverage.js';
import { registerRequestReviewTool } from '../../src/tools/request-review.js';
import { registerTraceArtifactTool } from '../../src/tools/trace-artifact.js';
import {
  buildTestGenerationPlan,
  getActiveSpec,
  recordDecision,
  recordTraceabilityEdge,
  requestReviewDirective,
  validateCoverage,
} from '@harness-os/core';

function newServerAndPool(): { server: McpServer; pool: Pool } {
  return { server: new McpServer({ name: 'test', version: '0.0.0' }), pool: {} as Pool };
}

describe('generate_tests tool', () => {
  it('returns a write_tests directive with the derived plan for an existing spec', async () => {
    const { server, pool } = newServerAndPool();
    registerGenerateTestsTool(server, pool);
    // @ts-expect-error -- private registry access
    const tool = server._registeredTools['generate_tests'];
    const result = await tool.handler({ spec_id: 'APX-DOM-001' }, {} as never);
    expect(getActiveSpec).toHaveBeenCalledWith(pool, 'APX-DOM-001');
    expect(buildTestGenerationPlan).toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.action).toBe('write_tests');
    expect(parsed.specId).toBe('APX-DOM-001');
  });

  it('returns spec_not_found when no active spec exists', async () => {
    const { server, pool } = newServerAndPool();
    registerGenerateTestsTool(server, pool);
    // @ts-expect-error -- private registry access
    const tool = server._registeredTools['generate_tests'];
    const result = await tool.handler({ spec_id: 'APX-DOM-999' }, {} as never);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.action).toBe('spec_not_found');
  });
});

describe('validate_coverage tool', () => {
  it('forwards args to validateCoverage', async () => {
    const { server, pool } = newServerAndPool();
    registerValidateCoverageTool(server, pool);
    // @ts-expect-error -- private registry access
    const tool = server._registeredTools['validate_coverage'];
    const result = await tool.handler({ project_path: '/p', coverage_percent: 85 }, {} as never);
    expect(validateCoverage).toHaveBeenCalledWith(pool, { projectPath: '/p', coveragePercent: 85, threshold: undefined });
    expect(JSON.parse(result.content[0].text as string).pass).toBe(true);
  });
});

describe('request_review tool', () => {
  it('returns the routing directive and logs a decision', async () => {
    const { server, pool } = newServerAndPool();
    registerRequestReviewTool(server, pool);
    // @ts-expect-error -- private registry access
    const tool = server._registeredTools['request_review'];
    const result = await tool.handler({ project_path: '/p', risk_level: 'critical', files: ['a.ts'] }, {} as never);
    expect(requestReviewDirective).toHaveBeenCalledWith('critical', ['a.ts']);
    expect(recordDecision).toHaveBeenCalled();
    expect(JSON.parse(result.content[0].text as string).action).toBe('invoke_agent');
  });
});

describe('trace_artifact tool', () => {
  it('forwards args to recordTraceabilityEdge', async () => {
    const { server, pool } = newServerAndPool();
    registerTraceArtifactTool(server, pool);
    // @ts-expect-error -- private registry access
    const tool = server._registeredTools['trace_artifact'];
    const result = await tool.handler(
      { project_path: '/p', from_type: 'test', from_id: 'a.test.ts', to_type: 'spec', to_id: '1' },
      {} as never,
    );
    expect(recordTraceabilityEdge).toHaveBeenCalledWith(pool, {
      projectPath: '/p',
      fromType: 'test',
      fromId: 'a.test.ts',
      toType: 'spec',
      toId: '1',
    });
    expect(JSON.parse(result.content[0].text as string).stale).toBe(false);
  });
});

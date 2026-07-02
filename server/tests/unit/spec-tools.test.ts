import type { Pool } from 'pg';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@harness-os/core', () => ({
  SPEC_TYPES: ['product', 'domain', 'api', 'data', 'infra'],
  createSpec: vi.fn(async (_pool: unknown, input: Record<string, unknown>) => ({
    id: 1,
    specId: input.specId,
    version: 1,
    status: 'active',
  })),
  validateSpecContent: vi.fn(async () => ({ valid: true, errors: [] })),
  impactAnalysis: vi.fn(async () => [{ id: 2, specId: 'APX-API-001' }]),
  SpecValidationError: class SpecValidationError extends Error {
    constructor(public errors: string[]) {
      super('invalid');
    }
  },
}));

import { registerCreateSpecTool } from '../../src/tools/create-spec.js';
import { registerValidateSpecTool } from '../../src/tools/validate-spec.js';
import { registerImpactAnalysisTool } from '../../src/tools/impact-analysis.js';
import { createSpec, impactAnalysis, SpecValidationError, validateSpecContent } from '@harness-os/core';

function newServerAndPool(): { server: McpServer; pool: Pool } {
  return { server: new McpServer({ name: 'test', version: '0.0.0' }), pool: {} as Pool };
}

describe('create_spec tool', () => {
  it('forwards args to createSpec and returns the resulting spec as JSON', async () => {
    const { server, pool } = newServerAndPool();
    registerCreateSpecTool(server, pool);
    // @ts-expect-error -- private registry access, see get-constitution.test.ts
    const tool = server._registeredTools['create_spec'];
    const result = await tool.handler(
      { project_path: '/p', spec_id: 'APX-DOM-001', type: 'domain', title: 'Order', content: { id: 'APX-DOM-001' } },
      {} as never,
    );
    expect(createSpec).toHaveBeenCalledWith(pool, {
      projectPath: '/p',
      specId: 'APX-DOM-001',
      type: 'domain',
      title: 'Order',
      content: { id: 'APX-DOM-001' },
    });
    expect(JSON.parse(result.content[0].text as string).status).toBe('active');
  });

  it('returns a fix_spec_content directive, not a thrown error, when validation fails', async () => {
    const { server, pool } = newServerAndPool();
    vi.mocked(createSpec).mockRejectedValueOnce(new SpecValidationError(['(root) must have required property title']));
    registerCreateSpecTool(server, pool);
    // @ts-expect-error -- private registry access
    const tool = server._registeredTools['create_spec'];
    const result = await tool.handler(
      { project_path: '/p', spec_id: 'APX-DOM-001', type: 'domain', title: 'Order', content: {} },
      {} as never,
    );
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.action).toBe('fix_spec_content');
    expect(parsed.errors).toContain('(root) must have required property title');
  });
});

describe('validate_spec tool', () => {
  it('forwards type/content to validateSpecContent', async () => {
    const { server } = newServerAndPool();
    registerValidateSpecTool(server);
    // @ts-expect-error -- private registry access
    const tool = server._registeredTools['validate_spec'];
    const result = await tool.handler({ type: 'domain', content: { id: 'APX-DOM-001' } }, {} as never);
    expect(validateSpecContent).toHaveBeenCalledWith('domain', { id: 'APX-DOM-001' });
    expect(JSON.parse(result.content[0].text as string).valid).toBe(true);
  });
});

describe('impact_analysis tool', () => {
  it('forwards spec_id to impactAnalysis', async () => {
    const { server, pool } = newServerAndPool();
    registerImpactAnalysisTool(server, pool);
    // @ts-expect-error -- private registry access
    const tool = server._registeredTools['impact_analysis'];
    const result = await tool.handler({ spec_id: 'APX-DOM-001' }, {} as never);
    expect(impactAnalysis).toHaveBeenCalledWith(pool, 'APX-DOM-001');
    expect(JSON.parse(result.content[0].text as string)).toEqual([{ id: 2, specId: 'APX-API-001' }]);
  });
});

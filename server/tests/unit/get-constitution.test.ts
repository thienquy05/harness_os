import type { Pool } from 'pg';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@harness-os/core', () => ({
  getConstitution: vi.fn(async (_pool: unknown, options?: { projectPath?: string }) => ({
    version: '1.0.0',
    rules: [
      {
        ruleId: 'CONST-CORE-001',
        domain: 'core',
        text: 'stub rule',
        severity: 'critical',
        enforcement: 'gate',
      },
    ],
    __calledWithProjectPath: options?.projectPath,
  })),
}));

import { registerGetConstitutionTool } from '../../src/tools/get-constitution.js';
import { getConstitution } from '@harness-os/core';

describe('get_constitution tool', () => {
  it('registers a tool named get_constitution that returns the constitution as JSON text', async () => {
    const server = new McpServer({ name: 'harness-os-test', version: '0.0.0' });
    const fakePool = {} as Pool;
    registerGetConstitutionTool(server, fakePool);

    // @ts-expect-error -- reaching into the private registry is the simplest
    // way to invoke a registered tool's handler directly in a unit test.
    const registered = server._registeredTools['get_constitution'];
    expect(registered).toBeDefined();

    const result = await registered.handler({ project_path: '/fake/project' }, {} as never);
    expect(getConstitution).toHaveBeenCalledWith(fakePool, { projectPath: '/fake/project' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.version).toBe('1.0.0');
    expect(parsed.rules[0].ruleId).toBe('CONST-CORE-001');
  });

  it('calls getConstitution without a projectPath when none is given', async () => {
    const server = new McpServer({ name: 'harness-os-test', version: '0.0.0' });
    const fakePool = {} as Pool;
    registerGetConstitutionTool(server, fakePool);

    // @ts-expect-error -- see above
    const registered = server._registeredTools['get_constitution'];
    await registered.handler({}, {} as never);
    expect(getConstitution).toHaveBeenCalledWith(fakePool, { projectPath: undefined });
  });
});

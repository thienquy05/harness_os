import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveProjectFsPath } from './project-path.js';

describe('resolveProjectFsPath', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes the path through unchanged when not running in the translating container', () => {
    expect(resolveProjectFsPath('/home/lehoa/projects/ApexTrade')).toBe('/home/lehoa/projects/ApexTrade');
  });

  it('translates a host path to its container-local workspaces path when both env vars are set', () => {
    vi.stubEnv('HARNESS_WORKSPACES_ROOT', '/workspaces');
    vi.stubEnv('HARNESS_HOST_PROJECTS_ROOT', '/home/lehoa/projects');
    expect(resolveProjectFsPath('/home/lehoa/projects/ApexTrade')).toBe('/workspaces/ApexTrade');
  });

  it('throws when the project path is outside the configured projects root', () => {
    vi.stubEnv('HARNESS_WORKSPACES_ROOT', '/workspaces');
    vi.stubEnv('HARNESS_HOST_PROJECTS_ROOT', '/home/lehoa/projects');
    expect(() => resolveProjectFsPath('/etc/passwd')).toThrow(/outside the configured projects root/);
  });
});

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyFile, readHarnessConfig } from './harness-config.js';

describe('readHarnessConfig', () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'harness-os-config-'));
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  it('parses gatedGlobs, exemptGlobs, testGlobs, and testCommands from .claude/harness.config.json', async () => {
    await mkdir(join(projectPath, '.claude'), { recursive: true });
    await writeFile(
      join(projectPath, '.claude', 'harness.config.json'),
      JSON.stringify({
        gatedGlobs: ['src/**/*.ts'],
        exemptGlobs: ['**/*.md'],
        testGlobs: ['**/*.test.ts'],
        testCommands: [{ globs: ['**/*.ts'], command: 'npm test' }],
      }),
    );

    const config = await readHarnessConfig(projectPath);
    expect(config.gatedGlobs).toEqual(['src/**/*.ts']);
    expect(config.exemptGlobs).toEqual(['**/*.md']);
    expect(config.testGlobs).toEqual(['**/*.test.ts']);
    expect(config.testCommands).toEqual([{ globs: ['**/*.ts'], command: 'npm test' }]);
  });

  it('defaults every field to an empty array when absent from the config file', async () => {
    await mkdir(join(projectPath, '.claude'), { recursive: true });
    await writeFile(join(projectPath, '.claude', 'harness.config.json'), '{}');

    const config = await readHarnessConfig(projectPath);
    expect(config).toEqual({ gatedGlobs: [], exemptGlobs: [], testGlobs: [], testCommands: [] });
  });
});

describe('classifyFile', () => {
  const config = {
    gatedGlobs: ['src/**/*.ts'],
    exemptGlobs: ['**/*.md'],
    testGlobs: ['**/*.test.ts'],
    testCommands: [],
  };

  it('classifies a file matching exemptGlobs as exempt, even if it also matches gatedGlobs', () => {
    expect(classifyFile(config, 'README.md')).toBe('exempt');
  });

  it('classifies a file matching testGlobs as test, taking priority over gatedGlobs', () => {
    expect(classifyFile({ ...config, gatedGlobs: ['src/**/*.test.ts'] }, 'src/foo.test.ts')).toBe('test');
  });

  it('classifies a file matching gatedGlobs (and nothing higher-priority) as gated', () => {
    expect(classifyFile(config, 'src/foo.ts')).toBe('gated');
  });

  it('classifies a file matching none of the globs as ungated', () => {
    expect(classifyFile(config, 'docs/notes.txt')).toBe('ungated');
  });

  it('classifies every file as ungated when gatedGlobs is empty', () => {
    expect(classifyFile({ ...config, gatedGlobs: [] }, 'src/foo.ts')).toBe('ungated');
  });
});

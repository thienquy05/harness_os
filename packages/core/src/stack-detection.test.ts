import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildScaffoldDefaults, detectStack } from './stack-detection.js';

describe('detectStack', () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'harness-os-stack-'));
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  it('returns unknown with no frameworks when no manifest file exists', async () => {
    const stack = await detectStack(projectPath);
    expect(stack).toEqual({ language: 'unknown', frameworks: [] });
  });

  it('detects node from package.json', async () => {
    await writeFile(join(projectPath, 'package.json'), JSON.stringify({ dependencies: {} }));
    const stack = await detectStack(projectPath);
    expect(stack.language).toBe('node');
  });

  it('detects the react framework from package.json dependencies', async () => {
    await writeFile(
      join(projectPath, 'package.json'),
      JSON.stringify({ dependencies: { react: '^18.3.0' } }),
    );
    const stack = await detectStack(projectPath);
    expect(stack.language).toBe('node');
    expect(stack.frameworks).toContain('react');
  });

  it('detects typescript from a devDependency plus tsconfig.json', async () => {
    await writeFile(
      join(projectPath, 'package.json'),
      JSON.stringify({ devDependencies: { typescript: '^5.0.0' } }),
    );
    await writeFile(join(projectPath, 'tsconfig.json'), '{}');
    const stack = await detectStack(projectPath);
    expect(stack.frameworks).toContain('typescript');
  });

  it('detects python from pyproject.toml', async () => {
    await writeFile(join(projectPath, 'pyproject.toml'), '[project]\nname = "x"\n');
    const stack = await detectStack(projectPath);
    expect(stack.language).toBe('python');
  });

  it('detects fastapi from pyproject.toml content', async () => {
    await writeFile(join(projectPath, 'pyproject.toml'), 'fastapi = "^0.110"\n');
    const stack = await detectStack(projectPath);
    expect(stack.frameworks).toContain('fastapi');
  });

  it('detects django from requirements.txt content', async () => {
    await writeFile(join(projectPath, 'requirements.txt'), 'Django==5.0\n');
    const stack = await detectStack(projectPath);
    expect(stack.language).toBe('python');
    expect(stack.frameworks).toContain('django');
  });

  it('detects go from go.mod', async () => {
    await writeFile(join(projectPath, 'go.mod'), 'module example.com/x\n');
    const stack = await detectStack(projectPath);
    expect(stack.language).toBe('go');
  });

  it('detects rust from Cargo.toml', async () => {
    await writeFile(join(projectPath, 'Cargo.toml'), '[package]\nname = "x"\n');
    const stack = await detectStack(projectPath);
    expect(stack.language).toBe('rust');
  });

  it('detects a database signal from .sql files under db/', async () => {
    await writeFile(join(projectPath, 'package.json'), JSON.stringify({ dependencies: {} }));
    await mkdir(join(projectPath, 'db', 'init'), { recursive: true });
    await writeFile(join(projectPath, 'db', 'init', '0001_init.sql'), 'CREATE TABLE x();');
    const stack = await detectStack(projectPath);
    expect(stack.frameworks).toContain('database');
  });
});

describe('buildScaffoldDefaults', () => {
  it('always includes the cross-cutting reviewers regardless of stack', () => {
    const defaults = buildScaffoldDefaults({ language: 'unknown', frameworks: [] });
    expect(defaults.reviewers).toEqual(expect.arrayContaining(['code-reviewer', 'tdd-guide', 'architect']));
  });

  it('maps node+typescript to typescript-reviewer and a ts glob/test command', () => {
    const defaults = buildScaffoldDefaults({ language: 'node', frameworks: ['typescript'] });
    expect(defaults.reviewers).toContain('typescript-reviewer');
    expect(defaults.harnessConfig.gatedGlobs).toEqual(['src/**/*.ts', 'src/**/*.tsx']);
    expect(defaults.harnessConfig.testCommands).toEqual([
      { globs: ['**/*.ts', '**/*.tsx'], command: 'npm test' },
    ]);
  });

  it('adds react-reviewer when react is detected', () => {
    const defaults = buildScaffoldDefaults({ language: 'node', frameworks: ['typescript', 'react'] });
    expect(defaults.reviewers).toContain('react-reviewer');
  });

  it('maps python to python-reviewer and a pytest command', () => {
    const defaults = buildScaffoldDefaults({ language: 'python', frameworks: [] });
    expect(defaults.reviewers).toContain('python-reviewer');
    expect(defaults.harnessConfig.gatedGlobs).toEqual(['**/*.py']);
    expect(defaults.harnessConfig.testCommands).toEqual([{ globs: ['**/*.py'], command: 'pytest' }]);
  });

  it('adds fastapi-reviewer when fastapi is detected', () => {
    const defaults = buildScaffoldDefaults({ language: 'python', frameworks: ['fastapi'] });
    expect(defaults.reviewers).toContain('fastapi-reviewer');
  });

  it('adds django-reviewer when django is detected', () => {
    const defaults = buildScaffoldDefaults({ language: 'python', frameworks: ['django'] });
    expect(defaults.reviewers).toContain('django-reviewer');
  });

  it('maps go to go-reviewer and a go test command', () => {
    const defaults = buildScaffoldDefaults({ language: 'go', frameworks: [] });
    expect(defaults.reviewers).toContain('go-reviewer');
    expect(defaults.harnessConfig.testCommands).toEqual([{ globs: ['**/*.go'], command: 'go test ./...' }]);
  });

  it('maps rust to rust-reviewer and a cargo test command', () => {
    const defaults = buildScaffoldDefaults({ language: 'rust', frameworks: [] });
    expect(defaults.reviewers).toContain('rust-reviewer');
    expect(defaults.harnessConfig.testCommands).toEqual([{ globs: ['**/*.rs'], command: 'cargo test' }]);
  });

  it('adds database-reviewer when the database framework signal is present', () => {
    const defaults = buildScaffoldDefaults({ language: 'node', frameworks: ['database'] });
    expect(defaults.reviewers).toContain('database-reviewer');
  });

  it('falls back to generic mixed placeholder globs for an unknown stack', () => {
    const defaults = buildScaffoldDefaults({ language: 'unknown', frameworks: [] });
    expect(defaults.harnessConfig.gatedGlobs.length).toBeGreaterThan(0);
    expect(defaults.reviewers).not.toContain('typescript-reviewer');
  });
});

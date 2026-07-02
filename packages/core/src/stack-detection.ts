import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { HarnessConfig } from './harness-config.js';

export type StackLanguage = 'node' | 'python' | 'go' | 'rust' | 'unknown';

export interface DetectedStack {
  language: StackLanguage;
  frameworks: string[];
}

async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return undefined;
  }
}

async function hasSqlFileUnder(dirPath: string): Promise<boolean> {
  try {
    const entries = await readdir(dirPath, { recursive: true });
    return entries.some((entry) => entry.toString().endsWith('.sql'));
  } catch {
    return false;
  }
}

/**
 * Lightweight, dependency-free stack detection — a headless CLI can't invoke
 * the ECC `project-init` skill, so this reimplements just enough of its
 * manifest-sniffing to pick sensible harness.config.json defaults (plan §7).
 */
export async function detectStack(projectPath: string): Promise<DetectedStack> {
  const frameworks: string[] = [];
  let language: StackLanguage = 'unknown';

  const packageJson = await readIfExists(join(projectPath, 'package.json'));
  if (packageJson) {
    language = 'node';
    const parsed = JSON.parse(packageJson) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...parsed.dependencies, ...parsed.devDependencies };
    if (allDeps.react) frameworks.push('react');
    if (allDeps.typescript && (await readIfExists(join(projectPath, 'tsconfig.json')))) {
      frameworks.push('typescript');
    }
  }

  const pyproject = await readIfExists(join(projectPath, 'pyproject.toml'));
  const requirements = await readIfExists(join(projectPath, 'requirements.txt'));
  if (pyproject || requirements) {
    language = 'python';
    const combined = `${pyproject ?? ''}\n${requirements ?? ''}`.toLowerCase();
    if (combined.includes('fastapi')) frameworks.push('fastapi');
    if (combined.includes('django')) frameworks.push('django');
  }

  if (await readIfExists(join(projectPath, 'go.mod'))) {
    language = 'go';
  }

  if (await readIfExists(join(projectPath, 'Cargo.toml'))) {
    language = 'rust';
  }

  if (await hasSqlFileUnder(join(projectPath, 'db'))) {
    frameworks.push('database');
  }

  return { language, frameworks };
}

export interface ScaffoldDefaults {
  harnessConfig: HarnessConfig;
  reviewers: string[];
}

const CROSS_CUTTING_REVIEWERS = ['code-reviewer', 'tdd-guide', 'architect'];

const FALLBACK_HARNESS_CONFIG: HarnessConfig = {
  gatedGlobs: ['src/**/*.ts', 'src/**/*.tsx'],
  exemptGlobs: ['**/*.md', '**/*.lock', '**/package-lock.json', '**/*.json'],
  testGlobs: ['**/*.test.ts', '**/*.spec.ts'],
  testCommands: [
    { globs: ['**/*.py'], command: 'pytest' },
    { globs: ['**/*.ts', '**/*.tsx'], command: 'npm test' },
  ],
};

/**
 * Pure mapping from a detected stack to scaffold defaults — every reviewer
 * name here already exists in the ECC agent roster (§1.3's checkpoint asked
 * for ApexTrade-specific reviewer names; this generalizes that idea into a
 * mechanical stack->known-agent-name table instead, since harness-init.ts
 * runs against any project, not just ApexTrade).
 */
export function buildScaffoldDefaults(stack: DetectedStack): ScaffoldDefaults {
  const reviewers = new Set<string>(CROSS_CUTTING_REVIEWERS);
  let harnessConfig: HarnessConfig = FALLBACK_HARNESS_CONFIG;

  if (stack.language === 'node') {
    reviewers.add('typescript-reviewer');
    harnessConfig = {
      gatedGlobs: ['src/**/*.ts', 'src/**/*.tsx'],
      exemptGlobs: ['**/*.md', '**/*.lock', '**/package-lock.json', '**/*.json'],
      testGlobs: ['**/*.test.ts', '**/*.spec.ts'],
      testCommands: [{ globs: ['**/*.ts', '**/*.tsx'], command: 'npm test' }],
    };
    if (stack.frameworks.includes('react')) reviewers.add('react-reviewer');
  } else if (stack.language === 'python') {
    reviewers.add('python-reviewer');
    harnessConfig = {
      gatedGlobs: ['**/*.py'],
      exemptGlobs: ['**/*.md', '**/*.lock', '**/requirements.txt'],
      testGlobs: ['**/test_*.py', '**/*_test.py'],
      testCommands: [{ globs: ['**/*.py'], command: 'pytest' }],
    };
    if (stack.frameworks.includes('fastapi')) reviewers.add('fastapi-reviewer');
    if (stack.frameworks.includes('django')) reviewers.add('django-reviewer');
  } else if (stack.language === 'go') {
    reviewers.add('go-reviewer');
    harnessConfig = {
      gatedGlobs: ['**/*.go'],
      exemptGlobs: ['**/*.md', '**/go.sum'],
      testGlobs: ['**/*_test.go'],
      testCommands: [{ globs: ['**/*.go'], command: 'go test ./...' }],
    };
  } else if (stack.language === 'rust') {
    reviewers.add('rust-reviewer');
    harnessConfig = {
      gatedGlobs: ['src/**/*.rs'],
      exemptGlobs: ['**/*.md', '**/Cargo.lock'],
      testGlobs: ['tests/**/*.rs'],
      testCommands: [{ globs: ['**/*.rs'], command: 'cargo test' }],
    };
  }

  if (stack.frameworks.includes('database')) reviewers.add('database-reviewer');

  return { harnessConfig, reviewers: [...reviewers] };
}

import { spawnSync } from 'node:child_process';
import { chmod, cp, link, lstat, mkdir, mkdtemp, readFile, rm, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The real scaffold hook scripts, run the way Claude Code runs them: JSON payload on stdin, from the
// governed project's own .claude/hooks copy. `docker` is a stub on PATH that logs its arguments and
// answers gate-check with STUB_GATE_EXIT (a file's RED gate) or STUB_INTEGRITY_EXIT (no file: config
// integrity only). Findings from the Codex review of the Vegenus scaffold
// (2026-10-29): Bash writes skipped the gate, a missing `timeout` recorded false RED runs, and the
// post-Bash backstop discarded config edits that existed before the call.
const SCAFFOLD_CLAUDE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scaffold', '.claude');

const CONFIG = {
  gatedGlobs: ['src/**/*.ts'],
  exemptGlobs: ['**/*.md'],
  testGlobs: ['**/*.test.ts'],
  testCommands: [
    { globs: ['**/*.ts'], command: 'false' },
    { globs: ['**/*.ts'], command: 'sleep 5' },
    { globs: ['**/*.ts'], command: 'no-such-test-runner' },
    { globs: ['**/*.ts'], command: 'exit 0' },
    { globs: ['**/*.ts'], command: 'bash spawn.sh' },
    { globs: ['**/*.ts'], command: 'bash spawn-stubborn.sh' },
    { globs: ['**/*.ts'], command: 'echo test-output-marker && false' },
  ],
};

const STUB_DOCKER = `#!/bin/bash
printf '%s\\n' "$*" >> "$STUB_LOG"
case "$*" in
  *"--mode record-test-run"*) echo '{"recorded":true}'; exit "\${STUB_RECORD_EXIT:-0}" ;;
  *gate-check.js*--file*) echo '{"pass":false}'; exit "\${STUB_GATE_EXIT:-0}" ;;
  *gate-check.js*) echo '{"action":"reconcile_config"}'; exit "\${STUB_INTEGRITY_EXIT:-0}" ;;
esac
exit 0
`;

let project: string;
let bin: string;
let log: string;

const git = (...args: string[]) => gitWith({}, ...args);
const gitWith = (env: Record<string, string>, ...args: string[]) => {
  const r = spawnSync('git', args, { cwd: project, encoding: 'utf8', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

// `cwd` is the shell's folder Claude Code reports in the payload; it keeps a `cd` between Bash calls,
// so it can be any subfolder of the project, and the Pre and Post hooks of one call can see different ones.
function hook(script: string, event: string, command: string, id: string, env: Record<string, string> = {}, cwd = project) {
  const payload = { hook_event_name: event, session_id: 's', cwd, tool_name: 'Bash', tool_input: { command }, tool_use_id: id };
  return runHook(script, payload, env, cwd);
}

function runHook(script: string, payload: object, env: Record<string, string>, cwd: string) {
  return spawnSync('bash', [join(project, '.claude', 'hooks', script)], {
    input: JSON.stringify(payload),
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_LOG: log, ...env },
  });
}

const stubCalls = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean);
const configPath = () => join(project, '.claude', 'harness.config.json');

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'harness-os-hooks-'));
  bin = await mkdtemp(join(tmpdir(), 'harness-os-bin-'));
  log = join(bin, 'docker.log');
  await writeFile(join(bin, 'docker'), STUB_DOCKER);
  await chmod(join(bin, 'docker'), 0o755);

  await cp(SCAFFOLD_CLAUDE, join(project, '.claude'), { recursive: true });
  await writeFile(configPath(), `${JSON.stringify(CONFIG, null, 2)}\n`);
  await mkdir(join(project, 'src'));
  await writeFile(join(project, 'src', 'a.ts'), 'export const a = 1;\n');
  git('init', '-q');
  git('config', 'user.email', 'test@example.test');
  git('config', 'user.name', 'test');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
});

afterEach(async () => {
  await rm(project, { recursive: true, force: true });
  await rm(bin, { recursive: true, force: true });
});

describe('enforce-gate.sh test runs', () => {
  it('records a real test failure', async () => {
    const r = hook('enforce-gate.sh', 'PreToolUse', 'false', 't1');
    expect(r.status).toBe(2);
    expect((await stubCalls()).filter((c) => c.includes('--mode record-test-run'))).toEqual([
      expect.stringMatching(/--exit-code 1$/),
    ]);
  });

  // The hook already ran the suite; letting Claude's identical call run it again doubled every test run.
  it('runs a recorded test command once: blocks the duplicate and hands Claude the result', async () => {
    const r = hook('enforce-gate.sh', 'PreToolUse', 'echo test-output-marker && false', 't10');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('exit 1');
    expect(r.stderr).toContain('not run a second time');
    expect(r.stderr).toContain('test-output-marker');
    const logPath = /full output: (\S+)/.exec(r.stderr)?.[1] ?? '';
    expect(await readFile(logPath, 'utf8')).toContain('test-output-marker');
    await rm(logPath, { force: true });
  });

  it('does not record a test command that could not run (exit 127)', async () => {
    const r = hook('enforce-gate.sh', 'PreToolUse', 'no-such-test-runner', 't2');
    expect(r.status).toBe(0);
    expect((await stubCalls()).filter((c) => c.includes('--mode record-test-run'))).toEqual([]);
    expect(r.stderr).toContain('did not complete');
  });

  // A pipeline's exit code is its last command's: `npm test | tail` hid a failing suite (false GREEN) and
  // `npm test | grep -q x` turned a passing one into a RED that opened the gate. Only the configured
  // command, or it plus plain arguments, is run and recorded.
  const recorded = async () => (await stubCalls()).filter((c) => c.includes('--mode record-test-run'));

  it('records the failure of a test command piped into another command', async () => {
    hook('enforce-gate.sh', 'PreToolUse', 'false | cat', 't5');
    expect(await recorded()).toEqual([expect.stringMatching(/--command false --exit-code 1$/)]);
  });

  it('cannot record a fake RED by piping a passing test command into a failing filter', async () => {
    hook('enforce-gate.sh', 'PreToolUse', 'exit 0 | grep -q nothing', 't6');
    expect(await recorded()).toEqual([expect.stringMatching(/--command exit 0 --exit-code 0$/)]);
  });

  it('cannot mask a failure with a command list', async () => {
    hook('enforce-gate.sh', 'PreToolUse', 'false || true', 't7');
    expect(await recorded()).toEqual([expect.stringMatching(/--command false --exit-code 1$/)]);
  });

  it('keeps arguments that are existing paths', async () => {
    hook('enforce-gate.sh', 'PreToolUse', 'false -- src', 't8');
    expect(await recorded()).toEqual([expect.stringMatching(/--command false -- src --exit-code 1$/)]);
  });

  // Any other argument can make a passing command fail without a failing test (a missing path, an
  // unknown flag), or write files outside the gate (-u, --outputFile): run the bare command instead.
  it('cannot record a fake RED through an argument that is not an existing path', async () => {
    hook('enforce-gate.sh', 'PreToolUse', 'exit 0 no-such-file', 't11');
    expect(await recorded()).toEqual([expect.stringMatching(/--command exit 0 --exit-code 0$/)]);
  });

  it('keeps the path arguments before a pipe', async () => {
    hook('enforce-gate.sh', 'PreToolUse', 'false src 2>&1 | tail -5', 't12');
    expect(await recorded()).toEqual([expect.stringMatching(/--command false src --exit-code 1$/)]);
  });

  it('tells Claude when the rest of a chained command was not run', async () => {
    const r = hook('enforce-gate.sh', 'PreToolUse', 'false && echo built', 't13');
    expect(r.stderr).toContain('was NOT run');
    expect(r.stderr).toContain('&& echo built');
  });

  it('says plainly when the result could not be recorded', async () => {
    const r = hook('enforce-gate.sh', 'PreToolUse', 'false', 't14', { STUB_RECORD_EXIT: '1' });
    expect(r.stderr).toContain('NOT recorded');
  });

  it('reuses one log file per project instead of leaving one per run', async () => {
    const path = (r: { stderr: string }) => /full output: (\S+)/.exec(r.stderr)?.[1];
    const first = path(hook('enforce-gate.sh', 'PreToolUse', 'false', 't15'));
    const second = path(hook('enforce-gate.sh', 'PreToolUse', 'false', 't16'));
    expect(first).toBeDefined();
    expect(second).toBe(first);
    await rm(first as string, { force: true });
  });

  it('kills children that ignore TERM after the test command exits', async () => {
    await writeFile(join(project, 'spawn-stubborn.sh'), 'bash -c \'trap "" TERM; sleep 30\' & echo $! > child.pid\nexit 1\n');
    hook('enforce-gate.sh', 'PreToolUse', 'bash spawn-stubborn.sh', 't17');
    const child = Number((await readFile(join(project, 'child.pid'), 'utf8')).trim());
    await new Promise((r) => setTimeout(r, 300));
    const alive = (() => { try { process.kill(child, 0); return true; } catch { return false; } })();
    if (alive) process.kill(child, 'SIGKILL');
    expect(alive).toBe(false);
  });

  it('stops the processes a test command started when it hits the time limit', async () => {
    await writeFile(join(project, 'spawn.sh'), 'sleep 30 & echo $! > child.pid\nsleep 30\n');
    hook('enforce-gate.sh', 'PreToolUse', 'bash spawn.sh', 't9', { HARNESS_TEST_TIMEOUT_SECONDS: '1' });
    const child = Number((await readFile(join(project, 'child.pid'), 'utf8')).trim());
    const alive = (() => { try { process.kill(child, 0); return true; } catch { return false; } })();
    if (alive) process.kill(child, 'SIGKILL');
    expect(alive).toBe(false);
  });

  it('stops a test command at the time limit without recording it, with no `timeout` binary needed', async () => {
    const started = Date.now();
    const r = hook('enforce-gate.sh', 'PreToolUse', 'sleep 5', 't3', { HARNESS_TEST_TIMEOUT_SECONDS: '1' });
    expect(Date.now() - started).toBeLessThan(4000);
    expect(r.status).toBe(0);
    expect((await stubCalls()).filter((c) => c.includes('--mode record-test-run'))).toEqual([]);
    expect(r.stderr).toContain('did not complete');
  });
});

describe('post-bash-revert.sh', () => {
  it('keeps a config edit that existed before the Bash call', async () => {
    const edited = `${JSON.stringify({ ...CONFIG, gatedGlobs: ['src/**/*.ts', 'db/*.sql'] }, null, 2)}\n`;
    await writeFile(configPath(), edited);
    expect(hook('enforce-gate.sh', 'PreToolUse', 'ls', 'p1').status).toBe(0);
    const r = hook('post-bash-revert.sh', 'PostToolUse', 'ls', 'p1');
    expect(r.status).toBe(0);
    expect(await readFile(configPath(), 'utf8')).toBe(edited);
  });

  // The content found after the call may be another actor's concurrent edit (Codex, round 2): it is
  // kept in quarantine before the restore, so nothing is lost, and the restore is reported.
  it('restores a config file changed during the call when integrity fails, keeping what it found', async () => {
    const before = `${JSON.stringify({ ...CONFIG, gatedGlobs: ['src/**/*.ts', 'db/*.sql'] }, null, 2)}\n`;
    await writeFile(configPath(), before);
    expect(hook('enforce-gate.sh', 'PreToolUse', 'node -e tamper', 'p2').status).toBe(0);
    await writeFile(configPath(), '{"gatedGlobs":["concurrent edit"]}\n');
    const r = hook('post-bash-revert.sh', 'PostToolUse', 'node -e tamper', 'p2', { STUB_INTEGRITY_EXIT: '1' });
    expect(r.status).toBe(2);
    expect(await readFile(configPath(), 'utf8')).toBe(before);
    expect(r.stderr).toContain('harness.config.json');
    expect((await stubCalls()).some((c) => c.includes('log-revert.js'))).toBe(true);
    const kept = r.stderr.match(/kept at (\S+)/)?.[1];
    expect(kept && (await readFile(kept, 'utf8'))).toBe('{"gatedGlobs":["concurrent edit"]}\n');
  });

  // Codex, round 5: snapshots are raw bytes, so a line-ending change is seen and a restore is exact.
  it('restores the exact bytes of a CRLF config file, with core.autocrlf on', async () => {
    git('config', 'core.autocrlf', 'true');
    const crlf = '{\r\n  "gatedGlobs": ["src/**/*.ts"]\r\n}\r\n';
    await writeFile(configPath(), crlf);
    expect(hook('enforce-gate.sh', 'PreToolUse', 'node -e eol', 'p2c').status).toBe(0);
    await writeFile(configPath(), crlf.replace(/\r\n/g, '\n'));
    const r = hook('post-bash-revert.sh', 'PostToolUse', 'node -e eol', 'p2c', { STUB_INTEGRITY_EXIT: '1' });
    expect(r.status).toBe(2);
    expect(await readFile(configPath(), 'utf8')).toBe(crlf);
  });

  // Codex, round 6: a restore never writes through a symlink the call put in place of a config file.
  it('replaces a symlinked config file without touching the link target', async () => {
    const original = await readFile(configPath(), 'utf8');
    const outside = join(bin, 'outside.txt');
    await writeFile(outside, 'not yours\n');
    expect(hook('enforce-gate.sh', 'PreToolUse', 'ln -sf', 'p2d').status).toBe(0);
    await unlink(configPath());
    await symlink(outside, configPath());
    const r = hook('post-bash-revert.sh', 'PostToolUse', 'ln -sf', 'p2d', { STUB_INTEGRITY_EXIT: '1' });
    expect(r.status).toBe(2);
    expect(await readFile(outside, 'utf8')).toBe('not yours\n');
    expect((await lstat(configPath())).isSymbolicLink()).toBe(false);
    expect(await readFile(configPath(), 'utf8')).toBe(original);
  });

  it('does not restore into a hooks folder that became a symlink to somewhere else', async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), 'harness-os-outside-'));
    expect(hook('enforce-gate.sh', 'PreToolUse', 'swap dir', 'p2e').status).toBe(0);
    const claudeDir = join(project, '.claude');
    await cp(claudeDir, join(outsideDir, 'copy'), { recursive: true });
    await writeFile(join(outsideDir, 'copy', 'harness.config.json'), 'outside\n');
    await rm(claudeDir, { recursive: true, force: true });
    await symlink(join(outsideDir, 'copy'), claudeDir);
    const r = hook('post-bash-revert.sh', 'PostToolUse', 'swap dir', 'p2e', { STUB_INTEGRITY_EXIT: '1' });
    expect(await readFile(join(outsideDir, 'copy', 'harness.config.json'), 'utf8')).toBe('outside\n');
    expect(r.stderr).toContain('not restored');
    await rm(outsideDir, { recursive: true, force: true });
  });

  // Codex, round 7: a config file that already is a symlink could hide writes to its target, so Bash
  // is refused until a human puts a regular file back.
  it('refuses Bash while a config file is a symlink', async () => {
    const outside = join(bin, 'config-elsewhere.json');
    await writeFile(outside, await readFile(configPath(), 'utf8'));
    await unlink(configPath());
    await symlink(outside, configPath());
    const r = hook('enforce-gate.sh', 'PreToolUse', 'ls', 'p2f');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('symlink');
  });

  it('flags a write through a gated file that already was a symlink', async () => {
    await writeFile(join(project, 'src', 'target.ts'), 'export const t = 1;\n');
    await symlink('target.ts', join(project, 'src', 'link.ts'));
    git('add', '-A');
    git('commit', '-q', '-m', 'link');
    expect(hook('enforce-gate.sh', 'PreToolUse', 'node -e write-through', 'p4b').status).toBe(0);
    await writeFile(join(project, 'src', 'link.ts'), 'export const t = 2;\n');
    const r = hook('post-bash-revert.sh', 'PostToolUse', 'node -e write-through', 'p4b', { STUB_GATE_EXIT: '1' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('src/link.ts');
  });

  // Codex, round 8: removing the hook's executable bit changes no content but disables the gate.
  it('puts back a config file mode changed during the call', async () => {
    const hookPath = join(project, '.claude', 'hooks', 'enforce-gate.sh');
    expect(hook('enforce-gate.sh', 'PreToolUse', 'chmod -x', 'p2g').status).toBe(0);
    await chmod(hookPath, 0o644);
    const r = hook('post-bash-revert.sh', 'PostToolUse', 'chmod -x', 'p2g');
    expect(r.status).toBe(2);
    expect((await lstat(hookPath)).mode & 0o111).not.toBe(0);
    expect(r.stderr).toContain('enforce-gate.sh');
  });

  // Codex, round 9: no chmod outside the project through a symlinked folder.
  it('does not change permissions through a .claude folder that became a symlink', async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), 'harness-os-outside-'));
    expect(hook('enforce-gate.sh', 'PreToolUse', 'swap dir', 'p2h').status).toBe(0);
    const claudeDir = join(project, '.claude');
    await cp(claudeDir, join(outsideDir, 'copy'), { recursive: true });
    await chmod(join(outsideDir, 'copy', 'settings.json'), 0o600);
    await rm(claudeDir, { recursive: true, force: true });
    await symlink(join(outsideDir, 'copy'), claudeDir);
    const r = hook('post-bash-revert.sh', 'PostToolUse', 'swap dir', 'p2h');
    expect((await lstat(join(outsideDir, 'copy', 'settings.json'))).mode & 0o777).toBe(0o600);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('outside the project');
    await rm(outsideDir, { recursive: true, force: true });
  });

  // Codex, round 10: a hard link shares one file with the outside, so a restore must not chmod it.
  it('does not change permissions of an outside file through a hard link', async () => {
    const settings = join(project, '.claude', 'settings.json');
    const outside = join(project, '..', `${basename(project)}-outside.json`);
    await writeFile(outside, await readFile(settings, 'utf8'));
    await chmod(outside, 0o600);
    expect(hook('enforce-gate.sh', 'PreToolUse', 'ln outside', 'p2i').status).toBe(0);
    await unlink(settings);
    await link(outside, settings);
    const r = hook('post-bash-revert.sh', 'PostToolUse', 'ln outside', 'p2i');
    expect((await lstat(outside)).mode & 0o777).toBe(0o600);
    expect((await lstat(settings)).nlink).toBe(1);
    expect(r.status).toBe(2);
    await rm(outside, { force: true });
  });

  // Codex, round 11: the restore's temporary file must not be a path someone could have planted.
  it('ignores links planted where a predictable temporary file would go', async () => {
    const hooksDir = join(project, '.claude', 'hooks');
    const hookPath = join(hooksDir, 'enforce-gate.sh');
    const outside = join(bin, 'planted-target.txt');
    await writeFile(outside, 'not yours\n');
    await chmod(outside, 0o600);
    expect(hook('enforce-gate.sh', 'PreToolUse', 'chmod -x', 'p2j').status).toBe(0);
    await chmod(hookPath, 0o644);
    for (let pid = process.pid + 1; pid < process.pid + 3000; pid += 1) {
      await symlink(outside, join(hooksDir, `.enforce-gate.sh.harness-restore-${pid}`));
    }
    hook('post-bash-revert.sh', 'PostToolUse', 'chmod -x', 'p2j');
    expect(await readFile(outside, 'utf8')).toBe('not yours\n');
    expect((await lstat(outside)).mode & 0o777).toBe(0o600);
    expect((await lstat(hookPath)).isSymbolicLink()).toBe(false);
  });

  // Codex, final round: settings.json must not depend on executable bits, or `chmod -x` on the
  // scripts disables the gate and its own recovery. Runs the exact configured hook commands.
  it('keeps gating and recovering after `chmod -x` on every hook script', async () => {
    const settings = JSON.parse(await readFile(join(project, '.claude', 'settings.json'), 'utf8'));
    const command = (event: string) => settings.hooks[event][0].hooks[0].command as string;
    const run = (event: string, cmd: string, id: string) =>
      spawnSync('sh', ['-c', command(event)], {
        input: JSON.stringify({ hook_event_name: event, session_id: 's', cwd: project, tool_name: 'Bash', tool_input: { command: cmd }, tool_use_id: id }),
        cwd: project,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_LOG: log, CLAUDE_PROJECT_DIR: project },
      });
    const hooksDir = join(project, '.claude', 'hooks');
    expect(run('PreToolUse', 'chmod -x .claude/hooks/*.sh', 'p2k').status).toBe(0);
    for (const name of ['enforce-gate.sh', 'post-bash-revert.sh', 'check-harness-infra.sh']) await chmod(join(hooksDir, name), 0o644);
    const post = run('PostToolUse', 'chmod -x .claude/hooks/*.sh', 'p2k');
    expect(post.status).toBe(2);
    expect((await lstat(join(hooksDir, 'enforce-gate.sh'))).mode & 0o111).not.toBe(0);
    expect(run('PreToolUse', 'ls', 'p2l').status).toBe(0);
  });

  it('leaves a config file changed during the call alone when it still verifies', async () => {
    expect(hook('enforce-gate.sh', 'PreToolUse', 'node -e edit', 'p2b').status).toBe(0);
    await writeFile(configPath(), '{"gatedGlobs":["verified elsewhere"]}\n');
    const r = hook('post-bash-revert.sh', 'PostToolUse', 'node -e edit', 'p2b', { STUB_INTEGRITY_EXIT: '0' });
    expect(r.status).toBe(0);
    expect(await readFile(configPath(), 'utf8')).toBe('{"gatedGlobs":["verified elsewhere"]}\n');
  });

  it('also runs after a Bash call that failed (PostToolUseFailure)', async () => {
    expect(hook('enforce-gate.sh', 'PreToolUse', 'node -e tamper; false', 'p3').status).toBe(0);
    const original = await readFile(configPath(), 'utf8');
    await writeFile(configPath(), '{"gatedGlobs":[]}\n');
    hook('post-bash-revert.sh', 'PostToolUseFailure', 'node -e tamper; false', 'p3', { STUB_INTEGRITY_EXIT: '1' });
    expect(await readFile(configPath(), 'utf8')).toBe(original);
    const settings = JSON.parse(await readFile(join(SCAFFOLD_CLAUDE, 'settings.json'), 'utf8'));
    expect(JSON.stringify(settings.hooks.PostToolUseFailure)).toContain('post-bash-revert.sh');
  });

  it('flags a gated file written by an unrecognized Bash write while the gate is closed', async () => {
    expect(hook('enforce-gate.sh', 'PreToolUse', 'node -e write', 'p4').status).toBe(0);
    await writeFile(join(project, 'src', 'a.ts'), 'export const a = 2;\n');
    const r = hook('post-bash-revert.sh', 'PostToolUse', 'node -e write', 'p4', { STUB_GATE_EXIT: '1' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('src/a.ts');
    // Flagged, not reverted: a revert could throw away work.
    expect(await readFile(join(project, 'src', 'a.ts'), 'utf8')).toBe('export const a = 2;\n');
    expect((await stubCalls()).some((c) => c.includes('log-revert.js') && c.includes('--kind gated'))).toBe(true);
  });

  it('does not flag a gated file written while the gate is open', async () => {
    expect(hook('enforce-gate.sh', 'PreToolUse', 'node -e write', 'p5').status).toBe(0);
    await writeFile(join(project, 'src', 'a.ts'), 'export const a = 2;\n');
    const r = hook('post-bash-revert.sh', 'PostToolUse', 'node -e write', 'p5', { STUB_GATE_EXIT: '0' });
    expect(r.status).toBe(0);
  });

  // A checkout or fast-forward pull brings commits that existed before the call; those files are not
  // this call's writes.
  it('leaves gated files alone that a checkout of an existing commit brought', async () => {
    git('checkout', '-q', '-b', 'other');
    await writeFile(join(project, 'src', 'a.ts'), 'export const a = 3;\n');
    git('add', '-A');
    const past = { GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z', GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z' };
    gitWith(past, 'commit', '-q', '-m', 'existing');
    git('checkout', '-q', '-');
    expect(hook('enforce-gate.sh', 'PreToolUse', 'git checkout other', 'p6').status).toBe(0);
    git('checkout', '-q', 'other');
    const r = hook('post-bash-revert.sh', 'PostToolUse', 'git checkout other', 'p6', { STUB_GATE_EXIT: '1' });
    expect(r.status).toBe(0);
  });

  // Codex, round 4: the checkout exemption is per file, so an extra write in the same call is flagged.
  it('flags a gated write made in the same call as a checkout of an existing commit', async () => {
    git('checkout', '-q', '-b', 'other');
    git('commit', '-q', '--allow-empty', '-m', 'existing');
    git('checkout', '-q', '-');
    expect(hook('enforce-gate.sh', 'PreToolUse', 'git checkout other && write', 'p6c').status).toBe(0);
    git('checkout', '-q', 'other');
    await writeFile(join(project, 'src', 'a.ts'), 'export const a = 6;\n');
    const r = hook('post-bash-revert.sh', 'PostToolUse', 'git checkout other && write', 'p6c', { STUB_GATE_EXIT: '1' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('src/a.ts');
  });

  // Codex, round 4: a backdated commit made in the call is still the call's own work.
  it('flags a gated write committed in the same call with a backdated date', async () => {
    expect(hook('enforce-gate.sh', 'PreToolUse', 'write && backdated commit', 'p6d').status).toBe(0);
    await writeFile(join(project, 'src', 'a.ts'), 'export const a = 7;\n');
    const past = { GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z', GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z' };
    gitWith(past, 'commit', '-q', '-am', 'backdated');
    const r = hook('post-bash-revert.sh', 'PostToolUse', 'write && backdated commit', 'p6d', { STUB_GATE_EXIT: '1' });
    expect(r.status).toBe(2);
  });

  // Codex, round 3: committing the write in the same call must not hide it.
  it('flags a gated write that the same call committed', async () => {
    expect(hook('enforce-gate.sh', 'PreToolUse', 'write && git commit -am x', 'p6b').status).toBe(0);
    await writeFile(join(project, 'src', 'a.ts'), 'export const a = 5;\n');
    git('commit', '-q', '-am', 'same call');
    const r = hook('post-bash-revert.sh', 'PostToolUse', 'write && git commit -am x', 'p6b', { STUB_GATE_EXIT: '1' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('src/a.ts');
  });

  // Codex, round 3: an old quarantine folder must not break the cleanup of old snapshots.
  it('keeps working when the quarantine folder is older than a day', async () => {
    const quarantine = join(project, '.git', 'harness-bash', 'quarantine');
    await mkdir(quarantine, { recursive: true });
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await utimes(quarantine, old, old);
    expect(hook('enforce-gate.sh', 'PreToolUse', 'ls', 'p9').status).toBe(0);
  });

  // Codex, round 2: moving HEAD with an empty commit must not hide a tampered hook or a gated write.
  it('restores a tampered hook even when the call also made an empty commit', async () => {
    const hookPath = join(project, '.claude', 'hooks', 'enforce-gate.sh');
    const original = await readFile(hookPath, 'utf8');
    expect(hook('enforce-gate.sh', 'PreToolUse', 'tamper && git commit --allow-empty', 'p7').status).toBe(0);
    await writeFile(hookPath, '#!/bin/bash\nexit 0\n');
    git('commit', '-q', '--allow-empty', '-m', 'empty');
    const r = hook('post-bash-revert.sh', 'PostToolUse', 'tamper && git commit --allow-empty', 'p7', { STUB_INTEGRITY_EXIT: '1' });
    expect(r.status).toBe(2);
    expect(await readFile(hookPath, 'utf8')).toBe(original);
    expect((await lstat(hookPath)).mode & 0o111).not.toBe(0); // still executable
  });

  it('flags an uncommitted gated write even when the call also made an empty commit', async () => {
    expect(hook('enforce-gate.sh', 'PreToolUse', 'write && git commit --allow-empty', 'p8').status).toBe(0);
    await writeFile(join(project, 'src', 'a.ts'), 'export const a = 4;\n');
    git('commit', '-q', '--allow-empty', '-m', 'empty');
    const r = hook('post-bash-revert.sh', 'PostToolUse', 'write && git commit --allow-empty', 'p8', { STUB_GATE_EXIT: '1' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('src/a.ts');
  });
});

// The governed project is where the hooks live, not the shell's folder. When it followed the payload's
// cwd, a call ending in a subfolder (`cd sub && ...`) was compared against `sub/`: every gated file
// looked written and every config file deleted, and the config "restore" wrote copies into
// `sub/.claude/` (Vegenus, 2026-11-18). An Edit or Write from a subfolder was refused for missing checksums.
describe('hooks use the project root whatever folder the shell is in', () => {
  beforeEach(async () => {
    await mkdir(join(project, 'sub'));
  });

  it('does not flag or restore anything for a clean call that changed into a subfolder', async () => {
    expect(hook('enforce-gate.sh', 'PreToolUse', 'cd sub && ls', 'c1').status).toBe(0);
    const r = hook('post-bash-revert.sh', 'PostToolUse', 'cd sub && ls', 'c1', { STUB_INTEGRITY_EXIT: '1', STUB_GATE_EXIT: '1' }, join(project, 'sub'));
    expect(r.stderr).not.toContain('[post-bash-revert]');
    expect(r.status).toBe(0);
    await expect(lstat(join(project, 'sub', '.claude'))).rejects.toThrow();
  });

  it('does not flag anything for a clean call that changed back from a subfolder', async () => {
    expect(hook('enforce-gate.sh', 'PreToolUse', 'cd .. && ls', 'c2', {}, join(project, 'sub')).status).toBe(0);
    const r = hook('post-bash-revert.sh', 'PostToolUse', 'cd .. && ls', 'c2', { STUB_INTEGRITY_EXIT: '1', STUB_GATE_EXIT: '1' });
    expect(r.stderr).not.toContain('[post-bash-revert]');
    expect(r.status).toBe(0);
  });

  it('still flags a real gated write made by a call that changed into a subfolder', async () => {
    expect(hook('enforce-gate.sh', 'PreToolUse', 'node -e write && cd sub', 'c3').status).toBe(0);
    await writeFile(join(project, 'src', 'a.ts'), 'export const a = 5;\n');
    const r = hook('post-bash-revert.sh', 'PostToolUse', 'node -e write && cd sub', 'c3', { STUB_GATE_EXIT: '1' }, join(project, 'sub'));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('src/a.ts');
    expect(await stubCalls()).toContainEqual(expect.stringContaining(`--project-path ${project} --tool Bash --file ${project}/src/a.ts`));
  });

  it('gates an Edit or Write against the project root while the shell sits in a subfolder', async () => {
    const payload = { hook_event_name: 'PreToolUse', session_id: 's', cwd: join(project, 'sub'), tool_name: 'Write', tool_input: { file_path: join(project, 'src', 'a.ts'), content: 'x' }, tool_use_id: 'c4' };
    const r = runHook('enforce-gate.sh', payload, { STUB_GATE_EXIT: '0' }, join(project, 'sub'));
    expect(r.status).toBe(0);
    expect(await stubCalls()).toContainEqual(expect.stringContaining(`--project-path ${project} --tool Write`));
  });

  // Run from the root, a subfolder's `npm test` (its own package in a monorepo) would be recorded and shown
  // as that folder's result. Not intercepting is safe: an unrecorded run never opens the gate.
  it('leaves a configured test command started from a subfolder to run normally, unrecorded', async () => {
    const r = hook('enforce-gate.sh', 'PreToolUse', 'false', 'c5', {}, join(project, 'sub'));
    expect(r.status).toBe(0);
    expect((await stubCalls()).some((c) => c.includes('--mode record-test-run'))).toBe(false);
  });

  // The hook path keeps the symlinked spelling (`cd && pwd`) while the payload cwd may be the real path
  // (macOS /var vs /private/var, a symlinked projects folder): still the project root.
  it('records a root test command when the hook path and the shell folder spell the root differently', async () => {
    const linked = `${project}-link`;
    await symlink(project, linked);
    try {
      const payload = { hook_event_name: 'PreToolUse', session_id: 's', cwd: project, tool_name: 'Bash', tool_input: { command: 'false' }, tool_use_id: 'c7' };
      const r = spawnSync('bash', [join(linked, '.claude', 'hooks', 'enforce-gate.sh')], {
        input: JSON.stringify(payload),
        cwd: project,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_LOG: log },
      });
      expect(r.status).toBe(2);
      expect((await stubCalls()).some((c) => c.includes('--mode record-test-run'))).toBe(true);
    } finally {
      await unlink(linked);
    }
  });

  // A redirect target is relative to the shell's folder: `echo > a.ts` in src/ writes the gated src/a.ts.
  it('judges a relative Bash write target from the folder the shell is in', async () => {
    const r = hook('enforce-gate.sh', 'PreToolUse', 'echo x > a.ts', 'c6', { STUB_GATE_EXIT: '1' }, join(project, 'src'));
    expect(r.status).toBe(2);
    expect(await stubCalls()).toContainEqual(expect.stringContaining(`--project-path ${project} --tool Bash --file ${project}/src/a.ts`));
  });
});


// Claude Code keeps worktrees at <project>/.claude/worktrees/<name>/ (checked 2026-11-18 with Claude Code
// 2.1.327). Subagent isolation and EnterWorktree run the main checkout's hooks with cwd and file_path in
// the worktree; `claude --worktree` runs the worktree's own copy. The hooks always speak for their own
// checkout and leave it to gate-check which checkout governs a file (packages/core gates.ts), so a write
// across checkouts is never judged against the wrong root. The post-Bash check watches the main checkout
// and every worktree. Only a test command typed at a worktree root is run and recorded for that worktree.
describe('hooks across Claude Code worktrees', () => {
  let worktree: string;

  beforeEach(() => {
    worktree = join(project, '.claude', 'worktrees', 'w');
    git('worktree', 'add', '-q', worktree, '-b', 'w');
  });

  // Runs a hook from the given checkout's own .claude/hooks (hookRoot), as Claude Code does.
  const at = (hookRoot: string, script: string, payload: Record<string, unknown>, env: Record<string, string> = {}) =>
    spawnSync('bash', [join(hookRoot, '.claude', 'hooks', script)], {
      input: JSON.stringify({ session_id: 's', ...payload }),
      cwd: payload.cwd as string,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_LOG: log, ...env },
    });
  const write = (hookRoot: string, cwd: string, filePath: string, id: string) =>
    at(hookRoot, 'enforce-gate.sh', { hook_event_name: 'PreToolUse', cwd, tool_name: 'Write', tool_input: { file_path: filePath, content: 'x' }, tool_use_id: id });
  const bash = (hookRoot: string, event: string, cwd: string, command: string, id: string, env: Record<string, string> = {}) =>
    at(hookRoot, event === 'PreToolUse' ? 'enforce-gate.sh' : 'post-bash-revert.sh', { hook_event_name: event, cwd, tool_name: 'Bash', tool_input: { command }, tool_use_id: id }, env);

  it("sends a write into a worktree to gate-check as the hooks' project with the absolute file (main checkout's hooks)", async () => {
    expect(write(project, worktree, join(worktree, 'src', 'a.ts'), 'w1').status).toBe(0);
    expect(await stubCalls()).toContainEqual(expect.stringContaining(`--project-path ${project} --tool Write --file ${worktree}/src/a.ts`));
  });

  it("sends a write into the main checkout to gate-check from a worktree's own hooks (claude --worktree)", async () => {
    expect(write(worktree, worktree, join(project, 'src', 'a.ts'), 'w2').status).toBe(0);
    expect(await stubCalls()).toContainEqual(expect.stringContaining(`--project-path ${worktree} --tool Write --file ${project}/src/a.ts`));
  });

  it('resolves a Bash redirect from a worktree shell into the main checkout to the file it writes', async () => {
    bash(project, 'PreToolUse', worktree, 'echo x > ../../../src/a.ts', 'w3', { STUB_GATE_EXIT: '1' });
    expect(await stubCalls()).toContainEqual(expect.stringContaining(`--project-path ${project} --tool Bash --file ${project}/src/a.ts`));
  });

  it('flags a gated write a Bash call made inside a worktree', async () => {
    expect(bash(project, 'PreToolUse', worktree, 'node -e write', 'w4').status).toBe(0);
    await writeFile(join(worktree, 'src', 'a.ts'), 'export const a = 6;\n');
    const r = bash(project, 'PostToolUse', worktree, 'node -e write', 'w4', { STUB_GATE_EXIT: '1' });
    expect(r.status).toBe(2);
    expect(await stubCalls()).toContainEqual(expect.stringContaining(`--project-path ${project} --tool Bash --file ${project}/.claude/worktrees/w/src/a.ts`));
  });

  it('flags a gated write into the main checkout by a Bash call whose shell sits in a worktree', async () => {
    expect(bash(project, 'PreToolUse', worktree, 'cp src/a.ts ../../../src/a.ts', 'w5').status).toBe(0);
    await writeFile(join(project, 'src', 'a.ts'), 'export const a = 7;\n');
    const r = bash(project, 'PostToolUse', worktree, 'cp src/a.ts ../../../src/a.ts', 'w5', { STUB_GATE_EXIT: '1' });
    expect(r.status).toBe(2);
    expect(await stubCalls()).toContainEqual(expect.stringContaining(`--project-path ${project} --tool Bash --file ${project}/src/a.ts`));
  });

  it("flags a gated write into the main checkout made under a worktree's own hooks (claude --worktree)", async () => {
    expect(bash(worktree, 'PreToolUse', worktree, 'cp src/a.ts ../../../src/a.ts', 'w6').status).toBe(0);
    await writeFile(join(project, 'src', 'a.ts'), 'export const a = 8;\n');
    const r = bash(worktree, 'PostToolUse', worktree, 'cp src/a.ts ../../../src/a.ts', 'w6', { STUB_GATE_EXIT: '1' });
    expect(r.status).toBe(2);
    expect(await stubCalls()).toContainEqual(expect.stringMatching(new RegExp(`--project-path ${worktree} --tool Bash --file ${worktree}/\\.\\./\\.\\./\\.\\./src/a\\.ts`)));
  });

  it('raises nothing for a clean call that moves between the main checkout and a worktree', async () => {
    const clean = { STUB_INTEGRITY_EXIT: '1', STUB_GATE_EXIT: '1' };
    expect(bash(project, 'PreToolUse', project, 'cd .claude/worktrees/w', 'w7').status).toBe(0);
    const into = bash(project, 'PostToolUse', worktree, 'cd .claude/worktrees/w', 'w7', clean);
    expect(bash(project, 'PreToolUse', worktree, 'cd ../../..', 'w8').status).toBe(0);
    const back = bash(project, 'PostToolUse', project, 'cd ../../..', 'w8', clean);
    for (const r of [into, back]) {
      expect(r.stderr).not.toContain('[post-bash-revert]');
      expect(r.status).toBe(0);
    }
  });

  it('runs and records a test command typed at a worktree root for that worktree', async () => {
    expect(hook('enforce-gate.sh', 'PreToolUse', 'false', 'w9', {}, worktree).status).toBe(2);
    expect(await stubCalls()).toContainEqual(expect.stringMatching(new RegExp(`--mode record-test-run --project-path ${worktree} .*--exit-code 1$`)));
  });

  // Claude can write a self-consistent admin dir and a .git file anywhere; outside .claude/worktrees/ that
  // is not a worktree, so a test command there is not recorded as some checkout's RED.
  it('does not record a test command typed at a forged checkout outside .claude/worktrees/', async () => {
    await mkdir(join(project, 'fake'));
    await writeFile(join(project, 'fake', 'commondir'), `${join(project, '.git')}\n`);
    await writeFile(join(project, 'fake', 'gitdir'), `${join(project, 'src', '.git')}\n`);
    await writeFile(join(project, 'src', '.git'), `gitdir: ${join(project, 'fake')}\n`);
    expect(hook('enforce-gate.sh', 'PreToolUse', 'false', 'w10', {}, join(project, 'src')).status).toBe(0);
    expect((await stubCalls()).some((c) => c.includes('--mode record-test-run'))).toBe(false);
  });

  // The "file matches a commit that existed before the call" exemption is about this checkout's HEAD; it
  // says nothing about another checkout's files (git cannot even look them up: both sides were null).
  it('still flags a write into another checkout when the same call also moved HEAD to an existing commit', async () => {
    spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'second'], { cwd: worktree });
    expect(bash(worktree, 'PreToolUse', worktree, 'git checkout -q HEAD~1 && cp x ../../../src/a.ts', 'w11').status).toBe(0);
    spawnSync('git', ['checkout', '-q', 'HEAD~1'], { cwd: worktree });
    await writeFile(join(project, 'src', 'a.ts'), 'export const a = 9;\n');
    const r = bash(worktree, 'PostToolUse', worktree, 'git checkout -q HEAD~1 && cp x ../../../src/a.ts', 'w11', { STUB_GATE_EXIT: '1' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('src/a.ts');
  });

  // The hooks' own checkout is always watched, whatever kind of checkout it is.
  it('watches a manual worktree outside .claude/worktrees/ that runs its own hooks', async () => {
    const feature = `${project}-feature`;
    git('worktree', 'add', '-q', feature, '-b', 'feature');
    try {
      expect(bash(feature, 'PreToolUse', feature, 'node -e write', 'w12').status).toBe(0);
      await writeFile(join(feature, 'src', 'a.ts'), 'export const a = 10;\n');
      const r = bash(feature, 'PostToolUse', feature, 'node -e write', 'w12', { STUB_GATE_EXIT: '1' });
      expect(r.status).toBe(2);
      expect(await stubCalls()).toContainEqual(expect.stringContaining(`--project-path ${feature} --tool Bash --file ${feature}/src/a.ts`));
    } finally {
      await rm(feature, { recursive: true, force: true });
    }
  });

  it('watches a project whose git dir lives elsewhere (--separate-git-dir; a submodule is alike)', async () => {
    const separate = await mkdtemp(join(tmpdir(), 'harness-os-separate-'));
    const gitDir = await mkdtemp(join(tmpdir(), 'harness-os-separate-git-'));
    try {
      await cp(join(project, '.claude'), join(separate, '.claude'), { recursive: true });
      await mkdir(join(separate, 'src'));
      await writeFile(join(separate, 'src', 'a.ts'), 'export const a = 1;\n');
      const g = (...args: string[]) => spawnSync('git', args, { cwd: separate });
      g('init', '-q', '--separate-git-dir', join(gitDir, 'x.git'));
      g('-c', 'user.email=t@example.test', '-c', 'user.name=t', 'add', '-A');
      g('-c', 'user.email=t@example.test', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
      expect(bash(separate, 'PreToolUse', separate, 'node -e write', 'w13').status).toBe(0);
      await writeFile(join(separate, 'src', 'a.ts'), 'export const a = 11;\n');
      const r = bash(separate, 'PostToolUse', separate, 'node -e write', 'w13', { STUB_GATE_EXIT: '1' });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('src/a.ts');
    } finally {
      await rm(separate, { recursive: true, force: true });
      await rm(gitDir, { recursive: true, force: true });
    }
  });
});

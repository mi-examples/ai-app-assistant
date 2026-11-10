import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, 'add-skill.mjs');
const SKILL_SOURCE = resolve(__dirname, '../skills/ai-app-assistant-docs');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'add-skill-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(...args: string[]) {
  return spawnSync('node', [SCRIPT, '--cwd', dir, ...args], { encoding: 'utf8' });
}

describe('add-skill', () => {
  it('copies the skill into .claude/skills and prints the target', () => {
    const out = execFileSync('node', [SCRIPT, '--cwd', dir], { encoding: 'utf8' });
    const target = join(dir, '.claude/skills/ai-app-assistant-docs');

    expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toBe(readFileSync(join(SKILL_SOURCE, 'SKILL.md'), 'utf8'));
    expect(existsSync(join(target, 'references/guide-format.md'))).toBe(true);
    expect(out).toContain(target);
  });

  it('accepts and skips a leading add-skill token', () => {
    const result = spawnSync('node', [SCRIPT, 'add-skill', '--cwd', dir], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(existsSync(join(dir, '.claude/skills/ai-app-assistant-docs/SKILL.md'))).toBe(true);
  });

  it('refuses to overwrite an existing copy and leaves it untouched', () => {
    run();
    const file = join(dir, '.claude/skills/ai-app-assistant-docs/SKILL.md');
    writeFileSync(file, 'edited');

    const second = run();

    expect(second.status).toBe(1);
    expect(second.stderr).toContain('--force');
    expect(readFileSync(file, 'utf8')).toBe('edited');
  });

  it('overwrites with --force', () => {
    run();
    const file = join(dir, '.claude/skills/ai-app-assistant-docs/SKILL.md');
    writeFileSync(file, 'edited');

    const forced = run('--force');

    expect(forced.status).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(readFileSync(join(SKILL_SOURCE, 'SKILL.md'), 'utf8'));
  });

  it('writes under .cursor/skills with --cursor', () => {
    const result = run('--cursor');

    expect(result.status).toBe(0);
    expect(existsSync(join(dir, '.cursor/skills/ai-app-assistant-docs/SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude'))).toBe(false);
  });

  it('exits 1 with usage on an unknown flag', () => {
    const result = run('--nope');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage');
  });
});

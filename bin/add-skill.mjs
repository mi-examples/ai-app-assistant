#!/usr/bin/env node
// Installs the ai-app-assistant-docs skill into a project. Node built-ins only.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_NAME = 'ai-app-assistant-docs';
const USAGE = 'Usage: add-skill [--cursor] [--force] [--cwd <dir>]';

/**
 * @param {string[]} argv
 * @returns {{ cursor: boolean, force: boolean, cwd: string } | null} null when the arguments are invalid
 */
function parseArgs(argv) {
  const options = { cursor: false, force: false, cwd: process.cwd() };
  // `npx <package> add-skill` passes the command name through.
  const args = argv[0] === 'add-skill' ? argv.slice(1) : argv;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--cursor') options.cursor = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--cwd' && args[i + 1] !== undefined) {
      i += 1;
      options.cwd = resolve(args[i]);
    } else return null;
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    console.error(USAGE);
    process.exit(1);
  }

  const source = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', SKILL_NAME);
  const target = join(options.cwd, options.cursor ? '.cursor' : '.claude', 'skills', SKILL_NAME);

  if (existsSync(target) && !options.force) {
    console.error(`${target} already exists; use --force to overwrite it.`);
    process.exit(1);
  }

  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true, force: true });
  console.log(target);
}

main();

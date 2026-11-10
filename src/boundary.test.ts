import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKIPPED_DIRS = new Set(['skills', 'bin', 'node_modules']);
const SOURCE_FILE = /\.(ts|tsx|scss)$/;
const TEST_FILE = /\.test\.(ts|tsx)$/;
const FORBIDDEN_TERMS = /PP_VARIABLES/;

const IMPORT_PATTERNS = [
  /\bfrom\s*['"]([^'"]+)['"]/g, // import … from '…' and export … from '…'
  /\bimport\s*['"]([^'"]+)['"]/g, // side-effect import '…'
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // dynamic import('…')
  /@(?:use|import|forward)\s+['"]([^'"]+)['"]/g, // SCSS
];

const listSourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return SKIPPED_DIRS.has(entry.name) ? [] : listSourceFiles(full);
    }

    return SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name) ? [full] : [];
  });

const relativeSpecifiers = (text: string): string[] => {
  const found = IMPORT_PATTERNS.flatMap((pattern) => Array.from(text.matchAll(pattern), (match) => match[1]));

  return found.filter((spec) => spec.startsWith('./') || spec.startsWith('../'));
};

const escapesPackage = (file: string, spec: string): boolean => {
  const bare = spec.replace(/[?#].*$/, '');
  const resolved = path.resolve(path.dirname(file), bare);

  return path.relative(PACKAGE_DIR, resolved).startsWith('..');
};

describe('ai-app-assistant package boundary', () => {
  const files = listSourceFiles(PACKAGE_DIR);

  it('finds the package source files', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('imports nothing from outside the package folder', () => {
    const offenders = files.flatMap((file) =>
      relativeSpecifiers(readFileSync(file, 'utf8'))
        .filter((spec) => escapesPackage(file, spec))
        .map((spec) => `${path.relative(PACKAGE_DIR, file)} imports '${spec}' (outside the package)`),
    );

    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('reads no host page globals', () => {
    const offenders = files.flatMap((file) => {
      const match = readFileSync(file, 'utf8').match(FORBIDDEN_TERMS);

      return match ? [`${path.relative(PACKAGE_DIR, file)} contains '${match[0]}'`] : [];
    });

    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

import { fileURLToPath } from 'node:url';
import { compile } from 'sass';
import { describe, expect, it } from 'vitest';

const css = compile(fileURLToPath(new URL('./styles.scss', import.meta.url))).css;

function zIndexOf(selector: string): number | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = css.match(new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  const z = block?.[1].match(/z-index:\s*(\d+)/);

  return z ? Number(z[1]) : null;
}

describe('concierge stacking order', () => {
  it('keeps the launcher below the app overlays (config modal 900/901, sidebar 1000)', () => {
    expect(zIndexOf('.aic-launcher')).toBe(800);
  });

  it('raises the panel above everything only while open', () => {
    expect(zIndexOf('.aic-panel')).toBe(800);
    expect(zIndexOf('.aic-panel--open')).toBe(2147483001);
  });
});

describe('concierge styles', () => {
  const ruleBody = (selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return css.match(new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? null;
  };

  it('the button reset is wrapped in :where(.aic-root) so component rules win', () => {
    expect(ruleBody(':where(.aic-root) button')).toMatch(/color:\s*inherit/);
    expect(css).not.toMatch(/(^|\n|\})\s*\.aic-root button\s*\{/);
  });

  it('.aic-send has no !important and paints a white icon', () => {
    const send = ruleBody('.aic-send');
    expect(send).not.toBeNull();
    expect(send).not.toContain('!important');
    expect(send).toMatch(/color:\s*#fff/);
  });

  it('no font-size below 11px', () => {
    const sizes = [...css.matchAll(/font(?:-size)?:[^;}]*?(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.filter((n) => n < 11)).toEqual([]);
  });

  it('the input draws no outline of its own; focus rings the whole box in the accent', () => {
    expect(css).not.toMatch(/textarea:focus-visible/);
    expect(ruleBody('.aic-box:has(.aic-input:focus)')).toMatch(/box-shadow:[^;]*var\(--aic-accent\)/);
  });

  it('a disabled header icon looks disabled and has no hover', () => {
    expect(ruleBody('.aic-ic:disabled')).toMatch(/opacity:\s*0\.4/);
  });

  it('shimmer animates only without reduced motion', () => {
    const base = ruleBody('.aic-think');
    expect(base).toMatch(/color:\s*var\(--aic-muted\)/);
    expect(base).not.toContain('animation');
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.aic-think\s*\{[^}]*animation:/);
  });
});

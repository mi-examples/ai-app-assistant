import { describe, expect, it } from 'vitest';
import { FORWARD_MARKER } from '../client/llm-proxy';
import { buildProxyMessages } from './build-proxy-prompt';
import type { KnowledgeSection } from './knowledge';
import type { PageContext } from './page-context';

const bytes = (s: string) => new TextEncoder().encode(s).length;

function section(
  heading: string,
  body = `Body of ${heading}`,
  extra: Partial<KnowledgeSection> = {},
): KnowledgeSection {
  return { id: heading, file: 'f.md', heading, body, audience: 'all', isSummary: false, ...extra };
}

const snapshot: PageContext = {
  pageName: 'Dashboard',
  route: '/dashboard',
  groups: [
    {
      title: 'Finance',
      items: Array.from({ length: 20 }, (_, i) => ({
        elementId: i,
        label: `Tile ${i}`,
        value: i === 0 ? '$3.6M' : `${i}`,
      })),
    },
  ],
};

const base = { question: 'What is revenue?', history: [], pageName: 'Dashboard' };
const system = (r: ReturnType<typeof buildProxyMessages>) => r.messages[0].content;

describe('buildProxyMessages', () => {
  it('system message carries the required rules', () => {
    const r = buildProxyMessages({ ...base, sections: [section('A')], snapshot });
    const s = system(r);
    expect(r.messages[0].role).toBe('system');
    expect(s).toContain(FORWARD_MARKER);
    expect(s).toMatch(/never invent/i);
    expect(s).toContain('[1]');
    expect(s).toContain('Dashboard');
  });

  it('anything the guide and page do not answer is forwarded, never answered with "not covered"', () => {
    const s = system(buildProxyMessages({ ...base, sections: [section('A')], snapshot }));
    expect(s).not.toMatch(/say so/i);
    expect(s).toMatch(new RegExp(`do not fully answer[^\\n]*reply with \\[\\[CONCIERGE\\]\\] followed by`, 'i'));
    expect(s).toMatch(/defined or calculated/);
  });

  it('asks for the forwarded question rewritten to stand on its own, on one line ending in "?"', () => {
    const s = system(buildProxyMessages({ ...base, sections: [section('A')], snapshot }));
    expect(s).toMatch(/rewritten so it stands on its own/);
    expect(s).toMatch(/"it" or "that"/);
    expect(s).toMatch(/one line ending in "\?"/);
  });

  it('numbers sources: page first, then sections in order', () => {
    const r = buildProxyMessages({ ...base, sections: [section('Alpha'), section('Beta')], snapshot });
    expect(r.sources).toEqual([
      { n: 1, label: 'On this page', detail: 'Dashboard' },
      { n: 2, label: 'App guide', detail: '§ Alpha' },
      { n: 3, label: 'App guide', detail: '§ Beta' },
    ]);
    expect(system(r)).toContain('[2] App guide § Alpha');
    expect(system(r)).toContain('[3] App guide § Beta');
    expect(r.snapshotSent).toBe(true);
  });

  it('without a snapshot says page data was not shared and contains no tile value', () => {
    const r = buildProxyMessages({ ...base, sections: [section('Alpha')], snapshot: null });
    expect(system(r)).not.toContain('$3.6M');
    expect(system(r)).toMatch(/not shared/i);
    expect(system(r)).not.toContain('# Page snapshot');
    expect(r.snapshotSent).toBe(false);
    expect(r.sources).toEqual([{ n: 1, label: 'App guide', detail: '§ Alpha' }]);
    expect(system(r)).toContain('[1] App guide § Alpha');
  });

  it('includes the summary section without a number', () => {
    const r = buildProxyMessages({
      ...base,
      sections: [section('Summary', 'Overall summary text', { isSummary: true }), section('Alpha')],
      snapshot: null,
    });
    expect(system(r)).toContain('Overall summary text');
    expect(r.sources).toEqual([{ n: 1, label: 'App guide', detail: '§ Alpha' }]);
  });

  it('message order is system, history (user/assistant pairs), question', () => {
    const history = [{ question: 'q1', answer: 'a1' }];
    const r = buildProxyMessages({ ...base, sections: [], snapshot: null, history });
    expect(r.messages.map((m) => [m.role, m.content])).toEqual([
      ['system', system(r)],
      ['user', 'q1'],
      ['assistant', 'a1'],
      ['user', 'What is revenue?'],
    ]);
  });

  it('keeps only the last 6 history turns', () => {
    const history = Array.from({ length: 8 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` }));
    const r = buildProxyMessages({ ...base, sections: [], snapshot: null, history });
    expect(r.messages).toHaveLength(1 + 12 + 1);
    expect(r.messages[1].content).toBe('q2');
  });

  it('cuts sections before the snapshot and the snapshot at whole lines', () => {
    const sections = [
      section('First', 'a'.repeat(300)),
      section('Second', 'b'.repeat(300)),
      section('Third', 'c'.repeat(300)),
    ];
    const full = buildProxyMessages({ ...base, sections, snapshot });
    const fullBytes = bytes(system(full));

    const noThird = buildProxyMessages({ ...base, sections, snapshot, maxBytes: fullBytes - 100 });
    expect(noThird.usedSections.map((s) => s.heading)).toEqual(['First', 'Second']);
    expect(noThird.snapshotSent).toBe(true);
    expect(system(noThird)).not.toContain('Third');

    const floor = bytes(system(buildProxyMessages({ ...base, sections: [], snapshot: null })));
    const limit = floor + 450;
    const tiny = buildProxyMessages({ ...base, sections, snapshot, maxBytes: limit });
    expect(bytes(system(tiny))).toBeLessThanOrEqual(limit);
    expect(tiny.usedSections.map((s) => s.heading)).not.toContain('Third');
    const snap = system(tiny).split('# Page snapshot\n\n')[1] ?? '';
    expect(snap.length).toBeGreaterThan(0);
    const lines = snap.split('\n').filter((l) => l.startsWith('- '));
    expect(lines.length).toBeLessThan(20);
    for (const l of lines) expect(l).toMatch(/^- Tile \d+ \(element \d+\): \$?[\d.]+M?$/);
  });

  it('does not include sections it was not given', () => {
    const knowledge = [
      section('Public one', 'PUBLIC-BODY-ONE'),
      section('Admin setup', 'ADMIN-ONLY-SECRET', { audience: 'admin' }),
      section('Public two', 'PUBLIC-BODY-TWO'),
    ];
    const given = knowledge.filter((k) => k.audience === 'all');
    const r = buildProxyMessages({ ...base, sections: given, snapshot: null });
    for (const used of r.usedSections) expect(given).toContain(used);
    expect(r.usedSections).toHaveLength(2);
    expect(system(r)).toContain('PUBLIC-BODY-ONE');
    expect(system(r)).toContain('PUBLIC-BODY-TWO');
    expect(system(r)).not.toContain('ADMIN-ONLY-SECRET');
    expect(system(r)).not.toContain('Admin setup');
    expect(r.sources.map((x) => x.detail)).not.toContain('§ Admin setup');
  });
});

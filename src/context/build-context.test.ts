import { describe, expect, it } from 'vitest';
import { buildContext, buildQuestionPrefix, earlierTurnLine } from './build-context';
import type { KnowledgeSection } from './knowledge';
import { formatPageContext, type PageContext } from './page-context';

const HEADER = 'Values shown on the page right now. Treat these as authoritative for what the user sees.';
const bytes = (s: string) => new TextEncoder().encode(s).length;

function section(id: string, bodyLen: number, isSummary = false): KnowledgeSection {
  return {
    id,
    file: 'f.md',
    heading: id,
    body: 'x'.repeat(bodyLen),
    audience: 'all',
    isSummary,
  };
}

const snapshot: PageContext = {
  pageName: 'Dashboard',
  route: '/dashboard',
  groups: [{ title: 'Finance', items: [{ elementId: 1, label: 'Revenue', value: '$1M' }] }],
};

describe('buildContext', () => {
  it('wraps text as {"EmbedElement": "<json string>"} with element_id', () => {
    const r = buildContext({ snapshot, sections: [section('sum', 20, true)], elementId: 42 });
    const outer = JSON.parse(r.context);
    expect(typeof outer.EmbedElement).toBe('string');
    const inner = JSON.parse(outer.EmbedElement);
    expect(inner.element_id).toBe(42);
    expect(inner.context).toBe(r.text);
    expect(r.text).toContain('# App guide');
    expect(r.text).toContain('# Page snapshot');
    expect(r.text).toContain(HEADER);
  });

  it('uses element_id 0 when elementId is null', () => {
    const r = buildContext({ snapshot, sections: [], elementId: null });
    expect(JSON.parse(JSON.parse(r.context).EmbedElement).element_id).toBe(0);
  });

  it('keeps snapshot and summary and drops lowest-ranked sections first when over budget', () => {
    const sections = [
      section('sum', 300, true),
      section('a', 300),
      section('b', 300),
      section('c', 300),
      section('d', 300),
    ];
    const r = buildContext({ snapshot, sections, elementId: 1, budgetBytes: 900 });
    expect(r.usedSections.map((s) => s.id)).toEqual(['sum', 'a']);
    expect(bytes(r.text)).toBeLessThanOrEqual(900);
    expect(r.text).toContain(HEADER);
    const tight = buildContext({ snapshot, sections, elementId: 1, budgetBytes: 600 });
    expect(tight.usedSections.map((s) => s.id)).toEqual(['sum']);
  });

  it('never truncates the snapshot even if it alone exceeds budget', () => {
    const big: PageContext = {
      ...snapshot,
      groups: [{ title: 'L', items: [{ elementId: 1, label: 'T'.repeat(500), value: 'v' }] }],
    };
    const r = buildContext({
      snapshot: big,
      sections: [section('sum', 50, true), section('a', 50)],
      elementId: 1,
      budgetBytes: 100,
    });
    expect(r.text).toContain('T'.repeat(500));
    expect(r.usedSections.map((s) => s.id)).toEqual(['sum']);
  });

  it('returns usedSections in the order sent', () => {
    const sections = [section('sum', 10, true), section('b', 10), section('a', 10)];
    const r = buildContext({ snapshot, sections, elementId: 1 });
    expect(r.usedSections.map((s) => s.id)).toEqual(['sum', 'b', 'a']);
  });
});

describe('buildQuestionPrefix', () => {
  const GUIDE_LINE = 'App guide (use it to answer questions about this page):';

  it('starts with the exact guide line and includes top sections whole', () => {
    const sections = [section('a', 50), section('b', 60), section('sum', 10, true)];
    const r = buildQuestionPrefix({ sections, snapshot: null });
    expect(r.text.startsWith(`${GUIDE_LINE}\n\n## a\n${'x'.repeat(50)}\n\n## b\n`)).toBe(true);
    expect(r.usedSections.map((s) => s.id)).toEqual(['a', 'b', 'sum']);
  });

  it("skips a section that doesn't fit and still includes a later smaller one", () => {
    const sections = [section('big', 5000), section('small', 20)];
    const r = buildQuestionPrefix({ sections, snapshot: null, maxBytes: 500 });
    expect(r.usedSections.map((s) => s.id)).toEqual(['small']);
    expect(r.text).not.toContain('## big');
  });

  it('stays within maxBytes and truncates only the snapshot, UTF-8 safely', () => {
    const wide: PageContext = {
      ...snapshot,
      pageName: '€'.repeat(2000),
    };
    const r = buildQuestionPrefix({ sections: [section('a', 100)], snapshot: wide, maxBytes: 700 });
    expect(bytes(r.text)).toBeLessThanOrEqual(700);
    expect(r.text).toContain('x'.repeat(100));
    expect(r.text).not.toContain('�');
    expect(r.text).toContain(HEADER);
  });

  it('omits the snapshot when under 200 bytes remain', () => {
    const r = buildQuestionPrefix({ sections: [section('a', 1400)], snapshot, maxBytes: 1536 });
    expect(r.text).not.toContain(HEADER);
    expect(r.usedSections).toHaveLength(1);
  });

  const tiles: PageContext = {
    pageName: 'Dashboard',
    route: '/dashboard',
    groups: [
      {
        title: 'Finance',
        items: [
          { elementId: 1, label: 'Revenue', value: '$12.75M', details: ['target $13.00M'] },
          { elementId: 2, label: 'Margin', value: '41.3%', details: ['target 40.0%'] },
          { elementId: 3, label: 'Backlog', value: '$3.10M' },
        ],
      },
    ],
  };

  it('never emits a partial snapshot line (a tile value is never cut short)', () => {
    const lines = formatPageContext(tiles).split('\n');
    for (let maxBytes = 150; maxBytes <= 600; maxBytes++) {
      const r = buildQuestionPrefix({ sections: [section('a', 20)], snapshot: tiles, maxBytes });
      expect(bytes(r.text)).toBeLessThanOrEqual(maxBytes);
      expect(r.text).not.toMatch(/\$12\.7(?!5M)/);
      const idx = r.text.indexOf(HEADER);
      if (idx === -1) continue;
      for (const line of r.text.slice(idx).split('\n')) expect(lines).toContain(line);
    }
  });

  it('keeps the snapshot header and first tiles when several big sections are picked', () => {
    const sections = [section('a', 450), section('b', 450), section('c', 450), section('sum', 30, true)];
    const r = buildQuestionPrefix({ sections, snapshot: tiles });
    expect(bytes(r.text)).toBeLessThanOrEqual(1536);
    expect(r.text).toContain(HEADER);
    expect(r.text).toContain('- Revenue (element 1): $12.75M');
    expect(r.text).toContain('## a\n');
    expect(r.usedSections.map((s) => s.id)).toEqual(['a', 'b', 'sum']);
    expect(r.text).toContain('## sum\n');
    expect(r.text).not.toContain('## c\n');
  });

  it('usedSections matches exactly the sections rendered', () => {
    const sections = [section('a', 300), section('b', 300), section('c', 300), section('sum', 100, true)];
    for (const maxBytes of [400, 700, 1000, 1536]) {
      const r = buildQuestionPrefix({ sections, snapshot: tiles, maxBytes });
      expect(bytes(r.text)).toBeLessThanOrEqual(maxBytes);
      const rendered = sections.filter((s) => r.text.includes(`## ${s.id}\n`)).map((s) => s.id);
      expect([...r.usedSections.map((s) => s.id)].sort()).toEqual(rendered.sort());
    }
  });

  it('returns empty text when nothing fits and snapshot is null', () => {
    const r = buildQuestionPrefix({ sections: [section('a', 5000)], snapshot: null, maxBytes: 300 });
    expect(r).toEqual({ text: '', usedSections: [] });
  });
});

describe('earlierTurnLine', () => {
  it('restates the previous question and answer on one line, without citation numbers', () => {
    const turn = { question: 'Is there an editor?', answer: 'Yes, the\n\neditor [2] in the header [3].' };
    expect(earlierTurnLine(turn)).toBe(
      'Earlier in this chat the user asked: "Is there an editor?" The answer was: "Yes, the editor in the header."',
    );
  });

  it('cuts a long answer at 400 characters', () => {
    const line = earlierTurnLine({ question: 'q', answer: 'a'.repeat(500) });
    expect(line).toContain(`"${'a'.repeat(400)}…"`);
  });
});

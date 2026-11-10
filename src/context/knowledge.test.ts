import { describe, expect, it } from 'vitest';
import { parseKnowledge } from './knowledge';

describe('parseKnowledge', () => {
  it('splits a file into one section per ## heading', () => {
    const raw = '## First  \n\nBody one.\n\n## Second\nBody two.\n';
    const { sections } = parseKnowledge([{ name: 'faq.md', raw }]);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ file: 'faq.md', heading: 'First', body: 'Body one.' });
    expect(sections[1]).toMatchObject({ heading: 'Second', body: 'Body two.' });
  });

  it('reads audience and suggested from front matter', () => {
    const raw =
      '---\naudience: admin\nsuggested:\n  - How do I set up filters?\n---\n## Filters\nText.\n## Other\nMore.';
    const pack = parseKnowledge([{ name: 'admin.md', raw }]);
    expect(pack.sections.map((s) => s.audience)).toEqual(['admin', 'admin']);
    expect(pack.suggested).toContain('How do I set up filters?');
  });

  it('defaults audience to all when front matter is missing', () => {
    const { sections } = parseKnowledge([{ name: 'faq.md', raw: '## A\nBody' }]);
    expect(sections[0].audience).toBe('all');
  });

  it('section comment overrides file audience', () => {
    const raw = '---\naudience: all\n---\n## Public\nHello\n## Secret\n<!-- audience: admin -->\nHidden';
    const { sections } = parseKnowledge([{ name: 'faq.md', raw }]);
    expect(sections[0].audience).toBe('all');
    expect(sections[1].audience).toBe('admin');
    expect(sections[1].body).toBe('Hidden');
  });

  it('marks the first paragraph of user-guide as summary', () => {
    const raw = 'This app shows the dashboard.\n\n## Usage\nClick things.';
    const { sections } = parseKnowledge([{ name: 'user-guide.md', raw }]);
    expect(sections[0]).toMatchObject({
      heading: 'Summary',
      body: 'This app shows the dashboard.',
      isSummary: true,
    });
    expect(sections[1].isSummary).toBe(false);
  });

  it('ids are stable slugs', () => {
    const { sections } = parseKnowledge([{ name: 'metrics.md', raw: '## Net Margin %\nx' }]);
    expect(sections[0].id).toBe('metrics/net-margin');
  });

  it('unknown front-matter audience fails closed to admin', () => {
    const { sections } = parseKnowledge([{ name: 'a.md', raw: '---\naudience: admins\n---\n## A\nx' }]);
    expect(sections[0].audience).toBe('admin');
  });

  it('parses audience case-insensitively and strips the comment', () => {
    const raw = '## A\n<!-- audience: Admin -->\nSecret';
    const { sections } = parseKnowledge([{ name: 'a.md', raw }]);
    expect(sections[0].audience).toBe('admin');
    expect(sections[0].body).toBe('Secret');
  });

  it('summary is only the first paragraph without the H1, and always audience all', () => {
    const raw = '---\naudience: admin\n---\n# Title\n\nPara one.\n\nPara two.\n\n## Usage\nx';
    const { sections } = parseKnowledge([{ name: 'user-guide.md', raw }]);
    expect(sections[0].body).toBe('Para one.');
    expect(sections[0].audience).toBe('all');
    expect(sections[1].audience).toBe('admin');
  });

  it('empty or multi-word audience fails closed to admin', () => {
    for (const value of ['audience:', 'audience: admin only']) {
      const { sections } = parseKnowledge([{ name: 'a.md', raw: `---\n${value}\n---\n## A\nx` }]);
      expect(sections[0].audience).toBe('admin');
    }
  });

  it('empty section audience comment fails closed and is stripped', () => {
    const { sections } = parseKnowledge([{ name: 'a.md', raw: '## A\n<!-- audience: -->\nSecret' }]);
    expect(sections[0].audience).toBe('admin');
    expect(sections[0].body).toBe('Secret');
  });
  it('summary: true makes that file the summary source', () => {
    const raw = '---\nsummary: true\n---\n# Guide\n\nIntro text.\n\n## A\nBody';
    const { sections } = parseKnowledge([{ name: 'overview.md', raw }]);
    expect(sections[0]).toMatchObject({ heading: 'Summary', body: 'Intro text.', isSummary: true });
  });

  it('without summary: true, user-guide.md stays the summary', () => {
    const { sections } = parseKnowledge([
      { name: 'user-guide.md', raw: '# G\n\nIntro.\n\n## A\nBody' },
      { name: 'other.md', raw: '# O\n\nOther intro.\n\n## B\nBody' },
    ]);
    expect(sections.filter((s) => s.isSummary).map((s) => s.file)).toEqual(['user-guide.md']);
  });

  it('summary: true wins over user-guide.md; first flagged file wins', () => {
    const flag = (t: string): string => `---\nsummary: true\n---\n# T\n\n${t}\n\n## A\nBody`;
    const { sections } = parseKnowledge([
      { name: 'user-guide.md', raw: '# G\n\nGuide intro.\n\n## A\nBody' },
      { name: 'one.md', raw: flag('One.') },
      { name: 'two.md', raw: flag('Two.') },
    ]);
    const summaries = sections.filter((s) => s.isSummary);
    expect(summaries.map((s) => s.file)).toEqual(['one.md']);
  });

  it('strips author-note comments from bodies without adding blank lines', () => {
    const raw =
      '## A\n<!-- needs review -->\nLine one.\n<!-- draft: written from code -->\nLine two <!-- inline --> end.\n' +
      '<!-- multi\nline -->\nLine three.';
    const { sections } = parseKnowledge([{ name: 'f.md', raw }]);
    expect(sections[0].body).toBe('Line one.\nLine two  end.\nLine three.');
  });

  it('a note before the audience comment does not stop the section being admin', () => {
    const raw = '## S\n<!-- needs review -->\n<!-- audience: admin -->\nSecret';
    const { sections } = parseKnowledge([{ name: 'f.md', raw }]);
    expect(sections[0].audience).toBe('admin');
    expect(sections[0].body).toBe('Secret');
  });

  it('strips notes from the summary preamble', () => {
    const raw = '# G\n<!-- draft: x -->\nIntro.\n\n## A\nBody';
    const { sections } = parseKnowledge([{ name: 'user-guide.md', raw }]);
    expect(sections[0].body).toBe('Intro.');
  });
});

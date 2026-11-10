import { describe, expect, it } from 'vitest';
import type { Audience, KnowledgeSection } from './knowledge';
import { pickSections } from './pick-sections';

function section(
  id: string,
  heading: string,
  body: string,
  audience: Audience = 'all',
  isSummary = false,
): KnowledgeSection {
  return { id, file: 'guide.md', heading, body, audience, isSummary };
}

const summary = section('summary', 'Overview', 'Dashboard overview.', 'all', true);

describe('pickSections', () => {
  it('does not count "page" as a topic word, since every question is about this page', () => {
    const sections = [
      summary,
      section(
        'err',
        'Troubleshooting: the page shows only an error',
        'The page breaks when a dataset is missing.',
        'admin',
      ),
      section('regions', 'Regions', 'Each region is a row of tiles.'),
    ];
    const result = pickSections(sections, 'How do the regions on this page work?', { isAdmin: true });
    expect(result.map((s) => s.id)).toEqual(['summary', 'regions']);
  });

  it('on equal score, user-facing sections come before admin ones whatever the file order', () => {
    const sections = [
      summary,
      section('setup', 'Regions dataset', 'Prepare the region rows.', 'admin'),
      section('guide', 'Regions', 'Each region is a row of tiles.'),
    ];
    const result = pickSections(sections, 'regions', { isAdmin: true });
    expect(result.map((s) => s.id)).toEqual(['summary', 'guide', 'setup']);
  });

  it('never returns admin sections to non-admins', () => {
    const sections = [summary, section('a', 'Secret Settings', 'configure settings', 'admin')];
    const result = pickSections(sections, 'configure settings', { isAdmin: false });
    expect(result.map((s) => s.id)).toEqual(['summary']);
  });

  it('returns admin sections to admins when they match', () => {
    const sections = [summary, section('a', 'Secret Settings', 'configure settings', 'admin')];
    const result = pickSections(sections, 'configure settings', { isAdmin: true });
    expect(result.map((s) => s.id)).toEqual(['summary', 'a']);
  });

  it('always includes the summary first even with zero matches', () => {
    const sections = [section('f', 'Filters', 'filter rows'), summary];
    const result = pickSections(sections, 'zzzz qqqq', { isAdmin: false });
    expect(result.map((s) => s.id)).toEqual(['summary']);
  });

  it('ranks by keyword overlap on heading and body, heading weighted 3x', () => {
    const sections = [
      summary,
      section('filters', 'Filters', 'Filters narrow rows. Calculated values are shown.'),
      section('margin', 'Net Margin', 'Revenue less cost.'),
    ];
    const result = pickSections(sections, 'how is net margin calculated', { isAdmin: false });
    expect(result.map((s) => s.id)).toEqual(['summary', 'margin', 'filters']);
  });

  it('ignores stop words and is case-insensitive', () => {
    const sections = [
      summary,
      section('stop', 'The Other', 'what how the and for is'),
      section('exp', 'EXPORT', 'Download CSV'),
    ];
    const result = pickSections(sections, 'How do I the export?', { isAdmin: false });
    expect(result.map((s) => s.id)).toEqual(['summary', 'exp']);
  });

  it('caps at maxSections, not counting the summary', () => {
    const sections = [summary, ...['a', 'b', 'c', 'd', 'e'].map((id) => section(id, `Topic ${id}`, 'metric'))];
    expect(pickSections(sections, 'metric', { isAdmin: false }).map((s) => s.id)).toEqual([
      'summary',
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(pickSections(sections, 'metric', { isAdmin: false, maxSections: 2 })).toHaveLength(3);
  });

  it('counts distinct query terms, so repeating one word does not win', () => {
    const sections = [
      summary,
      section('spam', 'Notes', 'target '.repeat(50)),
      section('broad', 'Notes', 'The target line compares the actual value with the goal.'),
    ];
    const result = pickSections(sections, 'target actual value', { isAdmin: false });
    expect(result.map((s) => s.id)).toEqual(['summary', 'broad', 'spam']);
  });

  it('counts a repeated heading word once', () => {
    const sections = [
      summary,
      section('rep', 'Export export export', 'nothing'),
      section('two', 'Export CSV', 'nothing'),
    ];
    const result = pickSections(sections, 'export csv', { isAdmin: false });
    expect(result.map((s) => s.id)).toEqual(['summary', 'two', 'rep']);
  });

  it('folds simple plurals: "filter" matches heading "Filters" and vice versa', () => {
    const sections = [summary, section('f', 'Filters', 'narrow the page'), section('x', 'Tiles', 'one filter')];
    expect(pickSections(sections, 'how does the filter work', { isAdmin: false }).map((s) => s.id)).toEqual([
      'summary',
      'f',
      'x',
    ]);
    expect(pickSections(sections, 'tile', { isAdmin: false }).map((s) => s.id)).toEqual(['summary', 'x']);
  });

  it('drops zero-score sections', () => {
    const sections = [summary, section('x', 'Unrelated', 'nothing here'), section('y', 'Metric', 'a metric')];
    const result = pickSections(sections, 'metric', { isAdmin: false });
    expect(result.map((s) => s.id)).toEqual(['summary', 'y']);
  });
  it('scores the previous turn too, so a follow-up like "How do I open it?" keeps its topic', () => {
    const sections = [
      summary,
      section('tile', 'Click a tile to open the report', 'A click on a tile opens its report.'),
      section('editor', 'Configuration editor', 'A Configure button in the header starts the editor.'),
    ];
    const previous = 'Can I edit tiles in an interface? Yes, in the configuration editor.';
    expect(pickSections(sections, 'How do I open it?', { isAdmin: false }).map((s) => s.id)).toEqual([
      'summary',
      'tile',
    ]);
    expect(pickSections(sections, 'How do I open it?', { isAdmin: false, previous }).map((s) => s.id)).toEqual([
      'summary',
      'tile',
      'editor',
    ]);
  });

  it('ranks a question word above several previous-turn words', () => {
    const sections = [
      summary,
      section('old', 'Notes', 'configuration editor tiles'),
      section('new', 'Notes', 'dash'),
    ];
    const result = pickSections(sections, 'What does a dash mean?', {
      isAdmin: false,
      maxSections: 1,
      previous: 'Where is the configuration editor for tiles?',
    });
    expect(result.map((s) => s.id)).toEqual(['summary', 'new']);
  });
});

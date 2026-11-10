import { describe, expect, it } from 'vitest';
import { formatPageContext, PAGE_CONTEXT_HEADER, type PageContext } from './page-context';

const HEADER = 'Values shown on the page right now. Treat these as authoritative for what the user sees.';

function ctx(over: Partial<PageContext> = {}): PageContext {
  return { pageName: 'Dashboard', groups: [], ...over };
}

describe('formatPageContext', () => {
  it('starts with the exact header', () => {
    expect(PAGE_CONTEXT_HEADER).toBe(HEADER);
    expect(formatPageContext(ctx()).startsWith(`${HEADER}\n\n`)).toBe(true);
  });

  it('prints the page with a route, or without one', () => {
    expect(formatPageContext(ctx({ route: '/x' }))).toBe(`${HEADER}\n\nPage: Dashboard (/x)`);
    expect(formatPageContext(ctx())).toBe(`${HEADER}\n\nPage: Dashboard`);
  });

  it('omits the Filters block when there are no filters', () => {
    expect(formatPageContext(ctx())).not.toContain('Filters:');
    expect(formatPageContext(ctx({ filters: [] }))).not.toContain('Filters:');
  });

  it('lists filters as "Label: v1, v2" and "All" when empty', () => {
    const out = formatPageContext(
      ctx({
        filters: [
          { label: 'Region', values: ['East', 'West'] },
          { label: 'Year', values: [] },
        ],
      }),
    );
    expect(out).toContain('\n\nFilters:\nRegion: East, West\nYear: All');
  });

  it('prints each group as a blank line, its title, then its items', () => {
    const out = formatPageContext(
      ctx({
        groups: [
          { title: 'Finance', items: [{ label: 'Revenue', value: '$1M', elementId: 7 }] },
          { title: 'Ops', items: [{ label: 'Cost', value: '$2M', elementId: 8 }] },
        ],
      }),
    );
    expect(out).toContain('\n\nFinance\n- Revenue (element 7): $1M\n\nOps\n- Cost (element 8): $2M');
  });

  it('appends details with " · " and omits "(element …)" without an elementId', () => {
    const out = formatPageContext(
      ctx({
        groups: [
          {
            title: 'G',
            items: [
              { label: 'A', value: '1', elementId: 5, details: ['target 2', 'as of Oct'] },
              { label: 'B', value: '2' },
              { label: 'C', value: '3', details: ['formula: x'] },
            ],
          },
        ],
      }),
    );
    expect(out).toContain('- A (element 5): 1 · target 2 · as of Oct');
    expect(out).toContain('\n- B: 2\n');
    expect(out).toContain('- C: 3 · formula: x');
  });

  it('prints the focus line with id and details, id only, or details only', () => {
    const line = (focus: PageContext['focus']) => formatPageContext(ctx({ focus })).split('\n').pop();
    expect(line({ label: 'Net', elementId: 9, details: ['segment: East', 'x'] })).toBe(
      'Viewing element: Net (element 9, segment: East, x)',
    );
    expect(line({ label: 'Net', elementId: 9 })).toBe('Viewing element: Net (element 9)');
    expect(line({ label: 'Net', details: ['segment: East'] })).toBe('Viewing element: Net (segment: East)');
    expect(formatPageContext(ctx())).not.toContain('Viewing element');
  });

  it('separates the focus line from the rest with a blank line', () => {
    expect(formatPageContext(ctx({ focus: { label: 'N', elementId: 1 } }))).toBe(
      `${HEADER}\n\nPage: Dashboard\n\nViewing element: N (element 1)`,
    );
  });
});

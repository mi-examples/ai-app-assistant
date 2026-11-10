export interface PageContextItem {
  label: string;
  value: string;
  elementId?: number;
  /** Free-form facts shown after the value, e.g. "target 2.67M", "as of 10/12/26". */
  details?: string[];
}

export interface PageContext {
  pageName: string;
  route?: string;
  /** Empty `values` print as "All". */
  filters?: { label: string; values: string[] }[];
  groups: { title: string; items: PageContextItem[] }[];
  /** The element being viewed, if the page is about one. */
  focus?: { label: string; elementId?: number; details?: string[] };
}

export const PAGE_CONTEXT_HEADER =
  'Values shown on the page right now. Treat these as authoritative for what the user sees.';

function formatItem(item: PageContextItem): string {
  const id = item.elementId !== undefined ? ` (element ${item.elementId})` : '';

  return [`- ${item.label}${id}: ${item.value}`, ...(item.details ?? [])].join(' · ');
}

function formatFocus(focus: NonNullable<PageContext['focus']>): string {
  const inner = [...(focus.elementId !== undefined ? [`element ${focus.elementId}`] : []), ...(focus.details ?? [])];
  const brackets = inner.length > 0 ? ` (${inner.join(', ')})` : '';

  return `Viewing element: ${focus.label}${brackets}`;
}

export function formatPageContext(c: PageContext): string {
  const lines = [PAGE_CONTEXT_HEADER, '', c.route ? `Page: ${c.pageName} (${c.route})` : `Page: ${c.pageName}`];

  if (c.filters && c.filters.length > 0) {
    lines.push('', 'Filters:');
    for (const f of c.filters) {
      lines.push(`${f.label}: ${f.values.length > 0 ? f.values.join(', ') : 'All'}`);
    }
  }

  for (const group of c.groups) {
    lines.push('', group.title);
    for (const item of group.items) lines.push(formatItem(item));
  }

  if (c.focus) lines.push('', formatFocus(c.focus));

  return lines.join('\n');
}

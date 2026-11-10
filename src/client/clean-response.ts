const JSON_BLOCK = /%BEGIN_JSON%[\s\S]*?%END_JSON%/g;
const BLOCK_BODY = /^%BEGIN_JSON%([\s\S]*)%END_JSON%$/;

/** Removes machine-readable %BEGIN_JSON%…%END_JSON% blocks and trims. */
export function cleanResponse(md: string): string {
  return md.replace(JSON_BLOCK, '').trim();
}

/** True when any JSON block is an object with a non-empty `error` or `status: "ERROR"`. */
export function hasJsonBlockError(md: string): boolean {
  for (const block of md.match(JSON_BLOCK) ?? []) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block.replace(BLOCK_BODY, '$1'));
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const { error, status } = parsed as { error?: unknown; status?: unknown };
    if (status === 'ERROR') return true;
    if (typeof error === 'string' ? error.trim() !== '' : error != null && error !== false) return true;
  }

  return false;
}

export type FoundItem = { type: string; name: string; url?: string };

/** Items and summary line from `search_results` blocks; Concierge's reply when it only searched. */
export function readSearchResults(md: string): { summary: string; items: FoundItem[] } {
  let summary = '';
  const items: FoundItem[] = [];
  for (const block of md.match(JSON_BLOCK) ?? []) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block.replace(BLOCK_BODY, '$1'));
    } catch {
      continue;
    }
    const b = parsed as { data_type?: unknown; data?: unknown; search_criteria_summary_phrase?: unknown } | null;
    if (!b || b.data_type !== 'search_results' || !Array.isArray(b.data)) continue;
    if (!summary && typeof b.search_criteria_summary_phrase === 'string')
      summary = b.search_criteria_summary_phrase.trim();
    for (const d of b.data as { type?: unknown; name?: unknown; url?: unknown }[]) {
      if (typeof d?.name !== 'string' || d.name.trim() === '') continue;
      const url = typeof d.url === 'string' ? sameSitePath(d.url) : undefined;
      items.push({ type: typeof d.type === 'string' ? d.type : '', name: d.name.trim(), ...(url ? { url } : {}) });
    }
  }

  return { summary, items };
}

/** Path of an http(s) URL, so links stay on the current host (dev proxy or the instance itself). */
function sameSitePath(url: string): string | undefined {
  try {
    const u = new URL(url, 'http://x');
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;

    // Parentheses would end a Markdown link target early.
    return `${u.pathname}${u.search}${u.hash}`.replace(/[()]/g, (c) => encodeURIComponent(c));
  } catch {
    return undefined;
  }
}

const escapeLinkText = (s: string) => s.replace(/[[\]\\]/g, '\\$&');

/** Markdown for a search-only reply: the summary line, then one bullet per item. */
export function formatSearchResults(summary: string, items: FoundItem[]): string {
  const lines = items.map((i) => (i.url ? `- [${escapeLinkText(i.name)}](${i.url})` : `- ${i.name}`));

  return `${summary || 'I found these results:'}\n\n${lines.join('\n')}`;
}

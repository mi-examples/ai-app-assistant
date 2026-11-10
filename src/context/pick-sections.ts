import type { KnowledgeSection } from './knowledge';

const DEFAULT_MAX_SECTIONS = 4;
const HEADING_WEIGHT = 3;
/** Weight of a previous-turn word against a word of the question itself. */
const PREVIOUS_WEIGHT = 0.25;

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'are',
  'but',
  'not',
  'you',
  'all',
  'can',
  'her',
  'was',
  'one',
  'our',
  'out',
  'has',
  'his',
  'how',
  'its',
  'who',
  'did',
  'does',
  'what',
  'when',
  'where',
  'why',
  'which',
  'with',
  'this',
  'that',
  'these',
  'those',
  'from',
  'have',
  'into',
  'about',
  'there',
  'their',
  'then',
  'than',
  'will',
  'would',
  'should',
  'could',
  'been',
  'being',
  'was',
  'were',
  'any',
  'some',
  'show',
  'tell',
  // Every question is about "this page", so the word says nothing about the topic.
  'page',
]);

// Simple plural fold: "filters" and "filter" match. Applied to both sides, so stems stay consistent.
const singular = (w: string): string => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
    .map(singular);
}

/** Number of distinct query terms present; repeats of one word count once. */
function countHits(tokens: string[], queryTerms: Set<string>): number {
  let hits = 0;
  for (const token of new Set(tokens)) if (queryTerms.has(token)) hits += 1;

  return hits;
}

const adminRank = (s: KnowledgeSection): number => (s.audience === 'all' ? 0 : 1);

export function pickSections(
  sections: KnowledgeSection[],
  question: string,
  opts: {
    isAdmin: boolean;
    maxSections?: number;
    /** The previous question and answer. Their words count at reduced weight, so "open it?" keeps the topic. */
    previous?: string;
  },
): KnowledgeSection[] {
  const max = opts.maxSections ?? DEFAULT_MAX_SECTIONS;
  const queryTerms = new Set(tokenize(question));
  const previousTerms = new Set(tokenize(opts.previous ?? '').filter((t) => !queryTerms.has(t)));
  const visible = sections.filter((s) => opts.isAdmin || s.audience === 'all');
  const hits = (s: KnowledgeSection, terms: Set<string>): number =>
    HEADING_WEIGHT * countHits(tokenize(s.heading), terms) + countHits(tokenize(s.body), terms);

  const summary = visible.find((s) => s.isSummary);
  const scored = visible
    .map((section, index) => ({
      section,
      index,
      score: hits(section, queryTerms) + PREVIOUS_WEIGHT * hits(section, previousTerms),
    }))
    .filter((entry) => !entry.section.isSummary && entry.score > 0)
    // On a tie, user-facing sections first: file order alone would put setup-guide.md ahead for admins.
    .sort((a, b) => b.score - a.score || adminRank(a.section) - adminRank(b.section) || a.index - b.index)
    .slice(0, Math.max(0, max))
    .map((entry) => entry.section);

  return summary ? [summary, ...scored] : scored;
}

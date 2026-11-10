import type { KnowledgeSection } from './knowledge';
import { formatPageContext, type PageContext } from './page-context';

const DEFAULT_BUDGET_BYTES = 8192;
const DEFAULT_PREPEND_BYTES = 1536;

const encoder = new TextEncoder();
const byteLength = (s: string): number => encoder.encode(s).length;

function renderSection(s: KnowledgeSection): string {
  return `## ${s.heading}\n${s.body}`;
}

function compose(sections: KnowledgeSection[], snapshot: PageContext | null): string {
  const parts: string[] = [];
  if (sections.length > 0) parts.push(`# App guide\n\n${sections.map(renderSection).join('\n\n')}`);
  if (snapshot) parts.push(`# Page snapshot\n\n${formatPageContext(snapshot)}`);

  return parts.join('\n\n');
}

export function buildContext(input: {
  snapshot: PageContext | null;
  sections: KnowledgeSection[];
  elementId: number | null;
  budgetBytes?: number;
}): { context: string; text: string; usedSections: KnowledgeSection[] } {
  const budget = input.budgetBytes ?? DEFAULT_BUDGET_BYTES;
  const used = [...input.sections];
  let text = compose(used, input.snapshot);

  while (byteLength(text) > budget) {
    let idx = -1;
    for (let i = used.length - 1; i >= 0; i--) {
      if (!used[i].isSummary) {
        idx = i;
        break;
      }
    }
    if (idx === -1) break;
    used.splice(idx, 1);
    text = compose(used, input.snapshot);
  }

  const inner = JSON.stringify({ element_id: input.elementId ?? 0, context: text });

  return { context: JSON.stringify({ EmbedElement: inner }), text, usedSections: used };
}

const GUIDE_LINE = 'App guide (use it to answer questions about this page):';
const MIN_SNAPSHOT_BYTES = 200;

/**
 * Prefix sent ahead of the question. Budget priority: the top guide section, then the page snapshot
 * (whole lines only, header first), then further sections, then the summary. Output order stays
 * sections first, snapshot last.
 */
export function buildQuestionPrefix(input: {
  sections: KnowledgeSection[];
  snapshot: PageContext | null;
  maxBytes?: number;
}): { text: string; usedSections: KnowledgeSection[] } {
  const separator = '\n\n';
  const sepBytes = byteLength(separator);
  let remaining = (input.maxBytes ?? DEFAULT_PREPEND_BYTES) - byteLength(GUIDE_LINE);
  const picked = new Set<KnowledgeSection>();

  const tryAdd = (s: KnowledgeSection): void => {
    const cost = byteLength(renderSection(s)) + sepBytes;
    if (cost > remaining) return;
    remaining -= cost;
    picked.add(s);
  };
  const nonSummary = input.sections.filter((s) => !s.isSummary);
  const summaries = input.sections.filter((s) => s.isSummary);

  if (nonSummary.length > 0) tryAdd(nonSummary[0]);

  let snapshotText = '';
  if (input.snapshot && remaining - sepBytes >= MIN_SNAPSHOT_BYTES) {
    let room = remaining - sepBytes;
    const kept: string[] = [];
    for (const line of formatPageContext(input.snapshot).split('\n')) {
      const cost = byteLength(line) + (kept.length > 0 ? 1 : 0);
      if (cost > room) break;
      room -= cost;
      kept.push(line);
    }
    while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop();
    if (kept.length > 0) {
      snapshotText = kept.join('\n');
      remaining -= byteLength(snapshotText) + sepBytes;
    }
  }

  for (const s of nonSummary.slice(1)) tryAdd(s);
  for (const s of summaries) tryAdd(s);

  const used = [...nonSummary, ...summaries].filter((s) => picked.has(s));
  const parts = used.map(renderSection);
  if (snapshotText) parts.push(snapshotText);
  if (parts.length === 0) return { text: '', usedSections: [] };

  return { text: [GUIDE_LINE, ...parts].join(separator), usedSections: used };
}

const EARLIER_ANSWER_MAX = 400;

/**
 * The previous question and answer as one line, for a Concierge request that follows a page answer:
 * Concierge never saw that turn, so "it" in the new question would point at its own last topic.
 */
export function earlierTurnLine(turn: { question: string; answer: string }): string {
  const answer = turn.answer
    .replace(/\s*\[\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = answer.length > EARLIER_ANSWER_MAX ? `${answer.slice(0, EARLIER_ANSWER_MAX)}…` : answer;

  return `Earlier in this chat the user asked: "${turn.question.trim()}" The answer was: "${cut}"`;
}

import { FORWARD_MARKER, type ChatTurn } from '../client/llm-proxy';
import type { KnowledgeSection } from './knowledge';
import { formatPageContext, type PageContext } from './page-context';

export type PromptSource = { n: number; label: string; detail: string };

const DEFAULT_MAX_BYTES = 24_576;
const MAX_HISTORY_TURNS = 6;

const encoder = new TextEncoder();
const byteLength = (s: string): number => encoder.encode(s).length;

function rules(pageName: string, snapshotSent: boolean): string {
  const lines = [
    `You are the Page Assistant for the page "${pageName}".`,
    '',
    'Rules:',
    '- Answer only from the App guide and the Page snapshot below. Never invent settings, columns, menu' +
      ' paths or numbers.',
    '- Keep answers short and use Markdown. Quote numbers exactly as the page shows them.',
    '- Cite guide sections and the page with their bracket numbers from the source list, e.g. [1],' +
      ' right after the claim they support.',
    '- If the App guide and the Page snapshot do not fully answer the question, reply with' +
      ` ${FORWARD_MARKER} followed by the question rewritten so it stands on its own, and nothing else:` +
      ' replace words like "it" or "that" with what they mean in this conversation, and keep it to one' +
      ' line ending in "?". That includes report data not in the snapshot (history or' +
      ' trends, values for other periods, breakdowns by a dimension, rows of a report), how a metric is' +
      ' defined or calculated beyond what the guide says, and finding other reports or datasets in Metric' +
      ' Insights. Never reply that the page or guide does not cover something.',
  ];
  if (!snapshotSent) {
    lines.push(
      '- The page snapshot was not shared. If a question needs values shown on the page, reply with one' +
        ' sentence asking the user to turn "Page data" on. Do not reply with the marker for such a question.',
    );
  }

  return lines.join('\n');
}

function compose(input: { pageName: string; sections: KnowledgeSection[]; snapshotText: string | null }): {
  text: string;
  sources: PromptSource[];
} {
  const sources: PromptSource[] = [];
  if (input.snapshotText !== null) {
    sources.push({ n: 1, label: 'On this page', detail: input.pageName });
  }
  const guide: string[] = [];
  for (const s of input.sections) {
    if (s.isSummary) {
      guide.push(`## ${s.heading}\n${s.body}`);
      continue;
    }
    const n = sources.length + 1;
    sources.push({ n, label: 'App guide', detail: `§ ${s.heading}` });
    guide.push(`## [${n}] ${s.heading}\n${s.body}`);
  }

  const sourceLines = sources.map((s) =>
    s.label === 'On this page' ? `[${s.n}] ${s.label} · ${s.detail}` : `[${s.n}] ${s.label} ${s.detail}`,
  );
  const parts = [rules(input.pageName, input.snapshotText !== null)];
  if (sourceLines.length > 0) parts.push(`Sources:\n${sourceLines.join('\n')}`);
  if (guide.length > 0) parts.push(`# App guide\n\n${guide.join('\n\n')}`);
  if (input.snapshotText !== null) parts.push(`# Page snapshot\n\n${input.snapshotText}`);

  return { text: parts.join('\n\n'), sources };
}

export function buildProxyMessages(input: {
  question: string;
  sections: KnowledgeSection[];
  snapshot: PageContext | null;
  pageName: string;
  history: { question: string; answer: string }[];
  maxBytes?: number;
}): { messages: ChatTurn[]; sources: PromptSource[]; usedSections: KnowledgeSection[]; snapshotSent: boolean } {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const used = [...input.sections];
  const snapshotLines = input.snapshot ? formatPageContext(input.snapshot).split('\n') : null;
  let keep = snapshotLines ? snapshotLines.length : 0;

  const snapshotText = (): string | null => {
    if (!snapshotLines || keep === 0) return null;
    const kept = snapshotLines.slice(0, keep);
    while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop();

    return kept.length > 0 ? kept.join('\n') : null;
  };
  const build = () => compose({ pageName: input.pageName, sections: used, snapshotText: snapshotText() });

  let built = build();
  // Lowest-ranked (last) non-summary sections go first.
  while (byteLength(built.text) > maxBytes) {
    let idx = -1;
    for (let i = used.length - 1; i >= 0; i--) {
      if (!used[i].isSummary) {
        idx = i;
        break;
      }
    }
    if (idx === -1) break;
    used.splice(idx, 1);
    built = build();
  }
  // Then cut the snapshot at whole lines.
  while (byteLength(built.text) > maxBytes && keep > 0) {
    keep--;
    built = build();
  }

  const history = input.history.slice(-MAX_HISTORY_TURNS).flatMap<ChatTurn>((h) => [
    { role: 'user', content: h.question },
    { role: 'assistant', content: h.answer },
  ]);

  return {
    messages: [{ role: 'system', content: built.text }, ...history, { role: 'user', content: input.question }],
    sources: built.sources,
    usedSections: used,
    snapshotSent: snapshotText() !== null,
  };
}

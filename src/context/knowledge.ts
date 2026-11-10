export type Audience = 'all' | 'admin';

export interface KnowledgeSection {
  id: string;
  file: string;
  heading: string;
  body: string;
  audience: Audience;
  isSummary: boolean;
}

export interface KnowledgeFile {
  name: string;
  raw: string;
}

export interface KnowledgePack {
  sections: KnowledgeSection[];
  suggested: string[];
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const AUDIENCE_COMMENT = /^<!--\s*audience\s*:(.*?)-->$/i;
const DEFAULT_SUMMARY_FILE = 'user-guide.md';
const NOTE_COMMENT = /<!--(?!\s*audience\s*:)[\s\S]*?-->/gi;
const NOTE_MARK = '\u0000';

/** Removes author-note comments (not audience comments); lines left empty only by a removal are dropped. */
function stripNotes(content: string): string {
  return content
    .replace(NOTE_COMMENT, NOTE_MARK)
    .split(/\r?\n/)
    .flatMap((line) => {
      if (!line.includes(NOTE_MARK)) return [line];
      const rest = line.split(NOTE_MARK).join('');

      return rest.trim() === '' ? [] : [rest.trimEnd()];
    })
    .join('\n');
}

function toAudience(value: string): Audience {
  return value.trim().toLowerCase() === 'all' ? 'all' : 'admin';
}

interface FrontMatter {
  audience: Audience;
  suggested: string[];
  summary: boolean;
  content: string;
}

function parseFrontMatter(raw: string): FrontMatter {
  const match = FRONT_MATTER.exec(raw);
  if (!match) return { audience: 'all', suggested: [], summary: false, content: raw };

  let summary = false;
  let audience: Audience = 'all';
  const suggested: string[] = [];
  let inSuggested = false;
  for (const line of match[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (inSuggested && item) {
      const text = item[1].trim();
      if (text) suggested.push(text);
      continue;
    }
    inSuggested = false;
    const audienceMatch = /^audience\s*:(.*)$/i.exec(line);
    const summaryMatch = /^summary\s*:(.*)$/i.exec(line);
    if (audienceMatch) audience = toAudience(audienceMatch[1]);
    else if (summaryMatch) summary = summaryMatch[1].trim().toLowerCase() === 'true';
    else if (/^suggested:\s*$/.test(line)) inSuggested = true;
  }

  return { audience, suggested, summary, content: raw.slice(match[0].length) };
}

function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseFile(file: KnowledgeFile, isSummaryFile: boolean): { sections: KnowledgeSection[]; suggested: string[] } {
  const { audience, suggested, content: rawContent } = parseFrontMatter(file.raw);
  const content = stripNotes(rawContent);
  const base = file.name.replace(/\.md$/, '');
  const sections: KnowledgeSection[] = [];

  const parts = content.split(/^## /m);
  const preamble = parts[0]
    .split(/\r?\n/)
    .filter((l) => !/^#\s/.test(l))
    .join('\n')
    .trim()
    .split(/\r?\n\s*\r?\n/)[0]
    .trim();
  if (isSummaryFile && preamble) {
    sections.push({
      id: `${base}/summary`,
      file: file.name,
      heading: 'Summary',
      body: preamble,
      audience: 'all',
      isSummary: true,
    });
  }

  for (const part of parts.slice(1)) {
    const newline = part.indexOf('\n');
    const heading = (newline === -1 ? part : part.slice(0, newline)).trim();
    const lines = (newline === -1 ? '' : part.slice(newline + 1)).split(/\r?\n/);
    let sectionAudience = audience;
    const first = lines.findIndex((l) => l.trim() !== '');
    if (first !== -1) {
      const override = AUDIENCE_COMMENT.exec(lines[first].trim());
      if (override) {
        sectionAudience = toAudience(override[1]);
        lines.splice(first, 1);
      }
    }
    sections.push({
      id: `${base}/${slugify(heading)}`,
      file: file.name,
      heading,
      body: lines.join('\n').trim(),
      audience: sectionAudience,
      isSummary: false,
    });
  }

  return { sections, suggested };
}

export function parseKnowledge(files: KnowledgeFile[]): KnowledgePack {
  const sections: KnowledgeSection[] = [];
  const suggested: string[] = [];
  const flagged = files.find((f) => parseFrontMatter(f.raw).summary);
  const summaryName = flagged ? flagged.name : DEFAULT_SUMMARY_FILE;
  for (const file of files) {
    const parsed = parseFile(file, file === flagged || (!flagged && file.name === summaryName));
    sections.push(...parsed.sections);
    for (const q of parsed.suggested) if (!suggested.includes(q)) suggested.push(q);
  }

  return { sections, suggested };
}

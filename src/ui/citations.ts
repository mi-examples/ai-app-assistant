// A run of one or more adjacent [n], e.g. "[1][2]". Links, reference links and [[x]] are excluded by the guards.
const CITE_RUN = / ?(?<![[\]])((?:\[\d+\])+)(?![([\]:])/g;

function rewriteInline(segment: string, count: number): string {
  return segment.replace(CITE_RUN, (match, run: string) => {
    const badges = [...run.matchAll(/\[(\d+)\]/g)]
      .map((m) => Number(m[1]))
      .filter((n) => n >= 1 && n <= count)
      .map((n) => `[${n}](#aic-cite-${n})`)
      .join('');
    if (!badges) return '';

    return (match.startsWith(' ') ? ' ' : '') + badges;
  });
}

function rewriteLine(line: string, count: number): string {
  // Odd entries of the split are inline code spans (kept verbatim).
  return line
    .split(/(`+[^`]*`+)/)
    .map((part, i) => (i % 2 === 1 ? part : rewriteInline(part, count)))
    .join('');
}

/**
 * Rewrites [n] (1 ≤ n ≤ count) outside code into a link with href `#aic-cite-n`; removes out-of-range [n].
 * Leaves markdown links `[text](url)` and code spans/fences untouched.
 */
export function prepareCitations(text: string, count: number): string {
  let fence: string | null = null;

  return text
    .split('\n')
    .map((line) => {
      const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;

        return line;
      }
      if (marker) {
        fence = marker;

        return line;
      }

      return rewriteLine(line, count);
    })
    .join('\n');
}

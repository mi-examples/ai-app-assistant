import { describe, expect, it } from 'vitest';
import { cleanResponse } from './clean-response';

describe('cleanResponse', () => {
  it('strips %BEGIN_JSON%…%END_JSON% blocks, including multiline, and trims', () => {
    const md = 'Hello\n%BEGIN_JSON%\n{"a":1,\n"b":2}\n%END_JSON%\nWorld  \n';
    expect(cleanResponse(md)).toBe('Hello\n\nWorld');
  });

  it("returns '' for whitespace-only", () => {
    expect(cleanResponse('  \n\t ')).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { prepareCitations } from './citations';

describe('prepareCitations', () => {
  it('turns in-range [n] into cite links', () => {
    expect(prepareCitations('A [1] and B [3].', 3)).toBe('A [1](#aic-cite-1) and B [3](#aic-cite-3).');
  });

  it('removes out-of-range [n] with one preceding space', () => {
    expect(prepareCitations('Value [7].', 3)).toBe('Value.');
    expect(prepareCitations('Value [0] x', 3)).toBe('Value x');
  });

  it('badges stacked citations and drops unknown ones', () => {
    expect(prepareCitations('A [1][2].', 2)).toBe('A [1](#aic-cite-1)[2](#aic-cite-2).');
    expect(prepareCitations('A [1][9].', 3)).toBe('A [1](#aic-cite-1).');
    expect(prepareCitations('A [9][8].', 3)).toBe('A.');
    expect(prepareCitations('A [2][1].', 2)).toBe('A [2](#aic-cite-2)[1](#aic-cite-1).');
  });

  it('leaves reference links alone', () => {
    expect(prepareCitations('[text][1]', 3)).toBe('[text][1]');
    expect(prepareCitations('[1][ref]', 3)).toBe('[1][ref]');
  });

  it('leaves code spans and fences untouched', () => {
    expect(prepareCitations('use `arr[1]` here', 3)).toBe('use `arr[1]` here');
    const fenced = 'x\n```\nfoo[1]\n```\ny';
    expect(prepareCitations(fenced, 3)).toBe(fenced);
  });

  it('leaves markdown links and [[CONCIERGE]] alone', () => {
    expect(prepareCitations('[label](https://x)', 3)).toBe('[label](https://x)');
    expect(prepareCitations('[1](https://x)', 3)).toBe('[1](https://x)');
    expect(prepareCitations('[[CONCIERGE]]', 3)).toBe('[[CONCIERGE]]');
    expect(prepareCitations('[[1]]', 3)).toBe('[[1]]');
  });
});

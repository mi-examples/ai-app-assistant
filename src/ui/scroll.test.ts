import { describe, expect, it } from 'vitest';
import { answerScrollTop } from './scroll';

describe('answerScrollTop', () => {
  it('scrolls to the bottom when the question and answer fit in view', () => {
    expect(answerScrollTop({ viewHeight: 400, scrollHeight: 900, questionTop: 500, answerBottom: 850 })).toBe(900);
  });

  it('puts the question at the top, with a small gap, when the answer is taller than the view', () => {
    expect(answerScrollTop({ viewHeight: 400, scrollHeight: 1600, questionTop: 500, answerBottom: 1500 })).toBe(488);
  });

  it('never goes above the top', () => {
    expect(answerScrollTop({ viewHeight: 400, scrollHeight: 1600, questionTop: 4, answerBottom: 1500 })).toBe(0);
  });
});

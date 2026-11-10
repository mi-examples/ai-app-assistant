/** Space kept above a question lined up at the top of the list. */
export const SCROLL_GAP = 12;

/**
 * Where to scroll the message list once an answer arrives: to the bottom when the question and its answer fit
 * in view, otherwise so the question sits at the top and the answer is read from its first line.
 * Positions are in the list's scroll coordinates.
 */
export function answerScrollTop(i: {
  viewHeight: number;
  scrollHeight: number;
  questionTop: number;
  answerBottom: number;
}): number {
  if (i.answerBottom - i.questionTop + SCROLL_GAP <= i.viewHeight) return i.scrollHeight;

  return Math.max(0, i.questionTop - SCROLL_GAP);
}

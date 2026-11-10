import { describe, expect, it } from 'vitest';
import { DEFAULT_LABELS, resolveLabels } from './types';

describe('resolveLabels', () => {
  it('overrides only the given labels', () => {
    expect(resolveLabels({ title: 'Ask' })).toEqual({ ...DEFAULT_LABELS, title: 'Ask' });
  });

  it('keeps the default when a label is undefined', () => {
    expect(resolveLabels({ title: undefined }).title).toBe(DEFAULT_LABELS.title);
  });
});

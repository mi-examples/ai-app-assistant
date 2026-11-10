import { describe, expect, it } from 'vitest';
import { createPageContextStore } from './page-context-store';
import type { PageContext } from './page-context';

describe('createPageContextStore', () => {
  it('is null until set, then returns the last value', () => {
    const store = createPageContextStore();
    expect(store.get()).toBeNull();
    const a: PageContext = { pageName: 'A', groups: [] };
    const b: PageContext = { pageName: 'B', groups: [] };
    store.set(a);
    store.set(b);
    expect(store.get()).toBe(b);
    store.set(null);
    expect(store.get()).toBeNull();
  });

  it('keeps stores independent', () => {
    const one = createPageContextStore();
    const two = createPageContextStore();
    one.set({ pageName: 'A', groups: [] });
    expect(two.get()).toBeNull();
  });
});

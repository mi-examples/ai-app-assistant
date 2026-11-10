import type { PageContext } from './page-context';

/** Holds the page's current values for `getPageContext`; the page calls `set` as its data changes. */
export function createPageContextStore(): { set(c: PageContext | null): void; get(): PageContext | null } {
  let current: PageContext | null = null;

  return {
    set(c) {
      current = c;
    },
    get() {
      return current;
    },
  };
}

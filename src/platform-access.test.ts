import { afterEach, describe, expect, it } from 'vitest';
import { isConciergeAllowed } from './platform-access';

const win = globalThis as unknown as { window?: { globalSettings?: unknown } };
const setSettings = (v: unknown) => (win.window = v === undefined ? {} : { globalSettings: v });

afterEach(() => {
  delete win.window;
});

describe('isConciergeAllowed', () => {
  it('allows when globalSettings or window is absent (the get-tools probe stays the fallback)', () => {
    expect(isConciergeAllowed(false)).toBe(true);
    setSettings(undefined);
    expect(isConciergeAllowed(false)).toBe(true);
    setSettings({});
    expect(isConciergeAllowed(false)).toBe(true);
    setSettings({ userAuth: null });
    expect(isConciergeAllowed(false)).toBe(true);
  });

  it('conciergeInfo: disabled hides for everyone', () => {
    for (const enabled of [false, 0, undefined, null]) {
      setSettings({ userAuth: { conciergeInfo: { enabled, showOn: true } } });
      expect(isConciergeAllowed(true)).toBe(false);
      expect(isConciergeAllowed(false)).toBe(false);
    }
  });

  it('conciergeInfo: enabled allows an admin regardless of showOn', () => {
    setSettings({ userAuth: { conciergeInfo: { enabled: true, showOn: false } } });
    expect(isConciergeAllowed(true)).toBe(true);
  });

  it('conciergeInfo: enabled follows showOn for everyone else', () => {
    setSettings({ userAuth: { conciergeInfo: { enabled: true, showOn: false } } });
    expect(isConciergeAllowed(false)).toBe(false);
    setSettings({ userAuth: { conciergeInfo: { enabled: true } } });
    expect(isConciergeAllowed(false)).toBe(false);
    setSettings({ userAuth: { conciergeInfo: { enabled: true, showOn: 'all' } } });
    expect(isConciergeAllowed(false)).toBe(true);
  });

  it('older cores: ENABLE_CONCIERGE === false hides; anything else allows', () => {
    setSettings({ userAuth: { configuration: { constants: { ENABLE_CONCIERGE: false } } } });
    expect(isConciergeAllowed(true)).toBe(false);
    setSettings({ userAuth: { configuration: { constants: { ENABLE_CONCIERGE: true } } } });
    expect(isConciergeAllowed(false)).toBe(true);
    setSettings({ userAuth: { configuration: { constants: {} } } });
    expect(isConciergeAllowed(false)).toBe(true);
    setSettings({ userAuth: { configuration: null } });
    expect(isConciergeAllowed(false)).toBe(true);
  });

  it('conciergeInfo wins over the older constant', () => {
    setSettings({
      userAuth: {
        conciergeInfo: { enabled: true, showOn: true },
        configuration: { constants: { ENABLE_CONCIERGE: false } },
      },
    });
    expect(isConciergeAllowed(false)).toBe(true);
  });
});

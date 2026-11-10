// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiAppAssistant } from './ai-app-assistant';
import type { AiAppAssistantProps, AssistantModule } from './ai-app-assistant';
import type { ConciergeClient } from './client/concierge-client';

vi.mock('./ui/styles.scss?inline', () => ({ default: '.aic-test{}' }));

const client = (): ConciergeClient => ({
  getTools: vi.fn().mockResolvedValue(['search']),
  ask: vi.fn().mockResolvedValue({ answer: 'x', relatedReports: [] }),
  feedback: vi.fn().mockResolvedValue(undefined),
});

const page: AssistantModule = {
  assistantSetup: { knowledge: { sections: [], suggested: ['What is on this page?'] } },
};

const props = (load: AiAppAssistantProps['load']): AiAppAssistantProps => ({
  load,
  isAdmin: false,
  pageName: 'Sales',
  proxy: null,
  client: client(),
});

const host = () => document.querySelector('[data-aic-host]') as HTMLElement | null;
const $ = (sel: string) => host()?.shadowRoot?.querySelector(sel) as HTMLElement | null;
const settle = () => act(async () => undefined);

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AiAppAssistant (loader)', () => {
  it("loads the page's setup and renders the assistant with it", async () => {
    const load = vi.fn().mockResolvedValue(page);
    render(<AiAppAssistant {...props(load)} />);
    await waitFor(() => expect($('.aic-launcher')).toBeTruthy());
    act(() => $('.aic-launcher')!.click());
    expect($('.aic-panel')?.textContent).toContain('What is on this page?');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('loads once across re-renders, even with a new load function each time', async () => {
    const load = vi.fn().mockResolvedValue(page);
    const { rerender } = render(<AiAppAssistant {...props(() => load())} />);
    await waitFor(() => expect($('.aic-launcher')).toBeTruthy());
    rerender(<AiAppAssistant {...props(() => load())} />);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('enabled={false}: nothing is loaded or shown', async () => {
    const load = vi.fn().mockResolvedValue(page);
    render(<AiAppAssistant {...props(load)} enabled={false} />);
    await settle();
    expect(load).not.toHaveBeenCalled();
    expect(host()).toBeNull();
  });

  it('a failed load renders nothing and leaves the app alone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const load = vi.fn().mockRejectedValue(new Error('chunk failed'));
    const { container } = render(
      <div>
        <span>app</span>
        <AiAppAssistant {...props(load)} />
      </div>,
    );
    await waitFor(() => expect(warn).toHaveBeenCalledWith('[ai-app-assistant] failed to load', expect.any(Error)));
    expect(container.innerHTML).toBe('<div><span>app</span></div>');
    expect(host()).toBeNull();
  });

  it('an error in the loaded assistant renders nothing and leaves the app alone', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(HTMLElement.prototype, 'attachShadow').mockImplementation(() => {
      throw new Error('boom');
    });
    const { container } = render(
      <div>
        <span>app</span>
        <AiAppAssistant {...props(vi.fn().mockResolvedValue(page))} />
      </div>,
    );
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith('[ai-app-assistant] disabled after error', expect.any(Error)),
    );
    expect(container.innerHTML).toBe('<div><span>app</span></div>');
  });

  describe('platform Concierge switch (window.globalSettings.userAuth)', () => {
    const w = window as unknown as { globalSettings?: unknown };
    afterEach(() => {
      delete w.globalSettings;
    });

    it('off for this user: nothing is loaded or shown', async () => {
      w.globalSettings = { userAuth: { conciergeInfo: { enabled: true, showOn: false } } };
      const load = vi.fn().mockResolvedValue(page);
      render(<AiAppAssistant {...props(load)} />);
      await settle();
      expect(load).not.toHaveBeenCalled();
      expect(host()).toBeNull();
    });

    it('an admin still gets it when showOn is off', async () => {
      w.globalSettings = { userAuth: { conciergeInfo: { enabled: true, showOn: false } } };
      render(<AiAppAssistant {...props(vi.fn().mockResolvedValue(page))} isAdmin />);
      await waitFor(() => expect($('.aic-launcher')).toBeTruthy());
    });
  });
});

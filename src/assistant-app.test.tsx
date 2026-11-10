// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantApp } from './assistant-app';
import type { AssistantAppProps } from './assistant-app';
import { ConciergeError } from './client/concierge-client';
import type { ConciergeClient } from './client/concierge-client';
import type { LlmProxyClient } from './client/llm-proxy';
import * as llmProxy from './client/llm-proxy';
import * as pkg from './index';

vi.mock('./ui/styles.scss?inline', () => ({ default: '.aic-test{}' }));

const client = (getTools: ConciergeClient['getTools']): ConciergeClient => ({
  getTools,
  ask: vi.fn().mockResolvedValue({ answer: 'x', relatedReports: [] }),
  feedback: vi.fn().mockResolvedValue(undefined),
});

const props = (c: ConciergeClient): AssistantAppProps => ({
  knowledge: { sections: [], suggested: [] },
  isAdmin: false,
  getPageContext: () => null,
  getElementId: () => null,
  pageName: 'Sales',
  proxy: null,
  client: c,
});

const host = () => document.querySelector('[data-aic-host]') as HTMLElement | null;
const $ = (sel: string) => host()?.shadowRoot?.querySelector(sel) as HTMLElement | null;
const escape = () => new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true });
const key = (init: KeyboardEventInit) => act(() => void window.dispatchEvent(new KeyboardEvent('keydown', init)));

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

describe('AssistantApp', () => {
  it('renders inside a shadow root on a data-aic-host element', async () => {
    render(<AssistantApp {...props(client(vi.fn().mockResolvedValue(['search'])))} />);
    await waitFor(() => expect($('.aic-launcher')).toBeTruthy());
    expect(host()?.shadowRoot?.querySelector('style')?.textContent).toContain('.aic-test');
    expect($('.aic-launcher')?.textContent).toContain('Ask about this page');
  });

  it('removes its host on unmount', async () => {
    const { unmount } = render(<AssistantApp {...props(client(vi.fn().mockResolvedValue(['search'])))} />);
    await waitFor(() => expect(host()).toBeTruthy());
    unmount();
    expect(host()).toBeNull();
  });

  it('renders nothing when the probe fails with unavailable', async () => {
    const getTools = vi.fn().mockRejectedValue(new ConciergeError('unavailable'));
    render(<AssistantApp {...props(client(getTools))} />);
    await waitFor(() => expect(getTools).toHaveBeenCalled());
    await act(async () => undefined);
    expect($('.aic-launcher')).toBeNull();
  });

  it('does not hijack Ctrl+K while the probe is unavailable', async () => {
    const getTools = vi.fn().mockRejectedValue(new ConciergeError('unavailable'));
    render(<AssistantApp {...props(client(getTools))} />);
    await waitFor(() => expect(getTools).toHaveBeenCalled());
    await act(async () => undefined);
    const ev = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
    act(() => void window.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(false);
  });

  it('an error inside the shadow root renders nothing and leaves the app alone', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const getTools = vi.fn().mockResolvedValue(['search']);
    const broken = { ...props(client(getTools)), knowledge: { sections: [], suggested: null } };
    const { getByText } = render(
      <div>
        <span>app</span>
        <AssistantApp {...(broken as unknown as AssistantAppProps)} />
      </div>,
    );
    await waitFor(() => expect(getTools).toHaveBeenCalled());
    await act(async () => undefined);
    expect(getByText('app')).toBeTruthy();
    expect($('.aic-root')).toBeNull();
    expect(warn).toHaveBeenCalledWith('[ai-app-assistant] disabled after error', expect.any(Error));
    vi.restoreAllMocks();
  });

  it('with no_sources still renders and shows the 403 copy on open', async () => {
    render(<AssistantApp {...props(client(vi.fn().mockRejectedValue(new ConciergeError('no_sources'))))} />);
    await waitFor(() => expect($('.aic-launcher')).toBeTruthy());
    act(() => $('.aic-launcher')!.click());
    expect($('.aic-panel')?.textContent).toContain("You don't have access to any Concierge sources.");
  });

  it('an instance with only external sources shows the no-access copy', async () => {
    render(<AssistantApp {...props(client(vi.fn().mockResolvedValue(['Snowflake', 'databricks'])))} />);
    await waitFor(() => expect($('.aic-launcher')).toBeTruthy());
    act(() => $('.aic-launcher')!.click());
    expect($('.aic-panel')?.textContent).toContain("You don't have access to any Concierge sources.");
  });

  it('an app that opts into an external source gets a working panel', async () => {
    render(
      <AssistantApp {...props(client(vi.fn().mockResolvedValue(['Snowflake'])))} sources={['search', 'Snowflake']} />,
    );
    await waitFor(() => expect($('.aic-launcher')).toBeTruthy());
    act(() => $('.aic-launcher')!.click());
    expect($('.aic-panel')?.textContent).not.toContain("You don't have access to any Concierge sources.");
  });

  it('launcher opens the panel and focuses the composer', async () => {
    render(<AssistantApp {...props(client(vi.fn().mockResolvedValue(['search'])))} />);
    await waitFor(() => expect($('.aic-launcher')).toBeTruthy());
    expect($('.aic-panel--open')).toBeNull();
    act(() => $('.aic-launcher')!.click());
    expect($('.aic-panel--open')).toBeTruthy();
    expect(host()!.shadowRoot!.activeElement).toBe($('textarea'));
  });

  it('Cmd+K and Ctrl+K toggle; Escape closes and returns focus to the launcher', async () => {
    render(<AssistantApp {...props(client(vi.fn().mockResolvedValue(['search'])))} />);
    await waitFor(() => expect($('.aic-launcher')).toBeTruthy());
    key({ key: 'k', metaKey: true });
    expect($('.aic-panel--open')).toBeTruthy();
    key({ key: 'k', ctrlKey: true });
    expect($('.aic-panel--open')).toBeNull();
    key({ key: 'k', ctrlKey: true });
    expect($('.aic-panel--open')).toBeTruthy();
    act(() => void $('textarea')!.dispatchEvent(escape()));
    expect($('.aic-panel--open')).toBeNull();
    expect(host()!.shadowRoot!.activeElement).toBe($('.aic-launcher'));
  });

  it("ignores Escape aimed at the app's own overlays", async () => {
    render(
      <div>
        <input aria-label="app field" />
        <AssistantApp {...props(client(vi.fn().mockResolvedValue(['search'])))} />
      </div>,
    );
    await waitFor(() => expect($('.aic-launcher')).toBeTruthy());
    act(() => $('.aic-launcher')!.click());
    const appField = document.querySelector('input[aria-label="app field"]') as HTMLInputElement;
    appField.focus();
    act(() => void appField.dispatchEvent(escape()));
    expect($('.aic-panel--open')).toBeTruthy();
    key({ key: 'Escape' });
    expect($('.aic-panel--open')).toBeTruthy();
  });

  it('does not pull focus to the launcher when closing with focus outside the panel', async () => {
    render(
      <div>
        <input aria-label="app field" />
        <AssistantApp {...props(client(vi.fn().mockResolvedValue(['search'])))} />
      </div>,
    );
    await waitFor(() => expect($('.aic-launcher')).toBeTruthy());
    key({ key: 'k', ctrlKey: true });
    expect($('.aic-panel--open')).toBeTruthy();
    const appField = document.querySelector('input[aria-label="app field"]') as HTMLInputElement;
    appField.focus();
    key({ key: 'k', ctrlKey: true });
    expect($('.aic-panel--open')).toBeNull();
    expect(document.activeElement).toBe(appField);
  });

  describe('LLM proxy wiring', () => {
    const type = async (c: ConciergeClient, extra: Partial<AssistantAppProps>) => {
      render(<AssistantApp {...props(c)} {...extra} />);
      await waitFor(() => expect($('.aic-launcher')).toBeTruthy());
      act(() => $('.aic-launcher')!.click());
      const ta = $('textarea') as HTMLTextAreaElement;
      act(() => {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
        set.call(ta, 'how do targets work?');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      });
      act(() => $('[aria-label="Send"]')!.click());
    };

    it('creates one proxy client by default and routes questions through it', async () => {
      const fake: LlmProxyClient = { ask: vi.fn().mockResolvedValue({ kind: 'answer', text: 'from proxy' }) };
      const spy = vi.spyOn(llmProxy, 'createLlmProxyClient').mockReturnValue(fake);
      const c = client(vi.fn().mockResolvedValue(['search']));
      const p = props(c);
      delete p.proxy;
      const { rerender } = render(<AssistantApp {...p} />);
      await waitFor(() => expect($('.aic-launcher')).toBeTruthy());
      rerender(<AssistantApp {...p} />);
      expect(spy).toHaveBeenCalledTimes(1);
      cleanup();
      await type(c, { proxy: undefined });
      await waitFor(() => expect(fake.ask).toHaveBeenCalled());
      expect(c.ask).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('no allowed Concierge source but a proxy: the panel works and answers from the page', async () => {
      const fake: LlmProxyClient = { ask: vi.fn().mockResolvedValue({ kind: 'answer', text: 'from proxy' }) };
      const c = client(vi.fn().mockRejectedValue(new ConciergeError('no_sources')));
      await type(c, { proxy: fake });
      expect(($('textarea') as HTMLTextAreaElement).disabled).toBe(false);
      await waitFor(() => expect($('.aic-panel')?.textContent).toContain('from proxy'));
      expect($('.aic-panel')?.textContent).not.toContain("You don't have access to any Concierge sources.");
      expect(c.ask).not.toHaveBeenCalled();
    });

    it('proxy={null} turns routing off: no client is created, Concierge answers', async () => {
      const spy = vi.spyOn(llmProxy, 'createLlmProxyClient');
      const c = client(vi.fn().mockResolvedValue(['search']));
      await type(c, { proxy: null });
      await waitFor(() => expect(c.ask).toHaveBeenCalled());
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  it('index exports DEFAULT_SOURCES and createLlmProxyClient', () => {
    expect(pkg.DEFAULT_SOURCES).toEqual(['search', 'docs', 'faq', 'glossary']);
    expect(typeof pkg.createLlmProxyClient).toBe('function');
  });

  it('accentColor sets --aic-accent inline on .aic-root; omitted sets none', async () => {
    const c = client(vi.fn().mockResolvedValue(['search']));
    const { rerender } = render(<AssistantApp {...props(c)} accentColor="tomato" />);
    await waitFor(() => expect($('.aic-root')).toBeTruthy());
    expect($('.aic-root')?.style.getPropertyValue('--aic-accent')).toBe('tomato');
    rerender(<AssistantApp {...props(c)} />);
    await waitFor(() => expect($('.aic-root')?.style.getPropertyValue('--aic-accent')).toBe(''));
  });

  describe('storage key', () => {
    const askOne = async (p: AssistantAppProps) => {
      render(<AssistantApp {...p} />);
      await waitFor(() => expect($('.aic-launcher')).toBeTruthy());
      const input = $('textarea') as HTMLTextAreaElement;
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      act(() => {
        setValue?.call(input, 'hi');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await waitFor(() => expect(($('[aria-label="Send"]') as HTMLButtonElement).disabled).toBe(false));
      act(() => $('[aria-label="Send"]')?.click());
      await waitFor(() => expect(sessionStorage.length).toBeGreaterThan(0));
    };
    beforeEach(() => sessionStorage.clear());

    it('userName gives ai-app-assistant:<pageName>:<userName>', async () => {
      await askOne({ ...props(client(vi.fn().mockResolvedValue(['search']))), pageName: 'P', userName: 'ann' });
      expect(Object.keys(sessionStorage)).toEqual(['ai-app-assistant:P:ann']);
    });

    it('an explicit storageKey wins', async () => {
      await askOne({
        ...props(client(vi.fn().mockResolvedValue(['search']))),
        pageName: 'P',
        userName: 'ann',
        storageKey: 'mine',
      });
      expect(Object.keys(sessionStorage)).toEqual(['mine']);
    });

    it('neither: nothing is kept', async () => {
      const c = client(vi.fn().mockResolvedValue(['search']));
      render(<AssistantApp {...props(c)} />);
      await waitFor(() => expect($('.aic-launcher')).toBeTruthy());
      const input = $('textarea') as HTMLTextAreaElement;
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      act(() => {
        setValue?.call(input, 'hi');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await waitFor(() => expect(($('[aria-label="Send"]') as HTMLButtonElement).disabled).toBe(false));
      act(() => $('[aria-label="Send"]')?.click());
      // Positive control: the question was sent and answered before storage is checked.
      await waitFor(() => expect($('.aic-a')?.textContent).toContain('x'));
      expect(c.ask).toHaveBeenCalled();
      expect(sessionStorage.length).toBe(0);
    });
  });

  it('exports the label defaults and the page-context store', () => {
    expect(pkg.DEFAULT_LABELS.title).toBe('Page Assistant');
    expect(typeof pkg.createPageContextStore).toBe('function');
  });
});

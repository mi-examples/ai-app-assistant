// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskResult, ConciergeClient } from '../client/concierge-client';
import { ConciergeError, createConciergeClient } from '../client/concierge-client';
import type { KnowledgePack } from '../context/knowledge';
import type { PageContext } from '../context/page-context';
import type { ChatMessage } from '../chat/use-concierge-chat';
import { Message } from './message';
import { Panel } from './panel';
import type { PanelProps } from './panel';

const knowledge: KnowledgePack = { sections: [], suggested: ['Why is revenue down?', 'What is a tile?'] };
const snapshot: PageContext = {
  pageName: 'Sales',
  route: '/sales',
  groups: [{ title: 'L', items: [{ elementId: 1, label: 'Revenue', value: '$4M', details: ['target $5M'] }] }],
};

const fakeClient = (ask?: ConciergeClient['ask']): ConciergeClient => ({
  getTools: vi.fn().mockResolvedValue(['search']),
  ask: ask ?? vi.fn().mockResolvedValue({ answer: 'Hello **there**', relatedReports: [] }),
  feedback: vi.fn().mockResolvedValue(undefined),
});

const setup = (over: Partial<PanelProps> = {}, client = fakeClient()) =>
  render(
    <Panel
      open
      onClose={vi.fn()}
      client={client}
      knowledge={knowledge}
      isAdmin={false}
      userFirstName="Ann"
      getPageContext={() => snapshot}
      getElementId={() => null}
      {...over}
    />,
  );

const ask = async (text: string) => {
  fireEvent.change(screen.getByLabelText('Your question'), { target: { value: text } });
  fireEvent.click(screen.getByLabelText('Send'));
};

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Panel', () => {
  it('empty state: greeting and one row per suggested question, rows send on click', async () => {
    const client = fakeClient();
    setup({}, client);
    expect(screen.getByText('Hi Ann 👋')).toBeTruthy();
    expect(screen.getByText('Ask about the numbers on this page, or how it works.')).toBeTruthy();
    const rows = document.querySelectorAll('.aic-sugg button');
    expect([...rows].map((r) => r.textContent?.replace('↗', '').trim())).toEqual(knowledge.suggested);
    fireEvent.click(screen.getByText('Why is revenue down?'));
    await waitFor(() => expect(client.ask).toHaveBeenCalled());
    expect(client.ask).toHaveBeenCalledWith(
      expect.objectContaining({ q: expect.stringContaining('Why is revenue down?') }),
    );
  });

  it('no context line is rendered', () => {
    setup();
    expect(document.querySelector('.aic-ctx')).toBeNull();
  });

  it('focuses the composer when opened', () => {
    setup();
    expect(document.activeElement).toBe(screen.getByLabelText('Your question'));
  });

  it('send shows an up-arrow; while busy it is Stop, Enter does nothing, Stop refills an empty box', async () => {
    const askFn = vi.fn(() => new Promise<never>(() => undefined));
    setup({}, fakeClient(askFn));
    const input = () => screen.getByLabelText('Your question') as HTMLTextAreaElement;
    expect(screen.getByLabelText('Send').querySelector('path')?.getAttribute('d')).toBe('M12 19V5M6 11l6-6 6 6');
    await ask('hi');
    await waitFor(() => expect(askFn).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText('Send')).toBeNull();
    expect(screen.getByLabelText('Stop').querySelector('rect')).toBeTruthy();
    expect(input().disabled).toBe(false);
    fireEvent.change(input(), { target: { value: 'another' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(input().value).toBe('another');
    expect(askFn).toHaveBeenCalledTimes(1);
    fireEvent.change(input(), { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('Stop'));
    await waitFor(() => expect(input().value).toBe('hi'));
    expect(document.querySelector('.aic-u')).toBeNull();
    expect(screen.getByLabelText('Send')).toBeTruthy();
    expect(document.activeElement).toBe(input());
  });

  it('typed text is kept when the box is not empty', async () => {
    setup(
      {},
      fakeClient(() => new Promise<never>(() => undefined)),
    );
    const input = () => screen.getByLabelText('Your question') as HTMLTextAreaElement;
    await ask('hi');
    await screen.findByLabelText('Stop');
    fireEvent.change(input(), { target: { value: 'new text' } });
    fireEvent.click(screen.getByLabelText('Stop'));
    await waitFor(() => expect(document.querySelector('.aic-u')).toBeNull());
    expect(input().value).toBe('new text');
  });

  it('page data chip toggles and reports aria-pressed', () => {
    setup();
    const chip = screen.getByRole('button', { name: 'Page data' });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });

  it('hides the page data chip when the page supplies no getPageContext', () => {
    setup({ getPageContext: undefined });
    expect(screen.queryByRole('button', { name: 'Page data' })).toBeNull();
  });

  it('Retry asks the same question again and replaces the answer in place', async () => {
    const askFn = vi
      .fn()
      .mockResolvedValueOnce({ answer: 'first', relatedReports: [] })
      .mockResolvedValue({ answer: 'second', relatedReports: [] });
    setup({}, fakeClient(askFn));
    await ask('q');
    await screen.findByText('first');
    fireEvent.click(screen.getByLabelText('Retry'));
    await screen.findByText('second');
    expect(askFn).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('first')).toBeNull();
    expect(document.querySelectorAll('.aic-u')).toHaveLength(1);
  });

  it('Stop during a Retry brings back the earlier answer and leaves the box empty', async () => {
    const askFn = vi
      .fn()
      .mockResolvedValueOnce({ answer: 'first', relatedReports: [] })
      .mockImplementation(() => new Promise<never>(() => undefined));
    setup({}, fakeClient(askFn));
    await ask('q');
    await screen.findByText('first');
    fireEvent.click(screen.getByLabelText('Retry'));
    await waitFor(() => expect(askFn).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('first')).toBeNull();
    fireEvent.click(screen.getByLabelText('Stop'));
    await screen.findByText('first');
    expect(document.querySelectorAll('.aic-u')).toHaveLength(1);
    expect((screen.getByLabelText('Your question') as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByLabelText('Send')).toBeTruthy();
  });

  it('renders markdown tables and does not render raw HTML', async () => {
    const answer = '| A | B |\n|---|---|\n| 1 | 2 |\n\n<img src=x onerror=alert(1)>';
    setup({}, fakeClient(vi.fn().mockResolvedValue({ answer, relatedReports: [] })));
    await ask('q');
    await waitFor(() => expect(document.querySelector('table')).toBeTruthy());
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('renders images only when same-origin; cross-origin becomes a link', async () => {
    const answer = `![local](${window.location.origin}/a.png)\n\n![remote](https://evil.example/x.png)`;
    setup({}, fakeClient(vi.fn().mockResolvedValue({ answer, relatedReports: [] })));
    await ask('q');
    await waitFor(() => expect(document.querySelector('img')).toBeTruthy());
    expect(document.querySelectorAll('img')).toHaveLength(1);
    const link = screen.getByText('remote') as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('https://evil.example/x.png');
  });

  it('no_sources error shows the exact 403 copy', async () => {
    const client = fakeClient(vi.fn().mockRejectedValue(new ConciergeError('no_sources')));
    setup({}, client);
    await ask('q');
    await screen.findByText("You don't have access to any Concierge sources. Ask your administrator.");
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('accessDenied shows the 403 copy and disables the composer', () => {
    setup({ accessDenied: true });
    expect(screen.getByText("You don't have access to any Concierge sources. Ask your administrator.")).toBeTruthy();
    expect((screen.getByLabelText('Your question') as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('network error shows Try again which retries', async () => {
    const askFn = vi
      .fn()
      .mockRejectedValueOnce(new ConciergeError('network'))
      .mockResolvedValue({ answer: 'fine now', relatedReports: [] });
    setup({}, fakeClient(askFn));
    await ask('q');
    fireEvent.click(await screen.findByText('Try again'));
    await screen.findByText('fine now');
    expect(askFn).toHaveBeenCalledTimes(2);
  });

  it('hides feedback buttons when feedback is unavailable', async () => {
    const client = fakeClient();
    client.feedback = vi.fn().mockRejectedValue(new Error('nope'));
    setup({}, client);
    await ask('q');
    fireEvent.click(await screen.findByLabelText('Helpful'));
    await waitFor(() => expect(screen.queryByLabelText('Helpful')).toBeNull());
    expect(screen.queryByLabelText('Not helpful')).toBeNull();
  });

  it('shows source footnotes and the Concierge route label after an answer', async () => {
    const client = fakeClient();
    setup({}, client);
    await ask('q');
    await screen.findByText(/^Answered by MI Concierge · \d\.\ds$/);
    expect(screen.getByText('On this page')).toBeTruthy();
  });

  it('does not render javascript: link hrefs', async () => {
    setup({}, fakeClient(vi.fn().mockResolvedValue({ answer: '[x](javascript:alert(1))', relatedReports: [] })));
    await ask('q');
    const text = await screen.findByText('x');
    expect(text.closest('a')).toBeNull();
    const anchors = [...document.querySelectorAll('.aic-a a')];
    expect(anchors.filter((a) => !a.getAttribute('href') || a.getAttribute('href')!.includes('javascript:'))).toEqual(
      [],
    );
  });

  it('keeps normal links as new-tab anchors', async () => {
    setup({}, fakeClient(vi.fn().mockResolvedValue({ answer: '[docs](https://example.com/x)', relatedReports: [] })));
    await ask('q');
    const link = (await screen.findByText('docs')).closest('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/x');
    expect(link?.getAttribute('target')).toBe('_blank');
  });

  it('clears the happy mood when the next question fails', async () => {
    vi.useFakeTimers();
    const askFn = vi
      .fn()
      .mockResolvedValueOnce({ answer: 'ok', relatedReports: [] })
      .mockRejectedValue(new ConciergeError('network'));
    setup({}, fakeClient(askFn));
    await ask('one');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(document.querySelector('.aic-orb--happy')).toBeTruthy();
    await ask('two');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(document.querySelector('.aic-orb--happy')).toBeNull();
  });

  it('shows no follow-up chips without getFollowUps', async () => {
    setup();
    await ask('q');
    await screen.findByText('Hello');
    expect(document.querySelector('.aic-chip')).toBeNull();
  });

  it('shows getFollowUps chips after an answer, passing the page context and asked questions', async () => {
    const getFollowUps = vi.fn().mockReturnValue(['Chip A', 'Chip B']);
    setup({ getFollowUps });
    await ask('q one');
    await screen.findByText('Chip A');
    expect(screen.getByText('Chip B')).toBeTruthy();
    expect(getFollowUps).toHaveBeenLastCalledWith(snapshot, ['q one']);
  });

  it('hides a follow-up chip that repeats a question already asked in this chat', async () => {
    setup({ getFollowUps: () => ['Chip A', 'Chip B'] });
    await ask('  chip a ');
    await screen.findByText('Chip B');
    expect(screen.queryByRole('button', { name: 'Chip A' })).toBeNull();
  });

  it("renders today's default copy", () => {
    setup();
    expect(screen.getByRole('dialog', { hidden: true }).getAttribute('aria-label')).toBe('Page Assistant');
    expect(screen.getByText('Page Assistant')).toBeTruthy();
    expect(screen.getByText('Powered by MI Concierge')).toBeTruthy();
    expect(screen.getByText('Ask about the numbers on this page, or how it works.')).toBeTruthy();
    expect(screen.getByPlaceholderText('Ask about this page…')).toBeTruthy();
    expect(screen.getByText('AI answers can be wrong. Check important numbers.')).toBeTruthy();
  });

  it('labels replace each text; the dialog is named by the title', () => {
    setup({
      labels: {
        title: 'T1',
        subtitle: 'S1',
        welcome: 'W1',
        placeholder: 'P1',
        disclaimer: 'D1',
      },
    });
    expect(screen.getByRole('dialog', { hidden: true }).getAttribute('aria-label')).toBe('T1');
    for (const t of ['T1', 'S1', 'W1', 'D1']) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByPlaceholderText('P1')).toBeTruthy();
  });

  it('suggested overrides knowledge.suggested and shows the first 3', () => {
    setup({ suggested: ['a1', 'a2', 'a3', 'a4'] });
    expect(screen.getByText('a1')).toBeTruthy();
    expect(screen.getByText('a3')).toBeTruthy();
    expect(screen.queryByText('a4')).toBeNull();
    expect(screen.queryByText('What is a tile?')).toBeNull();
  });

  it('answers without getPageContext and getElementId', async () => {
    setup({ getPageContext: undefined, getElementId: undefined });
    await ask('q');
    await screen.findByText('there');
  });

  it('header orb is still while the panel is closed and live while open', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const hdrOrb = () => document.querySelector('.aic-hdr .aic-orb') as HTMLElement;
    const move = () => act(() => void window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 })));
    const { rerender } = setup({ open: false });
    move();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(hdrOrb().style.getPropertyValue('--aic-ex')).toBe('');
    expect(hdrOrb().classList.contains('aic-orb--blink')).toBe(false);
    rerender(
      <Panel
        open
        onClose={vi.fn()}
        client={fakeClient()}
        knowledge={knowledge}
        isAdmin={false}
        getPageContext={() => snapshot}
        getElementId={() => null}
      />,
    );
    move();
    expect(hdrOrb().style.getPropertyValue('--aic-ex')).not.toBe('');
    vi.restoreAllMocks();
  });

  it('answers live region has aria-live="polite"', () => {
    setup();
    expect(document.querySelector('[aria-live="polite"]')).toBeTruthy();
  });

  it('a question still unanswered after 90s turns into a network error with Try again', async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('get-tools')) return new Response('{"data":[{"name":"search"}]}', { status: 200 });

      return new Promise<Response>(() => undefined);
    });
    setup({}, createConciergeClient({ fetch: fetchFn as unknown as typeof fetch }));
    await ask('q');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(89_000);
    });
    expect(screen.queryByText('Try again')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('pending answer shows Thinking…, then Still thinking… after 10 s', async () => {
    vi.useFakeTimers();
    setup(
      {},
      fakeClient(() => new Promise(() => undefined)),
    );
    await ask('q');
    expect(screen.getByText('Thinking…')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText('Still thinking…')).toBeTruthy();
    expect(screen.queryByText('Thinking…')).toBeNull();
  });
});

describe('Message', () => {
  const answer = (over: Partial<ChatMessage>): ChatMessage => ({
    id: 'a1',
    role: 'assistant',
    text: 'Revenue is down [1].',
    status: 'done',
    sources: [{ label: 'On this page', detail: 'Sales' }],
    ...over,
  });
  const show = (m: ChatMessage, feedbackAvailable = true, onRetry = vi.fn()) =>
    render(<Message message={m} feedbackAvailable={feedbackAvailable} onRetry={onRetry} onLike={vi.fn()} />);

  it('route label per route', () => {
    show(answer({ route: 'page', elapsedMs: 2700, citations: 1 }));
    expect(screen.getByText('Answered from this page · 2.7s')).toBeTruthy();
    expect(document.querySelector('.aic-route__dot--page')).toBeTruthy();
    cleanup();
    show(answer({ route: 'concierge', elapsedMs: 9300 }));
    expect(screen.getByText('Answered by MI Concierge · 9.3s')).toBeTruthy();
    expect(document.querySelector('.aic-route__dot--concierge')).toBeTruthy();
    cleanup();
    show(answer({ status: 'pending', text: '', sources: undefined, route: 'concierge', forwarded: true }));
    expect(screen.getByText('Asking MI Concierge…')).toBeTruthy();
    expect(screen.getByText('Thinking…')).toBeTruthy();
    cleanup();
    show(answer({ status: 'pending', text: '', sources: undefined }));
    expect(document.querySelector('.aic-route')).toBeNull();
  });

  it('thumbs only on concierge answers; Copy answer and Retry on every finished answer', () => {
    const onRetry = vi.fn();
    show(answer({ route: 'page', elapsedMs: 1000, citations: 1 }), true, onRetry);
    expect(screen.queryByLabelText('Helpful')).toBeNull();
    expect(screen.queryByLabelText('Not helpful')).toBeNull();
    expect(screen.getByLabelText('Copy answer')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Retry'));
    expect(onRetry).toHaveBeenCalledWith('a1');
    cleanup();
    show(answer({ route: 'concierge', elapsedMs: 1000 }));
    expect(screen.getByLabelText('Helpful')).toBeTruthy();
    expect(screen.getByLabelText('Not helpful')).toBeTruthy();
    expect(screen.getByLabelText('Copy answer')).toBeTruthy();
    expect(screen.getByLabelText('Retry')).toBeTruthy();
    cleanup();
    show(answer({ route: 'concierge', elapsedMs: 1000 }), false);
    expect(screen.queryByLabelText('Helpful')).toBeNull();
  });

  it('citation badges only on page answers', () => {
    show(answer({ route: 'page', elapsedMs: 1000, citations: 1 }));
    expect(document.querySelector('.aic-cite')?.textContent).toBe('1');
    cleanup();
    show(answer({ route: 'concierge', elapsedMs: 1000, citations: 1 }));
    expect(document.querySelector('.aic-cite')).toBeNull();
    expect(document.body.textContent).toContain('Revenue is down [1].');
  });

  it('failed answers keep the v1 error copy and Try again, without the action row', () => {
    const onRetry = vi.fn();
    show(answer({ status: 'error', text: '', sources: undefined, errorKind: 'network' }), true, onRetry);
    fireEvent.click(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalledWith('a1');
    expect(screen.queryByLabelText('Copy answer')).toBeNull();
    expect(screen.queryByLabelText('Retry')).toBeNull();
  });
});

describe('Panel new chat', () => {
  afterEach(() => sessionStorage.clear());

  it('+ is disabled while the chat is empty and enabled once there is a turn', async () => {
    setup();
    expect((screen.getByLabelText('New chat') as HTMLButtonElement).disabled).toBe(true);
    await ask('hi');
    await screen.findByText('there');
    expect((screen.getByLabelText('New chat') as HTMLButtonElement).disabled).toBe(false);
  });

  it('+ clears the chat and offers Undo, which brings it back', async () => {
    setup();
    await ask('hi');
    await screen.findByText('there');
    fireEvent.click(screen.getByLabelText('New chat'));
    expect(screen.queryByText('there')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Chat cleared');
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.queryByText('there')).not.toBeNull();
    // Undo starts the bar's exit; it is gone once the exit animation has had its time.
    expect(document.querySelector('.aic-undo--leaving')).not.toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText('Chat cleared')).toBeNull();
  });

  it('the Undo bar goes away after 6 s', async () => {
    setup();
    await ask('hi');
    await screen.findByText('there');
    vi.useFakeTimers();
    fireEvent.click(screen.getByLabelText('New chat'));
    act(() => vi.advanceTimersByTime(5900));
    expect(screen.queryByText('Chat cleared')).not.toBeNull();
    expect(document.querySelector('.aic-undo--leaving')).toBeNull();
    act(() => vi.advanceTimersByTime(100));
    // Fading out: still there, marked leaving, and Undo no longer works.
    expect(document.querySelector('.aic-undo--leaving')).not.toBeNull();
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText('Chat cleared')).toBeNull();
  });

  it('clearing again during the exit shows the bar again, not leaving', async () => {
    setup();
    await ask('hi');
    await screen.findByText('there');
    vi.useFakeTimers();
    fireEvent.click(screen.getByLabelText('New chat'));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByLabelText('New chat'));
    expect(document.querySelector('.aic-undo--leaving')).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByText('Chat cleared')).not.toBeNull();
  });

  it('storageKey keeps the chat across a remount', async () => {
    setup({ storageKey: 'aic-test' });
    await ask('hi');
    await screen.findByText('there');
    cleanup();
    setup({ storageKey: 'aic-test' });
    expect(screen.queryByText('there')).not.toBeNull();
  });
});

describe('Panel scrolling', () => {
  // jsdom has no layout: give the list a 400px view over 1600px of content, the last question at 500 and the
  // last answer ending at `answerBottom`, all in content coordinates that move with scrollTop.
  let answerBottom = 1500;
  beforeEach(() => {
    answerBottom = 1500;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const list = this.closest('.aic-msgs') as HTMLElement | null;
      const at = (top: number, bottom: number) => {
        const st = this === list ? 0 : (list?.scrollTop ?? 0);

        return {
          top: top - st,
          bottom: bottom - st,
          left: 0,
          right: 0,
          width: 0,
          height: bottom - top,
          x: 0,
          y: 0,
        } as DOMRect;
      };
      if (this.classList.contains('aic-msgs')) return at(0, 400);
      if (this.classList.contains('aic-row--user')) return at(500, 540);
      if (this.classList.contains('aic-row')) return at(560, answerBottom);

      return at(0, 0);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const list = (c: HTMLElement) => {
    const el = c.querySelector('.aic-msgs') as HTMLElement;
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 400 });
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 1600 });

    return el;
  };

  it('a long answer: the question lines up at the top so the answer is read from its start', async () => {
    const { container } = setup();
    const el = list(container);
    await ask('hi');
    await screen.findByText('there');
    expect(el.scrollTop).toBe(488);
  });

  it('a short answer: scrolls to the bottom as before', async () => {
    answerBottom = 700;
    const { container } = setup();
    const el = list(container);
    await ask('hi');
    await screen.findByText('there');
    expect(el.scrollTop).toBe(1600);
  });

  it('sending scrolls to the bottom to show Thinking…', async () => {
    const { container } = setup({}, fakeClient(vi.fn(() => new Promise<never>(() => {}))));
    const el = list(container);
    await ask('hi');
    expect(el.scrollTop).toBe(1600);
  });

  it('does not jump when the user scrolled away while it was thinking', async () => {
    let resolve!: (v: AskResult) => void;
    const { container } = setup({}, fakeClient(vi.fn(() => new Promise<AskResult>((r) => (resolve = r)))));
    const el = list(container);
    await ask('hi');
    el.scrollTop = 100;
    fireEvent.scroll(el);
    await act(async () => resolve({ answer: 'Hello **there**', relatedReports: [] }));
    await screen.findByText('there');
    expect(el.scrollTop).toBe(100);
  });

  it('a restored chat opens lined up on its last question', async () => {
    setup({ storageKey: 'aic-scroll' });
    await ask('hi');
    await screen.findByText('there');
    cleanup();
    // The new list is measured before its first layout effect: patch the prototype getters for this mount.
    const ch = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
    const sh = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1600);
    const { container } = setup({ storageKey: 'aic-scroll' });
    expect((container.querySelector('.aic-msgs') as HTMLElement).scrollTop).toBe(488);
    ch.mockRestore();
    sh.mockRestore();
    sessionStorage.clear();
  });
});

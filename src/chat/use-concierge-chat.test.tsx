// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskInput, AskResult, ConciergeClient } from '../client/concierge-client';
import { ConciergeError } from '../client/concierge-client';
import type { ChatTurn, LlmProxyClient, ProxyResult } from '../client/llm-proxy';
import { buildQuestionPrefix, earlierTurnLine } from '../context/build-context';
import type { KnowledgePack, KnowledgeSection } from '../context/knowledge';
import { pickSections } from '../context/pick-sections';
import { PAGE_CONTEXT_HEADER, type PageContext } from '../context/page-context';
import { useConciergeChat } from './use-concierge-chat';

const section = (id: string, heading: string, body: string, isSummary = false): KnowledgeSection => ({
  id,
  file: 'f.md',
  heading,
  body,
  audience: 'all',
  isSummary,
});
const summary = section('s', 'Summary', 'An app about widgets.', true);
const knowledge: KnowledgePack = {
  sections: [summary, section('a', 'Targets', 'How targets work for tiles.')],
  suggested: [],
};
const snap = (value: string): PageContext => ({
  pageName: 'Sales',
  route: '/sales',
  groups: [{ title: 'L', items: [{ elementId: 1, label: 'Rev', value }] }],
});

function fakeClient(over: Partial<ConciergeClient> = {}) {
  const asks: AskInput[] = [];
  const client: ConciergeClient = {
    getTools: vi.fn(async () => ['Snowflake', 'search', 'docs']),
    ask: vi.fn(async (i: AskInput): Promise<AskResult> => {
      asks.push(i);

      return { answer: 'hello', relatedReports: [{ id: 7, name: 'Rep' }] };
    }),
    feedback: vi.fn(async () => {}),
    ...over,
  };

  return { client, asks };
}

function setup(over: Record<string, unknown> = {}, clientOver: Partial<ConciergeClient> = {}) {
  const { client, asks } = fakeClient(clientOver);
  let current = snap('10');
  const hook = renderHook(() =>
    useConciergeChat({
      client,
      knowledge,
      isAdmin: false,
      getPageContext: () => current,
      getElementId: () => 5,
      includePageData: true,
      ...over,
    }),
  );

  return { ...hook, client, asks, setSnap: (s: PageContext) => (current = s) };
}

describe('useConciergeChat', () => {
  it('send appends user and pending assistant, then resolves to done with cleaned text', async () => {
    const { result } = setup();
    let p: Promise<void>;
    act(() => {
      p = result.current.send('how do targets work?');
    });
    expect(result.current.messages.map((m) => [m.role, m.status])).toEqual([
      ['user', 'done'],
      ['assistant', 'pending'],
    ]);
    expect(result.current.isBusy).toBe(true);
    await act(async () => {
      await p;
    });
    const a = result.current.messages[1];
    expect(a.status).toBe('done');
    expect(a.text).toBe('hello');
    expect(result.current.isBusy).toBe(false);
  });

  it('follow-ups reuse conversation_ts; newChat makes a new one', async () => {
    const { result, asks } = setup();
    await act(() => result.current.send('one'));
    await act(() => result.current.send('two'));
    expect(asks[0].conversationTs).toBe(asks[1].conversationTs);
    expect(asks[0].messageUid).not.toBe(asks[1].messageUid);
    act(() => result.current.newChat());
    expect(result.current.messages).toEqual([]);
    await act(() => result.current.send('three'));
    expect(asks[2].conversationTs).not.toBe(asks[0].conversationTs);
  });

  it('send rebuilds context from getPageContext on every call', async () => {
    const { result, asks, setSnap } = setup();
    await act(() => result.current.send('one'));
    setSnap(snap('99999'));
    await act(() => result.current.send('two'));
    expect(asks[0].context).not.toContain('99999');
    expect(asks[1].context).toContain('99999');
    expect(asks[1].tools).toEqual(['search', 'docs']);
  });

  it('includePageData false sends no snapshot but still the guide sections', async () => {
    const { result, asks } = setup({ includePageData: false });
    await act(() => result.current.send('how do targets work?'));
    expect(asks[0].context).not.toContain('Page snapshot');
    expect(asks[0].context).toContain('Targets');
    const a = result.current.messages[1];
    expect(a.sources?.some((s) => s.label === 'On this page')).toBe(false);
  });

  it('sends context and prefixes q with three spaces before the question', async () => {
    const { result, asks } = setup();
    await act(() => result.current.send('how do targets work?'));
    const prefix = buildQuestionPrefix({ sections: knowledge.sections, snapshot: snap('10') });
    expect(asks[0].context).toContain('Targets');
    expect(asks[0].q).toBe(`${prefix.text}   how do targets work?`);
  });

  it('sources reflect what was sent', async () => {
    const { result } = setup();
    await act(() => result.current.send('how do targets work?'));
    const a = result.current.messages[1];
    expect(a.sources).toEqual([
      { label: 'On this page', detail: 'Sales' },
      { label: 'App guide', detail: '§ Targets' },
      { label: 'Report', detail: 'Rep' },
    ]);
    expect(typeof a.elapsedMs).toBe('number');
  });

  it('empty answer becomes fallback text', async () => {
    const { result } = setup({}, { ask: vi.fn(async () => ({ answer: '', relatedReports: [] })) });
    await act(() => result.current.send('q'));
    expect(result.current.messages[1].text).toBe("I couldn't find an answer to that.");
  });

  it('error marks assistant message error with errorKind; retry re-sends same question', async () => {
    const ask = vi
      .fn()
      .mockRejectedValueOnce(new ConciergeError('network'))
      .mockResolvedValueOnce({ answer: 'ok', relatedReports: [] });
    const { result } = setup({}, { ask });
    await act(() => result.current.send('the question'));
    const failed = result.current.messages[1];
    expect(failed.status).toBe('error');
    expect(failed.errorKind).toBe('network');
    await act(() => result.current.retry(failed.id));
    expect(ask.mock.calls[1][0].q).toContain('the question');
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1].status).toBe('done');
    expect(result.current.messages[1].text).toBe('ok');
  });

  it('sends only the allowed sources, MI internal ones by default', async () => {
    const { result, asks } = setup();
    await act(() => result.current.send('q'));
    expect(asks[0].tools).toEqual(['search', 'docs']);
  });

  it('sources option opts an app into an external source', async () => {
    const { result, asks } = setup({ sources: ['search', 'Snowflake'] });
    await act(() => result.current.send('q'));
    expect(asks[0].tools).toEqual(['Snowflake', 'search']);
  });

  it('no allowed source available shows no_sources without asking', async () => {
    const { result, client } = setup({}, { getTools: vi.fn(async () => ['Snowflake']) });
    await act(() => result.current.send('q'));
    expect(result.current.messages[1].errorKind).toBe('no_sources');
    expect(client.ask).not.toHaveBeenCalled();
  });

  it('getTools ConciergeError surfaces its kind without asking', async () => {
    const { result, client } = setup(
      {},
      { getTools: vi.fn(async () => Promise.reject(new ConciergeError('no_sources'))) },
    );
    await act(() => result.current.send('q'));
    expect(result.current.messages[1].errorKind).toBe('no_sources');
    expect(client.ask).not.toHaveBeenCalled();
  });

  it('a send during busy is ignored', async () => {
    let resolve!: (r: AskResult) => void;
    const ask = vi.fn(() => new Promise<AskResult>((r) => (resolve = r)));
    const { result } = setup({}, { ask });
    let p: Promise<void>;
    act(() => {
      p = result.current.send('first');
    });
    await act(async () => {
      await result.current.send('second');
    });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(result.current.messages).toHaveLength(2);
    await act(async () => {
      resolve({ answer: 'x', relatedReports: [] });
      await p;
    });
    expect(result.current.isBusy).toBe(false);
  });

  it('newChat cancels a pending question: not busy, no late message, next send is a new conversation', async () => {
    const signals: AbortSignal[] = [];
    let resolveFirst!: (r: AskResult) => void;
    const ask = vi
      .fn()
      .mockImplementationOnce(
        (i: AskInput) =>
          new Promise<AskResult>((resolve, reject) => {
            signals.push(i.signal!);
            resolveFirst = resolve;
            i.signal!.addEventListener('abort', () => reject(new ConciergeError('network')));
          }),
      )
      .mockResolvedValue({ answer: 'second', relatedReports: [] });
    const { result } = setup({}, { ask });
    let p: Promise<void>;
    act(() => {
      p = result.current.send('first');
    });
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    act(() => result.current.newChat());
    expect(signals[0].aborted).toBe(true);
    expect(result.current.isBusy).toBe(false);
    expect(result.current.messages).toEqual([]);
    await act(async () => {
      resolveFirst({ answer: 'late', relatedReports: [] });
      await p;
    });
    expect(result.current.messages).toEqual([]);
    expect(result.current.isBusy).toBe(false);

    await act(() => result.current.send('again'));
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[1][0].conversationTs).not.toBe(ask.mock.calls[0][0].conversationTs);
    expect(result.current.messages.map((m) => m.text)).toEqual(['again', 'second']);
  });

  it('newChat while still probing tools drops the old question', async () => {
    let resolveTools!: (t: string[]) => void;
    const getTools = vi.fn(() => new Promise<string[]>((r) => (resolveTools = r)));
    const { result, client } = setup({}, { getTools });
    let p: Promise<void>;
    act(() => {
      p = result.current.send('first');
    });
    act(() => result.current.newChat());
    await act(async () => {
      resolveTools(['t1']);
      await p;
    });
    expect(client.ask).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
  });

  it('unmount aborts the in-flight question', async () => {
    const signals: AbortSignal[] = [];
    const ask = vi.fn((i: AskInput) => {
      signals.push(i.signal!);

      return new Promise<AskResult>(() => undefined);
    });
    const { result, unmount } = setup({}, { ask });
    act(() => {
      void result.current.send('q');
    });
    await waitFor(() => expect(ask).toHaveBeenCalled());
    unmount();
    expect(signals[0].aborted).toBe(true);
  });

  it('feedback failure sets feedbackAvailable false and does not throw', async () => {
    const feedback = vi.fn().mockRejectedValue(new Error('x'));
    const { result } = setup({}, { feedback });
    await act(() => result.current.send('why?'));
    expect(result.current.feedbackAvailable).toBe(true);
    act(() => result.current.like(result.current.messages[1].id, 'like'));
    await waitFor(() => expect(result.current.feedbackAvailable).toBe(false));
    expect(feedback.mock.calls[0][0]).toMatchObject({ question: 'why?', answer: 'hello', feedback: 'like' });
  });
});

type ProxyAsk = { messages: ChatTurn[]; signal?: AbortSignal };

const PAGE_ANSWER: ProxyResult = { kind: 'answer', text: 'From the page [1]' };

function fakeProxy(impl: (i: ProxyAsk) => Promise<ProxyResult> | ProxyResult = () => PAGE_ANSWER) {
  const ask = vi.fn(async (i: ProxyAsk) => impl(i));
  const proxy: LlmProxyClient = { ask };

  return { proxy, ask };
}

const lastUser = (i: ProxyAsk) => i.messages[i.messages.length - 1].content;
const systemOf = (i: ProxyAsk) => i.messages[0].content;
const v1Inputs = ({ q, context, elementId, tools }: AskInput) => ({ q, context, elementId, tools });

describe('useConciergeChat routing', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('page answer: proxy answers, Concierge not called', async () => {
    const { proxy, ask } = fakeProxy();
    const { result, client } = setup({ proxy });
    await act(() => result.current.send('how do targets work?'));
    const a = result.current.messages[1];
    expect(a).toMatchObject({ status: 'done', route: 'page', text: 'From the page [1]' });
    expect(a.sources).toEqual([
      { label: 'On this page', detail: 'Sales' },
      { label: 'App guide', detail: '§ Targets' },
    ]);
    expect(a.citations).toBe(2);
    expect(a.forwarded).toBeFalsy();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(lastUser(ask.mock.calls[0][0])).toBe('how do targets work?');
    expect(client.ask).not.toHaveBeenCalled();
    expect(client.getTools).not.toHaveBeenCalled();
  });

  it('proxy prompt gets up to 6 picked sections', async () => {
    const many: KnowledgePack = {
      sections: [summary, ...Array.from({ length: 9 }, (_, i) => section(`w${i}`, `Widget ${i}`, 'widgets body'))],
      suggested: [],
    };
    const { proxy } = fakeProxy();
    const { result } = setup({ proxy, knowledge: many });
    await act(() => result.current.send('widgets'));
    const expected = pickSections(many.sections, 'widgets', { isAdmin: false, maxSections: 6 }).filter(
      (s) => !s.isSummary,
    );
    expect(expected.length).toBeGreaterThan(4);
    const guide = result.current.messages[1].sources!.filter((s) => s.label === 'App guide');
    expect(guide.map((s) => s.detail)).toEqual(expected.map((s) => `§ ${s.heading}`));
  });

  it('forward: Concierge gets the bare question and no context; sources are only what it returned', async () => {
    const v1 = setup();
    await act(() => v1.result.current.send('how do targets work?'));
    const { proxy } = fakeProxy(() => ({ kind: 'forward' }));
    const routed = setup({ proxy });
    await act(() => routed.result.current.send('how do targets work?'));
    expect(routed.asks).toHaveLength(1);
    expect(v1Inputs(routed.asks[0])).toEqual({
      q: 'how do targets work?',
      context: undefined,
      elementId: v1.asks[0].elementId,
      tools: v1.asks[0].tools,
    });
    expect(routed.asks[0]).not.toHaveProperty('context');
    const a = routed.result.current.messages[1];
    expect(a).toMatchObject({ status: 'done', route: 'concierge', text: 'hello' });
    expect(a.forwarded).toBeFalsy();
    expect(a.citations).toBeUndefined();
    expect(a.sources).toEqual([{ label: 'Report', detail: 'Rep' }]);
  });

  it('Concierge search results become sources, labelled by type', async () => {
    const { proxy } = fakeProxy(() => ({ kind: 'forward' }));
    const found = [
      { type: 'dataset', name: 'Deals Pivot' },
      { type: '', name: 'Other' },
    ];
    const { result } = setup(
      { proxy },
      { ask: vi.fn(async () => ({ answer: 'I found these', relatedReports: [], found })) },
    );
    await act(() => result.current.send('trend over 12 months?'));
    expect(result.current.messages[1].sources).toEqual([
      { label: 'Dataset', detail: 'Deals Pivot' },
      { label: 'Result', detail: 'Other' },
    ]);
  });

  it('forwarded question is marked forwarded while Concierge is pending', async () => {
    let resolve!: (r: AskResult) => void;
    const { proxy } = fakeProxy(() => ({ kind: 'forward' }));
    const { result } = setup({ proxy }, { ask: vi.fn(() => new Promise<AskResult>((r) => (resolve = r))) });
    let p: Promise<void>;
    act(() => {
      p = result.current.send('q');
    });
    await waitFor(() => expect(result.current.messages[1].forwarded).toBe(true));
    expect(result.current.messages[1]).toMatchObject({ status: 'pending', route: 'concierge' });
    await act(async () => {
      resolve({ answer: 'x', relatedReports: [] });
      await p;
    });
    expect(result.current.messages[1]).toMatchObject({ status: 'done', route: 'concierge', forwarded: false });
  });

  it('forward with a rewrite: Concierge gets the stand-alone question; the chat shows what was typed', async () => {
    const { proxy } = fakeProxy(() => ({ kind: 'forward', question: 'How do I open the Sales editor?' }));
    const { result, asks } = setup({ proxy });
    await act(() => result.current.send('how do I open it?'));
    expect(asks[0].q).toBe('How do I open the Sales editor?');
    expect(result.current.messages[0].text).toBe('how do I open it?');
  });

  describe('follow-ups after a page answer', () => {
    const withEditor: KnowledgePack = {
      sections: [...knowledge.sections, section('e', 'Editor', 'A Configure button in the header starts it.')],
      suggested: [],
    };
    const earlier = { question: 'is there an editor?', answer: 'Yes, the editor [2].' };

    function twoTurns(second: ProxyResult) {
      let n = 0;
      const { proxy, ask } = fakeProxy(() => (++n === 1 ? { kind: 'answer', text: earlier.answer } : second));

      return { ask, ...setup({ proxy, knowledge: withEditor }) };
    }

    it('the proxy prompt picks sections from the previous turn too', async () => {
      const { result, ask } = twoTurns(PAGE_ANSWER);
      await act(() => result.current.send(earlier.question));
      await act(() => result.current.send('how do I open it?'));
      expect(systemOf(ask.mock.calls[1][0])).toContain('## [2] Editor');
    });

    it('forward without a rewrite: the earlier turn goes ahead of the bare question', async () => {
      const { result, asks } = twoTurns({ kind: 'forward' });
      await act(() => result.current.send(earlier.question));
      await act(() => result.current.send('how do I open it?'));
      expect(asks[0].q).toBe(`${earlierTurnLine(earlier)}   how do I open it?`);
      expect(asks[0]).not.toHaveProperty('context');
    });

    it('proxy unavailable: the v1 question carries the earlier turn and the follow-up topic', async () => {
      const { result, asks } = twoTurns({ kind: 'unavailable', sticky: false });
      await act(() => result.current.send(earlier.question));
      await act(() => result.current.send('how do I open it?'));
      expect(asks[0].q).toContain(earlierTurnLine(earlier));
      expect(asks[0].q.endsWith('   how do I open it?')).toBe(true);
      expect(result.current.messages[3].sources).toContainEqual({ label: 'App guide', detail: '§ Editor' });
    });
  });

  it('a previous Concierge turn is not repeated to Concierge, which already has it', async () => {
    const { proxy } = fakeProxy(() => ({ kind: 'unavailable', sticky: true }));
    const { result, asks } = setup({ proxy });
    await act(() => result.current.send('one'));
    await act(() => result.current.send('two'));
    expect(asks[1].q).not.toContain('Earlier in this chat');
  });

  it('sticky unavailable: second question skips the proxy', async () => {
    const { proxy, ask } = fakeProxy(() => ({ kind: 'unavailable', sticky: true }));
    const { result, asks } = setup({ proxy });
    await act(() => result.current.send('one'));
    await act(() => result.current.send('two'));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(asks).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({ status: 'done', route: 'concierge' });
    expect(result.current.messages[1].forwarded).toBeFalsy();
  });

  it('per-question unavailable: second question asks the proxy again', async () => {
    const { proxy, ask } = fakeProxy(() => ({ kind: 'unavailable', sticky: false }));
    const { result, asks } = setup({ proxy });
    await act(() => result.current.send('one'));
    await act(() => result.current.send('two'));
    expect(ask).toHaveBeenCalledTimes(2);
    expect(asks).toHaveLength(2);
    expect(result.current.messages[3]).toMatchObject({ status: 'done', route: 'concierge' });
  });

  it('blank proxy reply falls back to Concierge for that question only', async () => {
    const { proxy, ask } = fakeProxy(() => ({ kind: 'answer', text: '  ' }));
    const { result, asks } = setup({ proxy });
    await act(() => result.current.send('one'));
    expect(asks).toHaveLength(1);
    expect(result.current.messages[1]).toMatchObject({ status: 'done', route: 'concierge', text: 'hello' });
    expect(result.current.messages[1].forwarded).toBeFalsy();
    expect(result.current.messages[1].citations).toBeUndefined();
    await act(() => result.current.send('two'));
    expect(ask).toHaveBeenCalledTimes(2);
    expect(asks).toHaveLength(2);
  });

  it('proxy null behaves as v1', async () => {
    const v1 = setup();
    await act(() => v1.result.current.send('how do targets work?'));
    const none = setup({ proxy: null });
    await act(() => none.result.current.send('how do targets work?'));
    expect(v1Inputs(none.asks[0])).toEqual(v1Inputs(v1.asks[0]));
    expect(none.result.current.messages[1]).toMatchObject({ status: 'done', route: 'concierge', text: 'hello' });
  });

  it('history: proxy gets the last 6 completed turns, errors excluded', async () => {
    const { proxy, ask } = fakeProxy((i) => {
      const q = lastUser(i);

      return q === 'q7' || q === 'q8' ? { kind: 'forward' } : { kind: 'answer', text: q.replace('q', 'a') };
    });
    const conciergeAsk = vi.fn(async (i: AskInput): Promise<AskResult> => {
      if (i.q.endsWith('q8')) throw new ConciergeError('network');

      return { answer: 'hello', relatedReports: [] };
    });
    const { result } = setup({ proxy }, { ask: conciergeAsk });
    for (let n = 1; n <= 9; n++) await act(() => result.current.send(`q${n}`));
    expect(result.current.messages[15]).toMatchObject({ status: 'error', errorKind: 'network' });
    const turns = (q: string, a: string): ChatTurn[] => [
      { role: 'user', content: q },
      { role: 'assistant', content: a },
    ];
    expect(ask.mock.calls[8][0].messages.slice(1)).toEqual([
      ...turns('q2', 'a2'),
      ...turns('q3', 'a3'),
      ...turns('q4', 'a4'),
      ...turns('q5', 'a5'),
      ...turns('q6', 'a6'),
      ...turns('q7', 'hello'),
      { role: 'user', content: 'q9' },
    ]);
  });

  it('retry replaces the answer in place and sends only earlier turns as history', async () => {
    let n = 0;
    const { proxy, ask } = fakeProxy((i) => ({ kind: 'answer', text: `${lastUser(i)}-answer-${++n}` }));
    const { result } = setup({ proxy });
    await act(() => result.current.send('q1'));
    await act(() => result.current.send('q2'));
    await act(() => result.current.send('q3'));
    const before = result.current.messages;
    await act(() => result.current.retry(before[3].id));
    const after = result.current.messages;
    expect(after).toHaveLength(6);
    expect(after[3]).toMatchObject({ id: before[3].id, status: 'done', route: 'page', text: 'q2-answer-4' });
    expect(after[5]).toEqual(before[5]);
    expect(ask.mock.calls[3][0].messages.slice(1)).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'q1-answer-1' },
      { role: 'user', content: 'q2' },
    ]);
  });

  it('retry of a failed forwarded turn asks Concierge again with the same conversation_ts', async () => {
    const conciergeAsk = vi
      .fn()
      .mockRejectedValueOnce(new ConciergeError('server'))
      .mockResolvedValueOnce({ answer: 'ok', relatedReports: [] });
    const { proxy, ask } = fakeProxy(() => ({ kind: 'forward' }));
    const { result } = setup({ proxy }, { ask: conciergeAsk });
    await act(() => result.current.send('the question'));
    const failed = result.current.messages[1];
    expect(failed).toMatchObject({ status: 'error', errorKind: 'server' });
    await act(() => result.current.retry(failed.id));
    expect(ask).toHaveBeenCalledTimes(2);
    expect(conciergeAsk.mock.calls[1][0].conversationTs).toBe(conciergeAsk.mock.calls[0][0].conversationTs);
    expect(result.current.messages[1]).toMatchObject({ id: failed.id, status: 'done', route: 'concierge', text: 'ok' });
  });

  it('stop during the token/proxy phase aborts, removes both, returns the question, no Concierge', async () => {
    let signal!: AbortSignal;
    let resolveProxy!: (r: ProxyResult) => void;
    const { proxy } = fakeProxy((i) => {
      if (lastUser(i) === 'earlier') return PAGE_ANSWER;
      signal = i.signal!;

      // Ignores its signal on purpose: the hook must not continue after stop.
      return new Promise<ProxyResult>((r) => (resolveProxy = r));
    });
    const { result, client } = setup({ proxy });
    expect(result.current.stop()).toBeNull();
    await act(() => result.current.send('earlier'));
    let p: Promise<void>;
    act(() => {
      p = result.current.send('the question');
    });
    await waitFor(() => expect(signal).toBeDefined());
    let stopped: string | null = null;
    act(() => {
      stopped = result.current.stop();
    });
    expect(stopped).toBe('the question');
    expect(signal.aborted).toBe(true);
    expect(result.current.isBusy).toBe(false);
    expect(result.current.messages.map((m) => m.text)).toEqual(['earlier', 'From the page [1]']);
    await act(async () => {
      resolveProxy({ kind: 'forward' });
      await p;
    });
    expect(client.getTools).not.toHaveBeenCalled();
    expect(client.ask).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.stop()).toBeNull();
  });

  it('stop during the Concierge call aborts it and removes the pending pair', async () => {
    const signals: AbortSignal[] = [];
    const conciergeAsk = vi.fn((i: AskInput) => {
      signals.push(i.signal!);

      return new Promise<AskResult>(() => undefined);
    });
    const { proxy } = fakeProxy(() => ({ kind: 'forward' }));
    const { result } = setup({ proxy }, { ask: conciergeAsk });
    act(() => {
      void result.current.send('q');
    });
    await waitFor(() => expect(conciergeAsk).toHaveBeenCalled());
    let stopped: string | null = null;
    act(() => {
      stopped = result.current.stop();
    });
    expect(stopped).toBe('q');
    expect(signals[0].aborted).toBe(true);
    expect(result.current.messages).toEqual([]);
    expect(result.current.isBusy).toBe(false);
  });

  it('stop while probing tools on the v1 path never calls Concierge', async () => {
    let resolveTools!: (t: string[]) => void;
    const getTools = vi.fn(() => new Promise<string[]>((r) => (resolveTools = r)));
    const { result, client } = setup({}, { getTools });
    let p: Promise<void>;
    act(() => {
      p = result.current.send('q');
    });
    let stopped: string | null = null;
    act(() => {
      stopped = result.current.stop();
    });
    expect(stopped).toBe('q');
    await act(async () => {
      resolveTools(['search']);
      await p;
    });
    expect(client.ask).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
  });

  it('stop during a retry restores the earlier answer in place and returns null', async () => {
    let n = 0;
    let signal!: AbortSignal;
    let resolveRetry!: (r: ProxyResult) => void;
    const { proxy } = fakeProxy((i) => {
      if (++n <= 2) return { kind: 'answer', text: `a${n}` };
      signal = i.signal!;

      return new Promise<ProxyResult>((r) => (resolveRetry = r));
    });
    const { result } = setup({ proxy });
    await act(() => result.current.send('q1'));
    await act(() => result.current.send('q2'));
    const before = result.current.messages;
    let p: Promise<void>;
    act(() => {
      p = result.current.retry(before[1].id);
    });
    expect(result.current.messages[1].status).toBe('pending');
    let stopped: string | null = 'unset';
    act(() => {
      stopped = result.current.stop();
    });
    expect(stopped).toBeNull();
    expect(signal.aborted).toBe(true);
    expect(result.current.isBusy).toBe(false);
    expect(result.current.messages).toEqual(before);
    await act(async () => {
      resolveRetry({ kind: 'answer', text: 'late' });
      await p;
    });
    expect(result.current.messages).toEqual(before);
    expect(result.current.stop()).toBeNull();
  });

  it('newChat aborts an in-flight proxy call and nothing arrives later', async () => {
    let signal!: AbortSignal;
    let resolveProxy!: (r: ProxyResult) => void;
    const { proxy } = fakeProxy((i) => {
      signal = i.signal!;

      return new Promise<ProxyResult>((r) => (resolveProxy = r));
    });
    const { result, client } = setup({ proxy });
    let p: Promise<void>;
    act(() => {
      p = result.current.send('q');
    });
    await waitFor(() => expect(signal).toBeDefined());
    act(() => result.current.newChat());
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolveProxy({ kind: 'forward' });
      await p;
    });
    expect(client.ask).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
  });

  it('page data off: proxy prompt has no snapshot', async () => {
    const { proxy, ask } = fakeProxy();
    const { result, setSnap } = setup({ proxy, includePageData: false });
    setSnap(snap('98765'));
    await act(() => result.current.send('how do targets work?'));
    const system = systemOf(ask.mock.calls[0][0]);
    expect(system).not.toContain('98765');
    expect(system).not.toContain(PAGE_CONTEXT_HEADER);
    expect(system).toContain('Targets');
    expect(result.current.messages[1].sources).toEqual([{ label: 'App guide', detail: '§ Targets' }]);
    expect(result.current.messages[1].citations).toBe(1);
  });

  it('pageName option names the page; defaults to the snapshot name, else "this page"', async () => {
    const named = fakeProxy();
    const a = setup({ proxy: named.proxy, pageName: 'Sales Dashboard' });
    await act(() => a.result.current.send('q'));
    expect(systemOf(named.ask.mock.calls[0][0])).toContain('"Sales Dashboard"');

    const fromSnap = fakeProxy();
    const b = setup({ proxy: fromSnap.proxy });
    await act(() => b.result.current.send('q'));
    expect(systemOf(fromSnap.ask.mock.calls[0][0])).toContain('"Sales"');

    const off = fakeProxy();
    const c = setup({ proxy: off.proxy, includePageData: false });
    await act(() => c.result.current.send('q'));
    expect(systemOf(off.ask.mock.calls[0][0])).toContain('"this page"');
  });

  it('regular user: proxy system message has no admin section text', async () => {
    const withAdmin: KnowledgePack = {
      sections: [summary, { ...section('x', 'Targets setup', 'ADMIN SETUP BODY for targets'), audience: 'admin' }],
      suggested: [],
    };
    const user = fakeProxy();
    const u = setup({ proxy: user.proxy, knowledge: withAdmin, isAdmin: false });
    await act(() => u.result.current.send('how do I set up targets?'));
    expect(systemOf(user.ask.mock.calls[0][0])).not.toContain('ADMIN SETUP BODY');

    const admin = fakeProxy();
    const ad = setup({ proxy: admin.proxy, knowledge: withAdmin, isAdmin: true });
    await act(() => ad.result.current.send('how do I set up targets?'));
    expect(systemOf(admin.ask.mock.calls[0][0])).toContain('ADMIN SETUP BODY');
  });

  it('elapsedMs covers proxy + Concierge on forwarded answers', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { proxy } = fakeProxy(() => {
      vi.setSystemTime(Date.now() + 2000);

      return { kind: 'forward' };
    });
    const conciergeAsk = vi.fn(async (): Promise<AskResult> => {
      vi.setSystemTime(Date.now() + 3000);

      return { answer: 'x', relatedReports: [] };
    });
    const { result } = setup({ proxy }, { ask: conciergeAsk });
    await act(() => result.current.send('q'));
    expect(result.current.messages[1].elapsedMs).toBe(5000);
  });

  it('no allowed Concierge source + proxy answer: page question still answered', async () => {
    const { proxy } = fakeProxy();
    const { result, client } = setup({ proxy }, { getTools: vi.fn(async () => ['Snowflake']) });
    await act(() => result.current.send('how do targets work?'));
    expect(result.current.messages[1]).toMatchObject({ status: 'done', route: 'page' });
    expect(client.ask).not.toHaveBeenCalled();
  });

  it('no allowed Concierge source + forward: message errorKind no_sources', async () => {
    const { proxy } = fakeProxy(() => ({ kind: 'forward' }));
    const { result, client } = setup({ proxy }, { getTools: vi.fn(async () => ['Snowflake']) });
    await act(() => result.current.send('history of revenue?'));
    expect(result.current.messages[1]).toMatchObject({ status: 'error', errorKind: 'no_sources' });
    expect(client.ask).not.toHaveBeenCalled();
  });
});

describe('useConciergeChat persistence and undo', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  const turns = (msgs: { role: string; text: string; status: string }[]) => msgs.map((m) => [m.role, m.text, m.status]);

  it('storageKey: finished turns and the conversation survive a remount', async () => {
    const first = setup({ storageKey: 'k' });
    await act(() => first.result.current.send('q1'));
    const ts = first.asks[0].conversationTs;
    first.unmount();

    const second = setup({ storageKey: 'k' });
    expect(turns(second.result.current.messages)).toEqual([
      ['user', 'q1', 'done'],
      ['assistant', 'hello', 'done'],
    ]);
    await act(() => second.result.current.send('q2'));
    expect(second.asks[0].conversationTs).toBe(ts);
  });

  it('storageKey: a question still pending at unmount is dropped with its answer slot', async () => {
    let calls = 0;
    const ask = vi.fn(
      async (): Promise<AskResult> =>
        ++calls === 1 ? { answer: 'a1', relatedReports: [] } : new Promise<AskResult>(() => {}),
    );
    const first = setup({ storageKey: 'k' }, { ask });
    await act(() => first.result.current.send('q1'));
    act(() => {
      void first.result.current.send('q2');
    });
    first.unmount();

    const second = setup({ storageKey: 'k' });
    expect(turns(second.result.current.messages)).toEqual([
      ['user', 'q1', 'done'],
      ['assistant', 'a1', 'done'],
    ]);
  });

  it('without storageKey nothing is stored', async () => {
    const first = setup();
    await act(() => first.result.current.send('q1'));
    first.unmount();
    expect(sessionStorage.length).toBe(0);
    expect(setup().result.current.messages).toEqual([]);
  });

  it('a throwing sessionStorage does not break the chat', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = setup({ storageKey: 'k' });
    await act(() => result.current.send('q1'));
    expect(result.current.messages[1]).toMatchObject({ status: 'done', text: 'hello' });
  });

  it('newChat then undoNewChat brings back the turns and the conversation', async () => {
    const { result, asks } = setup({ storageKey: 'k' });
    await act(() => result.current.send('q1'));
    const ts = asks[0].conversationTs;
    act(() => result.current.newChat());
    expect(result.current.messages).toEqual([]);
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undoNewChat());
    expect(turns(result.current.messages)).toEqual([
      ['user', 'q1', 'done'],
      ['assistant', 'hello', 'done'],
    ]);
    expect(result.current.canUndo).toBe(false);
    await act(() => result.current.send('q2'));
    expect(asks[1].conversationTs).toBe(ts);
  });

  it('newChat clears storage; undo writes the chat back', async () => {
    const a = setup({ storageKey: 'k' });
    await act(() => a.result.current.send('q1'));
    act(() => a.result.current.newChat());
    expect(setup({ storageKey: 'k' }).result.current.messages).toEqual([]);
    act(() => a.result.current.undoNewChat());
    expect(setup({ storageKey: 'k' }).result.current.messages).toHaveLength(2);
  });

  it('newChat on an empty chat offers no undo', () => {
    const { result } = setup();
    act(() => result.current.newChat());
    expect(result.current.canUndo).toBe(false);
  });

  it('a send after newChat drops the undo', async () => {
    const { result } = setup();
    await act(() => result.current.send('q1'));
    act(() => result.current.newChat());
    await act(() => result.current.send('q2'));
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.undoNewChat());
    expect(turns(result.current.messages)).toEqual([
      ['user', 'q2', 'done'],
      ['assistant', 'hello', 'done'],
    ]);
  });

  it('dismissUndo drops the undo', async () => {
    const { result } = setup();
    await act(() => result.current.send('q1'));
    act(() => result.current.newChat());
    act(() => result.current.dismissUndo());
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.undoNewChat());
    expect(result.current.messages).toEqual([]);
  });

  it('newChat during a pending question: undo restores only the finished turns', async () => {
    let calls = 0;
    const ask = vi.fn(
      async (): Promise<AskResult> =>
        ++calls === 1 ? { answer: 'a1', relatedReports: [] } : new Promise<AskResult>(() => {}),
    );
    const { result } = setup({}, { ask });
    await act(() => result.current.send('q1'));
    act(() => {
      void result.current.send('q2');
    });
    act(() => result.current.newChat());
    expect(result.current.isBusy).toBe(false);
    act(() => result.current.undoNewChat());
    expect(turns(result.current.messages)).toEqual([
      ['user', 'q1', 'done'],
      ['assistant', 'a1', 'done'],
    ]);
  });
});

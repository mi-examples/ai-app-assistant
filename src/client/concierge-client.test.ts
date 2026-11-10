import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConciergeError, createConciergeClient } from './concierge-client';
import { newConversationTs, newMessageUid } from './ids';

type FetchFn = typeof fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fakeFetch(res: Response | (() => Response)) {
  return vi.fn(async () => (typeof res === 'function' ? res() : res));
}

const input = { q: 'hi', conversationTs: '1234567890123456', messageUid: 'a'.repeat(32) };

describe('ids', () => {
  it('match MI formats', () => {
    expect(newConversationTs()).toMatch(/^\d{16}$/);
    expect(newMessageUid()).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('getTools', () => {
  it('GETs /data/concierge/get-tools with same-origin credentials and returns names', async () => {
    const f = fakeFetch(jsonResponse({ data: [{ name: 'a', title: 'A', icon: 'x' }, { name: 'b' }] }));
    const c = createConciergeClient({ fetch: f as unknown as FetchFn });
    expect(await c.getTools()).toEqual(['a', 'b']);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/data/concierge/get-tools');
    expect(init.credentials).toBe('same-origin');
    expect(init.method ?? 'GET').toBe('GET');
  });
});

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/stream' } });
}

describe('ask', () => {
  it('POSTs to /data/concierge/proxy with ids, stream=0, interface=react and tools in the query', async () => {
    const f = fakeFetch(textResponse('ok'));
    const c = createConciergeClient({ fetch: f as unknown as FetchFn });
    await c.ask({ ...input, tools: ['a', 'b'] });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `/data/concierge/proxy?conversation_ts=${input.conversationTs}&message_uid=${input.messageUid}` +
        '&stream=0&interface=react&tools=a%2Cb',
    );
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest',
    });
  });

  it('omits tools from the query when empty', async () => {
    const f = fakeFetch(textResponse('ok'));
    const c = createConciergeClient({ fetch: f as unknown as FetchFn });
    await c.ask({ ...input, tools: [] });
    expect((f.mock.calls[0] as unknown as [string])[0]).not.toContain('tools=');
  });

  it('sends path, location, q, context, element_id in body; omits null element_id and undefined context', async () => {
    const f = fakeFetch(() => textResponse('ok'));
    const c = createConciergeClient({ fetch: f as unknown as FetchFn });
    await c.ask({ ...input, context: 'ctx', elementId: 7 });
    await c.ask({ ...input, elementId: null });
    const bodies = f.mock.calls.map((call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string));
    expect(bodies[0]).toEqual({ path: '', location: '', q: 'hi', context: 'ctx', element_id: 7 });
    expect(bodies[1]).toEqual({ path: '', location: '', q: 'hi' });
  });

  it('prefixes origin when given', async () => {
    const f = fakeFetch(textResponse('ok'));
    const c = createConciergeClient({ fetch: f as unknown as FetchFn, origin: 'https://mi.test' });
    await c.ask(input);
    expect((f.mock.calls[0] as unknown as [string])[0]).toMatch(/^https:\/\/mi\.test\/data\/concierge\/proxy\?/);
  });

  it('maps 403 to no_sources', async () => {
    const c = createConciergeClient({ fetch: fakeFetch(textResponse('', 403)) as unknown as FetchFn });
    await expect(c.ask(input)).rejects.toMatchObject({ kind: 'no_sources' });
  });

  it('maps fetch rejection to network', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const c = createConciergeClient({ fetch: f as unknown as FetchFn });
    const err = await c.ask(input).catch((e) => e);
    expect(err).toBeInstanceOf(ConciergeError);
    expect(err.kind).toBe('network');
  });

  it('maps 5xx to server', async () => {
    const c = createConciergeClient({ fetch: fakeFetch(textResponse('', 502)) as unknown as FetchFn });
    await expect(c.ask(input)).rejects.toMatchObject({ kind: 'server' });
  });

  it('maps an HTML body with status 200 to unavailable', async () => {
    const c = createConciergeClient({
      fetch: fakeFetch(textResponse('  <!DOCTYPE html><html>login</html>')) as unknown as FetchFn,
    });
    await expect(c.ask(input)).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('maps a passed-through service 500 page with status 200 to server', async () => {
    const c = createConciergeClient({
      fetch: fakeFetch(textResponse('500 Internal Server Error\n\nServer got itself in trouble')) as unknown as FetchFn,
    });
    await expect(c.ask(input)).rejects.toMatchObject({ kind: 'server' });
  });

  it('maps "LLM configuration error: LLM_API_KEY is absent" to unavailable', async () => {
    const c = createConciergeClient({
      fetch: fakeFetch(textResponse('LLM configuration error: LLM_API_KEY is absent')) as unknown as FetchFn,
    });
    await expect(c.ask(input)).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('returns cleaned text answer from a text/stream body, with relatedReports []', async () => {
    const c = createConciergeClient({
      fetch: fakeFetch(textResponse('Answer %BEGIN_JSON%{"x":1}%END_JSON% done \n')) as unknown as FetchFn,
    });
    expect(await c.ask(input)).toEqual({ answer: 'Answer  done', relatedReports: [] });
  });
});

describe('ask: search results', () => {
  const block = (o: unknown) => `%BEGIN_JSON%\n${JSON.stringify(o)}\n%END_JSON%\n`;
  const badge = block({ data_type: 'status-badge', title: 'Searching...' });
  const results = (data: unknown[], extra: object = {}) =>
    block({
      data_type: 'search_results',
      quantity: data.length,
      data,
      search_criteria_summary_phrase: 'I found these results for "Open Deals Amount".',
      ...extra,
    });
  const ask = (body: string) =>
    createConciergeClient({ fetch: fakeFetch(textResponse(body)) as unknown as FetchFn }).ask(input);

  it('turns a search-only reply into the summary line and a list of same-site links', async () => {
    const r = await ask(
      badge +
        results([
          {
            type: 'dataset',
            name: '[Sales] Derived Pivot',
            url: 'https://mi.example.com/dataset/index/index/ds/101',
          },
          { type: 'report', name: 'Sales', url: 'https://mi.example.com/report/12?x=1' },
        ]),
    );
    expect(r.answer).toBe(
      'I found these results for "Open Deals Amount".\n\n' +
        '- [\\[Sales\\] Derived Pivot](/dataset/index/index/ds/101)\n' +
        '- [Sales](/report/12?x=1)',
    );
    expect(r.found).toEqual([
      { type: 'dataset', name: '[Sales] Derived Pivot' },
      { type: 'report', name: 'Sales' },
    ]);
  });

  it('keeps a text answer as the answer and still lists what was found', async () => {
    const r = await ask('Here is the trend. ' + results([{ type: 'dataset', name: 'D', url: '/dataset/1' }]));
    expect(r.answer).toBe('Here is the trend.');
    expect(r.found).toEqual([{ type: 'dataset', name: 'D' }]);
  });

  it('shows an item without a usable link as plain text and skips nameless items', async () => {
    const r = await ask(
      results(
        [
          { type: 'dataset', name: 'NoUrl' },
          { type: 'dataset', name: 'Bad', url: 'javascript:alert(1)' },
          { type: 'dataset', url: '/x' },
        ],
        { search_criteria_summary_phrase: '' },
      ),
    );
    expect(r.answer).toBe('I found these results:\n\n- NoUrl\n- Bad');
    expect(r.found).toEqual([
      { type: 'dataset', name: 'NoUrl' },
      { type: 'dataset', name: 'Bad' },
    ]);
  });

  it('leaves the answer empty when the search found nothing', async () => {
    const r = await ask(badge + results([]));
    expect(r.answer).toBe('');
    expect(r.found ?? []).toEqual([]);
  });
});

describe('ask: errors inside JSON blocks', () => {
  const answerFor = (body: string) =>
    createConciergeClient({ fetch: fakeFetch(textResponse(body)) as unknown as FetchFn }).ask(input);

  it('maps a JSON block with a non-empty error key to server', async () => {
    await expect(answerFor('%BEGIN_JSON%{"error":"Tool failed"}%END_JSON%')).rejects.toMatchObject({
      kind: 'server',
    });
  });

  it('maps a JSON block with status ERROR to server, even after other blocks', async () => {
    await expect(
      answerFor('Hi %BEGIN_JSON%{"x":1}%END_JSON% %BEGIN_JSON%{"status":"ERROR","message":"m"}%END_JSON%'),
    ).rejects.toBeInstanceOf(ConciergeError);
  });

  it('ignores empty error keys, non-object and unparseable blocks', async () => {
    expect(
      (await answerFor('ok %BEGIN_JSON%{"error":""}%END_JSON%%BEGIN_JSON%[1]%END_JSON%%BEGIN_JSON%{bad%END_JSON%'))
        .answer,
    ).toBe('ok');
  });
});

describe('ask timeout and cancel', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const hanging = () =>
    vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => new Promise<Response>(() => undefined));

  it('gives up after 90s with a network error and aborts the request', async () => {
    vi.useFakeTimers();
    const f = hanging();
    const c = createConciergeClient({ fetch: f as unknown as FetchFn });
    const settled = vi.fn();
    const p = c.ask(input).catch((e) => {
      settled(e);
    });
    await vi.advanceTimersByTimeAsync(89_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await p;
    const err = settled.mock.calls[0][0];
    expect(err).toBeInstanceOf(ConciergeError);
    expect(err.kind).toBe('network');
    expect(f.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('rejects with network when the caller aborts, and forwards the abort to fetch', async () => {
    const f = hanging();
    const c = createConciergeClient({ fetch: f as unknown as FetchFn });
    const ctrl = new AbortController();
    const p = c.ask({ ...input, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ kind: 'network' });
    expect(f.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('rejects with network for an already-aborted signal', async () => {
    const c = createConciergeClient({ fetch: hanging() as unknown as FetchFn });
    await expect(c.ask({ ...input, signal: AbortSignal.abort() })).rejects.toMatchObject({ kind: 'network' });
  });

  it('clears the timeout once answered', async () => {
    vi.useFakeTimers();
    const c = createConciergeClient({ fetch: fakeFetch(textResponse('ok')) as unknown as FetchFn });
    await c.ask(input);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('feedback', () => {
  const fb = { conversationTs: '123', question: 'q', answer: 'a', feedback: 'like' as const };

  it('POSTs concierge_message_id = conversationTs', async () => {
    const f = fakeFetch(jsonResponse({}));
    const c = createConciergeClient({ fetch: f as unknown as FetchFn });
    await c.feedback(fb);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/data/concierge/feedback');
    expect(init.credentials).toBe('same-origin');
    expect(JSON.parse(init.body as string)).toEqual({
      concierge_message_id: '123',
      question: 'q',
      feedback: 'like',
      answer: 'a',
    });
  });

  it('throws ConciergeError on non-2xx', async () => {
    const c = createConciergeClient({ fetch: fakeFetch(jsonResponse({}, 500)) as unknown as FetchFn });
    await expect(c.feedback(fb)).rejects.toBeInstanceOf(ConciergeError);
  });
});

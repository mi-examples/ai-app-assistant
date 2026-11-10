import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLlmProxyClient, type ChatTurn } from './llm-proxy';

type FetchFn = typeof fetch;

const TOKEN = 'secret-token-123';
const messages: ChatTurn[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'hi' },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const completion = (content: string) => json({ choices: [{ message: { content } }] });
const tokenRes = (token = TOKEN) => json({ token });
const html = (status: number) => new Response('<html>nope</html>', { status });

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** Routes by URL: /api/get_token and the proxy endpoint. */
function route(opts: { token?: Handler; proxy: Handler }) {
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === '/api/get_token') return (opts.token ?? (() => tokenRes()))(url, init);

    return opts.proxy(url, init);
  });
}

const asFetch = (f: unknown) => f as FetchFn;
const proxyCalls = (f: ReturnType<typeof route>) => f.mock.calls.filter((c) => c[0] !== '/api/get_token');
const tokenCalls = (f: ReturnType<typeof route>) => f.mock.calls.filter((c) => c[0] === '/api/get_token');

afterEach(() => {
  vi.useRealTimers();
});

describe('createLlmProxyClient', () => {
  it('fetches /api/get_token once and sends Bearer token, model default, the messages', async () => {
    const f = route({ proxy: () => completion('hello') });
    const c = createLlmProxyClient({ fetch: asFetch(f) });
    await c.ask({ messages });
    await c.ask({ messages });
    expect(tokenCalls(f)).toHaveLength(1);
    expect(tokenCalls(f)[0][1]).toMatchObject({ credentials: 'same-origin' });
    const [url, init] = proxyCalls(f)[0] as [string, RequestInit];
    expect(url).toBe('/ai/oai_api/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual({ model: 'default', messages });
  });

  it('returns answer text from choices[0].message.content', async () => {
    const f = route({ proxy: () => completion('The answer') });
    expect(await createLlmProxyClient({ fetch: asFetch(f) }).ask({ messages })).toEqual({
      kind: 'answer',
      text: 'The answer',
    });
  });

  it('returns forward when the reply contains the marker anywhere', async () => {
    const reply = async (content: string) =>
      createLlmProxyClient({ fetch: asFetch(route({ proxy: () => completion(content) })) }).ask({ messages });
    expect(await reply('  [[CONCIERGE]]\n')).toEqual({ kind: 'forward' });
    expect(await reply('[[CONCIERGE]] need data')).toEqual({ kind: 'forward' });
    expect(
      await reply('The snapshot does not provide the calculation or formula for Total Sales Amount. [[CONCIERGE]]'),
    ).toEqual({ kind: 'forward' });
    expect(await reply('See [[CONCIERGE]]')).toEqual({ kind: 'forward' });
    expect(await reply('Revenue is $4M [1].')).toEqual({ kind: 'answer', text: 'Revenue is $4M [1].' });
  });

  it('takes the stand-alone question written after the marker, else none', async () => {
    const reply = async (content: string) =>
      createLlmProxyClient({ fetch: asFetch(route({ proxy: () => completion(content) })) }).ask({ messages });
    expect(await reply('[[CONCIERGE]] How do I open the Dashboard configuration editor?')).toEqual({
      kind: 'forward',
      question: 'How do I open the Dashboard configuration editor?',
    });
    expect(await reply('[[CONCIERGE]]\n\n  "How is Total Sales Amount calculated?"  \nextra')).toEqual({
      kind: 'forward',
      question: 'How is Total Sales Amount calculated?',
    });
    // A reason, not a question: Concierge gets what the user typed.
    expect(await reply('[[CONCIERGE]] need report data')).toEqual({ kind: 'forward' });
    expect(await reply('No data here. [[CONCIERGE]]')).toEqual({ kind: 'forward' });
  });

  it('refreshes the token once on 403 invalid_api_key, then succeeds', async () => {
    let n = 0;
    const f = route({
      token: () => tokenRes(`tok-${++n}`),
      proxy: (_u, init) =>
        (init.headers as Record<string, string>).Authorization === 'Bearer tok-1'
          ? json({ error: { message: 'bad', type: 'x', code: 'invalid_api_key' } }, 403)
          : completion('ok'),
    });
    const r = await createLlmProxyClient({ fetch: asFetch(f) }).ask({ messages });
    expect(r).toEqual({ kind: 'answer', text: 'ok' });
    expect(tokenCalls(f)).toHaveLength(2);
    expect(proxyCalls(f)).toHaveLength(2);
  });

  it('403 invalid_api_key twice is sticky unavailable', async () => {
    const f = route({ proxy: () => json({ error: { code: 'invalid_api_key' } }, 403) });
    const c = createLlmProxyClient({ fetch: asFetch(f) });
    expect(await c.ask({ messages })).toEqual({ kind: 'unavailable', sticky: true });
    const before = f.mock.calls.length;
    expect(await c.ask({ messages })).toEqual({ kind: 'unavailable', sticky: true });
    expect(f.mock.calls.length).toBe(before);
  });

  const sticky: [string, Parameters<typeof route>[0]][] = [
    ['503', { proxy: () => json({ error: { code: 'service_disabled' } }, 503) }],
    ['405 HTML', { proxy: () => html(405) }],
    ['404', { proxy: () => html(404) }],
    ['200 non-JSON', { proxy: () => new Response('<html>login</html>', { status: 200 }) }],
    ['token endpoint 500', { token: () => json({}, 500), proxy: () => completion('x') }],
    ['token body without token', { token: () => json({ nope: 1 }), proxy: () => completion('x') }],
  ];
  it.each(sticky)('%s is sticky unavailable and later asks make no request', async (_n, opts) => {
    const f = route(opts);
    const c = createLlmProxyClient({ fetch: asFetch(f) });
    expect(await c.ask({ messages })).toEqual({ kind: 'unavailable', sticky: true });
    const before = f.mock.calls.length;
    expect(await c.ask({ messages })).toEqual({ kind: 'unavailable', sticky: true });
    expect(f.mock.calls.length).toBe(before);
  });

  it('network error is per-question unavailable', async () => {
    let fail = true;
    const f = route({
      proxy: () => {
        if (fail) throw new TypeError('network');

        return completion('back');
      },
    });
    const c = createLlmProxyClient({ fetch: asFetch(f) });
    expect(await c.ask({ messages })).toEqual({ kind: 'unavailable', sticky: false });
    fail = false;
    expect(await c.ask({ messages })).toEqual({ kind: 'answer', text: 'back' });
  });

  it('a 5xx is retried once after a short pause, and the retry can answer', async () => {
    vi.useFakeTimers();
    let n = 0;
    const f = route({ proxy: () => (++n === 1 ? json({ error: { code: 'boom' } }, 500) : completion('ok')) });
    const p = createLlmProxyClient({ fetch: asFetch(f) }).ask({ messages });
    await vi.advanceTimersByTimeAsync(499);
    expect(proxyCalls(f)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ kind: 'answer', text: 'ok' });
    expect(proxyCalls(f)).toHaveLength(2);
  });

  it('two 5xx in a row are per-question unavailable; the next question asks again', async () => {
    const f = route({ proxy: () => json({ error: { code: 'boom' } }, 502) });
    const c = createLlmProxyClient({ fetch: asFetch(f), retryDelayMs: 0 });
    expect(await c.ask({ messages })).toEqual({ kind: 'unavailable', sticky: false });
    expect(proxyCalls(f)).toHaveLength(2);
    await c.ask({ messages });
    expect(proxyCalls(f)).toHaveLength(4);
  });

  it('a non-retryable 4xx (400) is per-question unavailable without a retry', async () => {
    const f = route({ proxy: () => json({ error: { code: 'bad' } }, 400) });
    const c = createLlmProxyClient({ fetch: asFetch(f), retryDelayMs: 0 });
    expect(await c.ask({ messages })).toEqual({ kind: 'unavailable', sticky: false });
    expect(proxyCalls(f)).toHaveLength(1);
  });

  it('503 service_disabled stays sticky and is not retried', async () => {
    const f = route({ proxy: () => json({ error: { code: 'service_disabled' } }, 503) });
    const c = createLlmProxyClient({ fetch: asFetch(f), retryDelayMs: 0 });
    expect(await c.ask({ messages })).toEqual({ kind: 'unavailable', sticky: true });
    expect(proxyCalls(f)).toHaveLength(1);
  });

  it('caller abort during the retry pause rejects with AbortError and sends no retry', async () => {
    vi.useFakeTimers();
    const f = route({ proxy: () => json({}, 500) });
    const ctrl = new AbortController();
    const p = createLlmProxyClient({ fetch: asFetch(f) }).ask({ messages, signal: ctrl.signal });
    const settled = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    ctrl.abort();
    expect(((await settled) as DOMException).name).toBe('AbortError');
    await vi.advanceTimersByTimeAsync(1000);
    expect(proxyCalls(f)).toHaveLength(1);
  });

  it('timeout after 30 000 ms is per-question unavailable', async () => {
    vi.useFakeTimers();
    const f = route({ proxy: () => new Promise<Response>(() => {}) });
    const c = createLlmProxyClient({ fetch: asFetch(f) });
    const settled = vi.fn();
    const p = c.ask({ messages }).then(settled);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(settled).toHaveBeenCalledWith({ kind: 'unavailable', sticky: false });
    await vi.advanceTimersByTimeAsync(0);
    const p2 = c.ask({ messages });
    await vi.advanceTimersByTimeAsync(30_000);
    await p2;
    expect(proxyCalls(f)).toHaveLength(2);
  });

  it('caller abort during token fetch rejects with AbortError and sends no proxy request', async () => {
    const f = route({ token: () => new Promise<Response>(() => {}), proxy: () => completion('x') });
    const ctrl = new AbortController();
    const p = createLlmProxyClient({ fetch: asFetch(f) }).ask({ messages, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(proxyCalls(f)).toHaveLength(0);
  });

  it('token never appears in a URL', async () => {
    const f = route({ proxy: () => completion('x') });
    await createLlmProxyClient({ fetch: asFetch(f) }).ask({ messages });
    for (const [url] of f.mock.calls) expect(url).not.toContain(TOKEN);
  });
});

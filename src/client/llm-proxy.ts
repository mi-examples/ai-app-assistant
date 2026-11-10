export type ChatTurn = { role: 'system' | 'user' | 'assistant'; content: string };

export type ProxyResult =
  | { kind: 'answer'; text: string }
  /** `question`: the proxy's stand-alone rewrite of the question, when it wrote one. */
  | { kind: 'forward'; question?: string }
  | { kind: 'unavailable'; sticky: boolean };

export interface LlmProxyClient {
  /** Never rejects except when the caller's `signal` aborts (DOMException 'AbortError'). */
  ask(i: { messages: ChatTurn[]; signal?: AbortSignal }): Promise<ProxyResult>;
}

export const FORWARD_MARKER = '[[CONCIERGE]]';

const TOKEN_URL = '/api/get_token';
const PROXY_URL = '/ai/oai_api/v1/chat/completions';
const TIMEOUT_MS = 30_000;
/** Pause before the one retry of a 5xx; the proxy's errors are mostly passing server faults. */
const RETRY_DELAY_MS = 500;

/** Internal: carries the outcome out of the request flow. */
class Unavailable extends Error {
  sticky: boolean;

  constructor(sticky: boolean, message: string) {
    super(message);
    this.sticky = sticky;
  }
}

/** Rejects as soon as `signal` aborts, even if `p` never settles (a fetch that ignores its signal). */
function untilAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Resolves after `ms`; rejects at once when `signal` aborts. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return untilAborted(new Promise<void>((resolve) => setTimeout(resolve, ms)), signal);
}

async function parseJson(res: Response): Promise<unknown> {
  try {
    return JSON.parse(await res.text());
  } catch {
    return undefined;
  }
}

/** First line after the marker, unquoted, when it is a question; a reason or nothing gives undefined. */
function rewrittenQuestion(content: string): string | undefined {
  const after = content.slice(content.indexOf(FORWARD_MARKER) + FORWARD_MARKER.length);
  const line = after
    .split('\n')
    .map((l) => l.trim().replace(/^["“]|["”]$/g, '').trim())
    .find((l) => l !== '');

  return line?.endsWith('?') ? line : undefined;
}

function errorCode(body: unknown): unknown {
  const err = (body as { error?: { code?: unknown } } | undefined)?.error;

  return err && typeof err === 'object' ? err.code : undefined;
}

export function createLlmProxyClient(
  opts: { fetch?: typeof fetch; timeoutMs?: number; retryDelayMs?: number } = {},
): LlmProxyClient {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const retryDelayMs = opts.retryDelayMs ?? RETRY_DELAY_MS;
  let token: string | null = null;
  let stickyUnavailable = false;

  async function send(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
    try {
      return await untilAborted(doFetch(url, { ...init, signal }), signal);
    } catch (e) {
      if (signal.aborted) throw e;
      throw new Unavailable(false, 'network error');
    }
  }

  async function fetchToken(signal: AbortSignal): Promise<string> {
    const res = await send(TOKEN_URL, { method: 'GET', credentials: 'same-origin' }, signal);
    if (!res.ok) throw new Unavailable(true, `token HTTP ${res.status}`);
    const t = ((await parseJson(res)) as { token?: unknown } | undefined)?.token;
    if (typeof t !== 'string' || t === '') throw new Unavailable(true, 'token missing');

    return t;
  }

  function post(messages: ChatTurn[], bearer: string, signal: AbortSignal): Promise<Response> {
    return send(
      PROXY_URL,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ model: 'default', messages }),
      },
      signal,
    );
  }

  async function run(messages: ChatTurn[], signal: AbortSignal): Promise<ProxyResult> {
    token ??= await fetchToken(signal);
    let res = await post(messages, token, signal);

    if (res.status === 403) {
      const code = errorCode(await parseJson(res));
      if (code !== 'invalid_api_key') throw new Unavailable(false, 'HTTP 403');
      token = await fetchToken(signal);
      res = await post(messages, token, signal);
      if (res.status === 403 && errorCode(await parseJson(res)) === 'invalid_api_key') {
        throw new Unavailable(true, 'invalid_api_key');
      }
    }

    // An unhandled server error (often the first call after a quiet spell) gets one more try.
    // 503 means the service is switched off, which a retry won't change.
    if (res.status >= 500 && res.status !== 503) {
      await pause(retryDelayMs, signal);
      res = await post(messages, token, signal);
    }

    if (res.status === 503 || res.status === 405 || res.status === 404) {
      throw new Unavailable(true, `HTTP ${res.status}`);
    }
    if (!res.ok) throw new Unavailable(false, `HTTP ${res.status}`);

    const body = await parseJson(res);
    if (body === undefined) throw new Unavailable(true, 'non-JSON response');
    const content = (body as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Unavailable(false, 'no content');

    // The model sometimes writes a sentence before the marker; the marker anywhere means forward.
    if (!content.includes(FORWARD_MARKER)) return { kind: 'answer', text: content };
    const question = rewrittenQuestion(content);

    return question ? { kind: 'forward', question } : { kind: 'forward' };
  }

  return {
    async ask({ messages, signal }) {
      if (stickyUnavailable) return { kind: 'unavailable', sticky: true };

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const onCallerAbort = () => ctrl.abort();
      if (signal?.aborted) ctrl.abort();
      else signal?.addEventListener('abort', onCallerAbort, { once: true });
      try {
        return await run(messages, ctrl.signal);
      } catch (e) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (e instanceof Unavailable) {
          if (e.sticky) stickyUnavailable = true;

          return { kind: 'unavailable', sticky: e.sticky };
        }

        // Timeout abort or anything unexpected: this question only.
        return { kind: 'unavailable', sticky: false };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onCallerAbort);
      }
    },
  };
}

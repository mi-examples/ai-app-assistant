import { cleanResponse, formatSearchResults, hasJsonBlockError, readSearchResults } from './clean-response';

export type ConciergeErrorKind = 'no_sources' | 'unavailable' | 'network' | 'server';

export class ConciergeError extends Error {
  kind: ConciergeErrorKind;

  constructor(kind: ConciergeErrorKind, message?: string) {
    super(message ?? kind);
    this.name = 'ConciergeError';
    this.kind = kind;
    Object.setPrototypeOf(this, ConciergeError.prototype);
  }
}

export interface AskInput {
  q: string;
  conversationTs: string;
  messageUid: string;
  context?: string;
  elementId?: number | null;
  tools?: string[];
  /** Cancels the request; the promise then rejects with ConciergeError('network'). */
  signal?: AbortSignal;
}

export interface AskResult {
  answer: string;
  relatedReports: { id: number; name: string }[];
  /** What Concierge's search found (datasets, reports, …), when it searched. */
  found?: { type: string; name: string }[];
}

export interface ConciergeClient {
  getTools(): Promise<string[]>;
  ask(i: AskInput): Promise<AskResult>;
  feedback(i: {
    conversationTs: string;
    question: string;
    answer: string;
    feedback: 'like' | 'dislike';
  }): Promise<void>;
}

type Json = Record<string, unknown>;

const ASK_TIMEOUT_MS = 90_000;

/** Rejects as soon as `signal` aborts, even if `p` never settles (a fetch that ignores its signal). */
function untilAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ConciergeError('network', 'aborted'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function statusError(status: number): ConciergeError {
  if (status === 403) return new ConciergeError('no_sources', 'HTTP 403');
  if (status === 401) return new ConciergeError('unavailable', 'HTTP 401');

  return new ConciergeError('server', `HTTP ${status}`);
}

export function createConciergeClient(opts: { fetch?: typeof fetch; origin?: string } = {}): ConciergeClient {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const origin = opts.origin ?? '';

  async function request(path: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await doFetch(`${origin}${path}`, { ...init, credentials: 'same-origin' });
    } catch (e) {
      throw new ConciergeError('network', e instanceof Error ? e.message : 'network error');
    }
    if (!res.ok) throw statusError(res.status);

    return res;
  }

  async function readJson(res: Response): Promise<Json> {
    try {
      const parsed: unknown = JSON.parse(await res.text());
      if (parsed && typeof parsed === 'object') return parsed as Json;
    } catch {
      /* fall through */
    }
    // Expired session returns an HTML login page with status 200.
    throw new ConciergeError('unavailable', 'non-JSON response');
  }

  function post(path: string, body: Json): Promise<Response> {
    return request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function askOnce(i: AskInput, signal: AbortSignal): Promise<AskResult> {
    const params = new URLSearchParams({
      conversation_ts: i.conversationTs,
      message_uid: i.messageUid,
      stream: '0',
      interface: 'react',
    });
    if (i.tools && i.tools.length > 0) params.set('tools', i.tools.join(','));
    const loc = typeof window !== 'undefined' ? window.location : undefined;
    const body: Json = { path: loc?.pathname ?? '', location: loc?.href ?? '', q: i.q };
    if (i.context !== undefined) body.context = i.context;
    if (i.elementId != null) body.element_id = i.elementId;
    const res = await request(`/data/concierge/proxy?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(body),
      signal,
    });
    const text = await res.text();
    const head = text.trim().toLowerCase();
    if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('llm configuration error')) {
      throw new ConciergeError('unavailable', 'Concierge unavailable');
    }
    // The Concierge service's own error page, passed through with HTTP 200.
    if (head.startsWith('500 internal server error')) throw new ConciergeError('server', 'service error');
    if (hasJsonBlockError(text)) throw new ConciergeError('server', 'error in response');

    const { summary, items } = readSearchResults(text);
    const cleaned = cleanResponse(text);
    // A reply that only searched has no text of its own; show what it found.
    const answer = cleaned || (items.length > 0 ? formatSearchResults(summary, items) : '');
    const found = items.map(({ type, name }) => ({ type, name }));

    return { answer, relatedReports: [], ...(found.length > 0 ? { found } : {}) };
  }

  return {
    async getTools() {
      const res = await request('/data/concierge/get-tools', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const json = await readJson(res);
      const data = Array.isArray(json.data) ? json.data : [];

      return data.map((t) => (t as Json | null)?.name).filter((n): n is string => typeof n === 'string');
    },

    async ask(i) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ASK_TIMEOUT_MS);
      const onCallerAbort = () => ctrl.abort();
      if (i.signal?.aborted) ctrl.abort();
      else i.signal?.addEventListener('abort', onCallerAbort, { once: true });
      try {
        return await untilAborted(askOnce(i, ctrl.signal), ctrl.signal);
      } finally {
        clearTimeout(timer);
        i.signal?.removeEventListener('abort', onCallerAbort);
      }
    },

    async feedback(i) {
      await post('/data/concierge/feedback', {
        concierge_message_id: i.conversationTs,
        question: i.question,
        feedback: i.feedback,
        answer: i.answer,
      });
    },
  };
}

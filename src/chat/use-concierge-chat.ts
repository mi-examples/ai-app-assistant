import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ConciergeError, type ConciergeClient, type ConciergeErrorKind } from '../client/concierge-client';
import { newConversationTs, newMessageUid } from '../client/ids';
import type { LlmProxyClient } from '../client/llm-proxy';
import { pickSources } from '../client/sources';
import { buildContext, buildQuestionPrefix, earlierTurnLine } from '../context/build-context';
import { buildProxyMessages } from '../context/build-proxy-prompt';
import type { KnowledgePack, KnowledgeSection } from '../context/knowledge';
import { pickSections } from '../context/pick-sections';
import { PAGE_CONTEXT_HEADER, type PageContext } from '../context/page-context';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: 'pending' | 'done' | 'error';
  errorKind?: ConciergeErrorKind;
  /** Set when done; 'concierge' also while a forwarded question is pending. */
  route?: 'page' | 'concierge';
  /** True while pending after the proxy said forward. */
  forwarded?: boolean;
  sources?: { label: string; detail: string }[];
  /** Number of numbered sources the answer may cite; route 'page' only. */
  citations?: number;
  /** Total from sending (or retrying) the question to the answer. */
  elapsedMs?: number;
};

type Action =
  | { type: 'add'; messages: ChatMessage[] }
  | { type: 'patch'; id: string; patch: Partial<ChatMessage> }
  | { type: 'remove'; ids: string[] }
  | { type: 'set'; messages: ChatMessage[] }
  | { type: 'reset' };

function reducer(state: ChatMessage[], action: Action): ChatMessage[] {
  switch (action.type) {
    case 'add':
      return [...state, ...action.messages];
    case 'patch':
      return state.map((m) => (m.id === action.id ? { ...m, ...action.patch } : m));
    case 'remove':
      return state.filter((m) => !action.ids.includes(m.id));
    case 'set':
      return action.messages;
    case 'reset':
      return [];
  }
}

const EMPTY_ANSWER = "I couldn't find an answer to that.";
const PROXY_MAX_SECTIONS = 6;

type Source = { label: string; detail: string };

/** 'dataset' → 'Dataset'; an untyped search hit is a 'Result'. */
const foundLabel = (type: string): string => (type ? type[0].toUpperCase() + type.slice(1) : 'Result');

type Turn = { question: string; answer: string; route?: ChatMessage['route'] };

/** Completed question/answer pairs, oldest first; pending and errored turns are left out. */
function completedTurns(list: ChatMessage[]): Turn[] {
  const out: Turn[] = [];
  for (let i = 1; i < list.length; i++) {
    const m = list[i];
    const prev = list[i - 1];
    if (m.role === 'assistant' && m.status === 'done' && prev.role === 'user') {
      out.push({ question: prev.text, answer: m.text, route: m.route });
    }
  }

  return out;
}

const turnText = (t: Turn | undefined): string | undefined => (t ? `${t.question} ${t.answer}` : undefined);

type Pending = { userId: string; assistantId: string; question: string; previous?: ChatMessage };
type Saved = { messages: ChatMessage[]; conversationTs: string | null };

/** The chat minus a question still being answered: a send drops its pair, a retry keeps the answer it replaced. */
function settled(list: ChatMessage[], pending: Pending | null): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of list) {
    if (m.status !== 'pending') out.push(m);
    else if (pending?.previous && m.id === pending.assistantId) out.push(pending.previous);
    else if (out[out.length - 1]?.role === 'user') out.pop();
  }

  return out;
}

// Session storage can be missing or throw (private mode, blocked site data); the chat then just isn't kept.
function load(key: string | undefined): Saved | null {
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(key);
    const saved = raw ? (JSON.parse(raw) as Partial<Saved>) : null;
    if (!saved || !Array.isArray(saved.messages)) return null;

    return {
      messages: saved.messages,
      conversationTs: typeof saved.conversationTs === 'string' ? saved.conversationTs : null,
    };
  } catch {
    return null;
  }
}

function save(key: string, saved: Saved): void {
  try {
    if (saved.messages.length === 0) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(saved));
  } catch {
    // Not kept; the chat itself still works.
  }
}

export interface UseConciergeChatOptions {
  client: ConciergeClient;
  knowledge: KnowledgePack;
  isAdmin: boolean;
  getPageContext?: () => PageContext | null;
  getElementId?: () => number | null;
  includePageData: boolean;
  /** Concierge sources the app allows; defaults to MI's internal ones (DEFAULT_SOURCES). */
  sources?: readonly string[];
  /** MI's LLM proxy; asked first when set. Undefined or null: every question goes to Concierge (v1). */
  proxy?: LlmProxyClient | null;
  /** Page name for the proxy prompt; defaults to the page context's pageName, else 'this page'. */
  pageName?: string;
  /** Session storage key that keeps the chat across reloads in this tab; read once at mount. Unset: not kept. */
  storageKey?: string;
}

export function useConciergeChat(opts: UseConciergeChatOptions) {
  const [restored] = useState(() => load(opts.storageKey));
  const [messages, dispatch] = useReducer(reducer, restored?.messages ?? []);
  const [isBusy, setIsBusy] = useState(false);
  const [feedbackAvailable, setFeedbackAvailable] = useState(true);
  const [canUndo, setCanUndo] = useState(false);

  const optsRef = useRef(opts);
  optsRef.current = opts;
  const messagesRef = useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;
  const busyRef = useRef(false);
  const conversationTsRef = useRef<string | null>(restored?.conversationTs ?? null);
  const toolsRef = useRef<string[] | null>(null);
  // One controller per in-flight question; newChat/unmount abort it and its result is dropped.
  const inFlightRef = useRef<AbortController | null>(null);
  // The question being answered, so stop() can undo it: a send removes its pair and hands the text back,
  // a retry puts back the answer it replaced (`previous`).
  const pendingRef = useRef<Pending | null>(null);
  // What newChat cleared, until undone, dismissed or a new question is sent.
  const undoRef = useRef<Saved | null>(null);
  // Set once the proxy reports it is unavailable for this page load.
  const proxyUnavailableRef = useRef(false);

  useEffect(() => () => inFlightRef.current?.abort(), []);

  useEffect(() => {
    const key = optsRef.current.storageKey;
    if (key) save(key, { messages: settled(messages, pendingRef.current), conversationTs: conversationTsRef.current });
  }, [messages]);

  // The Concierge request. Without a proxy (or when it is unavailable) it carries the v1 guide and page
  // context; a forwarded question needs report data the page lacks, so it goes bare.
  // `previous` is the last completed turn. When the page answered it, Concierge never saw it, so it is
  // restated ahead of the question (unless `question` is already the proxy's stand-alone rewrite).
  // Resolves null when `signal` aborted meanwhile.
  const askConcierge = useCallback(
    async (
      question: string,
      signal: AbortSignal,
      forwarded: boolean,
      previous: Turn | undefined,
      rewritten = false,
    ): Promise<{ text: string; sources: Source[] } | null> => {
      const { client, knowledge, isAdmin, getPageContext, getElementId, includePageData } = optsRef.current;
      const { sources: allowedSources } = optsRef.current;
      if (toolsRef.current === null) toolsRef.current = pickSources(await client.getTools(), allowedSources);
      if (signal.aborted) return null;
      // An empty list would make the server fall back to every source, external ones included.
      if (toolsRef.current.length === 0) throw new ConciergeError('no_sources');
      if (conversationTsRef.current === null) conversationTsRef.current = newConversationTs();

      const elementId = getElementId?.() ?? null;
      const messageUid = newMessageUid();
      const sources: Source[] = [];
      const earlier = previous?.route === 'page' && !rewritten ? `${earlierTurnLine(previous)}   ` : '';
      let q = `${earlier}${question}`;
      let context: string | undefined;

      if (!forwarded) {
        const pageContext = includePageData ? (getPageContext?.() ?? null) : null;
        const picked = pickSections(knowledge.sections, question, { isAdmin, previous: turnText(previous) });
        const built = buildContext({ snapshot: pageContext, sections: picked, elementId });
        context = built.context;
        const usedSections: KnowledgeSection[] = [...built.usedSections];
        let pageContextSent = pageContext !== null;
        const prefix = buildQuestionPrefix({ sections: picked, snapshot: pageContext });
        if (prefix.text) q = `${prefix.text}   ${earlier}${question}`;
        for (const s of prefix.usedSections) if (!usedSections.some((u) => u.id === s.id)) usedSections.push(s);
        if (pageContext && prefix.text.includes(PAGE_CONTEXT_HEADER)) pageContextSent = true;

        const guide = usedSections.filter((s) => !s.isSummary);
        if (pageContextSent) sources.push({ label: 'On this page', detail: pageContext!.pageName });
        for (const s of guide) sources.push({ label: 'App guide', detail: `§ ${s.heading}` });
      }

      const result = await client.ask({
        q,
        conversationTs: conversationTsRef.current,
        messageUid,
        ...(context !== undefined ? { context } : {}),
        elementId,
        tools: toolsRef.current,
        signal,
      });
      if (signal.aborted) return null;
      for (const r of result.relatedReports) sources.push({ label: 'Report', detail: r.name });
      for (const f of result.found ?? []) sources.push({ label: foundLabel(f.type), detail: f.name });

      return { text: result.answer || EMPTY_ANSWER, sources };
    },
    [],
  );

  const run = useCallback(
    async (
      question: string,
      userId: string,
      assistantId: string,
      history: Turn[],
      previous?: ChatMessage,
    ) => {
      const { proxy, knowledge, isAdmin, getPageContext, includePageData, pageName } = optsRef.current;
      const ctrl = new AbortController();
      inFlightRef.current = ctrl;
      pendingRef.current = { userId, assistantId, question, previous };
      busyRef.current = true;
      setIsBusy(true);
      const started = Date.now();
      let forwarded = false;
      let forwardQuestion: string | undefined;
      const lastTurn = history[history.length - 1];
      try {
        if (proxy && !proxyUnavailableRef.current) {
          const pageContext = includePageData ? (getPageContext?.() ?? null) : null;
          const built = buildProxyMessages({
            question,
            sections: pickSections(knowledge.sections, question, {
              isAdmin,
              maxSections: PROXY_MAX_SECTIONS,
              previous: turnText(lastTurn),
            }),
            snapshot: pageContext,
            pageName: pageName ?? pageContext?.pageName ?? 'this page',
            history,
          });
          const res = await proxy.ask({ messages: built.messages, signal: ctrl.signal });
          if (ctrl.signal.aborted) return;
          // A blank reply counts as unavailable for this question only (non-sticky): Concierge answers it.
          if (res.kind === 'answer' && res.text.trim() !== '') {
            const sources = built.sources.map(({ label, detail }) => ({ label, detail }));
            dispatch({
              type: 'patch',
              id: assistantId,
              patch: {
                status: 'done',
                text: res.text,
                errorKind: undefined,
                route: 'page',
                sources,
                citations: sources.length,
                elapsedMs: Date.now() - started,
              },
            });

            return;
          }
          if (res.kind === 'unavailable' && res.sticky) proxyUnavailableRef.current = true;
          if (res.kind === 'forward') {
            forwarded = true;
            forwardQuestion = res.question;
            dispatch({ type: 'patch', id: assistantId, patch: { route: 'concierge', forwarded: true } });
          }
        }

        const answer = await askConcierge(
          forwardQuestion ?? question,
          ctrl.signal,
          forwarded,
          lastTurn,
          forwardQuestion !== undefined,
        );
        if (answer === null || ctrl.signal.aborted) return;
        dispatch({
          type: 'patch',
          id: assistantId,
          patch: {
            status: 'done',
            text: answer.text,
            errorKind: undefined,
            route: 'concierge',
            forwarded: false,
            sources: answer.sources,
            elapsedMs: Date.now() - started,
          },
        });
      } catch (e) {
        if (ctrl.signal.aborted) return;
        const errorKind = e instanceof ConciergeError ? e.kind : 'server';
        dispatch({ type: 'patch', id: assistantId, patch: { status: 'error', text: '', errorKind, forwarded: false } });
      } finally {
        if (inFlightRef.current === ctrl) {
          inFlightRef.current = null;
          pendingRef.current = null;
          busyRef.current = false;
          setIsBusy(false);
        }
      }
    },
    [askConcierge],
  );

  const send = useCallback(
    async (q: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      undoRef.current = null;
      setCanUndo(false);
      const history = completedTurns(messagesRef.current);
      const userId = newMessageUid();
      const assistantId = newMessageUid();
      dispatch({
        type: 'add',
        messages: [
          { id: userId, role: 'user', text: q, status: 'done' },
          { id: assistantId, role: 'assistant', text: '', status: 'pending' },
        ],
      });
      await run(q, userId, assistantId, history);
    },
    [run],
  );

  const retry = useCallback(
    async (id: string) => {
      if (busyRef.current) return;
      const list = messagesRef.current;
      const idx = list.findIndex((m) => m.id === id && m.role === 'assistant');
      const question = idx > 0 && list[idx - 1].role === 'user' ? list[idx - 1].text : null;
      if (question === null) return;
      busyRef.current = true;
      dispatch({
        type: 'patch',
        id,
        patch: {
          status: 'pending',
          text: '',
          errorKind: undefined,
          route: undefined,
          forwarded: undefined,
          sources: undefined,
          citations: undefined,
          elapsedMs: undefined,
        },
      });
      await run(question, list[idx - 1].id, id, completedTurns(list.slice(0, idx - 1)), list[idx]);
    },
    [run],
  );

  const stop = useCallback((): string | null => {
    const pending = pendingRef.current;
    if (!pending) return null;
    inFlightRef.current?.abort();
    inFlightRef.current = null;
    pendingRef.current = null;
    busyRef.current = false;
    setIsBusy(false);
    if (pending.previous) {
      dispatch({ type: 'patch', id: pending.assistantId, patch: pending.previous });

      return null;
    }
    dispatch({ type: 'remove', ids: [pending.userId, pending.assistantId] });

    return pending.question;
  }, []);

  const newChat = useCallback(() => {
    const kept = settled(messagesRef.current, pendingRef.current);
    undoRef.current = kept.length > 0 ? { messages: kept, conversationTs: conversationTsRef.current } : null;
    setCanUndo(kept.length > 0);
    inFlightRef.current?.abort();
    inFlightRef.current = null;
    pendingRef.current = null;
    busyRef.current = false;
    setIsBusy(false);
    dispatch({ type: 'reset' });
    conversationTsRef.current = null;
  }, []);

  const undoNewChat = useCallback(() => {
    const saved = undoRef.current;
    if (!saved || busyRef.current) return;
    undoRef.current = null;
    setCanUndo(false);
    conversationTsRef.current = saved.conversationTs;
    dispatch({ type: 'set', messages: saved.messages });
  }, []);

  const dismissUndo = useCallback(() => {
    undoRef.current = null;
    setCanUndo(false);
  }, []);

  const like = useCallback((id: string, v: 'like' | 'dislike') => {
    const list = messagesRef.current;
    const idx = list.findIndex((m) => m.id === id && m.role === 'assistant');
    const conversationTs = conversationTsRef.current;
    if (idx < 1 || !conversationTs) return;
    const question = list[idx - 1].text;
    const answer = list[idx].text;
    try {
      optsRef.current.client
        .feedback({ conversationTs, question, answer, feedback: v })
        .catch(() => setFeedbackAvailable(false));
    } catch {
      setFeedbackAvailable(false);
    }
  }, []);

  return { messages, isBusy, send, retry, stop, newChat, undoNewChat, dismissUndo, canUndo, like, feedbackAvailable };
}

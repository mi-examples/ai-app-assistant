import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useConciergeChat } from '../chat/use-concierge-chat';
import type { ConciergeClient } from '../client/concierge-client';
import type { LlmProxyClient } from '../client/llm-proxy';
import type { KnowledgePack } from '../context/knowledge';
import type { PageContext } from '../context/page-context';
import { resolveLabels } from '../types';
import type { AssistantLabels } from '../types';
import { Composer } from './composer';
import { ChevronDownIcon, PlusIcon } from './icons';
import { Message, NO_SOURCES_COPY } from './message';
import { Orb } from './orb';
import { answerScrollTop, SCROLL_GAP } from './scroll';

export interface PanelProps {
  open: boolean;
  onClose: () => void;
  client: ConciergeClient;
  knowledge: KnowledgePack;
  isAdmin: boolean;
  userFirstName?: string;
  getPageContext?: () => PageContext | null;
  getElementId?: () => number | null;
  labels?: Partial<AssistantLabels>;
  /** Overrides knowledge.suggested in the empty state. */
  suggested?: string[];
  /** Chips after an answer; `asked` is the user's questions so far, oldest first. None when unset. */
  getFollowUps?: (ctx: PageContext | null, asked: string[]) => string[];
  proxy?: LlmProxyClient | null;
  pageName?: string;
  sources?: readonly string[];
  /** Keeps the chat across reloads in this tab (session storage). Unset: not kept. */
  storageKey?: string;
  accessDenied?: boolean;
  bounceKey?: number;
}

const HAPPY_MS = 1300;
const UNDO_MS = 6000;
/** Matches the .aic-undo--leaving animation. */
const UNDO_EXIT_MS = 180;

export function Panel(props: PanelProps) {
  const { open, onClose, client, knowledge, userFirstName, accessDenied, bounceKey } = props;
  const [includePageData, setIncludePageData] = useState(true);
  const [happy, setHappy] = useState(false);
  const [restore, setRestore] = useState<{ text: string; key: number }>();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasBusy = useRef(false);

  const chat = useConciergeChat({
    client,
    knowledge,
    isAdmin: props.isAdmin,
    getPageContext: props.getPageContext,
    getElementId: props.getElementId,
    includePageData,
    proxy: props.proxy,
    pageName: props.pageName,
    sources: props.sources,
    storageKey: props.storageKey,
  });
  const { messages, isBusy } = chat;
  const last = messages[messages.length - 1];

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // The answer being waited for, and where the list stood when the wait began: if the user scrolls away
  // meanwhile, the arriving answer leaves them there.
  const watchRef = useRef<{ id: string; top: number } | null>(null);
  const pendingIdsRef = useRef<Set<string>>(new Set());
  const hadMessagesRef = useRef(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const topOf = (id: string): number | null => {
      const row = el.querySelector(`[data-msg="${id}"]`);

      return row ? row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop : null;
    };
    const reveal = (assistantId: string) => {
      const idx = messages.findIndex((m) => m.id === assistantId);
      const row = el.querySelector(`[data-msg="${assistantId}"]`);
      const questionTop = idx > 0 ? topOf(messages[idx - 1].id) : null;
      if (!row || questionTop === null) return;
      const answerBottom = row.getBoundingClientRect().bottom - el.getBoundingClientRect().top + el.scrollTop;
      el.scrollTop = answerScrollTop({
        viewHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        questionTop,
        answerBottom,
      });
    };

    const pendingIds = new Set(messages.filter((m) => m.status === 'pending').map((m) => m.id));
    const started = messages.find((m) => m.status === 'pending' && !pendingIdsRef.current.has(m.id));
    const hadMessages = hadMessagesRef.current;
    pendingIdsRef.current = pendingIds;
    hadMessagesRef.current = messages.length > 0;
    const watch = watchRef.current;

    if (started) {
      // A send waits at the bottom; a retry further up waits with its question at the top.
      const idx = messages.indexOf(started);
      const questionTop = idx > 0 ? topOf(messages[idx - 1].id) : null;
      el.scrollTop =
        idx === messages.length - 1 || questionTop === null ? el.scrollHeight : Math.max(0, questionTop - SCROLL_GAP);
      watchRef.current = { id: started.id, top: el.scrollTop };

      return;
    }
    if (watch && !pendingIds.has(watch.id)) {
      watchRef.current = null;
      const moved = Math.abs(el.scrollTop - watch.top) > 4;
      if (!moved && messages.some((m) => m.id === watch.id)) reveal(watch.id);

      return;
    }
    // A chat restored at mount or by Undo opens on its last answer.
    if (!hadMessages && messages.length > 0 && pendingIds.size === 0) {
      const last = [...messages].reverse().find((m) => m.role === 'assistant');
      if (last) reveal(last.id);
    }
  }, [messages]);

  const { canUndo, dismissUndo } = chat;
  useEffect(() => {
    if (!canUndo) return;
    const t = setTimeout(dismissUndo, UNDO_MS);

    return () => clearTimeout(t);
  }, [canUndo, dismissUndo]);

  // The bar stays mounted for its exit animation after the undo is gone.
  const [undoBar, setUndoBar] = useState<'hidden' | 'shown' | 'leaving'>('hidden');
  useEffect(() => {
    if (canUndo) {
      setUndoBar('shown');

      return;
    }
    setUndoBar((b) => (b === 'hidden' ? b : 'leaving'));
    const t = setTimeout(() => setUndoBar('hidden'), UNDO_EXIT_MS);

    return () => clearTimeout(t);
  }, [canUndo]);

  useEffect(() => {
    if (isBusy) setHappy(false);
    if (wasBusy.current && !isBusy && last?.status === 'done') {
      setHappy(true);
      const t = setTimeout(() => setHappy(false), HAPPY_MS);
      wasBusy.current = isBusy;

      return () => clearTimeout(t);
    }
    wasBusy.current = isBusy;
  }, [isBusy, last?.status]);

  const chips = useMemo(
    () => {
      if (isBusy || last?.role !== 'assistant' || last.status !== 'done') return [];
      // A chip that repeats a question already asked in this chat would only ask it again.
      const norm = (t: string) => t.trim().toLowerCase();
      const askedTexts = messages.filter((m) => m.role === 'user').map((m) => m.text);
      const asked = new Set(askedTexts.map(norm));

      return (props.getFollowUps?.(props.getPageContext?.() ?? null, askedTexts) ?? []).filter(
        (c) => !asked.has(norm(c)),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isBusy, last?.id, last?.status],
  );

  const stop = () => {
    const question = chat.stop();
    if (question !== null) setRestore((r) => ({ text: question, key: (r?.key ?? 0) + 1 }));
  };
  const labels = resolveLabels(props.labels);
  const greeting = `Hi${userFirstName ? ` ${userFirstName}` : ''} 👋`;

  return (
    <section
      className={`aic-panel${open ? ' aic-panel--open' : ''}`}
      role="dialog"
      aria-label={labels.title}
      aria-hidden={!open}
    >
      <header className="aic-hdr">
        <Orb
          size={34}
          mood={isBusy ? 'thinking' : happy ? 'happy' : 'idle'}
          bounceKey={bounceKey}
          lookAtCursor={open}
          paused={!open}
        />
        <div>
          <div className="aic-hdr__t">{labels.title}</div>
          <div className="aic-hdr__s">{labels.subtitle}</div>
        </div>
        <div className="aic-hdr__acts">
          <button
            type="button"
            className="aic-ic"
            aria-label="New chat"
            title="New chat"
            disabled={messages.length === 0}
            onClick={chat.newChat}
          >
            <PlusIcon />
          </button>
          <button type="button" className="aic-ic" aria-label="Minimize" onClick={onClose}>
            <ChevronDownIcon />
          </button>
        </div>
      </header>
      <div className="aic-msgs" ref={scrollRef} aria-live="polite">
        {accessDenied ? (
          <div className="aic-row">
            <div className="aic-a">
              <p>{NO_SOURCES_COPY}</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="aic-welcome">
            <p className="aic-welcome__t">{greeting}</p>
            <p>{labels.welcome}</p>
            <div className="aic-sugg">
              {(props.suggested ?? knowledge.suggested).slice(0, 3).map((s) => (
                <button key={s} type="button" onClick={() => void chat.send(s)}>
                  <span className="aic-sugg__mark" aria-hidden="true">
                    ↗
                  </span>
                  <span>{s}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <Message
              key={m.id}
              message={m}
              feedbackAvailable={chat.feedbackAvailable}
              onRetry={(id) => void chat.retry(id)}
              onLike={chat.like}
            />
          ))
        )}
        {chips.length > 0 && (
          <div className="aic-chips">
            {chips.map((c) => (
              <button key={c} type="button" className="aic-chip" onClick={() => void chat.send(c)}>
                {c}
              </button>
            ))}
          </div>
        )}
      </div>
      {undoBar !== 'hidden' && (
        <div className={`aic-undo${undoBar === 'leaving' ? ' aic-undo--leaving' : ''}`} role="status">
          <span>Chat cleared</span>
          <button type="button" className="aic-undo__btn" disabled={undoBar === 'leaving'} onClick={chat.undoNewChat}>
            Undo
          </button>
        </div>
      )}
      <Composer
        disabled={!!accessDenied}
        busy={isBusy}
        hasPageData={!!props.getPageContext}
        includePageData={includePageData}
        onTogglePageData={setIncludePageData}
        onSend={(q) => void chat.send(q)}
        onStop={stop}
        restore={restore}
        inputRef={inputRef}
        placeholder={labels.placeholder}
        disclaimer={labels.disclaimer}
      />
    </section>
  );
}

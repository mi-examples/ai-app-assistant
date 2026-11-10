import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { ConciergeError, createConciergeClient } from './client/concierge-client';
import type { ConciergeClient } from './client/concierge-client';
import { createLlmProxyClient } from './client/llm-proxy';
import type { LlmProxyClient } from './client/llm-proxy';
import { pickSources } from './client/sources';
import type { KnowledgePack } from './context/knowledge';
import type { PageContext } from './context/page-context';
import { ErrorGuard } from './error-guard';
import type { AssistantLabels } from './types';
import { Launcher } from './ui/launcher';
import { Panel } from './ui/panel';
import css from './ui/styles.scss?inline';

export interface AssistantAppProps {
  knowledge: KnowledgePack;
  isAdmin: boolean;
  userFirstName?: string;
  getPageContext?: () => PageContext | null;
  getElementId?: () => number | null;
  /** Replaces any of the default wording. */
  labels?: Partial<AssistantLabels>;
  /** Accent colour (any CSS colour); default blue. */
  accentColor?: string;
  /** Questions offered in the empty state (first 3); defaults to knowledge.suggested. */
  suggested?: string[];
  /** Chips after an answer; `asked` is the user's questions so far, oldest first. None when unset. */
  getFollowUps?: (ctx: PageContext | null, asked: string[]) => string[];
  /** Page name for the proxy prompt. */
  pageName: string;
  /** MI's LLM proxy for page questions. Defaults to one per mounted assistant; null turns routing off. */
  proxy?: LlmProxyClient | null;
  client?: ConciergeClient;
  /** Concierge sources the app allows; defaults to MI's internal ones. Add external connectors by name. */
  sources?: readonly string[];
  /** Signed-in user's name; keeps the chat in this tab under `ai-app-assistant:<pageName>:<userName>`. */
  userName?: string;
  /** Session storage key that keeps the chat across reloads in this tab; wins over `userName`. Unset: not kept. */
  storageKey?: string;
}

type Probe = 'pending' | 'ok' | 'denied' | 'unavailable';

function focusIsInside(el: HTMLElement | null): boolean {
  const active = (el?.getRootNode() as Document | ShadowRoot | undefined)?.activeElement ?? null;

  return !!el && !!active && el.contains(active);
}

function ConciergeApp(props: AssistantAppProps & { client: ConciergeClient; proxy: LlmProxyClient | null }) {
  const { client } = props;
  const [probe, setProbe] = useState<Probe>('pending');
  const [open, setOpen] = useState(false);
  const [bounceKey, setBounceKey] = useState(0);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const rootElRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  openRef.current = open;
  const wasOpen = useRef(false);
  // Read once per probe; a new array each render must not re-run it.
  const sourcesRef = useRef(props.sources);
  sourcesRef.current = props.sources;

  useEffect(() => {
    let cancelled = false;
    client
      .getTools()
      .then((tools) => !cancelled && setProbe(pickSources(tools, sourcesRef.current).length > 0 ? 'ok' : 'denied'))
      .catch((e: unknown) => {
        if (cancelled) return;
        setProbe(e instanceof ConciergeError && e.kind === 'no_sources' ? 'denied' : 'unavailable');
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  const toggle = useCallback(() => setOpen((o) => !o), []);
  const close = useCallback(() => setOpen(false), []);

  const active = probe === 'ok' || probe === 'denied';

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'Escape' && openRef.current) {
        // Only an Escape from inside the assistant; app overlays handle their own.
        const el = rootElRef.current;
        if (el && e.composedPath().includes(el)) setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, active]);

  useEffect(() => {
    if (open) setBounceKey((k) => k + 1);
    else if (wasOpen.current && focusIsInside(rootElRef.current)) launcherRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  if (probe === 'pending' || probe === 'unavailable') return null;

  return (
    <div
      className="aic-root"
      ref={rootElRef}
      style={props.accentColor ? ({ '--aic-accent': props.accentColor } as CSSProperties) : undefined}
    >
      <Launcher ref={launcherRef} open={open} onClick={toggle} labels={props.labels} />
      <Panel
        {...props}
        open={open}
        onClose={close}
        accessDenied={probe === 'denied' && props.proxy === null}
        bounceKey={bounceKey}
      />
    </div>
  );
}

/** The loaded assistant: mounts its own shadow root on document.body. `AiAppAssistant` loads and guards it. */
export function AssistantApp(props: AssistantAppProps): null {
  const rootRef = useRef<Root | null>(null);
  const defaultClient = useMemo(() => createConciergeClient(), []);
  const client = props.client ?? defaultClient;
  // Created once per mounted assistant, and only when the default is wanted.
  const wantsDefaultProxy = props.proxy === undefined;
  const defaultProxy = useMemo(() => (wantsDefaultProxy ? createLlmProxyClient() : null), [wantsDefaultProxy]);
  const proxy = wantsDefaultProxy ? defaultProxy : (props.proxy ?? null);
  const storageKey =
    props.storageKey ?? (props.userName ? `ai-app-assistant:${props.pageName}:${props.userName}` : undefined);

  useEffect(() => {
    const host = document.createElement('div');
    host.setAttribute('data-aic-host', '');
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    const mount = document.createElement('div');
    shadow.append(style, mount);
    document.body.appendChild(host);
    const root = createRoot(mount);
    rootRef.current = root;
    // Re-render below (separate effect) pushes the first props in.

    return () => {
      rootRef.current = null;
      // Unmounting a root synchronously inside another root's commit warns; defer it.
      queueMicrotask(() => root.unmount());
      host.remove();
    };
  }, []);

  useEffect(() => {
    rootRef.current?.render(
      <ErrorGuard>
        <ConciergeApp {...props} storageKey={storageKey} client={client} proxy={proxy} />
      </ErrorGuard>,
    );
  });

  return null;
}

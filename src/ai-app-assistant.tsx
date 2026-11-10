import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import type { AssistantAppProps } from './assistant-app';
import { ErrorGuard } from './error-guard';
import { isConciergeAllowed } from './platform-access';
import type { AssistantSetup } from './types';

/** What a page's `load` resolves to: its assistant folder's index module. */
export interface AssistantModule {
  assistantSetup: AssistantSetup;
}

export interface AiAppAssistantProps extends Omit<AssistantAppProps, keyof AssistantSetup> {
  /** Loads the page's setup in its own chunk, e.g. `() => import('./index')`. Called once, when allowed. */
  load: () => Promise<AssistantModule>;
  /** The page's own on/off switch; default on. Off, nothing is downloaded. */
  enabled?: boolean;
}

type Loaded = { App: ComponentType<AssistantAppProps>; setup: AssistantSetup };

/**
 * The assistant for one page. Renders nothing while it is off (the page's `enabled`, or MI's Concierge switch
 * for this user); otherwise loads the chat and the page's setup in a separate chunk. Never takes the page
 * down: a failed load or any error inside it just removes it.
 */
export function AiAppAssistant({ load, enabled = true, ...props }: AiAppAssistantProps): JSX.Element | null {
  const allowed = enabled && isConciergeAllowed(props.isAdmin);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!allowed || loaded) return;
    let cancelled = false;
    Promise.all([import('./assistant-app'), loadRef.current()]).then(
      ([app, page]) => {
        if (!cancelled) setLoaded({ App: app.AssistantApp, setup: page.assistantSetup });
      },
      (error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('[ai-app-assistant] failed to load', error);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [allowed, loaded]);

  if (!allowed || !loaded) return null;
  const { App, setup } = loaded;

  return (
    <ErrorGuard>
      <App {...setup} {...props} />
    </ErrorGuard>
  );
}

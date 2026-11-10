import type { AssistantAppProps } from './assistant-app';

/** The words the assistant shows. A page overrides any of them with `labels`. */
export interface AssistantLabels {
  title: string;
  subtitle: string;
  launcher: string;
  placeholder: string;
  welcome: string;
  disclaimer: string;
}

export const DEFAULT_LABELS: AssistantLabels = {
  title: 'Page Assistant',
  subtitle: 'Powered by MI Concierge',
  launcher: 'Ask about this page',
  placeholder: 'Ask about this page…',
  welcome: 'Ask about the numbers on this page, or how it works.',
  disclaimer: 'AI answers can be wrong. Check important numbers.',
};

export function resolveLabels(labels?: Partial<AssistantLabels>): AssistantLabels {
  const defined = Object.entries(labels ?? {}).filter(([, v]) => v !== undefined);

  return { ...DEFAULT_LABELS, ...Object.fromEntries(defined) };
}

/** What a page supplies about itself, apart from who is using it. Its `load` resolves to `{ assistantSetup }`. */
export type AssistantSetup = Pick<
  AssistantAppProps,
  'knowledge' | 'getPageContext' | 'getElementId' | 'getFollowUps' | 'suggested'
>;

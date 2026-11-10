# AI App Assistant

[![CI](https://github.com/mi-examples/ai-app-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/mi-examples/ai-app-assistant/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A chat assistant for Metric Insights portal pages. It answers questions about your page: how it works (from guide
files you provide) and what it shows right now (from page values you provide). Anything it cannot answer goes to
MI Concierge.

> [!IMPORTANT]
> The assistant only works on a Metric Insights instance where both of these are set up:
>
> 1. **MI Concierge is enabled** and shown to the user. Without it the assistant does not appear at all.
> 2. **The LLM endpoint (MI LLM proxy) is turned on** with `ALLOW_LLM_ACCESS_VIA_API=Y`. Without it the assistant
>    cannot answer from your guide files or page values; every question goes to Concierge as is.
>
> See [Platform requirements](#platform-requirements) before you install.

**How questions are routed:** every question goes to the MI LLM proxy first, together with the matching guide
sections and the current page context. Anything the guide or the page cannot answer is forwarded to MI Concierge.
If the proxy is off or fails, the question falls back to Concierge.

The package needs React, the MI platform, and a Vite build (it uses `?inline` styles, and the generated code uses
`import.meta.glob`) with `sass` installed. Everything page-specific comes in through props and guide
files.

## Requirements

- React 18 (`react` and `react-dom` are peer dependencies).
- A Vite build with `sass` installed, for example [pp-dev](https://github.com/mi-examples/pp-dev).
- Node.js 22.12 or newer for the build and the `add-skill` command.
- A Metric Insights instance with Concierge enabled and the LLM endpoint turned on (see
  [Platform requirements](#platform-requirements)).

## Install

The package is not on npm yet. Once published:

```sh
npm install @metricinsights/ai-app-assistant
```

Until then, install it from a local checkout (npm links the folder):

```sh
npm install ../ai-app-assistant
```

Import only from the package root (`@metricinsights/ai-app-assistant`), never from internals. A linked
folder has its own `node_modules`, so tell Vite (and Vitest) to use the page's React:
`resolve: { dedupe: ['react', 'react-dom'] }`.

## Quick start

1. Install the skill and run it (see [The skill](#the-skill)). It generates a `src/ai-assistant/` folder with your
   guide docs and an `assistantSetup` export.
2. Mount the assistant once, near the root of your page:

```tsx
import { AiAppAssistant } from '@metricinsights/ai-app-assistant';

export function Assistant() {
  return (
    <AiAppAssistant
      load={() => import('./ai-assistant')}
      enabled={PP_VARIABLES.AI_CONCIERGE_ENABLED === 'Y'}
      pageName="Sales Pipeline"
      userName={user.username}
      userFirstName={user.first_name}
      isAdmin={user.is_administrator === 'Y'}
      accentColor="#0f9d58"
      labels={{ welcome: 'Ask about the deals on this page, or how it works.' }}
    />
  );
}
```

3. Optional, for answers about live values: add the `useEffect` the skill prints (see
   [Page context](#page-context)). Without it the assistant still answers from the guide and Concierge.

The component looks after itself:

- `load` is called inside the component, so the chat UI and your guide files (everything `./ai-assistant` imports)
  land in their own chunk, outside the page's main bundle. Pass the dynamic `import()` itself, not a module you
  imported statically.
- Nothing is downloaded while `enabled` is false, or while MI's Concierge switch is off for the user
  (`window.globalSettings.userAuth`; admins see it whenever Concierge is enabled).
- A failed load, or any error inside the assistant, removes it instead of breaking the page.

### What changes in your page

The skill writes only inside the assistant folder. Everything in your own code is a change you make by hand, from
what the skill prints at the end of its run:

1. **The mount**: one component of your own, rendered once near the root (above). Keep it outside the assistant
   folder, for example `src/components/assistant/assistant.tsx`, so the folder holds only generated files.
2. **The page-context hookup**: one `useEffect` where the page's data is loaded (see [Page context](#page-context)).
3. **Suggested refactors**, only if any. The snapshot has to show values the way your page shows them, so it reuses
   your display rules (when a target is shown, how a value is labelled). When such a rule is written inline in a
   component, the skill does not copy it: it leaves that detail out and prints a small refactor instead (the file
   and line, a helper to extract, a diff). The page looks the same afterwards; rerun the skill and the detail is
   added. If nothing needs extracting it prints `Suggested refactors: none`.

## Props

| Prop            | Type                             | Default                                                         | Notes                                                                                                                         |
| --------------- | -------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `load`          | `() => Promise<AssistantModule>` | required                                                        | Usually `() => import('./ai-assistant')`; resolves to `{ assistantSetup }`. Called once.                                      |
| `enabled`       | `boolean`                        | `true`                                                          | The page's own on/off switch. When false nothing is loaded.                                                                   |
| `isAdmin`       | `boolean`                        | required                                                        | Includes admin-audience guide sections.                                                                                       |
| `pageName`      | `string`                         | required                                                        | Used in the proxy prompt and the "On this page" source label.                                                                 |
| `userName`      | `string`                         | none                                                            | Login name; builds the default `storageKey`.                                                                                  |
| `userFirstName` | `string`                         | none                                                            | Welcome greeting.                                                                                                             |
| `labels`        | `Partial<AssistantLabels>`       | see below                                                       | Wording.                                                                                                                      |
| `accentColor`   | `string`                         | `#3f7fe8`                                                       | Any CSS colour.                                                                                                               |
| `storageKey`    | `string`                         | `ai-app-assistant:<pageName>:<userName>` when `userName` is set | Session storage key that keeps the chat across reloads in the tab. Without `storageKey` and `userName`, the chat is not kept. |
| `proxy`         | `LlmProxyClient \| null`         | one per mounted assistant                                       | `null` turns proxy routing off (everything goes to Concierge). `createLlmProxyClient` is exported.                            |
| `client`        | `ConciergeClient`                | default client                                                  | Override the Concierge client (mainly for tests).                                                                             |
| `sources`       | `readonly string[]`              | `DEFAULT_SOURCES` (MI internal sources)                         | Concierge sources the app allows; add external connectors by name.                                                            |

`assistantSetup` (`AssistantSetup`, the generated export that `load` resolves to) carries what the page knows about
itself:

| Field            | Type                                                      | Default                         | Notes                                                                |
| ---------------- | --------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------- |
| `knowledge`      | `KnowledgePack`                                           | required                        | From `parseKnowledge(files)`.                                        |
| `getPageContext` | `() => PageContext \| null`                               | none (guide and Concierge only) | Current page values.                                                 |
| `getElementId`   | `() => number \| null`                                    | none                            | Element the user is looking at; sent to Concierge as `element_id`.   |
| `getFollowUps`   | `(ctx: PageContext \| null, asked: string[]) => string[]` | none (no chips)                 | Chips after an answer; chips equal to an asked question are dropped. |
| `suggested`      | `string[]`                                                | `knowledge.suggested`           | Welcome quick questions (first 3 shown).                             |

`AssistantLabels` defaults (`DEFAULT_LABELS`): `title` "Page Assistant", `subtitle` "Powered by MI Concierge",
`launcher` "Ask about this page", `placeholder` "Ask about this page…", `welcome` "Ask about the numbers on this
page, or how it works.", `disclaimer` "AI answers can be wrong. Check important numbers."

Other exports: `parseKnowledge`, `createPageContextStore`, `createLlmProxyClient`, `formatPageContext`,
`PAGE_CONTEXT_HEADER`, `pickSections`, `DEFAULT_SOURCES`, `DEFAULT_LABELS`, and the types `AiAppAssistantProps`,
`AssistantModule`, `KnowledgePack`, `PageContext`, `PageContextItem`, `AssistantLabels`, `AssistantSetup`, `LlmProxyClient`,
`ConciergeClient`.

## Guide files

Markdown files, one topic each, loaded by your code and passed through `parseKnowledge`. The generated
`knowledge.ts` does this with Vite:

```ts
import { parseKnowledge } from '@metricinsights/ai-app-assistant';

const files = import.meta.glob('./docs/*.md', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

export const knowledge = parseKnowledge(
  Object.entries(files).map(([path, raw]) => ({ name: path.split('/').pop() ?? path, raw })),
);
```

Format:

- Each `## Heading` starts a section; sections are picked per question and cited by file and heading.
- Optional front matter at the top of a file:

  ```md
  ---
  summary: true
  audience: all
  suggested:
    - What does this page show?
    - How is the pipeline value calculated?
  ---
  ```

  - `audience: all | admin` (default `all`) sets the audience of the whole file.
  - `suggested:` lists welcome quick questions (merged across files, duplicates dropped).
  - `summary: true` marks the summary file, which is always sent first. If no file has it, `user-guide.md` is used.

- `<!-- audience: admin -->` as the first line under a heading makes that one section admin-only (or `all` inside
  an admin file).
- Every other HTML comment (`<!-- needs review -->`, the skill's generated markers) is an author note. It is
  stripped before the text reaches the prompt or the citations. Put notes after the audience comment, not before it.
- Never put secrets, tokens, env values, user data or internal hostnames in guide files.

## Page context

Page context is what the page shows right now. The model treats it as authoritative for live values.

```ts
interface PageContext {
  pageName: string;
  route?: string;
  filters?: { label: string; values: string[] }[]; // empty values print as "All"
  groups: { title: string; items: PageContextItem[] }[];
  focus?: { label: string; elementId?: number; details?: string[] }; // e.g. the element being viewed
}

interface PageContextItem {
  label: string;
  value: string;
  elementId?: number;
  details?: string[]; // shown after the value, e.g. "target 2.67M", "as of 10/12/26"
}
```

It works for any page (tiles, tables, charts, forms): map what is on screen to groups of labelled values.
`PageContext.focus` is prompt text only; the id sent to Concierge comes from `getElementId`.

Example builder (the skill generates one like it from your page's own data types):

```ts
import { createPageContextStore, type PageContext } from '@metricinsights/ai-app-assistant';

const store = createPageContextStore();
export const setPageContext = store.set;
export const getPageContext = store.get;

export function buildPageContext({ deals, region }: { deals: Deal[]; region: string[] }): PageContext {
  return {
    pageName: 'Sales Pipeline',
    filters: [{ label: 'Region', values: region }],
    groups: [
      {
        title: 'Open deals',
        items: deals.map((d) => ({
          label: d.name,
          value: d.amountLabel,
          elementId: d.elementId,
          details: [`stage: ${d.stage}`, `as of ${d.updatedLabel}`],
        })),
      },
    ],
  };
}
```

Hookup, in the component that holds the data (the skill prints the exact `useEffect` and file; it never edits your
components):

```tsx
import { setPageContext, buildPageContext } from './ai-assistant/page-context';

useEffect(() => {
  setPageContext(buildPageContext({ deals, region }));
  return () => setPageContext(null);
}, [deals, region]);
```

Until `setPageContext` is called, `getPageContext()` returns `null` and nothing breaks.

## The skill

The package ships a skill, `ai-app-assistant-docs`, that writes the guide files and the code around them.

Install it into your project:

```sh
npx @metricinsights/ai-app-assistant add-skill
```

- Default target: `.claude/skills/ai-app-assistant-docs/` (Claude Code reads it, and so does Cursor).
- `--cursor` writes to `.cursor/skills/` instead.
- `--force` overwrites an existing copy; without it the command refuses.
- `--cwd <dir>` installs into another project folder.
- The third-party `npx skills add` CLI also works as an alternative; it is not a dependency.

Then ask your agent to run the skill. It asks where to put the folder (default `src/ai-assistant/`) and generates:

```
src/ai-assistant/
  docs/*.md             guide files
  knowledge.ts          loads docs/*.md with parseKnowledge
  page-context.ts       createPageContextStore() + buildPageContext(...)
  page-context.test.ts  only if your project already runs tests: checks buildPageContext on sample data
  follow-ups.ts         getFollowUps(ctx, asked)
  index.ts              exports assistantSetup
```

It writes only inside that folder and never edits your page's components. It ends by printing the mount snippet,
the page-context `useEffect` and any suggested refactors to apply by hand (see
[What changes in your page](#what-changes-in-your-page)). Statements it inferred and could not confirm are marked
`<!-- needs review -->`; check them.

Re-running it updates the docs and code instead of rewriting them: stale facts are rewritten, new features get
sections, sections about removed features are flagged rather than deleted. Text you edited stays; if it is now
wrong, the skill shows the change and asks first. If this README is out of date it suggests edits as a diff and
applies them only on your yes.

## Platform requirements

- MI Concierge is enabled on the instance and shown to the user (the assistant follows the same switch), with at
  least one allowed internal source. Without an allowed source,
  Concierge questions cannot be answered.
- For page-specific answers, the LLM proxy needs `ALLOW_LLM_ACCESS_VIA_API=Y`. The setting is read only when the
  Concierge service starts, so restart the service after changing it. Without the proxy, every question goes to
  Concierge.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the rules for changes, commit messages and the release flow.
Changes are listed in [CHANGELOG.md](CHANGELOG.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Metric Insights, Inc.

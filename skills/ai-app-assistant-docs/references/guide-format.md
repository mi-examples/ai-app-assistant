# Guide format and page context

## Guide files

Markdown files in `<folder>/docs/`, one topic each. `parseKnowledge` splits them on `## ` headings: each `##`
section is retrieved and cited on its own.

### Front matter (optional)

```md
---
summary: true
audience: all
suggested:
  - How do I filter by region?
  - What does the stage badge mean?
  - Why is a deal missing?
---
```

| Key         | Meaning                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------- |
| `audience`  | `all` (default) or `admin`. `admin` hides the file's sections from non-admin users.                 |
| `summary`   | `true` marks the summary file, always sent first. Without one, `user-guide.md` is the summary file. |
| `suggested` | Quick questions for the empty state (first 3 shown). Indented `- ` list, merged across files.       |

The text between the title and the first `##` of the summary file becomes its summary. Keep it to one short
paragraph.

### Comments

- `<!-- audience: admin -->` as the first line under a `##` heading makes that section admin-only (or `all` inside
  an admin file).
- Every other HTML comment is an author note and is stripped before the text reaches the model or the citations.
  Use these markers, always after the audience comment:
  - `<!-- needs review: <doubt> -->`: the statement was inferred and not confirmed from code. Put it on its own line
    directly after the sentence or paragraph it concerns (after `<!-- generated -->` if the whole section is
    unconfirmed). Name the doubt, since the model never sees the note.
  - `<!-- generated -->`: the section was written by the skill. A person who edits the section removes the marker;
    sections without it count as human-written and are only changed after asking.
- Never put secrets, tokens, env values, user data or internal hostnames in guide files.

## PageContext

What the page shows right now, sent to the model as authoritative for live values.

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
  value: string; // the formatted text the user sees
  elementId?: number;
  details?: string[]; // after the value, e.g. "target 2.67M", "as of 10/12/26"
}
```

It renders as:

```
Page: Sales Pipeline (/)

Filters:
Region: EMEA

Open deals
- Acme renewal (element 41): $120K · stage: Negotiation · as of 10/12/26
```

Map what is on screen to groups of labelled values. `focus` is prompt text only.

## Worked example (fictional "Sales Pipeline" page)

Imports use the published name; in a project that consumes the package from a folder, use the relative path
(for example `../packages/ai-app-assistant`).

`docs/user-guide.md`:

```md
---
summary: true
audience: all
suggested:
  - How do I filter deals by region?
  - What does the stage mean?
  - Why is a deal missing from the list?
---

# Sales Pipeline user guide

Sales Pipeline lists open deals with their amount and stage, narrowed by region.

## Deal list

<!-- generated -->

Each row shows the deal name, the amount, the stage and the date it was last updated. Rows are sorted by amount,
largest first. Click a row to open the deal.

## Region filter

<!-- generated -->

The Region dropdown lets you pick several regions at once.

<!-- needs review: multi-select inferred from the component props -->

With nothing picked, all regions are shown.

## Refresh schedule

<!-- audience: admin -->
<!-- generated -->

Deal data is refreshed by the nightly load configured in the page's setup.
```

`docs/setup-guide.md`, one troubleshooting section per visible failure, named by the symptom:

```md
## Troubleshooting: a deal shows "No amount"

<!-- generated -->

The deal row has no amount in the Deals dataset, so the list shows "No amount" instead of a number. Check that the
deal's Amount column is filled and that the nightly load ran.
```

`page-context.ts`, built from the page's own types and formatted values:

```ts
import { createPageContextStore, type PageContext } from '@metricinsights/ai-app-assistant';
import type { Deal } from '../pages/pipeline/types';

export const PAGE_NAME = 'Sales Pipeline';

const store = createPageContextStore();
export const setPageContext = store.set;
export const getPageContext = store.get;

let elementId: number | null = null;

/** The deal open on the deal page; sent to Concierge as `element_id`. */
export function setElementId(id: number | null): void {
  elementId = id;
}

export function getElementId(): number | null {
  return elementId;
}

/**
 * Describes what the Sales Pipeline list shows, for the assistant.
 * - `deals`: the rows the Deal list shows, as loaded by `useDeals()`.
 * - `region`: the regions picked in the Region dropdown; empty means all.
 */
export function buildPageContext({ deals, region }: { deals: Deal[]; region: string[] }): PageContext {
  return {
    pageName: PAGE_NAME,
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

`page-context.test.ts`, only when the project already runs tests (Vitest shown):

```ts
import { describe, expect, it } from 'vitest';
import { buildPageContext } from './page-context';

describe('buildPageContext', () => {
  it('maps deals to one group of labelled values', () => {
    const ctx = buildPageContext({
      deals: [
        { name: 'Acme renewal', amountLabel: '$120K', elementId: 41, stage: 'Negotiation', updatedLabel: '10/12/26' },
      ],
      region: [],
    });

    expect(ctx.groups[0].items[0]).toEqual({
      label: 'Acme renewal',
      value: '$120K',
      elementId: 41,
      details: ['stage: Negotiation', 'as of 10/12/26'],
    });
    expect(ctx.filters).toEqual([{ label: 'Region', values: [] }]);
  });
});
```

`follow-ups.ts`:

```ts
import type { PageContext } from '@metricinsights/ai-app-assistant';

export function getFollowUps(ctx: PageContext | null): string[] {
  const hasStage = ctx?.groups.some((g) => g.items.some((i) => i.details?.some((d) => d.startsWith('stage:'))));

  return hasStage ? ['Which deals are in Negotiation?'] : [];
}
```

`knowledge.ts`:

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

`index.ts`:

```ts
import type { AssistantSetup } from '@metricinsights/ai-app-assistant';
import { getFollowUps } from './follow-ups';
import { knowledge } from './knowledge';
import { getElementId, getPageContext } from './page-context';

export const assistantSetup: AssistantSetup = { knowledge, getPageContext, getElementId, getFollowUps };
```

## Hookup

Printed, never applied. In the component that holds `deals` and `region` (here `src/pages/pipeline/pipeline.tsx`):

```tsx
import { setPageContext, buildPageContext } from '../../ai-assistant/page-context';

useEffect(() => {
  setPageContext(buildPageContext({ deals, region }));

  return () => setPageContext(null);
}, [deals, region]);
```

Followed by the note, in plain words:

```
What this does
- buildPageContext turns the page's data into a short description of what is on screen
  (each deal with its amount, stage and date, and the regions picked).
- setPageContext keeps that description where the assistant reads it. Nothing is sent until the user asks
  a question; then it goes along with the question, so answers can quote the numbers on screen.
- The dependency list re-runs it whenever the deals or the picked regions change, so it matches the screen.
- The cleanup clears it when the page closes, so another page never answers from stale values.
Arguments
- deals: the deals the list shows (from useDeals() in this component).
- region: the regions picked in the Region dropdown (the selectedRegions state).
```

On a detail page that shows one element (here the deal page), the second hookup sets the element and a `focus`
snapshot:

```tsx
import { PAGE_NAME, setElementId, setPageContext } from '../../ai-assistant/page-context';

useEffect(() => {
  if (!deal) return;
  setElementId(deal.elementId);
  setPageContext({
    pageName: PAGE_NAME,
    route: `/deal/${deal.id}`,
    groups: [],
    focus: { label: deal.name, elementId: deal.elementId },
  });

  return () => {
    setElementId(null);
    setPageContext(null);
  };
}, [deal]);
```

With a note that says the assistant now knows which deal is open, so "how has this deal changed?" goes to
Concierge with that element.

## Suggested refactors

When the snapshot needs a rule that the page writes inline in a component, do not copy it into `page-context.ts`.
Leave the detail out and mark the spot:

```ts
details: [
  `stage: ${d.stage}`,
  // suggested refactor: isDealStale(deal) from src/components/deal-row/deal-row.tsx (adds "stale" to the details)
],
```

Then print it at the end of the run, for example:

```
Suggested refactors (not applied)

1. src/components/deal-row/deal-row.tsx:42 decides inline when the "Stale" badge shows:
     {Date.now() - deal.updatedAt > 30 * DAY && <Badge>Stale</Badge>}
   Extract it to src/utils/deal-utils.ts:
     export const isDealStale = (deal: Pick<Deal, 'updatedAt'>): boolean => Date.now() - deal.updatedAt > 30 * DAY;
   and call it in deal-row.tsx: {isDealStale(deal) && <Badge>Stale</Badge>}
   The page looks the same. Afterwards the assistant can answer "which deals are stale?";
   rerun the skill to add it.
```

With no such rules, print `Suggested refactors: none`.

## Mount snippet

Printed for the developer, never applied. It goes in a component the developer owns, outside the assistant folder
(for example `src/components/assistant/assistant.tsx`, rendered once near the root), with the `load` path relative
to that file:

```tsx
import { AiAppAssistant } from '@metricinsights/ai-app-assistant';
import { PAGE_NAME } from '../../ai-assistant/page-context';

<AiAppAssistant
  load={() => import('../../ai-assistant')}
  pageName={PAGE_NAME}
  userName={user.username}
  userFirstName={user.first_name}
  isAdmin={/* how this project decides admin */}
/>;
```

`load` must stay a dynamic `import()` of the folder: that keeps the chat and the guide files out of the page's main
bundle. Never import `./ai-assistant` statically anywhere in the page. If the page has its own on/off switch (a page
variable, a feature flag), pass it as `enabled`; otherwise leave it out.

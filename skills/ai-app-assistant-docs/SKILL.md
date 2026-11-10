---
name: ai-app-assistant-docs
description: Set up or update the AI App Assistant for a portal page. Writes the page's guide files (user guide, setup guide, topic files) and the code around them (knowledge loader, page-context builder, follow-ups, assistantSetup export) from the project's own code. Use when adding the assistant to a page, or when the page's features changed and the guides need refreshing.
---

# AI App Assistant docs

You write the guide files and small helper code for `@metricinsights/ai-app-assistant`, from what the project's
code really does. Read `references/guide-format.md` (next to this file) before writing anything: it has the file
format, the `PageContext` shape and a worked example.

## Hard rules

- Write only inside the chosen assistant folder. The one exception is README edits the developer approved in a later
  run. Never edit the page's components, routes or config.
- Never write secrets, tokens, env values, user data or internal hostnames into any file.
- Mark every statement you inferred and could not confirm from code with a note naming the doubt, for example
  `<!-- needs review: admin access rule inferred -->`. Put it on its own line directly after the sentence or
  paragraph it concerns (after `<!-- generated -->` when the whole section is unconfirmed). Notes are stripped before
  the model sees the text, so the marker must say what to check.
- Mark every section you generate with `<!-- generated -->`. A person who edits a section removes that marker, which
  is how later runs tell generated text from human text.
- Put these comments after the `<!-- audience: ... -->` line when a section has one, never before it.
- Reuse what the project already has. Do not copy logic from the page's helpers or components: import a helper if it
  is exported. When a rule you need (what is shown, how a value is labelled) is written inline in a component or is
  not exported, do not re-create it. Leave that detail out, mark the spot (`<!-- needs review: ... -->` in a guide,
  `// suggested refactor: ...` in code) and list it under "Suggested refactors" at the end. A copied rule drifts
  from the page without anyone noticing; a listed refactor is visible.
- Do not invent features. If the code does not show it, leave it out or mark it for review.

## Imports

Generated code imports from `@metricinsights/ai-app-assistant`. If the project consumes the package from a folder
instead (check `package.json` and existing imports of the assistant), import from that relative path instead.

## First run (no `<folder>/docs/` yet)

0. Search the project for existing `AiAppAssistant` usage, `parseKnowledge` calls or guide-file folders. If found,
   tell the developer and ask: migrate those files into the new folder (keep their text, add markers) or leave them
   and stop. Never generate a second copy of the same guides.
1. Ask the developer where the assistant folder should be. Suggest `src/ai-assistant/`. Say what you will write.
2. Read the project: `README`, `CLAUDE.md` / `AGENTS.md`, the routes, the platform config (for example
   `PP_VARIABLES` definitions), the main page components and any existing help text.
3. Write the guide files in `<folder>/docs/`:
   Every guide file starts with front matter (`audience: all` or `admin`) and a `# Title` line. Only the summary
   file has `summary: true` and `suggested`.
   - `user-guide.md`: `summary: true`, `audience: all`, three `suggested` questions. A short intro paragraph under
     the title, then one `##` section per user-visible feature.
   - `setup-guide.md`: `audience: admin`. Variables, prerequisites and setup steps, then one
     `## Troubleshooting: <symptom>` section per failure the code makes visible (an empty state, an error or
     "no access" message, a missing or placeholder value): what the user sees, why it happens, what an admin checks.
   - Topic files (for example `metrics.md`) whenever one subject has rules people ask about: how a value is
     calculated or chosen, formats, empty values, units. Write one even if it is short.

   Aim for one section per question a user or admin would ask; several short sections beat one long one. Name each
   heading with the words people use (button labels, tile and column names, the message text): the assistant finds
   sections by matching the question's words, and the heading counts most.

4. Write the code in `<folder>/`:
   - `knowledge.ts`: loads `docs/*.md` with `import.meta.glob` and `parseKnowledge`.
   - `page-context.ts`: `export const PAGE_NAME = '<page name>'` (used by `buildPageContext` and by the mount),
     `createPageContextStore()` exports (`setPageContext`, `getPageContext`) and a pure, typed
     `buildPageContext(...)`. Give `buildPageContext` a doc comment: one line on what it returns, then one line per
     input saying what on the page it comes from (for example "`deals`: the rows the Deal list shows"), so the
     hookup can be read without this skill. Take the page's own data types as input (hook results, store state, API
     types, filters) and use the page's own formatted values and labels, never raw ids as labels. One function, no
     classes, no generic mapping layer. If the data is derived inside a large component, take the derived values
     as input; do not re-derive them. Reuse the page's display helpers (what is visible, formatted labels, "shows
     target" rules). When such a rule is inline in a component, leave that detail out of the snapshot and put a
     `// suggested refactor: <helper> from <file>` comment where it would go (see "Suggested refactors" in
     `references/guide-format.md`).

     If the page has a detail or viewer route that shows one element on its own, also export `setElementId` /
     `getElementId` (a module-level `number | null`). The assistant sends that id to Concierge as `element_id`, so
     questions about "this report" reach the right element. That route then sets a snapshot with `focus` (the
     element's name and id) and `groups: []`; see the worked example.

   - `page-context.test.ts`: only when the project already runs tests (a `test` script and a runner such as Vitest
     or Jest in `package.json`). Test `buildPageContext` with a small sample of the page's data, in that runner's
     style. If a module it imports touches `window` on import, mock that module instead of adding a DOM
     environment. Never install a test runner or other dependencies and never add test config: with no runner, skip
     the file and say so at the end.
   - `follow-ups.ts`: `getFollowUps(ctx)` returning 0-3 chips that suit the page's data and guide
     (for example "Compare with target" only when items carry a target detail). Empty is fine. Add a second
     `asked: string[]` parameter only if you use it; an unused parameter fails most lint setups.
   - `index.ts`: `export const assistantSetup: AssistantSetup = { knowledge, getPageContext, getFollowUps }` (plus
     `getElementId` when you wrote it) and nothing else. The mount loads this module with a dynamic `import()`; the hookup imports from
     `<folder>/page-context` instead, so pages that set the context do not pull the guide files into their main
     bundle.
5. Find the commands in `package.json` scripts and run them scoped to the folder: lint, tests (when the project has them) and the type check
   (`tsc --noEmit`). Fix only the files you generated until all pass. If a failure is in a file you did not write,
   report it instead of editing it.
6. Print for the developer:
   - the mount snippet from `references/guide-format.md` ("Mount snippet"), with `pageName` and the user fields taken
     from the project's existing user-info hook and `pageName={PAGE_NAME}` imported from
     `<folder>/page-context`. Suggest a new component file outside `<folder>` for it (for
     example `src/components/assistant/assistant.tsx`, rendered once near the root) and adjust the `load` path to
     it: `<folder>` holds only generated files, so the developer's own code stays visibly separate. Props not in the snippet
     (`enabled`, `accentColor`, `labels`, `storageKey`, `proxy`, `sources`) are optional; do not invent values;
   - the hookup: the `useEffect` and the exact file and spot where it goes (see "Hookup" in
     `references/guide-format.md`), followed by a short "What this does" note in plain words:
     `buildPageContext` turns the page's data into a description of what is on screen, `setPageContext` keeps it
     where the assistant reads it when the user asks a question (nothing is sent before that), the dependency list
     keeps it in step with the screen, and the cleanup clears it when the page closes. Then one line per argument
     naming the variable in that component and what it is on screen. With a detail or viewer route, print its
     hookup too (`setElementId` and the `focus` snapshot). Do not apply them; the developer adds them;
   - every spot marked `<!-- needs review -->`, with file and section;
   - **Suggested refactors (not applied)**: one entry per rule or value you left out because it is inline in a
     component. Give the file and line, the helper to extract (name and signature), where to put it (an existing
     utils module when there is one), and a short diff that moves the code and makes the component call the helper,
     with no change in what the page shows. Say what the assistant gains once it is done and that rerunning the
     skill picks it up. Print "Suggested refactors: none" when there are none, so the developer knows it was
     checked.

## Later runs (guide files already exist)

1. Read the code, the README and the current guide files. Where git is available, find the commit that last changed
   the guides (`git log -1 -- <folder>/docs`) and diff the page code since then, excluding the assistant folder
   (`git diff <that-commit> HEAD -- . ':!<folder>'`), plus uncommitted changes. Without git, compare by reading.
2. Update the guides section by section: rewrite stale facts, add sections for new features. Do not delete a
   section about a removed feature; flag it (`<!-- needs review: feature no longer in code -->`).
3. Keep text a person wrote or edited (a section without `<!-- generated -->`) unless it is now wrong. If it is
   wrong, show the proposed change and ask before replacing it.
4. Regenerate `buildPageContext`, `page-context.test.ts` (when it exists) and `follow-ups.ts` only when the page's data types,
   formatted values or filters changed, or a new guide section needs a new follow-up chip. A guide-only change does
   not regenerate them. If those files have hand edits, show the change and ask first. Also check that the page's
   hookup still passes what `buildPageContext` expects and what is on screen; if not, print the updated line (do not
   apply it). For each `// suggested refactor:` comment in the folder: if the helper now exists and is exported,
   import it, add the detail to the snapshot (and its test, if there is one), and remove the comment; otherwise keep it.
5. README check: if the README lacks features the code has, or describes something that changed, propose the
   edits as a diff and apply them only when the developer says yes.
6. Run lint, tests (if the project has them) and the type check on the folder again.
7. End with a summary of what changed, the files left unchanged, the remaining `<!-- needs review -->` spots and the
   open suggested refactors (same format as the first run).

## Quality bar

- Write for a page user first: plain words, what they see and what to click. Put admin-only content in
  `setup-guide.md` or behind `<!-- audience: admin -->`.
- Be specific. Use the labels, buttons and messages the page really shows.
- Keep sections short and independent: each `##` section is retrieved and cited on its own.
- No duplicated facts across files; link topics by name instead.

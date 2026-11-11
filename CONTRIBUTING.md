# Contributing to ai-app-assistant

## Setup

Node.js 22.12 or newer (an LTS line: 22, 24 or 26; the test tools do not support Node 23 or 25).

```sh
git clone https://github.com/mi-examples/ai-app-assistant.git
cd ai-app-assistant
npm ci
```

| Command | What it does |
| -- | -- |
| `npm test` | Unit tests (Vitest). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint, no warnings allowed. |
| `npm run check` | All three. Run it before you open a pull request. |
| `npm run pack:check` | Lists the files that would be published. |

There is no build step. The package ships its TypeScript and SCSS sources,
and the consuming page's Vite build compiles them.

To try a change on a real page, install the checkout into it
(`npm install ../ai-app-assistant`) and add
`resolve: { dedupe: ['react', 'react-dom'] }` to the page's Vite config.

## Rules for changes

- **Public API.** Everything a page may use is exported from `src/index.ts`.
  A change to a prop, an export, the guide-file format or the skill needs a
  README update in the same pull request.
- **Nothing page-specific.** The package must work for any Metric Insights
  portal page. `src/boundary.test.ts` fails when a source file imports from
  outside the package or reads the host page's `PP_VARIABLES`.
- **No customer data.** This repository is public. Don't commit customer
  names, internal hostnames, real user data, tokens or env values, in code,
  tests, fixtures or docs.
- **Tests.** New behavior comes with a test next to the code
  (`*.test.ts` / `*.test.tsx`). Tests are not published.
- **The skill** (`skills/ai-app-assistant-docs/`) stays tool-neutral: plain
  "read / write / ask" steps that work in Claude Code and Cursor.
- **`bin/add-skill.mjs`** uses Node built-ins only.
- **No install scripts.** Nothing may run on `npm install` of the package.

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/). The
release tools compute the next version and the changelog from them.

```
<type>(<scope>): <description>
```

| Type | Release |
| -- | -- |
| `feat` | minor |
| `fix`, `perf`, `revert` | patch |
| `!` after the type, or a `BREAKING CHANGE:` footer | major |
| `docs`, `test`, `refactor`, `chore`, `ci`, `style` | none |

Examples:

```
feat(context): add focus details to the page context
fix(chat): keep the scroll position when an answer streams in
docs(readme): describe the sources prop
```

## Pull requests

1. Branch from `main`.
2. Make the change, with tests. Run `npm run check`.
3. Open the pull request and fill in the template. CI runs lint, typecheck,
   tests, an `npm audit` and a secret scan.

## CI and releases

CI and releases use the shared workflows from
[mi-examples-workflows](https://github.com/mi-examples/mi-examples-workflows).
The callers in `.github/workflows/` are generated from
`.github/mi-examples-workflows.json`. To change a CI setting, edit that file
and re-run the installer; don't edit the callers by hand.

```sh
npx github:mi-examples/mi-examples-workflows
```

### Publishing

The package is in beta. Betas are published to npm under the `beta` dist-tag;
there is no production release yet.

- **The version in `package.json` is a prerelease** (`0.1.0-beta.N`) until
  the first production release. Keep it that way: the release workflow
  publishes a production version it finds on `main`, and skips a prerelease.
- **The first beta is published by hand**, because npm only accepts a trusted
  publisher for a package that already exists.
- **One-time setup** is described in
  [npm-publishing.md](https://github.com/mi-examples/mi-examples-workflows/blob/main/docs/npm-publishing.md):
  the `npm-publish` environment and the npm trusted publisher for
  `release.yml`. Don't rename `release.yml`: the trusted publisher is
  registered for that filename.

The release callers (`release.yml`, `main-ahead-check.yml`) are the same ones
[pp-dev](https://github.com/mi-examples/pp-dev) uses. Once the one-time setup
is done and a `develop` branch exists, every push to `develop` with a `feat`
or `fix` commit publishes the next beta. Production releases follow the
[shared release flow](https://github.com/mi-examples/mi-examples-workflows/blob/main/docs/workflows.md#release-workflows):
run **Actions → Release → Run workflow**, review the release pull request
and its `CHANGELOG.md` entry, and merge it. Merging publishes to npm with
Trusted Publishing (OIDC) and provenance; no npm token is stored.

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).

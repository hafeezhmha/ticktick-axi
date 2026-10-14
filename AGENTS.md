# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code. It is for agents working **on** this repo; how to **use** the CLI lives in the generated skill (`skills/ticktick-axi/SKILL.md`) and the README.

Command behavior is owned by [README.md](README.md). Contributor workflow, release-please, generated files, and implementation invariants are owned by [CONTRIBUTING.md](CONTRIBUTING.md). Follow the section named below instead of restating it here.

- [VISION.md](VISION.md) is the product scope: parity with the documented TickTick Open API through an AXI interface, and no endpoint the docs do not describe.
- Dispatch, TOON rendering, structured errors, the `--version` fast path, `update` and session hooks come from [`axi-sdk-js`](https://www.npmjs.com/package/axi-sdk-js). The API is called directly with `fetch` at `https://api.ticktick.com/open/v1`.
- The installable skill is generated from `src/skill.ts`. Run `pnpm run build:skill` and commit the result; never hand-edit `skills/ticktick-axi/SKILL.md` ([CONTRIBUTING.md Repo conventions](CONTRIBUTING.md#repo-conventions)).
- Every write (`create`, `edit`, `complete`, `batch`, `project create`, ...) is a dry run until `--yes` and is never retried. Reads retry on 429, 5xx and network errors, honouring `Retry-After` ([CONTRIBUTING.md Implementation invariants](CONTRIBUTING.md#implementation-invariants)).
- Tokens never appear in output, logs or errors. `test/security.test.ts` checks every command, so add each new command to it.
- Flags are strict: each command declares a `FlagSpec`, and an unknown flag exits 2 with the valid list.
- `src/version.ts` imports Node builtins only; `bin/ticktick-axi.ts` serves `--version` before importing `src/cli.ts`.
- Tests are offline: `fetch` is stubbed with `mockFetch` from `test/support.ts`, the config dir is a temp dir, and the clock is fixed. Never call the real TickTick API from a test.
- [docs/catalog-submission.md](docs/catalog-submission.md) tracks listing this AXI in the [kunchenguid/axi](https://github.com/kunchenguid/axi) catalog, and what is still unverified against a real account.

## Layout

- `bin/ticktick-axi.ts`: `--version` fast path, then a dynamic import of `src/cli.ts`.
- `src/cli.ts`: `DESCRIPTION`, `TOP_HELP`, command and help maps.
- `src/http.ts`: the API client: bearer auth, read retries, error translation, redaction.
- `src/api.ts`: one function per documented task, comment and project-list endpoint, plus id validation; `src/api-org.ts`: projects, groups, columns, tags, assign and batch.
- `src/api-life.ts`: the same for habits, focus records, countdowns and preferences, plus stamp/time helpers (the live API sends some times as epoch ms).
- `src/query.ts`: which endpoint serves a listing, and client-side due-date filters and sorting.
- `src/dates.ts`, `src/format.ts`: TickTick dates and time zones; priority and status maps, rows, `--fields`, truncation.
- `src/config.ts`, `src/oauth.ts`: config dir, credentials and token storage (0700 dir, 0600 file); authorize URL, code exchange, loopback listener.
- `src/commands/*.ts`: one file per command group, each exporting its handler and `*_HELP` (`write.ts`: create, edit, complete, move, delete; `items.ts`: checklist; `search.ts`: search, completed; `comments.ts`; `project.ts`, `groups.ts`, `columns.ts`, `tags.ts`, `assign.ts`, `batch.ts`, sharing `org-common.ts`).

## Development

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run build:skill -- --check
pnpm run lint
pnpm run format:check
pnpm test
```

Use conventional commits (`feat:`, `fix:`, `docs:`, `test:`). Do not hand-edit `CHANGELOG.md`, `.release-please-manifest.json` or `skills/ticktick-axi/SKILL.md`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.

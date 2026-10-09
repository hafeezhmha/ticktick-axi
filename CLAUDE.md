# CLAUDE.md

Guidance for AI agents working **on** this repository (not for using the CLI; that is `AGENTS.md`).

## What this is

`ticktick-axi` is an [AXI](https://github.com/kunchenguid/axi) (Agent eXperience Interface): a CLI built for agents that emits token-efficient [TOON](https://toonformat.dev/) on stdout. It calls the official TickTick Open API (`https://api.ticktick.com/open/v1`, docs at https://developer.ticktick.com/docs#/openapi) directly with `fetch`. Dispatch, TOON rendering, structured errors, the `--version` fast path, the `update` self-update and session hooks come from [`axi-sdk-js`](https://www.npmjs.com/package/axi-sdk-js).

## Layout

- `bin/ticktick-axi.ts`: `--version` fast path, then a dynamic import of `src/cli.ts`.
- `src/cli.ts`: `DESCRIPTION`, `TOP_HELP`, command and help maps.
- `src/version.ts`: leaf module (node builtins only) read by the fast path.
- `src/http.ts`: the API client: bearer auth, retries for reads only, error translation, redaction.
- `src/api.ts`: one function per documented endpoint, plus id validation.
- `src/query.ts`: which endpoint serves a listing, and client-side due-date filters and sorting.
- `src/dates.ts`: TickTick date format, time zones, user date parsing.
- `src/format.ts`: priority/status maps, list rows, `--fields`, truncation.
- `src/config.ts`: config dir, client credentials, token storage (0700 dir, 0600 file).
- `src/oauth.ts`: authorize URL, code exchange, loopback listener.
- `src/commands/*.ts`: one file per command group, each exporting its handler and `*_HELP`.
- `src/skill.ts` + `scripts/build-skill.ts`: generate `skills/ticktick-axi/SKILL.md` (do not hand-edit it).

## Rules to keep

- Documented endpoints only. If the docs do not describe it, do not call it; say so in the README limitations.
- Every write is a dry run until `--yes`, and is never retried automatically. Reads retry on 429/5xx/network errors, honouring `Retry-After`.
- Never print, log or store more secret material than needed. Tokens never appear in output; `test/security.test.ts` enforces this for every command, so add new commands to it.
- Strict flags: each command declares its flags in a `FlagSpec`; unknown flags exit 2 with the valid list.
- Follow the 10 AXI principles: minimal default schemas, `--full`/`--fields`, truncation with size hints, totals, definitive empty states, content-first home, `help` hints with `<placeholders>`, structured errors, exit codes 0/1/2.
- Tests are offline: `fetch` is stubbed (`test/support.ts`), the config dir is a temp dir, and the clock is fixed.

## Before pushing

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run build:skill -- --check
pnpm run lint
pnpm run format:check
pnpm test
```

Use conventional commits (`feat:`, `fix:`, `docs:`, `test:`) so release-please can version. See `CONTRIBUTING.md`.

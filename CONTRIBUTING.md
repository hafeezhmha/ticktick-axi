# Contributing

Thanks for wanting to contribute.

## Repo conventions

- Node 20+, TypeScript, ESM only, pnpm.
- Install with `pnpm install --frozen-lockfile`, then run before pushing:

  ```sh
  pnpm run build
  pnpm run build:skill -- --check
  pnpm run lint
  pnpm run format:check
  pnpm test
  ```

  `pnpm test` runs vitest with coverage thresholds. Tests must stay offline: stub `fetch` with `mockFetch` from `test/support.ts`, never call the real TickTick API, and use obviously fake tokens such as `test-token-not-real`.

- Do not hand-edit `CHANGELOG.md` or `.release-please-manifest.json`. [release-please](https://github.com/googleapis/release-please) regenerates them from conventional commit messages, and the `Guard generated files` check fails a PR that edits them.
- Do not hand-edit `skills/ticktick-axi/SKILL.md`. Edit `src/skill.ts` (or the help text it reuses), run `pnpm run build:skill`, and commit the result. CI fails on drift.
- Only use endpoints documented at https://developer.ticktick.com/docs#/openapi.
- New write commands must be dry runs until `--yes`, must not retry, and must be added to `test/security.test.ts`.

## Design

ticktick-axi follows the [AXI](https://github.com/kunchenguid/axi) principles: TOON output, minimal default schemas, truncation with `--full`, pre-computed counts, definitive empty states, a content-first home view, contextual next-step hints, structured errors with exit codes 0/1/2, and opt-in session hooks plus an installable skill.

## Workflow

1. Fork the repo and create a branch.
2. Make your change; add or update tests under `test/`.
3. Run the checks above.
4. Commit with a [conventional commit](https://www.conventionalcommits.org/) message (`feat: ...`, `fix: ...`, `docs: ...`).
5. Open a pull request.

## Security

Never paste real TickTick tokens, client secrets or personal task data into issues, tests, fixtures or logs. Report security problems privately to the maintainer rather than in a public issue.

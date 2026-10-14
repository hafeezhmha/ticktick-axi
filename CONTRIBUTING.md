# Contributing

Thanks for wanting to contribute.
Read [VISION.md](VISION.md) first: it says what belongs in ticktick-axi and what doesn't.

## Workflow

1. Fork the repo, clone it, and create a branch.
2. Make your change; add or update tests under `test/`.
3. Run the checks in [Repo conventions](#repo-conventions).
4. Commit with a [conventional commit](https://www.conventionalcommits.org/) message (`feat: ...`, `fix: ...`, `docs: ...`). release-please builds the changelog and the next version from these.
5. Open a pull request against `main`.

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
- Do not bump `package.json`'s `version` by hand for ordinary changes. release-please updates it in the release PR.
- Do not hand-edit `skills/ticktick-axi/SKILL.md`. Edit `src/skill.ts` (or the help text it reuses), run `pnpm run build:skill`, and commit the result. CI fails on drift.

## Release

release-please cuts releases from conventional commits on `main`. Merging its release PR publishes to npm through `.github/workflows/release-please.yml`, using npm trusted publishing (OIDC) with provenance, so no npm token is stored in the repo.

One-time setup for the maintainer:

- In the repo's Settings > Actions > General, allow GitHub Actions to create and approve pull requests. Without it, release-please cannot open its release PR.
- On npmjs.com, add this repository and `release-please.yml` as the package's trusted publisher.

`ci.yml` `paths-ignore`s the release-please output set (`.release-please-manifest.json`, `CHANGELOG.md`, `package.json`) on pull requests, so a release PR creates no run that would sit waiting for approval.

## Implementation invariants

- Only call endpoints documented at https://developer.ticktick.com/docs#/openapi. If the docs do not describe it, do not call it; list the gap under the README's limitations.
- Every write command is a dry run until `--yes`, is never retried automatically, and is added to `test/security.test.ts`.
- Reads retry on 429, 5xx and network errors, honouring `Retry-After`. A write whose outcome is unknown returns `WRITE_UNCERTAIN` instead of retrying.
- Never print, log or store more secret material than needed. Tokens never appear in output, and the config dir is 0700 with 0600 files.
- Flags are strict: each command declares its flags in a `FlagSpec`, and unknown flags exit 2 with the valid list.
- Follow the 10 AXI principles: minimal default schemas, `--full` and `--fields`, truncation with size hints, totals, definitive empty states, a content-first home view, `help` hints with `<placeholders>`, structured errors, and exit codes 0/1/2.

## Security

Never paste real TickTick tokens, client secrets or personal task data into issues, tests, fixtures or logs. Report security problems privately to the maintainer rather than in a public issue.

## Questions

Open an issue.

# Contributing ticktick-axi to the AXI catalog

Maintainer notes for listing ticktick-axi in the community catalog of [kunchenguid/axi](https://github.com/kunchenguid/axi). Contributing to ticktick-axi itself is in [CONTRIBUTING.md](../CONTRIBUTING.md). Nothing here has been submitted yet. Researched against the axi repo at commit `b6b9a15` (2026-10-06).

## The catalog entry

`catalog.yaml` is the single source of truth; README.md and docs/index.html tables are generated from it. Append this to the end of the `community:` list (no TickTick AXI is listed there yet):

```yaml
- name: ticktick-axi
  url: https://github.com/hafeezhmha/ticktick-axi
  author: hafeezhmha
  domain: TickTick
  description: "See overdue and due-today TickTick tasks, list and filter tasks by project, due date, priority or tag, and create, edit or complete them through the official Open API - every write is a dry run until `--yes`, and writes are never auto-retried."
```

Field rules from the catalog header: descriptions may use `inline code` and markdown links, one sentence or two short clauses. `domain` follows the product-name convention of similar entries (`ClickUp`, `Slack`, `Plex`).

### About `admission`

About 40 of the ~90 community entries carry an `admission:` block (`status: admitted|exception`, `reviewed_revision`, `reviewed_components`, `source_observations`, and `exception` when status is `exception`). Per the repo's `VISION.md`, admission requires an **independent source review** of the package at an exact pinned revision or release, and contributor assertions or transcripts are not sufficient evidence. So do not write a self-assessed `admission` block; let the review produce it against a tagged release. To make that review easy, the components a reviewer would likely inspect are:

```
package.json, bin/ticktick-axi.ts, src/version.ts, src/cli.ts, src/args.ts, src/errors.ts,
src/http.ts, src/api.ts, src/query.ts, src/dates.ts, src/format.ts, src/config.ts, src/oauth.ts,
src/commands/home.ts, src/commands/projects.ts, src/commands/tasks.ts, src/commands/task.ts,
src/commands/write.ts, src/commands/auth.ts, src/commands/setup.ts, src/commands/self-update.ts,
src/skill.ts, skills/ticktick-axi/SKILL.md, LICENSE
```

Possible review findings to be ready for (honest self-assessment, not a verdict):

- No session-_end_ hook or lifecycle capture (principle 7 mentions it); only the SessionStart hook via `axi-sdk-js`.
- The session hook runs the live home view, which makes one network call per session start.
- No `--json` output mode (none of the reference AXIs require one).

## Workflow (from axi's CONTRIBUTING.md)

Human-authored PRs to `main` must go through [no-mistakes](https://github.com/kunchenguid/no-mistakes) **v1.30.1 or newer**; a `Require no-mistakes` check fails PRs without its signature, and `Guard generated files` fails PRs that hand-edit release-please files.

1. Fork `kunchenguid/axi` on GitHub, then clone the parent repo (or set your clone's `origin` back to `git@github.com:kunchenguid/axi.git`).
2. Create a branch, e.g. `git switch -c catalog/ticktick-axi`.
3. Initialise the gate with your fork as push target:

   ```sh
   no-mistakes init --fork-url git@github.com:hafeezhmha/axi.git
   ```

4. Use Node 24 (CI's version) and install: `pnpm install --frozen-lockfile`.
5. Add the entry above to the `community:` list in `catalog.yaml`.
6. Regenerate the tables: `pnpm run docs:gen` (then `pnpm run docs:check` should pass). Do not hand-edit the `generated:...` regions.
7. Run the gate commands CI runs: `pnpm run format:check` and `pnpm run lint`.
8. Commit all three files (`catalog.yaml`, `README.md`, `docs/index.html`) with a conventional message, e.g. `docs(catalog): add ticktick-axi`.
9. Push through the gate, not to `origin`:

   ```sh
   git push no-mistakes
   ```

10. Run `no-mistakes` to attach to the pipeline, review findings, and auto-fix as needed. When it passes it pushes to your fork and opens the PR against `kunchenguid/axi` with the required signature.

See the [no-mistakes quick start](https://kunchenguid.github.io/no-mistakes/start-here/quick-start/).

## What must happen first

1. ~~**Publish this repository publicly**~~ Done 2026-10-14: `main` is public at `https://github.com/hafeezhmha/ticktick-axi`, and the history was checked for credentials and personal data first.
2. **Publish to npm.** The skill and README use `npx -y ticktick-axi` and `npm install -g ticktick-axi`; the name `ticktick-axi` was free on npm when checked (registry returned 404). Either `npm publish --access public` after `pnpm run build`, or let the included release-please workflow publish on the first release (it uses npm trusted publishing/OIDC, so configure the package's trusted publisher on npmjs.com first, and allow GitHub Actions to create pull requests in the repo settings, or release-please cannot open its release PR).
3. **Tag a release** (release-please will cut `v0.1.0`) so the catalog review can pin an exact revision.
4. **Verify against a real account once**, yourself: `auth login`, `projects`, `tasks`, a `create` dry run, then `create --yes` / `edit --yes` / `complete --yes` on a throwaway task. The test suite is entirely mocked, so this is the only check of real API behaviour (see "Uncertain" below).
5. Install no-mistakes v1.30.1+ (it is not installed on this machine).

## Checklist

| Item                                                                                                                  | Status                                               |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| AXI 1: TOON output via `axi-sdk-js` / `@toon-format/toon`                                                             | done                                                 |
| AXI 2: minimal list schemas (4 fields), `--fields`, default limit 100                                                 | done                                                 |
| AXI 3: truncation with size hints and `--full` (task content, checklist, titles)                                      | done                                                 |
| AXI 4: totals (`count: N of M`), home summary counts, checklist `x/y done`                                            | done                                                 |
| AXI 5: definitive empty states                                                                                        | done                                                 |
| AXI 6: structured errors on stdout, exit 0/1/2, unknown flags rejected with valid list, idempotent no-ops, no prompts | done                                                 |
| AXI 7: opt-in `setup hooks` (Claude Code, Codex, OpenCode) + generated skill with `--check` in CI                     | done (no session-end capture)                        |
| AXI 8: no-args home shows live data                                                                                   | done                                                 |
| AXI 9: contextual `help[]` hints with `<placeholders>`                                                                | done                                                 |
| AXI 10: per-command `--help`, home shows `bin` + description, `--version` fast path                                   | done                                                 |
| Writes gated behind `--yes`; writes never auto-retried                                                                | done                                                 |
| Offline test suite passing; token-leak test across all commands                                                       | done                                                 |
| MIT LICENSE (copyright hafeezhmha), README, CONTRIBUTING, VISION, AGENTS.md, CLAUDE.md                                | done                                                 |
| release-please config and CI workflows (mirroring the official AXIs)                                                  | done (CI green; release needs Actions PR permission) |
| Verified against a real TickTick account                                                                              | not done (out of scope here, by design)              |
| Public GitHub repo created and pushed                                                                                 | done                                                 |
| npm package published                                                                                                 | not done                                             |
| Release tagged                                                                                                        | not done                                             |
| no-mistakes installed and `init --fork-url` run                                                                       | not done                                             |
| axi fork, catalog entry, `pnpm run docs:gen`, `git push no-mistakes`                                                  | not done                                             |
| Independent admission review                                                                                          | not done (reviewer's step)                           |

## Uncertain (verify with a real account before submitting)

- Whether `POST /open/v1/task/filter` with no `projectIds` returns tasks from all projects including the Inbox (the docs list every field as a filter but do not say what omitting `projectIds` does).
- Whether `POST /open/v1/task/{taskId}` treats omitted fields as unchanged (ticktick-axi sends only changed fields plus `id`/`projectId`, as the docs mark the rest optional).
- Whether the token response includes `expires_in` (the docs only show `access_token`).
- Whether TickTick accepts `http://localhost:8765/callback` as a registered redirect URI exactly as written.
- Whether `POST https://api.ticktick.com/oauth/revoke` accepts multipart form data as documented.

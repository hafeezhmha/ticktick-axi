<h1 align="center">ticktick-axi</h1>

<p align="center">
  <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue?style=flat-square" />
  <a href="https://opensource.org/licenses/MIT"><img alt="License" src="https://img.shields.io/badge/license-MIT-green?style=flat-square" /></a>
</p>

TickTick CLI for agents, designed with [AXI](https://github.com/kunchenguid/axi) (Agent eXperience Interface).

It talks to the **official [TickTick Open API](https://developer.ticktick.com/docs#/openapi)** only, and prints token-efficient [TOON](https://toonformat.dev/) with next-step hints and structured errors. Reads are free; every write (`create`, `edit`, `complete`) is a dry run until you add `--yes`, so an agent can show the person exactly what will change before anything is sent.

```
$ ticktick-axi
bin: ~/.npm-global/bin/ticktick-axi
description: Agent ergonomic CLI for TickTick tasks via the official Open API. Read freely; writes are dry runs until --yes.
today: 2026-10-09 (Asia/Kolkata)
summary:
  open: 6
  overdue: 2
  due_today: 1
  next_7_days: 1
  no_due_date: 1
overdue[2]{id,projectId,title,due}:
  a00000000000000000000001,6226ff9877acee87727f6bca,Pay electricity bill,2026-10-08
  a00000000000000000000003,6226ff9877acee87727f6bcb,Morning pages,"2026-10-09 09:00"
due_today[1]{id,projectId,title,due}:
  a00000000000000000000002,6226ff9877acee87727f6bca,Team sync,"2026-10-09 16:00"
help[3]: Run `ticktick-axi upcoming --days 7` for the week ahead,Run `ticktick-axi task <projectId> <taskId>` for details,Run `ticktick-axi complete <projectId> <taskId>` to preview completing one
```

(All examples in this README use made-up ids and tasks.)

## Contents

- [Install](#install)
- [Sign in](#sign-in)
- [Configuration](#configuration)
- [Commands](#commands)
- [Write gating](#write-gating)
- [Limitations of the official API](#limitations-of-the-official-api)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Development](#development)

## Install

Node 20 or newer.

**Agent skill** (on-demand, works in any agent that reads [Agent Skills](https://agentskills.io)):

```sh
npx skills add hafeezhmha/ticktick-axi --skill ticktick-axi -g
```

The skill runs the CLI through `npx -y ticktick-axi`, so no global install is needed.

**Global CLI:**

```sh
npm install -g ticktick-axi
```

**From a local clone** (to hack on it):

```sh
git clone https://github.com/hafeezhmha/ticktick-axi.git
cd ticktick-axi
pnpm install
pnpm run build
pnpm link --global      # or: npm install -g .
ticktick-axi --version
```

**Session hook** (optional ambient context): `ticktick-axi setup hooks` installs a `SessionStart` hook for Claude Code, Codex and OpenCode that shows overdue and due-today tasks at the start of every session. It makes one read call per session. Remove it with `ticktick-axi setup hooks --remove`. You need the hook or the skill, not both.

## Sign in

The quickest way is the guided setup. Run it in your own terminal (an agent can't run it for you; it exits with a note saying so):

```sh
npx -y ticktick-axi auth setup
```

It tells you how to create the TickTick app and which field takes the redirect URL, asks for the Client ID and the Client Secret (typing hidden, stray spaces removed), saves them to `config.json` with permissions 600, and signs you in. Run it again any time; it offers the saved credentials first. `--no-login` saves them without signing in.

The two ways it automates, by hand, follow. Both store the token in your config directory (see [Security](#security)).

### Option A: OAuth (recommended for apps; documented flow)

1. Open the [TickTick Developer Center](https://developer.ticktick.com/manage) and sign in with your TickTick account.
2. Create a new app ("Manage Apps" > "+App Name"). Any name works, e.g. `ticktick-axi (personal)`.
3. Open the app and set **OAuth redirect URL** (not "App Service URL", which is the app's homepage) to exactly:

   ```
   http://localhost:8765/callback
   ```

   (To use another loopback port or path, register that instead and set `TICKTICK_REDIRECT_URI` to the same value.)

4. Copy the **Client ID** and **Client Secret** and give them to ticktick-axi, either as environment variables:

   ```sh
   export TICKTICK_CLIENT_ID='<client id>'
   export TICKTICK_CLIENT_SECRET='<client secret>'
   ```

   or in `~/.config/ticktick-axi/config.json` (create it yourself, then `chmod 600` it):

   ```json
   { "clientId": "<client id>", "clientSecret": "<client secret>" }
   ```

5. Run:

   ```sh
   ticktick-axi auth login
   ```

   It prints the authorize URL to stderr and waits (up to 300 s, `--timeout` to change) for TickTick to redirect back to `http://localhost:8765/callback`. Open the URL, choose **Allow**, and the command finishes with:

   ```
   auth: signed in (OAuth)
   stored: ~/.config/ticktick-axi/token.json (permissions 600)
   scope: "tasks:read tasks:write"
   expires: "2027-04-07T06:29:59.000Z"
   help[1]: Run `ticktick-axi` to see what is due
   ```

**Headless / agent-driven variant.** The loopback wait blocks, so an agent (or a remote shell with no local browser) can split it into two non-blocking steps:

```sh
ticktick-axi auth login --no-wait
# prints authorize_url; open it anywhere and choose Allow.
# The browser is sent to http://localhost:8765/callback?code=...&state=...
# If that page fails to load, that is fine: copy the full address.
ticktick-axi auth login --callback-url 'http://localhost:8765/callback?code=...&state=...'
```

The `state` is checked against the pending attempt (stored 0600, valid for 15 minutes).

### Option B: personal API token

TickTick also documents a personal token for personal use: in the [web app](https://ticktick.com/webapp/), avatar > **Settings** > **Account** > **API Token**. Create it, save it to a file, and pipe it in (never as an argument, which would land in shell history):

```sh
ticktick-axi auth login --token-stdin < token.txt && rm token.txt
```

### Environment override

`TICKTICK_ACCESS_TOKEN`, when set, is used instead of the stored token (handy for CI or a secrets manager).

### Check and sign out

```sh
ticktick-axi auth status            # where the token comes from, scope, expiry, file permissions
ticktick-axi auth status --verify   # plus one read call to confirm TickTick accepts it
ticktick-axi auth logout            # delete the stored token (idempotent)
ticktick-axi auth logout --revoke   # revoke it at TickTick first (POST /oauth/revoke)
```

## Configuration

| Variable                                          | Purpose                                                                                                        |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `TICKTICK_CLIENT_ID`, `TICKTICK_CLIENT_SECRET`    | OAuth app credentials (override `config.json`)                                                                 |
| `TICKTICK_REDIRECT_URI`                           | Redirect URI registered for your app (default `http://localhost:8765/callback`)                                |
| `TICKTICK_ACCESS_TOKEN`                           | Use this token instead of the stored one                                                                       |
| `TICKTICK_AXI_TZ`                                 | IANA time zone for "today", overdue and date input (default: system zone)                                      |
| `TICKTICK_AXI_CONFIG_DIR`                         | Where `token.json` / `config.json` live                                                                        |
| `TICKTICK_AXI_API_BASE`, `TICKTICK_AXI_AUTH_BASE` | Point at another host, e.g. `https://api.dida365.com/open/v1` and `https://dida365.com` for Dida365 (untested) |

Config directory: `$XDG_CONFIG_HOME/ticktick-axi` or `~/.config/ticktick-axi` on Linux and macOS, `%APPDATA%\ticktick-axi` on Windows.

**Dates** accept `YYYY-MM-DD` (all-day), `YYYY-MM-DDTHH:mm` (timed, in your zone), an ISO time with `Z` or an offset, `today`, `tomorrow`, `yesterday`, or `+Nd` / `-Nd`.

**Time zones.** "Today", overdue and upcoming are judged in `TICKTICK_AXI_TZ` (or the system zone). An all-day task's calendar date is read in the task's own `timeZone`, so a task due "Oct 10" stays due Oct 10 wherever you are. Writes send dates in UTC (`+0000`, TickTick's documented `yyyy-MM-dd'T'HH:mm:ssZ` format) together with `timeZone`. An all-day `--due 2026-11-01` is sent as local midnight of that day.

## Commands

Every command has `--help`. Exit codes: `0` success (including no-ops), `1` error, `2` usage error. Errors are printed on stdout in the same TOON format, with a `code` and `help`.

| Command                                         | What it does                                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| _(no args)_                                     | Home: counts, overdue and due-today tasks                                                                      |
| `projects [--closed]`                           | Projects with id, name, kind                                                                                   |
| `tasks [flags]`                                 | Tasks across projects or one, soonest due first                                                                |
| `task <projectId> <taskId> [--full]`            | One task in detail                                                                                             |
| `overdue [flags]`                               | Open tasks whose due date/time has passed                                                                      |
| `upcoming [--days N] [flags]`                   | Open tasks due from now through today+N (default 7)                                                            |
| `create "<title>" --project <id> [...] [--yes]` | Create a task (dry run without `--yes`)                                                                        |
| `edit <projectId> <taskId> [...] [--yes]`       | Change a task (dry run without `--yes`)                                                                        |
| `complete <projectId> <taskId> [--yes]`         | Complete a task (dry run without `--yes`)                                                                      |
| `auth login\|status\|logout`                    | Sign in and out                                                                                                |
| `setup hooks [--project] [--remove\|--status]`  | Opt-in session hook                                                                                            |
| `update [--check]`                              | Upgrade ticktick-axi itself (axi-sdk-js built-in); task-shaped arguments are rejected with a pointer to `edit` |

`tasks`, `overdue` and `upcoming` share these flags: `--project <id>` (`inbox` for the Inbox), `--priority none|low|medium|high` (comma-separated for several), `--tag <tag>` (repeatable; all must match), `--limit <n>` (default 100, max 500), `--fields <list>` (extra columns: `projectId, priority, status, tags, start, allDay, repeat, completed, kind, items, content`), `--full` (no title truncation). `tasks` adds `--status open|completed|abandoned|all`, `--due-before <date>`, `--due-after <date>` (both exclusive), `--overdue` and `--upcoming <days>`.

### projects

```
$ ticktick-axi projects
count: 2 of 2 total
projects[2]{id,name,kind}:
  6226ff9877acee87727f6bca,Work,task
  6226ff9877acee87727f6bcb,Home,task
help[2]: Run `ticktick-axi tasks --project <id>` to list a project's open tasks,Run `ticktick-axi tasks --project inbox` for the Inbox (not listed above)
```

### tasks

```
$ ticktick-axi tasks --limit 3
count: 3 of 6 open tasks
timezone: Asia/Kolkata
tasks[3]{id,projectId,title,due}:
  a00000000000000000000001,6226ff9877acee87727f6bca,Pay electricity bill,2026-10-08
  a00000000000000000000003,6226ff9877acee87727f6bcb,Morning pages,"2026-10-09 09:00"
  a00000000000000000000002,6226ff9877acee87727f6bca,Team sync,"2026-10-09 16:00"
help[3]: Run `ticktick-axi tasks --limit 6` to see all 6,Run `ticktick-axi task <projectId> <taskId>` for full details,Run `ticktick-axi complete <projectId> <taskId>` to preview completing one

$ ticktick-axi tasks --project 6226ff9877acee87727f6bca
count: 3 of 3 open tasks in project 6226ff9877acee87727f6bca
timezone: Asia/Kolkata
tasks[3]{id,title,due,priority}:
  a00000000000000000000001,Pay electricity bill,2026-10-08,high
  a00000000000000000000002,Team sync,"2026-10-09 16:00",medium
  a00000000000000000000006,Book flights,2026-12-01,medium
help[2]: Run `ticktick-axi task 6226ff9877acee87727f6bca <taskId>` for full details,Run `ticktick-axi complete 6226ff9877acee87727f6bca <taskId>` to preview completing one

$ ticktick-axi tasks --overdue --tag work
tasks: 0 overdue open tasks tagged work found
help[2]: "Run `ticktick-axi create \"<title>\" --project <projectId>` to preview adding a task",Run `ticktick-axi tasks` to list all open tasks
```

### overdue / upcoming

```
$ ticktick-axi overdue
count: 2 of 2 overdue open tasks
timezone: Asia/Kolkata
tasks[2]{id,projectId,title,due}:
  a00000000000000000000001,6226ff9877acee87727f6bca,Pay electricity bill,2026-10-08
  a00000000000000000000003,6226ff9877acee87727f6bcb,Morning pages,"2026-10-09 09:00"
help[2]: Run `ticktick-axi task <projectId> <taskId>` for full details,Run `ticktick-axi complete <projectId> <taskId>` to preview completing one

$ ticktick-axi upcoming --days 7
count: 2 of 2 open tasks due in the next 7 days
timezone: Asia/Kolkata
tasks[2]{id,projectId,title,due}:
  a00000000000000000000002,6226ff9877acee87727f6bca,Team sync,"2026-10-09 16:00"
  a00000000000000000000004,6226ff9877acee87727f6bcb,Renew passport,2026-10-12
help[2]: Run `ticktick-axi task <projectId> <taskId>` for full details,Run `ticktick-axi complete <projectId> <taskId>` to preview completing one
```

An all-day task is overdue from the day after its date; a timed task is overdue once its time has passed.

### task

```
$ ticktick-axi task 6226ff9877acee87727f6bca a00000000000000000000001
task:
  id: a00000000000000000000001
  projectId: 6226ff9877acee87727f6bca
  title: Pay electricity bill
  status: open
  priority: high
  due: 2026-10-08 (all day)
  overdue: true
  tags: home
  repeat: FREQ=MONTHLY;INTERVAL=1
  timeZone: Asia/Kolkata
  content: Due on the 8th. Pay via the app.
  checklist: 1/2 done
  items[2]{title,done}:
    Find bill,true
    Pay,false
help[2]: Run `ticktick-axi complete 6226ff9877acee87727f6bca a00000000000000000000001` to preview completing it,Run `ticktick-axi edit 6226ff9877acee87727f6bca a00000000000000000000001 --due <date>` to preview a change
```

Content over 1000 characters and checklists over 20 items are truncated with a size note and a `--full` hint.

### create / edit / complete

```
$ ticktick-axi create "Pay rent" --project 6226ff9877acee87727f6bca --due 2026-11-01 --priority high
dry_run: nothing was sent
would_create:
  title: Pay rent
  projectId: 6226ff9877acee87727f6bca
  due: 2026-11-01 (all day)
  priority: high
help[1]: Run `ticktick-axi create 'Pay rent' --project 6226ff9877acee87727f6bca --due 2026-11-01 --priority high --yes` to create it (only after the person confirms)

$ ticktick-axi create "Pay rent" --project 6226ff9877acee87727f6bca --due 2026-11-01 --priority high --yes
created:
  id: 6705f0c2e4b0a1b2c3d4e5f6
  projectId: 6226ff9877acee87727f6bca
  title: Pay rent
  due: 2026-11-01
help[2]: Run `ticktick-axi task 6226ff9877acee87727f6bca 6705f0c2e4b0a1b2c3d4e5f6` to view it,Run `ticktick-axi complete 6226ff9877acee87727f6bca 6705f0c2e4b0a1b2c3d4e5f6` to preview completing it

$ ticktick-axi edit 6226ff9877acee87727f6bca a00000000000000000000001 --due tomorrow --priority medium
dry_run: nothing was sent
task:
  id: a00000000000000000000001
  title: Pay electricity bill
changes[2]{field,from,to}:
  priority,high,medium
  due,2026-10-08,2026-10-10 (all day)
help[1]: Run `ticktick-axi edit 6226ff9877acee87727f6bca a00000000000000000000001 --due tomorrow --priority medium --yes` to apply it (only after the person confirms)

$ ticktick-axi complete 6226ff9877acee87727f6bca a00000000000000000000001
dry_run: nothing was sent
task:
  id: a00000000000000000000001
  title: Pay electricity bill
would_change: "status: open -> completed"
note: "repeating task (FREQ=MONTHLY;INTERVAL=1): TickTick completes this occurrence and schedules the next"
help[1]: Run `ticktick-axi complete 6226ff9877acee87727f6bca a00000000000000000000001 --yes` to complete it (only after the person confirms)

$ ticktick-axi complete 6226ff9877acee87727f6bca a00000000000000000000001 --yes
completed:
  id: a00000000000000000000001
  title: Pay electricity bill
note: "repeating task: the next occurrence is scheduled by TickTick"
help[1]: Run `ticktick-axi tasks --project 6226ff9877acee87727f6bca` to see what's left in this project
```

`create` flags: `--project <id>` (required), `--due`, `--start`, `--priority`, `--tag` (repeatable), `--content`, `--yes`. `edit` flags: `--title`, `--due`, `--start`, `--priority`, `--tag` (replaces tags), `--content`, `--yes`; it sends only the changed fields plus `id`/`projectId`.

### Errors

```
$ ticktick-axi tasks --stat open
error: unknown flag --stat for `tasks`
code: VALIDATION_ERROR
help[1]: "valid flags for `tasks`: --overdue, --full, --project, --priority, --limit, --fields, --status, --due-before, --due-after, --upcoming, --tag (--help always allowed)"

$ ticktick-axi tasks
error: Not signed in to TickTick
code: AUTH_REQUIRED
help[2]: Run `ticktick-axi auth login` (OAuth) or `ticktick-axi auth login --token-stdin` (personal API token),Or export TICKTICK_ACCESS_TOKEN
```

| Code                           | Meaning                                                                        | Exit |
| ------------------------------ | ------------------------------------------------------------------------------ | ---- |
| `VALIDATION_ERROR`             | Bad flag, argument, id, date or priority; nothing was sent                     | 2    |
| `AUTH_REQUIRED`                | No token configured                                                            | 1    |
| `TOKEN_EXPIRED`                | TickTick returned 401, or the stored expiry has passed                         | 1    |
| `FORBIDDEN`                    | 403: missing `tasks:read`/`tasks:write` scope or no permission on that project | 1    |
| `NOT_FOUND`                    | 404: wrong project/task id pair                                                | 1    |
| `RATE_LIMITED`                 | 429 after retries (reads) or immediately (writes)                              | 1    |
| `NETWORK_ERROR`                | TickTick unreachable (reads, after retries)                                    | 1    |
| `WRITE_UNCERTAIN`              | Network failure while sending a write; check before retrying                   | 1    |
| `API_ERROR`                    | Other 4xx/5xx or a malformed response                                          | 1    |
| `OAUTH_ERROR` / `CONFIG_ERROR` | Sign-in failed / local configuration problem                                   | 1    |

## Write gating

- `create`, `edit` and `complete` never write without `--yes`. Without it they print `dry_run: nothing was sent`, what would change, and the exact command to confirm with. The CLI never prompts; the agent relays the dry run and adds `--yes` only after the person says yes. The bundled skill says so.
- Already-true states are no-ops with exit 0: completing a completed task, or an edit whose values are already in place.
- There is no `delete` command, on purpose.
- **Retries.** Reads (GETs and the query-only `POST /task/filter`) retry up to 3 times on 429 and 5xx and on network failures, with exponential backoff (0.5 s, 1 s, 2 s) or the server's `Retry-After` when it is 30 s or less. Writes are never retried automatically: a timed-out create may already have landed. A 429 on a write means it was rejected and is safe to rerun later; a network failure during a write is reported as `WRITE_UNCERTAIN`.

## Limitations of the official API

Facts below come from the [Open API docs](https://developer.ticktick.com/docs#/openapi) as of October 2026. ticktick-axi uses no undocumented endpoints.

- **Endpoints used:** `GET /open/v1/project`, `GET /open/v1/project/{projectId}/data`, `GET /open/v1/project/{projectId}/task/{taskId}`, `POST /open/v1/task/filter`, `POST /open/v1/task`, `POST /open/v1/task/{taskId}`, `POST /open/v1/project/{projectId}/task/{taskId}/complete`, plus `https://ticktick.com/oauth/authorize`, `https://ticktick.com/oauth/token` and `POST https://api.ticktick.com/oauth/revoke`.
- **Tasks are addressed by project id + task id.** That is why `task`, `edit` and `complete` take both.
- **Cross-project listing** uses `POST /task/filter`, which is documented to return at most 200 tasks. When a result hits 200, output carries a `note`; narrow with `--project`, `--priority` or `--tag`. A single project's open tasks come from `/project/{id}/data`, which has no documented cap.
- **The filter endpoint filters dates on `startDate`, not `dueDate`**, so all due-date filtering (`--due-before`, `--overdue`, `--upcoming`) happens locally.
- **Inbox.** `GET /project` does not list the Inbox, and the docs only mention an `inbox` alias for `/task/undone` and `/task/completeTasks`. `--project inbox` therefore filters `/task/filter` results to tasks whose `projectId` starts with `inbox`; `create` needs the inbox's real id (e.g. `inbox123456789`, visible in `tasks --project inbox`).
- **Token lifetime and refresh** are not documented. The token endpoint lists only `grant_type=authorization_code`, so there is no automatic refresh: when TickTick rejects the token you get `TOKEN_EXPIRED` and sign in again. If the token response includes `expires_in`, the expiry is stored and shown by `auth status`. (Some community clients try a `refresh_token` grant; it is not documented, so ticktick-axi does not.)
- **Rate limits are not documented.** 429 is handled anyway, honouring `Retry-After`.
- **Scopes:** `tasks:read tasks:write`, both requested.
- **Not covered (yet):** moving tasks between projects, clearing a due date, subtask (checklist item) edits, tags/habits/focus endpoints. The docs describe Update Task fields as optional but do not say how to clear one.

## Troubleshooting

| Symptom                                     | Fix                                                                                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_REQUIRED`                             | Run `ticktick-axi auth login`, or `auth login --token-stdin`, or set `TICKTICK_ACCESS_TOKEN`.                                                       |
| `TOKEN_EXPIRED`                             | The token expired or was revoked: `ticktick-axi auth login` again (or replace `TICKTICK_ACCESS_TOKEN`).                                             |
| `FORBIDDEN`                                 | Sign in again and allow both permissions; check you can edit that project in TickTick.                                                              |
| Browser shows "redirect_uri mismatch"       | The URI registered at developer.ticktick.com must equal `TICKTICK_REDIRECT_URI` (default `http://localhost:8765/callback`) character for character. |
| `Port 8765 is already in use`               | Free the port, or register a different loopback URI and set `TICKTICK_REDIRECT_URI`.                                                                |
| `auth login` hangs in an agent or over SSH  | Use `auth login --no-wait`, open the URL anywhere, then `auth login --callback-url '<url>'`.                                                        |
| Due dates look a day off                    | Set `TICKTICK_AXI_TZ` to your zone (e.g. `Asia/Kolkata`).                                                                                           |
| A list has a `note` about 200 tasks         | The filter endpoint's cap; add `--project`, `--priority` or `--tag`.                                                                                |
| `WRITE_UNCERTAIN`                           | Look before retrying: `ticktick-axi task <projectId> <taskId>` or `tasks --project <id>`.                                                           |
| `auth status` says permissions are too open | `chmod 600 ~/.config/ticktick-axi/token.json`                                                                                                       |

## Security

- **Where the token lives:** `token.json` in the config directory above. The directory is created `0700` and the file written `0600` (atomically, via a temp file and rename). `auth status` reports the permissions and warns if they are looser. On Windows, the file inherits your user profile's ACLs.
- **What is stored:** the access token, its kind (OAuth or personal), scope, when it was obtained and, if TickTick reported one, its expiry. The client secret is never written by ticktick-axi; a refresh token, if one is ever returned, is not stored.
- **Never printed:** no command prints the token or client secret; `auth status` says `present (never printed)`. TickTick error bodies are reduced to a short message with the token redacted. A test runs every command against API responses that echo the token in error bodies and checks it never reaches output.
- **Never as an argument:** `--token` is rejected with a pointer to `--token-stdin`, so tokens do not land in shell history or process lists.
- **Only to TickTick:** the token is sent only as an `Authorization: Bearer` header to the API host (or your `TICKTICK_AXI_API_BASE`). OAuth uses a random `state` and ignores redirects with the wrong one; the loopback listener binds to loopback addresses only and stops after one successful redirect or the timeout.
- **Ids are validated** (`[A-Za-z0-9_-]`, at most 64 characters) before they are placed in a URL path.
- `.gitignore` excludes `token.json`, `config.json` and `oauth-pending.json` in case someone points the config directory into a repo.

## Development

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run build:skill -- --check   # SKILL.md must match src/skill.ts
pnpm run lint
pnpm run format:check
pnpm test                          # vitest + coverage; fully offline (fetch is mocked)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [VISION.md](VISION.md) for what belongs here. Built with [`axi-sdk-js`](https://github.com/kunchenguid/axi/tree/main/packages/axi-sdk-js) for dispatch, TOON output, structured errors, `--version` fast path and session hooks.

## License

[MIT](LICENSE)

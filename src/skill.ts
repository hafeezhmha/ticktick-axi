// Single source of truth for skills/ticktick-axi/SKILL.md.
// `scripts/build-skill.ts` writes this out and (with --check) fails CI on
// drift, so the installable skill never diverges from the CLI's own guidance.
import { DESCRIPTION, TOP_HELP } from "./cli.js";

export const SKILL_NAME = "ticktick-axi";

export const SKILL_DESCRIPTION =
  "Read and manage TickTick tasks through the ticktick-axi CLI: see what is overdue or due today, list projects and tasks, filter by due date, priority or tag, view a task, and create, edit or complete tasks (dry run first, applied only with --yes after the person confirms). " +
  "Use whenever a task touches TickTick: to-dos, reminders, deadlines, what is on someone's plate, or adding or ticking off a task.";

/** The CLI's own help with commands rewritten for npx (no global install). */
function npxHelp(): string {
  return TOP_HELP.replace(/`ticktick-axi /g, "`npx -y ticktick-axi ").replace(
    /^ {2}ticktick-axi/gm,
    "  npx -y ticktick-axi",
  );
}

export function createSkillMarkdown(): string {
  return `---
name: ${SKILL_NAME}
description: "${SKILL_DESCRIPTION}"
user-invocable: false
author: hafeezhmha
metadata:
  hermes:
    tags: [ticktick, tasks, todo, reminders, productivity]
    category: productivity
---

# ticktick-axi

${DESCRIPTION}

You do not need ticktick-axi installed globally: invoke it with \`npx -y ticktick-axi <command>\`.
If output shows a follow-up command starting with \`ticktick-axi\`, run it as \`npx -y ticktick-axi ...\`.

## Sign-in (the person does this once)

ticktick-axi uses TickTick's official Open API. If a command fails with \`AUTH_REQUIRED\` or \`TOKEN_EXPIRED\`, ask the person to sign in; never ask them to paste a token into the chat.

- Easiest: ask the person to run \`npx -y ticktick-axi auth setup\` in their own terminal. It walks them through creating the TickTick app, takes the Client ID and secret (hidden), saves them and signs in. Never run \`auth setup\` yourself: it only works at a terminal and exits 2 for an agent.
- OAuth by hand: register an app at https://developer.ticktick.com/manage with its "OAuth redirect URL" set to \`http://localhost:8765/callback\`, export \`TICKTICK_CLIENT_ID\` and \`TICKTICK_CLIENT_SECRET\`, then run \`npx -y ticktick-axi auth login\` in their own terminal and approve in the browser.
- Personal API token: TickTick web > Settings > Account > API Token, then \`npx -y ticktick-axi auth login --token-stdin < token.txt\`.

## Workflow

1. Run \`npx -y ticktick-axi\` with no arguments: overdue tasks, today's tasks, and counts.
2. \`projects\` lists project ids. The Inbox is not listed by the API; use \`--project inbox\`.
3. \`tasks\` lists open tasks soonest-due first; narrow with \`--project <id>\`, \`--overdue\`, \`--upcoming <days>\`, \`--due-before/--due-after <date>\`, \`--priority\`, \`--tag\`, \`--status\`. \`overdue\` and \`upcoming [--days N]\` are shortcuts.
4. \`task <projectId> <taskId>\` shows one task; both ids come from list output.
5. Writes are gated. \`create\`, \`edit\` and \`complete\` without \`--yes\` print a dry run and send nothing. Show the dry run to the person, and rerun with \`--yes\` only after they say yes. Never add \`--yes\` on your own.
6. Every response ends with next-step hints under \`help\`: follow them.

## Commands

\`\`\`
${npxHelp()}\`\`\`

Run \`npx -y ticktick-axi <command> --help\` for per-command flags and examples.

## Tips

- Dates: YYYY-MM-DD (all-day), YYYY-MM-DDTHH:mm (timed, in the person's zone), today, tomorrow, +3d. The zone is TICKTICK_AXI_TZ or the system zone.
- Cross-project lists use an endpoint capped at 200 tasks; when output carries a \`note\` about the cap, narrow with \`--project\`, \`--priority\` or \`--tag\`.
- \`complete\` on a completed task, and \`edit\` with values already in place, are no-ops (exit 0).
- There is no delete command, by design.
- Exit codes: 0 success, 1 error, 2 usage. Errors are structured with \`error\`, \`code\`, and \`help\`. A \`WRITE_UNCERTAIN\` error means check the task before retrying.
`;
}

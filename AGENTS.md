# Agent instructions

Use `ticktick-axi` for TickTick: what is overdue or due today, projects, task lists filtered by due date, priority or tag, one task's details, and creating, editing or completing tasks.

- Run `ticktick-axi` (no args) for overdue and due-today tasks with counts; `ticktick-axi --help` for commands; `<command> --help` for flags.
- Auth: the person signs in once with `ticktick-axi auth login` (OAuth, needs `TICKTICK_CLIENT_ID`/`TICKTICK_CLIENT_SECRET`) or `auth login --token-stdin` (personal API token). `TICKTICK_ACCESS_TOKEN` overrides. Never ask for a token in chat.
- Tasks are addressed by `<projectId> <taskId>`; both appear in list output. The Inbox is `--project inbox` for listing.
- Writes are gated: `create`, `edit` and `complete` print a dry run and send nothing until `--yes`. Show the dry run to the person and add `--yes` only after they confirm.
- Output is TOON on stdout. Exit codes: 0 success (including no-ops), 1 error, 2 usage. Errors carry `code` and `help`; `WRITE_UNCERTAIN` means check the task before retrying.
- Cross-project lists come from an endpoint capped at 200 tasks; a `note` says when the cap was hit. Narrow with `--project`, `--priority` or `--tag`.

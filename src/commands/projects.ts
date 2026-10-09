import { bool, parseArgs } from "../args.js";
import { api, getClient } from "../api.js";
import { usage } from "../errors.js";

export const PROJECTS_HELP = `usage: ticktick-axi projects [--closed]
Lists your TickTick projects (lists): id, name, kind.
The Inbox is not returned by the Open API's project list; use \`--project inbox\` with \`tasks\`.
flags:
  --closed   include closed (archived) projects
examples:
  ticktick-axi projects
  ticktick-axi projects --closed
`;

export async function projectsCommand(args: string[]) {
  const p = parseArgs(args, { bool: ["closed"] }, "projects");
  if (p.positionals.length) {
    throw usage(
      `unexpected argument "${p.positionals[0]}"`,
      "Run `ticktick-axi tasks --project <projectId>` to list a project's tasks",
    );
  }
  const includeClosed = bool(p, "closed");
  const all = (await api.listProjects(getClient())) ?? [];
  const closedCount = all.filter((x) => x.closed).length;
  const shown = includeClosed ? all : all.filter((x) => !x.closed);

  if (shown.length === 0) {
    return {
      projects: includeClosed
        ? "0 projects found"
        : `0 open projects found${closedCount ? ` (${closedCount} closed hidden)` : ""}`,
      help: [
        "Run `ticktick-axi tasks --project inbox` to list Inbox tasks",
        ...(closedCount && !includeClosed
          ? ["Run `ticktick-axi projects --closed` to include closed projects"]
          : []),
      ],
    };
  }

  const rows = shown.map((x) => ({
    id: x.id,
    name: x.name ?? "",
    kind: (x.kind ?? "TASK").toLowerCase(),
    ...(includeClosed ? { closed: !!x.closed } : {}),
  }));
  const help = [
    "Run `ticktick-axi tasks --project <id>` to list a project's open tasks",
    "Run `ticktick-axi tasks --project inbox` for the Inbox (not listed above)",
  ];
  if (closedCount && !includeClosed) {
    help.push(
      `Run \`ticktick-axi projects --closed\` to include ${closedCount} closed`,
    );
  }
  return {
    count: `${rows.length} of ${all.length} total`,
    projects: rows,
    help,
  };
}

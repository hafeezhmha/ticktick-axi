import { getClient, type Task } from "../api.js";
import { readToken } from "../config.js";
import {
  addDays,
  dateKey,
  dueInfo,
  isOverdue,
  userTimeZone,
} from "../dates.js";
import { taskRow } from "../format.js";
import { fetchTasks, sortTasks } from "../query.js";

const TOP = 5;

/** Content-first home view: what is overdue, due today, and coming up. */
export async function homeCommand() {
  if (!readToken()) {
    return {
      status: "not signed in to TickTick",
      setup: [
        "1. Register an app at https://developer.ticktick.com/manage with redirect URI http://localhost:8765/callback",
        "2. export TICKTICK_CLIENT_ID=<id> TICKTICK_CLIENT_SECRET=<secret>",
        "3. Run `ticktick-axi auth login` and open the printed URL",
        "Or: pipe a personal API token (TickTick > Settings > Account > API Token) into `ticktick-axi auth login --token-stdin`",
      ],
      help: ["Run `ticktick-axi --help` to see all commands"],
    };
  }

  const tz = userTimeZone();
  const now = Date.now();
  const today = dateKey(now, tz);
  const weekEnd = addDays(today, 7);
  const { tasks, capped } = await fetchTasks(getClient(), {
    statusName: "open",
    statusCodes: [0],
  });

  const overdue: Task[] = [];
  const dueToday: Task[] = [];
  let nextWeek = 0;
  let undated = 0;
  for (const t of tasks) {
    const info = dueInfo(t, tz);
    if (!info) {
      undated++;
      continue;
    }
    if (isOverdue(info, tz, now)) overdue.push(t);
    else if (info.key === today) dueToday.push(t);
    else if (info.key <= weekEnd) nextWeek++;
  }

  const row = (t: Task) =>
    taskRow(t, {
      tz,
      base: ["id", "projectId", "title", "due"],
      extra: [],
      full: false,
    });
  const out: Record<string, unknown> = {
    today: `${today} (${tz})`,
    summary: {
      open: tasks.length,
      overdue: overdue.length,
      due_today: dueToday.length,
      next_7_days: nextWeek,
      no_due_date: undated,
    },
  };
  if (capped) {
    out.note =
      "TickTick's filter endpoint returns at most 200 tasks; counts may be incomplete";
  }
  if (tasks.length === 0) {
    out.tasks = "0 open tasks: nothing to do";
    out.help = [
      'Run `ticktick-axi create "<title>" --project <projectId>` to preview adding a task',
      "Run `ticktick-axi projects` to list project ids",
    ];
    return out;
  }
  out.overdue = overdue.length
    ? sortTasks(overdue, tz).slice(0, TOP).map(row)
    : "none";
  out.due_today = dueToday.length
    ? sortTasks(dueToday, tz).slice(0, TOP).map(row)
    : "none";

  const help: string[] = [];
  if (overdue.length > TOP) {
    help.push(
      `Run \`ticktick-axi overdue\` to see all ${overdue.length} overdue`,
    );
  }
  help.push(
    "Run `ticktick-axi upcoming --days 7` for the week ahead",
    "Run `ticktick-axi task <projectId> <taskId>` for details",
    "Run `ticktick-axi complete <projectId> <taskId>` to preview completing one",
  );
  out.help = help;
  return out;
}

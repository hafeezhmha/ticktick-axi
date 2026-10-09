import { encode } from "@toon-format/toon";
import { runAxiCli } from "axi-sdk-js";
import { AUTH_HELP, authCommand } from "./commands/auth.js";
import { homeCommand } from "./commands/home.js";
import { PROJECTS_HELP, projectsCommand } from "./commands/projects.js";
import { SETUP_HELP, setupCommand } from "./commands/setup.js";
import { TASK_HELP, taskCommand } from "./commands/task.js";
import {
  OVERDUE_HELP,
  overdueCommand,
  TASKS_HELP,
  tasksCommand,
  UPCOMING_HELP,
  upcomingCommand,
} from "./commands/tasks.js";
import {
  COMPLETE_HELP,
  completeCommand,
  CREATE_HELP,
  createCommand,
  UPDATE_HELP,
  updateCommand,
} from "./commands/write.js";
import { VERSION } from "./version.js";

export const DESCRIPTION =
  "Agent ergonomic CLI for TickTick tasks via the official Open API. Read freely; writes are dry runs until --yes.";

export const TOP_HELP = `usage: ticktick-axi [command] [args] [flags]
commands[11]:
  (none)=home: overdue, due today, counts
  projects, tasks, task <projectId> <taskId>, overdue, upcoming
  create "<title>" --project <id>, update <projectId> <taskId>, complete <projectId> <taskId>
  auth login|status|logout, setup hooks
flags:
  --help (every command), -v/-V/--version
writes:
  create/update/complete are dry runs that send nothing until you add --yes
auth:
  OAuth: export TICKTICK_CLIENT_ID/TICKTICK_CLIENT_SECRET, then \`ticktick-axi auth login\`
  or a personal API token: \`ticktick-axi auth login --token-stdin < token.txt\`
  TICKTICK_ACCESS_TOKEN overrides the stored token
time zone: TICKTICK_AXI_TZ (IANA name) or the system zone
examples:
  ticktick-axi
  ticktick-axi tasks --project <projectId>
  ticktick-axi upcoming --days 3
  ticktick-axi create "Pay rent" --project <projectId> --due 2026-11-01
  ticktick-axi complete <projectId> <taskId> --yes
`;

const COMMAND_HELP: Record<string, string> = {
  auth: AUTH_HELP,
  projects: PROJECTS_HELP,
  tasks: TASKS_HELP,
  task: TASK_HELP,
  overdue: OVERDUE_HELP,
  upcoming: UPCOMING_HELP,
  create: CREATE_HELP,
  update: UPDATE_HELP,
  complete: COMPLETE_HELP,
  setup: SETUP_HELP,
};

const COMMANDS = {
  auth: authCommand,
  projects: projectsCommand,
  tasks: tasksCommand,
  task: taskCommand,
  overdue: overdueCommand,
  upcoming: upcomingCommand,
  create: createCommand,
  update: updateCommand,
  complete: completeCommand,
  setup: setupCommand,
};

export interface MainOptions {
  argv?: string[];
  stdout?: { write: (chunk: string) => unknown };
}

export async function main(options: MainOptions = {}): Promise<void> {
  await runAxiCli({
    ...(options.argv ? { argv: options.argv } : {}),
    ...(options.stdout ? { stdout: options.stdout } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    home: () => homeCommand(),
    commands: COMMANDS,
    getCommandHelp: (command) => COMMAND_HELP[command],
    renderUnknownCommand: (command) =>
      `${encode({
        error: `Unknown command: ${command}`,
        code: "VALIDATION_ERROR",
        help: [
          `Commands: ${Object.keys(COMMANDS).join(", ")}`,
          "Run `ticktick-axi --help` for usage",
        ],
      })}\n`,
  });
}

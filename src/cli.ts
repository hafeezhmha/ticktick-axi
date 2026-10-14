import { encode } from "@toon-format/toon";
import { runAxiCli } from "axi-sdk-js";
import {
  ASSIGN_HELP,
  assignCommand,
  UNASSIGN_HELP,
  unassignCommand,
} from "./commands/assign.js";
import { AUTH_HELP, authCommand } from "./commands/auth.js";
import { BATCH_HELP, batchCommand } from "./commands/batch.js";
import {
  COLUMN_HELP,
  columnCommand,
  COLUMNS_HELP,
  columnsCommand,
} from "./commands/columns.js";
import {
  COMMENT_HELP,
  commentCommand,
  COMMENTS_HELP,
  commentsCommand,
} from "./commands/comments.js";
import {
  GROUP_HELP,
  groupCommand,
  GROUPS_HELP,
  groupsCommand,
} from "./commands/groups.js";
import { homeCommand } from "./commands/home.js";
import { ITEM_HELP, itemCommand } from "./commands/items.js";
import { PROJECT_HELP, projectCommand } from "./commands/project.js";
import { PROJECTS_HELP, projectsCommand } from "./commands/projects.js";
import {
  COMPLETED_HELP,
  completedCommand,
  SEARCH_HELP,
  searchCommand,
} from "./commands/search.js";
import { selfUpdateCommand, UPDATE_HELP } from "./commands/self-update.js";
import { SETUP_HELP, setupCommand } from "./commands/setup.js";
import {
  TAG_HELP,
  tagCommand,
  TAGS_HELP,
  tagsCommand,
} from "./commands/tags.js";
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
  DELETE_HELP,
  deleteCommand,
  EDIT_HELP,
  editCommand,
  MOVE_HELP,
  moveCommand,
} from "./commands/write.js";
import { VERSION } from "./version.js";

export const DESCRIPTION =
  "Agent ergonomic CLI for TickTick tasks via the official Open API. Read freely; writes are dry runs until --yes.";

export const TOP_HELP = `usage: ticktick-axi [command] [args] [flags]
commands[29]:
  (none)=home: overdue, due today, counts
  projects, tasks, task <projectId> <taskId>, overdue, upcoming, completed, search "<keywords>"
  create "<title>" --project <id>, edit <projectId> <taskId>, complete <projectId> <taskId>...
  move <projectId> <taskId> --to <projectId>, delete <projectId> <taskId>, batch --file <json>
  item add|done|undo|rename|remove <projectId> <taskId> (checklist), comments, comment add|delete
  assign <projectId> <taskId> <username>, unassign <projectId> <taskId>
  project show|create|edit|delete|members, groups, group create|edit|delete
  columns <projectId>, column create|edit (kanban), tags, tag create
  auth setup|login|status|logout, setup hooks, update [--check] (upgrade ticktick-axi)
flags:
  --help (every command), -v/-V/--version
writes:
  every command that changes something is a dry run that sends nothing until you add --yes
auth:
  easiest: the person runs \`ticktick-axi auth setup\` in their own terminal (guided, then signs in)
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
  edit: EDIT_HELP,
  complete: COMPLETE_HELP,
  move: MOVE_HELP,
  delete: DELETE_HELP,
  item: ITEM_HELP,
  search: SEARCH_HELP,
  completed: COMPLETED_HELP,
  comments: COMMENTS_HELP,
  comment: COMMENT_HELP,
  project: PROJECT_HELP,
  groups: GROUPS_HELP,
  group: GROUP_HELP,
  columns: COLUMNS_HELP,
  column: COLUMN_HELP,
  tags: TAGS_HELP,
  tag: TAG_HELP,
  assign: ASSIGN_HELP,
  unassign: UNASSIGN_HELP,
  batch: BATCH_HELP,
  setup: SETUP_HELP,
  update: UPDATE_HELP,
};

const COMMANDS = {
  auth: authCommand,
  projects: projectsCommand,
  tasks: tasksCommand,
  task: taskCommand,
  overdue: overdueCommand,
  upcoming: upcomingCommand,
  create: createCommand,
  edit: editCommand,
  complete: completeCommand,
  move: moveCommand,
  delete: deleteCommand,
  item: itemCommand,
  search: searchCommand,
  completed: completedCommand,
  comments: commentsCommand,
  comment: commentCommand,
  project: projectCommand,
  groups: groupsCommand,
  group: groupCommand,
  columns: columnsCommand,
  column: columnCommand,
  tags: tagsCommand,
  tag: tagCommand,
  assign: assignCommand,
  unassign: unassignCommand,
  batch: batchCommand,
  setup: setupCommand,
};

export interface MainOptions {
  argv?: string[];
  stdout?: { write: (chunk: string) => unknown };
}

export async function main(options: MainOptions = {}): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  await runAxiCli({
    ...(options.argv ? { argv: options.argv } : {}),
    ...(options.stdout ? { stdout: options.stdout } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    home: () => homeCommand(),
    commands: {
      ...COMMANDS,
      update: (args: string[]) => selfUpdateCommand(args, stdout),
    },
    getCommandHelp: (command) => COMMAND_HELP[command],
    renderUnknownCommand: (command) =>
      `${encode({
        error: `Unknown command: ${command}`,
        code: "VALIDATION_ERROR",
        help: [
          `Commands: ${[...Object.keys(COMMANDS), "update"].join(", ")}`,
          "Run `ticktick-axi --help` for usage",
        ],
      })}\n`,
  });
}

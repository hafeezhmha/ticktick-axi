import {
  installSessionStartHooks,
  sessionStartHookStatus,
  uninstallSessionStartHooks,
} from "axi-sdk-js";
import { bool, parseArgs } from "../args.js";
import { usage } from "../errors.js";

export const SETUP_HELP = `usage: ticktick-axi setup hooks [--project] [--remove | --status]
Opt-in: install a session-start hook so Claude Code, Codex and OpenCode see
what is overdue and due today at the start of every session. Runs \`ticktick-axi\`
(the home view) once per session, which makes one read call to TickTick.
flags:
  --project   install for the current directory instead of your user config
  --remove    uninstall the hook
  --status    report whether it is installed (no writes)
examples:
  ticktick-axi setup hooks
  ticktick-axi setup hooks --status
  ticktick-axi setup hooks --remove
`;

const IDENTITY = { marker: "ticktick-axi", binaryNames: ["ticktick-axi"] };

export async function setupCommand(args: string[]) {
  const p = parseArgs(
    args,
    { bool: ["project", "remove", "status"] },
    "setup hooks",
  );
  if (p.positionals[0] !== "hooks" || p.positionals.length !== 1) {
    throw usage(
      "Unknown setup command",
      "Run `ticktick-axi setup hooks` to install agent session-start hooks",
    );
  }
  if (bool(p, "remove") && bool(p, "status")) {
    throw usage("--remove and --status cannot be combined");
  }
  const scope = bool(p, "project") ? "project" : "user";

  if (bool(p, "status")) {
    const s = sessionStartHookStatus({ ...IDENTITY, scope });
    return {
      hooks: {
        scope,
        claude: s.claude.installed,
        codex: s.codex.installed,
        opencode: s.opencode.installed,
      },
    };
  }
  if (bool(p, "remove")) {
    uninstallSessionStartHooks({ ...IDENTITY, scope });
    return { setup: `session-start hooks removed (${scope} scope)` };
  }
  installSessionStartHooks({ ...IDENTITY, scope });
  return {
    setup: `session-start hooks installed or already up to date (${scope} scope)`,
    help: ["Restart your agent session for the hook to take effect"],
  };
}

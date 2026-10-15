import {
  installSessionStartHooks,
  sessionStartHookStatus,
  uninstallSessionStartHooks,
} from "axi-sdk-js";
import { bool, parseArgs } from "../args.js";
import { fail, usage } from "../errors.js";

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

  // What is actually on disk, per agent: every result is re-read, never assumed.
  const read = () => {
    const s = sessionStartHookStatus({ ...IDENTITY, scope });
    return {
      claude: s.claude.installed,
      codex: s.codex.installed,
      opencode: s.opencode.installed,
    };
  };
  if (bool(p, "status")) return { hooks: { scope, ...read() } };

  const errors: string[] = [];
  const onError = (message: string) => errors.push(message);
  if (bool(p, "remove")) {
    uninstallSessionStartHooks({ ...IDENTITY, scope, onError });
    const left = Object.entries(read())
      .filter(([, on]) => on)
      .map(([a]) => a);
    if (left.length) {
      throw fail(
        "CONFIG_ERROR",
        `Session-start hook still installed for ${left.join(", ")} (${scope} scope)${errors.length ? `: ${errors.join("; ")}` : ""}`,
        "Fix the error above, then run `ticktick-axi setup hooks --remove` again",
        "Run `ticktick-axi setup hooks --status` to see each agent",
      );
    }
    const out: Record<string, unknown> = {
      setup: `session-start hooks removed (${scope} scope)`,
    };
    if (errors.length) out.errors = errors;
    return out;
  }

  installSessionStartHooks({ ...IDENTITY, scope, onError });
  const hooks = read();
  const on = Object.entries(hooks)
    .filter(([, v]) => v)
    .map(([a]) => a);
  if (on.length === 0) {
    throw fail(
      "CONFIG_ERROR",
      `No session-start hook was installed (${scope} scope)${errors.length ? `: ${errors.join("; ")}` : ""}`,
      "Hooks install only from an installed ticktick-axi: run `npx -y ticktick-axi setup hooks` or install it globally first",
      "Run `ticktick-axi setup hooks --status` to see each agent",
    );
  }
  const out: Record<string, unknown> = {
    setup: `session-start hook installed for ${on.join(", ")} (${scope} scope)`,
    hooks: { scope, ...hooks },
  };
  if (errors.length) out.errors = errors;
  out.help = ["Restart your agent session for the hook to take effect"];
  return out;
}

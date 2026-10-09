import { runUpdate } from "axi-sdk-js";
import { usage } from "../errors.js";
import { VERSION } from "../version.js";

export const UPDATE_HELP = `usage: ticktick-axi update [--check]
Upgrades ticktick-axi itself to the latest npm release (axi-sdk-js built-in).
To change a task, use \`ticktick-axi edit <projectId> <taskId> ...\`.
flags:
  --check   report current vs latest without installing (alias: --dry-run)
examples:
  ticktick-axi update --check
  ticktick-axi update
`;

/**
 * `update` keeps the SDK's self-update behaviour, but an agent that guesses
 * `update <projectId> <taskId> --due ...` gets pointed at `edit` instead of
 * a confusing self-update error.
 */
export async function selfUpdateCommand(
  args: string[],
  stdout: { write: (chunk: string) => unknown },
): Promise<string | Record<string, unknown>> {
  if (args.some((a) => a !== "--check" && a !== "--dry-run")) {
    throw usage(
      "`update` upgrades ticktick-axi itself; it does not change tasks",
      "Run `ticktick-axi edit <projectId> <taskId> --due <date>` (or --title, --priority, --tag, --content) to preview a task change",
      "Run `ticktick-axi update --check` to check for a newer ticktick-axi",
    );
  }
  return runUpdate({ args, stdout, version: VERSION });
}

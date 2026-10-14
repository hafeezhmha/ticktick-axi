import { parseArgs } from "../args.js";
import { getClient } from "../api.js";
import { apiLife } from "../api-life.js";
import { dateKey, isValidTimeZone, timeOfDay, userTimeZone } from "../dates.js";
import { usage } from "../errors.js";

export const PREFERENCES_HELP = `usage: ticktick-axi preferences
Shows the TickTick account's preferences (the Open API returns the time zone), and
whether ticktick-axi judges "today" and due dates in the same zone.
ticktick-axi's zone is TICKTICK_AXI_TZ, else the system zone.
examples:
  ticktick-axi preferences
`;

/** Two zones agree if their wall clocks match now and in six months. */
function sameZone(a: string, b: string, now: number): boolean {
  if (a === b) return true;
  if (!isValidTimeZone(a) || !isValidTimeZone(b)) return false;
  return [now, now + 182 * 86_400_000].every(
    (t) =>
      dateKey(t, a) === dateKey(t, b) && timeOfDay(t, a) === timeOfDay(t, b),
  );
}

export async function preferencesCommand(args: string[]) {
  const p = parseArgs(args, {}, "preferences");
  if (p.positionals.length) {
    throw usage(`unexpected argument "${p.positionals[0]}"`);
  }
  const local = userTimeZone();
  const source = process.env.TICKTICK_AXI_TZ ? "TICKTICK_AXI_TZ" : "system";
  const raw = await apiLife.preferences(getClient());
  const prefs =
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out: Record<string, unknown> = {
    preferences: Object.keys(prefs).length
      ? prefs
      : "0 preferences returned by TickTick",
    cli_time_zone: `${local} (${source})`,
  };
  const remote = prefs.timeZone;
  if (typeof remote === "string" && remote && !isValidTimeZone(remote)) {
    out.time_zone_match = "unknown (TickTick's zone is not an IANA name here)";
  } else if (typeof remote === "string" && remote) {
    if (sameZone(remote, local, Date.now())) {
      out.time_zone_match = "yes";
    } else {
      out.time_zone_match = "no";
      out.help = [
        `Run commands with TICKTICK_AXI_TZ=${remote} (or export it) so "today" and due dates match TickTick`,
      ];
    }
  }
  return out;
}

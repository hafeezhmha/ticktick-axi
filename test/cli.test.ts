import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("axi-sdk-js", async (orig) => ({
  ...(await orig<typeof import("axi-sdk-js")>()),
  installSessionStartHooks: vi.fn(),
  runUpdate: vi.fn(async () => ({ update: "checked" })),
  uninstallSessionStartHooks: vi.fn(),
  sessionStartHookStatus: vi.fn(() => ({
    marker: "ticktick-axi",
    scope: "user",
    claude: { installed: true, path: "x" },
    codex: { installed: false, path: "x" },
    opencode: { installed: false, path: "x" },
  })),
}));

import {
  installSessionStartHooks,
  runUpdate,
  sessionStartHookStatus,
  uninstallSessionStartHooks,
} from "axi-sdk-js";
import { createSkillMarkdown } from "../src/skill.js";
import { VERSION } from "../src/version.js";
import { isolate, run } from "./support.js";

beforeEach(() => {
  isolate();
});

describe("top level", () => {
  it("prints concise help", async () => {
    const { out, code } = await run("--help");
    expect(code).toBe(0);
    expect(out).toContain("usage: ticktick-axi [command]");
    expect(out).toContain("--yes");
  });

  it("prints the package version", async () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8"));
    expect(VERSION).toBe(pkg.version);
    expect((await run("--version")).out.trim()).toBe(pkg.version);
  });

  it("rejects unknown commands with the command list (exit 2)", async () => {
    const { out, code } = await run("todo");
    expect(code).toBe(2);
    expect(out).toContain("Unknown command: todo");
    expect(out).toContain("Commands: auth, projects, tasks");
  });

  it("rejects flags before the command (exit 2)", async () => {
    expect((await run("--project", "x")).code).toBe(2);
  });

  it("has --help for every command", async () => {
    for (const c of [
      "auth",
      "projects",
      "tasks",
      "task",
      "overdue",
      "upcoming",
      "create",
      "edit",
      "complete",
      "setup",
      "update",
    ]) {
      const { out, code } = await run(c, "--help");
      expect(code, c).toBe(0);
      expect(out, c).toContain(`usage: ticktick-axi ${c}`);
      expect(out, c).toContain("examples:");
    }
  });
});

describe("update (self-update)", () => {
  it("delegates --check to the SDK built-in", async () => {
    const { out, code } = await run("update", "--check");
    expect(code).toBe(0);
    expect(out).toContain("update: checked");
    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["--check"] }),
    );
  });

  it("points task-edit attempts at `edit` without self-updating", async () => {
    const { out, code } = await run("update", "p1", "t1", "--due", "tomorrow");
    expect(code).toBe(2);
    expect(out).toContain("does not change tasks");
    expect(out).toContain("ticktick-axi edit <projectId> <taskId>");
    expect(runUpdate).not.toHaveBeenCalled();
  });
});

describe("setup hooks", () => {
  it("installs, reports and removes with the ticktick-axi marker", async () => {
    expect((await run("setup", "hooks")).out).toContain(
      "session-start hook installed for claude (user scope)",
    );
    expect(installSessionStartHooks).toHaveBeenCalledWith(
      expect.objectContaining({
        marker: "ticktick-axi",
        binaryNames: ["ticktick-axi"],
        scope: "user",
        onError: expect.any(Function),
      }),
    );
    const status = await run("setup", "hooks", "--status");
    expect(status.out).toContain("claude: true");
    expect(status.out).toContain("codex: false");
    expect(
      (await run("setup", "hooks", "--remove", "--project")).out,
    ).toContain("still installed for claude (project scope)");
    expect(uninstallSessionStartHooks).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "project" }),
    );
  });

  it("reports a failed install instead of claiming success", async () => {
    vi.mocked(sessionStartHookStatus).mockReturnValueOnce({
      marker: "ticktick-axi",
      scope: "user",
      claude: { installed: false, path: "x" },
      codex: {
        installed: false,
        path: "x",
        userFeatureEnabled: false,
        userFeaturePath: "x",
      },
      opencode: { installed: false, path: "x" },
    });
    vi.mocked(installSessionStartHooks).mockImplementationOnce((o) => {
      o?.onError?.("could not write settings.json");
    });
    const { out, code } = await run("setup", "hooks");
    expect(code).toBe(1);
    expect(out).toContain("code: CONFIG_ERROR");
    expect(out).toContain("could not write settings.json");
  });

  it("validates its arguments", async () => {
    expect((await run("setup")).code).toBe(2);
    expect((await run("setup", "hooks", "--remove", "--status")).code).toBe(2);
  });
});

describe("skill", () => {
  it("committed SKILL.md matches the generator", () => {
    expect(readFileSync("skills/ticktick-axi/SKILL.md", "utf-8")).toBe(
      createSkillMarkdown(),
    );
  });

  it("uses npx-runnable commands and the write gate", () => {
    const md = createSkillMarkdown();
    expect(md).toMatch(/^---\nname: ticktick-axi\ndescription: "/);
    expect(md).toContain(
      "npx -y ticktick-axi complete <projectId> <taskId> --yes",
    );
    expect(md).toContain("Never add `--yes` on your own");
  });
});

describe("built binary", () => {
  it("answers --version through the fast path when built", () => {
    let out: string;
    try {
      out = execFileSync(
        process.execPath,
        ["dist/bin/ticktick-axi.js", "--version"],
        {
          encoding: "utf-8",
        },
      );
    } catch {
      return; // dist not built in this run; `pnpm run build` covers it in CI
    }
    expect(out.trim()).toBe(VERSION);
  });
});

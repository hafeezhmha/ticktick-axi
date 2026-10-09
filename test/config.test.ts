import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPending,
  configDir,
  DEFAULT_REDIRECT_URI,
  deleteStoredToken,
  filePermissions,
  readClientConfig,
  readPending,
  readToken,
  tokenPath,
  writePending,
  writeStoredToken,
} from "../src/config.js";
import { FAKE_SECRET, FAKE_TOKEN, isolate } from "./support.js";

let dir: string;
beforeEach(() => {
  dir = isolate({ token: false });
});

describe("configDir", () => {
  it("honours overrides and platform conventions", () => {
    expect(configDir({ TICKTICK_AXI_CONFIG_DIR: "/x" })).toBe("/x");
    expect(configDir({ XDG_CONFIG_HOME: "/xdg" }, "linux")).toBe(
      join("/xdg", "ticktick-axi"),
    );
    expect(configDir({ APPDATA: "C:\\Users\\a\\AppData" }, "win32")).toContain(
      "ticktick-axi",
    );
    expect(configDir({}, "darwin")).toMatch(/\.config[/\\]ticktick-axi$/);
  });
});

describe("token storage", () => {
  it("writes the token owner-only (dir 700, file 600)", () => {
    const nested = join(dir, "nested");
    vi.stubEnv("TICKTICK_AXI_CONFIG_DIR", nested);
    writeStoredToken({
      accessToken: FAKE_TOKEN,
      kind: "oauth",
      obtainedAt: "2026-10-09T00:00:00Z",
    });
    if (process.platform !== "win32") {
      expect(statSync(nested).mode & 0o777).toBe(0o700);
      expect(statSync(tokenPath()).mode & 0o777).toBe(0o600);
      expect(filePermissions(tokenPath())).toBe("600");
    }
    expect(readToken()).toMatchObject({
      accessToken: FAKE_TOKEN,
      source: "file",
    });
    expect(deleteStoredToken()).toBe(true);
    expect(deleteStoredToken()).toBe(false);
    expect(readToken()).toBeNull();
    expect(filePermissions(tokenPath())).toBeNull();
  });

  it("lets TICKTICK_ACCESS_TOKEN override the stored token", () => {
    writeStoredToken({
      accessToken: "stored-token-x",
      kind: "oauth",
      obtainedAt: "x",
    });
    vi.stubEnv("TICKTICK_ACCESS_TOKEN", ` ${FAKE_TOKEN} `);
    expect(readToken()).toEqual({ accessToken: FAKE_TOKEN, source: "env" });
  });

  it("ignores token files without a token and reports corrupt JSON", () => {
    writeFileSync(tokenPath(), JSON.stringify({ kind: "oauth" }));
    expect(readToken()).toBeNull();
    writeFileSync(tokenPath(), "{not json");
    expect(() => readToken()).toThrow(/not valid JSON/);
  });

  it("reports unwritable config dirs as CONFIG_ERROR", () => {
    const file = join(dir, "a-file");
    writeFileSync(file, "x");
    vi.stubEnv("TICKTICK_AXI_CONFIG_DIR", join(file, "sub"));
    expect(() =>
      writeStoredToken({
        accessToken: FAKE_TOKEN,
        kind: "oauth",
        obtainedAt: "x",
      }),
    ).toThrow(expect.objectContaining({ code: "CONFIG_ERROR" }));
  });
});

describe("client config", () => {
  it("returns null when nothing is configured", () => {
    expect(readClientConfig()).toBeNull();
  });
  it("prefers env vars", () => {
    vi.stubEnv("TICKTICK_CLIENT_ID", "id-env");
    vi.stubEnv("TICKTICK_CLIENT_SECRET", FAKE_SECRET);
    expect(readClientConfig()).toEqual({
      clientId: "id-env",
      clientSecret: FAKE_SECRET,
      redirectUri: DEFAULT_REDIRECT_URI,
      source: "env",
    });
  });
  it("falls back to config.json, with env redirect override", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        clientId: "id-file",
        clientSecret: FAKE_SECRET,
        redirectUri: "http://localhost:9999/cb",
      }),
    );
    expect(readClientConfig()).toMatchObject({
      clientId: "id-file",
      redirectUri: "http://localhost:9999/cb",
      source: "file",
    });
    vi.stubEnv("TICKTICK_REDIRECT_URI", "http://127.0.0.1:7777/x");
    expect(readClientConfig()?.redirectUri).toBe("http://127.0.0.1:7777/x");
  });
  it("uses the default redirect when the file has none, and rejects incomplete files", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ clientId: "a", clientSecret: "b" }),
    );
    expect(readClientConfig()?.redirectUri).toBe(DEFAULT_REDIRECT_URI);
    writeFileSync(join(dir, "config.json"), JSON.stringify({ clientId: "a" }));
    expect(readClientConfig()).toBeNull();
    writeFileSync(join(dir, "config.json"), "[]");
    expect(readClientConfig()).toBeNull();
  });
});

describe("pending login", () => {
  it("round-trips and clears", () => {
    expect(readPending()).toBeNull();
    writePending({ state: "s", redirectUri: "r", createdAt: "c" });
    expect(readPending()).toEqual({
      state: "s",
      redirectUri: "r",
      createdAt: "c",
    });
    clearPending();
    expect(readPending()).toBeNull();
  });
});

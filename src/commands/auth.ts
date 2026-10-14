import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { bool, intFlag, parseArgs, str } from "../args.js";
import { api, getClient } from "../api.js";
import {
  clearPending,
  cleanCredential,
  clientConfigPath,
  DEFAULT_REDIRECT_URI,
  deleteStoredToken,
  filePermissions,
  readClientConfig,
  readPending,
  readStoredToken,
  readToken,
  tokenPath,
  writeClientConfig,
  writePending,
  writeStoredToken,
  type ClientConfig,
  type StoredToken,
} from "../config.js";
import { fail, usage } from "../errors.js";
import { redact } from "../http.js";
import {
  authBase,
  buildAuthorizeUrl,
  exchangeCode,
  isLoopback,
  newState,
  parseCallbackUrl,
  waitForCallback,
} from "../oauth.js";

/** I/O seams so tests never touch the real terminal. */
export const authIo = {
  stderr: (s: string) => {
    process.stderr.write(s);
  },
  stdinIsTTY: () => Boolean(process.stdin.isTTY),
  readStdin: async (): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf-8");
  },
  /** Ask the person at the terminal (prompt on stderr); `hidden` for secrets. */
  ask: (question: string, hidden = false): Promise<string> =>
    new Promise((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stderr,
        terminal: true,
      });
      rl.question(question, (answer) => {
        rl.close();
        if (hidden) process.stderr.write("\n");
        resolve(answer);
      });
      // The prompt is already written; from here on, echo nothing.
      if (hidden) {
        (
          rl as unknown as { _writeToOutput: (s: string) => void }
        )._writeToOutput = () => {};
      }
    }),
};

const PENDING_MAX_AGE_MS = 15 * 60 * 1000;

export const AUTH_HELP = `usage: ticktick-axi auth <setup|login|status|logout> [flags]
setup                       for the person, in their own terminal: walks through creating the TickTick
                            app, asks for its Client ID and secret (hidden), saves them to config.json
                            (600), then signs in. Never prompts an agent: without a terminal it exits 2
  --no-login                only save the credentials; sign in later with \`auth login\`
  --timeout <seconds>       how long to wait for the redirect (default 300)
login                       OAuth sign-in: prints the authorize URL (stderr) and waits for the
                            redirect on the loopback redirect URI (default http://localhost:8765/callback)
  --timeout <seconds>       how long to wait for the redirect (default 300)
  --no-wait                 print the authorize URL and exit; finish with --callback-url
  --callback-url <url>      finish a --no-wait sign-in with the URL the browser was redirected to
  --token-stdin             store a personal API token read from stdin instead of OAuth
status                      where the token comes from, scope, expiry, file permissions (never the token)
  --verify                  also make one read call to confirm TickTick accepts the token
logout                      delete the stored token (idempotent)
  --revoke                  also revoke it at TickTick first (OAuth tokens)
OAuth without prompts (what \`auth setup\` does for you):
  1. Register an app at https://developer.ticktick.com/manage; set its "OAuth redirect URL"
     (not "App Service URL") to http://localhost:8765/callback (or your own loopback URI +
     TICKTICK_REDIRECT_URI)
  2. export TICKTICK_CLIENT_ID=<id> TICKTICK_CLIENT_SECRET=<secret>
     (or put {"clientId","clientSecret","redirectUri"} in ${tildify(clientConfigPath())})
  3. ticktick-axi auth login
env: TICKTICK_ACCESS_TOKEN overrides the stored token.
examples:
  ticktick-axi auth setup
  ticktick-axi auth login
  ticktick-axi auth login --no-wait
  ticktick-axi auth login --callback-url 'http://localhost:8765/callback?code=...&state=...'
  ticktick-axi auth login --token-stdin < token.txt
  ticktick-axi auth status --verify
`;

function tildify(p: string): string {
  const home = homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

export async function authCommand(args: string[]) {
  const [sub, ...rest] = args;
  switch (sub) {
    case "setup":
      return setup(rest);
    case "login":
      return login(rest);
    case "status":
      return status(rest);
    case "logout":
      return logout(rest);
    case undefined:
      return status([]);
    default:
      throw usage(
        `unknown auth subcommand "${sub}"`,
        "Use `ticktick-axi auth setup`, `auth login`, `auth status`, or `auth logout`",
      );
  }
}

function requireClient(): ClientConfig {
  const cfg = readClientConfig();
  if (!cfg) {
    throw fail(
      "CONFIG_ERROR",
      "No TickTick OAuth app credentials found",
      "Easiest: ask the person to run `npx -y ticktick-axi auth setup` in their own terminal; it walks them through it",
      "Register an app at https://developer.ticktick.com/manage (OAuth redirect URL http://localhost:8765/callback)",
      "Then export TICKTICK_CLIENT_ID=<id> TICKTICK_CLIENT_SECRET=<secret> and rerun `ticktick-axi auth login`",
      "Or skip OAuth: `ticktick-axi auth login --token-stdin` with a personal API token",
    );
  }
  return cfg;
}

function store(token: StoredToken) {
  writeStoredToken(token);
  const out: Record<string, unknown> = {
    auth: `signed in (${token.kind === "personal" ? "personal API token" : "OAuth"})`,
    stored: `${tildify(tokenPath())} (permissions 600)`,
  };
  if (token.scope) out.scope = token.scope;
  out.expires = token.expiresAt ?? "not reported by TickTick";
  if (process.env.TICKTICK_ACCESS_TOKEN) {
    out.note =
      "TICKTICK_ACCESS_TOKEN is set and takes precedence over the stored token";
  }
  out.help = ["Run `ticktick-axi` to see what is due"];
  return out;
}

async function finishOAuth(cfg: ClientConfig, code: string) {
  const t = await exchangeCode(cfg, code);
  const now = Date.now();
  return store({
    accessToken: t.accessToken,
    kind: "oauth",
    scope: t.scope,
    obtainedAt: new Date(now).toISOString(),
    ...(t.expiresIn
      ? { expiresAt: new Date(now + t.expiresIn * 1000).toISOString() }
      : {}),
  });
}

async function login(args: string[]) {
  const p = parseArgs(
    args,
    {
      bool: ["no-wait", "token-stdin"],
      value: ["timeout", "callback-url"],
      renamed: {
        token:
          "Never pass a token as an argument (it lands in shell history); pipe it to `ticktick-axi auth login --token-stdin`",
      },
    },
    "auth login",
  );
  if (p.positionals.length) {
    throw usage(`unexpected argument "${p.positionals[0]}"`);
  }
  const modes = [
    bool(p, "no-wait"),
    bool(p, "token-stdin"),
    str(p, "callback-url") !== undefined,
  ].filter(Boolean).length;
  if (modes > 1) {
    throw usage(
      "--no-wait, --callback-url and --token-stdin are separate ways to sign in; pick one",
    );
  }

  if (bool(p, "token-stdin")) {
    if (authIo.stdinIsTTY()) {
      throw usage(
        "--token-stdin reads the token from a pipe, not the keyboard",
        "Run `ticktick-axi auth login --token-stdin < token.txt` (create the token in TickTick: Settings > Account > API Token)",
      );
    }
    const token = (await authIo.readStdin()).trim();
    if (!/^\S{8,4096}$/.test(token)) {
      throw usage(
        "stdin did not contain a single API token",
        "Pipe just the token, with no spaces or extra lines",
      );
    }
    return store({
      accessToken: token,
      kind: "personal",
      obtainedAt: new Date().toISOString(),
    });
  }

  const callbackUrl = str(p, "callback-url");
  if (callbackUrl !== undefined) {
    const cfg = requireClient();
    const pending = readPending();
    if (!pending) {
      throw usage(
        "No sign-in is waiting to be finished",
        "Run `ticktick-axi auth login --no-wait` first, open the URL, then pass the redirect URL here",
      );
    }
    if (Date.now() - Date.parse(pending.createdAt) > PENDING_MAX_AGE_MS) {
      clearPending();
      throw fail(
        "OAUTH_ERROR",
        "That sign-in attempt is older than 15 minutes and has expired",
        "Run `ticktick-axi auth login --no-wait` again",
      );
    }
    const cb = parseCallbackUrl(callbackUrl);
    if (cb.error) {
      clearPending();
      throw fail(
        "OAUTH_ERROR",
        `TickTick authorization was not granted (${cb.error})`,
        "Run `ticktick-axi auth login --no-wait` again and choose Allow",
      );
    }
    if (!cb.code || !cb.state) {
      throw usage(
        "--callback-url must be the full URL the browser was sent to, including ?code=...&state=...",
      );
    }
    if (cb.state !== pending.state) {
      throw fail(
        "OAUTH_ERROR",
        "The redirect URL's state does not match this sign-in attempt (stale or tampered)",
        "Run `ticktick-axi auth login --no-wait` again and use the newest URL",
      );
    }
    clearPending();
    return finishOAuth({ ...cfg, redirectUri: pending.redirectUri }, cb.code);
  }

  const cfg = requireClient();

  if (bool(p, "no-wait")) {
    const state = newState();
    const url = buildAuthorizeUrl(cfg, state);
    writePending({
      state,
      redirectUri: cfg.redirectUri,
      createdAt: new Date().toISOString(),
    });
    return {
      authorize_url: url,
      next: [
        "1. Open authorize_url in a browser and choose Allow",
        `2. The browser is sent to ${cfg.redirectUri}?code=...; if the page fails to load, that is fine`,
        "3. Copy that full address from the address bar",
      ],
      help: [
        "Run `ticktick-axi auth login --callback-url '<redirected-url>'` within 15 minutes",
      ],
    };
  }

  return waitAndFinish(cfg, intFlag(p, "timeout", 300, 10, 3600));
}

/** Print the authorize URL, wait for the loopback redirect, store the token. */
async function waitAndFinish(cfg: ClientConfig, timeout: number) {
  const state = newState();
  const url = buildAuthorizeUrl(cfg, state);
  if (!isLoopback(cfg.redirectUri)) {
    throw fail(
      "CONFIG_ERROR",
      `Redirect URI ${cfg.redirectUri} is not a local http://localhost or 127.0.0.1 address, so it cannot be received here`,
      "Use `ticktick-axi auth login --no-wait` and then `--callback-url '<url>'`",
      "Or register http://localhost:8765/callback and unset TICKTICK_REDIRECT_URI",
    );
  }
  authIo.stderr(
    `Open this URL in your browser to let ticktick-axi read and write your TickTick tasks:\n\n  ${url}\n\nWaiting up to ${timeout}s for the redirect to ${cfg.redirectUri} ...\n`,
  );
  const code = await waitForCallback(cfg.redirectUri, state, timeout * 1000);
  return finishOAuth(cfg, code);
}

async function yes(question: string): Promise<boolean> {
  const a = (await authIo.ask(question)).trim().toLowerCase();
  return a === "" || a.startsWith("y");
}

/**
 * For a person at a terminal: the whole OAuth setup in one run. An agent never
 * reaches a prompt: without a TTY this is a usage error that says what to do.
 */
async function setup(args: string[]) {
  const p = parseArgs(
    args,
    { bool: ["no-login"], value: ["timeout"] },
    "auth setup",
  );
  if (p.positionals.length) {
    throw usage(`unexpected argument "${p.positionals[0]}"`);
  }
  if (!authIo.stdinIsTTY()) {
    throw usage(
      "auth setup asks the person for their TickTick app credentials, so it only runs in their own terminal",
      "Ask the person to run `npx -y ticktick-axi auth setup` in their own terminal",
      "Or, without prompts: export TICKTICK_CLIENT_ID and TICKTICK_CLIENT_SECRET, then run `ticktick-axi auth login`",
    );
  }
  const timeout = intFlag(p, "timeout", 300, 10, 3600);
  const say = (line = "") => authIo.stderr(`${line}\n`);
  // Only the saved file counts as "already set up"; exported values are noted below.
  const saved = readClientConfig({
    ...process.env,
    TICKTICK_CLIENT_ID: "",
    TICKTICK_CLIENT_SECRET: "",
  });
  const redirectUri =
    process.env.TICKTICK_REDIRECT_URI ||
    saved?.redirectUri ||
    DEFAULT_REDIRECT_URI;
  const where = tildify(clientConfigPath());

  say("Connect ticktick-axi to your TickTick account (about 2 minutes).");
  say();
  say("1. Open https://developer.ticktick.com/manage and sign in.");
  say('   Open your app, or create one with "+App Name" (any name).');
  say(
    '2. Set the field "OAuth redirect URL" (not "App Service URL") to exactly:',
  );
  say(`     ${redirectUri}`);
  say("   and save.");
  say("3. The same page shows the Client ID and Client Secret.");
  say();

  let cfg: ClientConfig;
  if (saved && (await yes(`Use the credentials saved in ${where}? [Y/n] `))) {
    cfg = { ...saved, redirectUri };
  } else {
    const clientId = cleanCredential(await authIo.ask("Client ID: "));
    const clientSecret = cleanCredential(
      await authIo.ask("Client Secret (typing is hidden): ", true),
    );
    if (!clientId || !clientSecret) {
      throw usage(
        "Both the Client ID and the Client Secret are needed",
        "Run `ticktick-axi auth setup` again with both from https://developer.ticktick.com/manage",
      );
    }
    writeClientConfig(clientId, clientSecret);
    say(`Saved to ${where} (permissions 600).`);
    cfg = { clientId, clientSecret, redirectUri, source: "file" };
  }

  const out: Record<string, unknown> = {
    setup: `OAuth app credentials in ${where}`,
  };
  if (process.env.TICKTICK_CLIENT_ID || process.env.TICKTICK_CLIENT_SECRET) {
    out.note =
      "TICKTICK_CLIENT_ID/TICKTICK_CLIENT_SECRET are set in this shell and override config.json; unset them or open a new terminal";
  }
  if (bool(p, "no-login")) {
    out.help = ["Run `ticktick-axi auth login` to sign in"];
    return out;
  }
  say();
  return { ...out, ...(await waitAndFinish(cfg, timeout)) };
}

async function status(args: string[]) {
  const p = parseArgs(args, { bool: ["verify"] }, "auth status");
  if (p.positionals.length) {
    throw usage(`unexpected argument "${p.positionals[0]}"`);
  }
  const token = readToken();
  const client = readClientConfig();
  const clientLine = client
    ? `configured (${client.source === "env" ? "TICKTICK_CLIENT_ID/SECRET" : tildify(clientConfigPath())})`
    : "not configured (only needed for OAuth sign-in)";

  if (!token) {
    return {
      auth: "not signed in",
      oauth_app: clientLine,
      help: [
        "Run `ticktick-axi auth login` to sign in with OAuth",
        "Or pipe a personal API token to `ticktick-axi auth login --token-stdin`",
      ],
    };
  }

  const info: Record<string, unknown> = {
    signed_in: true,
    source:
      token.source === "env"
        ? "TICKTICK_ACCESS_TOKEN environment variable"
        : tildify(tokenPath()),
    token: "present (never printed)",
  };
  if (token.source === "file") {
    info.kind = token.kind === "personal" ? "personal API token" : "OAuth";
    if (token.scope) info.scope = token.scope;
    info.obtained = token.obtainedAt;
    info.expires = token.expiresAt ?? "not reported by TickTick";
    if (token.expiresAt && Date.parse(token.expiresAt) <= Date.now()) {
      info.expired = true;
    }
    const perms = filePermissions(tokenPath());
    if (perms) {
      info.permissions =
        perms === "600" ? "600" : `${perms} (too open; expected 600)`;
    }
  }
  info.oauth_app = clientLine;
  const out: Record<string, unknown> = { auth: info };

  if (bool(p, "verify")) {
    const projects = (await api.listProjects(getClient())) ?? [];
    out.verified = `TickTick accepted the token (${projects.length} projects visible)`;
  } else {
    out.help = [
      "Run `ticktick-axi auth status --verify` to test the token against TickTick",
    ];
  }
  if (info.permissions && info.permissions !== "600") {
    out.help = [
      `Run \`chmod 600 ${tildify(tokenPath())}\` so only you can read the token`,
    ];
  }
  if (info.expired) {
    out.help = ["Run `ticktick-axi auth login` to sign in again"];
  }
  return out;
}

async function logout(args: string[]) {
  const p = parseArgs(args, { bool: ["revoke"] }, "auth logout");
  if (p.positionals.length) {
    throw usage(`unexpected argument "${p.positionals[0]}"`);
  }
  const envSet = Boolean(process.env.TICKTICK_ACCESS_TOKEN);
  const stored = readStoredToken();
  const out: Record<string, unknown> = {};

  if (!stored) {
    out.auth = "already signed out (no stored token; no-op)";
  } else {
    if (bool(p, "revoke")) {
      out.revoke = await revoke(stored.accessToken);
    }
    deleteStoredToken();
    clearPending();
    out.auth = `signed out: removed ${tildify(tokenPath())}`;
  }
  if (envSet) {
    out.note =
      "TICKTICK_ACCESS_TOKEN is still set in your environment; unset it to stop using that token";
  }
  return out;
}

/** POST /oauth/revoke (documented). Failure is reported, never fatal. */
async function revoke(accessToken: string): Promise<string> {
  const base = process.env.TICKTICK_AXI_API_BASE
    ? new URL(process.env.TICKTICK_AXI_API_BASE).origin
    : authBase().replace("://ticktick.com", "://api.ticktick.com");
  const form = new FormData();
  form.set("token", accessToken);
  try {
    const res = await fetch(`${base}/oauth/revoke`, {
      method: "POST",
      body: form,
    });
    if (res.ok) return "revoked at TickTick";
    return redact(
      `TickTick did not confirm revocation (HTTP ${res.status}); revoke access in TickTick settings if needed`,
      accessToken,
    );
  } catch {
    return "could not reach TickTick to revoke; the local token was still removed";
  }
}

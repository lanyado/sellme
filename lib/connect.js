// How to connect each thing Sellme needs: the exact command or link, not "go figure out MCP".
// Which steps apply is plain data, so tests can check it. A step only ever runs when the user presses
// enter on it or types `sellme connect`, and logging in stays theirs, in their own browser.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { onPath, toolCommand } from "./rewrite.js";

const LOGIN_TIMEOUT_MS = 5 * 60_000;
const CHECK_TIMEOUT_MS = 45_000;
export const CONNECTORS_PAGE = "https://claude.ai/customize/connectors";
export const CHROME_PAGE = "https://claude.ai/chrome";

// "user" scope, so it works in every folder. Claude Code's default ties it to the current one.
const HOSTS = [
  {
    id: "claude",
    name: "Claude Code",
    add: (m) => (m.url ? ["mcp", "add", "--transport", "http", "--scope", "user", m.name, m.url] : ["mcp", "add", "--scope", "user", m.name, "--", ...m.command]),
    after: (m) => (m.url ? `Then type /mcp in Claude Code, pick ${m.name} and choose Authenticate. Sessions already open need a restart to see it.` : "Sessions already open need a restart to see it."),
    check: (m) => ["mcp", "get", m.name],
  },
  {
    id: "codex",
    name: "Codex",
    add: (m) => (m.url ? ["mcp", "add", m.name, "--url", m.url] : ["mcp", "add", m.name, "--", ...m.command]),
    after: (m) => (m.url ? "It opens your browser to log in." : null),
  },
];

/** Whether a server is already in that tool's own settings, read from its file, so the screen can say so at once. */
export function mcpAdded(hostId, name, { homeDir = os.homedir() } = {}) {
  try {
    if (hostId === "claude") return Boolean(JSON.parse(fs.readFileSync(path.join(homeDir, ".claude.json"), "utf8")).mcpServers?.[name]);
    if (hostId === "codex") return new RegExp(`^\\[mcp_servers\\.${name.replace(/[^\w-]/g, "")}\\]`, "m").test(fs.readFileSync(path.join(homeDir, ".codex", "config.toml"), "utf8"));
  } catch {
    // No settings file yet.
  }
  return false;
}

/** Whether this terminal can read Messages. macOS only shows the database to apps with Full Disk Access. */
export function canReadMessages({ platform = process.platform, homeDir = os.homedir() } = {}) {
  if (platform !== "darwin") return false;
  try {
    fs.closeSync(fs.openSync(path.join(homeDir, "Library", "Messages", "chat.db"), "r"));
    return true;
  } catch {
    return false;
  }
}

const TERMINALS = { Apple_Terminal: "Terminal", "iTerm.app": "iTerm", ghostty: "Ghostty", WarpTerminal: "Warp", WezTerm: "WezTerm", vscode: "your code editor", Hyper: "Hyper", alacritty: "Alacritty", kitty: "kitty" };

/** The app this terminal runs in, as System Settings lists it. */
export const terminalName = (env = process.env) => TERMINALS[env.TERM_PROGRAM] ?? env.TERM_PROGRAM ?? "your terminal app";

/** Which AI tools can take a connector from here. */
export const findHosts = (envPath = process.env.PATH) => HOSTS.filter((h) => onPath(h.id, envPath));

const USES_CONNECTORS = /calendar|e-?mail|gmail|notes?\b|notion|wispr/i;

/** @returns {Array<{kind: "run"|"open"|"text", label: string, ...}>} what to do for one item of connectList, in order */
export function stepsFor(item, hosts = findHosts()) {
  if (item.kind !== "connector") {
    if (!item.url) return [];
    const label = { signin: "Sign in", access: "Open the settings page" }[item.kind] ?? (item.uses_referral_link ? "Sign up (referral link)" : "Sign up");
    return [{ kind: "open", label, url: item.url, referral: Boolean(item.uses_referral_link) }];
  }
  if (item.mcp) {
    const steps = hosts.map((h) => ({ kind: "run", label: `Connect it in ${h.name}`, host: h.id, bin: h.id, args: h.add(item.mcp), command: [h.id, ...h.add(item.mcp).map((a) => (a === "" ? `""` : a))].join(" "), after: h.after(item.mcp), mcp: item.mcp }));
    if (!steps.length) steps.push({ kind: "text", label: item.mcp.url ? `Add this MCP server in your AI tool's settings: ${item.mcp.url}` : `Add this MCP server in your AI tool's settings: ${item.mcp.command.join(" ")}` });
    if (item.mcp.note) steps.push({ kind: "text", label: item.mcp.note });
    if (item.extra) steps.push(item.extra);
    return steps;
  }
  if (item.channel === "browser") return [{ kind: "open", label: "Add Claude in Chrome", url: CHROME_PAGE }, ...(item.signin ? [{ kind: "open", label: "Sign in", url: item.signin }] : [])];
  if (item.channel === "email" || USES_CONNECTORS.test(item.name)) {
    if (hosts.some((h) => h.id === "claude")) return [{ kind: "open", label: "Turn it on in your Claude connectors", url: CONNECTORS_PAGE }];
  }
  return [{ kind: "text", label: "Connect it in your AI tool's MCP or connector settings." }];
}

/** Starts a known tool directly, with no shell. @returns {Promise<{ok: boolean, already: boolean, output: string, stopped?: boolean}>} */
export function runStep(step, { signal, onOutput, timeout = LOGIN_TIMEOUT_MS, env = process.env } = {}) {
  return new Promise((resolve) => {
    // Codex's add stays open until the browser login finishes, and prints the link in case a browser doesn't open.
    const tool = toolCommand(step.bin, step.args, { envPath: env.PATH });
    const child = spawn(tool.file, tool.args, { cwd: os.homedir(), env, stdio: ["ignore", "pipe", "pipe"], signal, timeout, windowsHide: true, windowsVerbatimArguments: tool.verbatim });
    let output = "";
    const take = (d) => {
      output += d;
      onOutput?.(output);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", () => resolve({ ok: false, already: false, output, ...(signal?.aborted ? { stopped: true } : {}) }));
    child.on("close", (code) => {
      const already = /already exists/i.test(output);
      resolve({ ok: code === 0 || already, already, output, ...(signal?.aborted ? { stopped: true } : {}) });
    });
  });
}

/**
 * Asks the tool whether it can really reach the server, so "connected" is never a guess.
 * @returns {Promise<"connected"|"login"|"unknown">}
 */
export async function verify(step, { run = runStep, env } = {}) {
  const host = HOSTS.find((h) => h.id === step.host);
  if (!host?.check) return "unknown";
  const { output } = await run({ bin: host.id, args: host.check(step.mcp) }, { timeout: CHECK_TIMEOUT_MS, env });
  if (/needs authentication/i.test(output)) return "login";
  return /status:\s*\S*\s*connected/i.test(output) ? "connected" : "unknown";
}

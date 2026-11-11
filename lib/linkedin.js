// The LinkedIn tool signs in with its own browser and one saved session. LinkedIn treats that session as a person:
// several browsers using it at once, or calls after it was refused, make LinkedIn end it, and the tool then wipes it
// and opens a new sign-in window. So SELLME uses it from one run at a time, only where it's needed, and stops asking
// once LinkedIn has signed it out, until the user signs in again.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { home } from "./store.js";

export const LINKEDIN = "LinkedIn";
export const LINKEDIN_TOOLS = "mcp__linkedin";
const STALE_MS = 15 * 60_000; // Longer than any LinkedIn run holds it.

// How a run says LinkedIn wants a sign-in: the tool's own words, a redirect loop, or a page asking for a password.
const SIGNED_OUT = /session (?:has )?expired|log-?in window|sign-?in window|sign-?in page|sign-?in (?:is |was )?(?:still )?in progress|login (?:is |was )?(?:still )?in progress|too[ _]many[ _]redirects|signed (?:you |sellme )?out|logged out|asks? for (?:the |your |a )?(?:login|password)|authentication[- ]in[- ]progress|needs? (?:you to )?(?:log|sign) ?in/i;

/** Whether a run's words say LinkedIn needs the user to sign in. */
export const saysSignedOut = (text) => SIGNED_OUT.test(String(text ?? ""));

/** Whether LinkedIn has signed SELLME out, so nothing should touch it until the user signs in. */
export const linkedinOut = (state) => state.connections?.[LINKEDIN]?.status === "signin";

export const SIGNIN_WHY = "LinkedIn signed SELLME out. Open the Agents tab, choose LinkedIn, then Sign in to LinkedIn";

const lockFile = () => path.join(home(), "linkedin.lock");
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
};

/**
 * Runs fn while no other SELLME run uses LinkedIn, across processes: the app's sends and a scheduled check share it.
 * @returns fn's result, or {busy: true} when it waited too long
 */
export async function withLinkedin(fn, { signal, wait = 5 * 60_000, poll = 2000, file = lockFile() } = {}) {
  const until = Date.now() + wait;
  for (;;) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: "wx", mode: 0o600 });
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let held = null;
      try {
        held = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        // Half written or gone: treat it as free.
      }
      if (!held || Date.now() - held.at > STALE_MS || !alive(held.pid)) {
        fs.rmSync(file, { force: true });
        continue;
      }
      if (Date.now() >= until || signal?.aborted) return { busy: true };
      await new Promise((resolve) => setTimeout(resolve, poll));
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/**
 * The LinkedIn tool's own sign-in, from the user's Claude Code settings: it opens one window where the user signs in
 * themselves, and saves the session for every later run. @returns a connect step, or null when it isn't set up
 */
export function linkedinLogin(homeDir = os.homedir()) {
  try {
    const server = JSON.parse(fs.readFileSync(path.join(homeDir, ".claude.json"), "utf8")).mcpServers?.linkedin;
    if (!server?.command) return null;
    const args = [...(server.args ?? []), "--login"];
    const quote = (a) => (/[\s"']/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
    return { kind: "run", host: "linkedin-login", label: "Sign in to LinkedIn: a window opens, and you sign in there", bin: server.command, args, env: server.env ?? {}, command: [server.command, ...args].map(quote).join(" "), timeout: 20 * 60_000 };
  } catch {
    return null;
  }
}

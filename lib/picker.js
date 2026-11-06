// The `sellme agents` screen: a list you move through with the arrow keys, like /mcp in Claude Code.
// What each row shows and offers is plain functions, so tests can check it without a terminal.
import fs from "node:fs";
import readline from "node:readline";
import { canReadMessages, findHosts, mcpAdded, runStep, stepsFor, terminalName, verify } from "./connect.js";
import { CATALOG } from "./catalog.js";
import * as core from "./core.js";
import { personRoute } from "./core.js";
import { DISCLOSURE } from "./referrals.js";
import { audit, load, withState } from "./store.js";
import { openUrl } from "./open.js";
import { logo } from "./render.js";

const STATUS = {
  connected: "connected",
  signin: "needs sign-in",
  access: "needs access",
  connector: "needs connector",
  skip: "skipped",
  none: "not connected",
};

export const ADD = "add";

/** Every line of the list. Headings can't be selected. */
export function buildRows(state) {
  const { catalog, yours } = core.roster(state);
  const status = (name, connected) => state.connections[name]?.status ?? (connected ? "connected" : "none");
  const rows = [{ heading: "Catalog" }];
  for (const a of catalog) rows.push({ name: a.name, detail: `${a.channel}${a.about ? ` · ${a.about}` : ""}`, status: status(a.name, a.connected), connected: a.connected, builtIn: true, auto: a.auto, channel: a.channel });
  rows.push({ heading: "Your recruiters" });
  for (const a of yours) {
    rows.push({ name: a.name, detail: [a.person ? (personRoute(a.handle) ?? "needs an address") : a.channel, a.handle, a.company].filter(Boolean).join(" · "), status: status(a.name, true), connected: true, builtIn: false, person: a.person, auto: a.auto, channel: a.channel });
  }
  rows.push({ id: ADD, name: "Create a recruiter" });
  const known = new Set(rows.map((r) => r.name));
  const tools = Object.keys(state.connections).filter((name) => !known.has(name));
  if (tools.length) rows.push({ heading: "Your tools" });
  for (const name of tools) rows.push({ name, detail: "", status: state.connections[name].status, connected: true, tool: true });
  return rows;
}

export const selectable = (rows) => rows.flatMap((row, i) => (row.heading ? [] : [i]));

/** Moves within what can be selected, wrapping at the ends. */
export function move(rows, cursor, delta) {
  const spots = selectable(rows);
  const at = Math.max(spots.indexOf(cursor), 0);
  return spots[(at + delta + spots.length) % spots.length];
}

/** What pressing enter on a row can do. */
const FULL_DISK = /Privacy_AllFiles/;

/**
 * Marks an agent connected once what it needs is really in place: its local server added to an AI tool, and for
 * texting, Full Disk Access. A server that needs a login (a URL) waits for the tool to confirm it instead.
 * @returns the names it marked
 */
export function refreshConnections({ hosts = findHosts(), added = mcpAdded, messages = canReadMessages } = {}) {
  return withState((s) => {
    const marked = [];
    for (const [name, conn] of Object.entries(s.connections)) {
      const mcp = CATALOG[name.toLowerCase()]?.mcp;
      if (conn.status !== "connector" || !mcp?.command) continue;
      if (!hosts.some((h) => added(h.id, mcp.name))) continue;
      if (core.findAgent(s, name)?.channel === "imessage" && !messages()) continue;
      core.setConnection(s, name, "ok");
      marked.push(name);
    }
    return marked;
  });
}

const c0 = { on: "●", off: "○" };

export function actionsFor(state, row, hosts = findHosts(), { added = mcpAdded, messages = canReadMessages } = {}) {
  const need = core.connectList(state).find((item) => item.name === row.name);
  const actions = [];
  for (const step of need ? stepsFor(need, hosts) : []) {
    if (step.kind === "open" && FULL_DISK.test(step.url)) {
      const on = messages();
      actions.push({ id: "open", label: on ? "✓ Full Disk Access is on" : step.label, url: step.url, fda: true, done: on });
    } else if (step.kind === "open") actions.push({ id: "open", label: step.label, url: step.url, referral: step.referral });
    if (step.kind === "run") {
      const done = Boolean(step.mcp?.name && added(step.host, step.mcp.name));
      const host = hosts.find((h) => h.id === step.host)?.name ?? step.host;
      actions.push({ id: "run", label: done ? `✓ Added to ${host}` : step.label, command: done ? null : step.command, step, done });
    }
  }
  if (!row.connected) actions.push({ id: "connect", label: "I already have an account: connect it" });
  if (row.connected && need) actions.push({ id: "working", label: "It’s working now" });
  if (row.tool) {
    if (need) actions.push({ id: "skip", label: "Skip it" });
    else actions.push({ id: "working", label: "Stop skipping it" });
    actions.push({ id: "back", label: "Back" });
    return actions;
  }
  if (row.connected) {
    // A setting, not a toggle: both choices show, and ● marks the one that's on.
    const section = `When I’m sure of an answer to ${row.person ? "them" : "this agent"}`;
    actions.push({ id: "auto", on: true, section, label: `${row.auto ? c0.on : c0.off} Send it by myself`, chosen: Boolean(row.auto) });
    actions.push({ id: "auto", on: false, label: `${row.auto ? c0.off : c0.on} Ask you first`, chosen: !row.auto, last: true });
  }
  if (row.status === "skip") actions.push({ id: "working", label: "Stop skipping it" });
  else if (!row.connected) actions.push({ id: "skip", label: "Skip it" });
  if (row.connected) actions.push({ id: "remove", label: "Remove" });
  actions.push({ id: "back", label: "Back" });
  return actions;
}

function mark(row, c) {
  if (row.id === ADD) return c.lime("+");
  if (row.status === "connected") return c.lime("✓");
  if (["signin", "access", "connector"].includes(row.status)) return c.red("!");
  return c.muted("○");
}

export function listScreen(rows, cursor, c, message) {
  const width = Math.max(...rows.filter((r) => r.name).map((r) => r.name.length), 10) + 2;
  const room = Math.max((process.stdout.columns || 120) - width - 8, 20);
  const fit = (s) => (s.length > room ? `${s.slice(0, room - 1)}…` : s);
  const out = [c.bold("Recruiter agents"), ""];
  const targets = [];
  rows.forEach((row, i) => {
    if (row.heading) {
      if (i) out.push("");
      out.push(c.muted(row.heading.toUpperCase()));
      return;
    }
    targets.push({ line: out.length, value: { row: i } });
    const line = `${mark(row, c)} ${row.name.padEnd(width)}${row.id === ADD ? "" : c.muted(fit(`${STATUS[row.status]}${row.auto ? " · auto" : ""}${row.detail ? ` · ${row.detail}` : ""}`))}`;
    out.push(`${i === cursor ? c.lime("❯") : " "} ${line}`);
  });
  out.push("");
  if (message) out.push(message, "");
  out.push(c.muted("↑↓ move · enter select · a add · d remove · q quit"));
  offerClicks(targets);
  return out.join("\n");
}

export function detailScreen(row, actions, cursor, c, message, need, position) {
  const out = [c.bold(`${position ? `${position}  ` : ""}${row.name}`), c.muted(`${STATUS[row.status]}${row.detail ? ` · ${row.detail}` : ""}`), ""];
  if (need && !need.url) out.push(need.action, "");
  for (const step of need ? stepsFor(need).filter((s) => s.kind === "text") : []) out.push(c.muted(step.label), "");
  const targets = [];
  const fda = actions.find((a) => a.fda && !a.done);
  if (fda) {
    const app = terminalName();
    out.push(
      c.muted(`Why: macOS keeps your texts locked, and ${row.name} talks to you by iMessage.`),
      c.muted(`How: in the window that opens, switch on ${app}. Not in the list? Click +, then pick ${app} from Applications.`),
      c.muted(`Then quit ${app} and open it again. For hourly checks, also add Node: click +, press ⌘⇧G and paste ${process.execPath}`),
      "",
    );
  }
  actions.forEach((action, i) => {
    if (action.section) out.push(c.muted(action.section.toUpperCase()));
    targets.push({ line: out.length, value: { action: i } });
    const label = action.done || action.chosen ? c.lime(action.label) : action.label;
    const link = action.url && /^https?:/.test(action.url) ? c.muted(`  ${action.url}`) : "";
    out.push(`${i === cursor ? c.lime("❯") : " "} ${label}${link}`);
    if (action.command) out.push(`    ${c.muted(action.command)}`);
    if (action.last) out.push("");
  });
  if (actions.some((a) => a.referral)) out.push("", c.muted(DISCLOSURE));
  out.push("");
  if (message) out.push(message, "");
  out.push(c.muted("↑↓ move · enter or click to select · esc back"));
  offerClicks(targets);
  return out.join("\n");
}

// ---------------------------------------------------------------- the terminal part
// Mouse reports ("\x1b[<button;x;yM") arrive from readline as one key per character, so they're put back together here.
const MOUSE_ON = "\x1b[?1000h\x1b[?1006h";
const MOUSE_OFF = "\x1b[?1000l\x1b[?1006l";

/**
 * One key, or {click} for a click on something the last screen offered. The mouse is on only while waiting here,
 * so a click can't type into a question.
 */
/** @param tick resolve "tick" after this many ms with no key, so a live screen can redraw */
export function readKey({ tick } = {}) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    if (stdout.isTTY) stdout.write(MOUSE_ON);
    let mouse = null;
    const timer = tick ? setTimeout(() => mouse === null && done("tick"), tick) : null;
    const done = (value) => {
      clearTimeout(timer);
      stdin.off("keypress", onKey);
      if (stdout.isTTY) stdout.write(MOUSE_OFF);
      stdin.setRawMode(false);
      stdin.pause();
      resolve(value);
    };
    const onKey = (str, key = {}) => {
      if (mouse !== null || key.sequence === "\x1b[<") {
        mouse = mouse === null ? "" : mouse + (key.sequence ?? str ?? "");
        const end = /^(\d+);(\d+);(\d+)([Mm])$/.exec(mouse);
        if (!end && mouse.length < 20) return;
        mouse = null;
        if (!end || end[4] === "m") return; // A release, or noise.
        const [button, x, y] = end.slice(1, 4).map(Number);
        if (button === 64) return done("up");
        if (button === 65) return done("down");
        const target = button === 0 ? clickAt(x - 1, y - 1) : undefined;
        if (target !== undefined) done({ click: target });
        return;
      }
      done(key.ctrl && key.name === "c" ? "quit" : (key.name ?? str));
    };
    stdin.on("keypress", onKey);
  });
}

/** @param prefill text already in the line, so an edit changes a word instead of retyping the message */
export async function ask(prompt, prefill) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = new Promise((resolve) => rl.question(prompt, (a) => resolve(a.trim())));
    if (prefill) rl.write(prefill);
    return await answer;
  } finally {
    rl.close();
  }
}

/** Runs something slow, and lets esc or ctrl-c stop it instead of killing the app mid-screen. */
export async function whileWorking(run) {
  const { stdin } = process;
  const stop = new AbortController();
  const onKey = (str, key = {}) => {
    if (key.name === "escape" || (key.ctrl && key.name === "c")) stop.abort();
  };
  readline.emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on("keypress", onKey);
  try {
    return await run(stop.signal);
  } finally {
    stdin.off("keypress", onKey);
    stdin.setRawMode(false);
    stdin.pause();
  }
}

// What the next screen lets the user click: {line, value, from?, to?}, with line counted in that screen's own text.
let offered = [];
let shown = [];
let brand = null;

/** Puts the logo on every screen from now on. */
export const useLogo = (c) => {
  brand = c;
};

/** Hands back what the last screen offered, for a screen that's built from another one. */
export const takeOffered = () => {
  const out = offered;
  offered = [];
  return out;
};

/** Called by a screen as it's built; `draw` picks them up. */
export const offerClicks = (targets) => {
  offered = targets;
};

const visible = (s) => String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").length;

/** Where each line of `text` lands on screen, counting the lines a long one wraps onto. */
export function placeLines(text, columns = process.stdout.columns || 100) {
  let row = 0;
  return String(text).split("\n").map((line) => {
    const at = row;
    row += Math.max(1, Math.ceil(visible(line) / columns));
    return at;
  });
}

/** @param still redraw over the last screen instead of clearing it, so an animation doesn't flicker */
export function draw(text, { still = false } = {}) {
  const head = brand ? `${logo(brand)}\n\n` : "";
  const full = `${head}${text}`;
  const rows = placeLines(full);
  const skip = head ? head.split("\n").length - 1 : 0;
  shown = offered.map((t) => ({ ...t, row: rows[t.line + skip] }));
  offered = [];
  if (still) process.stdout.write(`\x1b[H${full.replace(/\n/g, "\x1b[K\n")}\x1b[K\x1b[J`);
  else process.stdout.write(`\x1b[2J\x1b[H${full}\n`);
}

function clickAt(x, y) {
  const hit = shown.find((t) => t.row === y && (t.from === undefined || (x >= t.from && x < t.to)));
  return hit?.value;
}

/** Runs a change and turns a refusal into a message on screen, so one mistake can't close the list. */
export function attempt(fn, c) {
  try {
    return { message: fn() };
  } catch (err) {
    if (!err.userFacing) throw err;
    return { message: c.red(`✗ ${err.message}`), error: err };
  }
}

export async function addFlow(c) {
  draw(`${c.bold("Create a recruiter")}\n\n${c.muted("Leave the name empty to go back.")}\n`);
  const name = await ask("Name: ");
  if (!name) return null;
  const handle = await ask("Their number or email: ");
  const company = await ask("Their firm (optional): ");
  const options = { handle: handle || undefined, company: company || undefined };
  const save = (force) => {
    const agent = withState((s) => core.addRecruiter(s, name, { ...options, force }));
    audit({ event: "agent_added", agent: agent.name, channel: agent.channel, by: "keyboard" });
    return `${c.lime("✓")} ${agent.name} is on your list.`;
  };
  const first = attempt(() => save(false), c);
  if (!first.error || !/Did you mean|already belongs/.test(first.error.message)) return first.message;
  draw(`${first.message}\n`);
  const sure = await ask("Add them anyway? Type yes: ");
  return sure.toLowerCase() === "yes" ? attempt(() => save(true), c).message : "Not added.";
}

const MAX_IMPORT_BYTES = 1024 * 1024;

/** A path to a CSV or vCard file. */
export function readImport(file) {
  const resolved = file.replace(/^~(?=\/)/, process.env.HOME ?? "~");
  let info;
  try {
    info = fs.statSync(resolved);
  } catch {
    throw new core.ImportError(`I can’t find ${file}.`);
  }
  if (!info.isFile() || info.size > MAX_IMPORT_BYTES) throw new core.ImportError(`${file} isn’t a contacts file I can read.`);
  return fs.readFileSync(resolved, "utf8");
}

export async function removeFlow(row, c) {
  const sure = await ask(`\nRemove ${row.name}? Unsent drafts to them are cancelled. Type yes: `);
  if (sure.toLowerCase() !== "yes") return "Kept.";
  return attempt(() => {
    const { cancelled } = withState((s) => core.removeAgent(s, row.name));
    audit({ event: "agent_removed", agent: row.name, cancelled, by: "keyboard" });
    return `${c.lime("✓")} Removed ${row.name}.${cancelled ? ` Cancelled ${cancelled} unsent draft${cancelled === 1 ? "" : "s"}.` : ""}`;
  }, c).message;
}

/** Runs the connect command the user just chose, then asks the tool whether it really worked. */
async function connectHere(action, row, c) {
  const { step } = action;
  const screen = (output = "") => {
    // Only Codex's add prints a login link. Claude Code's just repeats the server's address.
    const link = step.host === "codex" ? output.match(/https:\/\/\S+/)?.[0] : null;
    draw(`${c.bold(row.name)}\n\n${c.muted(step.command)}\n\nConnecting… esc to stop${link ? `\n\nIf no browser opened, log in here:\n${c.lime(link)}` : ""}`);
  };
  screen();
  const result = await whileWorking((signal) => runStep(step, { signal, onOutput: screen }));
  audit({ event: "connect_ran", agent: row.name, host: step.host, ok: result.ok, by: "keyboard" });
  if (result.stopped) return "Stopped. You can try again whenever you like.";
  if (!result.ok) return c.red(`✗ That didn’t finish. You can run it yourself: ${step.command}`);
  if (refreshConnections().includes(row.name)) return `${c.lime("✓")} ${row.name} is connected. Sessions already open need a restart to see it.`;
  if (row.channel === "imessage" && !canReadMessages()) return `${c.lime("✓")} Added. One step left: Allow Full Disk Access, below.`;
  const state = await verify(step);
  if (state === "connected") {
    withState((s) => core.setConnection(s, row.name, "ok"));
    return `${c.lime("✓")} ${row.name} is connected. Sessions already open need a restart to see it.`;
  }
  if (step.host === "codex") return `${c.lime("✓")} Added to Codex. Your next run will check it works.`;
  return `${c.lime("✓")} Added. ${step.after ?? ""}`;
}

async function runAction(action, row, c) {
  switch (action.id) {
    case "run":
      return connectHere(action, row, c);
    case "open": {
      if (action.fda && action.done) return `${c.lime("✓")} ${terminalName()} can read your texts already.`;
      const opened = await openUrl(action.url);
      if (action.fda) return opened ? `${c.lime("✓")} Opened it. Switch on ${terminalName()}, then quit it and open it again. This screen shows ✓ once it works.` : `I couldn’t open it. Open System Settings > Privacy & Security > Full Disk Access.`;
      return opened ? `${c.lime("✓")} Opened it. Finish there, then come back.` : `I couldn’t open it. Go to: ${action.url}`;
    }
    case "connect": {
      const needsHandle = ["imessage", "email"].includes(row.channel);
      const handle = needsHandle ? await ask(`\n${row.name}’s exact ${row.channel === "email" ? "address" : "number"} (from your thread with it): `) : undefined;
      if (needsHandle && !handle) return "Not connected.";
      return attempt(() => {
        // An agent reached through an MCP server isn't connected until that server is added, so say how.
        const mcp = CATALOG[row.name.toLowerCase()]?.mcp;
        const agent = withState((s) => {
          const added = core.addRecruiter(s, row.name, { handle });
          core.setConnection(s, row.name, mcp ? "connector" : "ok", mcp ? `Add its MCP server, so I can talk to ${row.name}` : undefined);
          return added;
        });
        audit({ event: "agent_added", agent: agent.name, channel: agent.channel, by: "keyboard" });
        if (mcp) return `${c.lime("✓")} Added ${agent.name}. One more step: press enter on “Connect it”.`;
        return `${c.lime("✓")} ${agent.name} is connected. The next check reads it${agent.channel === "browser" ? " in Chrome, so stay signed in there" : ""}.`;
      }, c).message;
    }
    case "working":
      withState((s) => core.setConnection(s, row.name, "ok"));
      return `${c.lime("✓")} Done.`;
    case "skip":
      withState((s) => core.setConnection(s, row.name, "skip"));
      return `I won’t ask about ${row.name} again.`;
    case "auto": {
      const on = action.on ?? !row.auto;
      if (on === Boolean(row.auto)) return null; // Already the setting.
      withState((s) => core.setAuto(s, row.name, on));
      audit({ event: "auto", agent: row.name, value: on, by: "keyboard" });
      return on ? `${c.lime("✓")} I’ll answer ${row.name} by myself when I’m sure, up to ${core.AUTO_DAILY_LIMIT} a day. Pay, offers and scheduling still come to you.` : `${c.lime("✓")} I’ll ask you before every message to ${row.name}.`;
    }
    case "remove":
      return removeFlow(row, c);
    default:
      return null;
  }
}

/** @param walk {position, done}: part of `sellme connect`, so it moves on by itself once this one's sorted */
export async function detailFlow(row, c, walk) {
  let cursor = 0;
  let message = walk?.message;
  for (;;) {
    refreshConnections(); // Notices what was finished outside the app, like Full Disk Access.
    const current = buildRows(load()).find((r) => r.name === row.name);
    if (!current) return message;
    const actions = actionsFor(load(), current);
    cursor = Math.min(cursor, actions.length - 1);
    draw(detailScreen(current, actions, cursor, c, message, core.connectList(load()).find((i) => i.name === current.name), walk?.position));
    const key = await readKey();
    if (key === "quit") return "quit";
    if (key === "escape" || key === "left") return null;
    if (key === "up") cursor = (cursor - 1 + actions.length) % actions.length;
    else if (key === "down") cursor = (cursor + 1) % actions.length;
    else if (key === "return" || key === "enter" || key?.click?.action !== undefined) {
      if (key?.click) cursor = key.click.action;
      const action = actions[cursor];
      if (action.id === "back") return null;
      message = await runAction(action, current, c);
      if (action.id === "connect") cursor = 0; // The next step, if there is one, is first.
      if (action.id === "remove" && !buildRows(load()).some((r) => r.name === row.name)) return message;
      if (walk && !core.connectList(load()).some((i) => i.name === row.name)) return message;
    }
  }
}

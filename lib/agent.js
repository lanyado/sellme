// Runs Sellme's skill with nobody at the keyboard: to send what the user just approved, or for a scheduled
// check. A model reading recruiter messages can be fooled, so it never gets to decide what goes out. Every
// tool call passes through gate() first, and a message passes only if it's word for word something the
// user already approved, to the address it was approved for.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CATALOG } from "./catalog.js";
import { ATTACH_TOKEN, SELF, emailSubject, personRoute } from "./core.js";
import { PKG_ROOT, helperCommand, shimPath } from "./install.js";
import { PERSONA_PREAMBLE } from "./persona.js";
import { onPath, toolCommand } from "./rewrite.js";
import { home, load, withState } from "./store.js";

const SEND_TIMEOUT_MS = 5 * 60_000;
export const RUN_TIMEOUT_MS = 20 * 60_000;
const MAX_OUTPUT = 200_000;

export const canRun = (envPath = process.env.PATH) => onPath("claude", envPath);

// Whether a run can deliver to this draft's agent. A site with no chat box, like Hedgy, has nowhere to type.
export const canSendOn = (q) => (q.channel === SELF ? Boolean(personRoute(q.to)) : ["mcp", "imessage", "email", "browser"].includes(q.channel) && !CATALOG[String(q.agent).toLowerCase()]?.noChat);

/** What the helper lets a run do. Approving, editing and auto-approve belong to the user. */
const HELPER = {
  brief: () => true,
  review: () => true,
  status: () => true,
  agents: () => true,
  doctor: () => true,
  notes: () => true,
  outbox: () => true,
  reconcile: () => true,
  note: () => true,
  alert: () => true,
  draft: () => true,
  block: () => true,
  handled: () => true,
  ran: () => true,
  add: () => true,
  profile: (rest) => rest.length === 0,
  fact: (rest) => rest[0] === "list",
  agent: (rest) => rest[0] === "list",
  role: (rest) => ["add", "set", "list"].includes(rest[0]),
  connect: (rest) => !rest.includes("skip"),
};

const RUN_FORMS = {
  role: "It can use role add, role set and role list.",
  fact: "It can use fact list.",
  agent: "It can use agent list.",
  profile: "It can read the profile with profile, but not change it.",
  connect: "It can record what it couldn't reach, but not skip anything.",
};

/** Splits a command the way a shell would, or null if it uses anything a shell would act on. */
export function shellWords(command) {
  const words = [];
  let word = "";
  let inWord = false;
  let quote = null;
  for (const ch of String(command).trim()) {
    if (quote === "'") {
      if (ch === "'") quote = null;
      else word += ch;
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else if ("$`\\".includes(ch)) return null;
      else word += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
    } else if (/\s/.test(ch)) {
      if (ch === "\n") return null;
      if (inWord) words.push(word);
      word = "";
      inWord = false;
    } else if (";&|<>`$\\()*?#~".includes(ch) && !(ch === "~" && !inWord)) {
      return null;
    } else {
      word += ch;
      inWord = true;
    }
  }
  if (quote) return null;
  if (inWord) words.push(word);
  return words;
}

const helperNames = () => [shimPath(), helperCommand().replace(/^"|"$/g, ""), "~/.sellme/bin/sellme", "sellme"];

const allow = (reason = "ok") => ({ decision: "allow", reason });
const deny = (reason) => ({ decision: "deny", reason });

function gateHelper(command, state) {
  const words = shellWords(command);
  if (!words?.length) return deny("Run the Sellme helper on its own, with no pipes or redirects. Put text in single quotes.");
  if (!helperNames().includes(words[0])) return deny("A run can only use the Sellme helper from the shell.");
  const [sub, ...rest] = words.slice(1);
  if (sub === "sent") {
    const item = state.queue.find((q) => q.id === rest[0]);
    if (!item?.send_cleared) return deny("I didn't see that message go out in a run, so it can't be marked sent.");
    return allow();
  }
  if (sub === "brief" && !rest.includes("--peek")) return deny("Nobody is reading this run, so use brief --peek and leave the notes unread.");
  if (!HELPER[sub]) return deny(`A run can't use “${sub ?? ""}”. That belongs to the user.`);
  // Name what's allowed, so one refused form isn't read as "this whole command is off limits".
  if (!HELPER[sub](rest.filter((w) => !w.startsWith("--")))) return deny(`A run can't use “${[sub, rest[0]].filter(Boolean).join(" ")}”. ${RUN_FORMS[sub] ?? "That form belongs to the user."}`);
  return allow();
}

/** Every string in a tool's input, however deep. */
function strings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/** One form for an address, however it's written: an email, a phone number, or a LinkedIn profile or its id. */
export function contactKey(handle) {
  const h = String(handle).trim();
  if (/@/.test(h)) return h.toLowerCase();
  const profile = h.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  if (profile) return `in:${decodeURIComponent(profile[1]).toLowerCase()}`;
  if (/^\+?[\d\s().-]{7,}$/.test(h)) return h.replace(/\D/g, "").slice(-10);
  return `in:${h.toLowerCase()}`;
}

const looksLikeContact = (v) => /^[^\s@]+@[^\s@]+$/.test(v) || /^\+?[\d\s().-]{7,}$/.test(v) || /linkedin\.com\/in\//i.test(v);

const MIME = { ".pdf": "application/pdf", ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".txt": "text/plain", ".md": "text/markdown", ".rtf": "application/rtf" };

/** The resume file, ready for an email tool. The gate puts it in, so it's always the user's own file, unchanged. */
export function resumeAttachment(state) {
  const file = state.profile.resume_file;
  if (!file) return { refused: "There's no resume file set, so nothing can be attached." };
  try {
    const bytes = fs.readFileSync(file);
    if (bytes.length > 10 * 1024 * 1024) return { refused: "The resume file is over 10 MB, too big to attach." };
    return { attachment: { filename: path.basename(file), mimeType: MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream", content: bytes.toString("base64") } };
  } catch {
    return { refused: `I can't read the resume at ${file}. Set it again with: sellme profile set resume <file>` };
  }
}

function matchSend(input, state) {
  const { attachments, subject, ...rest } = input ?? {};
  const values = strings(rest).map((v) => v.trim());
  const copies = Object.entries(input ?? {}).filter(([k]) => /^(cc|bcc)$/i.test(k)).flatMap(([, v]) => strings(v)).filter(Boolean);
  if (copies.length) return { refused: "An approved message goes only to its one address, with nobody copied." };
  for (const item of state.queue.filter((q) => q.status === "approved" && q.text === q.approved_text && !state.paused)) {
    if (!values.includes(item.approved_text.trim())) continue;
    const others = values.filter((v) => v && v !== item.approved_text.trim());
    if (item.to) {
      const named = Object.entries(input ?? {}).filter(([k]) => /^(to|recipients?|phone|number|address|email|handle|linkedin_username|username|profile_urn)/i.test(k)).flatMap(([, v]) => strings(v)).filter(Boolean);
      if ([...named, ...others.filter(looksLikeContact)].some((v) => contactKey(v) !== contactKey(item.to))) return { refused: `That was approved for ${item.to} only.` };
    }
    // Ids are fine. A second field with words in it could say anything, like a subject line.
    if (others.some((v) => /\s/.test(v) && !looksLikeContact(v))) return { refused: "An approved message goes out with nothing added to it." };
    // A new email needs a subject. It may only be the one the outbox gave, never words the run chose.
    if (subject !== undefined && subject !== "" && !(item.channel === SELF && subject === emailSubject(state, item))) return { refused: "That subject line wasn't approved. Use the outbox's subject, or reply in the thread with none." };
    const files = Array.isArray(attachments) ? attachments : attachments ? [attachments] : [];
    if (item.attach !== "file") return files.length ? { refused: "Nothing was approved to go with that message, so it can't carry attachments." } : { item };
    const how = `This one goes with the user's resume. Add attachments: [{"filename": "<the outbox attach filename>", "content": "${ATTACH_TOKEN}"}], and I attach the file.`;
    if (files.length !== 1 || files[0]?.content !== ATTACH_TOKEN) return { refused: how };
    const { attachment, refused } = resumeAttachment(state);
    if (!attachment) return { refused };
    return { item, attachments: [attachment] };
  }
  return { refused: "That isn't word for word a message the user approved." };
}

const READS = /^(tool_)?(get|list|search|read|find|fuzzy|check|query|fetch|lookup|resolve)/i;
const WRITES = /send|reply|forward|post|delete|create|update|remove|mark|label|trash|accept|decline|respond|connect|apply|upload|pause|draft|auth/i;
const SENDS = /send|reply/i;
const CHROME_READS = new Set(["tabs_context_mcp", "tabs_create_mcp", "tabs_close_mcp", "read_page", "get_page_text", "find"]);
const COMPUTER_READS = new Set(["screenshot", "wait", "scroll", "zoom", "scroll_to", "hover"]);
// What a chat box calls itself. A profile or search field can't take a message, and Enter there could save something.
const CHAT_BOX = /\b(ask|message|chat|reply|write|respond)\b/i;
const SEND_BUTTON = /^send\b/i;

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const isOrUnder = (host, parent) => Boolean(host && parent) && (host === parent || host.endsWith(`.${parent}`));
const catalogHosts = () => Object.values(CATALOG).map((e) => hostOf(e.signin));
const agentHost = (name) => hostOf(CATALOG[String(name).toLowerCase()]?.signin);

/** The approved browser message this tab can take, or none. Only that agent's own site qualifies. */
function browserItem(tabId, state, browser, run) {
  const host = browser?.tabs?.[tabId];
  return state.queue.find((q) => q.status === "approved" && q.channel === "browser" && q.text === q.approved_text && !state.paused && !(q.send_cleared && q.send_cleared.run === run) && isOrUnder(host, agentHost(q.agent)));
}

/** Typing into a chat: focus its box, type the approved words, press Enter or Send. Nothing else on a page. */
function gateComputer(input, state, browser, run) {
  const { action, tabId, ref, text, modifiers, repeat } = input ?? {};
  if (COMPUTER_READS.has(action)) return allow();
  const item = browserItem(tabId, state, browser, run);
  const typed = browser?.typed?.[tabId];
  const noChat = "A run can only type an approved message into that agent's chat. It can't click or type anything else.";
  if (!item) return deny(noChat);
  const kind = browser?.refs?.[tabId]?.[ref];
  if (action === "left_click" && !modifiers) {
    if (kind === "box") return allow();
    if (kind === "send" && typed === item.id) return { ...allow(), cleared: item.id };
    return deny("A run can only click a chat box it has read with read_page, or Send once the message is typed. Never a place on the screen.");
  }
  if (action === "type") return text === item.approved_text ? { ...allow(), typed: { tab: tabId, id: item.id } } : deny("That isn't word for word a message the user approved.");
  if (action === "key" && /^(Return|Enter)$/.test(text ?? "") && (repeat ?? 1) === 1) return typed === item.id ? { ...allow(), cleared: item.id } : deny("Type the approved message first.");
  return deny(noChat);
}

function gateMcp(toolName, input, state, run, browser) {
  const [, server, tool = ""] = toolName.match(/^mcp__(.+?)__(.+)$/) ?? [];
  if (server === "claude-in-chrome") {
    if (CHROME_READS.has(tool)) return allow();
    if (tool === "navigate") return catalogHosts().some((h) => isOrUnder(hostOf(input?.url), h)) ? allow() : deny("A run only opens pages in Sellme's catalog.");
    if (tool === "computer") return gateComputer(input, state, browser, run);
    if (tool === "browser_batch") return deny("Use the browser tools one step at a time, so each one can be checked.");
    return deny("A run can read pages, and type an approved message into a chat, and that's all.");
  }
  if (SENDS.test(tool)) {
    const { item, refused, attachments } = matchSend(input, state);
    if (!item) return deny(refused);
    if (item.send_cleared && item.send_cleared.run === run) return deny("This run already sent that. Read the thread to confirm it landed.");
    return { ...allow(), cleared: item.id, ...(attachments ? { updatedInput: { ...input, attachments } } : {}) };
  }
  if (READS.test(tool) && !WRITES.test(tool)) return allow();
  return deny("A run can read, but it can't change anything on your accounts.");
}

const insideSkill = (file) => {
  const resolved = path.resolve(String(file ?? "").replace(/^~(?=\/)/, os.homedir()));
  const roots = [path.join(os.homedir(), ".claude"), path.join(os.homedir(), ".codex"), path.join(home(), ".claude")];
  return roots.some((root) => resolved.startsWith(path.join(root, "skills", "sellme") + path.sep));
};

/**
 * The decision on one tool call.
 * @returns {{decision: "allow"|"deny", reason: string, cleared?: string, typed?: object}} cleared: the draft whose send was allowed
 */
export function gate({ tool_name: name, tool_input: input }, state, { run, browser } = {}) {
  if (name === "Bash") return gateHelper(input?.command, state);
  if (name === "Skill") return input?.skill === "sellme" ? allow() : deny("A run only uses Sellme's own skill.");
  if (["ToolSearch", "TodoWrite"].includes(name)) return allow();
  if (["Read", "Glob", "Grep"].includes(name)) return insideSkill(input?.file_path ?? input?.path) ? allow() : deny("A run only reads Sellme's own instructions.");
  if (String(name).startsWith("mcp__")) return gateMcp(name, input, state, run, browser);
  return deny(`A run can't use ${name}.`);
}

const activityPath = () => path.join(home(), "run.activity");

/** A plain word for what a run is reading, for the loading screen. Never any of its content. */
export function activityLabel(name, input) {
  if (name === "Bash") {
    const sub = shellWords(input?.command)?.[1];
    return { role: "Updating your pipeline and calls", draft: "Writing drafts", block: "Writing drafts", note: "Updating your activity", sent: "Sending what you approved" }[sub] ?? null;
  }
  const [, server = "", tool = ""] = String(name).match(/^mcp__(.+?)__(.+)$/) ?? [];
  if (!server) return null;
  if (server === "claude-in-chrome") {
    if (tool === "computer" && input?.action === "type") return "Sending what you approved";
    if (tool !== "navigate") return null;
    const host = hostOf(input?.url);
    return host ? `Reading ${Object.values(CATALOG).find((e) => isOrUnder(host, hostOf(e.signin)))?.name ?? "a website"}` : null;
  }
  if (SENDS.test(tool)) return "Sending what you approved";
  for (const [pattern, label] of [[/messages/i, "iMessage"], [/gmail|mail/i, "email"], [/calendar/i, "your calendar"], [/wispr/i, "your call notes"], [/notion|docs/i, "your notes"]]) if (pattern.test(server)) return `Reading ${label}`;
  const known = Object.values(CATALOG).find((e) => e.mcp?.name === server);
  return `Reading ${known?.name ?? server}`;
}

export const clearActivity = () => fs.rmSync(activityPath(), { force: true });

/** @returns {string[]} what this run has done so far, oldest first, without repeats */
export function readActivity() {
  try {
    return [...new Set(fs.readFileSync(activityPath(), "utf8").split("\n").filter(Boolean))];
  } catch {
    return [];
  }
}

// What this run has seen in the browser: each tab's real address, and which elements are chat boxes.
const browserPath = () => path.join(home(), "run.browser.json");

function loadBrowser(run) {
  try {
    const saved = JSON.parse(fs.readFileSync(browserPath(), "utf8"));
    if (saved.run === run) return saved;
  } catch {
    // Nothing seen yet.
  }
  return { run, tabs: {}, refs: {}, typed: {} };
}

const saveBrowser = (browser) => fs.writeFileSync(browserPath(), JSON.stringify(browser), { mode: 0o600 });

/** A page can't fake these: the address closes the line, however its title is worded. */
export function learnFromTool(call, browser) {
  const text = strings(call.tool_response).join("\n");
  for (const [, tab, url] of text.matchAll(/tabId (\d+): ".*" \("([^"\n]*)"\)$/gm)) {
    const host = hostOf(url);
    if (browser.tabs[tab] !== host) {
      browser.tabs[tab] = host;
      delete browser.refs[tab];
      delete browser.typed[tab];
    }
  }
  if (call.tool_name === "mcp__claude-in-chrome__read_page" && call.tool_input?.tabId !== undefined) {
    const refs = {};
    for (const [, role, name, ref] of text.matchAll(/^\s*(textbox|button) "([^"\n]*)" \[(ref_\d+)\]/gm)) {
      if (role === "textbox" && CHAT_BOX.test(name)) refs[ref] = "box";
      if (role === "button" && SEND_BUTTON.test(name)) refs[ref] = "send";
    }
    browser.refs[call.tool_input.tabId] = refs;
  }
  return browser;
}

/** `sellme agent-gate`: Claude Code's hook hands us the call on stdin, and this answers on stdout. */
export function gateHook(raw, { run = process.env.SELLME_RUN } = {}) {
  let call;
  try {
    call = JSON.parse(raw);
  } catch {
    return hookReply(deny("I couldn't read that tool call."));
  }
  const browser = loadBrowser(run);
  if (call.hook_event_name === "PostToolUse") {
    saveBrowser(learnFromTool(call, browser));
    return "";
  }
  const verdict = gate(call, load(), { run, browser });
  const label = verdict.decision === "allow" ? activityLabel(call.tool_name, call.tool_input) : null;
  if (label) fs.appendFileSync(activityPath(), `${label}\n`, { mode: 0o600 });
  if (verdict.typed) {
    browser.typed[verdict.typed.tab] = verdict.typed.id;
    saveBrowser(browser);
  }
  if (verdict.cleared) {
    withState((s) => {
      const item = s.queue.find((q) => q.id === verdict.cleared);
      item.send_cleared = { run, ts: new Date().toISOString() };
    });
    const tab = call.tool_input?.tabId;
    if (tab !== undefined) {
      delete browser.typed[tab];
      saveBrowser(browser);
    }
  }
  return hookReply(verdict);
}

// updatedInput: the gate's own copy of the call, with the resume's bytes where the run wrote the placeholder.
const hookReply = ({ decision, reason, updatedInput }) => JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason, ...(updatedInput ? { updatedInput } : {}) } });

const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
export const entryPoint = () => path.join(PKG_ROOT, "bin", "sellme.js");

/** The hook, in a file: a long JSON argument wouldn't survive Windows' command line. */
export function runSettings() {
  const command = `${quote(process.execPath)} ${quote(entryPoint())} agent-gate`;
  const hook = (matcher) => ({ matcher, hooks: [{ type: "command", command }] });
  const file = path.join(home(), "run.settings.json");
  fs.mkdirSync(home(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ hooks: { PreToolUse: [hook("*")], PostToolUse: [hook("mcp__claude-in-chrome__.*")] } }), { mode: 0o600 });
  return file;
}

/** The agent's own instructions, in a file for the same reason as the hook: Windows' command line mangles long text. */
export function personaFile() {
  const file = path.join(home(), "run.persona.md");
  fs.mkdirSync(home(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${PERSONA_PREAMBLE}\n`, { mode: 0o600 });
  return file;
}

export function agentArgs(prompt, { chrome = false, settings = runSettings(), persona = personaFile() } = {}) {
  return ["-p", prompt, "--append-system-prompt-file", persona, "--permission-mode", "dontAsk", "--settings", settings, "--no-session-persistence", ...(chrome ? ["--chrome"] : [])];
}

/** @returns {Promise<{ok: boolean, output: string, stopped?: boolean, failed?: string}>} */
export function runAgent(prompt, { signal, timeout = SEND_TIMEOUT_MS, env = process.env, spawnFn = spawn } = {}) {
  if (!canRun(env.PATH)) return Promise.resolve({ ok: false, output: "", failed: "Claude Code isn't on this machine" });
  const chrome = load().agents.some((a) => a.channel === "browser");
  return new Promise((resolve) => {
    // Its own folder, so a project's instructions can't colour a run. SELLME_RUN ties the gate's calls together.
    fs.rmSync(browserPath(), { force: true });
    const tool = toolCommand("claude", agentArgs(prompt, { chrome }), { envPath: env.PATH });
    const child = spawnFn(tool.file, tool.args, { cwd: home(), env: { ...env, SELLME_RUN: crypto.randomUUID() }, stdio: ["ignore", "pipe", "pipe"], signal, timeout, windowsHide: true, windowsVerbatimArguments: tool.verbatim });
    let output = "";
    const take = (d) => {
      if (output.length < MAX_OUTPUT) output += d;
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (err) => resolve({ ok: false, output, ...(err.name === "AbortError" ? { stopped: true } : { failed: "Claude Code wouldn't start" }) }));
    child.on("close", (code, killed) => resolve({ ok: code === 0, output, ...(signal?.aborted ? { stopped: true } : killed ? { failed: "It took too long" } : code ? { failed: "Claude Code couldn't finish (it may need you to sign in)" } : {}) }));
  });
}

const clean = (s) => String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "").trim();

/** Sends everything approved, then reads back what really happened. Only `sent` takes a row off the list. */
export async function sendOutbox(id, { signal, runner = runAgent } = {}) {
  const result = await runner("/sellme send", { signal });
  const item = load().queue.find((q) => q.id === id);
  if (item?.status === "sent") return { sent: true, to: item.agent };
  if (result.stopped) return { stopped: true };
  // The run's own last words can be long, or a question nobody's there to answer. They go to the log, not the screen.
  const said = clean(result.output).split("\n").filter(Boolean).slice(-6).join(" ").slice(0, 600);
  return { sent: false, why: result.failed ?? null, said };
}

/** A check started by hand, left running after the app moves on. */
export function startCheckInBackground(spawnFn = spawn, env = process.env) {
  const child = spawnFn(process.execPath, [entryPoint(), "scheduled-run"], { detached: true, stdio: "ignore", env, cwd: home(), windowsHide: true });
  child.unref();
}


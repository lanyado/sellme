// `sellme` in a terminal: one screen with tabs, so nobody has to remember a command or a flag.
// What each tab shows is plain functions, so tests can check it without a terminal.
import { canRun, canSendOn, clearActivity, readActivity, sendOutbox, startCheckInBackground } from "./agent.js";
import * as core from "./core.js";
import { ADD, addFlow, ask, attempt, buildRows, detailFlow, draw, listScreen, move, offerClicks, readKey, refreshConnections, removeFlow, selectable, takeOffered, useLogo, whileWorking } from "./picker.js";
import * as view from "./render.js";
import { openUrl } from "./open.js";
import fs from "node:fs";
import path from "node:path";
import { cleanPath, findResume, findTool, readResume, rewrite } from "./rewrite.js";
import { SCHEDULES, scheduleWarning, scheduledRun, setSchedule } from "./schedule.js";
import { audit, load, withState } from "./store.js";

export const TABS = ["Drafts", "Agents", "Pipeline", "Schedule", "Activity"];
const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, Math.max(n - 1, 1))}…` : t;
};
const time = (iso) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The one line that says what's going on, on every tab. */
export function summary(state) {
  const drafts = core.openItems(state).filter((q) => !q.handled).length;
  const toConnect = core.connectList(state).filter((i) => i.blocking).length;
  const yours = state.queue.filter((q) => q.status === "yours").length;
  const waiting = core.outbox(state).length;
  const parts = [];
  if (state.paused) parts.push(state.hired ? "Hired, so agents are paused" : "Paused, nothing goes out");
  if (drafts) parts.push(`${drafts} draft${drafts === 1 ? "" : "s"} need${drafts === 1 ? "s" : ""} you`);
  if (yours) parts.push(`${yours} need${yours === 1 ? "s" : ""} an address`);
  if (waiting) parts.push(`${waiting} approved, not sent yet`);
  if (toConnect) parts.push(`${toConnect} to connect`);
  if (state.alerts.length) parts.push(`${state.alerts.length} alert${state.alerts.length === 1 ? "" : "s"}`);
  if (!parts.length) parts.push("Nothing needs you. SELLME is selling you");
  parts.push(state.last_run ? `checked ${time(state.last_run)}` : "not checked yet");
  return parts.join(" · ");
}

export function draftRows(state) {
  const rows = [];
  const all = core.openItems(state);
  const open = all.filter((q) => !q.handled);
  const done = all.filter((q) => q.handled);
  if (open.length) rows.push({ heading: "Needs you" });
  for (const q of open) rows.push({ id: q.id, draft: true, mark: q.status !== "blocked" ? (q.sensitive ? "!" : "○") : onlyYours(q) ? "?" : "✗", agent: q.agent, text: q.suggestion ?? q.text ?? q.asked, flag: q.instructions ? "note for the AI" : null });
  if (done.length) rows.push({ heading: "Looks handled already · x clears these" });
  for (const q of done) rows.push({ id: q.id, draft: true, handled: true, mark: "≈", agent: q.agent, text: q.handled.reason });
  const yours = state.queue.filter((q) => q.status === "yours");
  if (yours.length) rows.push({ heading: "Approved, no address to send to" });
  for (const q of yours) rows.push({ id: q.id, yours: true, mark: "→", agent: q.agent, text: q.approved_text });
  const waiting = core.outbox(state);
  if (waiting.length) rows.push({ heading: "Approved, not sent yet" });
  for (const q of waiting) rows.push({ id: q.id, approved: true, mark: "✓", agent: q.agent, text: q.text });
  return rows;
}

/** A question only the user can answer, as opposed to a draft that failed the check. */
export const onlyYours = (q) => q.status === "blocked" && (q.suggestion != null || !q.text || (q.check?.reasons ?? []).every((r) => r.code === "agent_block"));

/** What would go back for a question only the user can answer. */
export const replyFor = (q) => q.suggestion ?? (q.status === "blocked" ? q.text : null) ?? null;

const RESUME_TALK = /\b(resume|résumé|cv|curriculum vitae|attach(ed|ing|ment)?)\b/i;

/** "Attach my resume" only when the conversation is about one. */
export const resumeRelevant = (q) => Boolean(q.attach) || RESUME_TALK.test([q.asked, q.text, q.suggestion].filter(Boolean).join(" "));

/** Which keys a draft offers. A question only the user can answer comes with a suggested reply to send or edit. */
export function draftActions(q) {
  let first;
  if (q.status === "blocked") {
    const reply = replyFor(q);
    const failed = !onlyYours(q); // The AI's own draft, and the check caught something in it.
    first = [];
    if (reply && !failed) first.push({ key: "y", id: "send", label: q.sensitive ? "Send this (asks you to confirm)" : "Send this" });
    first.push({ key: "e", id: "edit", label: reply ? "Edit it" : "Write it" });
    if (reply && failed) first.push({ key: "y", id: "send", label: "Send it anyway: you vouch for every word" });
  } else first = [{ key: "y", id: "approve", label: q.sensitive ? "Approve and send (asks you to confirm)" : "Approve and send" }, { key: "e", id: "edit", label: "Edit" }];
  const resume = resumeRelevant(q) ? [{ key: "p", id: "attach", label: q.attach ? "Take the resume off" : "Attach my resume" }] : [];
  // Blocked only for saying "attached": attaching is the fix, so it comes first.
  if (q.check?.reasons?.length && q.check.reasons.every((r) => r.code === "no_attachment")) first = [...resume, ...first.filter((a) => a.id === "edit")];
  else first = [...first, ...resume];
  return [...first, { key: "i", id: "instruct", label: "Tell the AI what to change" }, { key: "s", id: "skip", label: "Skip" }, { key: "b", id: "back", label: "Back" }];
}

export function pipelineRows(state, today = new Date()) {
  const rows = [];
  const sections = [["Hired", "hired"], ["Offer", "offer"], ["Interview", "interview"], ["Talking", "talking"], ["New", "new"], ["Rejected", "rejected"], ["Passed", "passed"]];
  for (const [title, stage] of sections) {
    const roles = state.roles.filter((r) => r.stage === stage);
    if (!roles.length) continue;
    rows.push({ heading: `${title} (${roles.length})` });
    // Whatever's coming up soonest goes first.
    const soonest = (r) => (core.upcomingCall(r, today) ? new Date(r.next_call).getTime() : Infinity);
    for (const r of [...roles].sort((a, b) => soonest(a) - soonest(b))) rows.push({ id: r.id, role: true, text: r.title ? `${r.company}, ${r.title}` : r.company, detail: r.agent ?? "", call: core.upcomingCall(r, today) });
  }
  return rows;
}

/** What can be done to a role from the Pipeline tab. Nothing goes out without its own yes on the next screen. */
export function roleActions(role) {
  if (role.stage === "hired") return [{ key: "b", id: "back", label: "Back" }];
  const live = ["rejected", "passed"].includes(role.stage)
    ? []
    : [
        { key: "n", id: "nudge", label: "Nudge: ask for an update" },
        { key: "f", id: "followup", label: "Follow up: say what you want, and the AI writes it" },
        { key: "c", id: "call", label: role.next_call ? "Change the next call" : "Set the next call" },
      ];
  return [...live, { key: "m", id: "move", label: "Move to another stage" }, { key: "d", id: "delete", label: "Delete" }, { key: "b", id: "back", label: "Back" }];
}

export function scheduleRows(state) {
  const every = state.schedule?.every ?? null;
  const pilot = core.autopilotOn(state);
  const rows = [
    { heading: "Autopilot" },
    { id: "pilot-on", autopilot: true, mark: pilot ? "●" : "○", text: "On: I send what I’m sure of, and ask you the rest" },
    { id: "pilot-off", autopilot: false, mark: pilot ? "○" : "●", text: "Off: I ask before every message" },
    { heading: "Check my agents" }, { id: "off", every: "off", mark: every ? "○" : "●", text: "Off: only when I open Sellme or press r" }];
  for (const s of SCHEDULES) rows.push({ id: s.id, every: s.id, mark: every === s.id ? "●" : "○", text: s.label });
  rows.push({ heading: "Right now" }, { id: "now", runNow: true, mark: "→", text: "Run a check now" });
  return rows;
}

export function activityRows(state) {
  const rows = [];
  if (state.alerts.length) rows.push({ heading: "Alerts" });
  for (const a of state.alerts) rows.push({ id: a.id, alert: true, mark: "!", text: `${a.agent ? `${a.agent}: ` : ""}${a.text}` });
  const notes = state.notes.slice(-50).reverse();
  if (notes.length) rows.push({ heading: "What happened" });
  for (const n of notes) rows.push({ id: n.id, mark: " ", text: `${time(n.ts)}  ${n.agent}: ${n.text}` });
  return rows;
}

// Reopening the app a moment later shouldn't spend the user's plan on the same check again.
const SYNC_FRESH_MS = 10 * 60_000;

/** Opening the app syncs first, unless there's nothing to sync with or it only just did. */
export function shouldSync(state, { today = new Date(), can = canRun() } = {}) {
  if (!can || state.paused || !view.setupSteps(state).every((step) => step.done)) return false;
  return !state.last_run || today - new Date(state.last_run) >= SYNC_FRESH_MS;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What a sync changed, in a line. */
export function syncSummary(before, after, today = new Date()) {
  const known = new Set(before.queue.map((q) => q.id));
  const then = new Map(before.roles.map((r) => [r.id, r]));
  const parts = [];
  const requests = core.openItems(after).filter((q) => !known.has(q.id)).length;
  const alerts = after.alerts.length - before.alerts.length;
  const sent = after.queue.filter((q) => q.status === "sent" && before.queue.find((b) => b.id === q.id)?.status !== "sent").length;
  const calls = after.roles.filter((r) => core.upcomingCall(r, today) && then.get(r.id)?.next_call !== r.next_call).length;
  const rejected = after.roles.filter((r) => r.stage === "rejected" && then.get(r.id)?.stage !== "rejected").length;
  const matches = after.roles.filter((r) => !then.has(r.id) && r.stage === "new").length;
  if (requests) parts.push(`${plural(requests, "new request")} for you`);
  if (alerts > 0) parts.push(plural(alerts, "alert"));
  if (calls) parts.push(`${plural(calls, "call")} scheduled`);
  if (rejected) parts.push(plural(rejected, "rejection"));
  if (matches) parts.push(plural(matches, "new match").replace("matchs", "matches"));
  if (sent) parts.push(`${sent} sent`);
  return parts.length ? parts.join(" · ") : "Nothing new";
}

const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

export function syncScreen(frame, seconds, done, c) {
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const seen = done.slice(-12);
  const lines = seen.map((label, i) => (i === seen.length - 1 ? `  ${c.lime(SPINNER[frame % SPINNER.length])} ${label}…` : `  ${c.lime("✓")} ${c.muted(label)}`));
  return [view.logo(c), "", `${c.lime(SPINNER[frame % SPINNER.length])} Selling you to every agent  ${c.muted(clock)}`, ...(lines.length ? ["", ...lines] : []), "", c.muted("Reading new messages, booked calls, rejections and follow-ups, and answering what I’m sure of."), c.muted("esc to skip and open the app")].join("\n");
}

/** Keeps the cursor in view on a list longer than the terminal. */
/** The first line `windowed` shows, so a click can be matched back to its row. */
export function windowStart(length, cursorLine, height) {
  if (length <= height) return 0;
  const room = Math.max(height - 2, 1);
  return Math.min(Math.max(cursorLine - Math.floor(room / 2), 0), length - room);
}

export function windowed(lines, cursorLine, height) {
  if (lines.length <= height) return lines;
  const room = Math.max(height - 2, 1);
  const start = windowStart(lines.length, cursorLine, height);
  const out = lines.slice(start, start + room);
  if (start > 0) out.unshift(`  ↑ ${start} more`);
  if (start + room < lines.length) out.push(`  ↓ ${lines.length - start - room} more`);
  return out;
}

/** Where each tab's name sits on the tab bar, for clicks. */
export function tabSpots() {
  let at = 0;
  return TABS.map((t) => {
    const spot = { tab: t, from: at, to: at + t.length + 3 }; // The space before the next tab counts too.
    at = spot.to;
    return spot;
  });
}

export function tabBar(active, c) {
  return TABS.map((t) => (t === active ? c.lime(c.bold(`[${t}]`)) : c.muted(` ${t} `))).join(" ");
}

/** One role on one line, however narrow the terminal: a wrapped line would throw off the scrolling. */
export function pipelineLine(row, pointer, c, width = 100) {
  const call = row.call ? `Next call ${time(row.call)}` : "";
  const room = Math.max(width - call.length - 8, 8);
  const detail = clip(row.detail, Math.max(room - 20, 0));
  const right = call.length + detail.length + (call && detail ? 3 : 0);
  const nameWidth = Math.max(Math.min(50, width - right - 4), 12);
  return `${pointer} ${clip(row.text, nameWidth).padEnd(nameWidth + (nameWidth >= 50 ? 2 : 1))}${[call ? c.lime(call) : null, detail ? c.muted(detail) : null].filter(Boolean).join(c.muted(" · "))}`;
}

const PREVIEW = 60; // A glance, not the message: the card has the rest.

/** One draft on one line: who, a short preview, and a tag, never wrapping onto a second line. */
export function draftLine(row, pointer, c, width = 100) {
  const tag = row.flag ? ` · ${row.flag}` : "";
  const room = Math.max(Math.min(PREVIEW, width - 24 - tag.length), 10);
  return `${pointer} ${row.mark} ${clip(row.agent, 14).padEnd(16)}${c.muted(clip(row.text, room))}${tag ? c.violet(tag) : ""}`;
}

/** The keys for a tab, dropping the ones everyone knows first if the terminal is narrow. */
export function footerLine(tab, width = 100) {
  const keys = (nav) => [...nav, FOOTERS[tab], "r check now", "q quit"].filter(Boolean).join(" · ");
  const full = keys(["←→ tabs", "↑↓ move or click"]);
  return clip(full.length < width ? full : keys([]), width - 1);
}

function bodyLines(tab, state, rows, cursor, c, width) {
  if (tab === "Agents") {
    const lines = listScreen(rows, cursor, c).split("\n").slice(2, -1);
    lines.rowAt = new Map(takeOffered().map((t) => [t.line - 2, t.value.row]));
    return lines;
  }
  if (!rows.length) {
    if (tab === "Drafts") return [`${c.lime("✓")} No drafts. Press r to check your agents now.`];
    if (tab === "Pipeline") return [c.muted("Nothing in the pipeline yet.")];
    return [c.muted("Nothing yet.")];
  }
  const out = [];
  out.rowAt = new Map();
  rows.forEach((row, i) => {
    if (row.heading) {
      if (out.length) out.push("");
      out.push(c.muted(row.heading.toUpperCase()));
      return;
    }
    out.rowAt.set(out.length, i);
    const pointer = i === cursor ? c.lime("❯") : " ";
    if (tab === "Pipeline") out.push(pipelineLine(row, pointer, c, width));
    else if (tab === "Drafts") out.push(draftLine(row, pointer, c, width));
    else out.push(`${pointer} ${row.mark} ${clip(row.text, width - 6)}`);
  });
  if (tab === "Schedule") {
    const last = state.schedule_last;
    out.push("", c.muted(clip(core.autopilotOn(state) ? "Each check sells you to every agent: it answers what it’s sure of and saves the rest for you." : "Each check sells you to every agent, with drafts that wait for your yes.", width - 2)));
    if (last) out.push("", last.ok ? c.muted(`Last check: ${time(last.at)}`) : c.red(`✗ Last check, ${time(last.at)}: ${last.why ?? "it didn’t finish"}`));
  }
  return out;
}

const FOOTERS = {
  Drafts: "enter open",
  Agents: "enter select · a create · d remove",
  Pipeline: "enter actions · n nudge · f follow up · c next call · m move · d delete",
  Schedule: "enter select",
  Activity: "enter dismiss an alert",
};

function screen(tab, state, rows, cursor, c, message) {
  const width = process.stdout.columns || 100;
  const height = process.stdout.rows || 30;
  const body = bodyLines(tab, state, rows, cursor, c, width);
  const cursorLine = body.findIndex((line) => line.includes("❯"));
  const logoHeight = view.logo(c, width, height).split("\n").length + 1;
  const reserved = 6 + logoHeight + (message ? String(message).split("\n").length + 1 : 0);
  const start = windowStart(body.length, Math.max(cursorLine, 0), height - reserved);
  const shown = windowed(body, Math.max(cursorLine, 0), height - reserved);
  const above = start > 0 ? 1 : 0; // The "↑ n more" line.
  const top = 3; // Tabs, summary, blank.
  const targets = tabSpots().map((spot) => ({ line: 0, from: spot.from, to: spot.to, value: { tab: spot.tab } }));
  for (const [line, row] of body.rowAt ?? []) {
    const at = line - start + above;
    if (line >= start && at < shown.length && !/^\s+[↑↓] \d+ more$/.test(shown[at])) targets.push({ line: top + at, value: { row } });
  }
  offerClicks(targets);
  const out = [tabBar(tab, c), c.muted(clip(summary(state), width - 2)), "", ...shown, ""];
  if (message) out.push(message, "");
  out.push(c.muted(footerLine(tab, width)));
  return out.join("\n");
}

// ---------------------------------------------------------------- the terminal part
function draftScreen(q, actions, cursor, c, position, message) {
  return menuScreen(view.card(q, c, position), actions, cursor, c, message);
}

function menuScreen(header, actions, cursor, c, message) {
  const out = [header, ""];
  const skip = String(header).split("\n").length + 1;
  offerClicks(actions.map((a, i) => ({ line: skip + i, value: { action: i } })));
  actions.forEach((a, i) => out.push(`${i === cursor ? c.lime("❯") : " "} ${c.lime(`[${a.key}]`)} ${a.label}`));
  out.push("");
  if (message) out.push(message, "");
  out.push(c.muted("↑↓ move · enter, a letter or a click to choose · esc back"));
  return out.join("\n");
}

const nextOpen = (afterId) => {
  const open = core.openItems(load());
  const at = open.findIndex((q) => Number(q.id.slice(1)) > Number(afterId.slice(1)));
  return open[at]?.id ?? null;
};

async function showHandoff(item, c) {
  draw(`${c.lime("✓")} ${view.handoff(item)}\n${c.muted("Press any key.")}`);
  const key = await readKey();
  return key === "quit" ? "quit" : null;
}

const TRACK = 22;
const HOW = { browser: "in Chrome", email: "by email", imessage: "by iMessage", linkedin: "on LinkedIn", mcp: "" };

/**
 * One frame of the send animation: the message flies from you to them and loops until it lands.
 * @param done it landed, so the trail runs all the way
 */
export function flightFrame(frame, to, c, { done = false } = {}) {
  const at = done ? TRACK : frame % (TRACK + 1);
  const trail = c.lime("━".repeat(at));
  const ahead = c.muted("·".repeat(Math.max(TRACK - at - (done ? 0 : 1), 0)));
  const plane = done ? "" : c.lime(c.bold("✉"));
  const end = done ? c.lime(c.bold(`✓ ${to}`)) : c.bold(to);
  return `  you ${trail}${plane}${ahead} ${end}`;
}

/** Where the user can attach the file themselves: their chat with that person. */
export function chatLink(q) {
  const route = q.channel === "self" ? core.personRoute(q.to) : q.channel;
  if (route === "linkedin") {
    const id = String(q.to).match(/linkedin\.com\/in\/([^/?#\s]+)/i)?.[1] ?? q.to;
    return `https://www.linkedin.com/in/${id}/`;
  }
  if (route === "imessage") return `imessage://${String(q.to).replace(/[^\d+@.\w-]/g, "")}`;
  return null;
}

/** After a message that says the resume is attached went somewhere that can't carry one. @returns a warning */
async function attachYourself(q, c) {
  const link = chatLink(q);
  const opened = link ? await openUrl(link) : false;
  const where = core.personRoute(q.to) === "linkedin" ? "LinkedIn" : "Messages";
  return c.violet(`! Now attach your resume yourself: ${opened ? `I opened your chat with ${q.agent} in ${where}.` : `open your chat with ${q.agent} in ${where}.`} It couldn’t go with the message.`);
}

/** If a reply says the resume is attached, put it on before it goes. @returns an error message, or null */
function attachIfSaid(id, text, c) {
  if (!/\b(attached|attaching|enclosed)\b/i.test(text ?? "")) return null;
  const q = load().queue.find((x) => x.id === id);
  if (q.attach) return null;
  const done = attempt(() => withState((s) => core.attachResume(s, id)), c);
  return done.error ? done.message : null;
}

/** Sends on the same screen as the yes, with the message flying across while it goes. @returns a message */
async function sendHere(id, c) {
  const q = load().queue.find((x) => x.id === id);
  if (!canSendOn(q)) return `${c.lime("✓")} Approved. ${q.agent} has no chat to reply in, so it waits until there’s a way to send it.`;
  if (!canRun()) return `${c.lime("✓")} Approved. This needs Claude Code to send from here, so your next /sellme sends it.`;
  const route = q.channel === "self" ? core.personRoute(q.to) : q.channel;
  const how = HOW[route] ? ` ${HOW[route]}` : "";
  const started = Date.now();
  let frame = 0;
  const paint = (status, opts) => draw(`${view.card(q, c)}\n\n${flightFrame(frame++, q.agent, c, opts)}\n\n${status}`, { still: frame > 1 });
  const tick = () => paint(c.muted(`Selling you to ${q.agent}${how}… ${Math.floor((Date.now() - started) / 1000)}s · esc to stop`));
  tick();
  const timer = setInterval(tick, 90);
  let result;
  try {
    result = await whileWorking((signal) => sendOutbox(id, { signal }));
  } finally {
    clearInterval(timer);
  }
  audit({ event: "send_tried", id, sent: Boolean(result.sent), by: "keyboard", ...(result.said ? { said: result.said } : {}) });
  if (result.sent) {
    paint(`${c.lime(c.bold("Sent."))} ${c.muted("SELLME keeps selling you.")}`, { done: true });
    await new Promise((resolve) => setTimeout(resolve, 900)); // Long enough to see it land.
    const sent = load().queue.find((x) => x.id === id);
    const out = [`${c.lime("✓")} Sent to ${result.to}.${sent?.remembered ? " I saved your answer, so I’ll know it next time." : ""}`];
    if (sent?.attach === "manual") out.push(await attachYourself(sent, c));
    return out.join("\n");
  }
  if (result.stopped) return "Stopped. It’s still on your list.";
  return c.red(`✗ Couldn’t send it${result.why ? `: ${result.why}` : ""}. It’s still on your list.`);
}

/** Answers a note on the same screen, so nobody has to go back to their AI tool for it. @returns a message */
async function rewriteHere(id, c, { choice = false } = {}) {
  const state = load();
  const q = state.queue.find((x) => x.id === id);
  draw(`${view.card(q, c)}\n\n${c.muted("Rewriting… esc to stop")}`);
  const result = await whileWorking((signal) => rewrite(state, q, { signal }));
  const saved = "Your note is saved, so /sellme can still do it.";
  if (result.failed === "stopped") return `Stopped. ${saved}`;
  if (result.failed) return c.red(`✗ ${result.failed}. ${saved}`);
  if (result.refused) return c.violet(`! ${result.refused}`);
  const done = attempt(() => {
    const item = withState((s) => core.applyRewrite(s, id, result, { choice }));
    audit({ event: "rewritten", id, tool: result.tool, by: "keyboard" });
    return item;
  }, c);
  if (done.error) return done.message;
  return done.message.status === "blocked" ? c.red("✗ The new version failed the check, so read why above.") : `${c.lime("✓")} Rewritten. Read it, then approve or change it.`;
}

/** Puts the resume on a draft, asking once for the file, or for a link where only a link can go. @returns a message */
async function attachHere(q, c) {
  if (q.attach) {
    withState((s) => core.attachResume(s, q.id, false));
    return "Resume taken off.";
  }
  const profile = load().profile;
  if (core.carriesFiles(q) && !profile.resume_file) {
    const typed = await ask("\nYour resume file. Drag it here, or type where it is:\n", findResume() ?? "");
    if (!typed) return null;
    const file = path.resolve(cleanPath(typed));
    if (!fs.existsSync(file)) return c.red(`✗ There’s no file at ${file}.`);
    withState((s) => core.setResume(s, { file }));
  }
  if (!core.carriesFiles(q) && !profile.resume_link) {
    const typed = await ask(`\n${q.agent} can’t get a file this way, so I’ll send a link to your resume.\nPaste a link to it (Google Drive, Dropbox or your site), once:\n`);
    if (!typed) return null;
    const done = attempt(() => withState((s) => core.setResume(s, { link: typed })), c);
    if (done.error) return done.message;
  }
  const done = attempt(() => {
    const item = withState((s) => core.attachResume(s, q.id));
    audit({ event: "attached_resume", id: q.id, how: item.attach, by: "keyboard" });
    return item;
  }, c);
  if (done.error) return done.message;
  return done.message.attach === "file" ? `${c.lime("✓")} Your resume goes with this email. Approve to send both.` : `${c.lime("✓")} Added the link to your resume. Approve to send it.`;
}

/** One draft at a time, moving on by itself, until the user leaves or nothing's left. @returns "quit" or a message */
/** Writes the reply the user would most likely send to a question only they can answer. @returns a message, or null */
async function suggestHere(id, c) {
  const state = load();
  const q = state.queue.find((x) => x.id === id);
  draw(`${view.card(q, c)}\n\n${c.muted("Writing a suggested reply… esc to skip")}`);
  const result = await whileWorking((signal) => rewrite(state, q, { signal, suggest: true }));
  if (result.failed === "stopped") return null;
  if (result.failed || result.refused) return c.muted(`I couldn’t suggest one (${result.failed ?? result.refused}). Press e to write it.`);
  const done = attempt(() => withState((s) => core.setSuggestion(s, id, result.text, { by: "ai" })), c);
  return done.error ? done.message : null;
}

async function draftFlow(startId, c, { single = false } = {}) {
  let id = startId;
  let cursor = 0;
  let message;
  const tried = new Set(); // Suggest once per question, even if it fails.
  for (;;) {
    let state = load();
    let q = state.queue.find((x) => x.id === id);
    let open = core.openItems(state);
    if (!q || !open.includes(q)) return message ?? null;
    if (q.status === "blocked" && !q.text && !q.suggestion && !tried.has(q.id) && findTool()) {
      tried.add(q.id);
      message = (await suggestHere(q.id, c)) ?? message;
      state = load();
      q = state.queue.find((x) => x.id === id);
      open = core.openItems(state);
    }
    const actions = draftActions(q);
    cursor = Math.min(cursor, actions.length - 1);
    draw(draftScreen(q, actions, cursor, c, single ? "" : c.muted(`${open.indexOf(q) + 1} of ${open.length}`), message));
    message = undefined;
    const key = await readKey();
    if (key === "quit") return "quit";
    if (key === "escape") return null;
    if (key === "up") {
      cursor = (cursor - 1 + actions.length) % actions.length;
      continue;
    }
    if (key === "down") {
      cursor = (cursor + 1) % actions.length;
      continue;
    }
    if (key?.click) cursor = key.click.action;
    const action = key === "return" || key === "enter" || key?.click ? actions[cursor] : actions.find((a) => a.key === key);
    if (!action) continue;
    const advance = () => {
      id = single ? null : nextOpen(q.id);
      cursor = 0;
    };
    switch (action.id) {
      case "back":
        return null;
      case "skip":
        withState((s) => core.skip(s, q.id));
        audit({ event: "skip", id: q.id, by: "keyboard" });
        advance();
        break;
      case "send": {
        // The user's yes on a reply to a question only they can answer: it goes out as their own words.
        if (q.sensitive && (await ask("\nThis one is yours alone. Type yes to send: ")).toLowerCase() !== "yes") {
          message = "Not sent.";
          break;
        }
        const missing = attachIfSaid(q.id, replyFor(q), c);
        if (missing) {
          message = missing;
          break;
        }
        const result = attempt(() => {
          const item = withState((s) => core.answerYourself(s, q.id, replyFor(load().queue.find((x) => x.id === q.id)), { confirmSensitive: true }));
          audit({ event: "answered", id: q.id, suggested_by: q.suggested_by ?? null, by: "keyboard" });
          return item;
        }, c);
        if (result.error) {
          message = result.message;
          break;
        }
        if (result.message.status === "yours" && (await showHandoff(result.message, c)) === "quit") return "quit";
        return result.message.status === "approved" ? await sendHere(q.id, c) : null;
      }
      case "approve": {
        if (q.sensitive && (await ask("\nThis one is yours alone. Type yes to approve: ")).toLowerCase() !== "yes") {
          message = "Not approved.";
          break;
        }
        if (q.channel === "browser" && !canSendOn(q)) {
          message = `${q.agent} has no chat to reply in, so this can’t go out there. Reject it, and I’ll answer them where they write next.`;
          break;
        }
        if (q.channel === "browser") {
          const final = await chooseFlow(`${view.card(q, c)}\n\n${c.bold(`Final check: this goes to ${q.agent} through your Chrome, exactly as written.`)}`, [{ key: "y", id: "send", label: "Send it" }, { key: "n", id: "no", label: "Not yet" }], c);
          if (final === "quit") return "quit";
          if (final?.id !== "send") {
            message = "Not sent. It’s still a draft.";
            break;
          }
        }
        const item = withState((s) => core.approve(s, q.id, { confirmSensitive: q.sensitive }));
        audit({ event: "approved", id: q.id, by: "keyboard" });
        if (item.status === "yours" && (await showHandoff(item, c)) === "quit") return "quit";
        // Back to the screen it came from, with how the send went.
        return item.status === "approved" ? await sendHere(q.id, c) : null;
      }
      case "attach": {
        message = await attachHere(q, c);
        cursor = 0;
        break; // The message with the resume gets its own yes.
      }
      case "edit": {
        if (q.status === "blocked") {
          const text = await ask("\nEdit: ", replyFor(q) ?? "");
          if (!text) break;
          withState((s) => core.setSuggestion(s, q.id, text, { by: "you" }));
          audit({ event: "edit", id: q.id, by: "keyboard" });
          cursor = 0;
          break; // Back on the card, with "Send this" first.
        }
        const text = await ask("\nEdit: ", q.text);
        if (!text) break;
        withState((s) => core.editDraft(s, q.id, text));
        audit({ event: "edit", id: q.id, by: "keyboard" });
        cursor = 0;
        break; // Stay here, so the new text gets its own yes.
      }
      case "instruct": {
        const text = await ask("\nWhat should change? ");
        if (!text) break;
        withState((s) => core.instruct(s, q.id, text));
        audit({ event: "instructed", id: q.id, by: "keyboard" });
        message = q.status === "blocked" ? await suggestHere(q.id, c) : await rewriteHere(q.id, c);
        cursor = 0;
        break; // Stay here, so the new version gets its own yes.
      }
      default:
    }
    if (!id) return message ?? null;
  }
}

/** A small menu. @returns the chosen action, "quit", or null for esc */
async function chooseFlow(header, actions, c, message) {
  let cursor = 0;
  for (;;) {
    draw(menuScreen(header, actions, cursor, c, message));
    const key = await readKey();
    if (key === "quit") return "quit";
    if (key === "escape") return null;
    if (key === "up") cursor = (cursor - 1 + actions.length) % actions.length;
    else if (key === "down") cursor = (cursor + 1) % actions.length;
    else {
      if (key?.click) cursor = key.click.action;
      const action = key === "return" || key === "enter" || key?.click ? actions[cursor] : actions.find((a) => a.key === key);
      if (action) return action;
    }
  }
}

/** An approved message that hasn't gone yet. */
async function approvedFlow(id, c) {
  const q = load().queue.find((x) => x.id === id);
  const action = await chooseFlow(view.card(q, c), [{ key: "s", id: "send", label: "Send it now" }, { key: "e", id: "edit", label: "Edit (takes back the approval)" }, { key: "t", id: "back", label: "Take back the approval" }, { key: "b", id: "stay", label: "Back" }], c);
  if (action === "quit") return "quit";
  if (action?.id === "send") return sendHere(id, c);
  if (action?.id === "back") {
    withState((s) => core.takeBack(s, id));
    audit({ event: "took_back", id, by: "keyboard" });
    return "Taken back. It’s waiting for your yes again.";
  }
  if (action?.id === "edit") {
    const text = await ask("\nEdit: ", q.text);
    if (text) withState((s) => core.editDraft(s, id, text));
    return text ? draftFlow(id, c, { single: true }) : null;
  }
  return null;
}

/** Who a message about this role goes to. @returns a name, null to cancel, or "quit" */
async function recipientFor(role, c) {
  const state = load();
  if (role.agent && core.findAgent(state, role.agent)) return core.findAgent(state, role.agent).name;
  if (!state.agents.length) return null;
  const actions = state.agents.slice(0, 9).map((a, i) => ({ key: String(i + 1), id: a.name, label: a.name }));
  const action = await chooseFlow(`${c.bold(role.company)}\n\nWho should this go to?`, [...actions, { key: "b", id: "back", label: "Back" }], c);
  if (action === "quit") return "quit";
  return !action || action.id === "back" ? null : action.id;
}

/** Saves the message as a draft, then straight to its yes. An agent on auto-approve goes out by itself. */
async function draftForRole(role, agent, text, sources, c) {
  const made = attempt(() => {
    const item = withState((s) => {
      const saved = s.roles.find((r) => r.id === role.id);
      if (!saved.agent) saved.agent = agent;
      return core.addDraft(s, { agent, text, kind: "nudge", sources, company: role.company, role: role.id });
    });
    audit({ event: "role_message", id: item.id, role: role.id, by: "keyboard" });
    return item;
  }, c);
  if (made.error) return made.message;
  return made.message.status === "approved" ? sendHere(made.message.id, c) : draftFlow(made.message.id, c, { single: true });
}

async function followUp(role, agent, c) {
  const note = await ask(`\nWhat should it say to ${agent}? A few words: `);
  if (!note) return null;
  const state = load();
  const who = core.findAgent(state, agent);
  const what = role.title ? `the ${role.title} role at ${role.company}` : role.company;
  const known = state.notes.filter((n) => n.text.includes(role.company)).slice(-5).map((n) => n.text).join("\n");
  const q = { channel: who.channel, asked: known || null, text: null, sources: [], instructions: `Write a short follow-up to ${agent} about ${what}, which is at the "${role.stage}" stage. What the user wants to say: ${note}` };
  draw(`${c.bold(role.company)}\n\n${c.muted("Writing it… esc to stop")}`);
  const result = await whileWorking((signal) => rewrite(state, q, { signal }));
  if (result.failed === "stopped") return "Stopped.";
  if (result.refused) return c.violet(`! ${result.refused}`);
  if (result.failed) {
    const typed = await ask(`\n${result.failed}. Type the message yourself, or leave it empty to cancel: `);
    return typed ? draftForRole(role, agent, typed, [], c) : null;
  }
  return draftForRole(role, agent, result.text, result.sources, c);
}

async function moveRole(role, c) {
  const stages = core.STAGES.filter((s) => s !== role.stage && s !== "hired");
  const actions = stages.map((s, i) => ({ key: String(i + 1), id: s, label: s[0].toUpperCase() + s.slice(1) }));
  const action = await chooseFlow(`${c.bold(role.company)}\n\nMove it to:`, [...actions, { key: "b", id: "back", label: "Back" }], c);
  if (action === "quit") return "quit";
  if (!action || action.id === "back") return null;
  withState((s) => core.setRole(s, role.id, action.id));
  audit({ event: "role_moved", id: role.id, stage: action.id, by: "keyboard" });
  return `${c.lime("✓")} ${role.company} is now under ${action.label}.`;
}

async function setCall(role, c) {
  const typed = await ask(`\nWhen is the next call? Like Nov 5 2:00 PM${role.next_call ? ", or leave it empty to clear it" : ""}: `);
  if (!typed && !role.next_call) return null;
  const done = attempt(() => withState((s) => core.setNextCall(s, role.id, typed)), c);
  if (done.error) return done.message;
  audit({ event: "next_call", id: role.id, by: "keyboard" });
  return done.message.next_call ? `${c.lime("✓")} Next call: ${time(done.message.next_call)}.` : "Cleared.";
}

async function deleteRole(role, c) {
  // A closed role is what stops Sellme bringing that company up again, so losing it matters.
  const warn = ["rejected", "passed"].includes(role.stage) ? ` I’ll stop remembering not to bring ${role.company} up.` : "";
  const sure = await ask(`\nDelete ${role.company} from your pipeline?${warn} Messages aren’t touched. Type yes: `);
  if (sure.toLowerCase() !== "yes") return "Kept.";
  withState((s) => core.removeRole(s, role.id));
  audit({ event: "role_removed", id: role.id, by: "keyboard" });
  return `${c.lime("✓")} Deleted ${role.company}.`;
}

/** One role's actions. @param pressed a letter already typed on the list, so it skips the menu */
async function roleFlow(id, c, pressed) {
  const role = load().roles.find((r) => r.id === id);
  if (!role) return null;
  const actions = roleActions(role);
  const header = `${c.bold(role.title ? `${role.company}, ${role.title}` : role.company)}\n${c.muted(`${role.stage}${role.agent ? ` · ${role.agent}` : ""}${core.upcomingCall(role) ? ` · next call ${time(role.next_call)}` : ""}`)}`;
  const action = pressed ? actions.find((a) => a.key === pressed) : await chooseFlow(header, actions, c);
  if (action === "quit") return "quit";
  if (!action || action.id === "back") return null;
  switch (action.id) {
    case "nudge":
    case "followup": {
      const agent = await recipientFor(role, c);
      if (agent === "quit") return "quit";
      if (!agent) return load().agents.length ? null : "Add who it goes to in Agents first.";
      if (action.id === "followup") return followUp(role, agent, c);
      const state = load();
      return draftForRole(role, agent, core.nudgeText(state, role, core.findAgent(state, agent)), [], c);
    }
    case "call":
      return setCall(role, c);
    case "move":
      return moveRole(role, c);
    case "delete":
      return deleteRole(role, c);
    default:
      return null;
  }
}

const basicsDone = (state) => view.setupSteps(state).slice(0, 2).every((step) => step.done);

function setupScreen(c, lines = [], message) {
  const out = [c.muted("Setup"), "", c.bold("I’m your agent now. No job, no tokens."), c.muted("A few answers, then I read your resume and start selling you to every AI recruiter. Anything I’m not sure of waits for your yes."), "", ...lines];
  if (message) out.push("", message);
  return out.join("\n");
}

/** The facts it found, short enough for one screen. */
function factLines(facts, c, room = 14) {
  const shown = facts.slice(0, room).map((f) => `  ${c.lime("•")} ${clip(f, (process.stdout.columns || 100) - 6)}`);
  return facts.length > room ? [...shown, c.muted(`  and ${facts.length - room} more`)] : shown;
}

/** Reads the resume with the AI tool already signed in, then the user says whether to keep what it found. @returns the result, or a message to stop with */
async function resumeStep(c) {
  let message;
  let guess = findResume();
  for (;;) {
    draw(setupScreen(c, [], message));
    const typed = await ask(`\n1. Your resume. Drag the file here, or type where it is${guess ? " (enter keeps this one)" : ""}:\n`, guess ?? "");
    if (!typed) return { stop: "Setup isn’t finished. Type sellme setup to carry on." };
    const file = cleanPath(typed);
    draw(setupScreen(c, [c.muted(`Reading ${path.basename(file)}… esc to stop`)]));
    const result = await whileWorking((signal) => readResume(file, { signal }));
    if (result.failed || result.refused) {
      message = result.failed === "stopped" ? "Stopped." : c.red(`✗ ${result.failed ?? result.refused}`);
      guess = null;
      continue;
    }
    const pick = await chooseFlow(setupScreen(c, [c.bold(`From ${path.basename(file)}, ${result.facts.length} facts:`), ...factLines(result.facts, c)]), [{ key: "y", id: "save", label: "Save them. I can fix any later" }, { key: "n", id: "other", label: "That’s wrong: pick another file" }, { key: "b", id: "stop", label: "Stop for now" }], c);
    if (pick === "quit") return { stop: "quit" };
    if (!pick || pick.id === "stop") return { stop: "Setup isn’t finished. Type sellme setup to carry on." };
    if (pick.id === "other") {
      guess = null;
      message = undefined;
      continue;
    }
    withState((s) => {
      for (const fact of result.facts) core.addFact(s, fact, path.basename(file));
      core.setResume(s, { file: path.resolve(file) }); // So it can go with an email later.
      if (!s.profile.name && result.name) core.setProfile(s, "name", result.name);
    });
    audit({ event: "resume_read", facts: result.facts.length, tool: result.tool, by: "keyboard" });
    return result;
  }
}

/** Setup without leaving the terminal. @returns a message for the next screen, or "quit" */
async function setupFlow(c) {
  let found = null;
  if (!load().facts.length) {
    const result = await resumeStep(c);
    if (result.stop) return result.stop;
    found = result;
  }
  const questions = [
    ["name", "Your name", (p) => p.name],
    ["roles", "2. Roles you want, separated by commas", (p) => p.roles.join(", ")],
    ["where", "3. Where you’ll work, like NYC or remote", (p) => p.where],
    ["floor", "4. Your salary floor. It stays private, and I never tell anyone", (p) => p.floor],
  ];
  for (const [field, label, current] of questions) {
    const p = load().profile;
    if (current(p) && field === "name") continue;
    draw(setupScreen(c, [c.lime(`✓ ${load().facts.length} facts from your resume`)]));
    const typed = await ask(`\n${label}:\n`, current(p) ?? "");
    if (!typed) return "Setup isn’t finished. Type sellme setup to carry on.";
    withState((s) => core.setProfile(s, field, typed));
  }
  // The skill's rule: a current employer shouldn't hear about the search unless the user says so.
  const employer = found?.employer;
  if (employer && !load().roles.some((r) => r.company.toLowerCase() === employer.toLowerCase())) {
    const hide = await chooseFlow(setupScreen(c, [`Your resume says you work at ${c.bold(employer)} now.`]), [{ key: "y", id: "hide", label: `Keep my search away from ${employer}` }, { key: "n", id: "fine", label: "They can know" }], c);
    if (hide === "quit") return "quit";
    if (hide?.id === "hide") withState((s) => core.addRole(s, { company: employer, stage: "passed" }));
  }
  audit({ event: "setup_basics", by: "keyboard" });
  return load().agents.length ? `${c.lime("✓")} You’re set up.` : `${c.lime("✓")} Saved. Last step: pick the agents you already use, and sign up for the rest. Press enter on one.`;
}

/** The loading screen. It's a normal check, so it goes through the same gate. @returns a message for the first screen */
async function syncFlow(c) {
  const before = load();
  clearActivity();
  const started = Date.now();
  let frame = 0;
  const paint = () => process.stdout.write(`\x1b[H${syncScreen(frame++, Math.floor((Date.now() - started) / 1000), readActivity(), c).replace(/\n/g, "\x1b[K\n")}\x1b[K\x1b[J`);
  process.stdout.write("\x1b[2J");
  paint();
  const timer = setInterval(paint, 100);
  let result;
  try {
    result = await whileWorking((signal) => scheduledRun({ signal }));
  } finally {
    clearInterval(timer);
  }
  if (result.stopped) return "Skipped the sync, so this is what I had.";
  if (result.skipped === "already running") return "A check is already running. New drafts show up here when it’s done.";
  if (result.ok === false) return c.red(`✗ The sync didn’t finish, so this is what I had. ${result.why}`);
  return `${c.lime("✓")} Synced. ${syncSummary(before, load())}.`;
}

/** Once set up, it checks every hour unless the user ever chose otherwise. @returns a message, or null */
function autoSchedule(c) {
  const state = load();
  if (state.schedule_chosen || state.schedule || state.paused || !view.setupSteps(state).every((step) => step.done) || !canRun()) return null;
  const done = attempt(() => {
    setSchedule("hourly");
    audit({ event: "schedule_default", every: "hourly" });
    const warning = scheduleWarning(load());
    return `${c.lime("✓")} I’ll check your agents every hour from now on. Change it in Schedule.${warning ? `\n${c.violet(`! ${warning}`)}` : ""}`;
  }, c);
  return done.message;
}

function applySchedule(row, c) {
  if (row.autopilot !== undefined) {
    withState((s) => core.setAutopilot(s, row.autopilot));
    audit({ event: "autopilot", value: row.autopilot, by: "keyboard" });
    return row.autopilot ? `${c.lime("✓")} Autopilot on. Pay, offers, scheduling, first messages to someone new and anything I can’t back up still come to you.` : "Autopilot off. I’ll ask before every message.";
  }
  if (row.runNow) {
    if (!canRun()) return c.red("✗ Checks need Claude Code on this machine.");
    startCheckInBackground();
    audit({ event: "check_started", by: "keyboard" });
    return `${c.lime("✓")} Started. New drafts show up in Drafts when it’s done, usually within a few minutes.`;
  }
  return attempt(() => {
    const set = setSchedule(row.every);
    const warning = set ? scheduleWarning(load()) : null;
    return set ? `${c.lime("✓")} ${set.label}.${warning ? `\n${c.violet(`! ${warning}`)}` : ""}` : "Scheduled checks are off.";
  }, c).message;
}

/** Approved, but there's no address for that person yet. The user gives one, and it sends. */
async function yoursFlow(id, c) {
  const item = load().queue.find((q) => q.id === id);
  draw(`${view.card(item, c)}\n\n${c.bold(`I need ${item.agent}’s email, phone or LinkedIn profile to send this.`)}`);
  const handle = await ask("Their address (empty to go back): ");
  if (!handle) return null;
  if (!core.personRoute(handle)) return c.red("✗ That isn’t an email, phone number or LinkedIn profile link.");
  withState((s) => {
    s.agents.find((a) => a.name === item.agent).handle = handle;
    core.recheckOpen(s);
  });
  audit({ event: "address_added", agent: item.agent, by: "keyboard" });
  return sendHere(id, c);
}

/**
 * `sellme connect`: everything that's left, one at a time, or just the one they named.
 * @returns the last thing worth saying once the screen is gone
 */
export async function runConnect(c, { names }) {
  useLogo(c);
  process.stdout.write("\x1b[?1049h");
  let last;
  try {
    const todo = names.filter(Boolean);
    for (const [i, name] of todo.entries()) {
      const row = buildRows(load()).find((r) => r.name === name);
      if (!row) continue;
      const result = await detailFlow(row, c, { position: c.muted(`${i + 1} of ${todo.length}`), message: last });
      if (result === "quit") break;
      last = result ?? undefined;
    }
  } finally {
    process.stdout.write("\x1b[?1049l");
  }
  return last;
}

export async function runApp(c, { tab: startTab = "Drafts", openFirst = false, sync = false, setup = false, forceSync = false } = {}) {
  let tab = startTab;
  let cursor = null;
  let message;
  const rowsFor = (state) => ({ Drafts: draftRows, Agents: buildRows, Pipeline: pipelineRows, Schedule: scheduleRows, Activity: activityRows })[tab](state);
  useLogo(c);
  process.stdout.write("\x1b[?1049h\x1b[?25l"); // A separate screen, so the user's scrollback survives.
  const showCursor = () => process.stdout.write("\x1b[?25h");
  const hideCursor = () => process.stdout.write("\x1b[?25l");
  try {
    withState((s) => core.recheckOpen(s)); // So no reason on screen is older than today's rules.
    refreshConnections(); // So a connector finished elsewhere shows as connected.
    if (setup || !basicsDone(load())) {
      showCursor();
      const result = await setupFlow(c);
      hideCursor();
      if (result === "quit") return 0;
      message = result;
      if (!load().agents.length) tab = "Agents";
    }
    message = autoSchedule(c) ?? message;
    if (forceSync ? view.setupSteps(load()).every((step) => step.done) && !load().paused : sync && shouldSync(load())) message = await syncFlow(c);
    if (openFirst) {
      const first = core.openItems(load())[0];
      if (first) {
        showCursor();
        const result = await draftFlow(first.id, c);
        hideCursor();
        if (result === "quit") return 0;
      }
    }
    for (;;) {
      const state = load();
      const rows = rowsFor(state);
      const spots = selectable(rows);
      if (!spots.includes(cursor)) cursor = spots[0] ?? null;
      draw(screen(tab, state, rows, cursor, c, message));
      message = undefined;
      let key = await readKey();
      if (key === "quit" || key === "q" || key === "escape") return 0;
      if (key?.click?.tab) key = { tab: key.click.tab };
      else if (key?.click?.row !== undefined) {
        cursor = key.click.row;
        key = "return";
      }
      if (key === "r") {
        // A check right here, with the loading screen, instead of sending anyone to their AI tool.
        if (!view.setupSteps(state).every((step) => step.done)) message = "Finish setup first: type sellme setup.";
        else if (state.paused) message = "Sellme is paused, so I won’t check. Type sellme resume.";
        else if (!canRun()) message = c.red("✗ Checks need Claude Code on this machine.");
        else message = await syncFlow(c);
        continue;
      }
      if (key === "left" || key === "right" || key === "tab" || key?.tab) {
        tab = key?.tab ?? TABS[(TABS.indexOf(tab) + (key === "left" ? -1 : 1) + TABS.length) % TABS.length];
        cursor = null;
        if (tab === "Activity") withState((s) => s.notes.forEach((n) => (n.seen = true)));
        continue;
      }
      if (cursor !== null && (key === "up" || key === "k")) cursor = move(rows, cursor, -1);
      else if (cursor !== null && (key === "down" || key === "j")) cursor = move(rows, cursor, 1);
      const row = cursor === null ? null : rows[cursor];
      const enter = key === "return" || key === "enter";
      showCursor();
      let result = null;
      if (tab === "Agents" && (key === "a" || (enter && row?.id === ADD))) result = await addFlow(c);
      else if (tab === "Agents" && key === "d" && row?.connected && !row.tool) result = await removeFlow(row, c);
      else if (tab === "Agents" && enter && row) result = await detailFlow(row, c);
      else if (tab === "Drafts" && key === "x" && rows.some((r) => r.handled)) {
        const ids = rows.filter((r) => r.handled).map((r) => r.id);
        withState((s) => ids.forEach((id) => core.skip(s, id)));
        audit({ event: "cleared_handled", ids, by: "keyboard" });
        result = `${c.lime("✓")} Cleared ${ids.length}.`;
      } else if (tab === "Drafts" && enter && row?.draft) result = await draftFlow(row.id, c);
      else if (tab === "Drafts" && enter && row?.yours) result = await yoursFlow(row.id, c);
      else if (tab === "Drafts" && enter && row?.approved) result = await approvedFlow(row.id, c);
      else if (tab === "Pipeline" && row?.role && enter) result = await roleFlow(row.id, c);
      else if (tab === "Pipeline" && row?.role && ["n", "f", "c", "m", "d"].includes(key)) result = await roleFlow(row.id, c, key);
      else if (tab === "Schedule" && enter && row) result = applySchedule(row, c);
      else if (tab === "Activity" && enter && row?.alert) {
        withState((s) => core.dismissAlert(s, row.id));
        result = `${c.lime("✓")} Dismissed.`;
      }
      hideCursor();
      if (result === "quit") return 0;
      message = result ?? undefined;
    }
  } finally {
    process.stdout.write("\x1b[?25h\x1b[?1049l");
  }
}

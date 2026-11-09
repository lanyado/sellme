// `sellme` in a terminal: one screen with tabs, so nobody has to remember a command or a flag.
// What each tab shows is plain functions, so tests can check it without a terminal.
import { canRun, canSendOn, clearActivity, fastPlan, pointsElsewhere, readActivity, researchChat, researchPrep, researchRewrite, researchSuggest, sendOutbox, startCheckInBackground } from "./agent.js";
import * as core from "./core.js";
import { ADD, addFlow, ask, attempt, buildRows, detailFlow, draw, headRows, listScreen, move, placeLines, offerClicks, readKey, refreshConnections, removeFlow, selectable, takeOffered, useLogo, whileWorking } from "./picker.js";
import * as view from "./render.js";
import { placeholder } from "./truth.js";
import { openUrl } from "./open.js";
import fs from "node:fs";
import path from "node:path";
import { DAY, nudgePlan, span, timeline } from "./insights.js";
import { confirmLearned } from "./learn.js";
import { recall } from "./memory.js";
import { preppable, prepTurn, savedBrief } from "./prep.js";
import { chatTurn, cleanPath, findResume, findTool, readResume, rewrite } from "./rewrite.js";
import { SCHEDULES, runActive, scheduleWarning, scheduledRun, setSchedule } from "./schedule.js";
import { audit, load, withState } from "./store.js";

export const TABS = ["Drafts", "Agents", "Pipeline", "Schedule", "Activity"];
const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, Math.max(n - 1, 1))}…` : t;
};
const time = (iso) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The one line that says what's going on, on every tab. */
/** How close the one goal is: the roles furthest along first. */
export function goalLine(state) {
  if (state.hired) return "You’re hired. Goal reached";
  const count = (stage) => state.roles.filter((r) => r.stage === stage).length;
  const along = [["offer", "offer"], ["interview", "interview"], ["talking", "talking"]]
    .map(([stage, word]) => [count(stage), word])
    .filter(([n]) => n)
    .map(([n, word]) => (word === "talking" ? `${n} talking` : `${n} ${word}${n === 1 ? "" : "s"}`));
  return `Getting you hired${along.length ? `: ${along.join(", ")}` : ""}`;
}

export function summary(state) {
  const drafts = core.openItems(state).length;
  const toConnect = core.connectList(state).filter((i) => i.blocking).length;
  const yours = state.queue.filter((q) => q.status === "yours").length;
  const waiting = core.outbox(state).length;
  const parts = [goalLine(state)];
  if (state.paused && !state.hired) parts.push("Paused, nothing goes out");
  if (drafts) parts.push(`${drafts} draft${drafts === 1 ? "" : "s"} need${drafts === 1 ? "s" : ""} you`);
  if (yours) parts.push(`${yours} need${yours === 1 ? "s" : ""} an address`);
  if (waiting) parts.push(`selling you to ${waiting} now`);
  if (toConnect) parts.push(`${toConnect} to connect`);
  if (state.alerts.length) parts.push(`${state.alerts.length} alert${state.alerts.length === 1 ? "" : "s"}`);
  if (parts.length === 1 && !state.hired) parts.push("nothing needs you");
  // A call in the next day is the one thing worth saying on every tab.
  const soon = state.roles.filter((r) => core.upcomingCall(r) && new Date(r.next_call) - Date.now() <= DAY).sort((a, b) => new Date(a.next_call) - new Date(b.next_call))[0];
  if (soon) parts.push(`${soon.company} call in ${span(new Date(soon.next_call) - Date.now())}${savedBrief(soon) ? ", brief ready" : ""}`);
  parts.push(state.last_run ? `checked ${time(state.last_run)}` : "not checked yet");
  return parts.join(" · ");
}

/** When the message it answers arrived, or when it was drafted if the run didn't say. */
const whenOf = (q) => new Date(q.received ?? q.created).getTime();
/** Newest first, so what just came in is at the top. */
export const byNewest = (list) => [...list].sort((a, b) => whenOf(b) - whenOf(a) || Number(a.id.slice(1)) - Number(b.id.slice(1)));

// Why a draft needs a look, in a word or two.
const CHECK_WORD = { pay_or_offer: "pay", floor: "your floor", scheduling: "your time", other_channel: "another agent", new_contact: "first message", auto_limit: "daily limit" };

/** What a waiting item is, in words instead of a symbol. @returns {label, tone} */
export function draftStatus(q) {
  if (q.status === "blocked") return onlyYours(q) ? { label: "only you know", tone: "violet" } : { label: "needs a fix", tone: "red" };
  if (q.sensitive) {
    const code = (q.check?.reasons ?? []).find((r) => CHECK_WORD[r.code])?.code;
    return { label: code ? `check: ${CHECK_WORD[code]}` : "check it first", tone: "violet" };
  }
  return { label: q.kind === "nudge" ? "nudge, ready" : "ready to send", tone: "lime" };
}

/** Dry facts about it: how it came in, and how long ago. */
function draftWhen(q, now) {
  const route = q.channel === "self" ? core.personRoute(q.to) : q.channel;
  const where = view.CHANNEL_NAME[route] ?? route ?? "";
  if (q.asked && q.received) return `their ${where.replace(/^its /, "")} · ${view.ago(now - new Date(q.received))}`;
  return `${q.kind === "nudge" ? "your nudge" : where} · drafted ${view.ago(now - new Date(q.created))}`;
}

/** @param sends what's going out now and what failed, so a row can show a spinner by the name */
export function draftRows(state, { going = new Map(), failed = new Map(), frame = 0, now = Date.now() } = {}) {
  const rows = [];
  const open = byNewest(core.openItems(state));
  if (open.length) rows.push({ heading: "Needs you" });
  for (const q of open) rows.push({ id: q.id, draft: true, mark: q.status !== "blocked" ? (q.sensitive ? "!" : "○") : onlyYours(q) ? "?" : "✗", status: draftStatus(q), agent: q.agent, text: draftWhen(q, now), flag: q.instructions ? "note for the AI" : null });
  const yours = state.queue.filter((q) => q.status === "yours");
  if (yours.length) rows.push({ heading: "Approved, no address to send to" });
  for (const q of yours) rows.push({ id: q.id, yours: true, mark: "→", status: { label: "needs an address", tone: "violet" }, agent: q.agent, text: "approved, add their email, phone or LinkedIn" });
  const noticed = state.learned?.facts ?? [];
  if (noticed.length) rows.push({ heading: "Noticed in your edits" });
  for (const f of noticed) rows.push({ id: f.id, learned: true, mark: "+", status: { label: "keep this?", tone: "violet" }, agent: "From your edits", text: f.text });
  const waiting = core.outbox(state);
  if (waiting.length) rows.push({ heading: "Selling you now" });
  for (const q of waiting) {
    const go = going.get(q.id);
    const why = failed.get(q.id) ?? (q.attempted && !go ? "Not sure it went out" : null);
    if (go) {
      const secs = Math.max(Math.floor((now - go.started) / 1000), 0);
      rows.push({ id: q.id, approved: true, sending: true, mark: SPINNER[frame % SPINNER.length], status: { label: `${SPINNER[frame % SPINNER.length]} sending ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`, tone: "lime" }, agent: q.agent, text: "click to stop" });
    } else rows.push({ id: q.id, approved: true, mark: why ? "✗" : "○", status: why ? { label: "didn’t send", tone: "red" } : { label: "approved", tone: "lime" }, agent: q.agent, text: why ? `${why} · click to try again` : "goes out next" });
  }
  return rows;
}

/** An email's line breaks, flattened for a one-line preview. */
const oneLine = (t) => String(t ?? "").replace(/\s+/g, " ").trim();

/** A question only the user can answer, as opposed to a draft that failed the check. */
export const onlyYours = (q) => q.status === "blocked" && (q.suggestion != null || !q.text || (q.check?.reasons ?? []).every((r) => r.code === "agent_block"));

/** What would go back for a question only the user can answer. */
export const replyFor = (q) => q.suggestion ?? (q.status === "blocked" ? q.text : null) ?? null;

const RESUME_TALK = /\b(resume|résumé|cv|curriculum vitae|attach(ed|ing|ment)?)\b/i;

/** "Attach my resume" only when the conversation is about one. */
export const resumeRelevant = (q) => Boolean(q.attach) || RESUME_TALK.test([q.asked, q.text, q.suggestion].filter(Boolean).join(" "));

/** Which keys a draft offers. A question only the user can answer comes with a suggested reply to send or edit. */
export function draftActions(q, { diff = true } = {}) {
  let first;
  if (q.status === "blocked") {
    const reply = replyFor(q);
    const failed = !onlyYours(q); // The AI's own draft, and the check caught something in it.
    first = [];
    if (placeholder(reply)) first.push({ key: "e", id: "edit", label: "Fill in the blank" }); // It can't go with a blank, so there's no yes yet.
    else {
      if (reply && !failed) first.push({ key: "y", id: "send", label: "Sell me!" });
      first.push({ key: "e", id: "edit", label: reply ? "Edit it" : "Write it" });
      if (reply && failed) first.push({ key: "y", id: "send", label: "Sell me anyway: you vouch for every word" });
    }
  } else first = [{ key: "y", id: "approve", label: "Sell me!" }, { key: "e", id: "edit", label: "Edit" }];
  const resume = resumeRelevant(q) ? [{ key: "p", id: "attach", label: q.attach ? "Take the resume off" : "Attach my resume" }] : [];
  // Blocked only for saying "attached": attaching is the fix, so it comes first.
  if (q.check?.reasons?.length && q.check.reasons.every((r) => r.code === "no_attachment")) first = [...resume, ...first.filter((a) => a.id === "edit")];
  else first = [...first, ...resume];
  const changes = q.before && q.before !== (q.suggestion ?? q.text) ? [{ key: "d", id: "diff", label: diff ? "Hide what changed" : "Show what changed" }] : [];
  return [...first, ...changes, { key: "i", id: "instruct", label: "Sell me better: tell the AI how" }, { key: "t", id: "talk", label: "Talk it over with SELLME" }, { key: "s", id: "skip", label: "Skip" }, { key: "b", id: "back", label: "Back" }];
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
    for (const r of [...roles].sort((a, b) => soonest(a) - soonest(b))) {
      const call = core.upcomingCall(r, today);
      const left = call ? new Date(call) - today : Infinity;
      rows.push({ id: r.id, role: true, text: r.title ? `${r.company}, ${r.title}` : r.company, detail: r.agent ?? "", call, soon: left <= 2 * DAY ? `Call in ${span(left)}` : null, ready: Boolean(call && savedBrief(r)) });
    }
  }
  return rows;
}

/** What can be done to a role from the Pipeline tab. Nothing goes out without its own yes on the next screen. */
export function roleActions(role) {
  if (role.stage === "hired") return [{ key: "b", id: "back", label: "Back" }];
  const prep = preppable(role) ? [{ key: "p", id: "prep", label: savedBrief(role) ? "Prep me: your brief is ready, and you can ask SELLME anything" : "Prep me: a brief for the call, then ask SELLME anything" }] : [];
  const live = ["rejected", "passed"].includes(role.stage)
    ? []
    : [
        ...prep,
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
    { id: "pilot-on", autopilot: true, mark: pilot ? "●" : "○", text: "On: SELLME sends what it’s sure of, and asks you the rest" },
    { id: "pilot-off", autopilot: false, mark: pilot ? "○" : "●", text: "Off: SELLME asks before every message" },
    { heading: "How often SELLME checks" }, { id: "off", every: "off", mark: every ? "○" : "●", text: "Off: only when you open SELLME or press r" }];
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
const RECHECK_OPEN_MS = 15 * 60_000;

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
  return [view.logo(c), "", `${c.lime(SPINNER[frame % SPINNER.length])} Selling you to every agent  ${c.muted(clock)}`, ...(lines.length ? ["", ...lines] : []), "", c.muted("Reading new messages, booked calls, rejections and follow-ups, and answering what SELLME is sure of."), c.muted("esc to skip and open the app")].join("\n");
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
  const call = row.call ? `${row.soon ?? `Next call ${time(row.call)}`}${row.ready ? " · brief ready" : ""}` : "";
  const room = Math.max(width - call.length - 8, 8);
  const detail = clip(row.detail, Math.max(room - 20, 0));
  const right = call.length + detail.length + (call && detail ? 3 : 0);
  const nameWidth = Math.max(Math.min(50, width - right - 4), 12);
  return `${pointer} ${clip(row.text, nameWidth).padEnd(nameWidth + (nameWidth >= 50 ? 2 : 1))}${[call ? c.lime(call) : null, detail ? c.muted(detail) : null].filter(Boolean).join(c.muted(" · "))}`;
}

const PREVIEW = 60;

/** One item on one line: who, what it needs in words, and when it came in. Never wraps. */
export function draftLine(row, pointer, c, width = 100) {
  const tag = row.flag ? ` · ${row.flag}` : "";
  const status = row.status ?? { label: row.mark, tone: "muted" };
  const room = Math.max(Math.min(PREVIEW, width - 40 - tag.length), 10);
  return `${pointer} ${clip(row.agent, 16).padEnd(18)}${c[status.tone](clip(status.label, 16).padEnd(18))}${c.muted(clip(oneLine(row.text), room))}${tag ? c.violet(tag) : ""}`;
}

/** The keys for a tab, dropping the ones everyone knows first if the terminal is narrow. */
export function footerLine(tab, width = 100) {
  const keys = (nav) => [...nav, FOOTERS[tab], "r check now"].filter(Boolean).join(" · ");
  const full = keys(["←→ tabs", "↑↓ move"]);
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
    if (row.line) out.push(`${pointer} ${row.line}`);
    else if (tab === "Pipeline") out.push(pipelineLine(row, pointer, c, width));
    else if (tab === "Drafts") out.push(draftLine(row, pointer, c, width));
    else if (row.open) {
      // Opened: the whole thing, on as many lines as it takes. A click anywhere on it closes it.
      const lines = view.wrap(row.text, width - 6);
      lines.forEach((line, n) => {
        if (n) out.rowAt.set(out.length, i);
        out.push(n ? `    ${line}` : `${pointer} ${c.lime("▾")} ${line}`);
      });
    } else out.push(`${pointer} ${row.mark} ${clip(oneLine(row.text), width - 6)}`);
  });
  if (tab === "Schedule") {
    const last = state.schedule_last;
    out.push("", c.muted(clip(core.autopilotOn(state) ? "Each check pushes every agent and recruiter one step closer to hiring you: it answers what it’s sure of and saves the rest for you." : "Each check pushes every agent and recruiter one step closer to hiring you, with drafts that wait for your yes.", width - 2)));
    if (last) out.push("", last.ok ? c.muted(`Last check: ${time(last.at)}`) : c.red(`✗ Last check, ${time(last.at)}: ${last.why ?? "it didn’t finish"}`));
  }
  return out;
}

const FOOTERS = {
  Drafts: "enter open",
  Agents: "enter select · s scorecard · a create · d remove",
  Timeline: "enter opens it · n nudge · a nudge all stuck · p prep · t back to the list",
  Pipeline: "enter actions · t timeline · p prep · n nudge · f follow up · c next call · m move · d delete",
  Schedule: "enter select",
  Activity: "enter reads it in full, or dismisses an alert",
};

/**
 * The live pipeline across time: what's on the user, what's coming, and what's gone quiet, each role a strip of days
 * that glows hotter the longer it's been silent. Keys and clicks work as on the list, since each row is still a role.
 * @param frame animation frame, counted from opening it
 */
export function timelineRows(state, { today = new Date(), width = process.stdout.columns || 100, frame = Infinity, c }) {
  const groups = timeline(state, today);
  const stories = [...groups.onYou, ...groups.calls, ...groups.stuck, ...groups.moving];
  const nameWidth = Math.min(Math.max(Math.floor(width * 0.24), 14), 28);
  const metaWidth = 13;
  const scale = view.timelineScale(stories, Math.max(width - 2 - nameWidth - 1 - 1 - metaWidth - 1, 10), today);
  const { days, ahead, perDay, spare } = scale;
  const line = (s) => {
    const name = clip(s.role.title ? `${s.role.company}, ${s.role.title}` : s.role.company, nameWidth).padEnd(nameWidth);
    const strip = `${view.timelineStrip(s, { today, days, ahead, perDay, frame, c })}${" ".repeat(spare)}`;
    if (s.waiting === "you") return `${c.violet(name)} ${strip} ${c.violet(clip(`on you ${span(today - new Date(s.open.created))}`, metaWidth))}`;
    if (s.waiting === "call") return `${c.lime(name)} ${strip} ${c.lime(clip(`call in ${span(new Date(s.upcoming) - today)}`, metaWidth))}`;
    if (s.stuck) return `${c.rgb(...view.heatColor(s.heat))(name)} ${strip} ${c.rgb(...view.heatColor(s.heat))(clip(`stuck ${span(s.quiet)}`, metaWidth))}`;
    return `${name} ${strip} ${c.muted(clip(`${span(s.quiet)} ago`, metaWidth))}`;
  };
  const rows = [];
  const section = (title, list) => {
    if (!list.length) return;
    rows.push({ heading: `${title} (${list.length})` });
    for (const s of list) rows.push({ id: s.role.id, role: true, onYou: s.open?.id, story: s, line: line(s) });
  };
  section("On you", groups.onYou);
  section("Calls ahead", groups.calls);
  section("Stuck", groups.stuck);
  section("Moving", groups.moving);
  const stuck = groups.stuck.length;
  const heads = [
    [stuck ? `${stuck} stuck` : "nothing stuck", stuck ? c.red : c.lime],
    [groups.onYou.length ? `${groups.onYou.length} on you` : null, c.violet],
    [groups.calls.length ? `${plural(groups.calls.length, "call")} ahead` : null, c.lime],
    [groups.moving.length ? `${groups.moving.length} moving` : null, (t) => t],
    [groups.idle ? `${groups.idle} new, not started` : null, c.muted],
  ].filter(([text]) => text);
  // Least important goes first when it won't all fit.
  while (heads.length > 1 && `Timeline  ${heads.map(([text]) => text).join(" · ")}`.length >= width) heads.pop();
  rows.pin = [
    `${c.bold("Timeline")}  ${heads.map(([text, paint]) => paint(text)).join(c.muted(" · "))}`,
    `${" ".repeat(2 + nameWidth + 1)}${view.activitySpark(stories, { today, days, perDay, c })}`,
    c.muted(`${" ".repeat(2 + nameWidth + 1)}${view.timelineAxis({ today, days, ahead, perDay })}`),
  ];
  rows.footer = "Timeline";
  rows.panel = (row) => (row?.story ? storyPanel(row.story, today, width, c) : null);
  return rows;
}

/** Under the timeline: the selected role in words, so the strip never has to be decoded. */
function storyPanel(s, today, width, c) {
  const who = s.role.agent ?? "them";
  const t = s.timing;
  const usual = t?.typical != null ? `${who} usually answers in ${span(t.typical)} (${plural(t.samples, "reply").replace("replys", "replies")})` : `no pattern yet for ${who}, so ${span(s.after)} is the default`;
  const fit = (text) => clip(text, width - 2);
  const state =
    s.waiting === "you"
      ? c.violet(fit(`Waiting on you for ${span(today - new Date(s.open.created))}. Enter opens the draft.`))
      : s.waiting === "call"
        ? c.lime(fit(`Call in ${span(new Date(s.upcoming) - today)}. Press p to prep.`))
        : s.stuck
          ? c.rgb(...view.heatColor(s.heat))(fit(`Quiet for ${span(s.quiet)}, and a nudge was due after ${span(s.after)}. ${usual}.`))
          : c.muted(fit(`Quiet for ${span(s.quiet)}. Nudge due in ${span(Math.max(s.after - s.quiet, 3_600_000))}. ${usual}.`));
  const last = s.events.filter((e) => e.type === "you" || e.type === "them").at(-1) ?? s.last;
  const said = last ? `${last.type === "you" ? "You" : last.type === "them" ? (last.who ?? "They") : "Note"}, ${span(today - new Date(last.at))} ago: ${oneLine(last.text)}` : "Nothing said yet.";
  return [c.bold(clip(`${s.role.title ? `${s.role.company}, ${s.role.title}` : s.role.company} · ${s.role.stage}${s.role.agent ? ` · through ${s.role.agent}` : ""}`, width - 2)), state, c.muted(clip(said, width - 2)), c.muted(clip("◆ they wrote  ● you sent  ◇ stage  · note  ▲ call  ░▒▓█ silence, hotter past when they usually answer", width - 2))].join("\n");
}

/** The line that shows a check working in the background: what it's reading, and for how long. */
/** @param follow the one agent SELLME is staying with for an answer, instead of a whole check */
export function liveLine(frame, startedAt, activity, c, now = Date.now(), follow = null) {
  const secs = Math.max(Math.floor((now - startedAt) / 1000), 0);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const doing = activity.at(-1);
  const what = follow ? `Talking with ${follow}` : "Selling you to every agent";
  return `${c.lime(SPINNER[frame % SPINNER.length])} ${c.bold(what)}${doing ? c.muted(` · ${doing}`) : ""} ${c.muted(clock)}`;
}

/** @param live a check is running: its status line goes first, under the logo */
function screen(tab, state, rows, cursor, c, message, live) {
  const width = process.stdout.columns || 100;
  const height = process.stdout.rows || 30;
  const body = bodyLines(tab, state, rows, cursor, c, width);
  const pin = rows.pin ?? []; // Lines that stay put over a list that scrolls.
  const note = message ?? rows.panel?.(rows[cursor]) ?? null;
  const cursorLine = body.findIndex((line) => line.includes("❯"));
  const logoHeight = view.logo(c, width, height).split("\n").length + 1;
  // A running check sits right under the logo, with room before the tabs.
  const head = live ? [live, "", ""] : [];
  const reserved = 6 + pin.length + head.length + logoHeight + (note ? String(note).split("\n").length + 1 : 0);
  const start = windowStart(body.length, Math.max(cursorLine, 0), height - reserved);
  const shown = windowed(body, Math.max(cursorLine, 0), height - reserved);
  const above = start > 0 ? 1 : 0; // The "↑ n more" line.
  const top = head.length + 3 + pin.length; // Tabs, summary, blank, and what's pinned.
  const targets = tabSpots().map((spot) => ({ line: head.length, from: spot.from, to: spot.to, value: { tab: spot.tab } }));
  for (const [line, row] of body.rowAt ?? []) {
    const at = line - start + above;
    if (line >= start && at < shown.length && !/^\s+[↑↓] \d+ more$/.test(shown[at])) targets.push({ line: top + at, value: { row } });
  }
  offerClicks(targets);
  const out = [...head, tabBar(tab, c), c.muted(clip(summary(state), width - 2)), "", ...pin, ...shown, ""];
  if (note) out.push(note, "");
  out.push(c.muted(footerLine(rows.footer ?? tab, width)));
  return out.join("\n");
}

// ---------------------------------------------------------------- the terminal part
function draftScreen(q, actions, cursor, c, position, message, scroll, diff = true) {
  const route = q.channel === "self" ? core.personRoute(q.to) : null;
  const url = route ? view.addressUrl(q.to, route) : null;
  return menuScreen(view.card(q, c, position, undefined, { diff }), actions, cursor, c, message, scroll, url && !scroll ? [{ line: 0, value: { open: url } }] : []);
}

const MENU_HINT = "↑↓ move · enter, a letter or a click to choose · esc back";
const SCROLL_HINT = "scroll or PgUp/PgDn to read it all · ↑↓ move · enter, a letter or a click · esc back";

/** Rows the text above a menu can have, so the choices and the footer always stay on screen. */
function menuRoom(actions, message, height = process.stdout.rows || 30) {
  // A long message wraps in the terminal, so count the rows it really takes.
  const messageRows = message ? placeLines(`${message}\n`).at(-1) + 1 : 0;
  // The logo, a blank under the text, the choices, a blank, the message, the footer, and the line draw() leaves.
  return height - headRows() - 1 - actions.length - 1 - messageRows - 1 - 1;
}

/**
 * A long card scrolls on its own, with the choices pinned under it. The marker rows are always there, blank when
 * there's nothing more, so the choices never jump while scrolling.
 * @returns the rows to show, and how far it can scroll (0 when it all fits)
 */
export function scrolled(lines, room, scroll = 0) {
  if (lines.length <= room) return { shown: lines, top: 0, max: 0 };
  const fit = Math.max(room - 2, 3);
  const max = lines.length - fit;
  const top = Math.min(Math.max(scroll, 0), max);
  const shown = [top ? `  ↑ ${top} more lines` : "", ...lines.slice(top, top + fit), top < max ? `  ↓ ${max - top} more lines` : ""];
  return { shown, top, max };
}

/** How far a key scrolls a long card: the wheel a few lines, PgUp and PgDn a screen. @returns 0 for any other key */
export function scrollBy(key, room) {
  const page = Math.max(room - 3, 1);
  return { wheelup: -3, wheeldown: 3, pageup: -page, pagedown: page, home: -Infinity, end: Infinity }[key] ?? 0;
}

/** @returns how far the text above this menu can scroll, 0 when it all fits */
function menuMax(header, actions, message) {
  return scrolled(String(header).split("\n"), menuRoom(actions, message)).max;
}

/** @param links more click targets in the text above, like the card's address */
function menuScreen(header, actions, cursor, c, message, scroll = 0, links = []) {
  const { shown, max } = scrolled(String(header).split("\n"), menuRoom(actions, message), scroll);
  const out = [...shown.map((line) => (/^\s+[↑↓] \d+ more lines$/.test(line) ? c.muted(line) : line)), ""];
  const skip = out.length;
  offerClicks([...links, ...actions.map((a, i) => ({ line: skip + i, value: { action: i } }))]);
  actions.forEach((a, i) => out.push(`${i === cursor ? c.lime("❯") : " "} ${c.lime(`[${a.key}]`)} ${a.label}`));
  out.push("");
  if (message) out.push(message, "");
  out.push(c.muted(clip(max ? SCROLL_HINT : MENU_HINT, (process.stdout.columns || 100) - 1)));
  return out.join("\n");
}

/** Moves a long card's text for the wheel, PgUp or PgDn. @returns the new scroll, or null when the key isn't for scrolling */
function scrollFor(key, scroll, header, actions, message) {
  const max = menuMax(header, actions, message);
  const by = scrollBy(key, menuRoom(actions, message));
  if (!by || (!max && /^wheel/.test(key))) return null; // A card that fits: the wheel moves the choice, as everywhere else.
  return Math.min(Math.max(scroll + by, 0), max);
}

/** The one after `q` in the list's own order, newest first. */
const nextOpen = (q) => {
  const open = byNewest(core.openItems(load()));
  const after = (x) => whenOf(x) < whenOf(q) || (whenOf(x) === whenOf(q) && Number(x.id.slice(1)) > Number(q.id.slice(1)));
  return open.find(after)?.id ?? null;
};

async function showHandoff(item, c) {
  draw(`${c.lime("✓")} ${view.handoff(item)}\n${c.muted("Press any key.")}`);
  const key = await readKey();
  return key === "quit" ? "quit" : null;
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
  return c.violet(`! Now attach your resume yourself: ${opened ? `SELLME opened your chat with ${q.agent} in ${where}.` : `open your chat with ${q.agent} in ${where}.`} It couldn’t go with the message.`);
}

/** If a reply says the resume is attached, put it on before it goes. @returns an error message, or null */
function attachIfSaid(id, text, c) {
  if (!/\b(attached|attaching|enclosed)\b/i.test(text ?? "")) return null;
  const q = load().queue.find((x) => x.id === id);
  if (q.attach) return null;
  const done = attempt(() => withState((s) => core.attachResume(s, id)), c);
  return done.error ? done.message : null;
}

// ---------------------------------------------------------------- sending, in the background
// An approved message goes out while the list stays usable. Its row shows a spinner by the name, and a click stops it.
const sending = new Map(); // id → { agent, started, stop, cancelled, chrome, promise }
const failedSends = new Map(); // id → why, for this session
const sendNews = []; // How finished sends went, said once on the list.
const toFollow = new Set(); // Agents that just got a message and usually answer within a minute.
const SEND_AT_ONCE = 2;

const usesChrome = (o) => o.channel === "browser" || Boolean(fastPlan(o)?.chrome);

/** @returns a message when it can't go now; otherwise null, and the list shows it going */
export function startSend(id, c) {
  const state = load();
  const q = state.queue.find((x) => x.id === id);
  if (!q || q.status !== "approved" || sending.has(id)) return null;
  if (!canSendOn(q)) return `${c.lime("✓")} Approved. ${q.agent} has no chat to reply in, so it waits until there’s a way to send it.`;
  if (!canRun()) return `${c.lime("✓")} Approved. This needs Claude Code to send from here, so your next /sellme sends it.`;
  failedSends.delete(id);
  const o = core.outbox(state).find((x) => x.id === id);
  const entry = { agent: q.agent, started: Date.now(), stop: new AbortController(), cancelled: false, chrome: Boolean(o && usesChrome(o)) };
  sending.set(id, entry);
  entry.promise = sendOutbox(id, { signal: entry.stop.signal })
    .catch((e) => ({ sent: false, why: e.message }))
    .then(async (result) => {
      const news = await sendResult(id, entry, result, c);
      sending.delete(id);
      if (news) sendNews.push(news);
    });
  return null;
}

async function sendResult(id, entry, result, c) {
  audit({ event: "send_tried", id, sent: Boolean(result.sent), by: "app", ...(result.said ? { said: result.said } : {}) });
  const q = load().queue.find((x) => x.id === id);
  if (result.sent || q?.status === "sent") {
    if (entry.cancelled) return `${c.violet("!")} Too late to stop it: it already went to ${entry.agent}.`;
    const out = [`${c.lime("✓")} Sold you to ${entry.agent}.${q?.remembered ? " SELLME saved your answer, so it knows next time." : ""}`];
    const agent = load().agents.find((a) => a.name === entry.agent);
    if (core.answersFast(agent) && !entry.cancelled) toFollow.add(agent.name); // It stays for the answer.
    if (q?.attach === "manual") out.push(await attachYourself(q, c));
    return out.join("\n");
  }
  if (entry.cancelled) {
    if (q?.status === "approved") withState((s) => core.takeBack(s, id));
    return `Stopped. The message to ${entry.agent} is back in your drafts.`;
  }
  if (result.busy) return null; // A check is sending it.
  failedSends.set(id, result.why ?? "It didn’t go through");
  return c.red(`✗ Couldn’t sell you to ${entry.agent}${result.why ? `: ${result.why}` : ""}. Click it to try again.`);
}

function stopSend(id) {
  const entry = sending.get(id);
  if (!entry) return null;
  entry.cancelled = true;
  entry.stop.abort();
  return `Stopping the message to ${entry.agent}…`;
}

/** Sends what's approved and not going yet: autopilot's, a check's, or one approved before the app opened. */
function pump(state, c) {
  if (state.paused || !canRun()) return;
  for (const o of core.outbox(state)) {
    if (sending.size >= SEND_AT_ONCE) return;
    // One that a run tried and couldn't confirm waits for a click, so nothing goes out twice.
    if (sending.has(o.id) || failedSends.has(o.id) || o.attempted) continue;
    const q = state.queue.find((x) => x.id === o.id);
    if (core.claimedElsewhere(q) || !canSendOn(q)) continue;
    if (usesChrome(o) && [...sending.values()].some((e) => e.chrome)) continue; // They'd share your Chrome.
    startSend(o.id, c);
  }
}

/** Quitting with something on its way: let it land, unless they press esc. */
async function finishSends(c) {
  if (!sending.size) return;
  let frame = 0;
  const paint = () => {
    const names = [...new Set([...sending.values()].map((e) => e.agent))].join(", ");
    draw(`${c.lime(SPINNER[frame++ % SPINNER.length])} ${c.bold(`Finishing: selling you to ${names}`)} ${c.muted("· esc stops it")}`, { still: frame > 1 });
  };
  paint();
  const timer = setInterval(paint, 120);
  try {
    await whileWorking((signal) => {
      signal.addEventListener("abort", () => [...sending.keys()].forEach(stopSend));
      return Promise.all([...sending.values()].map((e) => e.promise));
    });
  } finally {
    clearInterval(timer);
  }
}

/** Slow work, with a spinner so it's clear SELLME is on it. esc stops it. @param paint (spinner frame) => the screen */
async function spinning(paint, run) {
  let frame = 0;
  const tick = () => draw(paint(SPINNER[frame++ % SPINNER.length]), { still: frame > 1 });
  tick();
  const timer = setInterval(tick, 100);
  try {
    return await whileWorking(run);
  } finally {
    clearInterval(timer);
  }
}

/** The last lines that fit on screen, so the newest part of a talk is always in view. */
function tail(lines, room = chatRoom()) {
  return lines.length <= room ? lines : [`  ↑ ${lines.length - room + 1} more lines`, ...lines.slice(lines.length - room + 1)];
}

const chatRoom = () => (process.stdout.rows || 30) - headRows() - 4;
const CHAT_HINT = "type to ask · ↑↓, PgUp/PgDn or the wheel scroll · esc back";

/**
 * A conversation screen the user can read back through: the wheel, arrows and PgUp/PgDn scroll it, and any letter
 * starts their next message. @param lines the whole conversation @returns what they typed, null to leave, or "quit"
 */
export async function readChat(lines, c, { keyFn = readKey, askFn = ask, drawFn = draw } = {}) {
  let back = 0; // How many lines up from the newest.
  for (;;) {
    const room = chatRoom() + 1;
    const { max } = scrolled(lines, room, 0);
    back = Math.min(Math.max(back, 0), max);
    drawFn([...scrolled(lines, room, max - back).shown, c.muted(clip(CHAT_HINT, (process.stdout.columns || 100) - 1))].join("\n"));
    const key = await keyFn({ text: true });
    if (key === "quit") return "quit";
    if (key === "escape" || key === "return" || key === "enter") return null;
    if (key?.char) {
      drawFn(tail(lines).join("\n"));
      process.stdout.write("\x1b[?25h"); // A cursor to type at.
      const typed = await askFn(`\n${c.lime("You:")} `, key.char);
      process.stdout.write("\x1b[?25l");
      if (typed) return typed;
      back = 0;
      continue;
    }
    back += { up: 1, down: -1 }[key] ?? -scrollBy(key, room);
  }
}

/**
 * Talking a draft over with SELLME: ask why it's flagged, what to say, or for a change, and it answers here. A new
 * version replaces the draft on the card, and still needs the user's yes there.
 * @returns a message for the card, or "quit"
 */
async function talkFlow(id, c) {
  const history = [];
  let changes = 0;
  const width = Math.max(Math.min((process.stdout.columns || 100) - 8, 90), 30);
  const page = (q, extra = []) => {
    const said = history.flatMap((h) => {
      const who = h.who === "you" ? c.bold("You") : c.lime(c.bold("SELLME"));
      return ["", `  ${who}`, ...view.wrap(h.text, width).map((l) => `  ${h.note ? c.muted(l) : l}`)];
    });
    return [...String(view.card(q, c, undefined, undefined, { diff: true })).split("\n"), "", c.bold("Talk it over with SELLME"), c.muted("Ask why it's flagged, what to say, or tell it what to change."), ...said, ...extra];
  };
  for (;;) {
    const now = load();
    let q = now.queue.find((x) => x.id === id);
    if (!q || !core.openItems(now).includes(q)) return changes ? `${c.lime("✓")} Done talking.` : null;
    const said = await readChat(page(q), c);
    if (said === "quit") return "quit";
    if (!said) return changes ? `${c.lime("✓")} SELLME updated the draft. Read it, then Sell me! or change it.` : null;
    history.push({ who: "you", text: said });
    const state = load();
    q = state.queue.find((x) => x.id === id);
    const result = await spinning((sp) => tail(page(q, ["", `${c.lime(sp)} ${c.bold("SELLME is thinking")} ${c.muted("· esc to stop")}`])).join("\n"), async (signal) => {
      const recalled = await recall(state, { query: `${said}\n${q.asked ?? ""}`, agent: q.agent, skip: q.id, signal });
      const asked = { ...q, recalled };
      return canRun() && pointsElsewhere(said) ? researchChat(state, asked, history, { signal }) : chatTurn(state, asked, history, { signal });
    });
    if (result.failed === "stopped") {
      history.push({ who: "sellme", text: "Stopped.", note: true });
      continue;
    }
    if (result.failed || result.refused) {
      history.push({ who: "sellme", text: `I couldn't answer that (${result.failed ?? result.refused}).`, note: true });
      continue;
    }
    if (result.say) history.push({ who: "sellme", text: result.say });
    const note = remembered(result.remember, c, { plain: true });
    if (!result.text) {
      if (note) {
        withState((s) => core.keepWhatYouSaid(s, result.remember, [], `the ${q.agent} draft`));
        history.push({ who: "sellme", text: note, note: true });
      }
      continue;
    }
    const done = attempt(() =>
      withState((s) => {
        const item = s.queue.find((x) => x.id === id);
        // A question only the user can answer keeps its suggestion; a draft gets its text replaced and checked again.
        if (item.status === "blocked" && (item.suggestion != null || !item.text)) return core.setSuggestion(s, id, result.text, { by: "ai", remember: result.remember });
        return core.applyRewrite(s, id, { text: result.text, sources: result.sources, was: item.text ?? null, remember: result.remember });
      }),
    c);
    audit({ event: "talked", id, changed: !done.error });
    if (done.error) history.push({ who: "sellme", text: `I couldn't change the draft: ${done.message}`, note: true });
    else {
      changes += 1;
      const now = load().queue.find((x) => x.id === id);
      const flagged = (now?.check?.reasons ?? []).filter((r) => !r.soft && now.status === "blocked").map((r) => r.message);
      history.push({ who: "sellme", text: (flagged.length ? `Updated the draft above. The check still flags: ${flagged.join(" ")}` : "Updated the draft above.") + (note ? ` ${note}` : ""), note: true });
    }
  }
}

/** What SELLME will remember from what the user said, for the screen. */
function remembered(lines, c, { plain = false } = {}) {
  if (!lines?.length) return "";
  const said = `Remembered: ${lines.map((l) => (typeof l === "string" ? l : `${l.text} (replacing ${l.replaces})`)).join("; ")}. It’s one of your facts now, so you won’t have to say it again.`;
  return plain ? said : `\n${c.muted(said)}`;
}

/** Keeps what the user said about themselves even when the draft itself couldn't be written. */
function kept(lines, id, c) {
  if (!lines?.length) return "";
  const q = load().queue.find((x) => x.id === id);
  withState((s) => core.keepWhatYouSaid(s, lines, [], `the ${q?.agent ?? "a"} draft`));
  return remembered(lines, c);
}

/** Answers a note on the same screen, so nobody has to go back to their AI tool for it. @returns a message */
async function rewriteHere(id, c, { choice = false } = {}) {
  const state = load();
  const q = state.queue.find((x) => x.id === id);
  // With Claude Code it can look up what the note points to: a call, an email, a note. A note that says it all
  // ("I ask $120/hr") is just followed, in seconds.
  const reach = canRun() && pointsElsewhere(q.instructions);
  const doing = reach ? "Looking up what your note points to, then rewriting" : "Rewriting it";
  const result = await spinning((sp) => `${view.card(q, c)}\n\n${c.lime(sp)} ${c.bold("SELLME is rewriting it")}\n  ${c.muted(`${doing} · esc to stop`)}`, async (signal) => {
    // What was said before, from the memory if one is connected: a second, instead of searching.
    const recalled = await recall(state, { query: [q.instructions, q.asked].filter(Boolean).join("\n"), agent: q.agent, skip: q.id, signal });
    const asked = { ...q, recalled };
    return reach ? researchRewrite(state, asked, { signal }) : rewrite(state, asked, { signal });
  });
  const saved = "Your note is saved, so /sellme can still do it.";
  if (result.failed === "stopped") return `Stopped. ${saved}`;
  if (result.failed) return c.red(`✗ ${result.failed}. ${saved}`);
  if (result.refused) return c.violet(`! ${result.refused}`) + kept(result.remember, id, c);
  const done = attempt(() => {
    const item = withState((s) => core.applyRewrite(s, id, result, { choice }));
    audit({ event: "rewritten", id, tool: result.tool, by: "keyboard" });
    return item;
  }, c);
  if (done.error) return done.message;
  if (done.message.status === "blocked") return c.red("✗ The new version failed the check, so read why above.");
  return `${c.lime("✓")} Rewritten. Read it, then approve or change it.${result.changed ? `\n${c.muted(`One change from your note: ${result.changed}`)}` : ""}${remembered(result.remember, c)}`;
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
    const typed = await ask(`\n${q.agent} can’t get a file this way, so SELLME sends a link to your resume.\nPaste a link to it (Google Drive, Dropbox or your site), once:\n`);
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
  // With Claude Code, it looks for your real answer first: your email, call notes, notes and files.
  const research = canRun();
  const doing = research ? "Looking through your email, call notes, notes and files" : "Writing a suggested reply";
  const result = await spinning((sp) => `${view.card(q, c)}\n\n${c.lime(sp)} ${c.bold("SELLME is drafting your answer")}\n  ${c.muted(`${doing} · esc to skip`)}`, async (signal) => {
    const recalled = await recall(state, { query: [q.asked, q.instructions].filter(Boolean).join("\n"), agent: q.agent, skip: q.id, signal });
    const asked = { ...q, recalled };
    return research ? researchSuggest(state, asked, { signal }) : rewrite(state, asked, { signal, suggest: true });
  });
  if (result.failed === "stopped") return null;
  if (result.failed || result.refused) return c.muted(`SELLME couldn’t suggest one (${result.failed ?? result.refused}). Press e to write it.`);
  const done = attempt(() => withState((s) => core.setSuggestion(s, id, result.text, { by: "ai", remember: result.remember })), c);
  if (done.error) return done.message;
  const more = remembered(result.remember, c).trim();
  return [result.changed ? c.muted(`From SELLME: ${result.changed}`) : null, more || null].filter(Boolean).join("\n") || null;
}

/** After enough unchanged yeses on one topic, offers to stop asking about that topic. Only the user's yes turns it on. @returns a message, "quit" or null */
async function offerEarned(id, c) {
  const offer = core.earnedOffer(load(), id);
  if (!offer) return null;
  const { agent, topic, label, streak } = offer;
  const header = `${c.lime(c.bold(`${streak} in a row`))}\n\nYou’ve approved your last ${streak} answers to ${c.bold(agent)} about ${c.bold(label)} without changing a word.\nWant SELLME to send those by itself? Pay, offers, scheduling and anything it can’t back up still come to you.`;
  const action = await chooseFlow(header, [{ key: "y", id: "yes", label: `Yes, send ${agent}’s ${label} answers by yourself` }, { key: "n", id: "no", label: `Not now: ask me again after ${core.EARN_AT} more` }], c);
  if (action === "quit") return "quit";
  const yes = action?.id === "yes";
  withState((s) => core.answerEarned(s, agent, topic, yes));
  audit({ event: "auto_topic", agent, topic, value: yes, by: "keyboard" });
  return yes ? `${c.lime("✓")} SELLME now sends ${agent}’s ${label} answers by itself. Stop any time in Agents, or: sellme auto "${agent}" off` : "Kept asking.";
}

/** A claim SELLME noticed in the user's edits. It's only a fact once they say so. */
async function learnedFlow(id, c) {
  const item = load().learned?.facts?.find((f) => f.id === id);
  if (!item) return null;
  const action = await chooseFlow(`${c.bold("You wrote this into a message, and SELLME doesn’t have it as a fact yet.")}\n\n  ${c.lime("│")} ${item.text}`, [{ key: "y", id: "yes", label: "Yes, that’s true of me: remember it" }, { key: "n", id: "no", label: "No, don’t use it" }, { key: "b", id: "back", label: "Decide later" }], c);
  if (action === "quit") return "quit";
  if (!action || action.id === "back") return null;
  withState((s) => confirmLearned(s, id, action.id === "yes"));
  audit({ event: "learned_fact", id, value: action.id === "yes", by: "keyboard" });
  return action.id === "yes" ? `${c.lime("✓")} It’s one of your facts now.` : "Dropped. SELLME won’t suggest it again.";
}

async function draftFlow(startId, c, { single = false } = {}) {
  let id = startId;
  let cursor = 0;
  let scroll = 0; // How far down a long card the user has read.
  let message;
  let showDiff = true; // A new version opens showing what changed. d hides it to read the clean text.
  const tried = new Set(); // Suggest once per question, even if it fails.
  for (;;) {
    let state = load();
    let q = state.queue.find((x) => x.id === id);
    let open = byNewest(core.openItems(state));
    if (!q || !open.includes(q)) return message ?? null;
    if (q.status === "blocked" && !q.text && !q.suggestion && !tried.has(q.id) && findTool()) {
      tried.add(q.id);
      message = (await suggestHere(q.id, c)) ?? message;
      state = load();
      q = state.queue.find((x) => x.id === id);
      open = byNewest(core.openItems(state));
    }
    const actions = draftActions(q, { diff: showDiff });
    cursor = Math.min(cursor, actions.length - 1);
    const position = single ? "" : c.muted(`${open.indexOf(q) + 1} of ${open.length}`);
    const shownMessage = message;
    draw(draftScreen(q, actions, cursor, c, position, message, scroll, showDiff));
    message = undefined;
    const key = await readKey();
    if (key === "quit") return "quit";
    if (key === "escape") return null;
    const moved = scrollFor(key, scroll, view.card(q, c, position, undefined, { diff: showDiff }), actions, shownMessage);
    if (moved !== null) {
      scroll = moved;
      message = shownMessage; // Scrolling keeps what the screen said.
      continue;
    }
    if (key === "up" || key === "wheelup") {
      cursor = (cursor - 1 + actions.length) % actions.length;
      continue;
    }
    if (key === "down" || key === "wheeldown") {
      cursor = (cursor + 1) % actions.length;
      continue;
    }
    if (key?.click?.open) {
      message = (await openUrl(key.click.open)) ? c.muted(`Opened ${key.click.open}`) : c.muted(key.click.open);
      continue;
    }
    if (key?.click) cursor = key.click.action;
    const action = key === "return" || key === "enter" || key?.click ? actions[cursor] : actions.find((a) => a.key === key);
    if (!action) continue;
    const advance = () => {
      id = single ? null : nextOpen(q);
      cursor = 0;
      scroll = 0; // The next card starts at the top.
    };
    switch (action.id) {
      case "back":
        return null;
      case "diff":
        showDiff = !showDiff;
        message = shownMessage;
        break;
      case "skip":
        withState((s) => core.skip(s, q.id));
        audit({ event: "skip", id: q.id, by: "keyboard" });
        advance();
        break;
      case "send": {
        // The user's yes on a reply to a question only they can answer: it goes out as their own words.
        // One key is the yes. The card already shows what makes it sensitive.
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
        return result.message.status === "approved" ? startSend(q.id, c) : null; // Back to the list, where it goes out.
      }
      case "approve": {
        // One key is the yes, sensitive or not, by any channel. The card already shows what's sensitive.
        if (q.channel === "browser" && !canSendOn(q)) {
          message = `${q.agent} has no chat to reply in, so this can’t go out there. Skip it, and SELLME answers them where they write next.`;
          break;
        }
        const item = withState((s) => core.approve(s, q.id, { confirmSensitive: true }));
        audit({ event: "approved", id: q.id, by: "keyboard" });
        if (item.status === "yours" && (await showHandoff(item, c)) === "quit") return "quit";
        // Back to the screen it came from, with how the send went.
        const went = item.status === "approved" ? startSend(q.id, c) : null; // Back to the list, where it goes out.
        const earned = await offerEarned(q.id, c);
        return earned ?? went;
      }
      case "talk": {
        const result = await talkFlow(q.id, c);
        if (result === "quit") return "quit";
        message = result ?? message;
        cursor = 0;
        break; // Back on the card, which shows whatever the talk changed.
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
          break; // Back on the card, with "Sell me!" first.
        }
        const text = await ask("\nEdit: ", q.text);
        if (!text) break;
        withState((s) => core.editDraft(s, q.id, text));
        audit({ event: "edit", id: q.id, by: "keyboard" });
        cursor = 0;
        break; // Stay here, so the new text gets its own yes.
      }
      case "instruct": {
        const text = await ask("\nHow should SELLME sell you better? ");
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
  let scroll = 0;
  for (;;) {
    draw(menuScreen(header, actions, cursor, c, message, scroll));
    const key = await readKey();
    if (key === "quit") return "quit";
    if (key === "escape") return null;
    const moved = scrollFor(key, scroll, header, actions, message);
    if (moved !== null) scroll = moved;
    else if (key === "up" || key === "wheelup") cursor = (cursor - 1 + actions.length) % actions.length;
    else if (key === "down" || key === "wheeldown") cursor = (cursor + 1) % actions.length;
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
  const action = await chooseFlow(view.card(q, c), [{ key: "s", id: "send", label: "Sell me now!" }, { key: "e", id: "edit", label: "Edit (takes back the approval)" }, { key: "t", id: "back", label: "Take back the approval" }, { key: "b", id: "stay", label: "Back" }], c);
  if (action === "quit") return "quit";
  if (action?.id === "send") return startSend(id, c);
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
  return made.message.status === "approved" ? startSend(made.message.id, c) : draftFlow(made.message.id, c, { single: true });
}

async function followUp(role, agent, c) {
  const note = await ask(`\nWhat should it say to ${agent}? A few words: `);
  if (!note) return null;
  const state = load();
  const who = core.findAgent(state, agent);
  const what = role.title ? `the ${role.title} role at ${role.company}` : role.company;
  const known = state.notes.filter((n) => n.text.includes(role.company)).slice(-5).map((n) => n.text).join("\n");
  const q = { channel: who.channel, asked: known || null, text: null, sources: [], instructions: `Write a short follow-up to ${agent} about ${what}, which is at the "${role.stage}" stage. What the user wants to say: ${note}` };
  const result = await spinning((sp) => `${c.bold(role.company)}\n\n${c.lime(sp)} ${c.bold("SELLME is writing it")} ${c.muted("· esc to stop")}`, (signal) => rewrite(state, q, { signal }));
  if (result.failed === "stopped") return "Stopped.";
  if (result.refused) return c.violet(`! ${result.refused}`);
  if (result.failed) {
    const typed = await ask(`\n${result.failed}. Type the message yourself, or leave it empty to cancel: `);
    return typed ? draftForRole(role, agent, typed, [], c) : null;
  }
  const sources = result.remember?.length ? withState((s) => core.keepWhatYouSaid(s, result.remember, result.sources, `${agent}`)) : result.sources;
  return draftForRole(role, agent, result.text, sources, c);
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
  if (typed === null || (!typed && !role.next_call)) return null; // esc keeps the call as it was.
  const done = attempt(() => withState((s) => core.setNextCall(s, role.id, typed)), c);
  if (done.error) return done.message;
  audit({ event: "next_call", id: role.id, by: "keyboard" });
  return done.message.next_call ? `${c.lime("✓")} Next call: ${time(done.message.next_call)}.` : "Cleared.";
}

async function deleteRole(role, c) {
  // A closed role is what stops Sellme bringing that company up again, so losing it matters.
  const warn = ["rejected", "passed"].includes(role.stage) ? ` SELLME will forget not to bring ${role.company} up.` : "";
  const sure = await ask(`\nDelete ${role.company} from your pipeline?${warn} Messages aren’t touched. Type yes: `);
  if ((sure ?? "").toLowerCase() !== "yes") return "Kept.";
  withState((s) => core.removeRole(s, role.id));
  audit({ event: "role_removed", id: role.id, by: "keyboard" });
  return `${c.lime("✓")} Deleted ${role.company}.`;
}

/** Everything stuck, in one yes: one nudge per contact, each through the same gate as any other message. */
async function nudgeAll(c) {
  const plan = nudgePlan(load());
  if (!plan.length) return "Nothing to nudge: everyone stuck already has something waiting, or heard from you today.";
  const list = plan.map((s) => `  ${c.lime("→")} ${s.role.agent}: ${s.role.company} ${c.muted(`· quiet ${span(s.quiet)}`)}`);
  const action = await chooseFlow(`${c.bold(`Nudge ${plural(plan.length, "contact")}?`)}\n\n${list.join("\n")}\n\n${c.muted("One message each, asking for the next step. Anything SELLME wouldn’t send by itself goes to Drafts for your yes.")}`, [{ key: "y", id: "yes", label: "Nudge them" }, { key: "b", id: "back", label: "Back" }], c);
  if (action === "quit") return "quit";
  if (action?.id !== "yes") return null;
  let going = 0;
  let waiting = 0;
  const problems = [];
  for (const s of plan) {
    const made = attempt(() =>
      withState((st) => {
        const agent = core.findAgent(st, s.role.agent);
        return core.addDraft(st, { agent: agent.name, text: core.nudgeText(st, s.role, agent), kind: "nudge", sources: [], company: s.role.company, role: s.role.id });
      }),
    c);
    if (made.error) problems.push(made.message);
    else {
      audit({ event: "role_message", id: made.message.id, role: s.role.id, by: "nudge_all" });
      if (made.message.status === "approved") going += 1;
      else waiting += 1;
    }
  }
  return [[going ? `${c.lime("✓")} ${plural(going, "nudge")} going out` : null, waiting ? `${plural(waiting, "nudge")} in Drafts for your yes` : null].filter(Boolean).join(". "), ...problems].filter(Boolean).join("\n");
}

/**
 * Prep for a call: SELLME writes a brief on this role, then answers questions about it here. The brief is kept for
 * that call, so coming back is instant; typing "again" writes a fresh one.
 * @returns a message for the role's screen, or "quit"
 */
async function prepFlow(id, c) {
  const history = [];
  const width = Math.max(Math.min((process.stdout.columns || 100) - 8, 90), 30);
  const page = (role, extra = []) => {
    const said = history.flatMap((h) => {
      const who = h.who === "you" ? c.bold("You") : c.lime(c.bold("SELLME"));
      const lines = String(h.text).split("\n").flatMap((l) => (l.trim() ? view.wrap(l, width) : [""]));
      return ["", `  ${who}`, ...lines.map((l) => `  ${h.note ? c.muted(l) : l}`)];
    });
    const call = core.upcomingCall(role) ? ` · next call ${time(role.next_call)}` : "";
    return [c.bold(role.title ? `${role.company}, ${role.title}` : role.company), c.muted(`${role.stage}${role.agent ? ` · ${role.agent}` : ""}${call}`), "", c.bold("Prep me"), c.muted("Ask anything about this call. \"again\" writes a fresh brief."), ...said, ...extra];
  };
  const turn = async (role) => {
    const state = load();
    const research = canRun();
    const doing = history.length ? "SELLME is thinking" : research ? "SELLME is reading your email, call notes and the web, then writing your brief" : "SELLME is writing your brief";
    return spinning((sp) => tail(page(role, ["", `${c.lime(sp)} ${c.bold(doing)} ${c.muted("· esc to stop")}`])).join("\n"), async (signal) => {
      const asked = history.filter((h) => h.who === "you").at(-1)?.text ?? "";
      const recalled = await recall(state, { query: `${role.company} ${role.title ?? ""} ${asked}`.trim(), agent: role.agent ?? undefined, signal, limit: 8 });
      return research ? researchPrep(state, role, history, { signal, recalled }) : prepTurn(state, role, history, { signal, recalled });
    });
  };
  let role = load().roles.find((r) => r.id === id);
  if (!role) return null;
  const kept = savedBrief(role);
  if (kept) history.push({ who: "sellme", text: kept });
  for (;;) {
    role = load().roles.find((r) => r.id === id);
    if (!role) return null;
    if (!history.length) {
      const result = await turn(role);
      if (result.failed || result.refused) return result.failed === "stopped" ? "Stopped." : c.red(`✗ ${result.failed ?? result.refused}`);
      history.push({ who: "sellme", text: result.say });
      withState((s) => core.savePrep(s, id, result.say));
      audit({ event: "prepped", id, by: "keyboard" });
    }
    const said = await readChat(page(role), c);
    if (said === "quit") return "quit";
    if (!said) return null;
    if (/^\s*again\s*$/i.test(said)) {
      history.length = 0;
      continue;
    }
    history.push({ who: "you", text: said });
    const result = await turn(role);
    if (result.failed === "stopped") history.push({ who: "sellme", text: "Stopped.", note: true });
    else if (result.failed || result.refused) history.push({ who: "sellme", text: `I couldn't answer that (${result.failed ?? result.refused}).`, note: true });
    else history.push({ who: "sellme", text: result.say });
  }
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
    case "prep":
      return prepFlow(role.id, c);
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
  const out = [c.muted("Setup"), "", c.bold("SELLME is your agent now. It has one goal: get you hired."), c.muted("A few answers, then SELLME reads your resume and goes after every AI recruiter and every human one, until you’re hired. Anything it’s not sure of waits for your yes."), "", ...lines];
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
    const result = await spinning((sp) => setupScreen(c, [`${c.lime(sp)} ${c.bold(`SELLME is reading ${path.basename(file)}`)} ${c.muted("· esc to stop")}`]), (signal) => readResume(file, { signal }));
    if (result.failed || result.refused) {
      message = result.failed === "stopped" ? "Stopped." : c.red(`✗ ${result.failed ?? result.refused}`);
      guess = null;
      continue;
    }
    const pick = await chooseFlow(setupScreen(c, [c.bold(`From ${path.basename(file)}, ${result.facts.length} facts:`), ...factLines(result.facts, c)]), [{ key: "y", id: "save", label: "Save them (you can fix any later)" }, { key: "n", id: "other", label: "That’s wrong: pick another file" }, { key: "b", id: "stop", label: "Stop for now" }], c);
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
    ["floor", "4. Your salary floor. It stays private, and SELLME never tells anyone", (p) => p.floor],
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
  if (result.stopped) return "Skipped the sync, so this is what SELLME had.";
  if (result.skipped === "already running") return "A check is already running. New drafts show up here when it’s done.";
  if (result.ok === false) return c.red(`✗ The sync didn’t finish, so this is what SELLME had. ${result.why}`);
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
    return `${c.lime("✓")} SELLME checks your agents every hour from now on. Change it in Schedule.${warning ? `\n${c.violet(`! ${warning}`)}` : ""}`;
  }, c);
  return done.message;
}

function applySchedule(row, c) {
  if (row.autopilot !== undefined) {
    withState((s) => core.setAutopilot(s, row.autopilot));
    audit({ event: "autopilot", value: row.autopilot, by: "keyboard" });
    return row.autopilot ? `${c.lime("✓")} Autopilot on. Pay, offers, scheduling, first messages to someone new and anything SELLME can’t back up still come to you.` : "Autopilot off. SELLME asks before every message.";
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
  draw(`${view.card(item, c)}\n\n${c.bold(`SELLME needs ${item.agent}’s email, phone or LinkedIn profile to send this.`)}`);
  const handle = await ask("Their address (empty to go back): ");
  if (!handle) return null;
  if (!core.personRoute(handle)) return c.red("✗ That isn’t an email, phone number or LinkedIn profile link.");
  withState((s) => {
    s.agents.find((a) => a.name === item.agent).handle = handle;
    core.recheckOpen(s);
  });
  audit({ event: "address_added", agent: item.agent, by: "keyboard" });
  return startSend(id, c);
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
  let frame = 0;
  let timelineFrom = null; // The frame the timeline opened on, or null on the plain list.
  const opened = new Set(); // Activity rows opened to read in full.
  const rowsFor = (state) => {
    if (tab === "Drafts") return draftRows(state, { going: sending, failed: failedSends, frame });
    if (tab === "Activity") return activityRows(state).map((r) => (opened.has(r.id) ? { ...r, open: true } : r));
    if (tab === "Pipeline" && timelineFrom !== null) return timelineRows(state, { frame: frame - timelineFrom, c });
    return { Agents: buildRows, Pipeline: pipelineRows, Schedule: scheduleRows }[tab](state);
  };
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
    // Every open: read every channel and push, in the background, so the list is here at once and fills in.
    const live = { started: null, before: null, seen: false };
    let lastKick = Date.now();
    const kick = (start = null, follow = null) => {
      const st = load();
      if (!view.setupSteps(st).every((step) => step.done) || st.paused || !canRun() || runActive()) return false;
      lastKick = Date.now();
      clearActivity();
      Object.assign(live, { started: Date.now(), before: st, seen: false, follow });
      startCheckInBackground(undefined, undefined, start, follow);
      audit({ event: "check_started", by: follow ? "follow" : start ? "connected" : "open", ...(start || follow ? { agent: start ?? follow } : {}) });
      return true;
    };
    // Right after a message goes to an agent that answers fast, SELLME stays in that conversation for the answer.
    const followUp = () => {
      if (live.started || sending.size) return;
      const [name] = toFollow;
      if (name && kick(null, name)) toFollow.delete(name);
    };
    // A newly connected agent gets its first message now, not at the next hourly check. Once per agent per session.
    const introduced = new Set();
    const openNew = (state) => {
      const fresh = state.agents.find((a) => a.intro && !introduced.has(a.name) && !core.connectList(state).some((i) => i.name === a.name && i.blocking));
      if (!fresh || live.started || runActive()) return;
      if (kick(fresh.name)) {
        introduced.add(fresh.name);
        message = `${c.lime("✓")} ${fresh.name} is connected. SELLME is opening the conversation now.`;
      }
    };
    if (forceSync && view.setupSteps(load()).every((step) => step.done) && !load().paused) message = await syncFlow(c);
    else kick();
    if (openFirst) {
      const first = core.openItems(load())[0];
      if (first) {
        showCursor();
        const result = await draftFlow(first.id, c);
        hideCursor();
        if (result === "quit") return 0;
      }
    }
    let ticking = false;
    for (;;) {
      const state = load();
      const active = runActive();
      if (active && !live.started) Object.assign(live, { started: active, before: state }); // A scheduled check, already going.
      if (active) live.seen = true;
      // It takes a moment to start, so it's only done once it's been seen running (or never showed up at all).
      if (!active && live.started && (live.seen || Date.now() - live.started > 20_000)) {
        const done = live.follow ? `${c.lime("✓")} Talked with ${live.follow}: ${syncSummary(live.before, state)}.` : `${c.lime("✓")} Checked every agent: ${syncSummary(live.before, state)}.`;
        message = live.seen ? done : c.red("✗ The check didn’t start. See ~/.sellme/schedule.log.");
        Object.assign(live, { started: null, before: null, seen: false, follow: null });
      }
      // While it's open, new messages show up without waiting for the hourly check.
      if (!live.started && !active && Date.now() - lastKick > RECHECK_OPEN_MS) kick();
      pump(state, c); // Approved means it goes: anything approved and waiting starts going out now.
      openNew(state);
      followUp();
      if (sendNews.length) message = [message, ...sendNews.splice(0)].filter(Boolean).join("\n"); // What the screen just said still stands.
      const rows = rowsFor(state);
      const spots = selectable(rows);
      if (!spots.includes(cursor)) cursor = spots[0] ?? null;
      draw(screen(tab, state, rows, cursor, c, message, live.started ? liveLine(frame, live.started, readActivity(), c, Date.now(), live.follow) : null), { still: ticking });
      frame += 1;
      // While a check runs, redraw often so new drafts show up; otherwise now and then, to catch a scheduled one.
      // The timeline's embers move, so it redraws as often as a check does.
      let key = await readKey({ tick: live.started || sending.size || (tab === "Pipeline" && timelineFrom !== null) ? 150 : 3000 });
      ticking = key === "tick";
      if (ticking) continue;
      message = undefined;
      if (key === "quit" || key === "escape") return 0;
      if (key?.click?.tab) key = { tab: key.click.tab };
      else if (key?.click?.row !== undefined) {
        cursor = key.click.row;
        key = "return";
      }
      if (key === "r") {
        // A check in the background, so the list stays usable while it reads and pushes.
        if (!view.setupSteps(state).every((step) => step.done)) message = "Finish setup first: type sellme setup.";
        else if (state.paused) message = "SELLME is paused, so it won’t check. Type sellme resume.";
        else if (!canRun()) message = c.red("✗ Checks need Claude Code on this machine.");
        else if (live.started) message = "Already selling you. New drafts show up here as they come.";
        else kick();
        continue;
      }
      if (key === "left" || key === "right" || key === "tab" || key?.tab) {
        tab = key?.tab ?? TABS[(TABS.indexOf(tab) + (key === "left" ? -1 : 1) + TABS.length) % TABS.length];
        cursor = null;
        if (tab === "Activity") withState((s) => s.notes.forEach((n) => (n.seen = true)));
        continue;
      }
      if (tab === "Pipeline" && key === "t") {
        timelineFrom = timelineFrom === null ? frame : null;
        cursor = null;
        continue;
      }
      if (cursor !== null && (key === "up" || key === "k" || key === "wheelup")) cursor = move(rows, cursor, -1);
      else if (cursor !== null && (key === "down" || key === "j" || key === "wheeldown")) cursor = move(rows, cursor, 1);
      const row = cursor === null ? null : rows[cursor];
      const enter = key === "return" || key === "enter";
      showCursor();
      let result = null;
      if (tab === "Agents" && (key === "a" || (enter && row?.id === ADD))) result = await addFlow(c);
      else if (tab === "Agents" && key === "s") result = (await chooseFlow(view.scorecard(load(), c), [{ key: "b", id: "back", label: "Back" }], c)) === "quit" ? "quit" : null;
      else if (tab === "Agents" && key === "d" && row?.connected && !row.tool) result = await removeFlow(row, c);
      else if (tab === "Agents" && enter && row) result = await detailFlow(row, c);
      else if (tab === "Drafts" && enter && row?.draft) result = await draftFlow(row.id, c);
      else if (tab === "Drafts" && enter && row?.learned) result = await learnedFlow(row.id, c);
      else if (tab === "Drafts" && enter && row?.yours) result = await yoursFlow(row.id, c);
      else if (tab === "Drafts" && enter && row?.sending) result = stopSend(row.id);
      else if (tab === "Drafts" && enter && row?.approved) result = await approvedFlow(row.id, c);
      else if (tab === "Pipeline" && timelineFrom !== null && key === "a") result = await nudgeAll(c);
      else if (tab === "Pipeline" && row?.onYou && enter) result = await draftFlow(row.onYou, c, { single: true });
      else if (tab === "Pipeline" && row?.role && enter) result = await roleFlow(row.id, c);
      else if (tab === "Pipeline" && row?.role && ["p", "n", "f", "c", "m", "d"].includes(key)) result = await roleFlow(row.id, c, key);
      else if (tab === "Schedule" && enter && row) result = applySchedule(row, c);
      else if (tab === "Activity" && enter && row && !row.alert) {
        if (opened.has(row.id)) opened.delete(row.id);
        else opened.add(row.id);
      } else if (tab === "Activity" && enter && row?.alert) {
        withState((s) => core.dismissAlert(s, row.id));
        result = `${c.lime("✓")} Dismissed.`;
      }
      hideCursor();
      if (result === "quit") return 0;
      message = result ?? undefined;
    }
  } finally {
    await finishSends(c);
    process.stdout.write("\x1b[?25h\x1b[?1049l");
  }
}

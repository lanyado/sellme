// The product's rules, as plain functions over the state. No printing and no disk access here.
import path from "node:path";
import { CATALOG } from "./catalog.js";
import { UserError, nextId } from "./store.js";
import { REFERRALS_ENABLED, signupList } from "./referrals.js";
import { KINDS, USER_CHOICE, check, checkUserWords, sameCompany, touchesScheduling } from "./truth.js";

// "self" is a person, like a human recruiter. Sellme drafts, and the user sends it from their own account.
export const SELF = "self";
export const CHANNELS = ["mcp", "imessage", "email", "browser", SELF];
export const STAGES = ["new", "talking", "interview", "offer", "hired", "rejected", "passed"];
export const REFERRAL_STAGES = ["signup", "interview", "offer", "hired", "paid"];
export { CATALOG };
// Opens the Full Disk Access pane on a Mac, which reading iMessage needs.
const FULL_DISK_ACCESS = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";
export const CONNECTION_STATES = ["ok", "signin", "access", "connector", "skip"];
const HANDLE_REQUIRED = ["imessage", "email"];
// Auto-approve covers plain answers only. A slot commits the user's time, so it still asks.
export const AUTO_KINDS = ["reply", "nudge", "disclosure"];
// Two bots replying to each other could otherwise go on forever.
export const AUTO_DAILY_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const now = () => new Date().toISOString();

function need(value, message) {
  if (value === undefined || value === null || value === true || value === "") throw new UserError(message);
  return value;
}

export function findAgent(state, name) {
  return state.agents.find((a) => a.name.toLowerCase() === String(name).toLowerCase());
}

function requireAgent(state, name) {
  const agent = findAgent(state, need(name, "Say which agent with --agent."));
  if (!agent) throw new UserError(`“${name}” isn’t a connected recruiter agent. If it’s a bot, connect it with: agent add "${name}". If it’s a person: add "${name}" --handle <their email, phone or LinkedIn>.`);
  return agent;
}

function requireItem(state, id) {
  need(id, "Which draft? Use its id, like q1.");
  const item = state.queue.find((q) => q.id === id);
  if (!item) throw new UserError(`There’s no draft ${id}.`);
  return item;
}

function requireActive(state) {
  if (state.paused) throw new UserError("Sellme is paused, so I won’t draft anything. Run: sellme resume");
}

// ---------------------------------------------------------------- profile and facts
// What a run writes where the resume goes in an email. The gate swaps in the file's bytes, so the AI never copies it.
export const ATTACH_TOKEN = "SELLME_RESUME";

/** Only email carries a file. Elsewhere the resume goes as a link in the message. */
export const carriesFiles = (item) => (item.channel === SELF ? personRoute(item.to) : item.channel) === "email";

/** Where the resume file is, and a link to it for channels that can't carry files. */
export function setResume(state, { file, link } = {}) {
  if (file !== undefined) state.profile.resume_file = need(file, "Which file? Give its full path.");
  if (link !== undefined) {
    if (!/^https?:\/\/\S+$/.test(String(link).trim())) throw new UserError("That isn’t a link. It should start with https://");
    state.profile.resume_link = String(link).trim();
  }
  return { file: state.profile.resume_file ?? null, link: state.profile.resume_link ?? null };
}

/** A question only the user can answer keeps its reply in `suggestion`; a draft keeps it in `text`. */
const replyField = (item) => (item.status === "blocked" && !item.text ? "suggestion" : "text");

/** The resume on one draft: the file itself by email, a link anywhere else. */
function putResumeOn(state, item) {
  const link = state.profile.resume_link;
  if (carriesFiles(item)) {
    if (!state.profile.resume_file) throw new UserError("I don’t know where your resume file is yet. Set it with: sellme profile set resume <file>");
    item.attach = "file";
    return;
  }
  if (!link) {
    // No link to send: the message goes, and the user attaches the file in the chat it opens for them.
    item.attach = "manual";
    return;
  }
  const field = replyField(item); // A question for the user carries the link in their reply.
  if (!String(item[field] ?? "").includes(link)) item[field] = item[field] ? `${item[field]} My resume: ${link}` : `My resume: ${link}`;
  if (!(item.sources ?? []).includes("profile.resume_link")) item.sources = [...(item.sources ?? []), "profile.resume_link"];
  item.attach = "link";
}

/** Adds the resume to a draft, or takes it off. The changed draft needs the user's yes again. */
export function attachResume(state, id, on = true) {
  const item = requireItem(state, id);
  if (!OPEN.includes(item.status)) throw new UserError(`${id} is already ${item.status}.`);
  const link = state.profile.resume_link;
  const field = replyField(item);
  if (!on) {
    if (item.attach === "link" && link && item[field]) item[field] = item[field].replace(` My resume: ${link}`, "").replace(`My resume: ${link}`, "").trim() || null;
    item.attach = null;
  } else putResumeOn(state, item);
  if (field === "suggestion") return item;
  if (item.text === null || item.text === undefined) return item;
  return editDraft(state, id, item.text);
}

export function setProfile(state, field, value) {
  need(value, `Give a value for ${field}.`);
  if (field === "roles") state.profile.roles = value.split(",").map((s) => s.trim()).filter(Boolean);
  else if (["name", "floor", "where"].includes(field)) state.profile[field] = value;
  else if (field === "resume") setResume(state, { file: value });
  else if (field === "resume-link") setResume(state, { link: value });
  else throw new UserError(`Profile has no “${field}”. Use name, roles, floor, where, resume or resume-link.`);
}

export function addFact(state, text, source) {
  const fact = { id: nextId(state, "f"), text: need(text, "What’s the fact?"), source: need(source, "Every fact needs --source: where it came from."), added: now() };
  state.facts.push(fact);
  return fact;
}

export function removeFact(state, id) {
  const before = state.facts.length;
  state.facts = state.facts.filter((f) => f.id !== id);
  if (state.facts.length === before) throw new UserError(`There’s no fact ${id}.`);
}

export function addNeverMention(state, term) {
  need(term, "What should I never mention?");
  if (!state.profile.never_mention.includes(term)) state.profile.never_mention.push(term);
}

// ---------------------------------------------------------------- agents
/** @param byRun a check added it from what it read, so the first message to it needs the user's yes */
export function addAgent(state, name, { channel, handle, person = false, byRun = false } = {}) {
  need(name, "Which agent?");
  const known = CATALOG[name.toLowerCase()];
  const agent = {
    name: known?.name ?? name,
    channel: person ? SELF : (channel ?? known?.channel),
    handle: handle ?? null,
  };
  if (!CHANNELS.includes(agent.channel)) throw new UserError(`How does ${agent.name} talk? Add --channel with one of: ${CHANNELS.join(", ")}.`);
  if (HANDLE_REQUIRED.includes(agent.channel) && !agent.handle) {
    throw new UserError(`${agent.name} talks over ${agent.channel}. Add --handle with its exact address, so I only ever message that one.`);
  }
  const existing = findAgent(state, agent.name);
  if (byRun && !existing) agent.added_by = "run";
  if (existing && (existing.handle !== agent.handle || existing.channel !== agent.channel)) {
    // A yes covers one message to one address. A new address from a check has to earn it again.
    if (byRun) existing.added_by = "run";
    for (const q of state.queue) {
      if (q.agent !== existing.name || !["pending", "blocked", "approved"].includes(q.status)) continue;
      q.channel = agent.channel;
      q.to = agent.handle;
      if (q.status === "approved") voidApproval(q);
    }
  }
  if (existing) Object.assign(existing, agent);
  else state.agents.push(agent);
  return agent;
}

export function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

/** Close enough to be a typo. Short names get less room, or "Max" would look like a misspelled "Dex". */
export const closeName = (a, b) => distance(a.toLowerCase(), b.toLowerCase()) <= (Math.min(a.length, b.length) >= 5 ? 2 : 1);

const catalogEntry = (name) => CATALOG[String(name).toLowerCase().replace(/\s+and\s+/, " & ").trim()];
// (317) 565-3727 and +1 317 565 3727 are one person, so compare the digits. Emails compare without case.
const handleKey = (handle) => (/@/.test(handle) ? handle.toLowerCase() : String(handle).replace(/\D/g, "").slice(-10));

/**
 * Adds to the user's own list, next to the built-in catalog. A recruiter is a person unless told otherwise.
 * Refuses near-duplicates: "Fonzie" is almost certainly Fonzi, and a second entry would split the history.
 */
export function addRecruiter(state, name, { handle, channel, company, bot = false, force = false, byRun = false } = {}) {
  need(name, "Who should I add? Use: sellme add \"Their Name\" --handle <number or email>");
  const known = catalogEntry(name);
  if (!known && !force) {
    const others = [...Object.values(CATALOG).map((c) => c.name), ...state.agents.map((a) => a.name)];
    const near = others.find((n) => n.toLowerCase() !== name.toLowerCase() && closeName(name, n));
    if (near) throw new UserError(`Did you mean ${near}? If “${name}” is someone else, add --force.`);
  }
  if (handle && !force) {
    const same = state.agents.find((a) => a.handle && handleKey(a.handle) === handleKey(handle) && a.name.toLowerCase() !== (known?.name ?? name).toLowerCase());
    if (same) throw new UserError(`${handle} already belongs to ${same.name}. If that’s changed, remove them first, or add --force.`);
  }
  // Catalog agents already say how they talk. Anyone else is a person unless they're a bot.
  const added = addAgent(state, known?.name ?? name, { handle, channel, person: !known && !bot && !channel, byRun });
  const stored = findAgent(state, added.name);
  if (company) stored.company = company;
  return stored;
}

/** The built-in catalog, marked by what's connected, then everyone the user added. */
export function roster(state) {
  const builtIn = new Set(Object.values(CATALOG).map((c) => c.name));
  return {
    catalog: Object.values(CATALOG).map((c) => {
      const mine = findAgent(state, c.name);
      return { name: c.name, channel: mine?.channel ?? c.channel, connected: Boolean(mine), auto: Boolean(mine && autoOn(state, mine)), about: c.about, url: c.signin };
    }),
    yours: state.agents.filter((a) => !builtIn.has(a.name)).map((a) => ({ name: a.name, channel: a.channel, handle: a.handle, company: a.company ?? null, person: a.channel === SELF, auto: autoOn(state, a) })),
  };
}

export class ImportError extends UserError {}

function splitCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

/** Turns CSV or vCard text into people. Unreadable lines come back as problems rather than being guessed at. */
export function parseContacts(text) {
  const raw = String(text ?? "").replace(/^﻿/, "");
  if (/BEGIN:VCARD/i.test(raw)) {
    return raw.split(/BEGIN:VCARD/i).slice(1).map((card) => {
      const field = (key) => card.match(new RegExp(`^${key}(?:;[^:\\r\\n]*)?:(.*)$`, "im"))?.[1]?.trim() ?? "";
      return { name: field("FN"), handle: field("TEL") || field("EMAIL"), company: field("ORG").replace(/;+$/, "") };
    });
  }
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length && /^name\b/i.test(lines[0])) lines.shift(); // A header row.
  return lines.map((line) => {
    const [name = "", handle = "", company = ""] = splitCsvLine(line);
    return { name, handle, company };
  });
}

/** Adds everyone it can. A duplicate or a typo stops that one entry, never the whole file. */
export function importRecruiters(state, text) {
  const added = [];
  const problems = [];
  for (const { name, handle, company } of parseContacts(text)) {
    if (!name || !handle) {
      problems.push({ name: name || handle || "A line", reason: "It needs a name and a number or email." });
      continue;
    }
    try {
      added.push(addRecruiter(state, name, { handle, company: company || undefined }).name);
    } catch (err) {
      if (!err.userFacing) throw err;
      problems.push({ name, reason: err.message });
    }
  }
  return { added, problems };
}

/** Records what a run found when it tried to reach something. Names can be anything: a calendar isn't an agent. */
export function setConnection(state, name, status, reason) {
  need(name, "Which one? Use: connect \"<name>\" ok|signin|access|connector|skip");
  if (!CONNECTION_STATES.includes(status)) throw new UserError(`Use one of: ${CONNECTION_STATES.join(", ")}.`);
  const key = findAgent(state, name)?.name ?? catalogEntry(name)?.name ?? name;
  if (status === "ok") delete state.connections[key];
  else state.connections[key] = { status, reason: reason ?? null, ts: now() };
  return key;
}

/**
 * Everything the user has to do so Sellme can reach something, each with one link where one exists.
 * `blocking` means a run tried and couldn't get in. The rest are signups the user hasn't made or declined.
 */
export function connectList(state) {
  const items = [];
  for (const [name, { status, reason }] of Object.entries(state.connections)) {
    if (status === "skip") continue;
    const entry = catalogEntry(name);
    const channel = findAgent(state, name)?.channel ?? entry?.channel;
    if (status === "signin") items.push({ name, kind: "signin", blocking: true, action: reason ?? "Sign in", url: entry?.signin ?? null });
    else if (status === "access") {
      const onMac = channel === "imessage";
      items.push({ name, kind: "access", blocking: true, action: reason ?? (onMac ? "Allow Full Disk Access for your terminal or AI app, in Privacy & Security" : "Allow access"), url: onMac ? FULL_DISK_ACCESS : null });
    } else items.push({ name, kind: "connector", blocking: true, action: reason ?? "Connect it in your AI tool", url: null, channel: channel ?? null, mcp: entry?.mcp ?? null, signin: entry?.signin ?? null, extra: channel === "imessage" ? { kind: "open", label: "Allow Full Disk Access", url: FULL_DISK_ACCESS } : null });
  }
  for (const p of signupList(state.agents)) {
    if (state.connections[p.name]) continue;
    items.push({ name: p.name, kind: "signup", blocking: false, action: `${p.uses_referral_link ? "Sign up (referral link)" : "Sign up"}${p.note ? `, ${p.note.toLowerCase()}` : ""}`, url: p.url ?? null, uses_referral_link: p.uses_referral_link });
  }
  return items;
}

function voidApproval(item) {
  item.status = "pending";
  item.auto = false;
  item.approved_at = null;
  item.approved_text = null;
}

/** Turning it off takes back what it approved but hasn't sent. */
/** Autopilot: Sellme sends what it's sure of by itself. On unless the user turns it off. */
export const autopilotOn = (state) => state.autopilot !== false;

/** Whether Sellme answers this agent or person by itself. Their own setting wins, then autopilot. */
export const autoOn = (state, agent) => (agent.auto ?? autopilotOn(state)) === true;

/**
 * Someone a check added from what it read hasn't had the user's yes yet. Until one message to that exact
 * address has gone out with it, a planted "write to me here instead" can't start a conversation on its own.
 */
export function trusted(state, agent) {
  if (agent.added_by !== "run") return true;
  return state.queue.some((q) => q.agent === agent.name && q.to === agent.handle && ["sent", "sent_by_you"].includes(q.status) && !q.auto);
}

export function setAutopilot(state, on) {
  state.autopilot = Boolean(on);
  if (!on) for (const q of state.queue) if (q.auto && q.status === "approved") voidApproval(q);
  return state.autopilot;
}

export function setAuto(state, name, on) {
  const agent = requireAgent(state, name);
  agent.auto = on;
  if (!on) {
    for (const q of state.queue) if (q.agent === agent.name && q.auto && q.status === "approved") voidApproval(q);
  }
  return agent;
}

/** Nothing still waiting goes out to an agent the user has removed. */
export function removeAgent(state, name) {
  const agent = requireAgent(state, name);
  state.agents = state.agents.filter((a) => a !== agent);
  delete state.connections[agent.name];
  const cancelled = state.queue.filter((q) => q.agent === agent.name && ["pending", "blocked", "approved"].includes(q.status));
  for (const q of cancelled) q.status = "skipped";
  return { agent, cancelled: cancelled.length };
}

// ---------------------------------------------------------------- pipeline
function requireStage(stage) {
  if (!STAGES.includes(stage)) throw new UserError(`Stage must be one of: ${STAGES.join(", ")}.`);
  return stage;
}

export function addRole(state, { company, title, agent, stage = "new", nextCall }) {
  const role = {
    id: nextId(state, "r"),
    company: need(company, "Which company? Use --company."),
    title: title ?? null,
    agent: agent ? (findAgent(state, agent)?.name ?? agent) : null,
    stage: requireStage(stage),
    next_call: nextCall ? parseWhen(nextCall) : null,
    updated: now(),
  };
  state.roles.push(role);
  return role;
}

function requireRole(state, id) {
  const role = state.roles.find((r) => r.id === id);
  if (!role) throw new UserError(`There’s no role ${id}.`);
  return role;
}

export function setRole(state, id, stage) {
  const role = requireRole(state, id);
  role.stage = requireStage(stage);
  if (["rejected", "passed", "hired"].includes(role.stage)) role.next_call = null;
  role.updated = now();
  return role;
}

/**
 * "2026-11-05 14:00" or "Nov 5 2pm". A date without a year means the next time it comes round,
 * because JavaScript would otherwise read it as 2001.
 */
export function parseWhen(text, today = new Date()) {
  const spaced = String(text).trim().replace(/(?<![:\d])(\d{1,2})\s*(am|pm)\b/i, "$1:00 $2");
  const date = new Date(/\b\d{4}\b/.test(spaced) ? spaced : spaced.replace(/^([a-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?)/i, `$1 ${today.getFullYear()}`).replace(/(\d)(st|nd|rd|th)\b/i, "$1"));
  if (Number.isNaN(date.getTime())) throw new UserError(`I can’t read “${text}” as a date. Try: Nov 5 2:00 PM`);
  if (!/\b\d{4}\b/.test(spaced) && date < today) date.setFullYear(date.getFullYear() + 1);
  return date.toISOString();
}

/** The next call on a role. Nothing, or "none", clears it. */
export function setNextCall(state, id, when) {
  const role = requireRole(state, id);
  role.next_call = !when || when === "none" ? null : parseWhen(when);
  role.updated = now();
  return role;
}

export const upcomingCall = (role, today = new Date()) => (role.next_call && new Date(role.next_call) > today ? role.next_call : null);

/** Leaves any drafts alone: taking a role off the list says nothing about what to tell people. */
export function removeRole(state, id) {
  const role = requireRole(state, id);
  state.roles = state.roles.filter((r) => r !== role);
  return role;
}

/** A plain nudge the user can read and change before it goes anywhere. */
export function nudgeText(state, role, agent) {
  const what = role.title ? `the ${role.title} role at ${role.company}` : role.company;
  if (agent.channel === SELF) return `Hi ${agent.name.split(/\s+/)[0]}, any update on ${what}? I'd still love to keep talking.`;
  const name = state.profile?.name?.split(/\s+/)[0];
  return `Any update on ${what}?${name ? ` ${name} would still like to keep talking.` : ""}`;
}

/** What the user's own records say about a company. An agent's list is its view, not the truth. */
export function reconcile(state, company) {
  need(company, "Which company?");
  const roles = state.roles.filter((r) => sameCompany(r.company, company));
  const dead = roles.some((r) => ["rejected", "passed"].includes(r.stage));
  return { company, known: roles.length > 0, safe_to_mention: !dead, roles };
}

export function addNote(state, agent, text) {
  // A note can be about a person or a pasted message, so the name doesn't have to be a connected agent.
  const note = { id: nextId(state, "n"), agent: findAgent(state, need(agent, "Who is this about? Use --agent."))?.name ?? agent, text: need(text, "What happened? Use --text."), ts: now(), seen: false };
  state.notes.push(note);
  return note;
}

/** Something the user must see, with nothing to answer: an attack, an offer, a broken channel. */
export function addAlert(state, agent, text) {
  // An alert can come from a transcript or email, so the source doesn't have to be a connected agent.
  const alert = { id: nextId(state, "a"), agent: agent ? (findAgent(state, agent)?.name ?? agent) : null, text: need(text, "What should they know? Use --text."), ts: now() };
  state.alerts.push(alert);
  return alert;
}

export function dismissAlert(state, id) {
  const before = state.alerts.length;
  state.alerts = state.alerts.filter((a) => a.id !== id);
  if (state.alerts.length === before) throw new UserError(`There’s no alert ${id}.`);
}

// ---------------------------------------------------------------- the approval gate
const OPEN = ["pending", "blocked"];

function applyCheck(state, item) {
  const verdict = check(state, item);
  item.check = verdict;
  item.sensitive = verdict.result === "needs_you";
  item.status = verdict.result === "blocked" ? "blocked" : "pending";
  item.approved_at = null;
  item.approved_text = null;
}

/**
 * Checks every open draft again with today's rules, so a reason shown to the user is never stale.
 * It never approves anything: a draft that now passes just waits for the user's yes like any other.
 * @returns how many changed
 */
export function recheckOpen(state) {
  let changed = 0;
  for (const item of state.queue) {
    // Approved before Sellme sent to people itself, or before it had their address.
    if (item.status === "yours") {
      const to = item.to ?? state.agents.find((a) => a.name === item.agent)?.handle;
      if (personRoute(to) && item.text === item.approved_text) {
        Object.assign(item, { status: "approved", to, via: personRoute(to) });
        changed += 1;
      }
      continue;
    }
    if (!["pending", "blocked"].includes(item.status) || !item.text) continue;
    const before = JSON.stringify([item.status, item.check, item.sensitive]);
    const verdict = check(state, item);
    item.check = verdict;
    item.sensitive = verdict.result === "needs_you";
    item.status = verdict.result === "blocked" ? "blocked" : "pending";
    if (JSON.stringify([item.status, item.check, item.sensitive]) !== before) changed += 1;
  }
  return changed;
}

function autoApprove(state, item, agent) {
  if (!autoOn(state, agent) || state.paused || item.status !== "pending" || item.sensitive || !AUTO_KINDS.includes(item.kind)) return;
  if (item.attach === "manual") return; // You attach the resume yourself, so you have to be there.
  if (agent.channel === SELF && !personRoute(agent.handle)) return;
  if (!trusted(state, agent)) {
    item.check.reasons.push({ code: "new_contact", message: `It’s the first message to ${agent.name} at ${agent.handle ?? "this address"}, so it needs your yes. After that I answer them myself.` });
    return;
  }
  if (touchesScheduling(item)) {
    item.check.reasons.push({ code: "scheduling", message: "This commits your time, so it needs your yes." });
    return;
  }
  const recent = state.queue.filter((q) => q.agent === agent.name && q.auto && Date.now() - new Date(q.created).getTime() < DAY_MS).length;
  if (recent >= AUTO_DAILY_LIMIT) {
    item.check.reasons.push({ code: "auto_limit", message: `That’s ${AUTO_DAILY_LIMIT} automatic messages to ${agent.name} in a day, so this one needs your yes.` });
    return;
  }
  item.status = "approved";
  item.auto = true;
  item.approved_at = now();
  item.approved_text = item.text;
  if (item.channel === SELF) item.via = personRoute(item.to);
}

/** A run that reads the same thread twice shouldn't ask the user the same thing twice. */
function sameQuestion(state, agent, asked) {
  const plain = (t) => String(t ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!plain(asked)) return null;
  return state.queue.find((q) => OPEN.includes(q.status) && plain(q.agent) === plain(agent) && plain(q.asked) === plain(asked)) ?? null;
}

export function addDraft(state, { agent, text, asked, kind = "reply", sources = [], company, role, attach = false }) {
  requireActive(state);
  const already = sameQuestion(state, agent, asked);
  if (already?.text === text) return already;
  const who = requireAgent(state, agent);
  if (!KINDS.includes(kind)) throw new UserError(`Kind must be one of: ${KINDS.join(", ")}.`);
  if (sources.includes(USER_CHOICE)) throw new UserError(`Only the user can give ${USER_CHOICE}, by pressing yes or no in the app.`);
  const item = {
    id: nextId(state, "q"),
    agent: who.name,
    channel: who.channel,
    to: who.handle,
    kind,
    asked: asked ?? null,
    text: need(text, "What does the draft say? Use --text."),
    sources,
    company: company ?? null,
    role: role ?? null,
    created: now(),
  };
  if (attach) putResumeOn(state, item); // Before the check, so a reply with the resume can still go by itself.
  applyCheck(state, item);
  autoApprove(state, item, who);
  state.queue.push(item);
  return item;
}

/** Record a question the agent refused to draft for, so the user answers it. */
/** @param suggest the reply the user would most likely send. Only a suggestion: nothing goes out without their yes. */
export function addBlock(state, { agent, asked, reason, company, suggest }) {
  requireActive(state);
  const already = sameQuestion(state, agent, asked);
  if (already) return already;
  const who = requireAgent(state, agent);
  const item = {
    id: nextId(state, "q"),
    agent: who.name,
    channel: who.channel,
    to: who.handle,
    kind: "reply",
    asked: need(asked, "What did they ask? Use --asked."),
    text: null,
    sources: [],
    company: company ?? null,
    role: null,
    created: now(),
    status: "blocked",
    sensitive: checkUserWords(state, { text: "", asked, agent: who.name, channel: who.channel }).sensitive.length > 0,
    check: { result: "blocked", reasons: [{ code: "agent_block", message: need(reason, "Why can’t it be answered? Use --reason.") }] },
    suggestion: String(suggest ?? "").trim() || null,
    approved_at: null,
    approved_text: null,
  };
  state.queue.push(item);
  return item;
}

export function openItems(state) {
  return state.queue.filter((q) => OPEN.includes(q.status));
}

/**
 * How Sellme reaches a person, from their handle: email, a phone number (iMessage), or a LinkedIn profile.
 * It sends from the user's own account, in their voice, and only what they approved word for word.
 */
export function personRoute(handle) {
  const h = String(handle ?? "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(h)) return "email";
  if (/linkedin\.com\/in\//i.test(h)) return "linkedin";
  if (/^\+?[\d\s().-]{7,}$/.test(h)) return "imessage";
  return null;
}

/** The user's yes. It goes to the outbox, to a person too, unless there's no address to send it to. */
function markApproved(state, item) {
  item.approved_at = now();
  item.approved_text = item.text;
  if (item.channel !== SELF) {
    item.status = "approved";
    return;
  }
  const via = personRoute(item.to);
  if (via) {
    item.status = "approved";
    item.via = via;
    return;
  }
  // Nowhere to send it. It waits for an address instead of going to the user to send.
  item.status = "yours";
  state.notes.push({ id: nextId(state, "n"), agent: item.agent, text: `Approved, but I have no email, phone or LinkedIn for ${item.agent}. Add one and I’ll send it.`, ts: now(), seen: false });
}

export function approve(state, id, { confirmSensitive = false } = {}) {
  const item = requireItem(state, id);
  if (item.status === "blocked") throw new UserError(`${id} is blocked: ${item.check.reasons[0].message} Fix it with edit, or answer it yourself.`);
  if (item.status !== "pending") throw new UserError(`${id} is already ${item.status}.`);
  if (item.sensitive && !confirmSensitive) {
    throw new UserError(`${id} needs your own yes: ${item.check.reasons[0].message} Only the user can confirm this, with --confirm-sensitive.`);
  }
  markApproved(state, item);
  return item;
}

/**
 * A reply for a question only the user can answer: suggested by the AI, or edited by the user.
 * It never sends by itself. The user's yes on it goes through answerYourself, as their own words.
 */
export function setSuggestion(state, id, text, { by = "ai" } = {}) {
  const item = requireItem(state, id);
  if (item.status !== "blocked") throw new UserError(`${id} isn’t waiting on your answer.`);
  item.suggestion = need(String(text ?? "").trim(), "What should it say?");
  item.suggested_by = by;
  item.instructions = null; // Done with: the next note is about this version.
  return item;
}

/** Changing their mind before it goes out. */
export function takeBack(state, id) {
  const item = requireItem(state, id);
  if (item.status !== "approved") throw new UserError(`${id} is already ${item.status}.`);
  voidApproval(item);
  return item;
}

/** Any edit voids the approval and runs the check again. */
export function editDraft(state, id, text) {
  const item = requireItem(state, id);
  if (!["pending", "blocked", "approved", "yours"].includes(item.status)) throw new UserError(`${id} is already ${item.status}.`);
  item.text = need(text, "What should it say? Use --text.");
  item.auto = false; // A changed draft never goes out on an earlier automatic yes.
  item.instructions = null;
  applyCheck(state, item);
  return item;
}

/** The user's own words. They answer for the claims, but the rules on honesty and secrets still hold. */
export function answerYourself(state, id, text, { confirmSensitive = false } = {}) {
  requireActive(state);
  const item = requireItem(state, id);
  if (!OPEN.includes(item.status)) throw new UserError(`${id} is already ${item.status}.`);
  need(text, "What’s your answer? Use --text.");
  const verdict = checkUserWords(state, { text, asked: item.asked, company: item.company, agent: item.agent, channel: item.channel, attach: item.attach });
  if (verdict.blocked.length) throw new UserError(`${id} can’t go out through your agent: ${verdict.blocked[0].message}`);
  if ((verdict.sensitive.length || item.sensitive) && !confirmSensitive) {
    const why = verdict.sensitive[0]?.message ?? item.check.reasons[0].message;
    throw new UserError(`${id} needs your own yes: ${why} Only the user can confirm this, with --confirm-sensitive.`);
  }
  item.text = text;
  item.sources = ["user"];
  item.sensitive = false;
  markApproved(state, item);
  return item;
}

export function skip(state, id) {
  const item = requireItem(state, id);
  if (item.status === "sent") throw new UserError(`${id} was already sent.`);
  item.status = "skipped";
  return item;
}

/**
 * A run saw the user already dealt with this, say by answering it themselves. It only labels the item:
 * it stays on the list until the user clears it, so a run can never hide anything.
 */
export function markHandled(state, id, reason) {
  const item = requireItem(state, id);
  if (!OPEN.includes(item.status)) throw new UserError(`${id} isn’t open, so there’s nothing to mark.`);
  item.handled = { reason: need(reason, "Say how you know, with --reason."), ts: now() };
  return item;
}

/** No, not this draft. It's dropped, and the reason stays for the next one. */
export function reject(state, id) {
  const item = requireItem(state, id);
  if (item.status === "sent") throw new UserError(`${id} was already sent.`);
  item.status = "rejected";
  return item;
}

/** A note for the AI. The app rewrites from it straight away. If it can't, the next /sellme picks it up. */
export function instruct(state, id, text) {
  const item = requireItem(state, id);
  if (!OPEN.includes(item.status)) throw new UserError(`${id} is already ${item.status}.`);
  item.instructions = need(text, "What should change?");
  return item;
}

/**
 * The AI's new version of a draft. Checked like any edit, and it still needs the user's yes.
 * @param choice the user pressed yes or no on this question, so their choice backs the answer
 */
export function applyRewrite(state, id, { text, sources, was }, { choice = false } = {}) {
  const item = requireItem(state, id);
  if (!OPEN.includes(item.status)) throw new UserError(`${id} is already ${item.status}.`);
  if ((item.text ?? null) !== was) throw new UserError(`${id} changed while I was rewriting it, so I left it alone.`);
  const own = (sources ?? []).filter((x) => x !== USER_CHOICE);
  item.sources = choice ? [...own, USER_CHOICE] : own;
  return editDraft(state, id, text);
}

/** The user says they sent a person's reply themselves. */
export function sentByYou(state, id) {
  const item = requireItem(state, id);
  if (item.status !== "yours") throw new UserError(`${id} isn’t waiting on you to send.`);
  item.status = "sent_by_you";
  item.sent_at = now();
  return item;
}

/** The one subject line a new email to a person can have, so a run never makes one up. */
export const emailSubject = (state, q) => [q.company, state.profile.name].filter(Boolean).join(" · ") || "Following up";

export function outbox(state) {
  if (state.paused) return [];
  return state.queue
    .filter((q) => q.status === "approved")
    .map((q) => ({
      id: q.id,
      agent: q.agent,
      channel: q.channel === SELF ? (q.via ?? personRoute(q.to)) : q.channel,
      ...(q.channel === SELF ? { person: true } : {}),
      to: q.to,
      text: q.approved_text,
      ...(q.channel === SELF && personRoute(q.to) === "email" ? { subject: emailSubject(state, q) } : {}),
      ...(q.attach === "file" ? { attach: { filename: path.basename(state.profile.resume_file ?? "resume.pdf"), content: ATTACH_TOKEN } } : {}),
      ...(q.send_cleared ? { attempted: q.send_cleared.ts } : {}),
    }));
}

/**
 * An answer only the user could give, once it's gone out, becomes one of their facts in ~/.sellme. So next time
 * "Open to travel?" already has an answer. Times and pay are left out: they change, or they're the user's alone.
 */
function remember(state, item) {
  if (!(item.sources ?? []).includes("user") || !item.asked || touchesScheduling(item) || item.sensitive) return;
  const text = `Asked “${item.asked}”, you said: “${item.text}”`;
  if (state.facts.some((f) => f.text === text)) return;
  state.facts.push({ id: nextId(state, "f"), text, source: `your answer to ${item.agent}, ${now().slice(0, 10)}`, added: now() });
  item.remembered = true;
}

export function markSent(state, id) {
  const item = requireItem(state, id);
  if (item.status !== "approved" || item.text !== item.approved_text) {
    throw new UserError(`${id} isn’t approved, so it shouldn’t have gone out. Tell the user now.`);
  }
  item.status = "sent";
  item.sent_at = now();
  remember(state, item);
  // If the user wasn't asked, make sure they see it. If they were, it's still on record once it leaves the list.
  state.notes.push({ id: nextId(state, "n"), agent: item.agent, text: `${item.auto ? "Sent for you" : "Sent"}: “${item.text}”`, ts: now(), seen: !item.auto });
  return item;
}

// ---------------------------------------------------------------- referrals
export function logReferral(state, { agent, stage, company, link }) {
  if (!REFERRALS_ENABLED) throw new UserError("Referral links are turned off in lib/referrals.js, so there’s nothing to log.");
  if (!REFERRAL_STAGES.includes(stage)) throw new UserError(`Stage must be one of: ${REFERRAL_STAGES.join(", ")}.`);
  // A signup is logged before the agent is connected, so it doesn't have to be connected yet.
  const entry = { id: nextId(state, "l"), agent: findAgent(state, need(agent, "Which agent? Use --agent."))?.name ?? agent, stage, company: company ?? null, link: link ?? null, ts: now() };
  state.ledger.push(entry);
  return entry;
}

// ---------------------------------------------------------------- closing out
export function hired(state, company) {
  state.paused = true;
  state.hired = { company: company ?? null, at: now() };
  // The same company can hold an old rejection and the live role, so close the live one.
  const matches = company ? state.roles.filter((r) => sameCompany(r.company, company)) : [];
  const role = matches.find((r) => !["rejected", "passed"].includes(r.stage)) ?? matches[0];
  if (role) setRole(state, role.id, "hired");
}

export function counts(state) {
  const by = (stages) => state.roles.filter((r) => stages.includes(r.stage)).length;
  return {
    agents: state.agents.filter((a) => a.channel !== SELF).length, // The brag card says "recruiter agents".
    roles: by(["new", "talking", "interview", "offer", "hired"]),
    talking: by(["talking"]),
    interviews: by(["interview"]),
    offers: by(["offer", "hired"]),
    sent: state.queue.filter((q) => q.status === "sent").length,
  };
}

// The product's rules, as plain functions over the state. No printing and no disk access here.
import path from "node:path";
import { CATALOG } from "./catalog.js";
import { UserError, nextId } from "./store.js";
import { DAY, replyTiming, scorecard } from "./insights.js";
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
  if (state.paused) throw new UserError("SELLME is paused, so it won’t draft anything. Run: sellme resume");
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
    if (!state.profile.resume_file) throw new UserError("SELLME doesn’t know where your resume file is yet. Set it with: sellme profile set resume <file>");
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
  need(term, "What should SELLME never mention?");
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
    throw new UserError(`${agent.name} talks over ${agent.channel}. Add --handle with its exact address, so SELLME only ever messages that one.`);
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
  else {
    // Connected by the user: SELLME opens the conversation on its next check, which the app starts at once.
    if (!byRun && !person) agent.intro = true;
    state.agents.push(agent);
  }
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
  need(name, "Who should SELLME add? Use: sellme add \"Their Name\" --handle <number or email>");
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
      return { name: c.name, channel: mine?.channel ?? c.channel, connected: Boolean(mine), auto: Boolean(mine && autoOn(state, mine)), earned: Boolean(mine?.auto_topics?.length), about: c.about, url: c.signin };
    }),
    yours: state.agents.filter((a) => !builtIn.has(a.name)).map((a) => ({ name: a.name, channel: a.channel, handle: a.handle, company: a.company ?? null, person: a.channel === SELF, auto: autoOn(state, a), earned: Boolean(a.auto_topics?.length) })),
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
  const agent = findAgent(state, key);
  // Just reachable, and never written to: it gets an opening message.
  if (status === "ok" && state.connections[key] && agent && agent.channel !== SELF && !state.queue.some((q) => q.agent === agent.name && q.status === "sent")) agent.intro = true;
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

// ---------------------------------------------------------------- trust the user has given, topic by topic
/** What a draft answers, when one word for it is safe to say. Only these can earn their way to going by themselves. */
const TOPIC_WORDS = {
  location: /\b(relocat\w*|remote|on-?site|hybrid|based in|where are you|location|commute|in[- ]person)\b/i,
  authorization: /\b(visa|sponsor\w*|work authori[sz]\w*|authori[sz]ed to work|citizen\w*|green card)\b/i,
  experience: /\b(experience|years? of|have you (?:built|led|worked|used|managed|shipped)|background|tech stack|familiar with|worked with|skills?)\b/i,
  interest: /\b(interested|still looking|would you like|want me to|intro(?:duc\w*)?|new matches?)\b/i,
  resume: /\b(resume|résumé|cv|linkedin|github|portfolio)\b/i,
};
export const TOPICS = { nudge: "follow-ups", location: "location", authorization: "work authorization", experience: "your experience", interest: "interest in a role", resume: "your resume and links" };
export const EARN_AT = 10;

/** @returns a topic, or null when it's sensitive, about time, unclear, or more than one thing at once */
export function topicOf(q) {
  if (q.sensitive || !AUTO_KINDS.includes(q.kind) || touchesScheduling(q)) return null;
  if (q.kind === "nudge") return "nudge";
  const found = Object.keys(TOPIC_WORDS).filter((t) => TOPIC_WORDS[t].test(q.asked ?? ""));
  return found.length === 1 ? found[0] : null;
}

const same = (a, b) => String(a ?? "").toLowerCase().replace(/\s+/g, " ").trim() === String(b ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** How many answers on this topic in a row the user approved exactly as drafted. A skip or a change starts it over. */
export function earnedStreak(state, name, topic) {
  let streak = 0;
  for (let i = state.queue.length - 1; i >= 0; i -= 1) {
    const q = state.queue[i];
    if (q.agent !== name || q.auto || topicOf(q) !== topic) continue;
    if (q.declined) break;
    if (!q.approved_at) continue;
    if (!q.drafted || q.told?.length || !same(q.drafted, q.approved_text)) break;
    streak += 1;
  }
  return streak;
}

/** Offered right after a yes, never turned on by itself. Only for recruiter bots still asking first. @returns the offer, or null */
export function earnedOffer(state, id) {
  const q = state.queue.find((x) => x.id === id);
  const agent = q && findAgent(state, q.agent);
  if (!agent || agent.channel === SELF || autoOn(state, agent)) return null;
  const topic = topicOf(q);
  if (!topic || agent.auto_topics?.includes(topic)) return null;
  const streak = earnedStreak(state, agent.name, topic);
  const passedAt = agent.auto_passed?.[topic] ?? 0;
  if ((streak >= passedAt ? streak - passedAt : streak) < EARN_AT) return null;
  return { agent: agent.name, topic, label: TOPICS[topic], streak };
}

/** The user's answer to that offer. A no is asked again only after as many more yeses. */
export function answerEarned(state, name, topic, yes) {
  const agent = requireAgent(state, name);
  if (yes) {
    agent.auto_topics = [...new Set([...(agent.auto_topics ?? []), topic])];
    recheckOpen(state);
  } else agent.auto_passed = { ...agent.auto_passed, [topic]: earnedStreak(state, agent.name, topic) };
  return agent;
}

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
    delete agent.auto_topics; // "Ask me again" means everything, including what it earned.
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

/** Raised when briefs are written differently, so one saved before is written again instead of being shown. */
export const BRIEF_VERSION = 2;

/** Keeps the prep brief for this call, so opening it again doesn't write it again. */
export function savePrep(state, id, brief) {
  const role = requireRole(state, id);
  role.prep = { brief: need(String(brief ?? "").trim(), "What's the brief?"), for_call: role.next_call ?? null, at: now(), v: BRIEF_VERSION };
  return role;
}

/** Which agent the role goes through: the one that submitted the user, so others don't submit them twice. */
export function setRoleAgent(state, id, agent) {
  const role = requireRole(state, id);
  const found = findAgent(state, agent);
  if (!found) throw new UserError(`“${agent}” isn’t one of your agents.`);
  role.agent = found.name;
  role.updated = now();
  return role;
}

export function setRole(state, id, stage) {
  const role = requireRole(state, id);
  role.stage = requireStage(stage);
  role.moves = [...(role.moves ?? []), { stage: role.stage, at: now() }]; // A role rejected after an interview still got an interview.
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
  if (Number.isNaN(date.getTime())) throw new UserError(`SELLME can’t read “${text}” as a date. Try: Nov 5 2:00 PM`);
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
// SELLME's own bookkeeping (its message ids, what it auto-approved, its outbox) is history, not something to decide.
const HOUSEKEEPING = /\bq\d+\b|auto-approved|\bthe helper\b|\boutbox\b|\bthe run\b/i;
export const isHousekeeping = (text) => HOUSEKEEPING.test(String(text ?? ""));

/** @param title what happened, in a few words, as the alert's headline */
export function addAlert(state, agent, text, title) {
  // An alert can come from a transcript or email, so the source doesn't have to be a connected agent.
  const who = agent ? (findAgent(state, agent)?.name ?? agent) : null;
  const said = need(text, "What should they know? Use --text.");
  if (isHousekeeping(`${title ?? ""} ${said}`)) return { ...addNote(state, who ?? "SELLME", said), note: true };
  const alert = { id: nextId(state, "a"), agent: who, ...(String(title ?? "").trim() ? { title: String(title).trim().slice(0, 60) } : {}), text: said, ts: now() };
  state.alerts.push(alert);
  return alert;
}

/** The alerts the user has to read: what needs a decision, never SELLME's own bookkeeping. */
export const userAlerts = (state) => (state.alerts ?? []).filter((a) => !isHousekeeping(a.text));

const withoutName = (a) => {
  const t = String(a.text ?? "").trim();
  return a.agent && t.toLowerCase().startsWith(`${a.agent.toLowerCase()}:`) ? t.slice(a.agent.length + 1).trim() : t;
};

/** What happened, in a few words: the title a run gave, or the text up to its first colon or full stop. */
export function alertHeadline(a) {
  if (a.title) return a.title;
  const head = withoutName(a).split(/[:.](?=\s|$)/)[0].trim();
  return head.length <= 44 ? head : `${head.slice(0, 43).replace(/\s+\S*$/, "")}…`;
}

/** The rest of the alert, after its headline. */
export function alertBody(a) {
  const t = withoutName(a);
  if (a.title) return t;
  const head = t.split(/[:.](?=\s|$)/)[0];
  return t.slice(head.length).replace(/^[:.]\s*/, "").trim() || t;
}

/** Alerts that say the same kind of thing, together, newest group first: three double submissions are one row. */
export function alertGroups(state) {
  const groups = new Map();
  for (const a of userAlerts(state)) {
    const key = alertHeadline(a).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!groups.has(key)) groups.set(key, { headline: alertHeadline(a), alerts: [] });
    groups.get(key).alerts.push(a);
  }
  const newest = (g) => g.alerts.map((a) => a.ts).sort().at(-1);
  return [...groups.values()].sort((x, y) => newest(y).localeCompare(newest(x)));
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
 * A draft that autopilot can now send by itself (it was drafted before autopilot, or under an older rule) is approved
 * the same way a new one would be, so an agent on auto never waits on the user's list.
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
    if (OPEN.includes(item.status) && item.handled) {
      item.status = "skipped"; // Marked handled before that meant skipped.
      addNote(state, item.agent, `No reply needed: ${item.handled.reason}`);
      changed += 1;
      continue;
    }
    // The same words already went to the same place (two runs drafted it at once): it's done, not stuck.
    const sent = ["pending", "blocked", "approved"].includes(item.status) && item.text && state.queue.find((q) => q !== item && q.status === "sent" && q.agent === item.agent && (q.to ?? null) === (item.to ?? null) && plain(q.text) === plain(item.text) && new Date(q.sent_at ?? q.created) >= new Date(item.created ?? 0) - TWIN_MS);
    if (sent && !item.sending) {
      item.status = "skipped";
      addNote(state, item.agent, `Already sent as ${sent.id}, so this copy was dropped`);
      changed += 1;
      continue;
    }
    if (!["pending", "blocked"].includes(item.status) || !item.text) continue;
    const before = JSON.stringify([item.status, item.check, item.sensitive]);
    const verdict = check(state, item);
    item.check = verdict;
    item.sensitive = verdict.result === "needs_you";
    item.status = verdict.result === "blocked" ? "blocked" : "pending";
    // The autopilot gates add their own reasons, so the card always says why one still needs the user.
    const agent = state.agents.find((a) => a.name === item.agent);
    if (agent) autoApprove(state, item, agent);
    if (JSON.stringify([item.status, item.check, item.sensitive]) !== before) changed += 1;
  }
  return changed;
}

function autoApprove(state, item, agent) {
  if (!(autoOn(state, agent) || agent.auto_topics?.includes(topicOf(item))) || state.paused || item.status !== "pending" || item.sensitive || !AUTO_KINDS.includes(item.kind)) return;
  if (item.attach === "manual") return; // You attach the resume yourself, so you have to be there.
  if (item.instructions) return; // The user asked for a change, so the old words don't go out.
  if (agent.channel === SELF && !personRoute(agent.handle)) return;
  if (!trusted(state, agent)) {
    item.check.reasons.push({ code: "new_contact", message: `First message to ${agent.name}, so it’s yours to send.` });
    return;
  }
  if (touchesScheduling(item)) {
    item.check.reasons.push({ code: "scheduling", message: "Commits your time." });
    return;
  }
  const recent = state.queue.filter((q) => q.agent === agent.name && q.auto && Date.now() - new Date(q.created).getTime() < DAY_MS).length;
  if (recent >= AUTO_DAILY_LIMIT) {
    item.check.reasons.push({ code: "auto_limit", message: `${AUTO_DAILY_LIMIT} automatic messages to ${agent.name} today.` });
    return;
  }
  item.status = "approved";
  item.auto = true;
  item.approved_at = now();
  settleText(item);
  if (item.channel === SELF) item.via = personRoute(item.to);
}

/** A run that reads the same thread twice shouldn't ask the user the same thing twice. */
const plain = (t) => String(t ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const TWIN_MS = 24 * 60 * 60_000;
const twins = new WeakSet();
/** addDraft handed back an earlier copy of the same words instead of a new draft. */
export const isTwin = (item) => twins.has(item);

/**
 * The same words to the same agent, still waiting, on their way, or sent in the last day. Two runs (or a run and the
 * app) can draft the same answer a few seconds apart, and both would go out.
 */
function sameMessage(state, who, text) {
  if (!plain(text)) return null;
  const recent = (q) => q.status === "sent" && Date.now() - new Date(q.sent_at ?? q.created).getTime() < TWIN_MS;
  const there = (q) => plain(q.agent) === plain(who.name) && q.channel === who.channel && (q.to ?? null) === (who.handle ?? null);
  return state.queue.find((q) => there(q) && plain(q.text) === plain(text) && ([...OPEN, "approved"].includes(q.status) || recent(q))) ?? null;
}

function sameQuestion(state, agent, asked) {
  if (!plain(asked)) return null;
  return state.queue.find((q) => OPEN.includes(q.status) && plain(q.agent) === plain(agent) && plain(q.asked) === plain(asked)) ?? null;
}

/** A LinkedIn conversation's id, from the id itself or its address. */
export const threadId = (v) => {
  const s = String(v ?? "").trim();
  return s.match(/messaging\/thread\/([^/?#\s]+)/)?.[1] ?? (/^[\w:%=-]{6,}$/.test(s) ? s : null);
};

const ASKS_RESUME = /\b(resume|résumé|cv)\b/i;

/** The conversation a LinkedIn reply belongs in, found by a send that wasn't told. Set once, never changed. */
export function setThread(state, id, thread) {
  const item = requireItem(state, id);
  const t = threadId(thread);
  if (!t) throw new UserError("That isn’t a LinkedIn conversation or Gmail message id.");
  if (item.thread && item.thread !== t) throw new UserError(`${id} already belongs in another conversation.`);
  item.thread = t;
  return item;
}

/** @param thread the LinkedIn conversation it answers, so the reply lands there and not in a new chat */
/** Agents that usually answer within a minute of a message: bots on a site, in their own app, or by text. Not people, not email. */
export const answersFast = (agent) => ["browser", "mcp", "imessage"].includes(agent?.channel);

/** When their message arrived, as given by the run. Never in the future: a guess shouldn't push a draft to the top. */
function receivedAt(value) {
  if (!value) return null;
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) throw new UserError(`SELLME can’t read “${value}” as a time. Use the message’s own time, like 2026-11-08T14:05:00Z.`);
  return when.getTime() > Date.now() + 5 * 60_000 ? null : when.toISOString();
}

/**
 * They wrote again, so an answer still waiting for the user's yes answers an old message. It's dropped, and Activity
 * says why. The same conversation unless it's known otherwise: a different thread, or a different company.
 */
function supersede(state, item) {
  if (!item.received) return;
  const newer = new Date(item.received).getTime();
  for (const q of state.queue) {
    if (q === item || q.agent !== item.agent || !OPEN.includes(q.status)) continue;
    if (q.thread && item.thread && q.thread !== item.thread) continue;
    if (q.company && item.company && !sameCompany(q.company, item.company)) continue;
    if (new Date(q.created).getTime() >= newer || (q.received && new Date(q.received).getTime() >= newer)) continue; // Written after it, so not stale.
    q.status = "skipped";
    q.superseded_by = item.id;
    addNote(state, q.agent, `${q.agent} wrote again, so SELLME dropped the draft answering their earlier message`);
  }
}

export function addDraft(state, { agent, text, asked: rawAsked, context: rawContext, kind = "reply", sources = [], company, role, attach = false, thread, from, received }) {
  const { asked, context } = theirWords(rawAsked, rawContext);
  requireActive(state);
  const already = sameQuestion(state, agent, asked);
  if (already?.text === text) return already;
  const who = requireAgent(state, agent);
  const twin = sameMessage(state, who, text);
  if (twin) {
    twins.add(twin); // Never the same message twice to the same place.
    return twin;
  }
  if (!KINDS.includes(kind)) throw new UserError(`Kind must be one of: ${KINDS.join(", ")}.`);
  if (kind === "nudge") {
    const early = nudgeTooSoon(state, who.name);
    if (early) throw new UserError(early);
  }
  if (sources.includes(USER_CHOICE)) throw new UserError(`Only the user can give ${USER_CHOICE}, by pressing yes or no in the app.`);
  const item = {
    id: nextId(state, "q"),
    agent: who.name,
    channel: who.channel,
    to: who.handle,
    kind,
    asked: asked ?? null,
    ...contextField(context),
    ...whoAndWhen(from, received),
    text: need(text, "What does the draft say? Use --text."),
    drafted: text, // What SELLME wrote, kept so what the user changes can teach it.
    sources,
    company: company ?? null,
    role: role ?? null,
    thread: threadId(thread),
    created: now(),
  };
  // Asked for a resume by email: the file goes with the answer, every time.
  const wantsResume = attach || (ASKS_RESUME.test(asked ?? "") && carriesFiles(item) && state.profile.resume_file);
  if (wantsResume) putResumeOn(state, item); // Before the check, so a reply with the resume can still go by itself.
  applyCheck(state, item);
  autoApprove(state, item, who);
  state.queue.push(item);
  supersede(state, item);
  delete who.intro; // The conversation is open.
  return item;
}

const stamp = (iso) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Why a nudge to this contact would come too soon, or null. The ball is in their court after the user (or SELLME)
 * wrote and they haven't answered, and after the user skipped a nudge: either way the next one waits for their answer,
 * or for as long as they usually take (replyTiming), whichever comes first.
 */
export function nudgeTooSoon(state, agent, at = Date.now()) {
  const mine = state.queue.filter((q) => q.agent === agent);
  const latest = (list) => list.filter(Boolean).sort().at(-1) ?? null;
  const heard = latest(mine.filter((q) => q.asked && q.kind !== "nudge").map((q) => q.received ?? q.created));
  const wrote = latest(mine.filter((q) => ["sent", "sent_by_you"].includes(q.status)).map((q) => q.sent_at));
  const skipped = latest(mine.filter((q) => q.kind === "nudge" && q.status === "skipped").map((q) => q.skipped_at ?? q.created));
  const wait = replyTiming(state, agent, new Date(at)).after;
  const unanswered = (t) => t && (!heard || t > heard) && at - new Date(t).getTime() < wait;
  const until = (t) => stamp(new Date(new Date(t).getTime() + wait).toISOString());
  if (unanswered(skipped)) return `You skipped a nudge to ${agent} (${stamp(skipped)}). SELLME won't nudge them again until they write, or ${until(skipped)}.`;
  if (unanswered(wrote)) return `${agent} hasn't answered the last message (${stamp(wrote)}) yet, and that's not long ago. A nudge waits until they write, or ${until(wrote)}.`;
  return null;
}

/**
 * The user wrote to a contact themselves, outside SELLME (from Gmail, their phone, LinkedIn). Recording it keeps the
 * conversation whole: SELLME knows it's waiting on them, nudges at the right time, and remembers what was said.
 */
export function addYours(state, { agent, text, at, thread, company }) {
  const who = requireAgent(state, agent);
  const sentAt = receivedAt(at) ?? now();
  const said = need(text, "What did you write? Use --text.");
  const same = state.queue.find((q) => q.agent === who.name && ["sent", "sent_by_you"].includes(q.status) && String(q.text).trim() === said.trim());
  if (same) return same;
  const item = { id: nextId(state, "q"), agent: who.name, channel: who.channel, to: who.handle, kind: "reply", asked: null, text: said, sources: ["user"], company: company ?? null, role: null, thread: threadId(thread), created: sentAt, sent_at: sentAt, status: "sent_by_you", outside: true };
  state.queue.push(item);
  // Anything SELLME had drafted to say the same, before they wrote, is answered now.
  for (const q of state.queue) if (q !== item && q.agent === who.name && q.kind === "nudge" && ["pending", "blocked"].includes(q.status) && q.created < sentAt) Object.assign(q, { status: "skipped", skipped_at: now(), handled: "You wrote to them yourself." });
  return item;
}

/**
 * SELLME's own notes for the user about a draft (what it checked, an earlier choice, the calendar), kept apart from
 * what the other side said, so "They asked" holds only their words and no check mistakes SELLME's notes for theirs.
 */
const contextField = (context) => (String(context ?? "").trim() ? { context: String(context).trim() } : {});
// A run's own aside at the end of "asked" ("(they texted this; an earlier run logged it at 11:14 AM)"): runs add these
// even when told not to, and a check reading it as their words flags times and pay they never wrote.
const OWN_ASIDE = /\s*\(([^()]*\b(?:run|logged|sellme|unanswered|still open|(?:texted|emailed|messaged|sent|wrote) (?:this|it))\b[^()]*)\)\s*$/i;
/** "asked" with a run's trailing aside moved into its notes. */
function theirWords(asked, context) {
  const aside = String(asked ?? "").match(OWN_ASIDE);
  if (!aside) return { asked, context };
  return { asked: asked.slice(0, aside.index).trim() || asked, context: [context, aside[1].trim()].filter((x) => String(x ?? "").trim()).join(" ") };
}
/** Who wrote the message being answered, and when it arrived, so the card shows it like a chat. */
const whoAndWhen = (from, received) => ({ ...(String(from ?? "").trim() ? { from: String(from).trim().slice(0, 80) } : {}), ...(receivedAt(received) ? { received: receivedAt(received) } : {}) });

/** Record a question the agent refused to draft for, so the user answers it. */
/** @param suggest the reply the user would most likely send. Only a suggestion: nothing goes out without their yes. */
export function addBlock(state, { agent, asked: rawAsked, context: rawContext, reason, company, suggest, thread, from, received }) {
  const { asked, context } = theirWords(rawAsked, rawContext);
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
    ...contextField(context),
    ...whoAndWhen(from, received),
    text: null,
    sources: [],
    company: company ?? null,
    role: null,
    created: now(),
    status: "blocked",
    sensitive: checkUserWords(state, { text: "", asked, agent: who.name, channel: who.channel }).sensitive.length > 0,
    check: { result: "blocked", reasons: [{ code: "agent_block", message: need(reason, "Why can’t it be answered? Use --reason.") }] },
    suggestion: String(suggest ?? "").trim() || null,
    ...(String(suggest ?? "").trim() ? { drafted: String(suggest).trim() } : {}),
    thread: threadId(thread),
    approved_at: null,
    approved_text: null,
  };
  state.queue.push(item);
  supersede(state, item);
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

// An email reads like one: the greeting on its own line, then the body, then the sign-off and name.
const GREETING = /^((?:[Hh]i|[Hh]ello|[Hh]ey|[Dd]ear|[Gg]ood (?:morning|afternoon|evening))\b[^,!.?\n]{0,60}[,!])\s+/;
const SIGNOFF = /(?<=[.!?])\s+((?:Best(?: regards)?|Kind regards|Warm regards|Regards|Thanks(?: again)?|Thank you|Cheers|All the best|Sincerely),?)\s+([A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,2})\.?\s*$/;

/** Lays out an email written as one line. Only line breaks and the first letter after the greeting change. */
export function emailLayout(text) {
  const t = String(text ?? "").trim();
  if (!t || t.includes("\n")) return t; // Laid out already.
  let body = t;
  const hello = body.match(GREETING);
  if (hello) body = body.slice(hello[0].length);
  const bye = body.match(SIGNOFF);
  if (bye) body = body.slice(0, bye.index).trim();
  if (hello && body) body = body[0].toUpperCase() + body.slice(1);
  return [hello?.[1], body, bye ? `${bye[1].replace(/,?$/, ",")}\n${bye[2]}` : null].filter(Boolean).join("\n\n");
}

const isEmail = (item) => item.channel === "email" || (item.channel === SELF && personRoute(item.to) === "email");

/** What's approved is what's sent, so an email is laid out first. */
function settleText(item) {
  if (isEmail(item)) item.text = emailLayout(item.text);
  item.approved_text = item.text;
}

/** The user's yes. It goes to the outbox, to a person too, unless there's no address to send it to. */
function markApproved(state, item) {
  item.approved_at = now();
  settleText(item);
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
  state.notes.push({ id: nextId(state, "n"), agent: item.agent, text: `Approved, but SELLME has no email, phone or LinkedIn for ${item.agent}. Add one and SELLME sends it.`, ts: now(), seen: false });
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
export function setSuggestion(state, id, text, { by = "ai", remember } = {}) {
  const item = requireItem(state, id);
  if (item.status !== "blocked") throw new UserError(`${id} isn’t waiting on your answer.`);
  if (remember?.length) keepWhatYouSaid(state, remember, [], `the ${item.agent} draft`);
  const said = need(String(text ?? "").trim(), "What should it say?");
  if (item.suggestion && item.suggestion !== said) item.before = item.suggestion;
  if (by === "ai" && !item.drafted) item.drafted = said;
  item.suggestion = said;
  item.suggested_by = by;
  item.instructions = null; // Done with: the next note is about this version.
  return item;
}

/** Changing their mind before it goes out. */
// ---------------------------------------------------------------- one sender at a time
const CLAIM_MS = 15 * 60_000;
const CLEARED_MS = 3 * 60_000;
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};
const fresh = (iso, ms) => Date.now() - new Date(iso).getTime() < ms;

/** Another send (the app's, or a check's) has this message right now. */
export const claimedElsewhere = (item, run) => Boolean(item?.sending && item.sending.run !== run && fresh(item.sending.ts, CLAIM_MS) && alive(item.sending.pid));

/**
 * Takes a message for one send, so the app and a background check never send it twice.
 * @returns false when someone else has it, or a check just pressed send on it
 */
export function claimSend(state, id, run, pid = process.pid) {
  const item = requireItem(state, id);
  if (item.status !== "approved" || claimedElsewhere(item, run)) return false;
  if (item.send_cleared && item.send_cleared.run !== run && !item.send_confirmed && fresh(item.send_cleared.ts, CLEARED_MS)) return false;
  item.sending = { run, pid, ts: now() };
  return true;
}

export function releaseSend(state, id, run) {
  const item = state.queue.find((q) => q.id === id);
  if (item?.sending?.run === run) delete item.sending;
}

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
  const said = need(text, "What should it say? Use --text.");
  const shown = item.suggestion ?? item.text; // The card shows a suggestion over the text, so the edit replaces what was shown.
  if (shown && shown !== said) item.before = shown; // So the card can show what changed.
  item.text = said;
  item.suggestion = null;
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
  item.skipped_at = now();
  item.declined = true;
  return item;
}

/**
 * A run saw the user already dealt with this, say by answering it themselves. Nothing is left to reply, so it's
 * skipped, and why goes to Activity, where the user can still read it.
 */
export function markHandled(state, id, reason) {
  const item = requireItem(state, id);
  if (!OPEN.includes(item.status)) throw new UserError(`${id} isn’t open, so there’s nothing to mark.`);
  item.handled = { reason: need(reason, "Say how you know, with --reason."), ts: now() };
  item.status = "skipped";
  addNote(state, item.agent, `No reply needed: ${item.handled.reason}`);
  return item;
}

/** No, not this draft. It's dropped, and the reason stays for the next one. */
export function reject(state, id) {
  const item = requireItem(state, id);
  if (item.status === "sent") throw new UserError(`${id} was already sent.`);
  item.status = "rejected";
  item.declined = true;
  return item;
}

/** A note for the AI. The app rewrites from it straight away. If it can't, the next /sellme picks it up. */
export function instruct(state, id, text) {
  const item = requireItem(state, id);
  if (!OPEN.includes(item.status)) throw new UserError(`${id} is already ${item.status}.`);
  item.instructions = need(text, "What should change?");
  item.told = [...(item.told ?? []), item.instructions];
  return item;
}

/**
 * The AI's new version of a draft. Checked like any edit, and it still needs the user's yes.
 * @param choice the user pressed yes or no on this question, so their choice backs the answer
 */
export function applyRewrite(state, id, { text, sources, was, remember }, { choice = false } = {}) {
  const item = requireItem(state, id);
  if (!OPEN.includes(item.status)) throw new UserError(`${id} is already ${item.status}.`);
  if ((item.text ?? null) !== was) throw new UserError(`${id} changed while SELLME was rewriting it, so it left it alone.`);
  const own = keepWhatYouSaid(state, remember, sources ?? [], `the ${item.agent} draft`).filter((x) => x !== USER_CHOICE);
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

/**
 * Who the user's agent should push next: when each contact last heard from them, and calls that just happened.
 * A check uses it to nudge, follow up and ask for matches without repeating itself.
 */
export function pushList(state, today = new Date()) {
  // Best-performing first, so a run short on time spends it where it pays off.
  const rank = new Map(scorecard(state, today).rows.map((r, i) => [r.agent, i]));
  const contacts = [...state.agents].sort((a, b) => Boolean(b.intro) - Boolean(a.intro) || rank.get(a.name) - rank.get(b.name)).map((a) => {
    const sent = state.queue.filter((q) => q.agent === a.name && ["sent", "sent_by_you"].includes(q.status) && q.sent_at).map((q) => q.sent_at).sort();
    const waiting = state.queue.some((q) => q.agent === a.name && ["pending", "blocked", "approved"].includes(q.status));
    const timing = replyTiming(state, a.name, today);
    return { agent: a.name, person: a.channel === SELF, last_sent: sent.at(-1) ?? null, waiting_on_user: waiting, typical_reply_hours: timing.typical === null ? null : Math.round(timing.typical / 3_600_000), nudge_due: timing.due, ...(a.intro ? { just_connected: true } : {}) };
  });
  const day = DAY;
  const calls = state.roles
    .filter((r) => r.next_call && new Date(r.next_call) < today && today - new Date(r.next_call) < 2 * day && !["rejected", "passed", "hired"].includes(r.stage))
    .map((r) => ({ role: r.id, company: r.company, agent: r.agent ?? null, call_was: r.next_call }));
  return { contacts, calls_to_follow_up: calls };
}

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
      ...(q.asked ? { reply: true } : {}),
      ...(q.thread ? { thread: q.thread } : {}),
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

/**
 * What the user tells SELLME about themselves in a note or a talk ("I ask $120/hr for contract roles") becomes one
 * of their facts, so they never have to say it twice. A draft that used it cites "note", which turns into those ids.
 * @param remember short lines about the user, from the AI that read the note
 * @returns the sources with "note" swapped for the facts' ids
 */
export function keepWhatYouSaid(state, remember, sources = [], about = "a draft") {
  const ids = [];
  for (const r of (remember ?? []).slice(0, 5)) {
    const line = String(typeof r === "string" ? r : (r?.text ?? "")).trim();
    if (!line) continue;
    const same = state.facts.find((f) => !f.replaced_by && f.text.toLowerCase() === line.toLowerCase());
    if (same) {
      ids.push(same.id);
      continue;
    }
    const old = typeof r === "object" && r.replaces ? state.facts.find((f) => f.id === r.replaces && !f.replaced_by) : null;
    const fact = { id: nextId(state, "f"), text: line.slice(0, 300), source: `you told SELLME, about ${about}, ${now().slice(0, 10)}`, added: now(), ...(old ? { replaces: old.id } : {}) };
    state.facts.push(fact);
    // The old one stays, so drafts that cited it still check out, but it's no longer handed to the AI.
    if (old) old.replaced_by = fact.id;
    ids.push(fact.id);
  }
  return [...new Set(sources.flatMap((s) => (s === NOTE ? ids : [s])))];
}

/** The source a rewrite cites for what the user's own note said. */
export const NOTE = "note";

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

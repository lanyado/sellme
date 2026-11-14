// What the search's own history says: how fast each agent really answers, which ones deliver.
// Everything is worked out from the queue, the notes and the roles, so there's nothing extra to keep in step.
import { sameCompany } from "./truth.js";

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
const SENT = ["sent", "sent_by_you"];
const ms = (iso) => new Date(iso).getTime();
const byNumber = (a, b) => a - b;

// A reply needs a pattern before it counts as one, and even a slow agent gets chased eventually.
const MIN_SAMPLES = 3;
const LONGEST_GAP = 30 * DAY; // Longer than this isn't an answer, it's a new conversation.
const NUDGE_FLOOR = DAY; // Never twice in a day, however fast they usually are.
const NUDGE_CEILING = 10 * DAY;
const BACKOFF_CEILING = 14 * DAY;

/** How long each reply took: each message they wrote answers the last thing sent before it, once. */
function replyGaps(sends, heard) {
  const gaps = [];
  let used = 0;
  for (const when of heard) {
    const before = sends.findLastIndex((s) => s < when);
    if (before < used) continue;
    used = before + 1;
    if (when - sends[before] <= LONGEST_GAP) gaps.push(when - sends[before]);
  }
  return gaps;
}

const median = (list) => {
  const sorted = [...list].sort(byNumber);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * When to nudge one contact: twice as long as they usually take, once there's enough history to say. Each nudge they
 * ignore doubles the wait, so a quiet contact gets chased less, not more.
 * shortcut: a reply's time is when a check first read it, so it's only as fine as the check schedule. Fine for nudges.
 */
export function replyTiming(state, name, today = new Date()) {
  const agent = state.agents.find((a) => a.name === name);
  const mine = state.queue.filter((q) => q.agent === name);
  const sends = mine.filter((q) => SENT.includes(q.status) && q.sent_at).map((q) => ms(q.sent_at)).sort(byNumber);
  const heard = mine.filter((q) => q.asked && q.kind !== "nudge").map((q) => ms(q.created)).sort(byNumber);
  const gaps = replyGaps(sends, heard);
  const typical = gaps.length >= MIN_SAMPLES ? median(gaps) : null;
  const base = typical === null ? (agent?.channel === "self" ? 4 : 2) * DAY : Math.min(Math.max(typical * 2, NUDGE_FLOOR), NUDGE_CEILING);
  const lastHeard = heard.at(-1) ?? null;
  const lastSent = sends.at(-1) ?? null;
  const unanswered = sends.filter((s) => lastHeard === null || s > lastHeard).length;
  const after = Math.min(base * 2 ** Math.max(unanswered - 1, 0), BACKOFF_CEILING);
  return {
    typical,
    samples: gaps.length,
    replies: gaps.length,
    sent: sends.length,
    after,
    last_sent: lastSent,
    last_heard: lastHeard,
    unanswered,
    due: lastSent !== null && unanswered > 0 && today.getTime() - lastSent >= after,
  };
}

/** The furthest a role has got, even if it was later rejected. */
const STAGE_ORDER = ["new", "talking", "interview", "offer", "hired"];
export function reached(role) {
  const stages = [role.stage, ...(role.moves ?? []).map((m) => m.stage)];
  return Math.max(0, ...stages.map((s) => STAGE_ORDER.indexOf(s)));
}

/**
 * What each agent actually got the user, best first: offers, then interviews, then conversations, then how often it
 * answers. Referral pay isn't read here, by design: an agent is never ranked by what it pays.
 */
export function scorecard(state, today = new Date()) {
  const rows = state.agents.map((a) => {
    const roles = state.roles.filter((r) => r.agent === a.name && attributed(state, r));
    const atLeast = (stage) => roles.filter((r) => reached(r) >= STAGE_ORDER.indexOf(stage)).length;
    const t = replyTiming(state, a.name, today);
    const answerRate = t.sent ? Math.min(t.replies / t.sent, 1) : 0;
    const row = { agent: a.name, person: a.channel === "self", matches: roles.length, talking: atLeast("talking"), interviews: atLeast("interview"), offers: atLeast("offer"), sent: t.sent, replies: t.replies, typical: t.typical, answer_rate: answerRate };
    return { ...row, verdict: row.offers || row.interviews ? "delivering" : row.talking ? "in talks" : t.sent >= 3 && !t.replies ? "not answering" : roles.length ? "matches only" : "too early" };
  });
  rows.sort((a, b) => b.offers - a.offers || b.interviews - a.interviews || b.talking - a.talking || b.answer_rate - a.answer_rate || b.matches - a.matches);
  return { rows, unattributed: state.roles.filter((r) => !attributed(state, r)).length };
}

const key = (company) => {
  const first = String(company ?? "").toLowerCase().split(/\s+/)[0] ?? "";
  return first.length >= 4 ? first : String(company ?? "").toLowerCase();
};

/**
 * The agent a role goes through, only when that agent ever spoke about the company. A check can guess wrong (a company
 * emailing directly, filed under a bot), and a guess shouldn't decide who gets the follow-up or the credit.
 * @returns the agent's name, or null
 */
export function attributed(state, role) {
  if (!role.agent) return null;
  const word = key(role.company);
  const says = (t) => Boolean(word) && String(t ?? "").toLowerCase().includes(word);
  const mine = (x) => x.agent === role.agent;
  const backed = state.queue.some((q) => mine(q) && (q.role === role.id || sameCompany(q.company, role.company) || says(q.asked) || says(q.text))) || (state.notes ?? []).some((n) => mine(n) && says(n.text));
  return backed ? role.agent : null;
}

/** Contacts who have spoken about this company, most first. */
export function talkedAbout(state, company) {
  const word = key(company);
  const count = new Map();
  const add = (name) => count.set(name, (count.get(name) ?? 0) + 1);
  for (const q of state.queue) if (sameCompany(q.company, company) || String(`${q.asked ?? ""} ${q.text ?? ""}`).toLowerCase().includes(word)) add(q.agent);
  for (const n of state.notes ?? []) if (String(n.text).toLowerCase().includes(word)) add(n.agent);
  return state.agents.filter((a) => count.has(a.name)).sort((a, b) => count.get(b.name) - count.get(a.name));
}

/** Whether a queue item is about this role. */
export const aboutRole = (q, role) => q.role === role.id || sameCompany(q.company, role.company) || Boolean(role.agent && q.agent === role.agent && String(q.asked ?? q.text ?? "").includes(role.company));

/** One role's story: everything that happened with it, oldest first. */
export function roleStory(state, role) {
  const events = [];
  for (const q of state.queue) {
    if (!aboutRole(q, role)) continue;
    const by = { channel: q.channel, to: q.to };
    if (q.asked && q.kind !== "nudge") events.push({ at: q.received ?? q.created, type: "them", text: q.asked, who: q.agent, ...by });
    if (SENT.includes(q.status) && q.sent_at) events.push({ at: q.sent_at, type: "you", text: q.text, who: q.agent, ...by });
  }
  for (const n of state.notes ?? []) if (n.ts && n.text?.includes(role.company) && !/^(Sent|No reply)/.test(n.text)) events.push({ at: n.ts, type: "note", text: n.text, who: n.agent });
  for (const m of role.moves ?? []) events.push({ at: m.at, type: "move", text: `Moved to ${m.stage}` });
  events.sort((a, b) => ms(a.at) - ms(b.at));
  return { role, events };
}

/** "14h", or "3d" past two days. */
// A day or more reads in whole days: yesterday is "1d", never "24h" or "47h".
export const span = (duration) => (duration < DAY ? `${Math.max(Math.round(duration / HOUR), 1)}h` : `${Math.floor(duration / DAY)}d`);

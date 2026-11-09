// What the search's own history says: how fast each agent really answers, which ones deliver, and which roles are stuck.
// Everything is worked out from the queue, the notes and the roles, so there's nothing extra to keep in step.
import { sameCompany } from "./truth.js";

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
const SENT = ["sent", "sent_by_you"];
const OPEN = ["pending", "blocked"];
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

/** One role's story: everything that happened, and who it's waiting on. @param timings per-agent cache */
export function roleStory(state, role, today = new Date(), timings = new Map()) {
  const events = [];
  let open = null;
  for (const q of state.queue) {
    if (!aboutRole(q, role)) continue;
    if (q.asked && q.kind !== "nudge") events.push({ at: q.created, type: "them", text: q.asked, who: q.agent });
    if (SENT.includes(q.status) && q.sent_at) events.push({ at: q.sent_at, type: "you", text: q.text, who: q.agent });
    if (OPEN.includes(q.status) && !open) open = q;
  }
  for (const n of state.notes ?? []) if (n.ts && n.text?.includes(role.company) && !/^(Sent|No reply)/.test(n.text)) events.push({ at: n.ts, type: "note", text: n.text, who: n.agent });
  for (const m of role.moves ?? []) events.push({ at: m.at, type: "move", text: `Moved to ${m.stage}` });
  events.sort((a, b) => ms(a.at) - ms(b.at));
  const last = events.at(-1) ?? null;
  const since = ms(last?.at ?? role.updated ?? today);
  const quiet = Math.max(today.getTime() - since, 0);
  if (role.agent && !timings.has(role.agent)) timings.set(role.agent, replyTiming(state, role.agent, today));
  const timing = role.agent ? timings.get(role.agent) : null;
  const after = timing?.after ?? 2 * DAY;
  const upcoming = role.next_call && ms(role.next_call) > today.getTime() ? role.next_call : null;
  const waiting = open ? "you" : upcoming ? "call" : role.stage === "new" && !events.length ? "idle" : "them";
  const stuck = waiting === "you" ? today.getTime() - ms(open.created) >= DAY : waiting === "them" && quiet >= after;
  return { role, events, last, since, quiet, after, timing, upcoming, waiting, open, stuck, heat: quiet / after };
}

const STAGE_WEIGHT = { offer: 3, interview: 2, talking: 1, new: 0 };
const urgency = (a, b) => (STAGE_WEIGHT[b.role.stage] ?? 0) - (STAGE_WEIGHT[a.role.stage] ?? 0) || b.heat - a.heat;

/** The live pipeline, sorted by what needs attention. New matches nobody has spoken to are only counted: there are hundreds. */
export function timeline(state, today = new Date()) {
  const timings = new Map();
  const live = state.roles.filter((r) => !["rejected", "passed", "hired"].includes(r.stage)).map((r) => roleStory(state, r, today, timings));
  const onYou = live.filter((s) => s.waiting === "you").sort(urgency);
  const calls = live.filter((s) => s.waiting === "call").sort((a, b) => ms(a.upcoming) - ms(b.upcoming));
  const stuck = live.filter((s) => s.waiting === "them" && s.stuck).sort(urgency);
  const moving = live.filter((s) => s.waiting === "them" && !s.stuck).sort(urgency);
  return { onYou, calls, stuck, moving, idle: live.filter((s) => s.waiting === "idle").length };
}

/**
 * Who "nudge all stuck" writes to: the most urgent stuck role per contact, since one message per contact is the limit.
 * Skips anyone with something already waiting on the user, or written to in the last day.
 */
export function nudgePlan(state, today = new Date()) {
  const seen = new Set();
  const plan = [];
  for (const story of timeline(state, today).stuck) {
    const agent = attributed(state, story.role); // Never nudge someone a check only guessed at.
    if (!agent || seen.has(agent) || !state.agents.some((a) => a.name === agent)) continue;
    seen.add(agent);
    if (state.queue.some((q) => q.agent === agent && [...OPEN, "approved"].includes(q.status))) continue;
    const lastSent = story.timing?.last_sent;
    if (lastSent && today.getTime() - lastSent < DAY) continue;
    plan.push(story);
  }
  return plan;
}

/** "14h", or "3d" past two days. */
export const span = (duration) => (duration < 2 * DAY ? `${Math.max(Math.round(duration / HOUR), 1)}h` : `${Math.round(duration / DAY)}d`);

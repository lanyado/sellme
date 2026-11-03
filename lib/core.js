// The product's rules, as plain functions over the state. No printing and no disk access here.
import { UserError, nextId } from "./store.js";
import { REFERRALS_ENABLED } from "./referrals.js";
import { KINDS, check, checkUserWords, sameCompany, touchesScheduling } from "./truth.js";

export const CHANNELS = ["mcp", "imessage", "email", "browser"];
export const STAGES = ["new", "talking", "interview", "offer", "hired", "rejected", "passed"];
export const REFERRAL_STAGES = ["signup", "interview", "offer", "hired", "paid"];
export const CATALOG = {
  fonzi: { name: "Fonzi", channel: "mcp" },
  standout: { name: "Standout", channel: "imessage" },
  boardy: { name: "Boardy", channel: "email" },
  "jack & jill": { name: "Jack & Jill", channel: "browser" },
  hedgy: { name: "Hedgy", channel: "browser" },
};
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
  if (!agent) throw new UserError(`“${name}” isn’t a connected recruiter agent. If it’s a bot, connect it with: agent add "${name}". If it’s a person, don’t: write a draft the user sends themselves.`);
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
export function setProfile(state, field, value) {
  need(value, `Give a value for ${field}.`);
  if (field === "roles") state.profile.roles = value.split(",").map((s) => s.trim()).filter(Boolean);
  else if (["name", "floor", "where"].includes(field)) state.profile[field] = value;
  else throw new UserError(`Profile has no “${field}”. Use name, roles, floor or where.`);
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
export function addAgent(state, name, { channel, handle } = {}) {
  need(name, "Which agent?");
  const known = CATALOG[name.toLowerCase()];
  const agent = {
    name: known?.name ?? name,
    channel: channel ?? known?.channel,
    handle: handle ?? null,
  };
  if (!CHANNELS.includes(agent.channel)) throw new UserError(`How does ${agent.name} talk? Add --channel with one of: ${CHANNELS.join(", ")}.`);
  if (HANDLE_REQUIRED.includes(agent.channel) && !agent.handle) {
    throw new UserError(`${agent.name} talks over ${agent.channel}. Add --handle with its exact address, so I only ever message that one.`);
  }
  const existing = findAgent(state, agent.name);
  if (existing && (existing.handle !== agent.handle || existing.channel !== agent.channel)) {
    // A yes covers one message to one address. A new address has to earn both again.
    existing.auto = false;
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

function voidApproval(item) {
  item.status = "pending";
  item.auto = false;
  item.approved_at = null;
  item.approved_text = null;
}

/** Turning it off takes back what it approved but hasn't sent. */
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
  const cancelled = state.queue.filter((q) => q.agent === agent.name && ["pending", "blocked", "approved"].includes(q.status));
  for (const q of cancelled) q.status = "skipped";
  return { agent, cancelled: cancelled.length };
}

// ---------------------------------------------------------------- pipeline
function requireStage(stage) {
  if (!STAGES.includes(stage)) throw new UserError(`Stage must be one of: ${STAGES.join(", ")}.`);
  return stage;
}

export function addRole(state, { company, title, agent, stage = "new" }) {
  const role = {
    id: nextId(state, "r"),
    company: need(company, "Which company? Use --company."),
    title: title ?? null,
    agent: agent ? (findAgent(state, agent)?.name ?? agent) : null,
    stage: requireStage(stage),
    updated: now(),
  };
  state.roles.push(role);
  return role;
}

export function setRole(state, id, stage) {
  const role = state.roles.find((r) => r.id === id);
  if (!role) throw new UserError(`There’s no role ${id}.`);
  role.stage = requireStage(stage);
  role.updated = now();
  return role;
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

function autoApprove(state, item, agent) {
  if (!agent.auto || item.status !== "pending" || item.sensitive || !AUTO_KINDS.includes(item.kind)) return;
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
}

export function addDraft(state, { agent, text, asked, kind = "reply", sources = [], company, role }) {
  requireActive(state);
  const who = requireAgent(state, agent);
  if (!KINDS.includes(kind)) throw new UserError(`Kind must be one of: ${KINDS.join(", ")}.`);
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
  applyCheck(state, item);
  autoApprove(state, item, who);
  state.queue.push(item);
  return item;
}

/** Record a question the agent refused to draft for, so the user answers it. */
export function addBlock(state, { agent, asked, reason, company }) {
  requireActive(state);
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
    sensitive: checkUserWords(state, { text: "", asked, agent: who.name }).sensitive.length > 0,
    check: { result: "blocked", reasons: [{ code: "agent_block", message: need(reason, "Why can’t it be answered? Use --reason.") }] },
    approved_at: null,
    approved_text: null,
  };
  state.queue.push(item);
  return item;
}

export function openItems(state) {
  return state.queue.filter((q) => OPEN.includes(q.status));
}

export function approve(state, id, { confirmSensitive = false } = {}) {
  const item = requireItem(state, id);
  if (item.status === "blocked") throw new UserError(`${id} is blocked: ${item.check.reasons[0].message} Fix it with edit, or answer it yourself.`);
  if (item.status !== "pending") throw new UserError(`${id} is already ${item.status}.`);
  if (item.sensitive && !confirmSensitive) {
    throw new UserError(`${id} needs your own yes: ${item.check.reasons[0].message} Only the user can confirm this, with --confirm-sensitive.`);
  }
  item.status = "approved";
  item.approved_at = now();
  item.approved_text = item.text;
  return item;
}

/** Any edit voids the approval and runs the check again. */
export function editDraft(state, id, text) {
  const item = requireItem(state, id);
  if (!["pending", "blocked", "approved"].includes(item.status)) throw new UserError(`${id} is already ${item.status}.`);
  item.text = need(text, "What should it say? Use --text.");
  item.auto = false; // A changed draft never goes out on an earlier automatic yes.
  applyCheck(state, item);
  return item;
}

/** The user's own words. They answer for the claims, but the rules on honesty and secrets still hold. */
export function answerYourself(state, id, text, { confirmSensitive = false } = {}) {
  requireActive(state);
  const item = requireItem(state, id);
  if (!OPEN.includes(item.status)) throw new UserError(`${id} is already ${item.status}.`);
  need(text, "What’s your answer? Use --text.");
  const verdict = checkUserWords(state, { text, asked: item.asked, company: item.company, agent: item.agent });
  if (verdict.blocked.length) throw new UserError(`${id} can’t go out through your agent: ${verdict.blocked[0].message}`);
  if ((verdict.sensitive.length || item.sensitive) && !confirmSensitive) {
    const why = verdict.sensitive[0]?.message ?? item.check.reasons[0].message;
    throw new UserError(`${id} needs your own yes: ${why} Only the user can confirm this, with --confirm-sensitive.`);
  }
  item.text = text;
  item.sources = ["user"];
  item.sensitive = false;
  item.status = "approved";
  item.approved_at = now();
  item.approved_text = item.text;
  return item;
}

export function skip(state, id) {
  const item = requireItem(state, id);
  if (item.status === "sent") throw new UserError(`${id} was already sent.`);
  item.status = "skipped";
  return item;
}

export function outbox(state) {
  if (state.paused) return [];
  return state.queue
    .filter((q) => q.status === "approved")
    .map((q) => ({ id: q.id, agent: q.agent, channel: q.channel, to: q.to, text: q.approved_text }));
}

export function markSent(state, id) {
  const item = requireItem(state, id);
  if (item.status !== "approved" || item.text !== item.approved_text) {
    throw new UserError(`${id} isn’t approved, so it shouldn’t have gone out. Tell the user now.`);
  }
  item.status = "sent";
  item.sent_at = now();
  // The user wasn't asked, so make sure they see it.
  if (item.auto) state.notes.push({ id: nextId(state, "n"), agent: item.agent, text: `Sent for you: “${item.text}”`, ts: now(), seen: false });
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
    agents: state.agents.length,
    roles: by(["new", "talking", "interview", "offer", "hired"]),
    talking: by(["talking"]),
    interviews: by(["interview"]),
    offers: by(["offer", "hired"]),
    sent: state.queue.filter((q) => q.status === "sent").length,
  };
}

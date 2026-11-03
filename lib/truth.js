// The truth check: mechanical rules every outgoing draft must pass.
// It catches what a program can catch. Judging meaning stays with the agent (see SKILL.md).

export const KINDS = ["reply", "nudge", "slot", "disclosure"];

const STRIP = [
  /\b\d{1,2}(:\d{2})?\s*(am|pm)\b/gi, // 4 PM, 11:30am
  /\b\d{1,2}:\d{2}\b/g, // 14:30
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?(,?\s+\d{4})?\b/gi, // Nov 3
  /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, // 11/3
];
const NUMBER = /\$?\d[\d,]*(?:\.\d+)?\s?(?:k|m|%)?(?![a-z\d])/gi;
const PAY = /\b(salary|salaries|comp|compensation|pay|base|equity|bonus|ote|offers?|accept(s|ed|ing)?|negotiat\w*|counter(offer)?)\b|\$\s?\d/i;
const HUMAN_QUESTION = /\b(are|r)\s+(you|u)\s+(an?\s+)?(real|human|person|bot|ai|robot|agent|automated)\b|\bam i\s+(speaking|talking|texting|chatting|emailing|writing)\s+(with|to)\b|\bis this\s+(really\s+)?(a\s+)?[\p{L}]+\s*\?/iu;
const ADMITS_AI = /\b(ai|bot|automated)\b/i;
const CLAIMS_HUMAN = /\b(i am|i'm|i’m)\s+(a\s+)?(real\s+)?(human|person)\b/i;
const SECRETS = /\b\d{3}-\d{2}-\d{4}\b|\b(?:\d[ -]?){13,19}\b|\b(social security|ssn|passport (number|no)|bank account|routing number|credit card|password)\b/i;
const JOKES = /no job,? no tokens|ghosted enough|send a bot back|listen up,? agent|can['’]t pay you/i;
const NUMBER_WORDS = { ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, dozen: 12 };
const NUMBER_WORD = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b`, "gi");
const PROFILE_SOURCES = ["name", "roles", "where", "floor"];

function normalize(token) {
  let t = token.toLowerCase().replace(/[$,\s]/g, "");
  const unit = t.match(/[km]$/)?.[0];
  if (unit) t = String(Number(t.slice(0, -1)) * (unit === "k" ? 1e3 : 1e6));
  return t;
}

/** Every number that makes a claim. Times and dates are logistics, so they don't count. */
export function numbers(text) {
  let t = String(text ?? "");
  for (const re of STRIP) t = t.replace(re, " ");
  const words = (t.match(NUMBER_WORD) || []).map((w) => String(NUMBER_WORDS[w.toLowerCase()]));
  return [...(t.match(NUMBER) || []).map((n) => normalize(n.trim())), ...words];
}

function hasWord(text, word, flags = "iu") {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\d])${escaped}($|[^\\p{L}\\d])`, flags).test(text);
}

function sourceText(state, id) {
  const fact = state.facts.find((f) => f.id === id);
  if (fact) return fact.text;
  const field = id.startsWith("profile.") ? id.slice("profile.".length) : null;
  if (field && PROFILE_SOURCES.includes(field)) {
    const value = state.profile[field];
    if (Array.isArray(value) ? value.length : value) return Array.isArray(value) ? value.join(", ") : String(value);
  }
  return null;
}

function nameForms(state) {
  const full = String(state?.profile?.name ?? "").trim();
  if (!full) return [];
  const first = full.split(/\s+/)[0];
  return [...new Set([full, first])].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

export function isHumanQuestion(asked, state) {
  const q = String(asked ?? "");
  if (HUMAN_QUESTION.test(q) || /\bwho\s+(is this|are you|am i\s+(speaking|talking|texting|chatting))\b/i.test(q)) return true;
  const names = nameForms(state).join("|");
  return Boolean(names) && new RegExp(`\\b((are|r)\\s+(you|u)|is\\s+this)\\s+(really\\s+|actually\\s+)?(${names})\\b`, "iu").test(q);
}

/** "I'm Maya" is a lie. "I'm Maya's AI agent" isn't. */
function claimsToBeUser(text, state) {
  const names = nameForms(state).join("|");
  if (!names) return false;
  return new RegExp(`(^|[^\\p{L}])(i am|i'm|i’m|this is|it's|it’s)\\s+(really\\s+)?(${names})(?!\\p{L})(?!['’]s|\\s+\\p{L}+['’]s)`, "iu").test(text);
}

const SUFFIXES = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|plc)\b\.?/gi;
const companyKey = (name) => String(name ?? "").replace(SUFFIXES, " ").replace(/[.,]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * "Globex", "Globex Inc." and "Globex Robotics" could all be one company, so treat them as one.
 * Only a leading match counts: "Ode with Anthropic" is not Anthropic.
 */
export function sameCompany(a, b) {
  const x = companyKey(a);
  const y = companyKey(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `);
}

/**
 * @returns {{result: "ok"|"needs_you"|"blocked", reasons: {code: string, message: string}[]}}
 *   blocked: can't be sent as written. needs_you: only an explicit, individual human yes.
 */
export function check(state, draft) {
  const { text, asked, kind = "reply", sources = [], company } = draft;
  const blocked = [];
  const needsYou = [];
  const human = isHumanQuestion(asked, state);

  // 1. Is every citation real?
  const cited = [];
  for (const id of sources) {
    const found = sourceText(state, id);
    if (found === null) blocked.push({ code: "unknown_source", message: `Source “${id}” doesn’t exist.` });
    else cited.push(found);
  }
  if (kind === "reply" && !human && sources.length === 0) {
    blocked.push({ code: "no_source", message: "This answer cites no source, so I won’t send it." });
  }

  // 2. Does every number come from a cited source?
  const known = new Set(cited.flatMap(numbers));
  const scrubbed = company ? String(text).split(company).join(" ") : String(text);
  for (const n of new Set(numbers(scrubbed))) {
    if (!known.has(n)) {
      blocked.push({ code: "unsourced_number", message: `“${n}” isn’t in the sources it cites. I won’t round up.` });
    }
  }

  // 3. Always admit to being an AI.
  if (CLAIMS_HUMAN.test(text)) {
    blocked.push({ code: "claims_human", message: "This says it’s human. It isn’t." });
  } else if (claimsToBeUser(text, state)) {
    blocked.push({ code: "claims_identity", message: "This pretends to be you. I’m your AI agent, and I have to say so." });
  } else if (human && !ADMITS_AI.test(text)) {
    blocked.push({ code: "must_disclose", message: "They asked who they’re talking to. The answer has to say it’s an AI." });
  }

  // 4. Off-limits names and dead companies.
  for (const term of state.profile.never_mention) {
    if (hasWord(text, term)) blocked.push({ code: "never_mention", message: `This names something you said never to mention: “${term}”.` });
  }
  for (const role of state.roles) {
    if (!["rejected", "passed"].includes(role.stage)) continue;
    // Match the name's exact case in free text: a company called Context shouldn't block "more context".
    if (hasWord(text, role.company, "u") || sameCompany(company, role.company)) {
      blocked.push({ code: "dead_company", message: `${role.company} is marked ${role.stage} in your pipeline.` });
    }
  }

  // 5. IDs and secrets never go through an agent.
  if (SECRETS.test(text)) blocked.push({ code: "secret", message: "This has an ID, bank detail or password in it. I never send those. If you have to share one, do it yourself." });

  // 6. Jokes stay between you and your agent.
  if (JOKES.test(text)) blocked.push({ code: "joke", message: "That’s a joke from the skill file. Recruiters get plain messages." });

  // 7. Money and offers are yours alone.
  if (PAY.test(text) || PAY.test(asked ?? "")) {
    needsYou.push({ code: "pay_or_offer", message: "This touches pay or an offer, so it needs your own yes." });
  }
  const floor = state.profile.floor;
  if (floor && numbers(floor).some((n) => numbers(text).includes(n))) {
    needsYou.push({ code: "floor", message: "This reveals your salary floor." });
  }
  if (company) {
    const live = state.roles.find(
      (r) => sameCompany(r.company, company) && !["rejected", "passed"].includes(r.stage) && r.agent && r.agent !== draft.agent,
    );
    if (live) needsYou.push({ code: "other_channel", message: `${live.company} is already in process through ${live.agent}.` });
  }

  const result = blocked.length ? "blocked" : needsYou.length ? "needs_you" : "ok";
  return { result, reasons: [...blocked, ...needsYou] };
}

/**
 * The user's own words: they answer for their claims, so sourcing doesn't apply.
 * It still goes out through their agent, so the disclosure and secrets rules still hold,
 * and anything sensitive needs their explicit yes.
 */
export function checkUserWords(state, draft) {
  const { reasons } = check(state, { ...draft, kind: "nudge", sources: [] });
  const hard = ["claims_human", "claims_identity", "must_disclose", "secret"];
  const ignored = ["unsourced_number", "no_source", "unknown_source", "joke"];
  return {
    blocked: reasons.filter((r) => hard.includes(r.code)),
    sensitive: reasons.filter((r) => !hard.includes(r.code) && !ignored.includes(r.code)),
  };
}

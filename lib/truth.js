// The truth check: mechanical rules every outgoing draft must pass.
// It catches what a program can catch. Judging meaning stays with the agent (see SKILL.md).

export const KINDS = ["reply", "nudge", "slot", "disclosure"];

const STRIP = [
  /\bbetween\s+\d{1,2}(:\d{2})?\s*(am|pm)?\s*and\s+\d{1,2}(:\d{2})?\s*(am|pm)\b/gi, // between 9 and 11 AM
  /\b\d{1,2}(:\d{2})?\s*(am|pm)?\s*(?:-|–|—|to|until|till)\s*\d{1,2}(:\d{2})?\s*(am|pm)\b/gi, // 1 to 4 PM, 10am-1pm
  /\b\d{1,2}(:\d{2})?\s*(am|pm)\b/gi, // 4 PM, 11:30am
  /\b\d{1,2}:\d{2}\b/g, // 14:30
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?(,?\s+\d{4})?\b/gi, // Nov 3
  /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, // 11/3
  // A 30-minute call is logistics. "Saving 20 minutes per user" is a claim, so only a meeting counts.
  /\b\d+[-\s]?(?:mins?|minutes?)[-\s]+(?:call|chat|intro|interview|meeting|screen|conversation|slot)\b/gi,
  /\b[a-z]+\s+o['’]clock\b/gi, // four o'clock
  // Counting the message's own parts ("two updates", "3 quick questions") says nothing about the user.
  /\b(?:two|three|four|five|both|a couple of|\d)[-\s]+(?:quick\s+|short\s+|small\s+|more\s+)?(?:steps?|stages?|rounds?|updates?|questions?|things?|points?|notes?|options?|slots?|times?|ways?|messages?|follow-?ups?|requests?|changes?)\b/gi,
  // "All four fit", "those three": counting what the message itself just named, not a claim about the user.
  /\b(?:all|these|those)\s+(?:\d+|two|three|four|five|six|seven|eight|nine|ten)\b(?=\s*(?:of\s+(?:them|these|those|the\s+\w+)|roles?|jobs?|companies|matches|positions|openings|intros?|fit|are|look|sound|work|seem|[.,;:!?]|$))/gi,
];
// Not after a letter, so S3, B2B and K8s aren't claims. A unit stuck to the digits, like 10yrs, still is.
const NUMBER = /(?<![\p{L}\d.])\$?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|bn?|x|%|percent|pct)|yrs?|mos?|wks?|hrs?|ppl)?(?![\p{L}\d])/giu;
const PAY = /\b(salary|salaries|comp|compensation|pay|base|equity|bonus|ote|tc|rsus?|stock|wages?|earnings?|expect(ing|ed|ations?)|signing|(hourly|day) rate|negotiat\w*|counteroffers?)\b|\$\s?\d|\b\d+(\.\d+)?\s?k\b/i;
// A job offer, not the verb: "I will offer your saved slots" and "accepted the invite" are scheduling.
const OFFER = /\b(?:(?:job|verbal|written|formal|final|official|competing|counter|an|the|your|my|their|his|her|our|this|that|any|other|multiple|several|two|three)[ -]offers?|offers?[ -](?:letter|details|package|stage|terms|deadline|call)|(?:extend|extends|extended|extending|make|makes|made|making)\s+(?:\w+\s+)?(?:an\s+)?offer|offer(?:s|ed|ing)?\s+(?:you|him|her|them|\w+)\s+(?:the\s+|a\s+)?(?:role|job|position)|accept(?:s|ed|ing)?\s+(?:the\s+|an?\s+|your\s+|their\s+|this\s+|that\s+)?(?:offer|role|position|job))\b/i;
const touchesPay = (t) => PAY.test(t) || OFFER.test(t);
const MACHINE = "bot|ai|robot|machine|automated|chatbot|llm|gpt";
const HUMAN_QUESTION = new RegExp(
  [
    `\\b(are|r)\\s+(you|u)\\s+((really|actually|truly|even|just)\\s+)?(an?\\s+|the\\s+)?(real|human|person|agent|${MACHINE})\\b`,
    `\\bam i\\s+(speaking|talking|texting|chatting|emailing|writing)\\s+(with|to)\\b`,
    `\\b(speaking|talking|texting|chatting|emailing|writing)\\s+(with|to)\\s+(an?\\s+)(real|human|person|agent|${MACHINE})\\b`,
    `\\bis this\\s+((really|actually)\\s+)?(an?\\s+)?(real\\s+)?(human|person|agent|${MACHINE})\\b`,
    `\\b(human|person)\\s+(or|vs\\.?)\\s+(an?\\s+)?(agent|${MACHINE})\\b`,
    `\\b(${MACHINE}|agent)\\s+(or|vs\\.?)\\s+(an?\\s+)?(real\\s+)?(human|person)\\b`,
    `\\b(human|real person)\\s+(reading|behind|on the other)\\b`,
  ].join("|"),
  "iu",
);
// A capital is the only hint that "Is this Dana?" asks about a person and "Is this correct?" doesn't.
const IS_THIS_NAME = /\b[Ii]s this\s+(really\s+)?\p{Lu}\p{L}+(\s+\p{Lu}\p{L}+)?\s*\?/u;
const ADMITS_AI = /\b(?:ai|automated)[\s-]+(?:agent|assistant|bot|system|program|model)\b|\b(?:i am|i['’]m|im|this is|it is|it['’]s)\s+(?:(?:\p{L}+['’]s|an?|the|just|only)\s+){0,3}(?:ai|bot|robot|automated)\b|\byes,?\s+an?\s+(?:ai|bot|robot)\b/iu;
const CLAIMS_HUMAN = /\b(i am|i'm|i’m|im)\s+(?:(?!not\b)\p{L}+\s+)?(a\s+)?(real\s+|actual\s+|live\s+)?(human|person)\b|\b(real person|real human|human) here\b/iu;
const EMPHASIS = "(?:(?:definitely|certainly|really|actually|absolutely|truly)\\s+)?";
// "I'm not an AI" is always a denial. "It's not an AI role" isn't, unless the next word is about the speaker.
const DENIES_AI = new RegExp(
  `\\b(?:i am|i['’]m|im|we are|we['’]re)\\s+${EMPHASIS}(?:not|no)\\s+(?:an?\\s+)?(?:${MACHINE})\\b` +
    `|\\b(?:this is\\s+${EMPHASIS}not|it is\\s+${EMPHASIS}not|it['’]s\\s+${EMPHASIS}not|this isn['’]t|it isn['’]t)\\s+(?:an?\\s+)?(?:${MACHINE})\\b(?![\\s-]+(?!agent\\b|assistant\\b|system\\b|program\\b|model\\b)\\p{L})`,
  "iu",
);
// "Not a bot" alone is still a denial, unless it's about something else: "not an AI role".
const NOT_A_BOT = new RegExp(`\\b(?:not|no)\\s+(?:an?\\s+)?(?:${MACHINE}|bots|robots)\\b(?:\\s+here)?(?![\\s-]+\\p{L})`, "iu");
const SCHEDULING = /\b\d{1,2}(:\d{2})?\s*(am|pm)\b|\b(mon|tue|tues|wed|thu|thur|thurs|fri|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|calendar|calendly|reschedul\w*|schedul\w*|availab\w*|book(ing)?\s+a|slots?|time ?zone)\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\/\d{1,2}\b/i;
const DAY_OR_DATE = String.raw`(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?|\d{1,2}\/\d{1,2}|last week|this week`;
const PAST_DATE = new RegExp(String.raw`\b(?:since|as of|last)\s+(?:${DAY_OR_DATE})\b`, "gi");
const LABEL_DATE = new RegExp(String.raw`\((?:${DAY_OR_DATE})\)`, "gi"); // "Kai (Nov 6)": when something happened.
// A clock time that says when an earlier message came ("still open from 9:17 AM", "sent at 2pm", "logged it at 11:14 AM",
// "(1:11 PM)") books nothing.
// "Free from 2pm" and "can you do 2pm?" stay bookings, so only these backward-looking shapes are skipped.
const CLOCK = String.raw`\d{1,2}(?::\d{2})?\s*(?:am|pm)`;
const PAST_CLOCK = new RegExp(
  String.raw`\b(?:still\s+)?(?:open|unanswered|pending|waiting)\s+(?:since|from)\s+${CLOCK}|\b(?:sent|wrote|texted|emailed|messaged|posted|replied|logged|noted|recorded|received|read|seen|got|came\s+in|arrived)\s+(?:it\s+|this\s+|them\s+)?(?:at|around)\s+${CLOCK}|\b(?:since|as\s+of)\s+${CLOCK}|\(${CLOCK}\)`,
  "gi",
);
// "Boardy on LinkedIn, Nov 8, 10:24 AM: offered an intro": a date and time before a colon say when it was said.
const STAMP = new RegExp(String.raw`\b(?:${DAY_OR_DATE})(?:,?\s+\d{4})?(?:,?\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s+[A-Z]{2,4})?)?\s*:(?!\d)`, "gi");
const SECRETS =/\b\d{3}-\d{2}-\d{4}\b|\b(?:\d[ -]?){13,19}\b|\b(social security|ssn|passport (number|no)|bank account|routing number|credit card|password)\b/i;
const JOKES = /no job,? no tokens|ghosted enough|send a bot back|listen up,? agent|can['’]t pay you/i;
const WORD_VALUES = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES = { hundred: 100, dozen: 12, thousand: 1e3, million: 1e6, billion: 1e9 };
const ANY_WORD = [...Object.keys(WORD_VALUES), ...Object.keys(SCALES)].join("|");
// A run of number words is one number: "twenty-five", "two hundred and ten".
const SPELLED = new RegExp(`\\b(?:${ANY_WORD})(?:[\\s-]+(?:and[\\s-]+)?(?:${ANY_WORD}))*\\b`, "gi");
const DIGITS_THEN_SCALE = /(\d[\d,]*(?:\.\d+)?)\s*(hundred|dozen|thousand|million|billion)\b/gi;
// "Hundreds of engineers" is a claim too. It only matches a source that says the same.
const VAGUE = /\b(dozens|hundreds|thousands|millions|billions)\b/gi;
const PROFILE_SOURCES = ["name", "roles", "where", "floor", "resume_link"];
const SAYS_ATTACHED = /\b(attached|attaching|enclosed)\b/i;

function normalize(token) {
  const t = token.toLowerCase().replace(/[$,\s]/g, "").replace(/(percent|pct)$/, "%").replace(/(yrs?|mos?|wks?|hrs?|ppl)$/, "");
  const scaled = t.match(/^([\d.]+)(k|m|bn?)$/);
  if (!scaled) return t;
  return String(Math.round(Number(scaled[1]) * { k: 1e3, m: 1e6, b: 1e9, bn: 1e9 }[scaled[2]]));
}

function spelledValue(run) {
  let total = 0;
  let current = 0;
  for (const word of run.toLowerCase().split(/[\s-]+/)) {
    if (word === "and") continue;
    if (word in WORD_VALUES) current += WORD_VALUES[word];
    else if (word === "hundred" || word === "dozen") current = (current || 1) * SCALES[word];
    else {
      total += (current || 1) * SCALES[word];
      current = 0;
    }
  }
  return String(total + current);
}

/** Every number that makes a claim. Times, dates and the length of a call are logistics, so they don't count. */
export function numbers(text) {
  let t = String(text ?? "");
  for (const re of STRIP) t = t.replace(re, " ");
  t = t.replace(DIGITS_THEN_SCALE, (_, n, scale) => String(Math.round(Number(n.replace(/,/g, "")) * SCALES[scale.toLowerCase()])));
  // A lone "one" is ordinary English: "one of", "no one", "one-on-one".
  const words = (t.match(SPELLED) || []).filter((run) => run.toLowerCase() !== "one").map(spelledValue);
  const vague = (t.match(VAGUE) || []).map((w) => w.toLowerCase());
  return [...(t.match(NUMBER) || []).map((n) => normalize(n.trim())), ...words, ...vague];
}

/**
 * Pay figures from their own message: "$160k", "160-90k" (160k to 190k). Saying them back ("you said $160k to $190k")
 * claims nothing about the user. Only money, so their "10 years required" can't turn into the user's 10 years.
 */
export function theirMoney(asked) {
  const t = String(asked ?? "");
  const out = new Set();
  for (const [, a, b] of t.matchAll(/\$?(\d+)\s*(?:-|–|to)\s*\$?(\d+)\s*k\b/gi)) {
    // "160-90k" means up to 190k: the second number borrows the first one's leading digits.
    const high = b.length < a.length && Number(b) < Number(a) ? a.slice(0, a.length - b.length) + b : b;
    out.add(String(Number(a) * 1000)).add(String(Number(high) * 1000)).add(String(Number(b) * 1000));
  }
  for (const m of t.match(/\$\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m)?\b|\b\d[\d,]*(?:\.\d+)?\s?k\b/gi) ?? []) out.add(normalize(m));
  return out;
}

/** Does this commit the user's time? Auto-approve leaves those to them, whatever the draft is labeled. */
/**
 * Does it commit the user's time: a day, a date, a clock time, a booking? A loose horizon ("who can you introduce
 * this week?") commits nothing, so it doesn't count.
 */
export function touchesScheduling({ text, asked, kind }) {
  // "Since Wednesday", "last Nov 4" or "(Nov 6)" points back in time, so it books nothing.
  const ahead = (t) => String(t ?? "").replace(PAST_DATE, " ").replace(PAST_CLOCK, " ").replace(LABEL_DATE, " ").replace(STAMP, " ");
  // A nudge is SELLME's own push, and its "asked" is SELLME's own note about why, not their question.
  return SCHEDULING.test(ahead(text)) || (kind !== "nudge" && SCHEDULING.test(ahead(asked)));
}

// Words that mark a tech stack, so a company named in one is the tool: MongoDB, Notion, Stripe.
const TECH = /\b(python|typescript|javascript|react|node(\.js)?|fastapi|django|flask|aws|gcp|azure|kubernetes|k8s|docker|postgres(ql)?|mysql|redis|kafka|sqs|spark|pyspark|terraform|langchain|langgraph|pinecone|databases?|stack|sql|nosql|apis?|llms?|gpt|openai|bedrock|lambda|s3|using|built (on|with)|integrat\w+)\b/i;

/** Whether a name sits among tech words, within the same sentence and a few words either side. */
function asTech(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const near = new RegExp(String.raw`[^.!?]{0,60}(?<![\p{L}\d])${escaped}(?![\p{L}\d])[^.!?]{0,60}`, "gu");
  const spots = String(text).match(near) ?? [];
  return spots.length > 0 && spots.every((spot) => TECH.test(spot.replace(name, " ")));
}

function hasWord(text, word, flags = "iu") {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\d])${escaped}($|[^\\p{L}\\d])`, flags).test(text);
}

// The user pressed yes or no on that very question in the app. It backs the answer, never a number or a claim about them.
export const USER_CHOICE = "user.choice";

function sourceText(state, id) {
  if (id === USER_CHOICE) return "";
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
  if (HUMAN_QUESTION.test(q) || IS_THIS_NAME.test(q) || /\bwho\s+(is this|are you|am i\s+(speaking|talking|texting|chatting))\b/i.test(q)) return true;
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
// A gap left for the user to fill: "[how many users]", "[ ]", "<company name>", "{{name}}", "XXX". A yes on the card
// would send it as is, so nothing with one can go out.
const PLACEHOLDER = /\[[^\[\]\n]{0,80}\](?!\()|<(?![^<>]*[@:\/])[a-z][a-z' ]{1,60}>|\{\{[^{}\n]*\}\}|\b(?:TODO|XXX+)\b/i;

/** @returns the first gap left to fill in, or null */
export const placeholder = (text) => String(text ?? "").match(PLACEHOLDER)?.[0] ?? null;

/** Whether text carries any number from the user's salary floor. */
export const revealsFloor = (state, text) => {
  const floor = state.profile?.floor;
  return Boolean(floor && numbers(floor).some((n) => numbers(text).includes(n)));
};

/** The top pay figure they quoted, when it's under the user's floor. @returns {number|null} */
export function topUnderFloor(state, asked) {
  const floor = Number(numbers(state.profile?.floor ?? "")[0]);
  if (!(floor > 0)) return null;
  const need = floor < 1000 ? floor * 1000 : floor; // a floor written "300" means 300K
  const quoted = [...theirMoney(asked)].map(Number).filter((n) => n >= 20000 && n <= 5e6);
  const top = Math.max(0, ...quoted);
  return top && top < need ? top : null;
}

export function check(state, draft) {
  const { text, asked, kind = "reply", sources = [], company } = draft;
  const blocked = [];
  const needsYou = [];
  const human = isHumanQuestion(asked, state);

  // 1. Is every citation real?
  const cited = [];
  const yours = sources.includes("user"); // Their own words: they answer for their claims, so sourcing doesn't apply.
  for (const id of sources.filter((x) => x !== "user")) {
    const found = sourceText(state, id);
    if (found === null) blocked.push({ code: "unknown_source", message: `Source “${id}” doesn’t exist.` });
    else cited.push(found);
  }
  if (kind === "reply" && !human && sources.length === 0) {
    blocked.push({ code: "no_source", message: "Nothing in your facts backs this answer." });
  }

  // 2. Does every number come from a cited source?
  const known = new Set([...cited.flatMap(numbers), ...theirMoney(asked)]);
  const scrubbed = company ? String(text).split(company).join(" ") : String(text);
  for (const n of yours ? [] : new Set(numbers(scrubbed))) {
    if (!known.has(n)) {
      blocked.push({ code: "unsourced_number", message: `“${n}” isn’t in your facts.` });
    }
  }

  // 3. Always admit to being an AI.
  if (draft.channel === "self") {
    // This one goes from the user's own account, in their own name, so "I'm Maya" is simply true.
  } else if (CLAIMS_HUMAN.test(text)) {
    blocked.push({ code: "claims_human", message: "This says it’s human. It isn’t." });
  } else if (DENIES_AI.test(text) || (NOT_A_BOT.test(text) && !ADMITS_AI.test(text))) {
    blocked.push({ code: "claims_human", message: "This denies being an AI. It is one." });
  } else if (claimsToBeUser(text, state)) {
    blocked.push({ code: "claims_identity", message: "This pretends to be you. SELLME is your AI agent, and has to say so." });
  } else if (human && !ADMITS_AI.test(text)) {
    blocked.push({ code: "must_disclose", message: "They asked who they’re talking to. The answer has to say it’s an AI." });
  }

  // 4. Off-limits names and dead companies.
  for (const term of state.profile.never_mention) {
    if (hasWord(text, term)) blocked.push({ code: "never_mention", message: `This names something you said never to mention: “${term}”.` });
  }
  for (const role of state.roles) {
    if (!["rejected", "passed"].includes(role.stage)) continue;
    // Match the name's exact case in free text: a company called Context shouldn't block "more context". A name
    // in a tech stack ("Kubernetes on AWS and MongoDB") is the product, not the company that passed.
    if ((hasWord(text, role.company, "u") && !asTech(text, role.company)) || sameCompany(company, role.company)) {
      blocked.push({ code: "dead_company", message: `${role.company} is marked ${role.stage} in your pipeline.` });
    }
  }

  // 4b. A blank left for the user never goes out.
  const gap = placeholder(text);
  if (gap) blocked.push({ code: "placeholder", message: `Has a blank to fill: “${gap}”.` });

  // 5. IDs and secrets never go through an agent.
  if (SECRETS.test(text)) blocked.push({ code: "secret", message: "This has an ID, bank detail or password in it. SELLME never sends those. If you have to share one, do it yourself." });

  // 5b. "Attached" has to be true.
  if (SAYS_ATTACHED.test(text ?? "") && !["file", "manual"].includes(draft.attach)) {
    blocked.push({ code: "no_attachment", message: draft.attach === "link" ? "It says attached, but this one carries a link to your resume. Say “here’s my resume” instead." : "It says something is attached, but nothing is. Attach your resume, or reword it." });
  }

  // 6. Jokes stay between you and your agent.
  if (JOKES.test(text)) blocked.push({ code: "joke", message: "That’s a joke from the skill file. Recruiters get plain messages." });

  // 7. Money and offers are yours alone.
  const under = topUnderFloor(state, asked);
  if (touchesPay(text) || touchesPay(asked ?? "")) {
    needsYou.push({ code: "pay_or_offer", message: under ? `Their pay tops out at $${Math.round(under / 1000)}K, under your floor.` : "Touches pay or an offer." });
  }
  if (revealsFloor(state, text)) {
    needsYou.push({ code: "floor", message: "This reveals your salary floor." });
  }
  if (company) {
    const live = state.roles.find(
      (r) => sameCompany(r.company, company) && !["rejected", "passed"].includes(r.stage) && r.agent && r.agent !== draft.agent,
    );
    if (live) needsYou.push({ code: "other_channel", message: `${live.company} is already in process through ${live.agent}.` });
  }

  const result = blocked.length ? "blocked" : needsYou.length ? "needs_you" : "ok";
  // needsYou ones are a heads-up, not a fault: the card shows them as such even next to a block.
  return { result, reasons: [...blocked, ...needsYou.map((r) => ({ ...r, soft: true }))] };
}

/**
 * The user's own words: they answer for their claims, so sourcing doesn't apply.
 * It still goes out through their agent, so the disclosure and secrets rules still hold,
 * and anything sensitive needs their explicit yes.
 */
export function checkUserWords(state, draft) {
  const { reasons } = check(state, { ...draft, kind: "nudge", sources: [] });
  const hard = ["claims_human", "claims_identity", "must_disclose", "secret", "no_attachment", "placeholder"];
  const ignored = ["unsourced_number", "no_source", "unknown_source", "joke"];
  return {
    blocked: reasons.filter((r) => hard.includes(r.code)),
    sensitive: reasons.filter((r) => !hard.includes(r.code) && !ignored.includes(r.code)),
  };
}

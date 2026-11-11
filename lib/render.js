// Everything the user sees. Symbols carry the meaning, so it still reads with no color.
import { stepsFor } from "./connect.js";
import { placeholder } from "./truth.js";
import { alertBody, alertHeadline, autoOn, connectList, counts, openItems, personRoute, userAlerts } from "./core.js";
import { DAY, scorecard as scoreRows, span } from "./insights.js";
import { DISCLOSURE, PROGRAMS, REFERRALS_ENABLED, liveLink } from "./referrals.js";

const WORDMARK = [
  "███████ ███████ ██      ██      ███    ███ ███████",
  "██      ██      ██      ██      ████  ████ ██",
  "███████ █████   ██      ██      ██ ████ ██ █████",
  "     ██ ██      ██      ██      ██  ██  ██ ██",
  "███████ ███████ ███████ ███████ ██      ██ ███████",
];

const COLORS = {
  lime: ["38;2;200;240;49", "38;5;191"],
  violet: ["38;2;143;124;255", "38;5;141"],
  red: ["38;2;255;122;107", "38;5;209"],
  muted: ["38;2;168;165;184", "38;5;245"],
};

/** "truecolor", "256" or null. Off for pipes, NO_COLOR, TERM=dumb and --no-color. */
export function colorLevel({ isTTY = process.stdout.isTTY, env = process.env, flag = false } = {}) {
  if (flag || env.NO_COLOR || env.TERM === "dumb") return null;
  if (!isTTY && !env.FORCE_COLOR) return null;
  return /truecolor|24bit/i.test(env.COLORTERM ?? "") ? "truecolor" : "256";
}

export function palette(level) {
  const paint = (code) => (s) => (level ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  const pick = ([deep, basic]) => paint(level === "truecolor" ? deep : basic);
  // A terminal hyperlink (OSC 8): the text stays as it is, and cmd- or ctrl-click opens the link.
  const link = (url, text) => (level && url ? `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\` : String(text));
  // Any color, for what fades from one to another. Without color the symbols still carry it.
  const rgb = (r, g, b) => paint(level === "truecolor" ? `38;2;${r};${g};${b}` : `38;5;${16 + 36 * Math.round((r / 255) * 5) + 6 * Math.round((g / 255) * 5) + Math.round((b / 255) * 5)}`);
  return {
    lime: pick(COLORS.lime),
    violet: pick(COLORS.violet),
    red: pick(COLORS.red),
    muted: pick(COLORS.muted),
    bold: paint("1"),
    link,
    rgb,
    // A word that's new, and one that's gone, even with no color at all.
    added: level ? pick(["38;2;200;240;49;48;2;44;58;16", "38;5;191;48;5;22"]) : (s) => `+{${s}}`,
    removed: level ? pick(["38;2;255;122;107;9;48;2;58;24;24", "38;5;209;9;48;5;52"]) : (s) => `-{${s}}`,
    alive: Boolean(level),
  };
}

/** Fit a terminal's width. With no width (a pipe, or an AI tool reading it), keep the full text. */
const cut = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!n) return t;
  const room = Math.max(n, 12);
  return t.length > room ? `${t.slice(0, room - 1)}…` : t;
};
// Always at least one space after, so a long name never runs into what follows it.
const pad = (s, n) => {
  const t = String(s);
  return (t.length >= n ? `${t.slice(0, n - 2)}…` : t).padEnd(n);
};

function greeting(date) {
  const h = date.getHours();
  return h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening";
}

/**
 * The wordmark on top of every app screen. Full size when there's room, in half blocks on a short terminal,
 * and the plain word on a narrow one, so it's always there without pushing the list off screen.
 */
export function logo(c, width = process.stdout.columns || 100, height = process.stdout.rows || 30) {
  const wide = WORDMARK[0].length;
  if (width < wide + 2) return c.lime(c.bold("SELLME"));
  if (height >= 30) return WORDMARK.map((line) => c.lime(line)).join("\n");
  const grid = WORDMARK.map((line) => line.padEnd(wide));
  const lines = [];
  for (let r = 0; r < grid.length; r += 2) {
    let line = "";
    for (let x = 0; x < wide; x++) {
      const top = grid[r][x] === "█";
      const bottom = grid[r + 1]?.[x] === "█";
      line += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
    }
    lines.push(c.lime(line.trimEnd()));
  }
  return lines.join("\n");
}

export function banner(c) {
  return `${c.lime(WORDMARK.join("\n"))}\n\n${c.bold("Bots rejected you. Send a bot back.")}`;
}

function needsLine(q) {
  if (q.status === "blocked" && q.suggestion) return `${q.asked ?? ""} Suggested: “${q.suggestion}”`.trim();
  if (q.status === "blocked" && q.check.reasons[0]?.code === "agent_block") return `${q.asked ?? ""} · only you can answer`.trim();
  if (q.status === "blocked") return q.asked ? `${q.asked} ✗ ${q.check.reasons[0].message}` : `✗ ${q.check.reasons[0].message}`;
  if (q.kind === "nudge") return `Send this nudge? “${q.text}”`;
  return q.asked ? `${q.asked} Draft: “${q.text}”` : `Send? “${q.text}”`;
}

const time = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** What's left to do before Sellme is useful. */
export function setupSteps(state) {
  const p = state.profile;
  return [
    { label: "Resume", done: state.facts.length > 0, detail: state.facts.length ? `${state.facts.length} facts` : "" },
    { label: "Basics", done: Boolean(p.name && p.roles.length && p.floor && p.where), detail: "name, roles, floor, location" },
    { label: "Agents", done: state.agents.length > 0, detail: state.agents.map((a) => a.name).join(", ") },
  ];
}

export function brief(state, c, date = new Date(), width) {
  const open = openItems(state);
  const waiting = state.queue.filter((q) => q.status === "approved").length;
  const stamp = date.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const firstName = state.profile.name?.trim().split(/\s+/)[0];
  const hello = firstName ? `${greeting(date)}, ${firstName}.` : `${greeting(date)}.`;
  const checked = state.last_run ? ` · checked agents ${time(state.last_run)}` : "";
  const out = [c.muted(`${stamp}${checked}`)];

  if (state.hired) {
    out.push(c.lime(c.bold(`You’re hired${state.hired.company ? ` at ${state.hired.company}` : ""}. SELLME is off duty.`)));
    return out.join("\n");
  }
  const toConnect = connectList(state);
  const blocking = toConnect.filter((item) => item.blocking).length;
  const total = open.length + userAlerts(state).length + blocking;
  const count = total === 0 ? "Nothing needs you." : total === 1 ? "1 thing needs you." : `${total} things need you.`;
  const steps = setupSteps(state);
  const ready = steps.every((step) => step.done);
  out.push(c.lime(c.bold(ready || total ? `${hello} ${count}` : hello)));
  if (state.paused) out.push(c.muted(`Paused. Nothing goes out${waiting ? `, including ${waiting} approved and waiting` : ""}. ${width ? "Run: sellme resume" : "Say “resume” to restart."}`));

  if (!ready) {
    out.push("", c.muted(`SETUP  ${steps.filter((step) => step.done).length} of ${steps.length}`));
    for (const step of steps) out.push(`${step.done ? c.lime("✓") : c.muted("○")} ${pad(step.label, 14)}${c.muted(step.detail)}`);
  }
  const heads = userAlerts(state);
  if (heads.length) {
    out.push("", c.red("HEADS UP"));
    for (const a of heads) out.push(`${c.red(pad(a.id, 4))}${c.bold(alertHeadline(a))}${a.agent ? c.muted(` · ${a.agent}`) : ""}`, `    ${alertBody(a)}`);
  }
  if (toConnect.length) out.push("", c.muted("TO CONNECT"), ...connectLines(toConnect, c));
  const notes = state.notes.filter((n) => !n.seen);
  const room = width ? width - 18 : undefined;
  if (notes.length) {
    out.push("", c.muted(date.getHours() < 12 ? "WHILE YOU SLEPT" : "SINCE YOU LAST LOOKED"));
    for (const n of notes) out.push(`${c.lime("✓")} ${pad(n.agent, 14)}  ${c.muted(cut(n.text, room))}`);
  }
  if (open.length) {
    out.push("", c.muted("NEEDS YOU"));
    for (const q of open) out.push(`${c.violet(pad(q.id, 4))}${pad(q.agent, 14)}${c.muted(cut(needsLine(q), room))}`);
  }
  const n = counts(state);
  if (n.roles) out.push("", c.muted(funnel(state)));

  // Always end by saying what to do next (git status, clig.dev).
  const next = !ready ? "Type sellme to set up" : open.length ? (width ? "sellme review" : "/sellme goes through them with you") : waiting ? `Type /sellme to send ${waiting} approved` : blocking ? "Click a link above, then type /sellme again" : "You’re all caught up";
  out.push("", `${c.lime("→")} ${next}`);
  return out.join("\n");
}

/** The search as one line: how many roles are at each stage. */
export function funnel(state) {
  const n = (stage) => state.roles.filter((r) => r.stage === stage).length;
  const stages = ["new", "talking", "interview", "offer"];
  if (n("hired")) stages.push("hired");
  return stages.map((stage) => `${n(stage)} ${stage}`).join(" → ");
}

export function status(state, c, width) {
  const n = counts(state);
  const out = [c.bold(`${n.roles} live role${n.roles === 1 ? "" : "s"} across ${n.agents} agent${n.agents === 1 ? "" : "s"}`)];
  if (state.hired) out.push(c.lime(`Hired${state.hired.company ? ` at ${state.hired.company}` : ""}. Agents paused.`));
  else if (state.paused) out.push(c.muted("Paused. Nothing goes out."));
  if (state.roles.length) out.push(c.muted(funnel(state)));
  else out.push(c.muted("Nothing in the pipeline yet."));

  // Most advanced first, so what matters is on top.
  const sections = [["HIRED", ["hired"]], ["OFFER", ["offer"]], ["INTERVIEW", ["interview"]], ["TALKING", ["talking"]], ["NEW", ["new"]], ["CLOSED", ["rejected", "passed"]]];
  for (const [title, stages] of sections) {
    const roles = state.roles.filter((r) => stages.includes(r.stage));
    if (!roles.length) continue;
    out.push("", c.muted(title));
    for (const r of roles) {
      const name = r.title ? `${r.company}, ${r.title}` : r.company;
      const label = pad(cut(name, width ? width - 22 : undefined), 42);
      if (title === "CLOSED") out.push(c.muted(`${pad(r.id, 5)}${label} ${r.stage}`));
      else out.push(`${c.muted(pad(r.id, 5))}${label} ${c.muted(r.agent ?? "")}`);
    }
  }
  out.push("", c.muted("AGENTS"));
  if (!state.agents.length) out.push(c.muted("None connected. Type /sellme setup in your AI tool."));
  for (const a of state.agents) out.push(`${state.paused ? c.muted("○") : c.lime("✓")} ${pad(a.name, 14)}${c.muted(pad(a.channel, 10))}${autoOn(state, a) ? c.violet("auto") : ""}`);
  return out.join("\n");
}

// Links stay whole and on the line, whatever the width, so a terminal or AI tool can make them clickable.
function connectLines(items, c) {
  return items.flatMap((item) => {
    const steps = item.kind === "connector" || (item.kind === "signin" && !item.url) ? stepsFor(item) : [];
    const lines = steps.flatMap((s) => (s.kind === "run" ? [c.lime(s.command), ...(s.after ? [c.muted(s.after)] : [])] : s.kind === "open" ? [`${s.label}: ${c.lime(s.url)}`] : [c.muted(s.label)]));
    return [`${item.blocking ? c.red("!") : c.muted("○")} ${pad(item.name, 14)}${item.action}${item.url ? `  ${c.lime(item.url)}` : ""}`, ...lines.map((l) => `    ${l}`)];
  });
}

export function connectScreen(items, c) {
  if (!items.length) return `${c.lime("✓")} Everything’s connected.`;
  const out = [c.bold("What SELLME needs from you"), ...connectLines(items, c)];
  if (items.some((item) => item.uses_referral_link)) out.push("", c.muted(DISCLOSURE));
  out.push("", `${c.lime("→")} Type ${c.lime("sellme connect")} in a terminal and SELLME does these with you, or click a link and finish there. Don’t want one? Tell your AI “skip Hedgy”.`);
  return out.join("\n");
}

export function roster({ catalog, yours }, c) {
  const out = [c.muted("AGENTS I SELL YOU TO")];
  for (const a of catalog) out.push(`${a.connected ? c.lime("✓") : c.muted("○")} ${pad(a.name, 17)}${c.muted(pad(a.channel, 10))}${a.auto ? c.violet("auto ") : ""}${c.muted(a.about ?? "")}`);
  out.push("", c.muted("YOUR RECRUITERS"));
  if (!yours.length) out.push(c.muted("Nobody yet."));
  for (const a of yours) {
    const details = [a.person ? (personRoute(a.handle) ?? "needs an address") : a.channel, a.handle, a.company].filter(Boolean).join(" · ");
    out.push(`${c.lime("✓")} ${pad(a.name, 16)}${c.muted(details)}${a.auto ? ` ${c.violet("auto")}` : ""}`);
  }
  out.push("", `${c.lime("→")} Add someone: sellme add "Their Name" --handle <email, number or LinkedIn profile>`);
  return out.join("\n");
}

/** An approved message to someone Sellme has no address for. */
export function handoff(item) {
  return `Approved for ${item.agent}, but SELLME has no email, phone or LinkedIn for them. Add one with sellme add "${item.agent}" --handle <address>, and SELLME sends it:\n\n${item.approved_text}\n`;
}

const ROUTE = { email: "your email", imessage: "your iMessage", linkedin: "your LinkedIn" };

export function importSummary({ added, problems }, c) {
  const out = [`${c.lime("✓")} Added ${added.length} recruiter${added.length === 1 ? "" : "s"}${added.length ? `: ${added.join(", ")}` : ""}.`];
  for (const p of problems) out.push(c.red(`✗ ${p.name}: ${p.reason}`));
  return out.join("\n");
}

/** Breaks text into lines that fit, at spaces. A word longer than the line goes on its own. */
export function wrap(text, width) {
  // An email's paragraphs stay paragraphs, so the card shows what will land.
  const paragraphs = String(text ?? "").trim().split(/\n\s*\n/);
  return paragraphs.flatMap((p, i) => [...(i ? [""] : []), ...p.split("\n").flatMap((line) => wrapLine(line, width))]);
}

function wrapLine(text, width) {
  const lines = [];
  let line = "";
  for (const word of String(text ?? "").replace(/\s+/g, " ").trim().split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

export const CHANNEL_NAME = { mcp: "its app", imessage: "iMessage", email: "email", browser: "its website", linkedin: "LinkedIn" };

/** Where a draft's backing comes from, in words the user knows. */
function backing(sources = []) {
  const kinds = new Set(
    sources.map((s) => (s === "user.choice" ? "your yes" : s === "profile.resume_link" ? "your resume link" : s.startsWith("profile.") ? "your profile" : s === "user" ? "your own words" : "your resume")),
  );
  return [...kinds].join(" and ");
}

/** Where a person's address opens: their LinkedIn profile, an email to them, or their Messages chat. */
export function addressUrl(to, route) {
  const value = String(to ?? "").trim();
  if (route === "linkedin") {
    const id = value.match(/linkedin\.com\/in\/([^/?#\s]+)/i)?.[1];
    return id ? `https://www.linkedin.com/in/${id}/` : null;
  }
  if (route === "email" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
  if (route === "imessage") return `imessage://${value.replace(/[^\d+@.\w-]/g, "")}`;
  return null;
}

const tokens = (text) => String(text ?? "").match(/\n+|\S+/g) ?? [];
const MAX_DIFF_CELLS = 400_000; // Past this it's a different message, and a word diff of it means nothing.

/** Word by word: what stayed, what's new, what went. @returns the parts in order, or null when it's too long to compare */
export function wordDiff(before, after) {
  const a = tokens(before);
  const b = tokens(after);
  if (a.length * b.length > MAX_DIFF_CELLS) return null;
  const key = (t) => (t.startsWith("\n") ? "\n" : t);
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = key(a[i]) === key(b[j]) ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const parts = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && key(a[i]) === key(b[j])) {
      parts.push({ op: "same", text: b[j] });
      i += 1;
      j += 1;
    } else if (i < a.length && (j >= b.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) parts.push({ op: "del", text: a[i++] });
    else parts.push({ op: "add", text: b[j++] });
  }
  return parts;
}


/**
 * What changed, as lines that fit. New words light up and old ones are struck through, and a bar in the gutter marks
 * each line that changed, like a code editor, however much changed. @returns null only when it's too long to compare
 */
export function diffLines(before, after, room, c) {
  const parts = wordDiff(before, after);
  if (!parts) return null;
  const words = parts.filter((p) => !p.text.startsWith("\n"));
  const added = words.filter((p) => p.op === "add").length;
  const removed = words.filter((p) => p.op === "del").length;
  const markCost = c.added("").length && !c.alive ? c.added("").length : 0;
  const lines = [];
  let line = []; // Runs of one kind: { op, words }.
  let used = 0;
  const flush = () => {
    const paint = { same: (s) => s, add: c.added, del: c.removed };
    lines.push({ text: line.map((run) => paint[run.op](run.words.join(" "))).join(" "), add: line.some((r) => r.op === "add"), del: line.some((r) => r.op === "del") });
    line = [];
    used = 0;
  };
  for (const part of parts) {
    if (part.text.startsWith("\n")) {
      if (part.op === "del") continue; // A line break that went isn't worth showing.
      flush();
      if (part.text.length > 1) lines.push({ text: "", add: false, del: false });
      continue;
    }
    const run = line.at(-1);
    const continues = run?.op === part.op;
    const cost = part.text.length + (used ? 1 : 0) + (continues || part.op === "same" ? 0 : markCost);
    if (used && used + cost > room) {
      flush();
      line.push({ op: part.op, words: [part.text] });
      used = part.text.length + (part.op === "same" ? 0 : markCost);
      continue;
    }
    if (continues) run.words.push(part.text);
    else line.push({ op: part.op, words: [part.text] });
    used += cost;
  }
  if (line.length) flush();
  return { lines, added, removed };
}

const visibleLength = (s) => String(s).replace(/\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;]*m/g, "").length;

/** "just now", "12m ago", "5h ago", "3d ago". */
export function ago(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

// Older drafts wrote who and when into their text: `Dana Ford, Acme, Nov 6, 12:16 PM: "..."`.
const HEADER = /^\s*([^:"\n]{2,80}?),\s*((?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?(?:,?\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*[AaPp][Mm])?)\s*:\s*/;

/** A date written without a year is the most recent one like it, never one in the future. */
function pastDate(text, now) {
  const year = new Date(now).getFullYear();
  const plain = text.replace(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+/, "").replace(/\bat\s+/, "").replace(/(\d)\s*([AaPp][Mm])/, "$1 $2");
  const hasYear = /\b\d{4}\b/.test(plain);
  const date = new Date(hasYear ? plain : plain.replace(/^([A-Za-z]+\.?\s+\d{1,2})/, `$1 ${year}`));
  if (Number.isNaN(date.getTime())) return null;
  if (!hasYear && date.getTime() > now + DAY) date.setFullYear(year - 1);
  return { iso: date.toISOString(), dateOnly: !/\d:\d|[AaPp][Mm]/.test(plain) };
}

/**
 * Their message, split into who sent it, when, and only what they said.
 * @returns {from, when: {iso, dateOnly} | null, text}
 */
export function theirMessage(q, now = Date.now()) {
  let text = String(q.asked ?? "");
  let from = q.from ?? null;
  let when = q.received ? { iso: q.received, dateOnly: false } : null;
  const head = text.match(HEADER);
  const parsed = head ? pastDate(head[2], now) : null;
  if (parsed) {
    text = text.slice(head[0].length);
    from ??= head[1].trim();
    when ??= parsed;
    // A whole message in quotes, with nothing after it, is just the message.
    const quoted = text.match(/^\s*[“"](.*)[”"]\s*$/s);
    if (quoted && !/[“"]/.test(quoted[1])) text = quoted[1];
  }
  return { from: from ?? q.agent, when, text: text.trim() };
}

/** "Sat, Nov 7, 10:00 AM · 2d ago", or just the day when that's all that's known. */
export function sentLine(when, now = Date.now()) {
  if (!when) return null;
  const date = new Date(when.iso);
  const day = date.toLocaleString("en-US", when.dateOnly ? { weekday: "short", month: "short", day: "numeric" } : { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `${day} · ${when.dateOnly ? daysAgo(date, now) : ago(now - date)}`;
}

const daysAgo = (date, now) => {
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / DAY);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`;
};

/** How long ago a message was sent, for the list. */
export const sentAgo = (when, now = Date.now()) => (!when ? null : when.dateOnly ? daysAgo(new Date(when.iso), now) : ago(now - new Date(when.iso)));


/**
 * A chat bubble: theirs on the left, yours on the right. @param gutter a line's own left edge, to mark one that changed
 * @returns lines, each indented so the bubble sits on its side of `room`
 */
function bubble(lines, { right = false, room, edge, gutter = () => null }) {
  const inner = Math.max(...lines.map(visibleLength), 1);
  const indent = " ".repeat(2 + (right ? Math.max(room - inner - 4, 0) : 0));
  return [
    `${indent}${edge(`╭${"─".repeat(inner + 2)}╮`)}`,
    ...lines.map((line, i) => `${indent}${gutter(i) ?? edge("│")} ${line}${" ".repeat(inner - visibleLength(line))} ${edge("│")}`),
    `${indent}${edge(`╰${"─".repeat(inner + 2)}╯`)}`,
  ];
}

/**
 * One draft as a chat: their message on the left with who sent it and when, the reply waiting for the user's yes on
 * the right, then SELLME's notes and whether it holds up.
 */
export function card(q, c, position, width = process.stdout.columns || 100, { diff = false, now = Date.now() } = {}) {
  const room = Math.max(Math.min(width - 6, 78), 20);
  const text = Math.max(Math.floor(room * 0.82) - 4, 16);
  const route = q.channel === "self" ? personRoute(q.to) : q.channel;
  const by = `by ${CHANNEL_NAME[route] ?? route}`;
  const address = q.channel === "self" && route ? ` · ${c.link ? c.link(addressUrl(q.to, route), q.to) : q.to}` : "";
  const via = q.channel === "self" && !route ? c.muted("no address yet") : `${c.muted(by)}${c.muted(address)}`;
  const out = [`${position ? `${c.muted(position)}  ` : ""}${c.bold(q.agent)}  ${via}`];
  // Why it's the user's, first and once.
  const why = (q.check?.reasons ?? []).filter((r) => r.code === "agent_block").map((r) => r.message).join(" ");
  if (why) out.push(...wrap(`Needs you: ${why}`, room + 2).map((l) => `${c.violet(l)}`));
  out.push("");
  const right = (label) => `${" ".repeat(2 + Math.max(room - visibleLength(label), 0))}${label}`;
  const block = (label, body, bar) => {
    out.push(`  ${c.muted(label)}`);
    for (const line of wrap(body, room)) out.push(`  ${bar("│")} ${line}`);
    out.push("");
  };
  if (q.asked) {
    const theirs = theirMessage(q, now);
    const sent = sentLine(theirs.when, now);
    out.push(`  ${c.bold(theirs.from)}${sent ? `  ${c.muted(sent)}` : ""}`, ...bubble(wrap(theirs.text || q.asked, text), { room, edge: c.muted }), "");
  }
  const mine = q.suggestion ?? q.text;
  if (mine) {
    const failed = !q.suggestion && q.status === "blocked";
    const label = q.suggestion ? (q.suggested_by === "you" ? "Your reply" : "Suggested") : failed ? "Draft · flagged" : q.kind === "nudge" ? "Your nudge" : "Your reply";
    const edge = failed ? c.red : c.lime;
    const changed = diff && q.before && q.before !== mine;
    const marks = changed ? diffLines(q.before, mine, text, c) : null;
    if (marks) {
      const count = [marks.added ? c.lime(`+${marks.added}`) : null, marks.removed ? c.red(`−${marks.removed}`) : null].filter(Boolean).join(" ");
      out.push(right(`${c.muted(label)}  ${count} ${c.muted(marks.added + marks.removed === 1 ? "word" : "words")}`));
      out.push(...bubble(marks.lines.map((l) => l.text), { right: true, room, edge, gutter: (i) => (marks.lines[i].add ? c.lime("┃") : marks.lines[i].del ? c.red("┃") : null) }), "");
    } else {
      if (changed) out.push(right(c.muted("Before")), ...bubble(wrap(q.before, text), { right: true, room, edge: c.muted }), "");
      out.push(right(c.muted(changed ? `${label} · rewritten` : label)), ...bubble(wrap(mine, text), { right: true, room, edge }), "");
    }
  }
  if (q.context) block("SELLME’s notes", q.context, c.muted);
  const notes = [];
  const gap = q.status === "blocked" && q.suggestion ? placeholder(q.suggestion) : null; // The text's own check already says so.
  if (gap) notes.push(...wrap(`✗ Has a blank to fill: “${gap}”.`, room).map((l, i) => c.red(i ? `  ${l}` : l)));
  if (q.attach === "file") notes.push(c.lime("+ Your resume goes with it"));
  if (q.attach === "link") notes.push(c.lime("+ Has the link to your resume"));
  if (q.attach === "manual") notes.push(c.violet("! You attach your resume yourself: SELLME opens the chat right after it sends"));
  if (q.status !== "blocked" && !q.sensitive && q.sources?.length) notes.push(c.lime(`✓ Backed by ${backing(q.sources)}`));
  for (const r of (q.check?.reasons ?? []).filter((x) => x.code !== "agent_block")) {
    const hard = q.status === "blocked" && !r.soft; // "Needs your own yes" is a heads-up, never an error.
    notes.push(...wrap(`${hard ? "✗" : "!"} ${r.message}`, room).map((l, i) => c[hard ? "red" : "violet"](i ? `  ${l}` : l)));
  }
  if (q.instructions) notes.push(...wrap(`Your note for the AI: ${q.instructions}`, room).map((l) => c.muted(l)));
  for (const n of notes) out.push(`  ${n}`);
  if (!notes.length) out.pop();
  return out.join("\n");
}

// ---------------------------------------------------------------- the timeline
const lerp = (a, b, t) => Math.round(a + (b - a) * t);
/** Lime when it's fine, through amber, to red at twice as long as it should have been. */
export function heatColor(heat, glow = 1) {
  const t = Math.min(Math.max(heat, 0) / 2, 1);
  const [from, to, part] = t < 0.5 ? [[200, 240, 49], [255, 190, 60], t * 2] : [[255, 190, 60], [255, 84, 66], (t - 0.5) * 2];
  return from.map((v, i) => Math.round(lerp(v, to[i], part) * glow));
}

const SHADES = ["░", "▒", "▓", "█"];
const shade = (heat) => SHADES[Math.min(Math.floor(Math.max(heat, 0) * 2), 3)];
const GLYPH = { them: "◆", you: "●", move: "◇", note: "·" };
const PRIORITY = ["them", "you", "move", "note"];
const REVEAL_FRAMES = 12;
const MIN_HISTORY = 5;
const MIN_AHEAD = 2;
const MAX_AHEAD = 7;

/**
 * Fits time to the room there is: only as far back as this search actually goes, so a ten-day search fills the strip
 * instead of huddling against today. One stray old event doesn't stretch it: its role just starts at the left edge.
 * @returns {days, ahead, perDay, spare}: days of history and days ahead shown, columns per day, and columns left over
 */
export function timelineScale(stories, room, today = new Date()) {
  const ages = stories.flatMap((s) => [...s.events.map((e) => new Date(e.at).getTime()), ...(s.events.length ? [] : [s.since])]).map((t) => (today - t) / DAY).filter((a) => a >= 0).sort((a, b) => a - b);
  const reach = ages.length ? ages[Math.min(Math.floor(ages.length * 0.98), ages.length - 1)] : 0;
  const history = Math.max(Math.ceil(reach) + 1, MIN_HISTORY);
  const calls = stories.filter((s) => s.upcoming).map((s) => Math.ceil((new Date(s.upcoming) - today) / DAY) + 1).filter((d) => d <= MAX_AHEAD);
  const ahead = Math.max(...calls, MIN_AHEAD);
  const perDay = Math.max(Math.floor(room / (history + ahead)), 1);
  const days = Math.max(Math.floor(room / perDay) - ahead, 1); // What's left over shows a little more history.
  return { days, ahead, perDay, spare: Math.max(room - (days + ahead) * perDay, 0) };
}

/** Columns a day's midnight falls on, labelled often enough to read and not so often they collide. */
function midnights(today, days, perDay) {
  const out = new Map();
  const step = Math.max(Math.ceil(8 / perDay), 1);
  const first = new Date(today).setHours(0, 0, 0, 0);
  for (let back = 0; back < days + 1; back += step) {
    const when = first - back * DAY;
    const col = days * perDay - 1 - Math.floor(((today - when) / DAY) * perDay);
    if (col >= 0) out.set(col, when);
  }
  return out;
}

/**
 * One role across time, with now in the middle and the coming days after it. Each event sits at its real time of day.
 * Silence glows hotter the longer it's gone past when that contact usually answers, and a stuck role's silence flickers
 * like an ember. Every cell is one column wide, so the rows line up.
 * @param frame animation frame; it wipes in from the left on opening
 */
export function timelineStrip(story, { today = new Date(), days, ahead = 7, perDay = 1, frame = Infinity, c }) {
  const now = new Date(today).getTime();
  const past = days * perDay;
  const slice = DAY / perDay;
  const start = now - days * DAY;
  const marks = new Map();
  for (const e of story.events) {
    const t = new Date(e.at).getTime();
    if (t < start || t > now) continue;
    const col = Math.min(Math.floor((t - start) / slice), past - 1);
    const had = marks.get(col);
    if (!had || PRIORITY.indexOf(e.type) < PRIORITY.indexOf(had)) marks.set(col, e.type);
  }
  const grid = midnights(today, days, perDay);
  const hasHistory = story.events.length > 0 || story.waiting !== "idle";
  const total = past + 1 + ahead * perDay;
  const shown = Number.isFinite(frame) && c.alive ? Math.ceil((total * (frame + 1)) / REVEAL_FRAMES) : Infinity;
  let cells = "";
  for (let pos = 0; pos < past; pos += 1) {
    const middle = start + (pos + 0.5) * slice;
    if (pos >= shown) cells += " ";
    else if (marks.has(pos)) {
      const type = marks.get(pos);
      cells += type === "them" ? c.bold(c.lime(GLYPH.them)) : type === "you" ? c.lime(GLYPH.you) : type === "move" ? c.violet(GLYPH.move) : c.muted(GLYPH.note);
    } else if (hasHistory && middle > story.since) {
      const heat = (middle - story.since) / story.after;
      if (story.waiting === "call") cells += c.lime("─");
      else if (story.waiting === "you") cells += c.violet(shade(heat));
      else {
        const glow = story.stuck && Number.isFinite(frame) ? 0.74 + 0.26 * Math.sin(frame / 3 - pos / 2) : 1;
        cells += c.rgb(...heatColor(heat, glow))(shade(heat));
      }
    } else cells += grid.has(pos) ? c.muted("·") : " ";
  }
  cells += past + 1 > shown ? " " : c.lime("│");
  const callAt = story.upcoming ? Math.floor(((new Date(story.upcoming).getTime() - now) / DAY) * perDay) : null;
  for (let n = 0; n < ahead * perDay; n += 1) {
    if (past + 1 + n >= shown) cells += " ";
    else if (callAt === n) cells += c.bold(c.lime("▲"));
    else if (callAt !== null && callAt >= ahead * perDay && n === ahead * perDay - 1) cells += c.lime("›");
    else cells += " ";
  }
  return cells;
}

const SPARK = "▁▂▃▄▅▆▇█";

/** The whole search's activity, a bar a day, lined up with the strips below it. */
export function activitySpark(stories, { today = new Date(), days, perDay = 1, c }) {
  const counts = new Array(days).fill(0);
  for (const s of stories) {
    for (const e of s.events) {
      const age = Math.floor((today - new Date(e.at)) / DAY);
      if (age >= 0 && age < days) counts[days - 1 - age] += 1;
    }
  }
  const top = Math.max(...counts, 1);
  return counts.map((n) => (n ? c.rgb(...heatColor((1 - n / top) * 0.9))(SPARK[Math.min(Math.floor((n / top) * SPARK.length), SPARK.length - 1)].repeat(perDay)) : " ".repeat(perDay))).join("");
}

/** Dates over the strips, each above its own midnight, ending on today. */
export function timelineAxis({ today = new Date(), days, ahead = 7, perDay = 1 }) {
  const past = days * perDay;
  const cells = new Array(past + 1 + ahead * perDay).fill(" ");
  const todayAt = past - 5;
  if (todayAt >= 0) "today".split("").forEach((ch, i) => (cells[todayAt + i] = ch));
  let free = todayAt; // Newest first, so nothing ever runs into the label to its right.
  for (const [col, when] of [...midnights(today, days, perDay)].sort((a, b) => b[0] - a[0])) {
    const label = new Date(when).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    if (col + label.length >= free) continue;
    label.split("").forEach((ch, i) => (cells[col + i] = ch));
    free = col;
  }
  return cells.join("");
}

/** What each agent got you, as a funnel bar for each. Reads no referral data, so pay can't move anyone up. */
export function scorecard(state, c, width = process.stdout.columns || 100) {
  const { rows, unattributed } = scoreRows(state);
  const nameWidth = Math.min(Math.max(...rows.map((r) => r.agent.length), 8) + 2, 20);
  const barWidth = Math.max(Math.min(width - nameWidth - 45, 26), 6);
  const top = Math.max(...rows.map((r) => r.matches), 1);
  const out = [c.bold("What each agent actually got you"), `${c.muted("░ match")}  ${c.rgb(...heatColor(0.9))("▒ talking")}  ${c.rgb(...heatColor(0.3))("▓ interview")}  ${c.lime("█ offer")}`, ""];
  out.push(c.muted(`${" ".repeat(nameWidth + barWidth + 1)} ${"intv".padStart(4)} ${"offer".padStart(5)} ${"answers".padStart(7)} ${"usually".padStart(7)}`));
  const live = rows.filter((r) => r.matches || r.sent);
  for (const r of live) {
    const scale = (n) => (n ? Math.max(Math.round((n / top) * barWidth), 1) : 0);
    const offer = scale(r.offers);
    const interview = Math.max(scale(r.interviews) - offer, 0);
    const talking = Math.max(scale(r.talking) - offer - interview, 0);
    const match = Math.max(scale(r.matches) - offer - interview - talking, 0);
    const bar = c.lime("█".repeat(offer)) + c.rgb(...heatColor(0.3))("▓".repeat(interview)) + c.rgb(...heatColor(0.9))("▒".repeat(talking)) + c.muted("░".repeat(match));
    const blank = " ".repeat(barWidth - offer - interview - talking - match);
    const verdict = r.verdict === "delivering" ? c.lime(r.verdict) : r.verdict === "not answering" ? c.red(r.verdict) : c.muted(r.verdict);
    const name = pad(r.agent, nameWidth);
    const answers = r.sent ? `${r.replies}/${r.sent}` : "–";
    out.push(`${r.interviews || r.offers ? c.bold(name) : name}${bar}${blank}  ${String(r.interviews).padStart(4)} ${String(r.offers).padStart(5)} ${answers.padStart(7)} ${(r.typical === null ? "–" : span(r.typical)).padStart(7)}${width >= nameWidth + barWidth + 43 ? `  ${verdict}` : ""}`);
  }
  if (!live.length) out.push(c.muted("Nothing to score yet: no agent has sent a match or had a message from you."));
  const quiet = rows.length - live.length;
  out.push("");
  if (quiet) out.push(c.muted(`${quiet} more with nothing yet.`));
  if (unattributed) out.push(c.muted(`${unattributed} role${unattributed === 1 ? " isn’t" : "s aren’t"} tied to any agent, so ${unattributed === 1 ? "it isn’t" : "they aren’t"} counted.`));
  out.push(c.muted("Referral pay plays no part in this."));
  return out.join("\n");
}

export function referrals(state, c) {
  const live = PROGRAMS.filter(liveLink);
  const waiting = PROGRAMS.filter((p) => !liveLink(p));
  const out = [c.bold(`Referral links: ${REFERRALS_ENABLED ? "on" : "off"}`), DISCLOSURE];
  out.push(c.muted(live.length ? `Live: ${live.map((p) => p.name).join(", ")}` : "No referral links are live yet. Signups use each program’s normal page."));
  if (waiting.length) out.push(c.muted(`No link yet, so these use their normal page: ${waiting.map((p) => p.name).join(", ")}`));
  out.push(c.muted("There’s no setting for this. To change it, edit lib/referrals.js in SELLME’s code."));
  if (state.ledger.length) out.push("", c.muted("LEDGER"));
  for (const l of state.ledger) out.push(`${pad(l.stage, 11)}${pad(l.agent, 14)}${l.company ?? ""}`);
  return out.join("\n");
}

const xml = (s) => String(s).replace(/[<>&"']/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[m]);

/** The share card. Only the user's real counts, with their name as the biggest thing on it. */
export function bragCard(state) {
  const n = counts(state);
  const name = state.profile.name ?? "Me";
  const lines = [`My agent worked ${n.agents} recruiter agent${n.agents === 1 ? "" : "s"} for me.`, `${n.roles} roles. ${n.interviews} in interviews.`];
  const size = Math.min(150, Math.floor(1500 / Math.max(name.length, 1) / 0.6));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
<rect width="1600" height="900" fill="#0B0A12"/>
<text x="100" y="330" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${size}" fill="#C8F031">${xml(name)}</text>
<text x="100" y="480" font-family="Helvetica, Arial, sans-serif" font-size="56" fill="#F3F1EA">${xml(lines[0])}</text>
<text x="100" y="560" font-family="Helvetica, Arial, sans-serif" font-size="56" fill="#F3F1EA">${xml(lines[1])}</text>
<text x="100" y="800" font-family="Menlo, monospace" font-size="36" fill="#A8A5B8">npx sellme@latest</text>
</svg>
`;
  return { name, lines, svg };
}

export function invoice(state, c) {
  return [
    c.lime(c.bold("INVOICE")),
    `To: ${state.profile.name ?? "You"}`,
    "For: 1 job",
    `${c.bold("Amount due: one GitHub star.")}`,
    c.muted("SELLME won’t star it for you. That would be lying."),
    "",
    "Your agents are paused, so nobody keeps pitching someone with a job.",
    c.muted("Congratulations. Mean it."),
  ].join("\n");
}

export const CLIPPY = "It looks like you’re trying to get a job.\nWould you like help?\n\n  (•) Yes\n  ( ) Don’t show me this tip again, I enjoy cover letters";

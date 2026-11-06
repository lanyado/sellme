// Everything the user sees. Symbols carry the meaning, so it still reads with no color.
import { stepsFor } from "./connect.js";
import { autoOn, connectList, counts, openItems, personRoute } from "./core.js";
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
  return { lime: pick(COLORS.lime), violet: pick(COLORS.violet), red: pick(COLORS.red), muted: pick(COLORS.muted), bold: paint("1") };
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
  const total = open.length + state.alerts.length + blocking;
  const count = total === 0 ? "Nothing needs you." : total === 1 ? "1 thing needs you." : `${total} things need you.`;
  const steps = setupSteps(state);
  const ready = steps.every((step) => step.done);
  out.push(c.lime(c.bold(ready || total ? `${hello} ${count}` : hello)));
  if (state.paused) out.push(c.muted(`Paused. Nothing goes out${waiting ? `, including ${waiting} approved and waiting` : ""}. ${width ? "Run: sellme resume" : "Say “resume” to restart."}`));

  if (!ready) {
    out.push("", c.muted(`SETUP  ${steps.filter((step) => step.done).length} of ${steps.length}`));
    for (const step of steps) out.push(`${step.done ? c.lime("✓") : c.muted("○")} ${pad(step.label, 14)}${c.muted(step.detail)}`);
  }
  if (state.alerts.length) {
    out.push("", c.red("HEADS UP"));
    for (const a of state.alerts) out.push(`${c.red(pad(a.id, 4))}${a.agent ? `${a.agent}: ` : ""}${a.text}`);
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

/** The search as one line, like the funnel career-ops opens its README with. */
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
    const steps = item.kind === "connector" ? stepsFor(item) : [];
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

const CHANNEL_NAME = { mcp: "its app", imessage: "iMessage", email: "email", browser: "its website", linkedin: "LinkedIn" };

/** Where a draft's backing comes from, in words the user knows. */
function backing(sources = []) {
  const kinds = new Set(
    sources.map((s) => (s === "user.choice" ? "your yes" : s === "profile.resume_link" ? "your resume link" : s.startsWith("profile.") ? "your profile" : s === "user" ? "your own words" : "your resume")),
  );
  return [...kinds].join(" and ");
}

/** One draft, the way the user reads it: who, what they asked, what goes back, and whether it holds up. */
export function card(q, c, position, width = process.stdout.columns || 100) {
  const room = Math.max(Math.min(width - 6, 78), 20);
  const route = q.channel === "self" ? personRoute(q.to) : q.channel;
  const via = q.channel === "self" && !route ? "no address yet" : `by ${CHANNEL_NAME[route] ?? route}${q.channel === "self" ? ` · ${q.to}` : ""}`;
  const out = [`${position ? `${c.muted(position)}  ` : ""}${c.bold(q.agent)}  ${c.muted(via)}`, ""];
  const block = (label, text, bar) => {
    out.push(`  ${c.muted(label)}`);
    for (const line of wrap(text, room)) out.push(`  ${bar("│")} ${line}`);
    out.push("");
  };
  if (q.asked) block("They asked", q.asked, c.muted);
  if (q.suggestion) block(q.suggested_by === "you" ? "Your reply" : "Suggested reply · only you can answer this, so check it", q.suggestion, c.lime);
  else if (q.text) block(q.status === "blocked" ? "Draft" : "Your reply", q.text, q.status === "blocked" ? c.red : c.lime);
  // Why a question is the user's is the AI's note to them, not an error.
  const why = (q.check?.reasons ?? []).filter((r) => r.code === "agent_block");
  for (const r of why) block("Note from the AI", r.message, c.muted);
  const notes = [];
  if (q.attach === "file") notes.push(c.lime("+ Your resume goes with it"));
  if (q.attach === "link") notes.push(c.lime("+ Has the link to your resume"));
  if (q.attach === "manual") notes.push(c.violet("! You attach your resume yourself: SELLME opens the chat right after it sends"));
  if (q.status !== "blocked" && !q.sensitive && q.sources?.length) notes.push(c.lime(`✓ Backed by ${backing(q.sources)}`));
  for (const r of (q.check?.reasons ?? []).filter((x) => x.code !== "agent_block")) notes.push(...wrap(`${q.status === "blocked" ? "✗" : "!"} ${r.message}`, room).map((l, i) => c[q.status === "blocked" ? "red" : "violet"](i ? `  ${l}` : l)));
  if (q.instructions) notes.push(...wrap(`Your note for the AI: ${q.instructions}`, room).map((l) => c.muted(l)));
  for (const n of notes) out.push(`  ${n}`);
  if (!notes.length) out.pop();
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

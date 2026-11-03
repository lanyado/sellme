// Everything the user sees. Symbols carry the meaning, so it still reads with no color.
import { counts, openItems } from "./core.js";
import { DISCLOSURE, PROGRAMS, REFERRALS_ENABLED } from "./referrals.js";

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
const pad = (s, n) => String(s).padEnd(n);

function greeting(date) {
  const h = date.getHours();
  return h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening";
}

export function banner(c) {
  return `${c.lime(WORDMARK.join("\n"))}\n\n${c.bold("Bots rejected you. Send a bot back.")}`;
}

function needsLine(q) {
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
    out.push(c.lime(c.bold(`You’re hired${state.hired.company ? ` at ${state.hired.company}` : ""}. I’m off duty.`)));
    return out.join("\n");
  }
  const total = open.length + state.alerts.length;
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
  const next = !ready ? "Type /sellme setup in your AI tool" : open.length ? (width ? "sellme review" : "/sellme goes through them with you") : waiting ? `Type /sellme to send ${waiting} approved` : "You’re all caught up";
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
  for (const a of state.agents) out.push(`${state.paused ? c.muted("○") : c.lime("✓")} ${pad(a.name, 14)}${c.muted(pad(a.channel, 10))}${a.auto ? c.violet("auto") : ""}`);
  return out.join("\n");
}

export function card(q, c, position) {
  const out = [c.bold(`${position ? `${position}  ` : ""}${q.agent} · ${q.channel}`)];
  if (q.asked) out.push(c.muted("They asked"), `“${q.asked}”`);
  if (q.text) out.push(c.muted("Draft"), `“${q.text}”`);
  for (const r of q.check?.reasons ?? []) out.push(c[q.status === "blocked" ? "red" : "violet"](`${q.status === "blocked" ? "✗" : "!"} ${r.message}`));
  if (q.status !== "blocked" && !q.sensitive && q.sources?.length) out.push(c.lime(`✓ Source: ${q.sources.join(", ")}`));
  return out.join("\n");
}

export function referrals(state, c) {
  const live = PROGRAMS.filter((p) => p.referral_link);
  const out = [c.bold(`Referral links: ${REFERRALS_ENABLED ? "on" : "off"}`), DISCLOSURE];
  out.push(c.muted(live.length ? `Live: ${live.map((p) => p.name).join(", ")}` : "No referral links are live yet. Signups use each program’s normal page."));
  out.push(c.muted("There’s no setting for this. To change it, edit lib/referrals.js in Sellme’s code."));
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
    c.muted("I won’t star it for you. That would be lying."),
    "",
    "Your agents are paused, so nobody keeps pitching someone with a job.",
    c.muted("Congratulations. Mean it."),
  ].join("\n");
}

export const CLIPPY = "It looks like you’re trying to get a job.\nWould you like help?\n\n  (•) Yes\n  ( ) Don’t show me this tip again, I enjoy cover letters";

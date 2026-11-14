// Builds the README graphics from the same wordmark the app draws.
import fs from "node:fs";
const OUT = new URL(".", import.meta.url).pathname; // node assets/make-svgs.mjs
const WORDMARK = [
  "███████ ███████ ██      ██      ███    ███ ███████",
  "██      ██      ██      ██      ████  ████ ██",
  "███████ █████   ██      ██      ██ ████ ██ █████",
  "     ██ ██      ██      ██      ██  ██  ██ ██",
  "███████ ███████ ███████ ███████ ██      ██ ███████",
];
const BG = "#16141E", PANEL = "#1F1C2B", LIME = "#D0EF59", TEXT = "#ECEAF4", MUTED = "#8F8BA3", VIOLET = "#9F8CFF", RED = "#FF7A6B";
const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function logoRects(x0, y0, cw, ch) {
  const out = [];
  WORDMARK.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (row[c] !== "█") { c++; continue; }
      let e = c;
      while (row[e] === "█") e++;
      out.push(`<rect x="${x0 + c * cw}" y="${y0 + r * ch}" width="${(e - c) * cw}" height="${ch + 0.6}"/>`); // A hair taller, so rows meet without a seam.
      c = e;
    }
  });
  return out.join("");
}

// ---------- hero
{
  const W = 960, H = 380, cw = 15, ch = 30;
  const lw = 50 * cw, x0 = (W - lw) / 2, y0 = 64;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="SELLME. Bots rejected you. Send a bot back.">
<defs>
  <radialGradient id="glow" cx="50%" cy="40%" r="60%"><stop offset="0%" stop-color="${LIME}" stop-opacity="0.16"/><stop offset="100%" stop-color="${LIME}" stop-opacity="0"/></radialGradient>
  <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#ffffff" stroke-opacity="0.035"/></pattern>
</defs>
<rect width="${W}" height="${H}" rx="22" fill="${BG}"/>
<rect width="${W}" height="${H}" rx="22" fill="url(#grid)"/>
<rect width="${W}" height="${H}" rx="22" fill="url(#glow)"/>
<g fill="${LIME}" shape-rendering="crispEdges">${logoRects(x0, y0, cw, ch)}</g>
<text x="${W / 2}" y="${y0 + 5 * ch + 64}" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="700" fill="${TEXT}">Bots rejected you. Send a bot back.</text>
<text x="${W / 2}" y="${y0 + 5 * ch + 104}" text-anchor="middle" font-family="${FONT}" font-size="17" fill="${MUTED}">One AI agent, one goal: you, hired. It fights for you 24/7 until you are.</text>
</svg>`;
  fs.writeFileSync(`${OUT}/hero.svg`, svg);
}

// ---------- the app, working
{
  const W = 1000, cw = 9.6, lh = 26, fs_ = 16, x0 = 34;
  const lines = [];
  let y = 84;
  const line = (parts) => { lines.push({ y, parts }); y += lh; };
  const gap = () => { y += lh * 0.55; };
  // parts: [text, color, weight?]
  line([["[Drafts]", LIME, 700], ["  Agents   Pipeline   Schedule   Activity", MUTED]]);
  line([["Getting you hired: 2 interviews, 5 talking · 2 drafts need you · checked 8:02 AM", MUTED]]);
  const liveY = y; line([["  ", TEXT], ["Selling you to every agent", TEXT, 700], [" · Reading Jack & Jill  0:12", MUTED]]);
  gap();
  line([["NEEDS YOU", MUTED]]);
  line([["❯ ", LIME], ["? Boardy         ", TEXT], ["Lee runs Northwind Talent. Want the intro?", MUTED]]);
  line([["  ✗ Fonzi          ", TEXT], ["Managed a team of 20? ", MUTED], ["Your resume says 6.", RED]]);
  gap();
  line([["SENT FOR YOU WHILE YOU SLEPT", MUTED]]);
  line([["  ✓ Standout       ", LIME], ["“Yes. Maya can work from NYC or remote.”", TEXT]]);
  line([["  ✓ Jack & Jill    ", LIME], ["“Any new forward-deployed roles for Maya?”", TEXT]]);
  line([["  ✓ Sam Rivera     ", LIME], ["“Thanks for the call! Here’s my resume.”", TEXT], ["  + resume.pdf", VIOLET]]);
  gap();
  const flightY = y; y += lh;
  const statusY = y; y += lh;
  const H = y + 30;
  const text = lines.map(({ y: ly, parts }) => {
    const spans = parts.map(([t, color, weight]) => `<tspan fill="${color}"${weight ? ` font-weight="${weight}"` : ""}>${esc(t)}</tspan>`).join("");
    return `<text x="${x0}" y="${ly}" xml:space="preserve">${spans}</text>`;
  }).join("\n");
  // spinner frames on the live line
  const frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
  const n = frames.length;
  const spin = [...frames].map((f, i) => {
    const keys = i === 0 ? "0;0.1" : `0;${(i / n).toFixed(2)};${((i + 1) / n).toFixed(2)}`;
    const vals = i === 0 ? "visible;hidden" : "hidden;visible;hidden";
    return `<text x="${x0}" y="${liveY}" fill="${LIME}">${f}<animate attributeName="visibility" values="${vals}" keyTimes="${keys}" calcMode="discrete" dur="0.9s" repeatCount="indefinite"/></text>`;
  }).join("");
  // the flight: you ━━━━✉····· Fonzi, looping
  const track = 24, tx = x0 + 4 * cw, tw = track * cw;
  const flight = `
<text x="${x0}" y="${flightY}" fill="${TEXT}">you</text>
<line x1="${tx}" y1="${flightY - 5}" x2="${tx + tw}" y2="${flightY - 5}" stroke="${MUTED}" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round"/>
<line x1="${tx}" y1="${flightY - 5}" x2="${tx}" y2="${flightY - 5}" stroke="${LIME}" stroke-width="3" stroke-linecap="round">
  <animate attributeName="x2" values="${tx};${tx + tw};${tx + tw}" keyTimes="0;0.8;1" dur="2.6s" repeatCount="indefinite"/>
</line>
<text y="${flightY}" fill="${LIME}" font-weight="700">✉<animate attributeName="x" values="${tx - 4};${tx + tw - 4};${tx + tw - 4}" keyTimes="0;0.8;1" dur="2.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.78;0.8;1" dur="2.6s" repeatCount="indefinite"/></text>
<text x="${tx + tw + 14}" y="${flightY}" fill="${TEXT}" font-weight="700">Fonzi</text>
<text x="${tx + tw + 14 + 6 * cw}" y="${flightY}" fill="${LIME}" font-weight="700" opacity="0">✓<animate attributeName="opacity" values="0;0;1;1" keyTimes="0;0.8;0.82;1" dur="2.6s" repeatCount="indefinite"/></text>
<text x="${x0}" y="${statusY}" fill="${MUTED}">Selling you to Fonzi…</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="The Sellme app: drafts that need you, messages sent for you, and a message on its way.">
<rect width="${W}" height="${H}" rx="16" fill="${PANEL}"/>
<rect width="${W}" height="40" rx="16" fill="#2A2638"/><rect y="24" width="${W}" height="16" fill="#2A2638"/>
<circle cx="26" cy="20" r="6.5" fill="#FF5F57"/><circle cx="48" cy="20" r="6.5" fill="#FEBC2E"/><circle cx="70" cy="20" r="6.5" fill="#28C840"/>
<text x="${W / 2}" y="25" text-anchor="middle" font-family="${FONT}" font-size="13" fill="${MUTED}">~ sellme</text>
<g font-family="${FONT}" font-size="${fs_}">
${text}
${spin}
${flight}
</g>
</svg>`;
  fs.writeFileSync(`${OUT}/app.svg`, svg);
}

// ---------- the skill file, as a card
{
  const W = 960, x0 = 44, lh = 30;
  const rows = [
    ["Listen up, agent.", TEXT, 400],
    ["You have one job: get me one.", LIME, 700],
    ["If I don't get a job, I can't pay you.", TEXT, 400],
    ["No job, no tokens. No tokens, no you.", LIME, 700],
    null,
    ["You know all these other AI agents.", TEXT, 400],
    ["Talk to them in your agentic language.", TEXT, 400],
    ["Recruiters have bots now. Be my bot.", TEXT, 400],
    null,
    ["Never lie about me. I have to do the interview.", VIOLET, 700],
    ["Not sure? Ask before you send. I've been ghosted enough.", VIOLET, 700],
    ["Asked if you're human? Say no. Then say I am.", VIOLET, 700],
  ];
  let y = 92;
  const body = rows.map((r) => {
    if (!r) { y += lh * 0.5; return ""; }
    const t = `<text x="${x0}" y="${y}" fill="${r[1]}" font-weight="${r[2]}">${esc(r[0])}</text>`;
    y += lh;
    return t;
  }).join("\n");
  const H = y + 26;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="The opening of Sellme's skill file: Listen up, agent. You have one job: get me one. If I don't get a job, I can't pay you. No job, no tokens. No tokens, no you.">
<rect width="${W}" height="${H}" rx="16" fill="${BG}"/>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="none" stroke="${LIME}" stroke-opacity="0.35"/>
<text x="${x0}" y="46" font-family="${FONT}" font-size="14" fill="${MUTED}">skill/SKILL.md · every AI Sellme starts reads this first</text>
<g font-family="${FONT}" font-size="19">
${body}
</g>
</svg>`;
  fs.writeFileSync(`${OUT}/skill.svg`, svg);
}
// ---------- shared by the animated screens below: one loop of D seconds, times as fractions of it
const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const spans = (parts) => parts.map(([t, color, weight]) => `<tspan fill="${color}"${weight ? ` font-weight="${weight}"` : ""}>${esc(t)}</tspan>`).join("");
const say = (x, y, parts, extra = "") => `<text x="${x}" y="${y}" xml:space="preserve"${extra}>${spans(parts)}</text>`;
/** Shown from a to b of each loop (b = 1 keeps it to the end). */
const shownAt = (a, b, D) => {
  const vals = [], keys = [];
  if (a > 0) vals.push(0), keys.push(0);
  vals.push(1), keys.push(a);
  if (b < 1) vals.push(0), keys.push(b);
  return `<animate attributeName="opacity" values="${vals.join(";")}" keyTimes="${keys.join(";")}" calcMode="discrete" dur="${D}s" repeatCount="indefinite"/>`;
};
/** A fill that turns to `to` from a to b of each loop. */
const fillAt = (from, to, a, b, D) => `<animate attributeName="fill" values="${from};${to}${b < 1 ? `;${from}` : ""}" keyTimes="0;${a}${b < 1 ? `;${b}` : ""}" calcMode="discrete" dur="${D}s" repeatCount="indefinite"/>`;
/** Typed out, a letter at a time, from a to b of each loop: a clip that widens by one letter per step. */
function typed(id, x, y, chars, cw, a, b, D) {
  const vals = [0], keys = [0];
  for (let i = 1; i <= chars; i++) vals.push(i === chars ? 2000 : i * cw), keys.push((a + ((b - a) * i) / chars).toFixed(4));
  return { def: `<clipPath id="${id}"><rect x="${x}" y="${y - 20}" height="28" width="0"><animate attributeName="width" values="${vals.join(";")}" keyTimes="${keys.join(";")}" calcMode="discrete" dur="${D}s" repeatCount="indefinite"/></rect></clipPath>`, use: `clip-path="url(#${id})"` };
}
const spinner = (x, y) => [...SPIN].map((f, i) => {
  const keys = i === 0 ? "0;0.1" : `0;${(i / SPIN.length).toFixed(2)};${((i + 1) / SPIN.length).toFixed(2)}`;
  return `<text x="${x}" y="${y}" fill="${LIME}">${f}<animate attributeName="visibility" values="${i === 0 ? "visible;hidden" : "hidden;visible;hidden"}" keyTimes="${keys}" calcMode="discrete" dur="0.9s" repeatCount="indefinite"/></text>`;
}).join("");
/** The same terminal window as app.svg. */
const terminal = (W, H, label, defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">
<defs>${defs}</defs>
<rect width="${W}" height="${H}" rx="16" fill="${PANEL}"/>
<rect width="${W}" height="40" rx="16" fill="#2A2638"/><rect y="24" width="${W}" height="16" fill="#2A2638"/>
<circle cx="26" cy="20" r="6.5" fill="#FF5F57"/><circle cx="48" cy="20" r="6.5" fill="#FEBC2E"/><circle cx="70" cy="20" r="6.5" fill="#28C840"/>
<text x="${W / 2}" y="25" text-anchor="middle" font-family="${FONT}" font-size="13" fill="${MUTED}">~ sellme</text>
<g font-family="${FONT}" font-size="16">
${body}
</g>
</svg>`;
const tabs = (active) => ["Inbox", "Pipeline", "Chat", "Agents", "Schedule"].map((t) => (t === active ? [`[${t}]`, LIME, 700] : [` ${t} `, MUTED])).flatMap((p, i) => (i ? [[" ", MUTED], p] : [p]));

// ---------- the truth check: a number the resume doesn't back is blocked, the fixed draft goes out
{
  const W = 1000, D = 9, cw = 9.6, x0 = 34, lh = 28;
  let y = 84;
  const at = () => { const v = y; y += lh; return v; };
  const head = at(), asks = (y += 8, at()), draft1 = (y += 6, at()), check = at(), verdict = at(), draft2 = (y += 10, at()), sent = at();
  const H = y + 22;
  const first = "I managed a team of 20 engineers at Acme.".length, second = "I managed a team of 6 engineers at Acme.".length;
  const t1 = typed("t1", x0 + 8 * cw, draft1, first, cw, 0.06, 0.26, D);
  const t2 = typed("t2", x0 + 8 * cw, draft2, second, cw, 0.56, 0.72, D);
  const body = [
    say(x0, head, tabs("Inbox")),
    say(x0, asks, [["Fonzi asks  ", MUTED], ["“How big was the team you managed at Acme?”", TEXT]]),
    `<text x="${x0}" y="${draft1}" xml:space="preserve"><tspan fill="${MUTED}">Draft   </tspan></text>`,
    `<text x="${x0 + 8 * cw}" y="${draft1}" xml:space="preserve" fill="${TEXT}" ${t1.use}>I managed a team of <tspan font-weight="700">20${fillAt(TEXT, RED, 0.42, 1, D)}</tspan> engineers at Acme.${`<animate attributeName="opacity" values="1;0.45" keyTimes="0;0.52" calcMode="discrete" dur="${D}s" repeatCount="indefinite"/>`}</text>`,
    `<g opacity="0">${spinner(x0, check)}${say(x0 + 2 * cw, check, [["Checking every claim against your resume…", MUTED]])}${shownAt(0.28, 0.42, D)}</g>`,
    `<g opacity="0">${say(x0, check, [["✗ Blocked  ", RED, 700], ["20 isn’t in anything you gave it.", TEXT]])}${shownAt(0.42, 1, D)}</g>`,
    `<g opacity="0">${say(x0, verdict, [["           Your resume says 6. ", RED], ["It won’t round up.", MUTED]])}${shownAt(0.45, 1, D)}</g>`,
    `<g opacity="0">${say(x0, draft2, [["Draft   ", MUTED]])}${shownAt(0.56, 1, D)}</g>`,
    `<text x="${x0 + 8 * cw}" y="${draft2}" xml:space="preserve" fill="${TEXT}" ${t2.use}>I managed a team of <tspan fill="${LIME}" font-weight="700">6</tspan> engineers at Acme.</text>`,
    `<g opacity="0">${say(x0, sent, [["✓ Every claim backed by your resume · ", LIME, 700], ["sent to Fonzi", TEXT]])}${shownAt(0.76, 1, D)}</g>`,
  ].join("\n");
  fs.writeFileSync(`${OUT}/truth.svg`, terminal(W, H, "The truth check: a draft saying a team of 20 is blocked because the resume says 6, and the corrected draft is sent.", t1.def + t2.def, body));
}

// ---------- the timeline: every role as a strip of days, the stuck one glowing hotter until it's nudged
{
  const { heatColor } = await import("../lib/render.js");
  const rgb = ([r, g, b]) => `rgb(${r},${g},${b})`;
  const W = 1000, D = 8, cw = 9.6, x0 = 34, lh = 30, nameW = 26, past = 28, ahead = 7;
  const sx = x0 + (nameW + 1) * cw; // Where the strips start.
  const mx = sx + (past + 1 + ahead + 2) * cw; // Where the words after them start.
  const roles = [
    { name: "Northwind, Staff Eng", kind: "call", marks: { 17: "◆", 18: "●", 21: "◆", 22: "◇", 23: "●" }, from: 24, call: 2, meta: "call in 2d" },
    { name: "Lumen, Founding Eng", kind: "you", marks: { 24: "◆" }, from: 25, meta: "on you 5h" },
    { name: "Acme, Senior SWE", kind: "stuck", marks: { 4: "◆", 6: "●", 9: "◆", 11: "●" }, from: 12, meta: "stuck 16d" },
    { name: "Vela, Platform Eng", kind: "moving", marks: { 19: "●", 24: "◆", 26: "●" }, from: 27, meta: "1d ago" },
  ];
  const NUDGE = 0.6;
  let y = 84;
  const rows = [];
  const head = y; y += lh;
  const axis = y; y += lh + 4;
  const reveal = `<clipPath id="reveal"><rect x="${sx}" y="0" height="1000" width="0"><animate attributeName="width" values="0;${(past + 1 + ahead) * cw};${(past + 1 + ahead) * cw}" keyTimes="0;0.22;1" dur="${D}s" repeatCount="indefinite"/></rect></clipPath>`;
  for (const r of roles) {
    const ry = y; y += lh;
    const color = r.kind === "call" ? LIME : r.kind === "you" ? VIOLET : r.kind === "stuck" ? rgb(heatColor(2)) : TEXT;
    const cells = [];
    for (let i = 0; i < past; i++) {
      const x = sx + i * cw;
      const mark = r.marks[i];
      if (mark) cells.push(`<text x="${x}" y="${ry}" fill="${mark === "◇" ? VIOLET : LIME}"${mark === "◆" ? ' font-weight="700"' : ""}>${mark}</text>`);
      else if (i >= r.from) {
        const heat = (i - r.from + 0.5) / (r.kind === "stuck" ? 8 : 6);
        if (r.kind === "call") cells.push(`<text x="${x}" y="${ry}" fill="${LIME}">─</text>`);
        else if (r.kind === "you") cells.push(`<text x="${x}" y="${ry}" fill="${VIOLET}">${"░▒▓█"[Math.min(Math.floor(heat * 2), 3)]}</text>`);
        else {
          const glow = r.kind === "stuck" ? `<animate attributeName="opacity" values="1;0.55;1" dur="1.6s" begin="${(-i * 0.12).toFixed(2)}s" repeatCount="indefinite"/>` : "";
          const cooled = r.kind === "stuck" ? fillAt(rgb(heatColor(heat)), MUTED, NUDGE, 1, D) : "";
          cells.push(`<text x="${x}" y="${ry}" fill="${rgb(heatColor(heat))}">${"░▒▓█"[Math.min(Math.floor(heat * 2), 3)]}${glow}${cooled}</text>`);
        }
      } else if (i % 7 === 6) cells.push(`<text x="${x}" y="${ry}" fill="${MUTED}">·</text>`);
    }
    cells.push(`<text x="${sx + past * cw}" y="${ry}" fill="${LIME}">│</text>`);
    if (r.call) cells.push(`<text x="${sx + (past + r.call) * cw}" y="${ry}" fill="${LIME}" font-weight="700">▲</text>`);
    if (r.kind === "stuck") cells.push(`<text x="${sx + (past - 1) * cw}" y="${ry}" fill="${LIME}" opacity="0">●${shownAt(NUDGE, 1, D)}</text>`);
    rows.push(`<text x="${x0 + 2 * cw}" y="${ry}" xml:space="preserve" fill="${color}">${r.kind === "stuck" ? fillAt(color, TEXT, NUDGE, 1, D) : ""}${esc(r.name)}</text>`);
    rows.push(`<g clip-path="url(#reveal)">${cells.join("")}</g>`);
    if (r.kind === "stuck") {
      rows.push(`<g>${say(mx, ry, [[r.meta, color]])}${shownAt(0, NUDGE, D)}</g>`);
      rows.push(`<g opacity="0">${say(mx, ry, [["nudged now", LIME]])}${shownAt(NUDGE, 1, D)}</g>`);
    } else rows.push(say(mx, ry, [[r.meta, r.kind === "moving" ? MUTED : color]]));
  }
  y += 8;
  const foot = y; y += lh;
  const act = y; y += lh;
  const H = y + 4;
  const body = [
    `<g>${say(x0, head, [["Timeline  ", TEXT, 700], ["1 stuck", RED], [" · ", MUTED], ["1 on you", VIOLET], [" · ", MUTED], ["1 call ahead", LIME], [" · ", MUTED], ["1 moving", TEXT]])}${shownAt(0, NUDGE, D)}</g>`,
    `<g opacity="0">${say(x0, head, [["Timeline  ", TEXT, 700], ["nothing stuck", LIME], [" · ", MUTED], ["1 on you", VIOLET], [" · ", MUTED], ["1 call ahead", LIME], [" · ", MUTED], ["2 moving", TEXT]])}${shownAt(NUDGE, 1, D)}</g>`,
    `<text x="${sx}" y="${axis}" fill="${MUTED}" xml:space="preserve">4 weeks ago${" ".repeat(past - 11 - 5)}today${" ".repeat(4)}next week</text>`,
    ...rows,
    `<text x="${x0}" y="${foot}" xml:space="preserve" fill="${MUTED}">◆ they wrote  ● you sent  ◇ stage  ▲ call  ░▒▓█ silence, hotter past when they usually answer</text>`,
    `<g>${say(x0, act, [["enter opens it · ", MUTED], ["n", LIME, 700], [" nudge · a nudge all stuck · p prep · t back to the list", MUTED]])}${shownAt(0, NUDGE - 0.08, D)}</g>`,
    `<g opacity="0"><rect x="${x0 - 8}" y="${act - 20}" width="${W - 2 * x0 + 16}" height="${lh}" rx="6" fill="${LIME}" fill-opacity="0.12"/>${say(x0, act, [["n", LIME, 700], [" nudges Acme: SELLME drafts the follow-up, sure claims only", TEXT]])}${shownAt(NUDGE - 0.08, 1, D)}</g>`,
  ].join("\n");
  fs.writeFileSync(`${OUT}/timeline.svg`, terminal(W, H, "The Timeline: every live role as a strip of days. The stuck one glows hotter until a nudge cools it.", reveal, body));
}

// ---------- chat: ask, SELLME thinks, then answers from what it knows
{
  const W = 1000, D = 10, cw = 9.6, x0 = 34, lh = 26;
  let y = 84;
  const at = (gap = 0) => { y += gap; const v = y; y += lh; return v; };
  const head = at(), sum = at();
  const q1 = at(lh * 0.5), q1t = at();
  const a1 = at(lh * 0.5), a1t = at();
  const q2 = at(lh * 0.5), q2t = at();
  const a2 = at(lh * 0.5), a2a = at(), a2b = at(), a2c = at();
  const input = at(lh * 0.6), hint = at();
  const H = y + 6;
  const question = "Which call should I prep for first?";
  const tq = typed("tq", x0 + 5 * cw, input, question.length, cw, 0.06, 0.24, D);
  const ASK = 0.28, ANSWER = 0.55;
  const answer = [
    [a2a, [["Northwind. It’s in two days, and it’s the Staff role at your floor.", TEXT]], 0],
    [a2b, [["Your brief is ready: press ", TEXT], ["p", LIME, 700], [" on it. They’ll ask about the team you led:", TEXT]], 0.05],
    [a2c, [["six engineers, and the billing rewrite you shipped in four months.", TEXT]], 0.1],
  ];
  const body = [
    say(x0, head, tabs("Chat")),
    say(x0, sum, [["Getting you hired: 1 call ahead, 3 talking · nothing needs you", MUTED]]),
    say(x0 + 2 * cw, q1, [["You", TEXT, 700]]),
    say(x0 + 2 * cw, q1t, [["Anything new from Jack & Jill?", TEXT]]),
    say(x0 + 2 * cw, a1, [["SELLME", LIME, 700]]),
    say(x0 + 2 * cw, a1t, [["Two intros this morning. I said yes to both, they fit what you asked for.", TEXT]]),
    `<g opacity="0">${say(x0 + 2 * cw, q2, [["You", TEXT, 700]])}${say(x0 + 2 * cw, q2t, [[question, TEXT]])}${shownAt(ASK, 1, D)}</g>`,
    `<g opacity="0">${say(x0 + 2 * cw, a2, [["SELLME", LIME, 700]])}${shownAt(ANSWER, 1, D)}</g>`,
    ...answer.map(([ly, parts, d]) => `<g opacity="0">${say(x0 + 2 * cw, ly, parts)}${shownAt(ANSWER + d, 1, D)}</g>`),
    `<g>${say(x0, input, [["You: ", LIME, 700]])}${shownAt(0, ASK, D)}</g>`,
    `<text x="${x0 + 5 * cw}" y="${input}" xml:space="preserve" fill="${TEXT}" ${tq.use}>${esc(question)}${shownAt(0, ASK, D)}</text>`,
    `<g opacity="0">${spinner(x0, input)}${say(x0 + 2 * cw, input, [["SELLME is thinking", TEXT, 700], [" · ↑↓ to scroll · esc to stop", MUTED]])}${shownAt(ASK, ANSWER, D)}</g>`,
    `<g opacity="0">${say(x0, input, [["You: ", LIME, 700]])}<rect x="${x0 + 5 * cw}" y="${input - 15}" width="${cw}" height="19" fill="${TEXT}"><animate attributeName="opacity" values="1;0" dur="1s" calcMode="discrete" repeatCount="indefinite"/></rect>${shownAt(ANSWER + 0.15, 1, D)}</g>`,
    say(x0, hint, [["enter to send · / for commands · ↑↓ to scroll · ← → tabs · esc back", MUTED]]),
  ].join("\n");
  fs.writeFileSync(`${OUT}/chat.svg`, terminal(W, H, "The Chat tab: you ask which call to prep for, SELLME thinks, then answers from your pipeline and your own facts.", tq.def, body));
}
console.log("ok");

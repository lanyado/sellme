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

// ---------- the app, working: the Inbox as it is now, with a message flying to Standout
{
  const W = 1000, D = 2.6, cw = 9.6, lh = 26, x0 = 34;
  const ax = x0 + 2 * cw, sx = x0 + 20 * cw, tx_ = x0 + 44 * cw; // The Inbox's columns: who, status, what.
  let y = 84;
  const at = (gap = 0) => { y += gap; const v = y; y += lh; return v; };
  const head = at(), sum = at();
  const needs = at(lh * 0.5), r1 = at(), r2 = at(), r3 = at();
  const going = at(lh * 0.5), r4 = at(), r5 = at();
  const flightY = at(lh * 0.6), sold = at();
  const live = at(lh * 0.4), hint = at();
  const H = y + 8;
  const row = (ry, who, status, tone, what, pointer = false) => [
    pointer ? say(x0, ry, [["❯", LIME]]) : "",
    say(ax, ry, [[who, TEXT]]),
    status ? say(sx, ry, [[status, tone]]) : "",
    say(tx_, ry, [[what, MUTED]]),
  ].join("");
  const track = 30, fx = x0 + 4 * cw, tw = track * cw;
  const body = [
    say(x0, head, tabs("Inbox")),
    say(x0, sum, [["Selling you: 1 interview, 4 talking · 3 drafts need you · selling you to 2 now · checked 8:02 AM", MUTED]]),
    say(x0, needs, [["NEEDS YOU", MUTED]]),
    row(r1, "Boardy", "only you know", VIOLET, "app · sent 12m ago", true),
    row(r2, "Fonzi", "needs a fix", RED, "app · sent 1h ago"),
    row(r3, "Sam Rivera", "check: your time", VIOLET, "email · sent 2h ago"),
    say(x0, going, [["SELLING YOU NOW", MUTED]]),
    spinner(sx, r4) + say(sx + 2 * cw, r4, [["sending 0:02", LIME]]) + say(ax, r4, [["Standout", TEXT]]) + say(tx_, r4, [["Yes. Maya can work from NYC or remote.", MUTED]]),
    row(r5, "Jack & Jill", "approved", LIME, "goes out next"),
    `<text x="${x0}" y="${flightY}" fill="${TEXT}">you</text>
<line x1="${fx}" y1="${flightY - 5}" x2="${fx + tw}" y2="${flightY - 5}" stroke="${MUTED}" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round"/>
<line x1="${fx}" y1="${flightY - 5}" x2="${fx}" y2="${flightY - 5}" stroke="${LIME}" stroke-width="3" stroke-linecap="round"><animate attributeName="x2" values="${fx};${fx + tw};${fx + tw}" keyTimes="0;0.8;1" dur="${D}s" repeatCount="indefinite"/></line>
<text y="${flightY}" fill="${LIME}" font-weight="700">✉<animate attributeName="x" values="${fx - 4};${fx + tw - 4};${fx + tw - 4}" keyTimes="0;0.8;1" dur="${D}s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.78;0.8;1" dur="${D}s" repeatCount="indefinite"/></text>
<text x="${fx + tw + 14}" y="${flightY}" fill="${TEXT}" font-weight="700">Standout</text>
<text x="${fx + tw + 14 + 9 * cw}" y="${flightY}" fill="${LIME}" font-weight="700" opacity="0">✓<animate attributeName="opacity" values="0;0;1;1" keyTimes="0;0.8;0.82;1" dur="${D}s" repeatCount="indefinite"/></text>`,
    `<g opacity="0">${say(x0, sold, [["✓", LIME], [" Sold you to Standout.", TEXT]])}${shownAt(0.82, 1, D)}</g>`,
    spinner(x0, live) + say(x0 + 2 * cw, live, [["Selling you to my agentic friends", TEXT, 700], [" · Reading Jack & Jill 0:12", MUTED]]),
    say(x0, hint, [["←→ tabs · ↑↓ move · enter opens it, or stops a send", MUTED]]),
  ].join("\n");
  fs.writeFileSync(`${OUT}/app.svg`, terminal(W, H, "The Sellme app: the Inbox with what needs you, two messages going out, and one flying to Standout.", "", body));
}

// ---------- the truth check, on the real draft card: a number your facts don't back is caught, fixed, then sold
{
  const W = 1000, D = 10, cw = 9.6, x0 = 34, lh = 26, pad = 14;
  const asked = "How big was the team you managed at Acme?", bad = "I managed a team of 20 engineers at Acme.", good = "I managed a team of 6 engineers at Acme.";
  const bw = bad.length * cw + 2 * pad;
  let y = 84;
  const at = (gap = 0) => { y += gap; const v = y; y += lh; return v; };
  const head = at(), who = at(lh * 0.4), q = at(lh * 0.5), label = at(lh * 0.9), d = at(lh * 0.5), check = at(lh * 0.6), menu = at(lh * 0.2), hint = at(), done = at(lh * 0.3);
  const H = y + 4;
  const qx = x0 + 2 * cw, dx = W - 34 - bw;
  const bubble = (x, by, w, stroke) => `<rect x="${x}" y="${by - 19}" width="${w}" height="${lh + 2}" rx="9" fill="none" stroke="${stroke}" stroke-width="1.4">`;
  const CAUGHT = 0.25, EDIT = 0.5, FIXED = 0.66, SOLD = 0.8;
  const t1 = typed("t1", dx + pad, d, bad.length, cw, 0.04, 0.22, D);
  const t2 = typed("t2", dx + pad, d, good.length, cw, EDIT + 0.02, FIXED - 0.02, D);
  const keys = (items) => items.flatMap(([k, l], i) => [[i ? "    " : "", TEXT], [`[${k}]`, LIME, 700], [` ${l}`, TEXT]]);
  const press = (when) => `<g opacity="0"><rect x="${x0 + 1.6 * cw}" y="${menu - 18}" width="${3.4 * cw}" height="24" rx="5" fill="${LIME}" fill-opacity="0.25"/>${shownAt(when - 0.05, when, D)}</g>`;
  const body = [
    say(x0, head, [["1 of 3  ", MUTED], ["Fonzi", TEXT, 700], ["  by its app", MUTED]]),
    say(qx, who, [["Fonzi", TEXT, 700]]),
    `${bubble(qx - pad + 6, q, asked.length * cw + 2 * pad, MUTED)}</rect>`,
    say(qx + 6, q, [[asked, TEXT]]),
    `<g opacity="0">${say(dx + bw, label, [["Draft · flagged", RED]], ' text-anchor="end"')}${shownAt(CAUGHT, FIXED, D)}</g>`,
    `<g opacity="0">${say(dx + bw, label, [["Your reply", MUTED]], ' text-anchor="end"')}${shownAt(FIXED, 1, D)}</g>`,
    `${bubble(dx, d, bw, MUTED)}<animate attributeName="stroke" values="${MUTED};${RED};${LIME}" keyTimes="0;${CAUGHT};${FIXED}" calcMode="discrete" dur="${D}s" repeatCount="indefinite"/></rect>`,
    `<g><text x="${dx + pad}" y="${d}" xml:space="preserve" fill="${TEXT}" ${t1.use}>I managed a team of <tspan font-weight="700">20${fillAt(TEXT, RED, CAUGHT, 1, D)}</tspan> engineers at Acme.</text>${shownAt(0, EDIT, D)}</g>`,
    `<g opacity="0"><text x="${dx + pad}" y="${d}" xml:space="preserve" fill="${TEXT}" ${t2.use}>I managed a team of <tspan fill="${LIME}" font-weight="700">6</tspan> engineers at Acme.</text>${shownAt(EDIT, 1, D)}</g>`,
    `<g opacity="0">${say(qx, check, [["✗ “20” isn’t in your facts.", RED]])}${shownAt(CAUGHT, EDIT, D)}</g>`,
    `<g opacity="0">${say(x0, menu, [["❯ ", LIME], ...keys([["e", "Edit it"], ["y", "Send anyway"], ["c", "Copy draft"], ["d", "Discuss with SELLME"], ["s", "Skip"]])])}${shownAt(CAUGHT, FIXED, D)}</g>`,
    press(EDIT),
    `<g opacity="0">${say(x0, menu, [["❯ ", LIME], ...keys([["y", "Sell me!"], ["e", "Edit"], ["c", "Copy draft"], ["d", "Discuss with SELLME"], ["s", "Skip"]])])}${shownAt(FIXED, 1, D)}</g>`,
    press(SOLD),
    say(x0, hint, [["a letter, enter or a click to choose · esc back", MUTED]]),
    `<g opacity="0">${say(x0, done, [["✓", LIME], [" Sold you to Fonzi.", TEXT, 700]])}${shownAt(SOLD, 1, D)}</g>`,
  ].join("\n");
  fs.writeFileSync(`${OUT}/truth.svg`, terminal(W, H, "The truth check on a draft card: a reply saying a team of 20 is flagged because 20 isn't in your facts, edited to 6, then sold to Fonzi.", t1.def + t2.def, body));
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
    say(x0, sum, [["Selling you: 1 interview, 4 talking · nothing needs you · checked 8:02 AM", MUTED]]),
    say(x0 + 2 * cw, q1, [["You", TEXT, 700]]),
    say(x0 + 2 * cw, q1t, [["Anything new from Jack & Jill?", TEXT]]),
    say(x0 + 2 * cw, a1, [["SELLME", LIME, 700]]),
    say(x0 + 2 * cw, a1t, [["Two intros this morning. I said yes to both, they fit what you asked for.", TEXT]]),
    `<g opacity="0">${say(x0 + 2 * cw, q2, [["You", TEXT, 700]])}${say(x0 + 2 * cw, q2t, [[question, TEXT]])}${shownAt(ASK, 1, D)}</g>`,
    `<g opacity="0">${say(x0 + 2 * cw, a2, [["SELLME", LIME, 700]])}${shownAt(ANSWER, 1, D)}</g>`,
    ...answer.map(([ly, parts, d]) => `<g opacity="0">${say(x0 + 2 * cw, ly, parts)}${shownAt(ANSWER + d, 1, D)}</g>`),
    `<g>${say(x0, input, [["You: ", LIME, 700]])}${shownAt(0, ASK, D)}</g>`,
    `<text x="${x0 + 5 * cw}" y="${input}" xml:space="preserve" fill="${TEXT}" ${tq.use}>${esc(question)}${shownAt(0, ASK, D)}</text>`,
    `<g opacity="0">${spinner(x0, input)}${say(x0 + 2 * cw, input, [["SELLME is thinking", TEXT, 700], [" · ↑↓ scroll · ← → other tabs, the answer waits here · esc to stop", MUTED]])}${shownAt(ASK, ANSWER, D)}</g>`,
    `<g opacity="0">${say(x0, input, [["You: ", LIME, 700]])}<rect x="${x0 + 5 * cw}" y="${input - 15}" width="${cw}" height="19" fill="${TEXT}"><animate attributeName="opacity" values="1;0" dur="1s" calcMode="discrete" repeatCount="indefinite"/></rect>${shownAt(ANSWER + 0.15, 1, D)}</g>`,
    ...[[0, ASK], [ANSWER + 0.15, 1]].map(([a, b]) => `<g${a ? ' opacity="0"' : ""}>${say(x0, hint, [["enter to send · / for commands · ↑↓ to scroll · ← → tabs · esc back", MUTED]])}${shownAt(a, b, D)}</g>`), // Thinking replaces it, as in the app.
  ].join("\n");
  fs.writeFileSync(`${OUT}/chat.svg`, terminal(W, H, "The Chat tab: you ask which call to prep for, SELLME thinks, then answers from your pipeline and your own facts.", tq.def, body));
}
console.log("ok");

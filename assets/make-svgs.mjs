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
<text x="${W / 2}" y="${y0 + 5 * ch + 104}" text-anchor="middle" font-family="${FONT}" font-size="17" fill="${MUTED}">One AI agent, one goal: you, hired. It pushes every recruiter until you are.</text>
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
  line([["2 drafts need you · 3 sent for you · checked 8:02 AM", MUTED]]);
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
console.log("ok");

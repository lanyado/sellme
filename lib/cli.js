// Command line front end. The rules live in core.js and truth.js.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import * as core from "./core.js";
import { DISCLOSURE, REFERRALS_ENABLED, signupList } from "./referrals.js";
import * as view from "./render.js";
import { PKG_ROOT, hosts, install, installedHosts, runningFromRuntime, shimPath, uninstall } from "./install.js";
import { UserError, audit, home, load, withState } from "./store.js";

const BOOLEAN_FLAGS = new Set(["json", "force", "purge", "confirm-sensitive", "peek", "help", "no-color", "all"]);
const VALUE_FLAGS = new Set(["agent", "asked", "channel", "company", "handle", "host", "kind", "link", "reason", "role", "source", "stage", "text", "title"]);

// Recruiter messages reach the screen through these arguments. Escape codes could rewrite the terminal,
// and bidi marks could make a draft read differently from what would be sent.
const UNSAFE_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;
export const cleanArg = (s) => s.replace(UNSAFE_CHARS, "");

export function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = cleanArg(argv[i]);
    if (a === "-h") {
      args.flags.help = true;
      continue;
    }
    if (!a.startsWith("--")) {
      args._.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (BOOLEAN_FLAGS.has(key)) {
      if (eq !== -1) throw new UserError(`--${key} doesn’t take a value.`);
      args.flags[key] = true;
      continue;
    }
    // A misspelled flag must not pass quietly: --sorce would turn into a missing source.
    if (!VALUE_FLAGS.has(key)) {
      const guess = nearest(key, [...VALUE_FLAGS, ...BOOLEAN_FLAGS]);
      throw new UserError(`I don’t know --${key}.${guess ? ` Did you mean --${guess}?` : ""}`);
    }
    if (eq !== -1) args.flags[key] = a.slice(eq + 1);
    else if (i + 1 >= argv.length) throw new UserError(`--${key} needs a value.`);
    else args.flags[key] = cleanArg(argv[++i]);
  }
  return args;
}

const termWidth = () => (process.stdout.isTTY ? process.stdout.columns : undefined);
const list = (s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);

const HELP = `sellme: your AI agent, pitching you to every AI recruiter

Start here
  npx sellme@latest      install
  /sellme setup          tell it once (in your AI tool)
  /sellme                check every agent, then what needs you

Also
  sellme review          approve, edit or skip each draft
  sellme status          every role, every agent
  sellme referrals       which link, which agent, who pays
  sellme brag            a share card with your real numbers
  sellme hired           stop the agents, get the invoice
  sellme auto <agent>    let it answer that agent without asking (add "off" to stop)
  sellme pause | resume  stop or restart everything
  sellme doctor          check the install
  sellme uninstall       remove it (--purge deletes your data too)`;

const AGENT_HELP = `Commands your AI agent uses. You won't need these.

  profile [set <field> <value>] | never-mention <term>
  fact add <text> --source <where> | fact list | fact rm <id>
  agent add <name> [--channel c] [--handle h] | agent list | agent rm <name>
  role add --company c [--title t] [--agent a] [--stage s] | role set <id> --stage s
  reconcile <company>
  note --agent a --text t | notes | ran
  alert [--agent a] --text t | dismiss <id>
  draft --agent a --text t [--asked q] [--kind k] [--source f1,f2] [--company c]
  block --agent a --asked q --reason r [--company c]
  approve <id>... [--confirm-sensitive] | edit <id> --text t
  answer <id> --text t [--confirm-sensitive] | skip <id>
  outbox | sent <id>
  signup | referrals log --agent a --stage s [--company c] [--link l]
  brief [--peek] [--json] and most others take --json`;

const COMMANDS = ["setup", "run", "brief", "review", "status", "referrals", "brag", "hired", "pause", "resume", "doctor", "uninstall", "install", "help", "version", "profile", "never-mention", "fact", "agent", "role", "reconcile", "note", "notes", "alert", "dismiss", "draft", "block", "approve", "edit", "answer", "skip", "outbox", "sent", "ran", "signup", "auto", "clippy"];

function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

function nearest(input, options) {
  const near = options.map((c) => [c, distance(input.toLowerCase(), c)]).filter(([, d]) => d <= 2).sort((x, y) => x[1] - y[1]);
  return near[0]?.[0] ?? null;
}

/** Suggest, but don't run it: a typo can also be a mistake (clig.dev). */
export function didYouMean(input) {
  return nearest(input, COMMANDS.filter((c) => c !== "clippy"));
}

function print(args, jsonValue, text) {
  console.log(args.flags.json ? JSON.stringify(jsonValue, null, 2) : text);
}

function draftSummary(item) {
  if (item.auto) return `${item.id} is auto-approved for ${item.agent}. Send it from the outbox.`;
  if (item.status === "blocked") return `${item.id} blocked: ${item.check.reasons.map((r) => r.message).join(" ")}`;
  const flag = item.sensitive ? ` It needs the user's own yes: ${item.check.reasons.map((r) => r.message).join(" ")}` : "";
  return `${item.id} is waiting for approval.${flag}`;
}

// ---------------------------------------------------------------- install
function cmdInstall(args) {
  const c = view.palette(view.colorLevel({ flag: args.flags["no-color"] }));
  const { installed, foreign, missing } = install({ only: args.flags.host, force: args.flags.force });
  console.log(`\n${view.banner(c)}\n`);
  if (!installed.length && !foreign.length) {
    console.log(`I didn’t find an AI coding tool here. I looked for: ${missing.map((t) => t.name).join(", ")}.`);
    console.log("Install one of them, then run this again.");
    return 1;
  }
  if (installed.length) {
    const names = installed.map((t) => t.name).join(", ");
    console.log(`${c.lime("✓")} ${"Found".padEnd(9)}${c.muted(names)}`);
    console.log(`${c.lime("✓")} ${"Added".padEnd(9)}${c.muted(installed.length === 1 ? "/sellme" : "/sellme to each")}`);
    console.log(`${c.lime("✓")} ${"Skipped".padEnd(9)}${c.muted("signup, password, API key")}`);
  }
  for (const t of foreign) console.log(`${c.red("✗")} ${t.name} already has a different skill called sellme. I left it alone. Use --force to replace it.`);
  if (installed.length) console.log(`\n${c.muted(DISCLOSURE)}\n\nNext: open your AI tool and type ${c.lime("/sellme setup")}`);
  // The screens say "sellme review", which only works in a terminal if the helper is on PATH.
  if (installed.length && !(process.env.PATH ?? "").split(path.delimiter).includes(path.dirname(shimPath()))) {
    console.log(c.muted(`To use it from a terminal too, add this to your shell profile:\n  export PATH="${path.dirname(shimPath())}:$PATH"`));
  }
  return installed.length ? 0 : 1;
}

function cmdDoctor(args) {
  const found = hosts();
  const report = {
    node: process.version,
    home: home(),
    shim: fs.existsSync(shimPath()),
    tools: found.map((t) => ({ id: t.id, found: t.found, skill: installedHosts().some((i) => i.id === t.id) })),
  };
  const s = load();
  report.profile_ready = Boolean(s.profile.name && s.profile.roles.length);
  report.facts = s.facts.length;
  report.agents = s.agents.length;
  report.paused = s.paused;
  const lines = [
    `Node ${report.node}`,
    `Data ${report.home}`,
    `Helper ${report.shim ? "installed" : "missing"}`,
    ...report.tools.map((t) => `${t.skill ? "✓" : "○"} ${t.id}${t.found ? "" : " (not on this machine)"}`),
    `Profile ${report.profile_ready ? "ready" : "not set up"}, ${report.facts} facts, ${report.agents} agents`,
  ];
  print(args, report, lines.join("\n"));
  return 0;
}

// ---------------------------------------------------------------- the gate, for a person at a keyboard
/** One keypress, no enter. Nothing is a default, so a stray enter can't approve anything. */
function readKey(allowed) {
  return new Promise((resolve) => {
    const { stdin } = process;
    stdin.setRawMode(true);
    stdin.resume();
    const onData = (buf) => {
      const key = buf.toString().toLowerCase();
      if (key !== "\u0003" && !allowed.includes(key)) return;
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      resolve(key === "\u0003" ? "q" : key);
    };
    stdin.on("data", onData);
  });
}

async function askLine(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

async function cmdReview() {
  const c = view.palette(view.colorLevel());
  const items = core.openItems(load());
  if (!items.length) {
    console.log(`${c.lime("✓")} Nothing needs you.`);
    return 0;
  }
  if (!process.stdin.isTTY) {
    for (const q of items) console.log(`${q.id}\n${view.card(q, c)}\n`);
    return 0;
  }
  const done = { approved: 0, skipped: 0 };
  const k = (key, word) => `${c.lime(`[${key}]`)} ${word}`;
  for (const [i, q] of items.entries()) {
    console.log(`\n${view.card(q, c, c.muted(`${i + 1} of ${items.length}`))}`);
    const blocked = q.status === "blocked";
    process.stdout.write(`\n${blocked ? `${k("a", "answer yourself")}  ${k("n", "skip")}` : `${k("y", "approve")}  ${k("e", "edit")}  ${k("n", "skip")}`}  ${k("q", "later")} `);
    const key = await readKey(blocked ? "anq" : "yenq");
    console.log(key);
    if (key === "q") break;
    if (key === "n") {
      withState((s) => core.skip(s, q.id));
      audit({ event: "skip", id: q.id, by: "keyboard" });
      done.skipped++;
    } else if (key === "a") {
      const text = await askLine("Your answer: ");
      if (!text) continue;
      try {
        // The person at this keyboard wrote it, having just seen the card.
        withState((s) => core.answerYourself(s, q.id, text, { confirmSensitive: true }));
        audit({ event: "answered", id: q.id, by: "keyboard" });
        done.approved++;
      } catch (err) {
        if (!err.userFacing) throw err;
        console.log(c.red(`✗ ${err.message}`));
      }
    } else if (key === "y") {
      if (q.sensitive && (await askLine("This one is yours alone. Type yes to approve: ")).toLowerCase() !== "yes") continue;
      withState((s) => core.approve(s, q.id, { confirmSensitive: q.sensitive }));
      audit({ event: "approved", id: q.id, by: "keyboard" });
      console.log(`${c.lime("✓")} Approved`);
      done.approved++;
    } else if (key === "e") {
      const text = await askLine("New text: ");
      if (text) console.log(draftSummary(withState((s) => core.editDraft(s, q.id, text))));
    }
  }
  if (done.approved || done.skipped) console.log(`\n${c.lime("→")} ${done.approved} approved, ${done.skipped} skipped.${done.approved ? " Type /sellme in your AI tool to send them." : ""}`);
  return 0;
}

// ---------------------------------------------------------------- dispatch
export async function main(argv) {
  if (argv[0] === "--version" || argv[0] === "-v") return main(["version"]);
  if (argv[0] === "--help" || argv[0] === "-h") return main(["help"]);
  const args = parseArgs(argv);
  if (args.flags.help) return main(["help"]);
  const level = view.colorLevel({ flag: args.flags["no-color"] });
  const [cmd, sub, ...rest] = args._;
  const f = args.flags;
  const c = view.palette(level);

  if (!cmd) {
    if (!runningFromRuntime()) return cmdInstall(args);
    return main(["brief", ...argv]);
  }

  switch (cmd) {
    case "install":
      return cmdInstall(args);
    case "uninstall": {
      const { removed, kept } = uninstall({ purge: f.purge });
      console.log(`Removed from: ${removed.map((t) => t.name).join(", ") || "nothing"}.`);
      if (!f.purge) console.log(`Your data is still in ${home()}. Delete it with: npx sellme uninstall --purge`);
      else if (kept.length) console.log(`Your Sellme data is deleted. I left ${kept.length} other item${kept.length === 1 ? "" : "s"} in ${home()}, since Sellme didn’t create them.`);
      else console.log("Your data is deleted too.");
      return 0;
    }
    case "doctor":
      return cmdDoctor(args);
    case "version":
      console.log(JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
      return 0;
    case "help":
      console.log(sub === "agent" || f.all ? AGENT_HELP : HELP);
      return 0;
    case "setup":
    case "run":
      console.log(`${c.lime("→")} This one runs in your AI tool, not here. Open it and type ${c.lime(cmd === "setup" ? "/sellme setup" : "/sellme")}`);
      return 0;
    case "ran":
      withState((s) => (s.last_run = new Date().toISOString()));
      print(args, { ok: true }, "Noted.");
      return 0;
    case "clippy":
      console.log(view.CLIPPY);
      return 0;

    case "brief": {
      const peek = f.peek || f.json;
      const out = view.brief(load(), c, new Date(), termWidth());
      if (f.json) {
        const s = load();
        print(args, { setup_done: view.setupSteps(s).every((x) => x.done), last_run: s.last_run, alerts: s.alerts, open: core.openItems(s), approved_waiting: core.outbox(s).length, notes: s.notes.filter((n) => !n.seen), counts: core.counts(s), paused: s.paused, hired: s.hired }, "");
      } else console.log(out);
      if (!peek) {
        withState((s) => {
          s.notes.forEach((n) => (n.seen = true));
          s.last_brief = new Date().toISOString();
        });
      }
      return 0;
    }
    case "status": {
      const s = load();
      print(args, { roles: s.roles, agents: s.agents, counts: core.counts(s) }, view.status(s, c, termWidth()));
      return 0;
    }
    case "review":
      if (f.json) {
        print(args, core.openItems(load()), "");
        return 0;
      }
      return cmdReview();

    case "profile": {
      if (sub === "set") {
        const [field, ...value] = rest;
        withState((s) => core.setProfile(s, field, value.join(" ")));
      } else if (sub) throw new UserError(`Unknown: profile ${sub}`);
      const s = load();
      print(args, s.profile, JSON.stringify(s.profile, null, 2));
      return 0;
    }
    case "never-mention":
      withState((s) => core.addNeverMention(s, [sub, ...rest].filter(Boolean).join(" ")));
      print(args, { ok: true }, "Noted. I’ll block any draft that mentions it.");
      return 0;
    case "fact": {
      if (sub === "add") {
        const fact = withState((s) => core.addFact(s, rest.join(" "), f.source));
        print(args, fact, `${fact.id}: ${fact.text}`);
      } else if (sub === "list" || !sub) {
        const { facts } = load();
        print(args, facts, facts.map((x) => `${x.id}  ${x.text}  (${x.source})`).join("\n") || "No facts yet.");
      } else if (sub === "rm") {
        withState((s) => core.removeFact(s, rest[0]));
        print(args, { ok: true }, `Removed ${rest[0]}.`);
      } else throw new UserError(`Unknown: fact ${sub}`);
      return 0;
    }
    case "agent": {
      if (sub === "add") {
        const agent = withState((s) => core.addAgent(s, rest.join(" "), { channel: f.channel, handle: f.handle }));
        print(args, agent, `${agent.name} connected over ${agent.channel}.`);
      } else if (sub === "rm") {
        const { cancelled } = withState((s) => core.removeAgent(s, rest.join(" ")));
        print(args, { ok: true, cancelled }, cancelled ? `Removed, and cancelled ${cancelled} unsent draft${cancelled === 1 ? "" : "s"}.` : "Removed.");
      } else if (sub === "list" || !sub) {
        const { agents } = load();
        print(args, agents, agents.map((a) => `${a.name}  ${a.channel}  ${a.handle ?? ""}`).join("\n") || "No agents yet.");
      } else throw new UserError(`Unknown: agent ${sub}`);
      return 0;
    }
    case "role": {
      if (sub === "add") {
        const role = withState((s) => core.addRole(s, { company: f.company, title: f.title, agent: f.agent, stage: f.stage }));
        print(args, role, `${role.id}: ${role.company} (${role.stage})`);
      } else if (sub === "set") {
        const role = withState((s) => core.setRole(s, rest[0], f.stage));
        print(args, role, `${role.id}: ${role.company} (${role.stage})`);
      } else throw new UserError("Use: role add | role set");
      return 0;
    }
    case "signup": {
      const list = signupList(load().agents);
      print(args, { disclosure: DISCLOSURE, programs: list }, [DISCLOSURE, "", ...list.map((p) => `${p.name}  ${p.url ?? "find its official page"}${p.note ? `  (${p.note})` : ""}`)].join("\n"));
      return 0;
    }
    case "auto": {
      const words = [sub, ...rest].filter(Boolean);
      if (!words.length) {
        const on = load().agents.filter((a) => a.auto).map((a) => a.name);
        print(args, { auto: on }, on.length ? `Auto-approve is on for: ${on.join(", ")}` : "Auto-approve is off for every agent.");
        return 0;
      }
      const last = words[words.length - 1].toLowerCase();
      const on = last !== "off";
      if (last === "off" || last === "on") words.pop();
      const agent = withState((s) => core.setAuto(s, words.join(" "), on));
      audit({ event: "auto", agent: agent.name, value: on });
      print(args, agent, on
        ? `${c.lime("✓")} ${agent.name}: I’ll send sourced answers without asking, up to ${core.AUTO_DAILY_LIMIT} a day.\n  Pay, offers, scheduling and anything the truth check blocks still come to you.\n  Stop any time: sellme auto "${agent.name}" off`
        : `${agent.name}: I’ll ask before every message again.`);
      return 0;
    }
    case "reconcile": {
      const r = core.reconcile(load(), [sub, ...rest].filter(Boolean).join(" "));
      print(args, r, r.safe_to_mention ? `${r.company}: ${r.known ? "in your pipeline" : "not in your pipeline"}.` : `${r.company}: don’t mention it. It’s rejected or passed.`);
      return 0;
    }
    case "note": {
      const note = withState((s) => core.addNote(s, f.agent, f.text));
      print(args, note, `Logged: ${note.text}`);
      return 0;
    }

    case "notes": {
      const notes = load().notes.slice(-30);
      print(args, notes, notes.map((n) => `${new Date(n.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}  ${n.agent}: ${n.text}`).join("\n") || "No notes yet.");
      return 0;
    }
    case "alert": {
      const alert = withState((s) => core.addAlert(s, f.agent, f.text));
      audit({ event: "alert", id: alert.id, agent: alert.agent });
      print(args, alert, `${alert.id} will stay at the top of the screen until it’s dismissed.`);
      return 0;
    }
    case "dismiss":
      if (!sub) throw new UserError("Which alert? Use its id, like a1.");
      withState((s) => core.dismissAlert(s, sub));
      print(args, { ok: true }, `Dismissed ${sub}.`);
      return 0;

    case "draft": {
      const item = withState((s) => core.addDraft(s, { agent: f.agent, text: f.text, asked: f.asked, kind: f.kind, sources: list(f.source), company: f.company, role: f.role }));
      audit({ event: "draft", id: item.id, agent: item.agent, result: item.check.result });
      print(args, item, draftSummary(item));
      return item.status === "blocked" ? 2 : 0;
    }
    case "block": {
      const item = withState((s) => core.addBlock(s, { agent: f.agent, asked: f.asked, reason: f.reason, company: f.company }));
      audit({ event: "block", id: item.id, agent: item.agent });
      print(args, item, draftSummary(item));
      return 0;
    }
    case "approve": {
      const ids = [sub, ...rest].filter(Boolean);
      if (!ids.length) throw new UserError("Which draft? Use: approve <id>");
      for (const id of ids) {
        withState((s) => core.approve(s, id, { confirmSensitive: f["confirm-sensitive"] }));
        audit({ event: "approved", id, by: "agent", sensitive_confirmed: Boolean(f["confirm-sensitive"]) });
      }
      print(args, { approved: ids }, `Approved: ${ids.join(", ")}`);
      return 0;
    }
    case "edit": {
      const item = withState((s) => core.editDraft(s, sub, f.text));
      audit({ event: "edit", id: sub, result: item.check.result });
      print(args, item, draftSummary(item));
      return item.status === "blocked" ? 2 : 0;
    }
    case "answer": {
      const item = withState((s) => core.answerYourself(s, sub, f.text, { confirmSensitive: f["confirm-sensitive"] }));
      audit({ event: "answered", id: sub });
      print(args, item, `${item.id} approved in your own words.`);
      return 0;
    }
    case "skip":
      withState((s) => core.skip(s, sub));
      audit({ event: "skip", id: sub });
      print(args, { ok: true }, `Skipped ${sub}.`);
      return 0;
    case "outbox": {
      const items = core.outbox(load());
      print(args, items, items.map((o) => `${o.id} → ${o.agent} (${o.channel}${o.to ? ` ${o.to}` : ""}): ${o.text}`).join("\n") || "Nothing approved to send.");
      return 0;
    }
    case "sent":
      withState((s) => core.markSent(s, sub));
      audit({ event: "sent", id: sub });
      print(args, { ok: true }, `${sub} marked sent.`);
      return 0;

    case "referrals": {
      if (sub === "on" || sub === "off") {
        throw new UserError(`There’s no setting for this. To change it, edit REFERRALS_ENABLED in ${path.join(PKG_ROOT, "lib", "referrals.js")}`);
      } else if (sub === "log") {
        const entry = withState((s) => core.logReferral(s, { agent: f.agent, stage: f.stage, company: f.company, link: f.link }));
        print(args, entry, `Logged ${entry.stage} for ${entry.agent}.`);
        return 0;
      } else if (sub) throw new UserError("Use: referrals, or referrals log");
      const s = load();
      print(args, { enabled: REFERRALS_ENABLED, disclosure: DISCLOSURE, ledger: s.ledger }, view.referrals(s, c));
      return 0;
    }
    case "brag": {
      const s = load();
      if (!s.profile.name) throw new UserError("Tell me your name first. Run: /sellme setup");
      const card = view.bragCard(s);
      const file = path.join(home(), "brag.svg");
      fs.mkdirSync(home(), { recursive: true });
      fs.writeFileSync(file, card.svg);
      print(args, { file, lines: card.lines }, `${c.lime(c.bold(card.name))}\n${card.lines.join("\n")}\n\n${c.muted(`Card saved: ${file}`)}`);
      return 0;
    }
    case "hired": {
      withState((s) => core.hired(s, f.company ?? ([sub, ...rest].filter(Boolean).join(" ") || null)));
      audit({ event: "hired" });
      console.log(view.invoice(load(), c));
      return 0;
    }
    case "pause":
      withState((s) => (s.paused = true));
      print(args, { paused: true }, "Paused. Nothing goes out.");
      return 0;
    case "resume":
      withState((s) => {
        s.paused = false;
        s.hired = null;
      });
      print(args, { paused: false }, "Back to work.");
      return 0;
    default:
      {
        const guess = didYouMean(cmd);
        throw new UserError(`I don’t know “${cmd}”.${guess ? ` Did you mean: sellme ${guess}` : " Run: sellme help"}`);
      }
  }
}

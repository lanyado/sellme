// Command line front end. The rules live in core.js and truth.js.
import fs from "node:fs";
import path from "node:path";
import * as core from "./core.js";
import * as memory from "./memory.js";
import { DISCLOSURE, REFERRALS_ENABLED, signupList } from "./referrals.js";
import { gateHook } from "./agent.js";
import { runApp, runConnect } from "./app.js";
import { stepsFor } from "./connect.js";
import * as view from "./render.js";
import { PKG_ROOT, hosts, install, installedHosts, runningFromRuntime, shimPath, uninstall } from "./install.js";
import { readImport } from "./picker.js";
import { cleanPath } from "./rewrite.js";
import { sameCompany } from "./truth.js";
import { SCHEDULES, scheduleWarning, scheduledRun, setSchedule } from "./schedule.js";
import { UserError, audit, home, load, withState } from "./store.js";

const BOOLEAN_FLAGS = new Set(["json", "force", "purge", "confirm-sensitive", "peek", "help", "no-color", "all", "person", "bot"]);
const VALUE_FLAGS = new Set(["agent", "asked", "attach", "channel", "company", "context", "limit", "handle", "host", "kind", "lane", "link", "next-call", "reason", "role", "source", "stage", "follow", "start", "suggest", "text", "thread", "title"]);

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

const HELP = `sellme: an AI agent with one goal, getting you hired

Start here
  npx sellme@latest      install
  sellme                 the app: sets you up, checks every agent, shows what needs you
  /sellme                the same from your AI tool, if you're already in it

You never need these, but they're here
  sellme review | agents   open the app on that tab
  sellme status            every role, every agent
  sellme connect [name]    connect everything, one key at a time
  sellme add | remove | import   your own recruiters
  sellme referrals         which link, which agent, who pays
  sellme brag | hired      a share card; stop the agents
  sellme auto <agent>      answer it without asking (add "off" to stop)
  sellme schedule [every]  check on its own: hourly, 4h, daily, weekly, off
  sellme pause | resume    stop or restart everything
  sellme doctor | uninstall   check it; remove it (--purge deletes your data)`;

const AGENT_HELP = `Commands your AI agent uses. You won't need these.

  profile [set <field> <value>] | never-mention <term>   (fields: name, roles, floor, where, resume, resume-link)
  fact add <text> --source <where> | fact list | fact rm <id>
  agent add <name> [--channel c] [--handle h] [--person] | agent list | agent rm <name>
  connect <name> ok|signin|access|connector|skip [--reason r]
  role add --company c [--title t] [--agent a] [--stage s] [--next-call when]
  role set <id> [--stage s] [--next-call when|none] [--agent a]
  role list [--company c]
  handled <id> --reason r        skip an open item the user already dealt with
  reconcile <company>
  note --agent a --text t | notes | ran
  wait <seconds>                 give an agent that answers fast a moment (5 to 90 seconds)
  recall <what> [--agent a]      what was said before, from the memory if one is connected
  memory [connect <folder> | off]   a local memory service for recall
  alert [--agent a] --text t | dismiss <id>
  draft --agent a --text t [--asked q] [--context c] [--kind k] [--source f1,f2] [--company c] [--attach resume] [--thread <LinkedIn thread_id>]
  thread <id> <LinkedIn thread_id>   which conversation a LinkedIn reply goes in
  block --agent a --asked q [--context c] --reason r [--suggest "the reply they'd likely send"] [--company c]
  approve <id>... [--confirm-sensitive] | edit <id> --text t
  answer <id> --text t [--confirm-sensitive] | skip <id>
  outbox | sent <id>
  signup | referrals log --agent a --stage s [--company c] [--link l]
  brief [--peek] [--json] and most others take --json`;

const COMMANDS = ["setup", "run", "brief", "review", "status", "connect", "agents", "add", "remove", "import", "referrals", "brag", "hired", "pause", "resume", "doctor", "uninstall", "install", "help", "version", "profile", "never-mention", "fact", "agent", "role", "reconcile", "note", "notes", "alert", "dismiss", "draft", "block", "approve", "edit", "answer", "skip", "handled", "thread", "outbox", "sent", "ran", "wait", "signup", "auto", "clippy", "schedule", "scheduled-run", "agent-gate", "memory", "recall"];

function nearest(input, options) {
  const near = options.map((c) => [c, core.distance(input.toLowerCase(), c)]).filter(([, d]) => d <= 2).sort((x, y) => x[1] - y[1]);
  return near[0]?.[0] ?? null;
}

/** Suggest, but don't run it: a typo can also be a mistake (clig.dev). */
export function didYouMean(input) {
  return nearest(input, COMMANDS.filter((c) => c !== "clippy"));
}

function print(args, jsonValue, text) {
  console.log(args.flags.json ? JSON.stringify(jsonValue, null, 2) : text);
}

const interactive = (args) => Boolean(process.stdin.isTTY && process.stdout.isTTY && !args.flags.json);

function draftSummary(item) {
  // The same words were already drafted: addDraft hands back that one instead of a second copy.
  if (core.isTwin(item) && item.status === "sent") return `${item.id} already sent these exact words to ${item.agent}, so nothing new was drafted. Don't send it again.`;
  if (core.isTwin(item) && ["approved", "pending", "blocked"].includes(item.status)) return `${item.id} already has these exact words for ${item.agent} (${item.status}). Nothing new was drafted.`;
  if (item.auto) return `${item.id} is sure enough to go by itself (autopilot). Send it from the outbox now.`;
  if (item.status === "blocked") return `${item.id} blocked: ${item.check.reasons.map((r) => r.message).join(" ")}`;
  const flag = item.sensitive ? ` It needs the user's own yes: ${item.check.reasons.map((r) => r.message).join(" ")}` : "";
  return `${item.id} is waiting for approval.${flag}`;
}

// ---------------------------------------------------------------- install
function cmdInstall(args) {
  const c = view.palette(view.colorLevel({ flag: args.flags["no-color"] }));
  const { installed, foreign, missing, command } = install({ only: args.flags.host, force: args.flags.force });
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
  if (installed.length) console.log(`\n${c.muted(DISCLOSURE)}\n\nNext: type ${c.lime("sellme")}. It sets you up right there`);
  // The screens say "sellme review", so plain `sellme` has to work.
  if (installed.length && command?.how === "linked") console.log(`Terminal: type ${c.lime("sellme")} to open the app.`);
  if (installed.length && command?.how === "profile") console.log(`Terminal: open a new terminal and type ${c.lime("sellme")} to open the app. I added Sellme’s folder to your PATH in ${command.where}.`);
  if (installed.length && command?.how === "manual") {
    console.log(c.muted(process.platform === "win32" ? `To use it from a terminal too, add this folder to your Path in Settings > Environment Variables:\n  ${path.dirname(shimPath())}` : `To use it from a terminal too, add this to your shell profile:\n  export PATH="${path.dirname(shimPath())}:$PATH"`));
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
    if (interactive(args)) return runApp(c, { sync: true });
    return main(["brief", ...argv]);
  }

  switch (cmd) {
    case "install":
      return cmdInstall(args);
    case "uninstall": {
      if (load().schedule) setSchedule("off");
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
      // Both work right here: setup asks its questions on this screen, and run checks with the loading screen.
      if (interactive(args)) return runApp(c, cmd === "setup" ? { setup: true } : { forceSync: true });
      console.log(`${c.lime("→")} Open a terminal and type ${c.lime(`sellme ${cmd}`)}, or type ${c.lime(cmd === "setup" ? "/sellme setup" : "/sellme")} in your AI tool.`);
      return 0;
    case "ran":
      // One lane of a check says it got to the end. The check records the time once every lane has.
      if (args.flags.lane) withState((s) => ((s.lane_runs ??= {})[String(args.flags.lane)] = new Date().toISOString()));
      else withState((s) => (s.last_run = new Date().toISOString()));
      print(args, { ok: true }, "Noted.");
      return 0;
    case "wait": {
      // A run waiting for a fast agent's answer. Capped, so a run can't stall itself.
      const secs = Math.min(Math.max(Number(sub) || 30, 5), 90);
      await new Promise((r) => setTimeout(r, secs * 1000));
      print(args, { waited: secs }, `Waited ${secs} seconds. Read the conversation again.`);
      return 0;
    }
    case "memory": {
      // A local memory service that recalls what was said before. Optional: without it nothing changes.
      if (sub === "connect") {
        const dir = path.resolve(rest.join(" ") || ".");
        const done = await memory.connectMemory(load(), dir);
        if (done.failed) throw new UserError(done.failed);
        withState((s) => (s.memory = { dir, connected: new Date().toISOString() }));
        const n = Object.values(done.synced).reduce((t, c) => t + c.new + c.same + c.updated, 0);
        print(args, { ok: true, dir }, `Memory connected: ${n} things from your search are in it, kept on this machine.`);
      } else if (sub === "off") {
        withState((s) => delete s.memory);
        print(args, { ok: true }, `Memory disconnected. Its database stays at ${memory.memoryDb()}.`);
      } else if (!sub) {
        const s = load();
        print(args, s.memory ?? null, s.memory ? `Memory: ${s.memory.dir}\nDatabase: ${memory.memoryDb()}` : "No memory connected. Connect one with: sellme memory connect <folder>");
      } else throw new UserError(`Unknown: memory ${sub}`);
      return 0;
    }
    case "recall": {
      const query = [sub, ...rest].filter(Boolean).join(" ");
      if (!query) throw new UserError("What should it recall? sellme recall \"what I told Ben about my rate\"");
      const s = load();
      if (!memory.connected(s)) throw new UserError("No memory connected, so search email and notes instead.");
      const found = await memory.recall(s, { query, agent: f.agent ?? "sellme", limit: Number(f.limit) || 6 });
      print(args, found, found.map((r) => `${r.when}  ${r.source}  ${r.text}`).join("\n") || "Nothing about that in memory.");
      return 0;
    }
    case "clippy":
      console.log(view.CLIPPY);
      return 0;

    case "brief": {
      const peek = f.peek || f.json;
      withState((s) => core.recheckOpen(s));
      const out = view.brief(load(), c, new Date(), termWidth());
      if (f.json) {
        const s = load();
        print(args, { setup_done: view.setupSteps(s).every((x) => x.done), last_run: s.last_run, connect: core.connectList(s).map((i) => ({ ...i, steps: stepsFor(i) })), alerts: s.alerts, open: core.openItems(s), approved_waiting: core.outbox(s).length, notes: s.notes.filter((n) => !n.seen), counts: core.counts(s), paused: s.paused, hired: s.hired, push: core.pushList(s) }, "");
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
    case "review": {
      if (interactive(args)) return runApp(c, { tab: "Drafts", openFirst: true });
      const items = core.openItems(load());
      if (f.json) print(args, items, "");
      else if (!items.length) console.log(`${c.lime("✓")} Nothing needs you.`);
      else for (const q of items) console.log(`${q.id}\n${view.card(q, c)}\n`);
      return 0;
    }

    case "profile": {
      if (sub === "set") {
        const [field, ...value] = rest;
        let given = value.join(" ");
        if (field === "resume") {
          given = path.resolve(cleanPath(given));
          if (!fs.existsSync(given) || !fs.statSync(given).isFile()) throw new UserError(`There’s no file at ${given}.`);
        }
        withState((s) => core.setProfile(s, field, given));
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
        // A fact the user has since replaced stays on record, out of the way.
        const facts = load().facts.filter((x) => f.all || !x.replaced_by);
        print(args, facts, facts.map((x) => `${x.id}  ${x.text}  (${x.source}${x.replaced_by ? `, replaced by ${x.replaced_by}` : ""})`).join("\n") || "No facts yet.");
      } else if (sub === "rm") {
        withState((s) => core.removeFact(s, rest[0]));
        print(args, { ok: true }, `Removed ${rest[0]}.`);
      } else throw new UserError(`Unknown: fact ${sub}`);
      return 0;
    }
    case "agent": {
      if (sub === "add") {
        const agent = withState((s) => core.addAgent(s, rest.join(" "), { channel: f.channel, handle: f.handle, person: f.person, byRun: Boolean(process.env.SELLME_RUN) }));
        print(args, agent, agent.channel === core.SELF ? `${agent.name} is a person. I’ll draft, and send what you approve${core.personRoute(agent.handle) ? ` by ${core.personRoute(agent.handle)}` : " once I have their email, phone or LinkedIn"}.` : `${agent.name} connected over ${agent.channel}.`);
      } else if (sub === "rm") {
        const { cancelled } = withState((s) => core.removeAgent(s, rest.join(" ")));
        print(args, { ok: true, cancelled }, cancelled ? `Removed, and cancelled ${cancelled} unsent draft${cancelled === 1 ? "" : "s"}.` : "Removed.");
      } else if (sub === "list" || !sub) {
        const { agents } = load();
        print(args, agents, agents.map((a) => `${a.name}  ${a.channel}  ${a.handle ?? ""}`).join("\n") || "No agents yet.");
      } else throw new UserError(`Unknown: agent ${sub}`);
      return 0;
    }
    case "connect": {
      const words = sub ? [sub, ...rest] : [];
      const isState = core.CONNECTION_STATES.includes(words.at(-1));
      if (isState) {
        // The last word is the state, so a name can have spaces without quotes: connect Jack & Jill signin
        const status = words.pop();
        const key = withState((s) => core.setConnection(s, words.join(" "), status, f.reason));
        print(args, { name: key, status }, status === "ok" ? `${key} is connected.` : status === "skip" ? `I won’t ask about ${key} again.` : `Noted: ${key} needs you.`);
        return 0;
      }
      // No state: help connect it. `sellme connect Fonzie` is close enough to Fonzi.
      const all = core.connectList(load());
      const asked = words.join(" ").toLowerCase();
      const items = asked ? all.filter((i) => core.closeName(i.name, asked)) : all;
      if (asked && !items.length) {
        console.log(`${words.join(" ")} doesn’t need anything from you right now. Type sellme connect to see what does.`);
        return 0;
      }
      if (!args.flags.json && interactive(args) && items.length) {
        const last = await runConnect(c, { names: items.map((i) => i.name) });
        const left = core.connectList(load()).filter((i) => i.blocking).length;
        console.log(last ?? "");
        console.log(left ? `${left} still to connect. Type sellme connect to carry on.` : `${c.lime("✓")} Nothing’s blocking. Type sellme to check your agents.`);
        return 0;
      }
      print(args, items.map((i) => ({ ...i, steps: stepsFor(i) })), view.connectScreen(items, c));
      return 0;
    }
    case "agents": {
      // A person at a terminal gets the interactive list. A pipe or an AI tool gets plain text.
      if (interactive(args)) return runApp(c, { tab: "Agents" });
      const r = core.roster(load());
      print(args, r, view.roster(r, c));
      return 0;
    }
    case "add": {
      const agent = withState((s) => core.addRecruiter(s, [sub, ...rest].filter(Boolean).join(" "), { handle: f.handle, channel: f.channel, company: f.company, bot: f.bot, force: f.force, byRun: Boolean(process.env.SELLME_RUN) }));
      audit({ event: "agent_added", agent: agent.name, channel: agent.channel });
      const route = core.personRoute(agent.handle);
      const how = agent.channel === core.SELF ? (route ? `I’ll draft replies, and send the ones you approve by ${route}.` : "I’ll draft replies. Add their email, phone or LinkedIn so I can send them.") : `I’ll work with them over ${agent.channel}.`;
      print(args, agent, `${c.lime("✓")} ${agent.name} is on your list. ${how}`);
      return 0;
    }
    case "remove": {
      const { agent, cancelled } = withState((s) => core.removeAgent(s, [sub, ...rest].filter(Boolean).join(" ")));
      audit({ event: "agent_removed", agent: agent.name, cancelled });
      print(args, { ok: true, cancelled }, `Removed ${agent.name}.${cancelled ? ` Cancelled ${cancelled} unsent draft${cancelled === 1 ? "" : "s"}.` : ""}`);
      return 0;
    }
    case "import": {
      if (!sub) throw new UserError("Which file? Use: sellme import <file.csv or file.vcf>");
      const r = withState((s) => core.importRecruiters(s, readImport([sub, ...rest].join(" "))));
      audit({ event: "agents_imported", added: r.added.length });
      print(args, r, view.importSummary(r, c));
      return 0;
    }
    case "role": {
      if (sub === "add") {
        const role = withState((s) => core.addRole(s, { company: f.company, title: f.title, agent: f.agent, stage: f.stage, nextCall: f["next-call"] }));
        print(args, role, `${role.id}: ${role.company} (${role.stage})`);
      } else if (sub === "set") {
        if (!f.stage && !f["next-call"] && !f.agent) throw new UserError("Use: role set <id> --stage s, --next-call when, or --agent a");
        const role = withState((s) => {
          if (f["next-call"]) core.setNextCall(s, rest[0], f["next-call"]);
          if (f.agent) core.setRoleAgent(s, rest[0], f.agent);
          return f.stage ? core.setRole(s, rest[0], f.stage) : s.roles.find((r) => r.id === rest[0]);
        });
        print(args, role, `${role.id}: ${role.company} (${role.stage})`);
      } else if (sub === "list") {
        // Read only, so a run can find a role's id before it updates it.
        const want = f.company ? (r) => sameCompany(r.company, f.company) : () => true;
        const roles = load().roles.filter(want);
        print(args, roles, roles.length ? roles.map((r) => `${r.id}: ${r.company}${r.title ? `, ${r.title}` : ""} (${r.stage}${r.agent ? `, ${r.agent}` : ""}${r.next_call ? `, next call ${r.next_call}` : ""})`).join("\n") : "No roles match. Add one with: role add --company c");
      } else if (sub === "remove") {
        const role = withState((s) => core.removeRole(s, rest[0]));
        audit({ event: "role_removed", id: role.id });
        print(args, role, `Removed ${role.company} from your pipeline.`);
      } else throw new UserError("Use: role add | role set | role list | role remove");
      return 0;
    }
    case "schedule": {
      if (!sub) {
        if (interactive(args)) return runApp(c, { tab: "Schedule" });
        const { schedule, schedule_last: last } = load();
        const current = SCHEDULES.find((x) => x.id === schedule?.every);
        print(args, { schedule, last }, current ? `Checks run: ${current.label}.` : "No schedule. Set one with: sellme schedule daily");
        return 0;
      }
      const set = setSchedule(sub);
      const warning = set ? scheduleWarning(load()) : null;
      if (warning && !args.flags.json) console.log(`${c.violet("!")} ${warning}`);
      print(args, { every: set?.id ?? "off" }, set ? `${c.lime("✓")} ${set.label}, I’ll talk to your agents, ask for new matches and draft answers. It runs while your computer is awake and uses your AI plan.` : "Scheduled checks are off.");
      return 0;
    }
    case "scheduled-run": {
      const result = await scheduledRun({ start: args.flags.start ? String(args.flags.start) : null, follow: args.flags.follow ? String(args.flags.follow) : null });
      return result.ok === false ? 1 : 0;
    }
    case "agent-gate":
      process.stdout.write(gateHook(fs.readFileSync(0, "utf8")));
      return 0;
    case "signup": {
      const list = signupList(load().agents);
      print(args, { disclosure: DISCLOSURE, programs: list }, [DISCLOSURE, "", ...list.map((p) => `${p.name}  ${p.url ?? "find its official page"}${p.note ? `  (${p.note})` : ""}`)].join("\n"));
      return 0;
    }
    case "auto": {
      const words = [sub, ...rest].filter(Boolean);
      if (!words.length) {
        const s = load();
        const on = s.agents.filter((a) => core.autoOn(s, a)).map((a) => a.name);
        const off = s.agents.filter((a) => !core.autoOn(s, a)).map((a) => a.name);
        print(args, { autopilot: core.autopilotOn(s), auto: on, ask: off }, `Autopilot is ${core.autopilotOn(s) ? "on" : "off"}.${on.length ? `\nI answer by myself: ${on.join(", ")}` : ""}${off.length ? `\nI ask you first: ${off.join(", ")}` : ""}`);
        return 0;
      }
      if (words[0].toLowerCase() === "all" && words.length === 2 && ["on", "off"].includes(words[1].toLowerCase())) {
        const on = words[1].toLowerCase() === "on";
        withState((s) => core.setAutopilot(s, on));
        audit({ event: "autopilot", value: on });
        print(args, { autopilot: on }, on ? `${c.lime("✓")} Autopilot on. I send what I’m sure of by myself, up to ${core.AUTO_DAILY_LIMIT} a day to each. Pay, offers, scheduling, first messages to someone new and anything I can’t back up still come to you.` : "Autopilot off. I’ll ask before every message.");
        return 0;
      }
      const last = words[words.length - 1].toLowerCase();
      const on = last !== "off";
      if (last === "off" || last === "on") words.pop();
      const agent = withState((s) => core.setAuto(s, words.join(" "), on));
      audit({ event: "auto", agent: agent.name, value: on });
      print(args, agent, on
        ? `${c.lime("✓")} ${agent.name}: I’ll send sourced answers without asking, up to ${core.AUTO_DAILY_LIMIT} a day.\n  Pay, offers, scheduling and anything the truth check blocks still come to you.\n  Stop any time: sellme auto "${agent.name}" off`
        : `${agent.name}: I’ll ask before every message to them.`);
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
      if (f.attach !== undefined && f.attach !== "resume") throw new UserError("Only your resume can be attached: --attach resume.");
      const item = withState((s) => core.addDraft(s, { agent: f.agent, text: f.text, asked: f.asked, context: f.context, kind: f.kind, sources: list(f.source), company: f.company, role: f.role, attach: f.attach === "resume", thread: f.thread }));
      audit({ event: "draft", id: item.id, agent: item.agent, result: item.check.result });
      print(args, item, draftSummary(item));
      return item.status === "blocked" ? 2 : 0;
    }
    case "block": {
      const item = withState((s) => core.addBlock(s, { agent: f.agent, asked: f.asked, context: f.context, reason: f.reason, company: f.company, suggest: f.suggest, thread: f.thread }));
      audit({ event: "block", id: item.id, agent: item.agent });
      print(args, item, draftSummary(item));
      return 0;
    }
    case "approve": {
      const ids = [sub, ...rest].filter(Boolean);
      if (!ids.length) throw new UserError("Which draft? Use: approve <id>");
      const items = [];
      for (const id of ids) {
        items.push(withState((s) => core.approve(s, id, { confirmSensitive: f["confirm-sensitive"] })));
        audit({ event: "approved", id, by: "agent", sensitive_confirmed: Boolean(f["confirm-sensitive"]) });
      }
      const yours = items.filter((q) => q.status === "yours");
      print(args, { approved: ids, yours_to_send: yours.map((q) => ({ id: q.id, to: q.to, text: q.approved_text })) }, [`Approved: ${ids.join(", ")}`, ...yours.map(view.handoff)].join("\n"));
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
      print(args, item, item.status === "yours" ? view.handoff(item) : `${item.id} approved in your own words.`);
      return 0;
    }
    case "thread": {
      const item = withState((s) => core.setThread(s, sub, rest[0]));
      audit({ event: "thread", id: item.id });
      const email = core.personRoute(item.to) === "email" || item.channel === "email";
      print(args, item, `${item.id} goes in ${email ? "the email thread of message" : "LinkedIn conversation"} ${item.thread}.`);
      return 0;
    }
    case "handled": {
      const item = withState((s) => core.markHandled(s, sub, f.reason));
      audit({ event: "handled", id: item.id });
      print(args, item, `Skipped ${item.id}: no reply needed. The reason is in Activity.`);
      return 0;
    }
    case "skip":
      withState((s) => core.skip(s, sub));
      audit({ event: "skip", id: sub });
      print(args, { ok: true }, `Skipped ${sub}.`);
      return 0;
    case "outbox": {
      const state = load();
      // One the app is sending right now isn't this run's to send.
      const items = core.outbox(state).filter((o) => !core.claimedElsewhere(state.queue.find((q) => q.id === o.id), process.env.SELLME_RUN));
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
      if (!s.profile.name) throw new UserError("Tell me your name first. Run: sellme setup");
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

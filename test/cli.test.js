// End to end through the real binary, with HOME pointed at a throwaway folder.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const RENDER = await import("../lib/render.js");
const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bin/sellme.js");

function sandbox(tools = [".claude", ".codex"]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sellme-test-"));
  for (const t of tools) fs.mkdirSync(path.join(dir, t), { recursive: true });
  const env = { ...process.env, HOME: dir, NO_COLOR: "1" };
  delete env.SELLME_HOME;
  delete env.CODEX_HOME;
  const run = (...args) => spawnSync("node", [BIN, ...args], { env, encoding: "utf8" });
  const shim = (...args) => spawnSync(path.join(dir, ".sellme", "bin", "sellme"), args, { env, encoding: "utf8" });
  return { dir, run, shim };
}

test("install adds the skill only to tools on this machine", () => {
  const { dir, run } = sandbox();
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Claude Code, Codex/);
  assert.match(r.stdout, /Send a bot back/);
  assert.ok(fs.existsSync(path.join(dir, ".claude/skills/sellme/SKILL.md")));
  assert.ok(fs.existsSync(path.join(dir, ".codex/skills/sellme/references/run.md")));
  assert.ok(!fs.existsSync(path.join(dir, ".cursor")));
});

test("the installed skill points at the real helper, with no placeholder left", () => {
  const { dir, run } = sandbox();
  run();
  const root = path.join(dir, ".claude/skills/sellme");
  for (const f of ["SKILL.md", "references/setup.md", "references/run.md", "references/channels.md", "references/context.md"]) {
    const t = fs.readFileSync(path.join(root, f), "utf8");
    assert.ok(!t.includes("{{SELLME}}"), f);
  }
  assert.ok(fs.readFileSync(path.join(root, "SKILL.md"), "utf8").includes(path.join(dir, ".sellme/bin/sellme")));
  assert.match(fs.readFileSync(path.join(root, "SKILL.md"), "utf8"), /^---\nname: sellme\ndescription: /);
});

test("setup encourages more context, and connected tools can't create facts on their own", () => {
  const { dir, run } = sandbox([".claude"]);
  run();
  const root = path.join(dir, ".claude/skills/sellme");
  assert.match(fs.readFileSync(path.join(root, "references/setup.md"), "utf8"), /Connect your calendar and Wispr Flow/);
  const context = fs.readFileSync(path.join(root, "references/context.md"), "utf8");
  assert.match(context, /nothing from these sources becomes a fact by itself/);
  assert.match(context, /Offer times, never what's on the calendar/);
  const setup = fs.readFileSync(path.join(root, "references/setup.md"), "utf8");
  assert.doesNotMatch(setup, /never sends anything by itself/);
  assert.deepEqual([...setup.matchAll(/^## (\d)\./gm)].map((m) => m[1]), ["1", "2", "3", "4"]);
  assert.match(fs.readFileSync(path.join(root, "SKILL.md"), "utf8"), /references\/context\.md/);
});

test("with no AI tool it says so and installs nothing", () => {
  const { dir, run } = sandbox([]);
  const r = run();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /didn’t find an AI coding tool/);
  assert.ok(!fs.existsSync(path.join(dir, ".sellme")));
});

test("someone else's skill called sellme is left alone", () => {
  const { dir, run } = sandbox([".claude"]);
  const theirs = path.join(dir, ".claude/skills/sellme");
  fs.mkdirSync(theirs, { recursive: true });
  fs.writeFileSync(path.join(theirs, "SKILL.md"), "mine");
  const r = run();
  assert.equal(r.status, 1);
  assert.match(r.stdout, /left it alone/);
  assert.equal(fs.readFileSync(path.join(theirs, "SKILL.md"), "utf8"), "mine");
  assert.equal(run("uninstall").status, 0);
  assert.equal(fs.readFileSync(path.join(theirs, "SKILL.md"), "utf8"), "mine");
});

test("reinstalling keeps the user's data, uninstall removes only what's ours", () => {
  const { dir, run, shim } = sandbox([".claude"]);
  run();
  assert.equal(shim("fact", "add", "Led 6", "--source", "resume").status, 0);
  run();
  assert.match(shim("fact", "list").stdout, /Led 6/);
  fs.mkdirSync(path.join(dir, ".claude/skills/other"), { recursive: true });
  run("uninstall");
  assert.ok(!fs.existsSync(path.join(dir, ".claude/skills/sellme")));
  assert.ok(fs.existsSync(path.join(dir, ".claude/skills/other")));
  assert.ok(fs.existsSync(path.join(dir, ".sellme/state.json")));
  run("uninstall", "--purge");
  assert.ok(!fs.existsSync(path.join(dir, ".sellme")));
});

test("user data is private on disk", () => {
  const { dir, run, shim } = sandbox([".claude"]);
  run();
  shim("profile", "set", "floor", "$180K");
  assert.equal(fs.statSync(path.join(dir, ".sellme")).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(dir, ".sellme/state.json")).mode & 0o777, 0o600);
});

test("a damaged data file is refused, not overwritten", () => {
  const { dir, run, shim } = sandbox([".claude"]);
  run();
  shim("profile", "set", "name", "Maya");
  fs.writeFileSync(path.join(dir, ".sellme/state.json"), "{broken");
  const r = shim("profile", "set", "name", "Other");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Can't read/);
  assert.equal(fs.readFileSync(path.join(dir, ".sellme/state.json"), "utf8"), "{broken");
});

test("the deck's whole flow works from setup to invoice", () => {
  const { dir, run, shim } = sandbox([".claude"]);
  run();
  shim("profile", "set", "name", "Maya");
  shim("profile", "set", "roles", "Staff Engineer, Head of AI");
  shim("profile", "set", "floor", "$180K");
  shim("profile", "set", "where", "NYC or remote");
  shim("fact", "add", "Led a team of 6 engineers", "--source", "resume.pdf");
  shim("agent", "add", "Fonzi");
  shim("agent", "add", "Standout", "--handle", "+15550100");
  shim("agent", "add", "Boardy", "--handle", "bot@example.com");
  shim("role", "add", "--company", "Northwind", "--title", "Staff Engineer", "--agent", "Fonzi");
  shim("note", "--agent", "Fonzi", "--text", "New match: Northwind, Staff Engineer");

  const good = shim("draft", "--agent", "Standout", "--asked", "Can you work from NYC?", "--text", "Yes. NYC or remote.", "--source", "profile.where");
  assert.equal(good.status, 0, good.stderr);
  const lie = shim("draft", "--agent", "Fonzi", "--asked", "Have you managed a team of 20?", "--text", "Yes, a team of 20.", "--source", "f1");
  assert.equal(lie.status, 2);
  assert.match(lie.stdout, /won’t round up/);
  const honest = shim("draft", "--agent", "Boardy", "--asked", "Am I speaking with Maya?", "--text", "No. I’m Maya’s AI agent. Maya is human and approves every message.", "--kind", "disclosure");
  assert.equal(honest.status, 0, honest.stderr);

  const screen = shim();
  assert.match(screen.stdout, /3 things need you/);
  assert.match(screen.stdout, /WHILE YOU SLEPT|SINCE YOU LAST LOOKED/);
  assert.match(screen.stdout, /New match: Northwind/);
  assert.doesNotMatch(screen.stdout, /\x1b\[/, "no color codes when NO_COLOR is set");
  assert.doesNotMatch(shim().stdout, /WHILE YOU SLEPT|SINCE YOU LAST LOOKED/, "notes show once");

  assert.equal(shim("approve", "q2").status, 1, "a blocked draft can't be approved");
  assert.equal(shim("sent", "q1").status, 1, "an unapproved draft can't be sent");
  assert.equal(shim("approve", "q1").status, 0);
  const out = JSON.parse(shim("outbox", "--json").stdout);
  assert.deepEqual(out.map((o) => [o.id, o.to]), [["q1", "+15550100"]]);
  assert.equal(shim("sent", "q1").status, 0);
  assert.equal(shim("answer", "q2", "--text", "I managed 6.").status, 0);

  assert.match(shim("status").stdout, /Northwind/);
  assert.match(shim("referrals").stdout, /Referral links: on/);
  const brag = shim("brag");
  assert.match(brag.stdout, /Maya/);
  assert.match(fs.readFileSync(path.join(dir, ".sellme/brag.svg"), "utf8"), /<svg[\s\S]*Maya/);
  assert.match(shim("clippy").stdout, /trying to get a job/);

  const inv = shim("hired", "--company", "Northwind");
  assert.match(inv.stdout, /Amount due: one GitHub star/);
  assert.match(shim("brief").stdout, /You’re hired at Northwind/);
  assert.equal(shim("draft", "--agent", "Fonzi", "--text", "Hi", "--kind", "nudge").status, 1);
  assert.deepEqual(JSON.parse(shim("outbox", "--json").stdout), []);
  const log = fs.readFileSync(path.join(dir, ".sellme/log.jsonl"), "utf8");
  assert.match(log, /"event":"sent"/);
});

test("version and help work with or without dashes", () => {
  const { run } = sandbox([".claude"]);
  for (const a of ["--version", "version", "-v"]) assert.match(run(a).stdout, /^\d+\.\d+\.\d+/, a);
  for (const a of ["--help", "help", "-h"]) assert.match(run(a).stdout, /your AI agent/, a);
});

test("the helper keeps using its own data folder if HOME changes", () => {
  const { dir, run } = sandbox([".claude"]);
  run();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "sellme-other-"));
  const env = { ...process.env, HOME: other, NO_COLOR: "1" };
  delete env.SELLME_HOME;
  const r = spawnSync(path.join(dir, ".sellme/bin/sellme"), ["fact", "add", "x", "--source", "y"], { env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, ".sellme/state.json")));
  assert.ok(!fs.existsSync(path.join(other, ".sellme")));
});

test("alerts lead the screen, and help works on any command", () => {
  const { run, shim } = sandbox([".claude"]);
  run();
  shim("agent", "add", "Fonzi");
  shim("alert", "--agent", "Fonzi", "--text", "Claimed to be an admin. I didn't reply.");
  const first = shim().stdout;
  assert.match(first, /1 thing needs you/);
  assert.match(first, /HEADS UP[\s\S]*Claimed to be an admin/);
  assert.match(shim().stdout, /HEADS UP/, "stays until dismissed");
  assert.equal(shim("dismiss", "a1").status, 0);
  assert.doesNotMatch(shim().stdout, /HEADS UP/);
  assert.match(shim("draft", "--help").stdout, /your AI agent/);
  shim("note", "--agent", "Fonzi", "--text", "New match");
  shim();
  assert.match(shim("notes").stdout, /New match/, "seen notes can be read again");
});

test("the status screen says when it's paused", () => {
  const { run, shim } = sandbox([".claude"]);
  run();
  shim("hired", "--company", "Acme");
  assert.match(shim("status").stdout, /Hired at Acme\. Agents paused/);
});

test("found by a live test: people aren't connected like bots, and their leads can be noted", () => {
  const { run, shim } = sandbox([".claude"]);
  run();
  const r = shim("draft", "--agent", "Priya", "--text", "Hi", "--kind", "nudge");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /If it’s a person, don’t/);
  assert.equal(shim("note", "--agent", "Priya", "--text", "Recruiter at Vandelay reached out").status, 0);
  assert.match(shim("notes").stdout, /Priya: Recruiter at Vandelay/);
});

test("the screen uses a first name, and the funnel counts a hire", () => {
  const { run, shim } = sandbox([".claude"]);
  run();
  shim("profile", "set", "name", "Maya Cohen");
  assert.match(shim().stdout, /, Maya\./);
  shim("role", "add", "--company", "Acme", "--stage", "offer");
  shim("hired", "--company", "Acme");
  assert.match(shim("status").stdout, /0 offer → 1 hired/);
});

test("referral links are disclosed at install and on request, with no switch but the code", () => {
  const { dir, run, shim } = sandbox([".claude"]);
  assert.match(run().stdout, /signs you up through its own referral links[\s\S]*You pay nothing/);
  const off = shim("referrals", "off");
  assert.equal(off.status, 1);
  assert.match(off.stderr, /edit REFERRALS_ENABLED in .*lib\/referrals\.js/);
  assert.match(shim("referrals").stdout, /Referral links: on[\s\S]*You pay nothing[\s\S]*edit lib\/referrals\.js/);
  const file = path.join(dir, ".sellme/runtime/lib/referrals.js");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("REFERRALS_ENABLED = true", "REFERRALS_ENABLED = false"));
  assert.match(shim("referrals").stdout, /Referral links: off/);
});

test("signup lists what isn't connected yet", () => {
  const { run, shim } = sandbox([".claude"]);
  run();
  assert.equal(JSON.parse(shim("signup", "--json").stdout).programs.length, 5);
  shim("agent", "add", "Fonzi");
  const out = JSON.parse(shim("signup", "--json").stdout);
  assert.equal(out.programs.length, 4);
  assert.ok(!out.programs.some((p) => p.name === "Fonzi"));
  assert.match(out.disclosure, /referral links/);
});

test("auto-approve through the real command", () => {
  const { dir, run, shim } = sandbox([".claude"]);
  run();
  shim("agent", "add", "Jack & Jill");
  shim("profile", "set", "where", "NYC");
  assert.match(shim("auto").stdout, /off for every agent/);
  assert.match(shim("auto", "Jack", "&", "Jill").stdout, /without asking, up to 10 a day/);
  assert.match(shim("auto").stdout, /on for: Jack & Jill/);
  assert.match(shim("status").stdout, /Jack & Jill.*auto/);
  const d = shim("draft", "--agent", "Jack & Jill", "--asked", "NYC?", "--text", "Yes.", "--source", "profile.where");
  assert.match(d.stdout, /auto-approved/);
  assert.equal(JSON.parse(shim("outbox", "--json").stdout).length, 1);
  assert.equal(shim("sent", "q1").status, 0);
  assert.match(shim().stdout, /Sent for you: “Yes\.”/);
  shim("auto", "Jack", "&", "Jill", "off");
  assert.match(shim("draft", "--agent", "Jack & Jill", "--asked", "NYC?", "--text", "Yes.", "--source", "profile.where").stdout, /waiting for approval/);
  assert.match(fs.readFileSync(path.join(dir, ".sellme/log.jsonl"), "utf8"), /"event":"auto"/);
  assert.equal(shim("auto", "Nobody").status, 1);
});

test("a typo gets a suggestion, and doesn't run anything", () => {
  const { run, shim } = sandbox([".claude"]);
  run();
  const r = shim("reveiw");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /✗ I don’t know “reveiw”\. Did you mean: sellme review/);
  assert.match(shim("xyzzy").stderr, /Run: sellme help/);
  assert.equal(shim("aprove", "q1").status, 1);
});

test("help stays short and hides the agent's commands", () => {
  const { run } = sandbox([".claude"]);
  const help = run("help").stdout;
  assert.ok(help.split("\n").length <= 20, "short enough to read");
  assert.doesNotMatch(help, /--confirm-sensitive/);
  assert.match(run("help", "agent").stdout, /--confirm-sensitive/);
});

test("setup and run point to the AI tool", () => {
  const { run } = sandbox([".claude"]);
  assert.match(run("setup").stdout, /\/sellme setup/);
  assert.match(run("run").stdout, /AI tool/);
});

test("an unconfigured screen says exactly what's left", () => {
  const { run, shim } = sandbox([".claude"]);
  run();
  const first = shim().stdout;
  assert.match(first, /SETUP {2}0 of 3/);
  assert.match(first, /→ Type \/sellme setup/);
  shim("fact", "add", "x", "--source", "y");
  assert.match(shim().stdout, /SETUP {2}1 of 3/);
});

test("every screen ends with the next step", () => {
  const { run, shim } = sandbox([".claude"]);
  run();
  for (const [a, b] of [["name", "Maya"], ["roles", "Eng"], ["floor", "$1"], ["where", "NYC"]]) shim("profile", "set", a, b);
  shim("fact", "add", "x", "--source", "y");
  shim("agent", "add", "Fonzi");
  assert.match(shim().stdout, /→ You’re all caught up\n?$/);
  shim("draft", "--agent", "Fonzi", "--asked", "NYC?", "--text", "Yes.", "--source", "profile.where");
  assert.match(shim().stdout, /→ \/sellme goes through them with you\n?$/);
  shim("approve", "q1");
  assert.match(shim().stdout, /→ Type \/sellme to send 1 approved/);
});

test("the screen keeps full text when an AI tool reads it, and records runs", () => {
  const { run, shim } = sandbox([".claude"]);
  run();
  shim("agent", "add", "Fonzi");
  const long = "x".repeat(150);
  shim("note", "--agent", "Fonzi", "--text", long);
  assert.ok(shim("brief", "--peek").stdout.includes(long));
  assert.equal(JSON.parse(shim("brief", "--json").stdout).last_run, null);
  shim("ran");
  assert.ok(JSON.parse(shim("brief", "--json").stdout).last_run);
  assert.match(shim("brief").stdout, /checked agents/);
});

test("status groups by stage with the funnel on top", () => {
  const { run, shim } = sandbox([".claude"]);
  run();
  shim("role", "add", "--company", "Newco");
  shim("role", "add", "--company", "Hotco", "--stage", "interview");
  shim("role", "add", "--company", "Deadco", "--stage", "rejected");
  const out = shim("status").stdout;
  assert.match(out, /2 live roles across 0 agents/);
  assert.match(out, /1 new → 0 talking → 1 interview → 0 offer/);
  assert.ok(out.indexOf("Hotco") < out.indexOf("Newco") && out.indexOf("Newco") < out.indexOf("Deadco"));
});

test("color respects the terminal", () => {
  const { colorLevel } = RENDER;
  assert.equal(colorLevel({ isTTY: false, env: {} }), null);
  assert.equal(colorLevel({ isTTY: true, env: { NO_COLOR: "1" } }), null);
  assert.equal(colorLevel({ isTTY: true, env: { TERM: "dumb" } }), null);
  assert.equal(colorLevel({ isTTY: true, env: {}, flag: true }), null);
  assert.equal(colorLevel({ isTTY: true, env: {} }), "256");
  assert.equal(colorLevel({ isTTY: true, env: { COLORTERM: "truecolor" } }), "truecolor");
});

test("the brag card escapes a name instead of breaking", () => {
  const { dir, run, shim } = sandbox([".claude"]);
  run();
  shim("profile", "set", "name", 'A & <B> "C"');
  assert.equal(shim("brag").status, 0);
  assert.match(fs.readFileSync(path.join(dir, ".sellme/brag.svg"), "utf8"), /A &amp; &lt;B&gt; &quot;C&quot;/);
});

test("non-interactive review only lists, it never approves", () => {
  const { run, shim } = sandbox([".claude"]);
  run();
  shim("agent", "add", "Fonzi");
  shim("profile", "set", "where", "NYC");
  shim("draft", "--agent", "Fonzi", "--asked", "NYC?", "--text", "Yes.", "--source", "profile.where");
  assert.match(shim("review").stdout, /They asked/);
  assert.equal(JSON.parse(shim("review", "--json").stdout)[0].status, "pending");
});

test("found in review: --flag=value works the same as --flag value", () => {
  const { run, shim } = sandbox([".claude"]);
  run();
  shim("agent", "add", "Fonzi");
  const r = shim("note", "--agent=Fonzi", "--text=New match: a=b");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /New match: a=b/);
});

test("found in review: a misspelled flag is an error with a suggestion, not silence", () => {
  const { run, shim } = sandbox([".claude"]);
  run();
  const r = shim("fact", "add", "Led 6", "--sorce", "resume");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /I don’t know --sorce\. Did you mean --source\?/);
});

test("found in review: terminal escape codes and bidi marks from a recruiter never reach the screen", () => {
  const { dir, run, shim } = sandbox([".claude"]);
  run();
  shim("agent", "add", "Fonzi");
  shim("note", "--agent", "Fonzi", "--text", "Hello\x1b[2J\x1b]0;owned\x07 there‮!");
  const state = JSON.parse(fs.readFileSync(path.join(dir, ".sellme/state.json"), "utf8"));
  assert.equal(state.notes[0].text, "Hello[2J]0;owned there!");
  shim("alert", "--text", "line one\nline two");
  assert.match(shim("brief").stdout, /line one\nline two/);
});

test("found in review: purge deletes only Sellme's files, wherever SELLME_HOME points", () => {
  const { dir } = sandbox([".claude"]);
  const shared = path.join(dir, "shared");
  fs.mkdirSync(shared);
  fs.writeFileSync(path.join(shared, "thesis.txt"), "mine");
  const env = { ...process.env, HOME: dir, NO_COLOR: "1", SELLME_HOME: shared };
  const run = (...args) => spawnSync("node", [BIN, ...args], { env, encoding: "utf8" });
  run("install");
  run("fact", "add", "Led 6", "--source", "resume");
  assert.ok(fs.existsSync(path.join(shared, "state.json")));
  const r = run("uninstall", "--purge");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /left 1 other item/);
  assert.deepEqual(fs.readdirSync(shared), ["thesis.txt"]);
});

test("found in review: the skill and helper work from a home folder with a space in it", () => {
  const { dir } = sandbox([]);
  const spaced = path.join(dir, "First Last");
  fs.mkdirSync(path.join(spaced, ".claude"), { recursive: true });
  const env = { ...process.env, HOME: spaced, NO_COLOR: "1" };
  delete env.SELLME_HOME;
  delete env.CODEX_HOME;
  assert.equal(spawnSync("node", [BIN], { env, encoding: "utf8" }).status, 0);
  const skill = fs.readFileSync(path.join(spaced, ".claude/skills/sellme/SKILL.md"), "utf8");
  const helper = path.join(spaced, ".sellme/bin/sellme");
  assert.ok(skill.includes(`"${helper}" brief --json --peek`));
  const r = spawnSync("sh", ["-c", `"${helper}" version`], { env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("found in review: the helper finds Node even when the AI tool's PATH doesn't have it", () => {
  const { dir, run } = sandbox([".claude"]);
  run();
  const r = spawnSync(path.join(dir, ".sellme/bin/sellme"), ["version"], { env: { HOME: dir, PATH: "/usr/bin:/bin" }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("install says how to reach the helper from a terminal", () => {
  const { run } = sandbox([".claude"]);
  assert.match(run().stdout, /export PATH=".*\.sellme\/bin:\$PATH"/);
});

test("found in review: a state file that isn't an object is never overwritten", () => {
  const { dir, run, shim } = sandbox([".claude"]);
  run();
  const file = path.join(dir, ".sellme/state.json");
  for (const bad of ["null", "[1,2]", "{oops"]) {
    fs.writeFileSync(file, bad);
    const r = shim("fact", "add", "Led 6", "--source", "resume");
    assert.equal(r.status, 1, bad);
    assert.match(r.stderr, /Can't read/);
    assert.equal(fs.readFileSync(file, "utf8"), bad);
  }
});

test("found in review: data from a newer Sellme is left alone", () => {
  const { dir, run, shim } = sandbox([".claude"]);
  run();
  const file = path.join(dir, ".sellme/state.json");
  const newer = JSON.stringify({ version: 99, facts: [] });
  fs.writeFileSync(file, newer);
  const r = shim("fact", "add", "Led 6", "--source", "resume");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /newer Sellme/);
  assert.equal(fs.readFileSync(file, "utf8"), newer);
});

test("simultaneous writes don't lose data", async () => {
  const { dir, run } = sandbox([".claude"]);
  run();
  const { spawn } = await import("node:child_process");
  const env = { ...process.env, HOME: dir, NO_COLOR: "1" };
  delete env.SELLME_HOME;
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      new Promise((resolve) => spawn("node", [BIN, "fact", "add", `Fact ${i}`, "--source", "test"], { env }).on("close", resolve)),
    ),
  );
  const state = JSON.parse(fs.readFileSync(path.join(dir, ".sellme/state.json"), "utf8"));
  assert.equal(state.facts.length, 12);
  assert.equal(new Set(state.facts.map((f) => f.id)).size, 12);
});

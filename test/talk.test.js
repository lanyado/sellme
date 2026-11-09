import assert from "node:assert/strict";
import { test } from "node:test";
import * as core from "../lib/core.js";
import { TABS, footerLine } from "../lib/app.js";
import { needsLookup, onRecord, parseTalk, saveChat, talkPrompt, talkTurn } from "../lib/talk.js";
import { freshState } from "../lib/store.js";

function search() {
  const s = { ...freshState(), autopilot: false };
  s.profile = { name: "Maya", roles: ["FDE"], where: "NYC", floor: "$987K", never_mention: [] };
  core.addFact(s, "Led a team of 6", "resume");
  core.addAgent(s, "Dex", { channel: "mcp" });
  const r = core.addRole(s, { company: "Northwind", title: "FDE", stage: "interview", nextCall: "2030-01-07T15:00:00Z" });
  core.addRole(s, { company: "Quietco" });
  core.addRole(s, { company: "Gone", stage: "rejected" });
  s.notes.push({ id: "n1", agent: "Dex", text: "Northwind moved you to the panel", ts: "2026-11-08T10:00:00Z" });
  s.notes.push({ id: "n2", agent: "Dex", text: "The base tops out at your $987K floor", ts: "2026-11-08T11:00:00Z" });
  return { s, r };
}

test("the chat is given what's on record for the name asked about, and only the shape of the rest", () => {
  const { s } = search();
  core.addDraft(s, { agent: "Dex", asked: "Team?", text: "Maya led a team of 6.", sources: ["f1"] });
  const prompt = talkPrompt(s, [{ who: "you", text: "what is the status with Northwind?" }]);
  assert.match(prompt, /f1: Led a team of 6/);
  assert.match(prompt, /On record[^]*- Northwind, FDE: interview, next call/);
  assert.match(prompt, /moved you to the panel/, "that company's notes are on record");
  assert.match(prompt, /1 interviews, 0 talking, 1 new matches, 1 closed/);
  assert.match(prompt, /1 drafts waiting/);
  assert.doesNotMatch(prompt, /Quietco/, "no list of other roles to recite");
  assert.doesNotMatch(prompt, /987K/);
  assert.match(prompt, /Never list their other processes/);
  assert.match(prompt, /Never guess a status/);
  assert.match(prompt, /can't send or change anything/);
  assert.doesNotMatch(prompt, /Look it up before you answer/, "the plain tool isn't told to search");
  const looked = talkPrompt(s, [{ who: "you", text: "what is the status with HP?" }], { research: true });
  assert.match(looked, /nothing found under that name/, "no HP on record says so, instead of letting it guess");
  assert.match(looked, /Hewlett Packard/);
  assert.match(looked, /Not being in the pipeline isn't an answer/);
  assert.match(looked, /Never send, post, book or change anything/);
});

test("names are found whole and short ones too, and filler words match nothing", () => {
  const { s } = search();
  core.addRole(s, { company: "HP Inc", stage: "interview" });
  core.addRole(s, { company: "Status Quo Labs", stage: "talking" });
  s.notes.push({ id: "n9", agent: "Email", text: "HP booked your panel for Thursday", ts: "2026-11-08T12:00:00Z" });
  s.notes.push({ id: "n8", agent: "Email", text: "Chp reached out", ts: "2026-11-08T12:00:00Z" });
  const lines = onRecord(s, "what is the status with HP?");
  assert.ok(lines.some((l) => /HP Inc: interview/.test(l)));
  assert.ok(lines.some((l) => /HP booked your panel/.test(l)));
  assert.ok(!lines.some((l) => /Status Quo|Chp/.test(l)), "'status' is filler, and HP isn't inside another word");
  assert.deepEqual(onRecord(s, "what should I do today?"), []);
});

test("an answer comes back with what to remember, and the chat is kept for next time", async () => {
  const { s } = search();
  const out = await talkTurn(s, [], { tool: { id: "claude" }, run: async () => '{"say": "Prep for Northwind.\\\\nThen nudge Dex.", "remember": ["Prefers remote Fridays"]}' });
  assert.deepEqual(out, { say: "Prep for Northwind.\nThen nudge Dex.", remember: ["Prefers remote Fridays"] });
  assert.match(parseTalk("nope").refused, /form I could read/);
  assert.match((await talkTurn(s, [], { tool: null })).failed, /No AI tool/);
  const history = Array.from({ length: 50 }, (_, i) => ({ who: i % 2 ? "sellme" : "you", text: `m${i}` }));
  saveChat(s, [...history, { who: "sellme", text: "Stopped.", note: true }]);
  assert.equal(s.chat.length, 40);
  assert.equal(s.chat.at(-1).text, "m49", "notes to the user aren't kept");
});

test("Chat is a tab right after Drafts", () => {
  assert.deepEqual(TABS.slice(0, 2), ["Drafts", "Chat"]);
  assert.ok(footerLine("Drafts", 100).length < 100);
});

test("what's on record answers at once, and a real look-up happens only when nothing is on record or the user asks", () => {
  const { s } = search();
  assert.equal(needsLookup(s, "what is the status with Northwind?"), false);
  assert.equal(needsLookup(s, "what is the status with HP?"), true, "nothing on record");
  assert.equal(needsLookup(s, "look deeper at Northwind"), true);
  assert.equal(needsLookup(s, "did Northwind email me?"), true);
  assert.match(talkPrompt(s, [{ who: "you", text: "status with Northwind?" }]), /say "look deeper"/);
  assert.doesNotMatch(talkPrompt(s, [{ who: "you", text: "status with Northwind?" }], { research: true }), /say "look deeper"/);
  const looked = talkPrompt(s, [{ who: "you", text: "status with HP?" }], { research: true });
  assert.match(looked, /search every source at once, in parallel/);
  assert.match(looked, /Never open a browser/);
});

test("a look-up is quick and quiet: a fast model, only read tools, no Chrome, and a time limit", async () => {
  const { LOOKUP, LOOKUP_TIMEOUT_MS, agentArgs, researchTalk, researchPrep } = await import("../lib/agent.js");
  const { s } = search();
  let seen;
  await researchTalk(s, [{ who: "you", text: "status with HP?" }], { runner: async (_, opts) => ((seen = opts), { ok: true, output: '{"say":"HP said no."}' }) });
  assert.equal(seen.fast, LOOKUP);
  assert.equal(seen.timeout, LOOKUP_TIMEOUT_MS);
  assert.ok(seen.timeout <= 2 * 60_000);
  const mcp = LOOKUP.tools.filter((t) => t.startsWith("mcp__"));
  assert.ok(mcp.length >= 10);
  for (const tool of LOOKUP.tools) {
    const name = tool.split("__").at(-1);
    assert.doesNotMatch(tool, /send|reply|create|update|delete|draft|label|trash|forward|chrome/i, `${tool} only reads`);
    assert.match(name, /^(tool_|[a-z]+-)?(get|list|search|fuzzy|fetch|Web)/i, `${name} is a read`);
  }
  const args = agentArgs("x", { settings: "s.json", persona: "p.md", fast: LOOKUP });
  assert.deepEqual([args[args.indexOf("--model") + 1], args[args.indexOf("--tools") + 1]], ["sonnet", "WebSearch,WebFetch"]);
  assert.ok(!args.includes("--chrome"), "a look-up never starts the browser");
  assert.ok(args[args.indexOf("--allowedTools") + 1].includes("mcp__claude_ai_Gmail__search_threads"), "Gmail can be searched");
  let prepSeen;
  await researchPrep(s, s.roles[0], [], { runner: async (_, opts) => ((prepSeen = opts), { ok: true, output: '{"say":"Brief"}' }) });
  assert.equal(prepSeen.chrome, false, "prep's look-ups don't open the browser either");
});

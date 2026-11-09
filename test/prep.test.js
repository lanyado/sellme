import assert from "node:assert/strict";
import { test } from "node:test";
import * as core from "../lib/core.js";
import { parsePrep, prepPrompt, prepTurn, preppable, roleThread, savedBrief } from "../lib/prep.js";
import { freshState } from "../lib/store.js";

const TOOL = { id: "claude", name: "Claude Code", args: [] };

function search() {
  const s = { ...freshState(), autopilot: false };
  s.profile = { name: "Maya", roles: ["Forward Deployed Engineer"], where: "NYC", floor: "$987K base", never_mention: [] };
  core.addFact(s, "Led a team of 6", "resume");
  core.addAgent(s, "Meg", { channel: "self", handle: "meg@acme.example" });
  const q = core.addDraft(s, { agent: "Meg", asked: "Can you send your resume before our Monday chat?", text: "Of course, here it is.", sources: ["f1"], company: "Acme" });
  q.status = "sent";
  q.sent_at = "2026-11-06T16:20:00.000Z";
  s.notes.push({ id: "n1", agent: "Meg", text: "Acme call booked with Meg, Mon 2 PM", ts: "2026-11-06T16:00:00.000Z" });
  s.notes.push({ id: "n2", agent: "Fonzi", text: "Globex wants a take-home", ts: "2026-11-06T17:00:00.000Z" });
  const role = core.addRole(s, { company: "Acme", title: "FDE", agent: "Meg", stage: "talking", nextCall: "2030-01-01T19:00:00Z" });
  return { s, role };
}

test("prep is offered when a call is coming or the role is at interview or offer, never once it's closed", () => {
  const today = new Date("2026-11-08");
  assert.equal(preppable({ stage: "talking", next_call: "2030-01-01T10:00:00Z" }, today), true);
  assert.equal(preppable({ stage: "interview", next_call: null }, today), true);
  assert.equal(preppable({ stage: "talking", next_call: "2026-01-01T10:00:00Z" }, today), false);
  assert.equal(preppable({ stage: "rejected", next_call: "2030-01-01T10:00:00Z" }, today), false);
});

test("the brief knows this role's thread and the user's facts, and never the floor", () => {
  const { s, role } = search();
  const thread = roleThread(s, role);
  assert.ok(thread.some((l) => l.includes("Meg wrote: Can you send your resume")));
  assert.ok(thread.some((l) => l.includes("You sent Meg: Of course")));
  assert.ok(thread.some((l) => l.includes("Acme call booked")));
  assert.ok(!thread.some((l) => l.includes("Globex")), "another company's notes stay out");
  const prompt = prepPrompt(s, role, [], { recalled: [{ source: "notes", id: "n9", text: "Acme: Meg is the recruiter", when: "2026-11-05" }] });
  assert.match(prompt, /Write the brief/);
  assert.match(prompt, /f1: Led a team of 6/);
  assert.match(prompt, /Acme: Meg is the recruiter/);
  assert.doesNotMatch(prompt, /987/);
  assert.doesNotMatch(prompt, /look things up/, "the plain tool isn't told to search");
  assert.match(prepPrompt(s, role, [], { research: true }), /Never send, post, book or change anything/);
  const asking = prepPrompt(s, role, [{ who: "sellme", text: "Brief" }, { who: "you", text: "What do they build?" }]);
  assert.match(asking, /Answer their latest question/);
  assert.match(asking, /User: What do they build\?/);
});

test("a brief is kept for its call, and a new call needs a new one", async () => {
  const { s, role } = search();
  const result = await prepTurn(s, role, [], { tool: TOOL, run: async () => '{"say": "Who: Meg\\nWhen: Mon 2 PM"}' });
  assert.equal(result.say, "Who: Meg\nWhen: Mon 2 PM");
  core.savePrep(s, role.id, result.say);
  assert.equal(savedBrief(role), "Who: Meg\nWhen: Mon 2 PM");
  core.setNextCall(s, role.id, "2030-02-01T19:00:00Z");
  assert.equal(savedBrief(role), null);
  assert.match(parsePrep("not json").refused, /form I could read/);
  assert.equal(parsePrep(JSON.stringify({ say: "One\\nTwo" })).say, "One\nTwo");
  assert.match((await prepTurn(s, role, [], { tool: null })).failed, /No AI tool/);
});

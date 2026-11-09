import assert from "node:assert/strict";
import { test } from "node:test";
import * as core from "../lib/core.js";
import { TABS, footerLine } from "../lib/app.js";
import { parseTalk, saveChat, talkPrompt, talkTurn } from "../lib/talk.js";
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

test("the chat knows the search: facts, the pipeline, what's waiting and what happened, and never the floor", () => {
  const { s } = search();
  core.addDraft(s, { agent: "Dex", asked: "Team?", text: "Maya led a team of 6.", sources: ["f1"] });
  const prompt = talkPrompt(s, [{ who: "you", text: "What should I focus on today?" }]);
  assert.match(prompt, /f1: Led a team of 6/);
  assert.match(prompt, /Northwind, FDE: interview, next call/);
  assert.match(prompt, /and 1 new matches/);
  assert.match(prompt, /1 closed/);
  assert.match(prompt, /Waiting on them in Drafts: Dex/);
  assert.match(prompt, /moved you to the panel/);
  assert.doesNotMatch(prompt, /987/);
  assert.match(prompt, /User: What should I focus on today\?/);
  assert.match(prompt, /can't send or change anything/);
  assert.doesNotMatch(prompt, /look things up/i);
  assert.match(talkPrompt(s, [], { research: true }), /Never send, post, book or change anything/);
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

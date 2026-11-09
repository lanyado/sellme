import assert from "node:assert/strict";
import { test } from "node:test";
import { addAgent, addDraft, approve, editDraft, instruct, markSent, setSuggestion, addBlock } from "../lib/core.js";
import { applyLearned, confirmLearned, editsToLearn, learnFromEdits, learnPrompt, parseLearn, removeStyle } from "../lib/learn.js";
import { rewritePrompt, suggestPrompt, chatPrompt } from "../lib/rewrite.js";
import { freshState } from "../lib/store.js";

const TOOL = { id: "claude", name: "Claude Code", args: [] };

function search() {
  const s = { ...freshState(), autopilot: false };
  s.profile = { name: "Maya", roles: ["FDE"], where: "NYC", floor: "$987K", never_mention: [] };
  s.facts.push({ id: "f1", text: "Led a team of 6", source: "resume", added: "2026-01-01" });
  addAgent(s, "Dex", { channel: "mcp" });
  return s;
}

const TAGS = ["alpha", "beta", "gamma", "delta"];

function sentEdit(s, n, change = true) {
  const q = addDraft(s, { agent: "Dex", asked: `SECRET-THEIR-WORDS ${TAGS[n]}`, text: `Thanks so much for asking! Maya led a team of 6, version ${TAGS[n]}.`, sources: ["f1"] });
  if (change) editDraft(s, q.id, `Maya led a team of 6, version ${TAGS[n]}.`);
  approve(s, q.id);
  markSent(s, q.id);
  return q;
}

test("only what the user changed counts, and their own notes count too", () => {
  const s = search();
  sentEdit(s, 1);
  sentEdit(s, 2, false);
  const told = addDraft(s, { agent: "Dex", asked: "x", text: "Maya led a team of 6, told.", sources: ["f1"] });
  instruct(s, told.id, "Sound less eager");
  approve(s, told.id);
  markSent(s, told.id);
  assert.deepEqual(editsToLearn(s).map((q) => q.text), ["Maya led a team of 6, version beta.", "Maya led a team of 6, told."]);
  const prompt = learnPrompt(s, editsToLearn(s));
  assert.match(prompt, /Drafted: Thanks so much/);
  assert.match(prompt, /Sound less eager/);
  assert.doesNotMatch(prompt, /SECRET-THEIR-WORDS/, "the other side's words can't steer what's learned");
  assert.doesNotMatch(prompt, /987K/);
});

test("nothing is asked of the AI until a few edits pile up, and they're only read once", async () => {
  const s = search();
  const io = { read: () => s, write: (fn) => fn(s), tool: TOOL };
  let calls = 0;
  const run = async () => {
    calls += 1;
    return JSON.stringify({ style: ["Don't open with thanks"], facts: ["Prefers Python"] });
  };
  sentEdit(s, 1);
  sentEdit(s, 2);
  assert.equal(await learnFromEdits({ ...io, run }), null);
  assert.equal(calls, 0);
  sentEdit(s, 3);
  const out = await learnFromEdits({ ...io, run });
  assert.equal(calls, 1);
  assert.equal(out.added[0].text, "Don't open with thanks");
  assert.equal(await learnFromEdits({ ...io, run }), null);
  assert.equal(calls, 1, "read once");
  assert.ok(s.notes.some((n) => /Learned from your edits: Don't open with thanks/.test(n.text)));
  assert.equal(await learnFromEdits({ ...io, tool: null, run }), null);
});

test("style shapes every prompt, and a claim waits for the user's yes before it's a fact", () => {
  const s = search();
  const q = sentEdit(s, 1);
  applyLearned(s, { style: ["Keep it to two sentences"], facts: ["Prefers Python", "Led a team of 6"] }, [q]);
  for (const prompt of [rewritePrompt(s, { channel: "mcp", instructions: "x" }), suggestPrompt(s, { channel: "mcp" }), chatPrompt(s, { channel: "mcp" }, [])]) assert.match(prompt, /tone and length only.*Keep it to two sentences/);
  assert.deepEqual(s.learned.facts.map((f) => f.text), ["Prefers Python"], "what's already known isn't asked about");
  assert.equal(s.facts.length, 1, "not a fact yet");
  const fact = confirmLearned(s, s.learned.facts[0].id, true);
  assert.equal(s.facts.at(-1), fact);
  assert.match(fact.source, /your own edit/);
  applyLearned(s, { style: [], facts: ["Loves Rust"] }, []);
  confirmLearned(s, s.learned.facts[0].id, false);
  assert.equal(s.facts.at(-1), fact, "a no adds nothing");
  applyLearned(s, { style: [], facts: ["Loves Rust"] }, []);
  assert.equal(s.learned.facts.length, 0, "and it isn't asked again");
});

test("a rule the user removes stays gone, and one still true keeps its id", () => {
  const s = search();
  applyLearned(s, { style: ["No exclamation marks", "Short replies"], facts: [] }, []);
  const short = s.learned.style[1];
  removeStyle(s, s.learned.style[0].id);
  applyLearned(s, { style: ["No exclamation marks", "Short replies"], facts: [] }, []);
  assert.deepEqual(s.learned.style.map((r) => r.text), ["Short replies"]);
  assert.equal(s.learned.style[0].id, short.id);
  assert.match(learnPrompt(s, []), /They removed these[^]*No exclamation marks/);
  assert.throws(() => removeStyle(s, "s999"), /no rule/);
});

test("what comes back from the AI can't carry the salary floor, and junk is ignored", () => {
  const s = search();
  const out = parseLearn(JSON.stringify({ style: ["Mention $987K early", "Be brief"], facts: ["Wants 987K base", "Prefers Python"] }), s);
  assert.deepEqual(out, { style: ["Be brief"], facts: ["Prefers Python"] });
  assert.equal(parseLearn("no json", s), null);
  assert.equal(parseLearn('{"style": "not a list", "facts": []}', s), null);
});

test("a suggestion the user rewrites counts as an edit, and the card can show it", () => {
  const s = search();
  const q = addBlock(s, { agent: "Dex", asked: "Why this role?", reason: "Only you know" });
  setSuggestion(s, q.id, "I like the team.", { by: "ai" });
  assert.equal(q.drafted, "I like the team.");
  setSuggestion(s, q.id, "I like the mission.", { by: "you" });
  assert.equal(q.before, "I like the team.");
  assert.equal(q.drafted, "I like the team.");
});

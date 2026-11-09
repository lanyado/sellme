import assert from "node:assert/strict";
import { test } from "node:test";
import * as core from "../lib/core.js";
import { connected, documents, recall, recalledLines } from "../lib/memory.js";
import { parseRewrite, rewritePrompt } from "../lib/rewrite.js";
import { freshState as newState } from "../lib/store.js";

function search() {
  const s = newState();
  s.profile = { name: "Maya", roles: ["engineer"], where: "NYC", floor: "$230K base", never_mention: [] };
  core.addFact(s, "Led a team of 6", "resume");
  core.addAgent(s, "Ben", { channel: "mcp" });
  core.addAgent(s, "Nick", { channel: "mcp" });
  const q = core.addDraft(s, { agent: "Ben", asked: "Client is AWS, 150/hr is fine. Resume?", text: "Yes, submit me.", sources: ["f1"], company: "Oxford" });
  q.status = "sent";
  q.sent_at = "2026-11-06T16:20:00.000Z";
  s.notes.push({ id: "n1", agent: "Ben", text: "Ben: the client is AWS ProServ", ts: "2026-11-06T16:00:00.000Z" });
  s.notes.push({ id: "n2", agent: "Ben", text: "Sent: “Yes, submit me.”", ts: "2026-11-06T16:21:00.000Z" });
  s.notes.push({ id: "n3", agent: "Abhishek", text: "Range is 150-200K, under your 230K floor", ts: "2026-11-06T16:22:00.000Z" });
  return s;
}

test("the memory gets what was asked, sent and noted, keyed by Sellme's ids, and never the floor", () => {
  const docs = documents(search());
  assert.deepEqual(docs.facts.map((d) => d.external_id), ["f1"]);
  assert.equal(docs.sent[0].content, "Sent to Ben about Oxford: Yes, submit me.");
  assert.equal(docs.sent[0].project, "Oxford");
  assert.match(docs.asked[0].content, /^Ben asked about Oxford: Client is AWS, 150\/hr/);
  assert.deepEqual(docs.notes.map((d) => d.external_id), ["n1"]); // "Sent:" repeats sent, and n3 names the floor.
  assert.ok(!JSON.stringify(docs).includes("230"));
});

test("not connected, recall does nothing and starts nothing", async () => {
  const s = search();
  assert.equal(connected(s), false);
  assert.deepEqual(await recall(s, { query: "rate", run: () => assert.fail("nothing runs") }), []);
});

test("recall syncs and searches in one run, keeps what bears on it, and drops the draft itself and the floor", async () => {
  const s = search();
  s.memory = { dir: "/memsvc" };
  let seen;
  const run = async (dir, args, input) => {
    seen = { dir, args, steps: JSON.parse(input) };
    return [{ facts: {} }, [
      { source: "sent", external_id: "q1", content: "Sent to Ben about Oxford: Yes, submit me.", written_at: "2026-11-06T16:20:00Z", score: 0.8 },
      { source: "asked", external_id: "q9", content: "Nick asked: rate?", written_at: "2026-11-08T10:00:00Z", score: 0.9 },
      { source: "notes", external_id: "n7", content: "Your floor is 230K", written_at: "2026-11-06T10:00:00Z", score: 0.9 },
      { source: "notes", external_id: "n8", content: "Fonzi: weather chat", written_at: "2026-11-06T10:00:00Z", score: 0.2 },
    ]];
  };
  const found = await recall(s, { query: "my contract rate", agent: "Nick", skip: "q9", run });
  assert.equal(seen.dir, "/memsvc");
  assert.deepEqual(seen.args, ["batch"]);
  assert.equal(seen.steps[0].do, "sync");
  assert.deepEqual(seen.steps[1].sources, ["sent", "asked", "notes"]);
  assert.equal(seen.steps[1].for, "Nick");
  assert.deepEqual(found.map((r) => r.id), ["q1"]);
  assert.equal(found[0].when, "2026-11-06");
  // A service that fails leaves the draft to be written as before.
  assert.deepEqual(await recall(s, { query: "rate", run: async () => ({ failed: "down" }) }), []);
});

test("what's recalled reaches the prompt as context the draft can't cite", () => {
  const s = search();
  const q = core.addDraft(s, { agent: "Nick", asked: "Rate is $82-87/hr", text: "Here is my resume.", sources: ["f1"] });
  q.instructions = "say my rate";
  const prompt = rewritePrompt(s, { ...q, recalled: [{ source: "sent", id: "q1", text: "Sent to Ben about Oxford: Yes, submit me.", when: "2026-11-06" }] });
  assert.match(prompt, /never cite it/);
  assert.match(prompt, /2026-11-06 · They sent \(their own words\): Sent to Ben/);
  assert.deepEqual(recalledLines([]), []);
  // Citing a recalled message id isn't a source.
  assert.deepEqual(parseRewrite(JSON.stringify({ text: "x", sources: ["q1"] }), s, q).sources, ["f1"]);
});

test("a new rate replaces the old one: the AI sees only the new one, and old drafts still check out", () => {
  const s = search();
  const [old] = core.keepWhatYouSaid(s, ["Asks $150/hr for contract roles"], ["note"]);
  const q = core.addDraft(s, { agent: "Nick", asked: "Rate?", text: "My rate is $150/hr.", sources: [old] });
  const [fresh] = core.keepWhatYouSaid(s, [{ text: "Asks $160/hr for contract roles", replaces: old }], ["note"]);
  assert.equal(s.facts.find((f) => f.id === old).replaced_by, fresh);
  assert.equal(s.facts.find((f) => f.id === fresh).replaces, old);
  const prompt = rewritePrompt(s, { ...q, instructions: "x" });
  assert.match(prompt, /f\d+: Asks \$160\/hr/);
  assert.doesNotMatch(prompt, /f\d+: Asks \$150\/hr/);
  assert.ok(!q.check.reasons.some((r) => r.code === "unknown_source"));
  // The memory gets the replacement too, so its search skips the old rate.
  assert.equal(documents(s).facts.find((d) => d.external_id === fresh).replaces, old);
});

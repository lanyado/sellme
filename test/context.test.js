import assert from "node:assert/strict";
import { test } from "node:test";
import * as core from "../lib/core.js";
import { card, palette } from "../lib/render.js";
import { rewritePrompt } from "../lib/rewrite.js";
import { freshState } from "../lib/store.js";

function search() {
  const s = { ...freshState(), autopilot: false };
  s.profile = { name: "Maya", roles: ["engineer"], where: "NYC", floor: "$987K", never_mention: [] };
  core.addFact(s, "Led a team of 6", "resume");
  core.addAgent(s, "Boardy", { channel: "email", handle: "hi@boardy.example" });
  return s;
}

test("SELLME's own notes sit apart from what they asked, on the card and in the prompt", () => {
  const s = search();
  const q = core.addDraft(s, {
    agent: "Boardy",
    asked: "Boardy, Nov 8: offered an intro to Lee at Hooli.",
    context: "You chose Kai for Vandelay. Calendar now: Mon 1:00 to 1:45 Alex.",
    text: "Yes, Maya would like the intro to Lee. What is the next step?",
    sources: ["f1"],
  });
  const shown = card(q, palette(null));
  const asked = shown.indexOf("They asked");
  const notes = shown.indexOf("SELLME’s notes");
  assert.ok(asked !== -1 && notes > asked);
  assert.ok(!shown.slice(asked, notes).includes("Calendar now"), "their section holds only their words");
  // The calendar in SELLME's notes isn't the other side asking for a time.
  assert.ok(!q.check.reasons.some((r) => r.code === "scheduling" || /commits your time/.test(r.message)));
  const prompt = rewritePrompt(s, { ...q, instructions: "warmer" });
  assert.match(prompt, /SELLME's notes for the user \(what it checked, earlier choices\): You chose Kai/);
  assert.ok(prompt.indexOf("THEIR MESSAGE>>>") < prompt.indexOf("SELLME's notes for the user"), "notes are outside their message");
});

test("no notes, no section", () => {
  const s = search();
  const q = core.addDraft(s, { agent: "Boardy", asked: "Intro?", context: "  ", text: "Yes, please.", sources: ["f1"] });
  assert.equal(q.context, undefined);
  assert.ok(!card(q, palette(null)).includes("SELLME’s notes"));
});

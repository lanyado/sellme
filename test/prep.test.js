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
  core.addAgent(s, "Robin", { channel: "self", handle: "robin@acme.example" });
  const q = core.addDraft(s, { agent: "Robin", asked: "Can you send your resume before our Monday chat?", text: "Of course, here it is.", sources: ["f1"], company: "Acme" });
  q.status = "sent";
  q.sent_at = "2026-11-06T16:20:00.000Z";
  s.notes.push({ id: "n1", agent: "Robin", text: "Acme call booked with Robin, Mon 2 PM", ts: "2026-11-06T16:00:00.000Z" });
  s.notes.push({ id: "n2", agent: "Fonzi", text: "Globex wants a take-home", ts: "2026-11-06T17:00:00.000Z" });
  const role = core.addRole(s, { company: "Acme", title: "FDE", agent: "Robin", stage: "talking", nextCall: "2030-01-01T19:00:00Z" });
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
  assert.ok(thread.some((l) => l.includes("Robin wrote: Can you send your resume")));
  assert.ok(thread.some((l) => l.includes("You sent Robin: Of course")));
  assert.ok(thread.some((l) => l.includes("Acme call booked")));
  assert.ok(!thread.some((l) => l.includes("Globex")), "another company's notes stay out");
  const prompt = prepPrompt(s, role, [], { recalled: [{ source: "notes", id: "n9", text: "Acme: Robin is the recruiter", when: "2026-11-05" }] });
  assert.match(prompt, /Write the brief/);
  assert.match(prompt, /Never write about SELLME, its records, drafts or checks, what was or wasn't found/);
  assert.match(prompt, /never two versions of one fact/);
  assert.match(prompt, /put it in THREE QUESTIONS TO ASK instead/);
  assert.match(prompt, /WHO AND WHEN .*THE INTERVIEWER \(their role and team.*THE ROLE .*WHY US\? .*LIKELY QUESTIONS/s, "every brief has the interviewer and why us");
  assert.match(prompt, /Call time on file: .*may be out of date/);
  assert.doesNotMatch(prompt, /If something isn't known, say so/, "the brief never narrates what's unknown");
  assert.match(prompt, /f1: Led a team of 6/);
  assert.match(prompt, /Acme: Robin is the recruiter/);
  assert.doesNotMatch(prompt, /987K/);
  assert.doesNotMatch(prompt, /look things up/, "the plain tool isn't told to search");
  assert.match(prepPrompt(s, role, [], { research: true }), /Never send, post, book or change anything/);
  const asking = prepPrompt(s, role, [{ who: "sellme", text: "Brief" }, { who: "you", text: "What do they build?" }]);
  assert.match(asking, /Answer their latest question/);
  assert.doesNotMatch(asking, /Never write about SELLME/, "a follow-up answer can say where something came from");
  assert.match(asking, /User: What do they build\?/);
});

test("a brief is kept for its call, and a new call needs a new one", async () => {
  const { s, role } = search();
  const result = await prepTurn(s, role, [], { tool: TOOL, run: async () => '{"say": "Who: Robin\\nWhen: Mon 2 PM"}' });
  assert.equal(result.say, "Who: Robin\nWhen: Mon 2 PM");
  core.savePrep(s, role.id, result.say);
  assert.equal(savedBrief(role), "Who: Robin\nWhen: Mon 2 PM");
  role.prep = { brief: "Old brief with SELLME's own notes in it", for_call: role.next_call, at: "2026-11-01T00:00:00Z" };
  assert.equal(savedBrief(role), null, "a brief written the old way is written again");
  core.savePrep(s, role.id, result.say);
  core.setNextCall(s, role.id, "2030-02-01T19:00:00Z");
  assert.equal(savedBrief(role), null);
  assert.match(parsePrep("not json").refused, /form I could read/);
  assert.equal(parsePrep(JSON.stringify({ say: "One\\nTwo" })).say, "One\nTwo");
  assert.match((await prepTurn(s, role, [], { tool: null })).failed, /No AI tool/);
});

test("a conversation opens on the newest lines with the line ready to type, and the arrows and PgUp scroll it", async () => {
  const { readChat } = await import("../lib/app.js");
  const { palette } = await import("../lib/render.js");
  const c = palette(null);
  const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`);
  const run = async (scrolls, result = null) => {
    const frames = [];
    let prompt;
    const out = await readChat(lines, c, {
      typeFn: async (p, { paint }) => {
        prompt = p;
        paint(0);
        for (const by of scrolls) paint(by);
        return result;
      },
      drawFn: (s) => frames.push(s),
    });
    return { out, frames, prompt };
  };
  const start = await run([]);
  assert.match(start.prompt, /You:/, "the green You: is there at once");
  assert.match(start.frames[0], /line 200/, "it opens on the newest lines");
  assert.match(start.frames[0], /↑ \d+ more lines/);
  assert.match(start.frames[0], /enter to send/);
  const up = await run([5, 3]);
  assert.doesNotMatch(up.frames.at(-1), /line 200\b/, "scrolled back from the newest");
  const top = await run([Infinity]);
  assert.match(top.frames.at(-1), /line 1\n/);
  assert.match(top.frames.at(-1), /↓ \d+ more lines/);
  const down = await run([Infinity, -Infinity]);
  assert.match(down.frames.at(-1), /line 200/, "End comes back to the newest");
  assert.equal((await run([], "What do they build?")).out, "What do they build?");
  assert.equal((await run([], "quit")).out, "quit");
});

test("a brief shows headings, bold, underline and lists as styles, never as raw marks", async () => {
  const { rich, palette } = await import("../lib/render.js");
  const tag = (t) => (s) => `<${t}>${s}</${t}>`;
  const c = { ...palette(null), lime: (s) => s, muted: (s) => s, bold: tag("b"), underline: tag("u") };
  const brief = "WHO AND WHEN\n- **Dana Ford**, Fri at **3:00 PM**\n- Place: 1 Main St\n\n## Likely questions\n1. **Why us?** Because the role is close to my current work and I have shipped the same kind of system twice before.\n- __Don't raise pay first.__";
  const out = rich(brief, 40, c);
  assert.equal(out[0], "<u><b>WHO AND WHEN</b></u>");
  assert.equal(out[1], "• <b>Dana Ford</b>, Fri at <b>3:00 PM</b>");
  assert.equal(out[2], "• <b>Place</b>: 1 Main St", "an unmarked label is bolded, so older briefs read the same");
  assert.ok(out.includes("<u><b>LIKELY QUESTIONS</b></u>"));
  assert.equal(rich("WHY US?\n- Because.", 40, c)[0], "<u><b>WHY US?</b></u>", "a heading can end in a question mark");
  const q = out.findIndex((l) => l.startsWith("1. "));
  assert.match(out[q], /^1\. <b>Why us\?<\/b> /);
  assert.match(out[q + 1], /^ {3}\S/, "a wrapped list line hangs under its text");
  assert.ok(out.every((l) => !/\*\*|__|^#/.test(l)));
  assert.ok(out.some((l) => l.includes("<u>Don't raise pay first.</u>")));
  const plain = rich("**Dana** at __noon__", 40, palette(null));
  assert.deepEqual(plain, ["Dana at noon"], "no color drops the marks");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { BRIEF_VERSION, answerEarned, addAgent, addDraft, addRole, approve, earnedOffer, earnedStreak, instruct, markSent, pushList, setAuto, setRole, skip, topicOf } from "../lib/core.js";
import { draftActions } from "../lib/app.js";
import { DAY, HOUR, attributed, talkedAbout, reached, replyTiming, scorecard } from "../lib/insights.js";
import { dueBriefs } from "../lib/prep.js";
import { card, diffLines, palette, scorecard as scorecardScreen, wordDiff } from "../lib/render.js";
import { freshState } from "../lib/store.js";

const plain = palette(null);
const color = palette("truecolor");
const NOW = new Date("2026-11-09T12:00:00Z");
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const visible = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

function search() {
  const s = { ...freshState(), autopilot: false };
  s.profile = { name: "Maya", roles: ["FDE"], where: "NYC", floor: "$987K", never_mention: [] };
  addAgent(s, "Dex", { channel: "mcp" });
  addAgent(s, "Slowbot", { channel: "mcp" });
  addAgent(s, "Dana Lee", { channel: "self", handle: "dana@acme.example" });
  return s;
}

/** A message sent, and the answer it got `took` later. */
function exchange(s, agent, sentAgo, took) {
  s.queue.push({ id: `q${s.queue.length + 100}`, agent, channel: "mcp", kind: "reply", status: "sent", text: "hello", sent_at: ago(sentAgo), created: ago(sentAgo) });
  if (took) s.queue.push({ id: `q${s.queue.length + 100}`, agent, channel: "mcp", kind: "reply", status: "skipped", asked: "and?", created: ago(sentAgo - took) });
}

test("a nudge waits as long as that contact really takes, not a fixed number of days", () => {
  const s = search();
  for (const at of [20, 15, 10]) exchange(s, "Slowbot", at * DAY, 3 * DAY);
  exchange(s, "Slowbot", 4 * DAY);
  const slow = replyTiming(s, "Slowbot", NOW);
  assert.equal(slow.typical, 3 * DAY);
  assert.equal(slow.after, 6 * DAY);
  assert.equal(slow.due, false, "four days is nothing for an agent that takes three");
  exchange(s, "Dex", 3 * DAY);
  assert.equal(replyTiming(s, "Dex", NOW).due, true, "no pattern yet, so the two-day default");
  assert.equal(replyTiming(s, "Dana Lee", NOW).after, 4 * DAY, "people get longer");
});

test("nudge timing has a floor and a ceiling, and ignoring a nudge doubles the wait", () => {
  const s = search();
  for (const at of [9, 8, 7]) exchange(s, "Dex", at * DAY, 10 * 60_000);
  assert.equal(replyTiming(s, "Dex", NOW).after, DAY, "even a fast bot isn't written to twice a day");
  exchange(s, "Dex", 3 * DAY);
  exchange(s, "Dex", 2 * DAY);
  assert.equal(replyTiming(s, "Dex", NOW).after, 2 * DAY);
  assert.equal(replyTiming(s, "Dex", NOW).unanswered, 2);
  for (const at of [120, 80, 40]) exchange(s, "Slowbot", at * DAY, 25 * DAY);
  assert.equal(replyTiming(s, "Slowbot", NOW).after, 10 * DAY);
});

test("a run sees who's due and goes to the agents delivering most first, with referral pay nowhere in it", () => {
  const s = search();
  addRole(s, { company: "Acme", agent: "Slowbot", stage: "interview" });
  s.notes.push({ id: "n0", agent: "Slowbot", text: "New match: Acme", ts: ago(5 * DAY) });
  exchange(s, "Dex", 3 * DAY);
  s.ledger.push({ id: "l1", agent: "Dex", stage: "paid", ts: ago(DAY) });
  const push = pushList(s, NOW);
  assert.deepEqual(push.contacts.map((c) => c.agent).slice(0, 2), ["Slowbot", "Dex"]);
  assert.equal(push.contacts.find((c) => c.agent === "Dex").nudge_due, true);
  const paid = structuredClone(s);
  paid.ledger = [];
  assert.deepEqual(scorecard(paid, NOW), scorecard(s, NOW), "what an agent pays changes nothing");
});

test("the scorecard counts how far a role got, even after a rejection, and says who isn't answering", () => {
  const s = search();
  const r = addRole(s, { company: "Acme", agent: "Dex", stage: "talking" });
  s.notes.push({ id: "n0", agent: "Dex", text: "New match: Acme", ts: ago(5 * DAY) });
  setRole(s, r.id, "interview");
  setRole(s, r.id, "rejected");
  assert.equal(reached(r), 2);
  for (const at of [9, 8, 7]) exchange(s, "Slowbot", at * DAY);
  addRole(s, { company: "Orphan" });
  const { rows, unattributed } = scorecard(s, NOW);
  assert.equal(rows[0].agent, "Dex");
  assert.equal(rows[0].interviews, 1);
  assert.equal(rows[0].verdict, "delivering");
  assert.equal(rows.find((x) => x.agent === "Slowbot").verdict, "not answering");
  assert.equal(unattributed, 1);
  const screen = scorecardScreen(s, plain, 100);
  assert.match(screen, /Dex/);
  assert.match(screen, /1 role isn’t tied/);
  assert.match(screen, /Referral pay plays no part/);
  for (const width of [60, 80, 120]) for (const line of scorecardScreen(s, color, width).split("\n")) assert.ok(visible(line).length <= width, `${width}: ${visible(line)}`);
});

/** Approved exactly as drafted, one after another. */
let uniq = 0;
const word = () => {
  uniq += 1;
  return `w${uniq.toString(26).replace(/\d/g, (d) => "qrstuvwxyz"[d])}`;
};

function yeses(s, agent, n, asked = "Are you open to remote?") {
  let last;
  for (let i = 0; i < n; i += 1) {
    const tag = word();
    last = addDraft(s, { agent, asked: `${asked} ${tag}`, text: `Maya works remotely from NYC, ${tag}.`, sources: ["profile.where"] });
    approve(s, last.id);
    markSent(s, last.id);
  }
  return last;
}

test("trust is earned one topic at a time, and only the user's yes turns it on", () => {
  const s = search();
  const tenth = yeses(s, "Dex", 10);
  assert.equal(topicOf(tenth), "location");
  assert.equal(earnedStreak(s, "Dex", "location"), 10);
  const offer = earnedOffer(s, tenth.id);
  assert.equal(offer.topic, "location");
  const before = addDraft(s, { agent: "Dex", asked: "Is remote fine?", text: "Remote is fine for Maya, more detail.", sources: ["profile.where"] });
  assert.equal(before.status, "pending", "an offer alone changes nothing");
  answerEarned(s, "Dex", "location", true);
  assert.equal(before.status, "approved", "a yes covers what's already waiting on that topic");
  assert.equal(earnedOffer(s, tenth.id), null, "it doesn't ask twice");
  const other = addDraft(s, { agent: "Dex", asked: "Do you need a visa?", text: "Maya needs none of that today.", sources: ["profile.where"] });
  assert.equal(other.status, "pending", "another topic still asks");
  const time = addDraft(s, { agent: "Dex", asked: "Remote, and can you meet Tuesday at 3pm?", text: "Maya can do Tuesday at 3pm.", sources: ["profile.where"] });
  assert.notEqual(time.status, "approved", "scheduling never earns its way through");
  const pay = addDraft(s, { agent: "Dex", asked: "What salary for remote?", text: "Maya can talk through pay soon.", sources: ["profile.where"] });
  assert.notEqual(pay.status, "approved", "nor does pay");
  setAuto(s, "Dex", false);
  assert.equal(s.agents[0].auto_topics, undefined, "ask me again means everything");
  assert.equal(before.status, "pending", "what it approved but hadn't sent comes back");
});

test("a change, a note or a skip starts the count over, and a no asks again only after as many more", () => {
  const s = search();
  yeses(s, "Dex", 6);
  const q = addDraft(s, { agent: "Dex", asked: "Remote okay here?", text: "Yes, remote from NYC.", sources: ["profile.where"] });
  instruct(s, q.id, "shorter");
  approve(s, q.id);
  assert.equal(earnedStreak(s, "Dex", "location"), 0);
  const skipped = addDraft(s, { agent: "Dex", asked: "Remote once more?", text: "Still remote from NYC.", sources: ["profile.where"] });
  skip(s, skipped.id);
  const tenth = yeses(s, "Dex", 10, "Hybrid possible?");
  assert.ok(earnedOffer(s, tenth.id));
  answerEarned(s, "Dex", "location", false);
  assert.equal(earnedOffer(s, tenth.id), null);
  assert.equal(earnedOffer(s, yeses(s, "Dex", 9, "Onsite ever?").id), null);
  assert.ok(earnedOffer(s, yeses(s, "Dex", 1, "Onsite maybe?").id));
  const person = yeses(s, "Dana Lee", 10);
  assert.equal(earnedOffer(s, person.id), null, "people aren't offered this, only bots");
  assert.equal(topicOf({ kind: "reply", asked: "Remote? What's your experience?" }), null, "two topics at once is no topic");
});

test("the diff marks what changed word by word, and keeps an email's lines", () => {
  const parts = wordDiff("Maya led a team of 6.", "Maya led a great team of 6.");
  assert.deepEqual(parts.filter((p) => p.op !== "same").map((p) => [p.op, p.text]), [["add", "great"]]);
  const marked = diffLines("Hi Sam,\n\nHappy to chat soon.", "Hi Sam,\n\nHappy to talk today.", 40, plain);
  assert.deepEqual(marked.lines.map((l) => l.text), ["Hi Sam,", "", "Happy to -{chat soon.} +{talk today.}"]);
  assert.deepEqual([marked.added, marked.removed], [2, 2]);
  assert.ok(diffLines("Completely unrelated words here today.", "Nothing in common whatsoever my friend.", 40, plain).added > 0, "even a full rewrite shows in red and green");
  const long = "word ".repeat(60);
  for (const line of diffLines(long, `${long}more`, 30, plain).lines) assert.ok(line.text.length <= 30, line.text);
  assert.equal(wordDiff("x ".repeat(1000), "y ".repeat(1000)), null, "too long to compare");
});

test("a card shows what changed only when asked, and offers to copy the draft", () => {
  const s = search();
  const q = addDraft(s, { agent: "Dex", asked: "Team size?", text: "Maya led a team of 6.", sources: [] });
  q.before = q.text;
  q.text = "Maya led a strong team of 6.";
  assert.match(card(q, plain, "", 80, { diff: true }), /\+\{strong\}/);
  assert.match(card(q, plain, "", 80, { diff: true }), /\+1 word/);
  assert.doesNotMatch(card(q, plain, "", 80), /\+\{/, "off by default, so an approved card reads clean");
  assert.equal(draftActions(q).some((a) => /what changed/.test(a.label)), false, "no key to hide it");
  assert.deepEqual(draftActions(q).find((a) => a.id === "copy"), { key: "c", id: "copy", label: "Copy draft" });
  q.text = "Nothing alike remains between these sentences now.";
  const rewritten = card(q, plain, "", 80, { diff: true });
  assert.doesNotMatch(rewritten, /Before/, "a full rewrite is still shown in red and green, never as before and after");
  assert.match(rewritten, /\+\{Nothing/);
});

test("a call in the next day gets its brief ahead, once, and a failed try isn't repeated every hour", async () => {
  const soon = new Date(Date.now() + 10 * HOUR).toISOString();
  const s = search();
  const near = addRole(s, { company: "Near", stage: "talking" });
  near.next_call = soon;
  const far = addRole(s, { company: "Far", stage: "talking" });
  far.next_call = new Date(Date.now() + 5 * DAY).toISOString();
  const done = addRole(s, { company: "Done", stage: "rejected" });
  done.next_call = soon;
  assert.deepEqual(dueBriefs(s).map((r) => r.company), ["Near"]);
  near.prep_tried = { for_call: soon, at: new Date(Date.now() - HOUR).toISOString(), v: BRIEF_VERSION };
  assert.deepEqual(dueBriefs(s), [], "just tried");
  near.prep_tried.at = new Date(Date.now() - 7 * HOUR).toISOString();
  assert.equal(dueBriefs(s).length, 1, "tried long enough ago");
  near.prep = { brief: "Ready", for_call: soon, v: BRIEF_VERSION - 1 };
  near.prep_tried.at = new Date(Date.now() - HOUR).toISOString();
  near.prep_tried.v = BRIEF_VERSION - 1;
  assert.equal(dueBriefs(s).length, 1, "written the old way, so it's written again, even though tried an hour ago");
  near.prep.v = BRIEF_VERSION;
  assert.deepEqual(dueBriefs(s), [], "already written");
});

test("a role filed under an agent that never spoke of the company isn't credited to it or sent through it", () => {
  const s = search();
  const guessed = addRole(s, { company: "Northwind AI", agent: "Dex", stage: "interview" });
  s.notes.push({ id: "n1", agent: "Email", text: "Northwind interview booked Mon 3 PM", ts: ago(DAY) });
  assert.equal(attributed(s, guessed), null);
  assert.equal(scorecard(s, NOW).rows.find((r) => r.agent === "Dex").interviews, 0, "no credit for a guess");
  s.queue.push({ id: "q7", agent: "Dana Lee", channel: "self", kind: "reply", status: "sent", text: "Looking forward to Northwind", sent_at: ago(DAY), created: ago(DAY) });
  assert.deepEqual(talkedAbout(s, "Northwind AI").map((a) => a.name), ["Dana Lee"], "the contact who did talk about it comes first");
  s.notes.push({ id: "n2", agent: "Dex", text: "New match: Northwind AI, FDE", ts: ago(2 * DAY) });
  assert.equal(attributed(s, guessed), "Dex", "once Dex has mentioned it, it's Dex's");
});

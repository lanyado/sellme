import assert from "node:assert/strict";
import { test } from "node:test";
import { answerEarned, addAgent, addDraft, addRole, approve, earnedOffer, earnedStreak, instruct, markSent, pushList, setAuto, setRole, skip, topicOf } from "../lib/core.js";
import { draftActions, timelineRows } from "../lib/app.js";
import { DAY, HOUR, attributed, talkedAbout, nudgePlan, reached, replyTiming, roleStory, scorecard, timeline } from "../lib/insights.js";
import { dueBriefs } from "../lib/prep.js";
import { card, diffLines, palette, scorecard as scorecardScreen, timelineAxis, timelineScale, timelineStrip, wordDiff } from "../lib/render.js";
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
  assert.equal(diffLines("Completely unrelated words here today.", "Nothing in common whatsoever my friend.", 40, plain), null, "a rewrite isn't a word soup");
  const long = "word ".repeat(60);
  for (const line of diffLines(long, `${long}more`, 30, plain).lines) assert.ok(line.text.length <= 30, line.text);
  assert.equal(wordDiff("x ".repeat(1000), "y ".repeat(1000)), null, "too long to compare");
});

test("a card shows what changed only when asked, and offers to hide it", () => {
  const s = search();
  const q = addDraft(s, { agent: "Dex", asked: "Team size?", text: "Maya led a team of 6.", sources: [] });
  assert.equal(draftActions(q).some((a) => a.id === "diff"), false, "nothing to show yet");
  q.before = q.text;
  q.text = "Maya led a strong team of 6.";
  assert.match(card(q, plain, "", 80, { diff: true }), /\+\{strong\}/);
  assert.match(card(q, plain, "", 80, { diff: true }), /\+1 word/);
  assert.doesNotMatch(card(q, plain, "", 80), /\+\{/, "off by default, so an approved card reads clean");
  assert.equal(draftActions(q, { diff: true }).find((a) => a.id === "diff").label, "Hide what changed");
  assert.equal(draftActions(q, { diff: false }).find((a) => a.id === "diff").label, "Show what changed");
  q.text = "Nothing alike remains between these sentences now.";
  const rewritten = card(q, plain, "", 80, { diff: true });
  assert.match(rewritten, /Before/);
  assert.match(rewritten, /rewritten/);
});

test("the timeline sorts by what needs attention, and each row is exactly as wide as the terminal allows", () => {
  const s = search();
  const stuck = addRole(s, { company: "Stuckco", title: "FDE", agent: "Dex", stage: "interview" });
  s.queue.push({ id: "q90", agent: "Dex", channel: "mcp", kind: "reply", status: "sent", company: "Stuckco", text: "Any update?", sent_at: ago(9 * DAY), created: ago(9 * DAY) });
  const fresh = addRole(s, { company: "Freshco", agent: "Dana Lee", stage: "talking" });
  s.queue.push({ id: "q91", agent: "Dana Lee", channel: "self", kind: "reply", status: "sent", company: "Freshco", text: "Thanks", sent_at: ago(HOUR), created: ago(HOUR) });
  const call = addRole(s, { company: "Callco", agent: "Dana Lee", stage: "interview" });
  call.next_call = new Date(NOW.getTime() + 14 * HOUR).toISOString();
  const open = addRole(s, { company: "Openco", agent: "Slowbot", stage: "talking" });
  s.queue.push({ id: "q92", agent: "Slowbot", channel: "mcp", kind: "reply", status: "pending", company: "Openco", asked: "Remote?", text: "Yes", created: ago(2 * DAY) });
  addRole(s, { company: "Quietnew" });
  addRole(s, { company: "Gone", stage: "rejected" });
  const t = timeline(s, NOW);
  assert.deepEqual([t.onYou, t.calls, t.stuck, t.moving].map((g) => g.map((x) => x.role.company)), [["Openco"], ["Callco"], ["Stuckco"], ["Freshco"]]);
  assert.equal(t.idle, 1, "a match nobody has spoken to is only counted");
  assert.equal(roleStory(s, stuck, NOW).stuck, true);
  assert.equal(roleStory(s, fresh, NOW).stuck, false);
  for (const width of [60, 80, 100, 140, 200]) {
    for (const [c, frame] of [[plain, Infinity], [color, 4], [color, 40]]) {
      const rows = timelineRows(s, { today: NOW, width, frame, c });
      for (const row of rows.filter((r) => r.line)) assert.ok(visible(row.line).length + 2 <= width, `${width}: ${visible(row.line)}`);
      for (const line of rows.pin) assert.ok(visible(line).length <= width, `${width}: ${visible(line)}`);
      for (const line of rows.panel(rows.find((r) => r.story)).split("\n")) assert.ok(visible(line).length <= width, `${width}: ${visible(line)}`);
      const lengths = new Set(rows.filter((r) => r.line).map((r) => visible(timelineStrip(r.story, { today: NOW, days: 30, c })).length));
      assert.deepEqual([...lengths], [38], "the strips line up");
    }
  }
  const rows = timelineRows(s, { today: NOW, width: 120, c: plain });
  assert.equal(rows.find((r) => r.id === open.id).onYou, "q92", "enter on one waiting on you opens that draft");
  const line = rows.find((r) => r.id === stuck.id).line;
  assert.match(line, /stuck 9d/);
  assert.match(line, /●[░▒▓█]+│/, "a sent message, then silence up to today");
  assert.match(rows.find((r) => r.id === call.id).line, /▲/);
  assert.match(rows.panel(rows.find((r) => r.id === stuck.id)), /Quiet for 9d, and a nudge was due after 2d/);
  assert.match(timelineAxis({ today: NOW, days: 30 }), /\d +today/, "the dates never run into today");
});

test("the timeline's time fits the search: a short history fills the strip instead of huddling against today", () => {
  const story = (...ages) => ({ events: ages.map((d) => ({ at: ago(d * DAY), type: "you" })), since: NOW.getTime() - Math.min(...ages) * DAY, after: 2 * DAY, waiting: "them", stuck: true, upcoming: null });
  const short = timelineScale([story(9, 6), story(2)], 80, NOW);
  assert.ok(short.perDay >= 5, `a ten-day search gets room: ${short.perDay} columns a day`);
  assert.ok(short.days <= 16, `and no months of empty dates: ${short.days} days`);
  assert.equal(short.perDay * (short.days + short.ahead) + short.spare, 80, "it uses all the room");
  const strip = visible(timelineStrip(story(9, 6), { today: NOW, ...short, c: plain }));
  assert.ok(strip.indexOf("●") < strip.length * 0.5, `the first event isn't jammed at the edge: ${strip}`);
  const many = Array.from({ length: 60 }, (_, i) => story(1 + (i % 8)));
  const outlier = timelineScale([...many, story(300)], 80, NOW);
  assert.ok(outlier.days <= 20, "one stray old event doesn't stretch everyone");
  const long = timelineScale([story(200)], 80, NOW);
  assert.equal(long.perDay, 1, "a long search still fits, a column a day");
  const call = { ...story(3), upcoming: new Date(NOW.getTime() + 4 * DAY + HOUR).toISOString(), waiting: "call" };
  const withCall = timelineScale([call], 80, NOW);
  assert.ok(withCall.ahead >= 5, "the future reaches the next call");
  assert.match(visible(timelineStrip(call, { today: NOW, ...withCall, c: plain })), /│ +▲/);
  assert.equal(timelineScale([story(2)], 80, NOW).ahead, 2, "and no further than it has to");
  const axis = timelineAxis({ today: NOW, ...short });
  assert.equal(axis.length, (short.days + short.ahead) * short.perDay + 1);
  assert.ok((axis.match(/[A-Z][a-z]{2} \d+/g) ?? []).length >= 3, axis);
  assert.match(axis, /today/);
});

test("nudge all writes each stuck contact once, and leaves alone anyone waiting on the user or just written to", () => {
  const s = search();
  for (const company of ["One", "Two"]) {
    addRole(s, { company, agent: "Dex", stage: "talking" });
    s.queue.push({ id: `q-${company}`, agent: "Dex", channel: "mcp", kind: "reply", status: "sent", company, text: "Any news?", sent_at: ago(5 * DAY), created: ago(5 * DAY) });
  }
  addRole(s, { company: "Three", agent: "Slowbot", stage: "talking" });
  s.queue.push({ id: "q3", agent: "Slowbot", channel: "mcp", kind: "reply", status: "sent", company: "Three", text: "Any news?", sent_at: ago(5 * DAY), created: ago(5 * DAY) });
  s.queue.push({ id: "q4", agent: "Slowbot", channel: "mcp", kind: "reply", status: "pending", company: "Elsewhere", text: "Waiting", created: ago(HOUR) });
  addRole(s, { company: "Four", agent: "Removed", stage: "talking" });
  assert.deepEqual(nudgePlan(s, NOW).map((x) => x.role.agent), ["Dex"]);
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
  near.prep_tried = { for_call: soon, at: new Date(Date.now() - HOUR).toISOString() };
  assert.deepEqual(dueBriefs(s), [], "just tried");
  near.prep_tried.at = new Date(Date.now() - 7 * HOUR).toISOString();
  assert.equal(dueBriefs(s).length, 1, "tried long enough ago");
  near.prep = { brief: "Ready", for_call: soon };
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

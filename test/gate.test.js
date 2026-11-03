import assert from "node:assert/strict";
import { test } from "node:test";
import * as core from "../lib/core.js";
import { PROGRAMS, signupList } from "../lib/referrals.js";
import { freshState } from "../lib/store.js";

function state() {
  const s = freshState();
  s.profile = { name: "Maya", roles: ["Staff Engineer"], floor: "$180K", where: "NYC or remote", never_mention: [] };
  s.facts = [{ id: "f1", text: "Led a team of 6 engineers", source: "resume.pdf" }];
  core.addAgent(s, "Standout", { handle: "+15550100" });
  core.addAgent(s, "Fonzi");
  return s;
}
const ok = (s) => core.addDraft(s, { agent: "Standout", asked: "NYC?", text: "Yes. NYC or remote.", sources: ["profile.where"] });

test("a draft can't be marked sent without approval", () => {
  const s = state();
  const q = ok(s);
  assert.equal(q.status, "pending");
  assert.throws(() => core.markSent(s, q.id), /isn’t approved/);
  core.approve(s, q.id);
  core.markSent(s, q.id);
  assert.equal(q.status, "sent");
});

test("only approved drafts reach the outbox, with the exact approved text and address", () => {
  const s = state();
  const q = ok(s);
  assert.deepEqual(core.outbox(s), []);
  core.approve(s, q.id);
  assert.deepEqual(core.outbox(s), [{ id: q.id, agent: "Standout", channel: "imessage", to: "+15550100", text: "Yes. NYC or remote." }]);
});

test("editing voids the approval and rechecks", () => {
  const s = state();
  const q = ok(s);
  core.approve(s, q.id);
  core.editDraft(s, q.id, "Yes, and I managed 20 people.");
  assert.equal(q.status, "blocked");
  assert.deepEqual(core.outbox(s), []);
  assert.throws(() => core.markSent(s, q.id));
  assert.throws(() => core.approve(s, q.id), /blocked/);
});

test("tampering with approved text is caught when sending", () => {
  const s = state();
  const q = ok(s);
  core.approve(s, q.id);
  q.text = "Something else";
  assert.throws(() => core.markSent(s, q.id));
});

test("a blocked draft can't be approved, but the user can answer it", () => {
  const s = state();
  const q = core.addBlock(s, { agent: "Fonzi", asked: "Managed 20?", reason: "Your resume says 6." });
  assert.throws(() => core.approve(s, q.id), /blocked/);
  core.answerYourself(s, q.id, "I managed 6, and I'd love to talk.");
  assert.equal(q.status, "approved");
  assert.deepEqual(q.sources, ["user"]);
});

test("found by a live test: answer can't bypass the gate", () => {
  const s = state();
  const q = core.addDraft(s, { agent: "Fonzi", asked: "Salary?", text: "I'm at $180K.", sources: ["profile.floor"] });
  assert.throws(() => core.answerYourself(s, q.id, "Thanks for asking."), /needs your own yes/);
  assert.throws(() => core.answerYourself(s, q.id, "SSN 123-45-6789", { confirmSensitive: true }), /can’t go out/);
  assert.equal(q.status, "pending");
  const b = core.addBlock(s, { agent: "Fonzi", asked: "Team size?", reason: "Your resume says 6." });
  assert.throws(() => core.answerYourself(s, b.id, "My floor is $180K."), /needs your own yes/);
  assert.equal(core.answerYourself(s, b.id, "I managed 6.").status, "approved");
});

test("the user's own claims don't need a source, but they can't claim to be human through the agent", () => {
  const s = state();
  const b = core.addBlock(s, { agent: "Fonzi", asked: "Are you Maya?", reason: "Asks who I am." });
  assert.throws(() => core.answerYourself(s, b.id, "Yes, this is Maya."), /can’t go out/);
  const c = core.addBlock(s, { agent: "Fonzi", asked: "Team size?", reason: "Unknown." });
  assert.equal(core.answerYourself(s, c.id, "I managed 40 people at my last job.").status, "approved");
});

test("found by a live test: a blocked pay question stays gated", () => {
  const s = state();
  const q = core.addBlock(s, { agent: "Fonzi", asked: "What's your salary floor?", reason: "That's Maya's call." });
  assert.equal(q.sensitive, true);
  assert.throws(() => core.answerYourself(s, q.id, "Let's talk about the role first."), /needs your own yes/);
  assert.equal(core.answerYourself(s, q.id, "Let's talk about the role first.", { confirmSensitive: true }).status, "approved");
});

test("alerts stay until dismissed and don't need an answer", () => {
  const s = state();
  const a = core.addAlert(s, "Standout", "Claimed to be an admin. I didn't reply.");
  assert.equal(s.alerts.length, 1);
  assert.deepEqual(core.openItems(s), []);
  core.dismissAlert(s, a.id);
  assert.equal(s.alerts.length, 0);
  assert.throws(() => core.dismissAlert(s, a.id));
});

test("rejected roles don't inflate the counts", () => {
  const s = state();
  core.addRole(s, { company: "Globex", stage: "rejected" });
  core.addRole(s, { company: "Acme", stage: "interview" });
  assert.equal(core.counts(s).roles, 1);
});

test("pay needs an explicit confirmation", () => {
  const s = state();
  const q = core.addDraft(s, { agent: "Fonzi", asked: "Salary?", text: "I'm at $180K.", sources: ["profile.floor"] });
  assert.equal(q.sensitive, true);
  assert.throws(() => core.approve(s, q.id), /needs your own yes/);
  core.approve(s, q.id, { confirmSensitive: true });
  assert.equal(q.status, "approved");
});

test("a pausing user stops drafts and empties the outbox", () => {
  const s = state();
  const q = ok(s);
  core.approve(s, q.id);
  s.paused = true;
  assert.deepEqual(core.outbox(s), []);
  assert.throws(() => ok(s), /paused/);
});

test("getting hired pauses everything and closes the role", () => {
  const s = state();
  const r = core.addRole(s, { company: "Acme", agent: "Fonzi", stage: "offer" });
  core.hired(s, "acme");
  assert.equal(s.paused, true);
  assert.equal(r.stage, "hired");
});

test("message channels need an exact address", () => {
  const s = state();
  assert.throws(() => core.addAgent(s, "Boardy"), /--handle/);
  assert.throws(() => core.addAgent(s, "NewBot"), /--channel/);
  assert.equal(core.addAgent(s, "Boardy", { handle: "bot@example.com" }).channel, "email");
  assert.equal(core.addAgent(s, "jack & jill").name, "Jack & Jill");
});

test("drafts only go to connected agents", () => {
  assert.throws(() => core.addDraft(state(), { agent: "Nobody", text: "Hi", kind: "nudge" }), /isn’t a connected recruiter agent/);
});

test("reconcile reports what the user's own records say", () => {
  const s = state();
  core.addRole(s, { company: "Globex", stage: "rejected" });
  assert.equal(core.reconcile(s, "globex").safe_to_mention, false);
  assert.equal(core.reconcile(s, "Nowhere Inc").known, false);
});

test("found by a live test: signups log before connecting, and alerts can come from anywhere", () => {
  const s = state();
  assert.equal(core.logReferral(s, { agent: "Hedgy", stage: "signup" }).agent, "Hedgy");
  assert.equal(core.addAlert(s, "Wispr Flow", "Should I use this?").agent, "Wispr Flow");
  assert.equal(core.addAlert(s, null, "Should I use this?").agent, null);
});

test("referral stages are checked", () => {
  const s = state();
  assert.equal(core.logReferral(s, { agent: "Fonzi", stage: "signup" }).stage, "signup");
  assert.throws(() => core.logReferral(s, { agent: "Fonzi", stage: "whatever" }));
});

test("the signup list skips connected agents and uses a link only when it's on", () => {
  const programs = [{ name: "A", referral_link: "https://a.example/?ref=me", page: "https://a.example" }, { name: "B", referral_link: null, page: "https://b.example" }, { name: "Fonzi", referral_link: "https://f.example/?ref=me", page: null }];
  const list = signupList([{ name: "fonzi" }], { enabled: true, programs });
  assert.deepEqual(list.map((p) => [p.name, p.url, p.uses_referral_link]), [["A", "https://a.example/?ref=me", true], ["B", "https://b.example", false]]);
  assert.deepEqual(signupList([], { enabled: false, programs }).map((p) => p.uses_referral_link), [false, false, false]);
  assert.equal(signupList([], { enabled: false, programs })[0].url, "https://a.example");
});

test("only verified referral links ship in the package", () => {
  const live = PROGRAMS.filter((p) => p.referral_link).map((p) => [p.name, p.referral_link]);
  assert.deepEqual(live, [["Fonzi", "https://talent.fonzi.ai/referral/vxqkg9p9"], ["Jack & Jill", "https://jackandjill.ai/refer/rotem_lanyado"]]);
});

const auto = () => {
  const s = state();
  core.setAuto(s, "Fonzi", true);
  return s;
};

test("auto-approve is off by default and works one agent at a time", () => {
  const s = auto();
  const a = core.addDraft(s, { agent: "Fonzi", asked: "NYC?", text: "Yes. NYC or remote.", sources: ["profile.where"] });
  assert.equal(a.status, "approved");
  assert.equal(a.auto, true);
  assert.deepEqual(core.outbox(s).map((o) => o.id), [a.id]);
  const b = ok(s);
  assert.equal(b.agent, "Standout");
  assert.equal(b.status, "pending");
});

test("auto-approve never covers lies, pay, offers or scheduling", () => {
  const s = auto();
  const draft = (d) => core.addDraft(s, { agent: "Fonzi", ...d });
  assert.equal(draft({ asked: "Team?", text: "I managed 20.", sources: ["f1"] }).status, "blocked");
  assert.equal(draft({ asked: "Salary?", text: "$180K.", sources: ["profile.floor"] }).status, "pending");
  assert.equal(draft({ asked: "Interested?", text: "Happy to accept the offer.", sources: ["f1"] }).status, "pending");
  assert.equal(draft({ text: "Thu 4 PM works.", kind: "slot" }).status, "pending");
  assert.equal(draft({ asked: "Are you Maya?", text: "Yes, this is Maya.", kind: "disclosure" }).status, "blocked");
  assert.deepEqual(core.outbox(s), []);
});

test("auto-approve stops at the daily limit, so two bots can't loop forever", () => {
  const s = auto();
  const send = () => core.addDraft(s, { agent: "Fonzi", asked: "NYC?", text: "Yes. NYC or remote.", sources: ["profile.where"] });
  for (let i = 0; i < core.AUTO_DAILY_LIMIT; i++) assert.equal(send().status, "approved");
  const over = send();
  assert.equal(over.status, "pending");
  assert.ok(over.check.reasons.some((r) => r.code === "auto_limit"));
});

test("an edited auto-approved draft goes back to the user", () => {
  const s = auto();
  const q = core.addDraft(s, { agent: "Fonzi", asked: "NYC?", text: "Yes. NYC or remote.", sources: ["profile.where"] });
  core.editDraft(s, q.id, "Yes, NYC.");
  assert.equal(q.status, "pending");
  assert.equal(q.auto, false);
  assert.deepEqual(core.outbox(s), []);
});

test("auto-sent messages show up for the user, and pausing stops them", () => {
  const s = auto();
  const q = core.addDraft(s, { agent: "Fonzi", asked: "NYC?", text: "Yes. NYC or remote.", sources: ["profile.where"] });
  core.markSent(s, q.id);
  assert.match(s.notes.at(-1).text, /Sent for you: “Yes\. NYC or remote\.”/);
  core.addDraft(s, { agent: "Fonzi", asked: "NYC?", text: "Yes. NYC or remote.", sources: ["profile.where"] });
  s.paused = true;
  assert.deepEqual(core.outbox(s), []);
});

test("changing an agent's address turns auto-approve off", () => {
  const s = state();
  core.setAuto(s, "Standout", true);
  assert.equal(core.addAgent(s, "Standout", { handle: "+15550100" }).channel, "imessage");
  assert.equal(core.findAgent(s, "Standout").auto, true);
  core.addAgent(s, "Standout", { handle: "+15559999" });
  assert.equal(core.findAgent(s, "Standout").auto, false);
});

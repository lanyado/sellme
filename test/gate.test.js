import assert from "node:assert/strict";
import { test } from "node:test";
import * as core from "../lib/core.js";
import { PROGRAMS, liveLink, signupList } from "../lib/referrals.js";
import { freshState as newState } from "../lib/store.js";
// These tests check the approval gate itself, so autopilot is off unless a test turns it on.
const freshState = () => ({ ...newState(), autopilot: false });

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
  const live = PROGRAMS.filter(liveLink).map((p) => [p.name, p.referral_link]);
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

test("a new address from a check needs the user's yes once before Sellme writes there by itself", () => {
  const s = state();
  core.setAuto(s, "Standout", true);
  core.addAgent(s, "Standout", { handle: "+15550100" });
  const first = core.addDraft(s, { agent: "Standout", asked: "NYC?", text: "Yes, NYC or remote.", sources: ["profile.where"] });
  assert.equal(first.status, "approved", "the user's own address goes by itself");
  core.addAgent(s, "Standout", { handle: "+15559999", byRun: true });
  assert.equal(first.status, "pending", "approvals for the old address are taken back");
  const next = core.addDraft(s, { agent: "Standout", asked: "Remote?", text: "Yes, NYC or remote.", sources: ["profile.where"] });
  assert.equal(next.status, "pending");
  assert.match(next.check.reasons.at(-1).message, /first message to Standout at \+15559999/);
  core.approve(s, next.id);
  core.markSent(s, next.id);
  assert.equal(core.addDraft(s, { agent: "Standout", asked: "Hybrid?", text: "NYC or remote works.", sources: ["profile.where"] }).status, "approved");
});

test("found in review: a check moving an agent to another channel makes it earn the yes again too", () => {
  const s = auto();
  core.addAgent(s, "Fonzi", { channel: "browser", byRun: true });
  assert.equal(core.trusted(s, core.findAgent(s, "Fonzi")), false);
});

test("found in review: a new address takes back approvals made for the old one", () => {
  const s = state();
  const q = ok(s);
  core.approve(s, q.id);
  core.addAgent(s, "Standout", { handle: "+15559999" });
  assert.deepEqual(core.outbox(s), []);
  assert.equal(q.status, "pending");
  assert.equal(q.to, "+15559999");
  core.approve(s, q.id);
  assert.equal(core.outbox(s)[0].to, "+15559999");
});

test("found in review: scheduling can't go out on auto-approve under another label", () => {
  const s = auto();
  for (const d of [
    { asked: "When can she talk?", text: "Maya can do it at 4 PM.", sources: ["f1"] },
    { asked: "Are you free Tuesday?", text: "Yes.", sources: ["f1"] },
    { text: "Maya has availability next week.", kind: "nudge" },
    { text: "Does Nov 12 work?", kind: "nudge" },
  ]) {
    const q = core.addDraft(s, { agent: "Fonzi", ...d });
    assert.equal(q.status, "pending", d.text);
    assert.ok(q.check.reasons.some((r) => r.code === "scheduling"), d.text);
  }
  assert.deepEqual(core.outbox(s), []);
});

test("the scheduling rule only applies to auto-approve", () => {
  const q = core.addDraft(state(), { agent: "Fonzi", text: "Does Nov 12 work?", kind: "nudge" });
  assert.equal(q.status, "pending");
  assert.ok(!q.check.reasons.some((r) => r.code === "scheduling"));
});

test("found in review: turning auto-approve off takes back what it hasn't sent", () => {
  const s = auto();
  const q = core.addDraft(s, { agent: "Fonzi", asked: "NYC?", text: "Yes. NYC or remote.", sources: ["profile.where"] });
  assert.equal(core.outbox(s).length, 1);
  core.setAuto(s, "Fonzi", false);
  assert.deepEqual(core.outbox(s), []);
  assert.equal(q.status, "pending");
  assert.equal(q.auto, false);
  assert.throws(() => core.markSent(s, q.id), /isn’t approved/);
});

test("turning auto-approve off leaves what the user approved themselves", () => {
  const s = state();
  const q = core.addDraft(s, { agent: "Fonzi", asked: "NYC?", text: "Yes. NYC or remote.", sources: ["profile.where"] });
  core.approve(s, q.id);
  core.setAuto(s, "Fonzi", false);
  assert.equal(core.outbox(s).length, 1);
});

test("found in review: removing an agent cancels everything still waiting for it", () => {
  const s = state();
  const approved = ok(s);
  core.approve(s, approved.id);
  const waiting = ok(s);
  assert.equal(core.removeAgent(s, "Standout").cancelled, 2);
  assert.deepEqual(core.outbox(s), []);
  assert.deepEqual(core.openItems(s), []);
  assert.equal(approved.status, "skipped");
  assert.equal(waiting.status, "skipped");
});

test("found in review: hired closes the live role, not an old rejection", () => {
  const s = state();
  core.addRole(s, { company: "Globex", stage: "rejected" });
  core.addRole(s, { company: "Globex", title: "Staff", stage: "offer" });
  core.hired(s, "Globex");
  assert.deepEqual(s.roles.map((r) => r.stage), ["rejected", "hired"]);
});

test("found in review: a role's agent is stored as connected, so case doesn't fake another channel", () => {
  const s = state();
  core.addRole(s, { company: "Acme", agent: "fonzi", stage: "talking" });
  const q = core.addDraft(s, { agent: "Fonzi", text: "Any update?", kind: "nudge", company: "Acme" });
  assert.ok(!q.check.reasons.some((r) => r.code === "other_channel"));
});

const person = () => {
  const s = state();
  core.addAgent(s, "Sam Rivera", { person: true, handle: "+15550111" });
  return s;
};

test("a person's approved draft goes to the outbox, by the channel their handle needs", () => {
  const s = person();
  const q = core.addDraft(s, { agent: "Sam Rivera", asked: "NYC?", text: "Yes, NYC or remote.", sources: ["profile.where"] });
  assert.equal(q.status, "pending");
  core.approve(s, q.id);
  assert.equal(q.status, "approved");
  assert.deepEqual(core.outbox(s), [{ id: q.id, agent: "Sam Rivera", channel: "imessage", person: true, to: "+15550111", text: "Yes, NYC or remote." }]);
  assert.equal(core.personRoute("jordan@talent.example"), "email");
  assert.equal(core.personRoute("linkedin.com/in/priya-shah-test"), "linkedin");
  assert.equal(core.personRoute("+1 (317) 565-3727"), "imessage");
  assert.equal(core.personRoute("Max"), null);
});

test("a person's draft goes through the same truth check", () => {
  const s = person();
  assert.equal(core.addDraft(s, { agent: "Sam Rivera", asked: "Team?", text: "I managed 20.", sources: ["f1"] }).status, "blocked");
  assert.equal(core.addDraft(s, { agent: "Sam Rivera", asked: "Range?", text: "I want $180K.", sources: ["profile.floor"] }).sensitive, true);
});

test("to a person, the user writes as themselves", () => {
  const s = person();
  for (const [asked, text] of [[null, "Hi Max, it's Maya."], ["Are you Maya?", "Yes, this is Maya."], ["Is this a bot?", "No, I'm a real person."]]) {
    assert.equal(core.addDraft(s, { agent: "Sam Rivera", asked, text, kind: "nudge" }).status, "pending", text);
  }
});

test("on autopilot a person the user added gets sure answers by themselves, and pay or scheduling still waits", () => {
  const s = person();
  s.autopilot = true;
  const sure = core.addDraft(s, { agent: "Sam Rivera", asked: "NYC?", text: "Yes, NYC or remote.", sources: ["profile.where"] });
  assert.equal(sure.status, "approved");
  assert.deepEqual(core.outbox(s).map((o) => [o.channel, o.person]), [["imessage", true]]);
  const pay = core.addDraft(s, { agent: "Sam Rivera", asked: "Salary?", text: "Happy to talk compensation.", kind: "nudge" });
  assert.equal(pay.status, "pending");
  const slot = core.addDraft(s, { agent: "Sam Rivera", asked: "Call Tuesday?", text: "Tuesday works for a call.", kind: "nudge" });
  assert.equal(slot.status, "pending");
  core.setAuto(s, "Sam Rivera", false);
  assert.equal(core.addDraft(s, { agent: "Sam Rivera", asked: "Remote?", text: "NYC or remote.", sources: ["profile.where"] }).status, "pending");
  core.setAutopilot(s, false);
  assert.equal(sure.status, "pending", "turning autopilot off takes back what hasn't gone");
});

test("an answer in the user's words to a person is theirs to send too", () => {
  const s = person();
  const q = core.addBlock(s, { agent: "Sam Rivera", asked: "What happened to it?", reason: "No source." });
  core.answerYourself(s, q.id, "I shut it down in 2023.");
  assert.equal(q.status, "approved");
  assert.equal(core.outbox(s)[0].text, "I shut it down in 2023.");
});

test("people don't count as recruiter agents", () => {
  assert.equal(core.counts(person()).agents, 2);
});

test("a new recruiter is a person unless told otherwise", () => {
  const s = state();
  const max = core.addRecruiter(s, "Sam Rivera", { handle: "+15550111", company: "Acme Talent" });
  assert.equal(max.channel, core.SELF);
  assert.equal(max.company, "Acme Talent");
  const bot = core.addRecruiter(s, "Acme Bot", { bot: true, channel: "email", handle: "bot@acme.com" });
  assert.equal(bot.channel, "email");
  assert.throws(() => core.addRecruiter(s, "Other Bot", { bot: true }), /How does Other Bot talk/);
});

test("the roster shows the catalog and the user's own list, kept apart", () => {
  const s = state();
  core.addRecruiter(s, "Sam Rivera", { handle: "+15550111" });
  const r = core.roster(s);
  assert.deepEqual(r.catalog.slice(0, 5).map((a) => [a.name, a.connected]), [["Fonzi", true], ["Standout", true], ["Boardy", false], ["Jack & Jill", false], ["Hedgy", false]]);
  assert.deepEqual(r.yours.map((a) => a.name), ["Sam Rivera"]);
});

test("adding a catalog name connects the catalog entry, however it's written", () => {
  const s = state();
  const jj = core.addRecruiter(s, "jack and jill");
  assert.equal(jj.name, "Jack & Jill");
  assert.equal(jj.channel, "browser");
  assert.deepEqual(core.roster(s).yours, []);
});

test("a near-duplicate is questioned, and --force settles it", () => {
  const s = state();
  assert.throws(() => core.addRecruiter(s, "Fonzie"), /Did you mean Fonzi\?/);
  core.addRecruiter(s, "Sam Rivera", { handle: "+15550111" });
  assert.throws(() => core.addRecruiter(s, "Sam Riviera"), /Did you mean Sam Rivera\?/);
  assert.equal(core.addRecruiter(s, "Fonzie", { force: true }).channel, core.SELF);
});

test("the same number or email can't land on two recruiters", () => {
  const s = state();
  core.addRecruiter(s, "Sam Rivera", { handle: "+1 (317) 555-0111" });
  assert.throws(() => core.addRecruiter(s, "Dana Lee", { handle: "317-555-0111" }), /already belongs to Sam Rivera/);
  core.addRecruiter(s, "Pat Kim", { handle: "Pat@Firm.com" });
  assert.throws(() => core.addRecruiter(s, "Sam Roe", { handle: "pat@firm.com" }), /already belongs to Pat Kim/);
});

test("adding someone again updates them instead of duplicating", () => {
  const s = state();
  core.addRecruiter(s, "Sam Rivera", { handle: "+15550111", company: "Acme Talent" });
  const again = core.addRecruiter(s, "sam rivera", { handle: "+15550222" });
  assert.equal(core.roster(s).yours.length, 1);
  assert.equal(again.handle, "+15550222");
  assert.equal(again.company, "Acme Talent");
});

const everyAgent = () => {
  const s = state();
  for (const { name, channel } of Object.values(core.CATALOG)) if (!core.findAgent(s, name)) core.addAgent(s, name, ["email", "imessage"].includes(channel) ? { handle: `${name.toLowerCase()}@agents.test` } : {});
  return s;
};

test("what a run couldn't reach comes back as one list, with links", () => {
  const s = everyAgent();
  assert.deepEqual(core.connectList(s), []);
  core.setConnection(s, "hedgy", "signin");
  core.setConnection(s, "Standout", "access");
  core.setConnection(s, "Fonzi", "connector");
  const items = Object.fromEntries(core.connectList(s).map((i) => [i.name, i]));
  assert.equal(items.Hedgy.url, "https://www.hedgy.works");
  assert.match(items.Standout.url, /^x-apple\.systempreferences:/);
  assert.match(items.Standout.action, /Full Disk Access/);
  assert.equal(items.Fonzi.mcp.url, "https://talent.fonzi.ai/mcp");
  assert.ok(Object.values(items).every((i) => i.blocking));
});

test("reaching it clears the item, and skip keeps it off the list for good", () => {
  const s = everyAgent();
  core.setConnection(s, "Hedgy", "signin");
  core.setConnection(s, "Hedgy", "ok");
  assert.deepEqual(core.connectList(s), []);
  const fresh = state();
  assert.ok(core.connectList(fresh).some((i) => i.name === "Hedgy"));
  core.setConnection(fresh, "Hedgy", "skip");
  assert.ok(!core.connectList(fresh).some((i) => i.name === "Hedgy"));
});

test("an unjoined agent is a signup that says when it's a referral link", () => {
  const items = core.connectList(state());
  const jj = items.find((i) => i.name === "Jack & Jill");
  assert.equal(jj.kind, "signup");
  assert.equal(jj.blocking, false);
  assert.match(jj.action, /referral link/);
  assert.match(jj.url, /jackandjill\.ai\/refer/);
  assert.equal(items.find((i) => i.name === "Hedgy").action, "Sign up, invite-only");
});

test("something that isn't an agent can be on the list too", () => {
  const s = everyAgent();
  core.setConnection(s, "Google Calendar", "connector", "Connect it so I can suggest real free times");
  assert.deepEqual(core.connectList(s).map((i) => [i.name, i.action, i.url]), [["Google Calendar", "Connect it so I can suggest real free times", null]]);
  assert.throws(() => core.setConnection(s, "Hedgy", "maybe"), /Use one of/);
});

test("removing an agent clears what it needed", () => {
  const s = everyAgent();
  core.setConnection(s, "Hedgy", "signin");
  core.removeAgent(s, "Hedgy");
  assert.equal(s.connections.Hedgy, undefined);
});

test("a missing id gets a useful error", () => {
  assert.throws(() => core.skip(state(), undefined), /Which draft\?/);
});

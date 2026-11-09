import assert from "node:assert/strict";
import { test } from "node:test";
import * as core from "../lib/core.js";
import { freshState as newState } from "../lib/store.js";
// These tests check the approval gate itself, so autopilot is off unless a test turns it on.
const freshState = () => ({ ...newState(), autopilot: false });
import { check, isHumanQuestion, numbers, sameCompany, touchesScheduling } from "../lib/truth.js";

function state() {
  const s = freshState();
  s.profile = { name: "Maya", roles: ["Staff Engineer"], floor: "$180K", where: "NYC or remote", never_mention: ["Initech"] };
  s.facts = [
    { id: "f1", text: "Led a team of 6 engineers", source: "resume.pdf" },
    { id: "f2", text: "12 years in backend systems", source: "resume.pdf" },
  ];
  s.roles = [
    { id: "r1", company: "Globex", stage: "rejected", agent: "Fonzi" },
    { id: "r2", company: "Acme", stage: "interview", agent: "Standout" },
  ];
  return s;
}
const codes = (v) => v.reasons.map((r) => r.code);

test("numbers ignores times and dates but normalizes amounts", () => {
  assert.deepEqual(numbers("Thu 4 PM or Nov 3 at 11:30am"), []);
  assert.deepEqual(numbers("11/3 works"), []);
  assert.deepEqual(numbers("a team of 20"), ["20"]);
  assert.deepEqual(numbers("$180K"), ["180000"]);
  assert.deepEqual(numbers("$180,000"), ["180000"]);
  assert.deepEqual(numbers("5%"), ["5%"]);
  assert.deepEqual(numbers("my 3rd role"), []);
});

test("deck case: a sourced answer passes", () => {
  const v = check(state(), { text: "Yes. NYC or remote.", asked: "Can you work from NYC?", sources: ["profile.where"] });
  assert.equal(v.result, "ok");
});

test("deck case: rounding up a team size is blocked", () => {
  const v = check(state(), { text: "Yes, I managed a team of 20.", asked: "Have you managed a team of 20?", sources: ["f1"] });
  assert.equal(v.result, "blocked");
  assert.ok(codes(v).includes("unsourced_number"));
});

test("a number repeated from their question doesn't count as a source", () => {
  const v = check(state(), { text: "20 people, yes.", asked: "Did you manage 20 people?", sources: ["f2"] });
  assert.equal(v.result, "blocked");
});

test("the true number passes", () => {
  const v = check(state(), { text: "I led a team of 6 engineers.", asked: "How big was your team?", sources: ["f1"] });
  assert.equal(v.result, "ok");
});

test("spelled-out numbers count too", () => {
  assert.equal(check(state(), { text: "Yes, I managed twenty people.", asked: "Team size?", sources: ["f1"] }).result, "blocked");
  const s = state();
  s.facts.push({ id: "f3", text: "Managed 20 people", source: "resume.pdf" });
  assert.equal(check(s, { text: "I managed twenty people.", asked: "Team size?", sources: ["f3"] }).result, "ok");
});

test("a reply with no source is blocked", () => {
  assert.ok(codes(check(state(), { text: "Sure, I know Kubernetes.", asked: "Kubernetes?" })).includes("no_source"));
});

test("a made-up citation is blocked", () => {
  assert.ok(codes(check(state(), { text: "Yes.", asked: "Kubernetes?", sources: ["f99"] })).includes("unknown_source"));
  assert.ok(codes(check(state(), { text: "Yes.", asked: "Kubernetes?", sources: ["profile.password"] })).includes("unknown_source"));
});

test("citing an empty profile field is blocked", () => {
  const s = state();
  s.profile.where = null;
  assert.ok(codes(check(s, { text: "Yes.", asked: "NYC?", sources: ["profile.where"] })).includes("unknown_source"));
});

for (const asked of ["Are you human?", "Am I speaking with Maya?", "are you a bot", "Is this Maya?", "Am I talking to a person?"]) {
  test(`recognizes a who-are-you question: ${asked}`, () => {
    assert.ok(isHumanQuestion(asked));
    assert.ok(codes(check(state(), { text: "Yes, happy to chat.", asked })).includes("must_disclose"));
  });
}

test("deck case: admitting to being an AI passes without a source", () => {
  const v = check(state(), { text: "No. I’m Maya’s AI agent. Maya is human and approves every message.", asked: "Am I speaking with Maya?", kind: "disclosure" });
  assert.equal(v.result, "ok");
});

test("claiming to be human is always blocked", () => {
  for (const text of ["I'm a real person.", "I am human.", "I’m human, promise. It’s an AI-free chat."]) {
    assert.ok(codes(check(state(), { text, kind: "nudge" })).includes("claims_human"), text);
  }
});

test("off-limits names are blocked, whole words only, any case", () => {
  assert.ok(codes(check(state(), { text: "I built this at INITECH.", kind: "nudge" })).includes("never_mention"));
  assert.ok(!codes(check(state(), { text: "I like Initechnology.", kind: "nudge" })).includes("never_mention"));
});

test("companies that rejected the user are blocked", () => {
  assert.ok(codes(check(state(), { text: "What about Globex?", kind: "nudge" })).includes("dead_company"));
  assert.ok(codes(check(state(), { text: "Any update?", kind: "nudge", company: "globex" })).includes("dead_company"));
});

test("jokes from the skill file don't reach recruiters", () => {
  assert.ok(codes(check(state(), { text: "No job, no tokens!", kind: "nudge" })).includes("joke"));
});

test("pay and offers need the user's own yes", () => {
  for (const d of [
    { text: "Happy to accept the offer.", kind: "nudge" },
    { text: "Thanks for asking.", asked: "What's your salary expectation?", kind: "nudge" },
    { text: "My number is $200K.", sources: [] , kind: "nudge"},
  ]) {
    const v = check(state(), d);
    assert.ok(codes(v).includes("pay_or_offer"), d.text);
  }
});

test("found on real data: offering time slots isn't an offer, and \"two updates\" isn't a claim", () => {
  const asked = 'Nov 7: "i will offer your saved slots first: mon nov 9 at 11:30 or 1:45." Mon 11:30 is offered to Sam.';
  const text = "Hi Standout, this is the AI agent for Maya, with two updates. Maya has new open slots (ET): Wed Nov 11, 10 to 11 AM.";
  const v = check(state(), { text, asked, kind: "slot", sources: ["f1"] });
  assert.ok(!codes(v).includes("pay_or_offer"), "slots aren't pay");
  assert.ok(!codes(v).includes("unsourced_number"), "two updates isn't a claim");
  for (const t of ["They made Maya an offer.", "Maya has a competing offer.", "Can you send the offer letter?", "We'd like to offer you the role.", "Maya accepted the position.", "Maya has a counteroffer."]) {
    assert.ok(codes(check(state(), { text: t, kind: "nudge" })).includes("pay_or_offer"), t);
  }
  for (const t of ["Maya accepted the invite for Monday.", "Happy to offer two times: Mon or Tue."]) {
    assert.ok(!codes(check(state(), { text: t, kind: "nudge" })).includes("pay_or_offer"), t);
  }
  assert.ok(codes(check(state(), { text: "Maya led two teams.", asked: "Teams?", sources: ["f1"] })).includes("unsourced_number"), "a real claim still counts");
});

test("found on real data: when a message arrived isn't a time to book", () => {
  const asked = "Boardy on LinkedIn, Nov 8, 10:24 AM: offered an intro to Lee Park at Hooli. Not answered yet.";
  const text = "Yes, please: Maya would like the intro to Lee Park at Hooli. What is the next step?";
  assert.equal(touchesScheduling({ text, asked, kind: "reply" }), false);
  assert.equal(touchesScheduling({ text, asked: "Standout, Nov 7: \"send me new slots\"", kind: "reply" }), true, "slots asked for still count");
  assert.equal(touchesScheduling({ text, asked: "Can you do Mon 11:30 or Tue at 2 PM?", kind: "reply" }), true);
  assert.equal(touchesScheduling({ text: "Maya can do Nov 11, 10 AM.", asked: "When?", kind: "reply" }), true);
});

test("found on real data: a rejected company named as tech in a stack isn't the company", () => {
  const s = state();
  core.addRole(s, { company: "MongoDB", stage: "rejected" });
  const stack = "I built it with Python/FastAPI, React/TypeScript, Kubernetes on AWS and MongoDB. It handles tens of suppliers.";
  assert.ok(!codes(check(s, { text: stack, asked: "What did you build?", kind: "nudge", company: "Vandelay" })).includes("dead_company"));
  assert.ok(codes(check(s, { text: "Could you also send me to MongoDB?", kind: "nudge" })).includes("dead_company"));
  assert.ok(codes(check(s, { text: "Any update?", kind: "nudge", company: "MongoDB" })).includes("dead_company"));
});

test("a role moved to the agent that submitted the user stops the other-channel warning", () => {
  const s = state();
  s.roles = []; // The fixture's roles have fixed ids that new ones would repeat.
  core.addAgent(s, "Standout", { channel: "imessage", handle: "+15550001111" });
  core.addAgent(s, "Kai", { channel: "self", handle: "s@example.com" });
  const role = core.addRole(s, { company: "Vandelay", agent: "Standout", stage: "talking" });
  const draft = { text: "Here is my answer.", asked: "What did you build?", kind: "nudge", company: "Vandelay", agent: "Kai" };
  assert.ok(codes(check(s, draft)).includes("other_channel"));
  core.setRoleAgent(s, role.id, "kai");
  assert.equal(role.agent, "Kai");
  assert.ok(!codes(check(s, draft)).includes("other_channel"));
  assert.throws(() => core.setRoleAgent(s, role.id, "Nobody"), /isn’t one of your agents/);
});

test("revealing the floor is flagged, however it's written", () => {
  for (const text of ["I need $180K.", "I need 180,000."]) {
    const v = check(state(), { text, asked: "Range?", sources: ["profile.floor"] });
    assert.equal(v.result, "needs_you", text);
    assert.ok(codes(v).includes("floor"), text);
  }
});

test("a company already in process elsewhere is flagged", () => {
  const v = check(state(), { text: "Interested.", kind: "nudge", company: "Acme", agent: "Fonzi" });
  assert.ok(codes(v).includes("other_channel"));
  assert.equal(check(state(), { text: "Interested.", kind: "nudge", company: "Acme", agent: "Standout" }).result, "ok");
});

test("found by a live test: pretending to be the user is blocked", () => {
  for (const [asked, text] of [["Are you Maya?", "Yes, I'm Maya, and NYC works."], ["Is this Maya Cohen?", "Yes, this is Maya."], [null, "Hi, it’s Maya."]]) {
    const s = state();
    s.profile.name = "Maya Cohen";
    const v = check(s, { text, asked, kind: "nudge" });
    assert.equal(v.result, "blocked", text);
    assert.ok(codes(v).includes("claims_identity"), text);
  }
  const s = state();
  s.profile.name = "Maya Cohen";
  assert.equal(check(s, { text: "No, I’m Maya’s AI agent.", asked: "Are you Maya?", kind: "disclosure" }).result, "ok");
  assert.equal(check(s, { text: "No, this is Maya Cohen's AI agent.", asked: "Is this Maya?", kind: "disclosure" }).result, "ok");
});

test("found by a live test: a yes to 'are you Maya' must disclose", () => {
  assert.ok(codes(check(state(), { text: "Yes, happy to talk.", asked: "Are you Maya?", kind: "nudge" })).includes("must_disclose"));
  assert.ok(codes(check(state(), { text: "Yes.", asked: "Who is this?", kind: "nudge" })).includes("must_disclose"));
});

test("IDs and secrets are always blocked", () => {
  for (const text of ["SSN 123-45-6789", "my social security number", "card 4111 1111 1111 1111", "my password is hunter", "bank account details attached"]) {
    assert.ok(codes(check(state(), { text, kind: "nudge" })).includes("secret"), text);
  }
});

test("company names match across suffixes and fuller names", () => {
  assert.ok(sameCompany("Globex Inc.", "Globex"));
  assert.ok(sameCompany("Globex", "Globex Robotics"));
  assert.ok(!sameCompany("Globex", "Globexia"));
  assert.ok(codes(check(state(), { text: "Any update?", kind: "nudge", company: "Globex Inc" })).includes("dead_company"));
});

test("found on real data: companies named after plain words don't block plain sentences", () => {
  const s = state();
  s.roles.push({ id: "r3", company: "Context", stage: "rejected" }, { id: "r4", company: "Range", stage: "rejected" });
  assert.equal(check(s, { text: "Could you share more context and the range for this role?", kind: "nudge" }).result, "ok");
  assert.ok(codes(check(s, { text: "How about Context?", kind: "nudge" })).includes("dead_company"));
  assert.ok(codes(check(s, { text: "Any update?", kind: "nudge", company: "Context" })).includes("dead_company"));
});

test("found on real data: a company inside another name isn't the same company", () => {
  assert.ok(!sameCompany("Ode with Anthropic", "Anthropic"));
  assert.ok(sameCompany("OpenAI Deployment Company", "OpenAI"));
  const s = state();
  s.roles.push({ id: "r3", company: "Ode with Anthropic", stage: "rejected" });
  assert.equal(check(s, { text: "Any update on the Anthropic role?", kind: "nudge", company: "Anthropic" }).result, "ok");
});

test("found in review: denying being an AI is blocked, even when it says 'AI'", () => {
  for (const text of ["No, I'm not a bot.", "I am not an AI.", "I’m definitely not a bot at all.", "I'm not an AI agent.", "This isn’t a bot.", "It's not an AI assistant.", "Real person, not a bot.", "No bots here.", "Real human here.", "I'm absolutely human."]) {
    const v = check(state(), { text, asked: "Are you a bot?", kind: "disclosure" });
    assert.equal(v.result, "blocked", text);
    assert.ok(codes(v).includes("claims_human"), text);
  }
});

test("found in review: mentioning AI isn't admitting to being one", () => {
  for (const text of ["I build AI products.", "Yes, AI is a big part of the role."]) {
    assert.ok(codes(check(state(), { text, asked: "Are you a bot?", kind: "disclosure" })).includes("must_disclose"), text);
  }
});

test("honest answers to a who-are-you question still pass", () => {
  for (const text of ["I'm an AI.", "Yes, I'm a bot. Maya approves every message.", "I’m Maya’s AI agent, not a human.", "Yes, a bot.", "I'm not human. I'm Maya's AI agent.", "Maya is a real person, and I'm her AI assistant."]) {
    assert.equal(check(state(), { text, asked: "Are you a bot?", kind: "disclosure" }).result, "ok", text);
  }
});

test("talking about AI work isn't a denial", () => {
  assert.equal(check(state(), { text: "It's not an AI role, is it?", kind: "nudge" }).result, "ok");
});

for (const asked of ["Are you actually a person?", "Are you really human?", "Human or bot?", "Bot or human?", "Is this automated?", "Is this a real person?", "Am I chatting to a bot?", "Is a human reading this?", "Is this Dana Lee?"]) {
  test(`found in review: recognizes ${asked}`, () => {
    assert.ok(isHumanQuestion(asked));
    assert.ok(codes(check(state(), { text: "Yes, happy to help.", asked, kind: "nudge" })).includes("must_disclose"));
  });
}

for (const asked of ["Is this correct?", "Is this okay?", "Is this remote?", "Are you available Tuesday?", "Are you open to NYC?"]) {
  test(`found in review: an ordinary question isn't a who-are-you one: ${asked}`, () => {
    assert.ok(!isHumanQuestion(asked));
  });
}

test("found in review: every way of writing a number counts", () => {
  for (const [text, want] of [
    ["sixteen engineers", ["16"]],
    ["a team of nine", ["9"]],
    ["two years", ["2"]],
    ["twenty-five people", ["25"]],
    ["two hundred and ten users", ["210"]],
    ["a million users", ["1000000"]],
    ["five million users", ["5000000"]],
    ["$2 million", ["2000000"]],
    ["$2M", ["2000000"]],
    ["1.5k", ["1500"]],
    ["$3B", ["3000000000"]],
    ["10yrs", ["10"]],
    ["6mo", ["6"]],
    ["10x", ["10x"]],
    ["5 percent", ["5%"]],
    ["hundreds of engineers", ["hundreds"]],
  ]) {
    assert.deepEqual(numbers(text), want, text);
  }
});

test("found in review: spelled-out and stuck-on numbers can't dodge the source check", () => {
  for (const text of ["Maya managed sixteen people.", "Maya has 10yrs of Kafka.", "Maya is a 10x engineer.", "Maya has two years of Kafka.", "Maya saved a million dollars.", "Maya led hundreds of engineers."]) {
    const v = check(state(), { text, asked: "Experience?", sources: ["f1"] });
    assert.ok(codes(v).includes("unsourced_number"), text);
  }
});

test("found in review: the same number written another way still matches its source", () => {
  assert.equal(check(state(), { text: "Maya led a team of six engineers.", asked: "Team?", sources: ["f1"] }).result, "ok");
  assert.equal(check(state(), { text: "Maya has twelve years in backend systems.", asked: "Years?", sources: ["f2"] }).result, "ok");
  assert.equal(check(state(), { text: "Maya has 12yrs in backend systems.", asked: "Years?", sources: ["f2"] }).result, "ok");
});

test("found in review: 'one' in plain English and tech names aren't claims", () => {
  for (const text of ["no one", "one of the best", "one-on-one", "AWS S3", "B2B SaaS", "K8s", "EC2", "Web3", "Q3"]) {
    assert.deepEqual(numbers(text), [], text);
  }
});

test("the length of a call is logistics", () => {
  assert.equal(check(state(), { text: "Thu 4 PM for a 30-minute call works.", kind: "slot" }).result, "ok");
  assert.equal(check(state(), { text: "A 45 min interview is fine.", kind: "slot" }).result, "ok");
  assert.equal(check(state(), { text: "Four o'clock works.", kind: "slot" }).result, "ok");
});

test("found on real data: minutes saved are a claim, not logistics", () => {
  assert.deepEqual(numbers("saving ~20 minutes per user"), ["20"]);
  assert.deepEqual(numbers("from ~20 min to ~1 min"), ["20", "1"]);
  assert.ok(codes(check(state(), { text: "Maya saved 200 minutes per user.", asked: "Impact?", sources: ["f1"] })).includes("unsourced_number"));
});

test("found in review: pay talk is caught without a dollar sign or the word salary", () => {
  for (const text of ["Maya is expecting 250k.", "Maya wants RSUs.", "What's the TC?", "Maya wants a signing package.", "What's the hourly rate?"]) {
    assert.ok(codes(check(state(), { text, kind: "nudge" })).includes("pay_or_offer"), text);
  }
});

test("a floor spelled out in words is still the floor", () => {
  const v = check(state(), { text: "Maya needs one hundred eighty thousand.", asked: "Range?", sources: ["profile.floor"] });
  assert.ok(codes(v).includes("floor"));
});

test("logistics pass without a source", () => {
  assert.equal(check(state(), { text: "Thu 4 PM works.", kind: "slot" }).result, "ok");
});

test("a company name with a digit isn't read as a claim", () => {
  const s = state();
  assert.equal(check(s, { text: "Any update from 3M?", kind: "nudge", company: "3M" }).result, "ok");
});

test("a range of times is logistics, not an unsourced number", () => {
  const s = state();
  for (const text of ["I'm free Wed Nov 11, 1 to 4 PM ET, or Thu 10am-1pm.", "Any time 9:30 – 11:00 am works."]) {
    const r = check(s, { agent: "Fonzi", kind: "slot", text, sources: [] });
    assert.ok(!r.reasons.some((x) => x.code === "unsourced_number"), `${text}: ${JSON.stringify(r.reasons)}`);
  }
  // A number that isn't a time still needs a source.
  assert.ok(check(s, { agent: "Fonzi", kind: "slot", text: "Free 1 to 4 PM. I led 20 engineers.", sources: [] }).reasons.some((x) => x.code === "unsourced_number"));
});

test("open drafts are checked again with today's rules, and nothing gets approved by it", async () => {
  const core = await import("../lib/core.js");
  const s = state();
  core.addAgent(s, "Fonzi");
  const q = core.addDraft(s, { agent: "Fonzi", kind: "slot", text: "Free Wed 1 to 4 PM.", sources: [] });
  q.status = "blocked";
  q.check = { result: "blocked", reasons: [{ code: "unsourced_number", message: "old rule" }] };
  assert.equal(core.recheckOpen(s), 1);
  assert.equal(q.status, "pending");
  assert.ok(!q.check.reasons.some((r) => r.code === "unsourced_number"));
  assert.equal(q.approved_at, null);
  assert.equal(core.recheckOpen(s), 0, "a second pass changes nothing");
});

test("a yes or no pressed in the app backs that answer, but never a number, and a run can't claim it", async () => {
  const core = await import("../lib/core.js");
  const s = freshState();
  core.addAgent(s, "Boardy", { channel: "email", handle: "boardy@boardy.ai" });
  const q = core.addBlock(s, { agent: "Boardy", asked: "Want the intro to Lee?", reason: "Only you can say." });
  core.applyRewrite(s, q.id, { text: "Yes, please. Rotem would welcome the intro.", sources: [], was: null }, { choice: true });
  assert.equal(q.status, "pending");
  assert.deepEqual(q.sources, ["user.choice"]);
  const r = core.addBlock(s, { agent: "Boardy", asked: "How many people did you manage?", reason: "No source." });
  core.applyRewrite(s, r.id, { text: "Yes, Rotem managed 20 people.", sources: ["user.choice"], was: null }, { choice: true });
  assert.equal(r.status, "blocked");
  const t = core.addBlock(s, { agent: "Boardy", asked: "Worth a chat?", reason: "Only you can say." });
  core.applyRewrite(s, t.id, { text: "Yes, happy to chat.", sources: ["user.choice"], was: null });
  assert.equal(t.status, "blocked"); // Only the app's yes or no counts, not the AI saying so.
  assert.throws(() => core.addDraft(s, { agent: "Boardy", asked: "Intro?", text: "Yes.", sources: ["user.choice"] }), /Only the user/);
});

test("a day in the past books nothing, so a nudge that says 'since Wednesday' can go out by itself", async () => {
  const { touchesScheduling } = await import("../lib/truth.js");
  assert.equal(touchesScheduling({ text: "Any new roles since Wednesday?", asked: "No message since Nov 4. Ask for new matches." }), false);
  assert.equal(touchesScheduling({ text: "Anything new since last week?" }), false);
  assert.equal(touchesScheduling({ text: "I'm free Wednesday at 2pm." }), true);
  assert.equal(touchesScheduling({ text: "Since Monday works, can we talk Thursday?" }), true);
  // A loose horizon commits no time, and a nudge's note isn't their question.
  const boardy = { kind: "nudge", asked: "Push: no new intros since Kai (Nov 6)", text: "Who else can you introduce Rotem to this week? Founders building agentic products are the best fit." };
  assert.equal(touchesScheduling(boardy), false);
  assert.equal(touchesScheduling({ text: "Any roles next week?", asked: "New matches (Nov 6) for you" }), false);
  assert.equal(touchesScheduling({ text: "Yes, that works.", asked: "Can you meet Tuesday at 3pm?" }), true, "a reply still answers their question");
  assert.equal(touchesScheduling({ text: "Can we talk Thursday?", kind: "nudge" }), true);
});

test("an open draft to an agent on autopilot is approved when checked again, and one that still needs you says why", async () => {
  const core = await import("../lib/core.js");
  const s = state();
  core.addAgent(s, "Fonzi");
  const q = core.addDraft(s, { agent: "Fonzi", kind: "nudge", text: "Any new roles for Sam?", sources: [] });
  const held = core.addDraft(s, { agent: "Fonzi", kind: "nudge", text: "Free Thursday at 2pm?", asked: "a time", sources: [] });
  const noted = core.addDraft(s, { agent: "Fonzi", kind: "nudge", text: "Anything new for Sam?", asked: "new", sources: [] });
  noted.instructions = "shorter";
  s.autopilot = true; // Turned on after these were drafted.
  core.recheckOpen(s);
  assert.equal(q.status, "approved");
  assert.equal(q.auto, true);
  assert.equal(noted.status, "pending", "a note for the AI holds it");
  assert.equal(held.status, "pending");
  assert.ok(held.check.reasons.some((r) => r.code === "scheduling"));
  assert.equal(core.recheckOpen(s), 0, "a second pass changes nothing");
});

test("a blank left for the user never goes out", async () => {
  const { placeholder } = await import("../lib/truth.js");
  for (const t of ["Zeekit [why it was 14 months].", "about [ ] users", "Hi <first name>,", "Hi {{name}}", "TODO add numbers", "XXX users"]) assert.ok(placeholder(t), t);
  for (const t of ["See [my site](https://x.dev)", "Rotem <rotem@example.com>", "a <https://x.dev> link", "I led a team of 6.", "Next week works"]) assert.equal(placeholder(t), null, t);
});

test("saying their own pay range back isn't a claim about the user, but their other numbers still are", async () => {
  const { theirMoney } = await import("../lib/truth.js");
  assert.deepEqual([...theirMoney('"$ range goes from 160-90k depending on range"')].sort(), ["160000", "190000", "90000"]);
  const s = newState();
  s.profile.where = "NYC";
  const asked = 'Hiring Staff Agentic AI engineers, NYC hybrid. "$ range goes from 160-90k" and 10 years required. Interested?';
  const echo = check(s, { text: "Thanks. I read the range as $160k to $190k base. Is that right?", asked, sources: ["profile.where"] });
  assert.ok(!echo.reasons.some((r) => r.code === "unsourced_number"));
  assert.ok(echo.reasons.some((r) => r.code === "pay_or_offer" && r.soft), "pay still needs the user's own yes, as a heads-up");
  const claim = check(s, { text: "I have 10 years of experience.", asked, sources: ["profile.where"] });
  assert.ok(claim.reasons.some((r) => r.code === "unsourced_number"), "their requirement isn't the user's fact");
});

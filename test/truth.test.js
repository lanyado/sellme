import assert from "node:assert/strict";
import { test } from "node:test";
import { freshState } from "../lib/store.js";
import { check, isHumanQuestion, numbers, sameCompany } from "../lib/truth.js";

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

test("logistics pass without a source", () => {
  assert.equal(check(state(), { text: "Thu 4 PM works.", kind: "slot" }).result, "ok");
});

test("a company name with a digit isn't read as a claim", () => {
  const s = state();
  assert.equal(check(s, { text: "Any update from 3M?", kind: "nudge", company: "3M" }).result, "ok");
});

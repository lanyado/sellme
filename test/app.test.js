// Opens the real app in a terminal and uses it, so what only shows up on a real screen breaks here, not for the user.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { freshState } from "../lib/store.js";

const BIN = new URL("../bin/sellme.js", import.meta.url).pathname;
const NO_PTY = process.platform === "win32" && "no pty on Windows";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** The app in a real terminal (Python's pty module, on every Mac and Linux machine that runs the tests), on a made-up search. */
function openApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sellme-app-"));
  const s = freshState();
  s.profile = { name: "Maya Test", roles: ["Engineer"], floor: 100000, where: "Remote", never_mention: [] };
  s.facts = [{ id: "f1", text: "Built things", source: "resume" }];
  s.roles = [{ id: "r1", company: "Acme", title: null, agent: null, stage: "talking", next_call: null, updated: new Date().toISOString() }];
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(s));
  // No claude on PATH, so no check starts: the screens draw on their own, the way they do between checks.
  const env = { ...process.env, SELLME_HOME: dir, HOME: dir, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, TERM: "xterm-256color", COLUMNS: "100", LINES: "30" };
  const child = spawn("python3", ["-I", "-c", "import pty, sys; pty.spawn(sys.argv[1:])", process.execPath, BIN, "review"], { env });
  const app = { dir, out: "" };
  child.stdout.on("data", (d) => (app.out += d));
  child.stderr.on("data", (d) => (app.out += d));
  const closed = new Promise((resolve) => child.on("close", resolve));
  app.type = (keys) => child.stdin.write(keys);
  /** Waits until the screen has shown this (or it crashed), however slow the machine, rather than for a fixed time. */
  app.until = async (text, from = 0) => {
    for (let waited = 0; waited < 15_000 && !app.out.slice(from).includes(text) && !/Error/.test(app.out); waited += 100) await pause(100);
    await pause(300); // Let it finish drawing and start reading keys.
  };
  app.saved = () => JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
  app.close = async () => {
    child.stdin.write("\x1b");
    if ((await Promise.race([closed, pause(8000).then(() => "timeout")])) === "timeout") child.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return app;
}

test("the app opens and every tab draws without crashing", { skip: NO_PTY }, async () => {
  const app = openApp();
  await app.until("[Inbox]");
  for (const tab of ["Pipeline", "Chat", "Agents", "Schedule"]) {
    app.type("\x1b[C"); // → to the next tab.
    await app.until(`[${tab}]`);
  }
  await app.close();
  assert.doesNotMatch(app.out, /Error|at file:\/\//, app.out.slice(-1500));
  for (const tab of ["Inbox", "Pipeline", "Chat", "Agents", "Schedule"]) assert.ok(app.out.includes(`[${tab}]`), `${tab} tab drew:\n${app.out.slice(-1500)}`);
});

test("pasting several lines into Chat keeps them all in the message, and only enter sends it", { skip: NO_PTY }, async () => {
  const app = openApp();
  await app.until("[Inbox]");
  app.type("\x1b[C");
  await app.until("[Pipeline]");
  app.type("\x1b[C");
  await app.until("[Chat]");
  await app.until("You:");
  app.type("\x1b[200~first line\rsecond line\rthird\x1b[201~"); // How a terminal sends a paste once the app asks it to mark them.
  await app.until("third");
  await pause(500);
  const before = app.saved().chat ?? [];
  assert.equal(before.length, 0, "the paste didn't send anything");
  assert.match(app.out, /first line ⏎ second line ⏎ third/, "every pasted line is in the input");
  app.type("\r");
  await app.until("No AI tool"); // No claude here, so SELLME can't answer, but the message is in the chat.
  const sent = app.saved().chat ?? [];
  await app.close();
  assert.equal(sent[0]?.text, "first line\nsecond line\nthird", app.out.slice(-1500));
});

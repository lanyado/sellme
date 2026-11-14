// Opens the real app in a terminal and walks every tab, so a name a change dropped by mistake crashes here, not for the user.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { freshState } from "../lib/store.js";

const BIN = new URL("../bin/sellme.js", import.meta.url).pathname;

test("the app opens and every tab draws without crashing", { skip: process.platform === "win32" && "no pty on Windows" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sellme-app-"));
  const s = freshState();
  s.profile = { name: "Maya Test", roles: ["Engineer"], floor: 100000, where: "Remote", never_mention: [] };
  s.facts = [{ id: "f1", text: "Built things", source: "resume" }];
  s.roles = [{ id: "r1", company: "Acme", title: null, agent: null, stage: "talking", next_call: null, updated: new Date().toISOString() }];
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(s));
  // No claude on PATH, so no check starts: the screens draw on their own, the way they do between checks.
  const env = { ...process.env, SELLME_HOME: dir, HOME: dir, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, TERM: "xterm-256color", COLUMNS: "100", LINES: "30" };
  // A real terminal for the app: Python's pty module, on every Mac and Linux machine that runs the tests.
  const child = spawn("python3", ["-I", "-c", "import pty, sys; pty.spawn(sys.argv[1:])", process.execPath, BIN, "review"], { env });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const closed = new Promise((resolve) => child.on("close", resolve));
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  await pause(2500);
  for (let i = 0; i < 4; i++) {
    child.stdin.write("\x1b[C"); // → to the next tab: Pipeline, Chat, Agents, Schedule.
    await pause(800);
  }
  child.stdin.write("\x1b");
  const done = await Promise.race([closed, pause(8000).then(() => "timeout")]);
  if (done === "timeout") child.kill("SIGKILL");
  fs.rmSync(dir, { recursive: true, force: true });
  assert.doesNotMatch(out, /Error|at file:\/\//, out.slice(-1500));
  for (const tab of ["Inbox", "Pipeline", "Chat", "Agents", "Schedule"]) assert.ok(out.includes(`[${tab}]`), `${tab} tab drew:\n${out.slice(-1500)}`);
});

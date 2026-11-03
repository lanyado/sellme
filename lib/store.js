// Local state: one JSON file and an append-only log, private to this user.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export class UserError extends Error {
  constructor(message) {
    super(message);
    this.userFacing = true;
  }
}

export const home = () => process.env.SELLME_HOME || path.join(os.homedir(), ".sellme");
const statePath = () => path.join(home(), "state.json");
const logPath = () => path.join(home(), "log.jsonl");
const lockPath = () => path.join(home(), "state.lock");

const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 30000;

export function freshState() {
  return {
    version: 1,
    profile: { name: null, roles: [], floor: null, where: null, never_mention: [] },
    facts: [],
    agents: [],
    roles: [],
    queue: [],
    notes: [],
    alerts: [],
    ledger: [],
    paused: false,
    hired: null,
    last_brief: null,
    last_run: null,
    seq: {},
  };
}

function ensureHome() {
  fs.mkdirSync(home(), { recursive: true, mode: 0o700 });
  fs.chmodSync(home(), 0o700);
}

export function load() {
  let raw;
  try {
    raw = fs.readFileSync(statePath(), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return freshState();
    throw err;
  }
  try {
    return { ...freshState(), ...JSON.parse(raw) };
  } catch {
    // Never overwrite a file we can't read: it holds the user's search.
    throw new UserError(`Can't read ${statePath()}. Fix or move that file, then try again.`);
  }
}

function save(state) {
  ensureHome();
  const tmp = `${statePath()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, statePath());
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock() {
  ensureHome();
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lockPath(), "wx", 0o600));
      return;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      try {
        if (Date.now() - fs.statSync(lockPath()).mtimeMs > LOCK_STALE_MS) {
          fs.rmSync(lockPath(), { force: true });
          continue;
        }
      } catch {
        continue; // The other process just let go.
      }
      if (Date.now() > deadline) {
        throw new UserError("Another Sellme run is using your data. Try again in a moment.");
      }
      sleep(50);
    }
  }
}

/** Load, change and save the state as one step, so a scheduled run can't clobber the user. */
export function withState(fn) {
  acquireLock();
  try {
    const state = load();
    const result = fn(state);
    save(state);
    return result;
  } finally {
    fs.rmSync(lockPath(), { force: true });
  }
}

export function nextId(state, prefix) {
  state.seq[prefix] = (state.seq[prefix] || 0) + 1;
  return `${prefix}${state.seq[prefix]}`;
}

export function audit(event) {
  ensureHome();
  fs.appendFileSync(logPath(), `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`, { mode: 0o600 });
}

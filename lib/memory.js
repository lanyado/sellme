// An optional long-term memory: a local memory service that indexes everything said in the search (what each
// recruiter asked, what went out, the activity notes, the user's facts), so SELLME can recall what was said before
// in a second instead of searching email and call notes. Sellme's own state stays the source of truth. The memory
// is an index of it, kept in step on each recall, and never sent anywhere: the service runs in local-only mode.
// Not connected, nothing changes: recall returns nothing and every draft is written as before.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { home } from "./store.js";
import { numbers } from "./truth.js";

const TIMEOUT_MS = 90_000; // The first run may load the embedding model.
const USER = "sellme";
const MIN_SCORE = 0.35; // Below this, a memory shares a few common words and little meaning.
const RECALL_SOURCES = ["sent", "asked", "notes"];

export const memoryDb = () => path.join(home(), "memory.db");

/** The service's Python, inside its own virtual environment. */
export function servicePython(dir, platform = process.platform) {
  return platform === "win32" ? path.join(dir, ".venv", "Scripts", "python.exe") : path.join(dir, ".venv", "bin", "python");
}

/** Why a folder can't be the memory service, or null when it can. */
export function notAService(dir) {
  if (!dir || !fs.existsSync(dir)) return `There’s no folder at ${dir}.`;
  if (!fs.existsSync(path.join(dir, "memsvc", "sync.py"))) return `${dir} isn’t the memory service (no memsvc/sync.py, so it may be an older version).`;
  if (!fs.existsSync(servicePython(dir))) return `${dir} has no .venv yet. Run its ./run.sh once to set it up.`;
  return null;
}

export const connected = (state) => Boolean(state.memory?.dir);

/** Runs one service command with JSON on stdin. @returns parsed JSON, or {failed} */
export function runService(dir, args, input, { signal, timeout = TIMEOUT_MS, spawnFn = spawn } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, MEMSVC_LOCAL: "1", JEV_API_KEY: "", MEMSVC_DB: memoryDb(), MEMSVC_USER: USER };
    let child;
    try {
      child = spawnFn(servicePython(dir), ["-m", "memsvc", "--json", ...args], { cwd: dir, env, signal, timeout, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch {
      return resolve({ failed: "The memory service wouldn’t start" });
    }
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.stdin.on("error", () => {});
    child.on("error", () => resolve({ failed: "The memory service wouldn’t start" }));
    child.on("close", (code) => {
      if (code) return resolve({ failed: `The memory service stopped: ${String(err).trim().split("\n").at(-1)?.slice(0, 200) ?? code}` });
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve({ failed: "The memory service answered in a form Sellme can’t read" });
      }
    });
    child.stdin.end(input ?? "");
  });
}

/** Anything that names the salary floor stays out of the memory, so it can never come back into a prompt. */
function floorFree(state) {
  const floor = new Set(numbers(state.profile?.floor ?? ""));
  return (text) => !/\bfloor\b/i.test(text) && !numbers(text).some((n) => floor.has(n));
}

/**
 * Everything Sellme holds, as the service's sources. Each item keeps its Sellme id as its external id, so a change
 * here replaces it there, and one removed here is removed there.
 */
export function documents(state) {
  const ok = floorFree(state);
  const facts = [...(state.facts ?? [])]
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
    .map((f) => ({ external_id: f.id, content: f.text, kind: "identity", occurred_at: f.added, ...(f.replaces ? { replaces: f.replaces } : {}) }));
  const about = (q) => (q.company ? ` about ${q.company}` : "");
  const sent = state.queue
    .filter((q) => ["sent", "sent_by_you"].includes(q.status) && q.text)
    .map((q) => ({ external_id: q.id, content: `Sent to ${q.agent}${about(q)}: ${q.text}`, kind: "message", occurred_at: q.sent_at ?? q.created, project: q.company ?? undefined }));
  const asked = state.queue
    .filter((q) => q.asked)
    .map((q) => ({ external_id: q.id, content: `${q.agent} asked${about(q)}: ${q.asked}`, kind: "message", occurred_at: q.created, project: q.company ?? undefined }));
  // "Sent: …" notes repeat what's already under sent.
  const notes = (state.notes ?? [])
    .filter((n) => n.text && !/^Sent( for you)?:/.test(n.text))
    .map((n) => ({ external_id: n.id, content: `${n.agent ? `${n.agent}: ` : ""}${n.text}`, kind: "note", occurred_at: n.ts }));
  const keep = (items) => items.filter((i) => ok(i.content));
  return { facts: keep(facts), sent: keep(sent), asked: keep(asked), notes: keep(notes) };
}

/**
 * What was said before that bears on this: past messages, what recruiters asked, activity notes. It's context for
 * the AI, never a source a draft can cite: a claim still needs one of the user's facts.
 * @returns {Promise<{source: string, id: string, text: string, when: string, score: number}[]>} empty when not connected
 */
export async function recall(state, { query, agent, skip, limit = 6, signal, run = runService } = {}) {
  if (!connected(state) || !String(query ?? "").trim()) return [];
  const steps = [
    { do: "sync", sources: documents(state) },
    { do: "retrieve", query: String(query).slice(0, 2000), sources: RECALL_SOURCES, limit: limit + 2, ...(agent ? { for: agent } : {}) },
  ];
  const out = await run(state.memory.dir, ["batch"], JSON.stringify(steps), { signal });
  if (!Array.isArray(out) || !Array.isArray(out[1])) return [];
  const ok = floorFree(state);
  return out[1]
    .filter((r) => r.score >= MIN_SCORE && r.external_id !== skip && ok(r.content))
    .slice(0, limit)
    .map((r) => ({ source: r.source, id: r.external_id, text: r.content, when: String(r.written_at ?? "").slice(0, 10), score: r.score }));
}

/** Connects the service in a folder, and starts the user's memory. @returns {ok: true} or {failed} */
export async function connectMemory(state, dir, { run = runService } = {}) {
  const why = notAService(dir);
  if (why) return { failed: why };
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const done = await run(dir, ["init", "--name", state.profile?.name || "me", "--timezone", tz], "");
  if (done.failed) return done;
  const synced = await run(dir, ["sync"], JSON.stringify({ sources: documents(state) }));
  if (synced.failed) return synced;
  return { ok: true, synced };
}

/** For the prompt: what was said before, labeled by who said it. */
export function recalledLines(recalled) {
  if (!recalled?.length) return [];
  const who = { sent: "They sent (their own words)", asked: "The other side wrote", notes: "Activity note" };
  return [
    "",
    "Said before in their search (context only: never cite it, and back any claim with a fact above):",
    ...recalled.map((r) => `- ${r.when} · ${who[r.source] ?? r.source}: ${r.text}`),
  ];
}

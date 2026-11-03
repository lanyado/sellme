// Puts the skill into each AI tool on this machine. Touches only folders Sellme created.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { home } from "./store.js";

const MARKER = ".sellme-installed";
export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function hosts() {
  const h = os.homedir();
  return [
    { id: "claude", name: "Claude Code", root: path.join(h, ".claude") },
    { id: "codex", name: "Codex", root: process.env.CODEX_HOME || path.join(h, ".codex") },
    { id: "cursor", name: "Cursor", root: path.join(h, ".cursor") },
    { id: "opencode", name: "OpenCode", root: path.join(h, ".config", "opencode") },
  ].map((t) => ({ ...t, found: fs.existsSync(t.root), dest: path.join(t.root, "skills", "sellme") }));
}

export const shimPath = () => path.join(home(), "bin", "sellme");
const runtimePath = () => path.join(home(), "runtime");

export function runningFromRuntime() {
  try {
    return fs.realpathSync(PKG_ROOT) === fs.realpathSync(runtimePath());
  } catch {
    return false;
  }
}

function installRuntime() {
  if (!runningFromRuntime()) {
    fs.rmSync(runtimePath(), { recursive: true, force: true });
    fs.mkdirSync(runtimePath(), { recursive: true, mode: 0o700 });
    for (const item of ["bin", "lib", "package.json"]) {
      fs.cpSync(path.join(PKG_ROOT, item), path.join(runtimePath(), item), { recursive: true });
    }
  }
  fs.mkdirSync(path.dirname(shimPath()), { recursive: true, mode: 0o700 });
  const quote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  const entry = path.join(runtimePath(), "bin", "sellme.js");
  // AI desktop apps often run with a shorter PATH than a terminal, so remember which Node installed this.
  // That Node can go away after an upgrade, so fall back to whichever one is on PATH.
  const node = quote(process.execPath);
  fs.writeFileSync(
    shimPath(),
    `#!/bin/sh\nSELLME_HOME=${quote(home())}\nexport SELLME_HOME\nif [ -x ${node} ]; then exec ${node} ${quote(entry)} "$@"; fi\nexec node ${quote(entry)} "$@"\n`,
    { mode: 0o755 },
  );
}

/** How the skill's instructions call the helper. A path with a space would otherwise split in two. */
export const helperCommand = (shim = shimPath()) => (/\s/.test(shim) ? `"${shim}"` : shim);

function installSkill(dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(path.join(PKG_ROOT, "skill"), dest, { recursive: true });
  const fill = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) fill(p);
      else if (e.name.endsWith(".md")) fs.writeFileSync(p, fs.readFileSync(p, "utf8").replaceAll("{{SELLME}}", helperCommand()));
    }
  };
  fill(dest);
  fs.writeFileSync(path.join(dest, MARKER), "Installed by Sellme. Safe to remove with: npx sellme uninstall\n");
}

/** @returns {{installed: object[], foreign: object[], missing: object[]}} */
export function install({ only, force = false } = {}) {
  const all = hosts();
  if (only && !all.some((t) => t.id === only)) throw Object.assign(new Error(`Unknown tool “${only}”. Use: ${all.map((t) => t.id).join(", ")}.`), { userFacing: true });
  const targets = only ? all.filter((t) => t.id === only) : all.filter((t) => t.found);
  const result = { installed: [], foreign: [], missing: all.filter((t) => !t.found) };
  if (!targets.length) return result;
  installRuntime();
  for (const t of targets) {
    const ours = fs.existsSync(path.join(t.dest, MARKER));
    if (fs.existsSync(t.dest) && !ours && !force) {
      result.foreign.push(t); // Someone else's skill has this name. Don't overwrite it.
      continue;
    }
    fs.mkdirSync(path.dirname(t.dest), { recursive: true });
    installSkill(t.dest);
    result.installed.push(t);
  }
  return result;
}

/**
 * Deletes only what Sellme created, by name. SELLME_HOME can point anywhere, even at a home folder,
 * so a purge must never delete the folder's whole contents.
 * @returns {string[]} what's left in the folder because Sellme didn't make it
 */
function purgeData() {
  let entries;
  try {
    entries = fs.readdirSync(home());
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const ours = (name) => ["state.json", "state.lock", "log.jsonl", "brag.svg"].includes(name) || /^state\.json\.\d+\.tmp$/.test(name);
  for (const name of entries.filter(ours)) fs.rmSync(path.join(home(), name), { force: true });
  const kept = entries.filter((name) => !ours(name));
  if (!kept.length) fs.rmdirSync(home());
  return kept;
}

/** @returns {{removed: object[], kept: string[]}} */
export function uninstall({ purge = false } = {}) {
  const removed = [];
  for (const t of hosts()) {
    if (fs.existsSync(path.join(t.dest, MARKER))) {
      fs.rmSync(t.dest, { recursive: true, force: true });
      removed.push(t);
    }
  }
  fs.rmSync(runtimePath(), { recursive: true, force: true });
  fs.rmSync(path.join(home(), "bin"), { recursive: true, force: true });
  return { removed, kept: purge ? purgeData() : [] };
}

export function installedHosts() {
  return hosts().filter((t) => fs.existsSync(path.join(t.dest, MARKER)));
}

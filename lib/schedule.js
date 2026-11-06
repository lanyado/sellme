// "Check my agents every day": the computer's own scheduler starts `sellme scheduled-run`. launchd on a Mac,
// Task Scheduler on Windows, cron on Linux. Nothing runs in the background between checks.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RUN_TIMEOUT_MS, canRun, entryPoint, runAgent } from "./agent.js";
import { UserError, audit, home, load, withState } from "./store.js";

export const SCHEDULES = [
  { id: "hourly", label: "Every hour", cron: "0 * * * *", calendar: [{ Minute: 0 }], windows: ["/SC", "HOURLY", "/MO", "1", "/ST", "00:00"] },
  { id: "4h", label: "Every 4 hours", cron: "0 */4 * * *", calendar: [0, 4, 8, 12, 16, 20].map((Hour) => ({ Hour, Minute: 0 })), windows: ["/SC", "HOURLY", "/MO", "4", "/ST", "00:00"] },
  { id: "daily", label: "Every day at 9 AM", cron: "0 9 * * *", calendar: [{ Hour: 9, Minute: 0 }], windows: ["/SC", "DAILY", "/ST", "09:00"] },
  { id: "weekly", label: "Every Monday at 9 AM", cron: "0 9 * * 1", calendar: [{ Weekday: 1, Hour: 9, Minute: 0 }], windows: ["/SC", "WEEKLY", "/D", "MON", "/ST", "09:00"] },
];

const LABEL = "sellme.run";
const CRON_MARK = "# Added by Sellme";
const WINDOWS_TASK = "Sellme Check";
const LOG_KEEP_BYTES = 200_000;
const plistPath = () => path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const logPath = () => path.join(home(), "schedule.log");
const lockPath = () => path.join(home(), "schedule.lock");

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dict = (o) => `<dict>${Object.entries(o).map(([k, v]) => `<key>${xml(k)}</key>${typeof v === "number" ? `<integer>${v}</integer>` : `<string>${xml(v)}</string>`}`).join("")}</dict>`;

/** launchd starts programs with almost no PATH, so the run has to carry the one that finds Claude Code. */
export function plistFor(schedule, { node = process.execPath, entry = entryPoint(), env = process.env } = {}) {
  const vars = { PATH: env.PATH ?? "", HOME: os.homedir(), SELLME_HOME: home() };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(entry)}</string><string>scheduled-run</string></array>
<key>EnvironmentVariables</key>${dict(vars)}
<key>StartCalendarInterval</key><array>${schedule.calendar.map(dict).join("")}</array>
<key>WorkingDirectory</key><string>${xml(home())}</string>
</dict></plist>
`;
}

const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export function cronLine(schedule, { node = process.execPath, entry = entryPoint(), env = process.env } = {}) {
  return `${schedule.cron} PATH=${sh(env.PATH ?? "")} SELLME_HOME=${sh(home())} ${sh(node)} ${sh(entry)} scheduled-run ${CRON_MARK}`;
}

const domain = () => `gui/${process.getuid?.() ?? 0}`;

function applyMac(schedule, run) {
  run("launchctl", ["bootout", `${domain()}/${LABEL}`]); // Fine if it wasn't loaded.
  if (!schedule) {
    fs.rmSync(plistPath(), { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(plistPath()), { recursive: true });
  fs.writeFileSync(plistPath(), plistFor(schedule), { mode: 0o600 });
  const loaded = run("launchctl", ["bootstrap", domain(), plistPath()]);
  if (loaded.status !== 0) {
    fs.rmSync(plistPath(), { force: true });
    throw new UserError("Your Mac wouldn’t take the schedule, so nothing is set.");
  }
}

function applyLinux(schedule, run) {
  const now = run("crontab", ["-l"]);
  const kept = (now.status === 0 ? String(now.stdout) : "").split("\n").filter((l) => l && !l.includes(CRON_MARK));
  const next = [...kept, ...(schedule ? [cronLine(schedule)] : [])];
  const saved = run("crontab", ["-"], `${next.join("\n")}\n`);
  if (saved.status !== 0) throw new UserError("cron wouldn’t take the schedule, so nothing is set.");
}

/** Task Scheduler has no place for environment settings, and limits a command's length, so a small file holds them. */
export function windowsScript({ node = process.execPath, entry = entryPoint(), env = process.env } = {}) {
  const value = (v) => String(v ?? "").replace(/%/g, "%%");
  return ["@echo off", "chcp 65001 >nul", `set "PATH=${value(env.PATH)}"`, `set "SELLME_HOME=${value(home())}"`, `"${value(node)}" "${value(entry)}" scheduled-run`, ""].join("\r\n");
}

const windowsScriptPath = () => path.join(home(), "scheduled-run.cmd");

/** conhost --headless, so an hourly check doesn't open a window that closing would kill. */
export const windowsTaskArgs = (schedule, script) => ["/Create", "/TN", WINDOWS_TASK, "/F", ...schedule.windows, "/TR", `conhost.exe --headless cmd.exe /c "${script}"`];

function applyWindows(schedule, run) {
  run("schtasks", ["/Delete", "/TN", WINDOWS_TASK, "/F"]); // Fine if there wasn't one.
  if (!schedule) {
    fs.rmSync(windowsScriptPath(), { force: true });
    return;
  }
  fs.mkdirSync(home(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(windowsScriptPath(), windowsScript(), { mode: 0o600 });
  if (run("schtasks", windowsTaskArgs(schedule, windowsScriptPath())).status !== 0) {
    fs.rmSync(windowsScriptPath(), { force: true });
    throw new UserError("Task Scheduler wouldn’t take the schedule, so nothing is set.");
  }
}

const realRun = (bin, args, input) => spawnSync(bin, args, { encoding: "utf8", input, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });

/** @param id one of SCHEDULES, or "off" @returns the schedule now in force, or null */
export function setSchedule(id, { platform = process.platform, run = realRun, envPath = process.env.PATH } = {}) {
  const schedule = id === "off" ? null : SCHEDULES.find((s) => s.id === id);
  if (id !== "off" && !schedule) throw new UserError(`Use one of: ${SCHEDULES.map((s) => s.id).join(", ")}, off.`);
  if (schedule && !canRun(envPath)) throw new UserError("Scheduled checks need Claude Code on this machine. Codex can’t run them yet, because I can’t hold it to your approvals.");
  if (platform === "darwin") applyMac(schedule, run);
  else if (platform === "win32") applyWindows(schedule, run);
  else if (platform === "linux") applyLinux(schedule, run);
  else throw new UserError("Scheduled checks work on a Mac, Windows or Linux.");
  withState((s) => {
    s.schedule = schedule ? { every: schedule.id, set_at: new Date().toISOString() } : null;
    s.schedule_chosen = true; // Off on purpose stays off.
  });
  audit({ event: "schedule", every: schedule?.id ?? "off" });
  return schedule;
}

/**
 * A job the Mac starts by itself doesn't get the access your terminal has, so it can't read Messages until
 * these programs have Full Disk Access. Sellme can't grant that, and shouldn't be able to.
 */
export function scheduleWarning(state, { platform = process.platform, node = process.execPath } = {}) {
  if (platform === "win32") return "Windows only starts these checks while your computer is plugged in. To change that, open the “Sellme Check” task in Task Scheduler.";
  if (platform !== "darwin") return null;
  const texting = state.agents.filter((a) => a.channel === "imessage").map((a) => a.name);
  if (!texting.length) return null;
  return `Scheduled checks can’t read ${texting.join(", ")} until you allow it: System Settings > Privacy & Security > Full Disk Access, then add ${node} and the Python that uv uses. Checks you start yourself aren’t affected.`;
}

/** Only one check at a time. A slow hourly one mustn't pile up on the next. */
function takeLock() {
  try {
    const held = JSON.parse(fs.readFileSync(lockPath(), "utf8"));
    if (Date.now() - held.ts < RUN_TIMEOUT_MS + 60_000) {
      try {
        process.kill(held.pid, 0);
        return false;
      } catch {
        // That process has gone, so the lock is stale.
      }
    }
  } catch {
    // No lock yet.
  }
  fs.mkdirSync(home(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(lockPath(), JSON.stringify({ pid: process.pid, ts: Date.now() }), { mode: 0o600 });
  return true;
}

function writeLog(text) {
  let old = "";
  try {
    old = fs.readFileSync(logPath(), "utf8").slice(-LOG_KEEP_BYTES);
  } catch {
    // First run.
  }
  fs.writeFileSync(logPath(), `${old}\n--- ${new Date().toISOString()}\n${text}\n`, { mode: 0o600 });
}

/** One check, as the scheduler or "Run a check now" starts it. @returns a short result */
export async function scheduledRun({ runner = runAgent, signal } = {}) {
  if (load().paused) {
    writeLog("Paused, so I skipped this check.");
    return { skipped: "paused" };
  }
  if (!takeLock()) return { skipped: "already running" };
  try {
    const before = load().last_run;
    const result = await runner("/sellme run unattended", { timeout: RUN_TIMEOUT_MS, signal });
    writeLog(result.output || result.failed || (result.stopped ? "Stopped by the user." : "(no output)"));
    if (result.stopped) return { stopped: true };
    // A clean exit isn't enough: only a run that got to the end records the time.
    const finished = result.ok && load().last_run !== before;
    const last = { at: new Date().toISOString(), ok: finished, why: finished ? null : (result.failed ?? "It stopped before it finished. See schedule.log.") };
    withState((s) => {
      s.schedule_last = last;
    });
    audit({ event: "scheduled_run", ok: finished });
    return last;
  } finally {
    fs.rmSync(lockPath(), { force: true });
  }
}

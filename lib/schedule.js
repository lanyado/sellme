// "Check my agents every day": the computer's own scheduler starts `sellme scheduled-run`. launchd on a Mac,
// Task Scheduler on Windows, cron on Linux. Nothing runs in the background between checks.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RUN_TIMEOUT_MS, canRun, entryPoint, runAgent } from "./agent.js";
import { canReadMessages } from "./connect.js";
import { SELF, personRoute } from "./core.js";
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
  if (schedule && !canRun(envPath)) throw new UserError("Scheduled checks need Claude Code on this machine. Codex can’t run them yet, because SELLME can’t hold it to your approvals.");
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

/** @returns when the check that's running now started, or null if none is */
export function runActive() {
  try {
    const held = JSON.parse(fs.readFileSync(lockPath(), "utf8"));
    if (Date.now() - held.ts >= RUN_TIMEOUT_MS + 60_000) return null;
    process.kill(held.pid, 0);
    return held.ts;
  } catch {
    return null; // No lock, or its process has gone.
  }
}

/** Only one check at a time. A slow hourly one mustn't pile up on the next. */
function takeLock() {
  if (runActive()) return false;
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

const FOLLOW_TIMEOUT_MS = 8 * 60_000; // A few rounds of a minute each, with room to read and write.

const LANES = [
  { id: "websites", label: "the agents on websites, in Chrome", chrome: true, has: (r) => r === "browser" },
  { id: "email", label: "email: agents that write by email, and recruiters writing to the user's inbox", has: (r) => r === "email", always: () => true },
  { id: "texts", label: "texts: agents on iMessage, and recruiters texting the user", has: (r) => r === "imessage", always: (platform) => platform === "darwin" },
  { id: "linkedin", label: "LinkedIn messages: recruiters writing to the user there", has: (r) => r === "linkedin", always: () => true },
  { id: "apps", label: "agents with their own app, through their tools", has: (r) => r === "mcp" },
];

/**
 * One check, split by channel so every channel is read at the same time. Each lane is its own run, with only
 * its own contacts, and records its own finish.
 * @param start an agent that was just connected: its lane opens that conversation first
 */
/**
 * @param texts whether this process can read Messages: without it the texts lane can only fail, so it's left out
 * @param follow an agent SELLME just wrote to: only its lane, only it, staying for its answer
 */
export function checkLanes(state, { start = null, platform = process.platform, texts = true, follow = null } = {}) {
  const route = (a) => (a.channel === SELF ? personRoute(a.handle) : a.channel);
  const only = follow ? state.agents.find((a) => a.name.toLowerCase() === String(follow).toLowerCase()) : null;
  if (follow && !only) return [];
  return LANES.map((lane) => ({ ...lane, agents: state.agents.filter((a) => (!only || a === only) && lane.has(route(a))).map((a) => a.name) }))
    .filter((lane) => lane.agents.length || (!only && lane.always?.(platform)))
    .filter((lane) => lane.id !== "texts" || texts)
    .map((lane) => ({
      id: lane.id,
      chrome: Boolean(lane.chrome),
      prompt: [
        "/sellme run unattended",
        "",
        "This run is one lane of a check. Other runs cover the other channels at the same time.",
        `Your lane: ${lane.label}.`,
        `Your contacts: ${lane.agents.length ? lane.agents.join(", ") : "none yet, so look for recruiters who wrote"}.`,
        only ? `Only ${only.name}: send its approved outbox items, read, sort and answer. Leave every other agent and channel alone.` : "Do every step of the run for this lane only: send its approved outbox items, read, find new people who wrote here, sort, and push. Leave every other agent and channel alone.",
        ...(start && lane.agents.includes(start) ? [`${start} was just connected: open that conversation first.`] : []),
        ...(only
          ? [
              `This is a follow-up, not a full check: SELLME just wrote to ${only.name}, and it usually answers within a minute. Stay in that one conversation.`,
              `Read it. If ${only.name} hasn't answered yet, run \`sellme wait 45\` and read again, twice at most. When it answers, handle it as in the run (draft, send what's approved, note what's new). If that sends something, stay for the next answer the same way, up to three rounds in all. Then stop.`,
            ]
          : []),
        only ? "It isn't a check, so don't run `sellme ran`." : `To finish, run \`sellme ran --lane ${lane.id}\` instead of \`sellme ran\`.`,
      ].join("\n"),
    }));
}

/** One check, as the scheduler or "Run a check now" starts it. @returns a short result */
export async function scheduledRun({ runner = runAgent, signal, start = null, follow = null, platform = process.platform, texts = platform !== "darwin" || canReadMessages() } = {}) {
  if (load().paused) {
    writeLog("Paused, so I skipped this check.");
    return { skipped: "paused" };
  }
  if (!takeLock()) return { skipped: "already running" };
  try {
    const began = new Date().toISOString();
    const lanes = checkLanes(load(), { start, platform, texts, follow });
    const results = await Promise.all(lanes.map((lane) => runner(lane.prompt, { timeout: follow ? FOLLOW_TIMEOUT_MS : RUN_TIMEOUT_MS, signal, chrome: lane.chrome })));
    if (follow) {
      // One conversation, not a check: it doesn't count as the hourly check having run.
      writeLog(`[follow ${follow}] ${results[0]?.output || results[0]?.failed || "(nothing to follow)"}`);
      audit({ event: "followed", agent: follow, ok: Boolean(results[0]?.ok) });
      return { followed: follow, ok: Boolean(results[0]?.ok) };
    }
    const left = !texts && checkLanes(load(), { platform }).some((l) => l.id === "texts");
    // A whole AI run every hour just to find Messages locked again helps nobody. Say it here instead.
    const skipped = left ? ["[texts] Skipped: this check can't read Messages, since the app running it has no Full Disk Access. `sellme connect` shows how to turn it on."] : [];
    writeLog([...skipped, ...lanes.map((lane, i) => `[${lane.id}] ${results[i].output || results[i].failed || (results[i].stopped ? "Stopped by the user." : "(no output)")}`)].join("\n\n"));
    if (results.some((r) => r.stopped)) return { stopped: true };
    // A clean exit isn't enough: only a lane that got to the end records its finish.
    const done = load().lane_runs ?? {};
    const short = lanes.filter((lane, i) => !results[i].ok || !(done[lane.id] >= began));
    const finished = short.length === 0;
    const why = finished ? null : results.find((r) => r.failed)?.failed ?? `${short.map((l) => l.id).join(", ")} stopped before it finished. See schedule.log.`;
    const last = { at: new Date().toISOString(), ok: finished, why };
    withState((s) => {
      s.schedule_last = last;
      if (finished) s.last_run = last.at;
    });
    audit({ event: "scheduled_run", ok: finished });
    return last;
  } finally {
    fs.rmSync(lockPath(), { force: true });
  }
}

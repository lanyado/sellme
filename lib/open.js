// The one place Sellme starts another program: the system's own link opener, when the user presses enter.
import { execFile, spawn } from "node:child_process";

// Only Sellme's own catalog links reach this. The check is a second lock: a link can't run anything else.
export const canOpen = (url) => /^https:\/\/[^\s]+$/.test(url) || /^x-apple\.systempreferences:[\w.?=-]+$/.test(url) || /^imessage:\/\/(\+?\d{7,15}|[^\s@/]+@[^\s@/]+)$/.test(url);

/** @returns {Promise<boolean>} false if it couldn't open, so the caller can show the link instead */
export function openUrl(url, { platform = process.platform, run = execFile } = {}) {
  // Windows' "start" goes through cmd.exe, where an & in a link would run a command. This doesn't.
  const [opener, ...first] = { darwin: ["open"], linux: ["xdg-open"], win32: ["rundll32", "url.dll,FileProtocolHandler"] }[platform] ?? [];
  if (!opener || !canOpen(url)) return Promise.resolve(false);
  return new Promise((resolve) => run(opener, [...first, url], (err) => resolve(!err)));
}

/** Puts text on the clipboard. @returns {Promise<boolean>} false where there's no clipboard tool */
export function copyText(text, { platform = process.platform, run = spawn } = {}) {
  const tools = { darwin: [["pbcopy", []]], win32: [["clip", []]], linux: [["wl-copy", []], ["xclip", ["-selection", "clipboard"]]] }[platform] ?? [];
  const attempt = (i) =>
    i >= tools.length
      ? Promise.resolve(false)
      : new Promise((resolve) => {
          const child = run(tools[i][0], tools[i][1], { stdio: ["pipe", "ignore", "ignore"] });
          child.on("error", () => resolve(attempt(i + 1)));
          child.on("close", (code) => resolve(code === 0 ? true : attempt(i + 1)));
          child.stdin.on("error", () => {});
          child.stdin.end(String(text ?? ""));
        });
  return attempt(0);
}

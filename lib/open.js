// The one place Sellme starts another program: the system's own link opener, when the user presses enter.
import { execFile } from "node:child_process";

// Only Sellme's own catalog links reach this. The check is a second lock: a link can't run anything else.
export const canOpen = (url) => /^https:\/\/[^\s]+$/.test(url) || /^x-apple\.systempreferences:[\w.?=-]+$/.test(url) || /^imessage:\/\/(\+?\d{7,15}|[^\s@/]+@[^\s@/]+)$/.test(url);

/** @returns {Promise<boolean>} false if it couldn't open, so the caller can show the link instead */
export function openUrl(url, { platform = process.platform, run = execFile } = {}) {
  // Windows' "start" goes through cmd.exe, where an & in a link would run a command. This doesn't.
  const [opener, ...first] = { darwin: ["open"], linux: ["xdg-open"], win32: ["rundll32", "url.dll,FileProtocolHandler"] }[platform] ?? [];
  if (!opener || !canOpen(url)) return Promise.resolve(false);
  return new Promise((resolve) => run(opener, [...first, url], (err) => resolve(!err)));
}

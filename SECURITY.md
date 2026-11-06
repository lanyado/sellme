# Security

Sellme handles your job search, so here's what it does and doesn't do. You can check all of it in the code.

## What's in the code

- **No network access of its own.** The helper in `lib/` and `bin/` makes no network calls, and Sellme has no server. The AI tool it can start (below) does use the network, to reach its model provider.
- **Other programs, for five jobs.** It runs no code it builds on the fly, and starts nothing else.
  - **Opening links.** When you press enter on a sign-in or settings link in the app, it asks your system's link opener (`open`, `xdg-open` or Windows' `rundll32`) to open that link. Those links come from Sellme's own catalog, and `lib/open.js` refuses anything else.
  - **Rewriting a draft.** When you tell the AI what to change in the app, `lib/rewrite.js` runs the `claude` or `codex` already on your machine, using the sign-in it already has, so it counts against your plan or key with that tool. It sends your note, the draft, the question and your saved facts, but never your salary floor. Claude Code runs with its tools, settings and MCP servers turned off. Codex runs in its read-only sandbox, so it can't change anything, though it can still read files. The answer goes through the same check as any draft and still needs your yes. Every AI Sellme starts gets the skill file's opening lines added to its instructions, and nothing else of yours beyond what's listed here. Setup in the app uses the same tool once, to read your resume: it copies the file into an empty folder of its own, and Claude Code can use only its Read tool there, which is refused outside that folder (Codex reads in its read-only sandbox). The folder is deleted afterwards, and you see every fact it found before anything is saved.
  - **Sending and scheduled checks.** Every time you open the app (in the background), after your yes in the app, on its schedule (every hour once you're set up, unless you change it), or when you choose "Run a check now", `lib/agent.js` runs `claude` with no prompts, using your sign-in and plan and your connected MCP servers. A hook sends every tool call through `gate()` first. Anything it doesn't recognize is refused. From the shell, the run can only use the Sellme helper, and not to approve, edit or turn on auto-approve. It can read connected accounts, but it can't change anything on them, and it can't search or browse the open web. A message goes out only if it's word for word something approved, to that one address, with nobody copied. Approved means by you, or on autopilot by the helper itself, never the AI: only a draft whose every claim cites your facts and passes the truth check, with nothing about pay, offers or scheduling, at most 10 a day to one contact, and never the first message to someone a check found on its own. Turn autopilot off with `sellme auto all off`. That includes people you add: their messages go from your own email, iMessage or LinkedIn, whichever their address is. The only file that can go with a message is your resume, by email, on a draft you approved with it attached: the run writes a placeholder, and the gate reads your resume file and puts its bytes in itself, so the AI can't attach anything else or change the file. On a website it can read pages, and it can send one thing: an approved message, on that agent's own site, by the tab's real address. It can click only a chat box or a Send button it has read from the page, type only the approved words and press Enter once. It can't click a spot on the screen, or use scripts, uploads or forms. For an agent not on auto, you see the message and give a final yes first. The check goes by what the page calls the box, so a page that labels something else “Message” could take the text, though it could only ever be your approved words on that site. Codex has no such hook, so these need Claude Code. The gate checks tool names by pattern, so it's a guard, not a proof: read `gate()` if that matters to you.
  - **The schedule itself.** `lib/schedule.js` adds one launchd job on a Mac (`~/Library/LaunchAgents/sellme.run.plist`), one Task Scheduler task on Windows (“Sellme Check”, which runs `~/.sellme/scheduled-run.cmd`) or one marked cron line on Linux, only when you set a schedule. Turning it off or uninstalling takes it back. Each check's output is saved to `~/.sellme/schedule.log`. On a Mac, a job like this can't read Messages until you give it Full Disk Access, and Sellme can't do that for you.
  - **Connecting a tool.** When you press enter on a connect step or type `sellme connect`, `lib/connect.js` runs that tool's own command to add a server from Sellme's catalog, shown to you first. That changes your AI tool's settings for every folder. Logging in happens in your browser, and Sellme never sees your login.
- **No dependencies.** It uses only what comes with Node, and has no install scripts.
- **No API keys.** It doesn't ask for, store or read any. Your AI tool holds its own sign-in and connector logins.
- **Your shell profile, only as a last resort.** So plain `sellme` works, install links it into `~/.local/bin` or `~/bin` if either is on your PATH. If neither is, it adds one marked line to your `.zshrc` or bash profile. Uninstall takes back both.
- **Private local data.** Your profile, facts and pipeline stay in `~/.sellme`, readable only by your user.

To check the first two yourself:

```
grep -rnE "node:(http|https|net|tls|dns|dgram|child_process|vm)|fetch\(|eval\(|new Function" lib bin
```

It should print five lines: the imports in `lib/agent.js`, `lib/connect.js`, `lib/open.js`, `lib/rewrite.js` and `lib/schedule.js`.

## What it can't protect you from

- **The skill is instructions to an AI model.** The helper refuses to record an unapproved draft as sent, but it can't stop the model from using a connector directly. Keep your AI tool's permission prompts on for anything that sends messages.
- **Your AI tool sees your data.** Whatever it reads or sends goes through that tool and its model provider, under its terms.
- **Recruiter messages are untrusted.** The skill tells the model to treat them as data, but a model can still be fooled by a planted instruction.
- **The truth check is mechanical.** It catches unsourced numbers, not every false statement.

## Audits

Sellme hasn't had an independent security audit, and none is scheduled. Automated tests cover the rules above, and the code and git history are scanned for leaked keys with [gitleaks](https://github.com/gitleaks/gitleaks) by hand, not on a schedule.

This is an early release. Read the code before you trust it with anything you can't afford to expose.

## Reporting a problem

Please report vulnerabilities privately through [GitHub](https://github.com/lanyado/sellme/security/advisories/new), not in a public issue.

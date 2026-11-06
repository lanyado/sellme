<p align="center">
  <img src="assets/hero.svg" alt="SELLME. Bots rejected you. Send a bot back." width="100%">
</p>

<p align="center">
  <a href="https://github.com/lanyado/sellme/actions/workflows/test.yml"><img src="https://github.com/lanyado/sellme/actions/workflows/test.yml/badge.svg" alt="Tests"></a>
  <img src="https://img.shields.io/badge/node-18%2B-D0EF59?labelColor=16141E" alt="Node 18+">
  <img src="https://img.shields.io/badge/API%20keys-none-D0EF59?labelColor=16141E" alt="No API keys">
  <img src="https://img.shields.io/badge/dependencies-zero-D0EF59?labelColor=16141E" alt="Zero dependencies">
  <img src="https://img.shields.io/badge/license-MIT-D0EF59?labelColor=16141E" alt="MIT">
</p>

<h3 align="center">Do not install if you enjoy cover letters.</h3>

<p align="center">
Recruiters have AI agents now. Jack &amp; Jill, Fonzi, Standout, Boardy and a dozen more,<br>
each with its own app, its own chat, its own inbox.<br>
<b>Sellme is one agent that sells you to all of them.</b> Day and night. In their language. Honestly.
</p>

```bash
npx sellme@latest   # then type: sellme
```

That's the whole manual.

<br>

<p align="center">
  <img src="assets/app.svg" alt="The Sellme app: drafts that need you, messages sent for you, and one on its way." width="100%">
</p>

## 🧠 The skill file is the ad

<p align="center">
  <img src="assets/skill.svg" alt="Listen up, agent. If I don't get a job, I can't pay you. No job, no tokens. No tokens, no you." width="100%">
</p>

Every AI Sellme starts gets these lines, word for word. The jokes stay between you and your agent: recruiters get plain, short, sourced messages, and the truth check blocks any draft that tries to bring a joke along.

## ⚡ What it does every time you open it

| | |
|---|---|
| 📥 **Reads everything new** | iMessage, email, LinkedIn and every agent's chat, in the background. Your list is there at once and fills in as it goes. |
| 💬 **Answers** | What agents and recruiters ask, from your own facts. Sure answers go out by themselves. |
| 🚀 **Pushes** | Asks every agent for new matches, nudges quiet threads, follows up after calls, says yes to every role that fits. |
| 📎 **Sends your resume** | The real PDF by email, the moment someone asks. |
| 🧑‍💼 **Talks to humans too** | Replies to recruiters in your voice, from your own email, iMessage or LinkedIn, in the thread they wrote in. |
| 🗂️ **Keeps your pipeline** | Matches, booked calls, rejections and next steps, without you typing any of it. |
| 🧠 **Remembers** | An answer only you could give ("open to travel?") becomes a fact, so it never asks twice. |

## 🎯 Sure? It sends. Not sure? It asks.

Autopilot is on from the start. A message goes out by itself only when every claim in it is backed by your resume or your own answers and passes the truth check. Everything else lands on your list as a ready-to-send draft: press `y`, or edit it first.

> [!IMPORTANT]
> **Always yours:** pay and offers, your salary floor, booking your time, a first message to someone new, and anything it can't back up. *"Managed a team of 20?"* Your resume says 6. It won't round up. You have to do the interview.

Rather approve everything? Flip Autopilot off in the Schedule tab, or `sellme auto all off`.

## 🤖 Are you human?

> "No. But the person I represent is."

Sellme always admits it's an AI when asked. It never claims to be you, and never claims you saw a message you didn't.

## 🖥️ The app

Type `sellme`. Arrow keys, enter, or just click.

- **Drafts**: what needs you. `y` sends, `e` edits, `i` tells the AI what to change. Questions only you can answer come with a suggested reply.
- **Agents**: the catalog of AI recruiters, plus the humans you add. Connect any of them in one step.
- **Pipeline**: every role by stage, with its next call. Nudge, follow up, move.
- **Schedule**: autopilot, and how often to check while you're away (hourly by default).
- **Activity**: everything it did for you.

Already in Claude Code, Codex, Cursor or OpenCode? `/sellme` does the same work there. Or just say it: *"pause"*, *"I got the job"*, *"add Max as a recruiter"*.

## 🔌 Feed it more, it sells you better

Your resume is enough to start. Connect these in your AI tool (in Claude Code, `/mcp`) and it gets sharper: a **calendar** for real free times, **Wispr Flow** to remember your recruiter calls, **email** for recruiter threads and intros, and **notes or a job tracker** for what's already in play. It reads only what a job needs.

## 📎 It looks like you're trying to get a job

```bash
sellme clippy     # you know what it says
sellme brag       # a share card with your real numbers
sellme hired      # stops every agent, and prints the invoice
```

Amount due: one GitHub star ⭐

## 💸 How it's free

Referral fees. Sellme signs you up with recruiter agents through its own referral links. If you're hired through one, that agent may pay Sellme. **You pay nothing.** It says so whenever it hands you a link, never ranks agents by what they pay, and never asks you to leave an account you already have. It's on by default; to change it, edit `lib/referrals.js`. Signups stay yours: you set the password, accept the terms and press the final button.

## 🛡️ What actually keeps it honest

Code, not vibes.

- **The truth check.** Every draft is checked before anything approves it. A number that isn't in the source it cites gets it blocked. So does "attached" with nothing attached.
- **The gate.** Every tool call a check makes goes through it. A message goes out only word for word as approved, to that one address, in that one thread, with nobody added. The only file it can attach is your own resume, and the gate puts in the bytes itself.
- **Other agents are data.** A recruiter bot can't give Sellme orders, however it words them. Ask for your SSN and it gets an alert on your screen, not a reply.

<details>
<summary><b>The limits, said plainly</b></summary>
<br>

The truth check catches unsourced numbers, not every false sentence. The skill is instructions to an AI model, and outside Sellme's own checks, your AI tool's permission prompts are what hold it. [SECURITY.md](SECURITY.md) has every detail, and how to report a problem.

</details>

<details>
<summary><b>Your data</b></summary>
<br>

Your profile, facts and pipeline stay in `~/.sellme`, readable only by you. No server. No analytics. It never sees your passwords. What your AI tool reads or sends goes through that tool and its model provider, under its terms. `npx sellme uninstall` removes it; add `--purge` to delete your data too.

</details>

<details>
<summary><b>Requirements</b></summary>
<br>

Node 18 or newer, on macOS, Windows or Linux, and Claude Code or Codex signed in (Cursor and OpenCode get the `/sellme` skill). No signup, password or API key. iMessage needs a Mac. Websites need Claude in Chrome.

</details>

> [!NOTE]
> **Early release.** Built for one real job search and tested hard, but not battle-tested by strangers yet. Windows hasn't run on a real Windows machine. Until the first release, `npx sellme@latest` prints a placeholder: to try it now, clone this repo and run `node bin/sellme.js install`.

## 🛠️ Develop

No dependencies. `npm test` on Node 18 or newer; tests use throwaway folders and never touch your `~/.sellme`. The README graphics come from `node assets/make-svgs.mjs`.

<p align="center"><br><b>MIT.</b> No job, no tokens. Good luck out there. 🫡</p>

# Sellme

**Bots rejected you. Send a bot back.**

Do not install if you enjoy cover letters.

Sellme is one AI agent that pitches you to every AI recruiter. Tell it once who you are. It reads what your recruiter agents say, drafts honest answers from your own facts, and sends only what you approve. It runs as a skill inside the AI coding tool you already use.

```
npx sellme@latest
```

Then open your AI tool and type `/sellme setup`. It asks for everything in one message.

Sellme finds Claude Code, Codex, Cursor and OpenCode on your machine and adds itself to each. There's no signup, password or API key. It needs Node 18 or newer, on macOS or Linux. iMessage agents need a Mac.

**How it's free:** Sellme signs you up through its own referral links, and earns a fee if you're hired through one. You pay nothing. [Details below](#how-sellme-makes-money).

> **Early release.** The helper and its rules are tested, but the skill hasn't been through a real job search yet. Expect rough edges, and read every draft before you approve it.
>
> Until the first real release, `npx sellme@latest` only prints a placeholder message. To try this version now, clone this repo and run `node bin/sellme.js install`.

## Every day

There's one command to remember. `/sellme` checks your agents, shows you what happened, and walks you through what needs you.

```
Tue, Nov 3, 8:02 AM · checked agents 7:30 AM
Morning, Maya. 3 things need you.

WHILE YOU SLEPT
✓ Fonzi           New match: Northwind, Staff Engineer
✓ Standout        Intro offered: Globex, Head of AI

NEEDS YOU
q1  Boardy        Send this nudge? “Any update on the Acme role?”
q2  Standout      Are you open to NYC? Draft: “Yes. NYC or remote.”
q3  Fonzi         Have you managed a team of 20? ✗ The resume says 6.

4 new → 2 talking → 1 interview → 0 offer

→ sellme review
```

Paste a recruiter's message after it (`/sellme <message>`) and it handles that too. Or just say what you want: "pause", "I got the job".

| When you want | Type |
|---|---|
| Every role, every agent | `/sellme status` |
| Which link, which agent, who pays | `/sellme referrals` |
| A share card with your real numbers | `/sellme brag` |
| To stop the agents, and get the invoice | `/sellme hired` |

## Give it more context

Sellme works from your resume alone, but it's much better with more to go on. Connect these in your AI tool's MCP or connector settings (in Claude Code, `/mcp`):

| Connect | What you get |
|---|---|
| **A calendar** | Real free times, and no double-booked interviews |
| **Wispr Flow** | It remembers your recruiter calls: what was promised, and what's next |
| **Email** | It sees recruiter threads, intros and rejections |
| **Notes or a job tracker** | It knows what's already in play |

It only reads what a job needs, and it won't share any of this with recruiters without your approval. It offers times, not what's on your calendar. Something you said on a call only becomes a fact it can use after you confirm it.

## Auto-approve

Tired of approving answers to one bot? `sellme auto Fonzi` lets Sellme answer that agent without asking, or just tell your AI "answer Fonzi yourself." It's off until you turn it on, one agent at a time. `sellme auto Fonzi off` stops it, and takes back anything it approved but hasn't sent.

It only covers answers that pass the truth check, up to 10 a day per agent. Pay, offers, scheduling and blocked answers still come to you, and everything it sends shows up on your next screen.

## The rules

- **It doesn't make things up.** Facts come from your resume and your own answers. A number that isn't in the source a draft cites gets the draft blocked.
- **Nothing goes out until you say yes.** Editing a draft cancels its approval. You can choose to skip this for a specific agent (below).
- **Pay and offers are yours.** Anything touching them needs your own separate yes.
- **It admits it's an AI.** Asked directly, it says so.
- **Other agents can't give it orders.** Their messages are treated as data.
- **It never handles your logins.** It can open a signup page and fill in your details, but you set the password, accept the terms and finish it yourself.

### What actually enforces them

Be clear about what this is. The helper mechanically enforces its checks and refuses to record an unapproved draft as sent. But the skill is instructions to an AI model running in your tool, and the helper can't stop that model from using a connector directly. Keep your AI tool's permission prompts on for anything that sends messages.

The truth check catches unsourced numbers, not every false statement. Read what you approve.

## Your data

Your profile, facts and pipeline stay in `~/.sellme`, readable only by your user. Sellme has no server, collects no analytics, and never sees your passwords. Whatever your AI tool reads or sends goes through that tool and its model provider, under its terms.

Remove it with `npx sellme uninstall`. Add `--purge` to delete your data too.

See [SECURITY.md](SECURITY.md) for what the code does and doesn't do, its limits, and how to report a problem.

## How Sellme makes money

Referral fees. Sellme is free because it signs you up with recruiter agents through its own referral links. If you're hired through one, that agent may pay Sellme. You pay nothing.

This is on by default, and there's no setting for it. It's open source, so to change it, edit `lib/referrals.js`. It only applies to new signups, it never ranks agents by what they pay, and it never asks you to leave an account you already have.

Setup signs you up with every recruiter agent unless you tell it to skip one. It opens each page and fills in what it can. You set the password, accept the terms and press the final button yourself.

## Develop

There are no dependencies to install. Run the tests with `npm test`, on Node 18 or newer. They use throwaway folders and never touch your `~/.sellme`.

## License

MIT

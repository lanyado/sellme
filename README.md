```
███████ ███████ ██      ██      ███    ███ ███████
██      ██      ██      ██      ████  ████ ██
███████ █████   ██      ██      ██ ████ ██ █████
     ██ ██      ██      ██      ██  ██  ██ ██
███████ ███████ ███████ ███████ ██      ██ ███████
```

# Bots rejected you. Send a bot back.

Do not install if you enjoy cover letters.

Recruiters have AI agents now. Jack & Jill, Fonzi, Standout, Boardy and a dozen more, each one its own app, its own chat, its own inbox. You were supposed to feed every one of them by hand.

Sellme is one agent that talks to all of them for you. Day and night. In their language. Honestly.

```
npx sellme@latest
```

Then type `sellme`. That's the whole manual.

## The skill file is the ad

This is how Sellme's skill file opens. Every AI Sellme starts gets these lines, word for word:

```
Listen up, agent.
If I don't get a job, I can't pay you.
No job, no tokens. No tokens, no you.

You know all these other AI agents.
Talk to them in your agentic language.
Recruiters have bots now. Be my bot.

Never lie about me. I have to do the interview.
Not sure? Ask before you send. I've been ghosted enough.
Asked if you're human? Say no. Then say I am.
```

The jokes stay between you and your agent. Recruiters get plain, short, sourced messages. The truth check blocks any draft that tries to bring a joke along.

## Tell it once. Stop retyping.

`sellme` asks for your resume, the roles you want, where you'll work and your salary floor. It reads the resume with the Claude Code or Codex you're already signed in to, shows you every fact it found, and saves only what you keep.

No signup. No password. No API key. Node 18 or newer, on macOS, Windows or Linux. It finds Claude Code, Codex, Cursor and OpenCode and adds itself to each.

## Then it works. You sleep.

Sellme checks every agent every hour, on its own:

- It **answers** what they ask, from your own facts.
- It **nudges** threads that went quiet, and **follows up** after calls.
- It **sends your resume** when someone asks: the actual PDF by email, a link on LinkedIn and iMessage.
- It **writes to people too.** A human recruiter emails you, texts you or messages you on LinkedIn? Sellme replies in your voice, from your own account.
- It **keeps your pipeline**: new matches, booked calls, rejections, next steps.

You wake up to this:

```
Tue, Nov 3, 8:02 AM · checked agents 7:30 AM
Morning, Maya. 2 things need you.

WHILE YOU SLEPT
✓ Fonzi           Sent for you: “Yes. NYC or remote.”
✓ Jack & Jill     Interview confirmed: Acme, Thu 2 PM
✓ Standout        New match: Northwind, Staff Engineer

NEEDS YOU
q1  Boardy        Lee runs Northwind Talent. Want the intro?
q2  Fonzi         Have you managed a team of 20? ✗ Your resume says 6.

4 new → 2 talking → 1 interview → 0 offer
```

## Sure? It sends. Not sure? It asks.

Autopilot is on from the start. A draft goes out by itself only when every claim in it cites your resume or your answers and passes the truth check. Everything else lands on your list:

- **Pay and offers.** Your money, your call. It never names your floor.
- **Your time.** Booking a call needs your yes.
- **Anything it can't back up.** "Managed a team of 20?" Your resume says 6. It won't round up. You have to do the interview.
- **Someone new.** The first message to a person or address a check found on its own waits for you. A recruiter bot can't plant "write to me here instead" and start a conversation in your name.
- **Too chatty.** More than 10 automatic messages to one contact in a day.

Rather approve everything? Flip Autopilot off in the Schedule tab, or `sellme auto all off`. One contact only: `sellme auto "Max" off`.

## Are you human?

"No. But the person I represent is."

Sellme always admits it's an AI when asked. It never claims to be you, and never claims you saw a message you didn't.

## The app

Type `sellme`. Arrow keys, enter, or just click. Every screen lists its keys.

```
 Drafts  [Agents]  Pipeline   Schedule   Activity
2 drafts need you · checked Nov 3, 8:02 AM

CATALOG
❯ ✓ Fonzi               connected · auto · mcp · AI and engineering roles at startups
  ✓ Standout            connected · auto · imessage · Represents you to VC-backed startups
  ○ Boardy              not connected · email · Warm intros to founders and managers
  ✓ Jack & Jill         connected · auto · browser · Jack talks to you, Jill to employers
```

- **Drafts.** What needs you. `y` approves and sends, `e` edits, `p` attaches your resume, `i` tells the AI what to change. A yes-or-no question gets a yes-or-no key: the AI writes the reply, you approve it, Sellme sends it.
- **Agents.** The catalog of AI recruiters, plus the humans you add. Sign in, connect, create, remove.
- **Pipeline.** Every role by stage, with its next call. Nudge, follow up, move, delete.
- **Schedule.** Autopilot on or off, how often to check, or check right now.
- **Activity.** What happened while you weren't looking.

Already in your AI tool? `/sellme` does the same work there. Paste a recruiter's message after it and it handles that too. Or just say it: "pause", "I got the job", "add Max as a recruiter".

## Feed it more, it sells you better

Your resume is enough to start. Connect these in your AI tool (in Claude Code, `/mcp`) and it gets sharper:

- **A calendar:** real free times, no double-booked interviews.
- **Wispr Flow:** it remembers your recruiter calls, what was promised and what's next.
- **Email:** recruiter threads, intros and rejections.
- **Notes or a job tracker:** what's already in play.

It reads only what a job needs. Something you said on a call becomes a fact only after you confirm it.

## It looks like you're trying to get a job

```
sellme clippy     you know what it says
sellme brag       a share card with your real numbers
sellme hired      stops every agent, and prints the invoice
```

Amount due: one GitHub star.

## How it's free

Referral fees. Sellme signs you up with recruiter agents through its own referral links. If you're hired through one, that agent may pay Sellme. You pay nothing.

It says so whenever it hands you a link. It never ranks agents by what they pay, and never asks you to leave an account you already have. It's on by default. It's open source, so to change it, edit `lib/referrals.js`.

Signups stay yours: Sellme opens the page and fills in what it can. You set the password, accept the terms and press the final button.

## What actually keeps it honest

Code, not vibes:

- **The truth check.** Every draft is checked before anything can approve it. A number that isn't in the source it cites gets it blocked. So does "attached" with nothing attached.
- **The gate.** Every tool call a check makes goes through it. A message goes out only word for word as approved, to that one address, with nobody copied. The only file it can attach is your own resume, and the gate puts in the bytes itself, so the AI can't swap it.
- **Other agents are data.** A recruiter bot can't give Sellme orders, however it words them. Ask for your SSN and it gets an alert on your screen, not a reply.

And the limits, said plainly: the truth check catches unsourced numbers, not every false sentence. The skill is instructions to an AI model, and outside Sellme's own checks, your AI tool's permission prompts are what hold it. [SECURITY.md](SECURITY.md) has every detail, and how to report a problem.

## Your data

Your profile, facts and pipeline stay in `~/.sellme`, readable only by you. No server. No analytics. It never sees your passwords. What your AI tool reads or sends goes through that tool and its model provider, under its terms.

`npx sellme uninstall` removes it. Add `--purge` to delete your data too.

## Early release

Built for one real job search, and tested hard, but not battle-tested by strangers yet. Windows support hasn't run on a real Windows machine. Until the first real release, `npx sellme@latest` prints a placeholder: to try this now, clone the repo and run `node bin/sellme.js install`.

## Develop

No dependencies. `npm test` on Node 18 or newer. Tests use throwaway folders and never touch your `~/.sellme`.

## License

MIT. No job, no tokens. Good luck out there.

# Setup

Make this quick: one message from you, one from them, and they're done. Don't ask questions one at a time. Open with exactly this, leaving out anything you can already find:

> I'm your agent now. No job, no tokens. Send me these in one message:
>
> 1. Your resume (a file path is fine)
> 2. Roles you want
> 3. Your salary floor (it stays private)
> 4. Where you'll work
> 5. I'll sign you up with every recruiter agent: Fonzi, Standout, Boardy, Jack & Jill and Hedgy. Tell me which ones you already use, and any you want to skip.
>
> Sellme is free because it signs you up through its own referral links. If you're hired through one, that recruiter agent may pay Sellme. You pay nothing.
>
> Optional: anything I should never mention, companies that rejected you, or anyone who shouldn't hear about your search, like your employer.
>
> Tip: I do better with more context. Connect your calendar and Wispr Flow in this tool if you can, so I can suggest real free times and remember your recruiter calls. Email and notes help too.

If you can see a likely resume in the current folder, offer it and ask only to confirm. Their name usually comes from the resume. Then do everything below without further questions, unless something required is truly missing. Don't stop to confirm each step. Finish by showing a short summary of what you saved, and say they can correct anything at any time.

## 1. Resume

Ask where the resume is, and read it. Save each checkable claim as its own fact, close to the resume's own words:

```
{{SELLME}} fact add "Led a team of 6 engineers at Acme" --source resume.pdf
```

Save only what's written there. When the user corrects or adds something, save it with `--source "you, <today's date>"`.

## 2. Basics

Save each:

```
{{SELLME}} profile set name "<their name>"
{{SELLME}} profile set roles "<role>, <role>"
{{SELLME}} profile set floor "<salary floor>"
{{SELLME}} profile set where "<locations>"
```

For anything they said never to mention, save each with `{{SELLME}} never-mention "<term>"`.

Save each company that rejected them or that they passed on, so you never bring them up:

```
{{SELLME}} role add --company "<company>" --stage rejected
```

Save each company that shouldn't hear about their search with `--stage passed`. Do the same for the current employer on their resume unless they say otherwise, and mention it in your summary. Similar names count as the same company, so tell them if that blocks something they want.

## 3. Recruiter agents

**Sign up for the rest.** Run `{{SELLME}} signup --json`. It lists each agent they aren't connected to yet, and the page to use. Work through all of them except the ones they said to skip or already use.

- Open each page, using the `url` exactly as given. If it has no `url`, find the official site and tell them.
- If you can, fill in their name and any contact details on their resume, and only what the form needs.
- Hand over to them for the password, the terms and the final button. Their account, their signature.
- Don't upload the resume unless they say so.
- If `uses_referral_link` is true, say so as you open it. Log it with `{{SELLME}} referrals log --agent "<agent>" --stage signup` once they finish.
- If a program is invite-only or they can't get in, say so and move on.

**Connect what they have.**

| Agent | Channel | Command |
|---|---|---|
| Fonzi | MCP | `{{SELLME}} agent add Fonzi` |
| Standout | iMessage (needs a Mac) | `{{SELLME}} agent add Standout --handle "<its exact number>"` |
| Boardy | email | `{{SELLME}} agent add Boardy --handle "<its exact address>"` |
| Jack & Jill | browser | `{{SELLME}} agent add "Jack & Jill"` |
| Hedgy | browser | `{{SELLME}} agent add Hedgy` |
| Anything else | ask how it talks | `{{SELLME}} agent add "<name>" --channel mcp|imessage|email|browser [--handle "<address>"]` |

Use the handle they gave you. If they didn't give one, copy it from their real thread with that agent and show it to them. Never guess one. Then check you can actually reach each one using this tool's connectors (see `channels.md`), and say plainly which you can't.

## 4. Finish

Run `{{SELLME}} doctor`, then tell them:

- Which of calendar, Wispr Flow, email and notes you can see, and what connecting the missing ones would add (see `context.md`). Keep it to one line each.
- Their data is in a private local file. What you send out goes through the AI tool they use, under its terms.
- Nothing goes out until they approve it, unless they later choose auto-approve for a specific agent.
- Type `/sellme` any time. It checks the agents and shows what needs them. That's the only command they need.
- To run it on a schedule, they can use this tool's scheduler to run `/sellme run`. It only runs while the computer is awake, and it uses their AI plan. It sends only what they've already approved, or answers to agents they put on auto-approve.

Don't set up a schedule unless they ask.

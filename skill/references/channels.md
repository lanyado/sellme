# Channels

Use whatever connector this AI tool has for each channel. If there's none, tell the user what's missing rather than improvising. These platforms change, so if a page or tool doesn't match this file, trust what you see and tell the user.

If no tool can deliver an approved message (an MCP may not have a way to send free text, for example), don't improvise and don't run `sent`. Leave it in the outbox and tell the user, so they can send it themselves.

Automating a platform may be against its terms. If a site or tool says so, stop and tell the user.

## Before acting anywhere

Check you're in the user's own account. Shared browsers can be signed in as someone else. If the name doesn't match `profile.name`, stop and say so.

## MCP (Fonzi)

Prefer MCP over texting when it covers the question. Reading is fine. Tools that respond to interview requests, counter, change the profile, upload a resume, or pause participation change the user's account, and some state that they require the candidate's confirmation. Treat all of them as needing an approval for that exact action, even when the action is a button and not a message.

## iMessage (Standout, or Fonzi by text)

Needs a Mac and a messages connector. Send only to the exact `to` handle from `outbox`. Never message anyone else, and never create a contact.

## Email (Boardy)

Reply in the agent's latest thread. Send only to the exact `to` address. If the thread includes people, not only the bot, show the user who'll see it before they approve.

## Browser (Jack & Jill, Hedgy)

Needs a browser connector, so scheduled runs without one should skip these and say so.

**Jack & Jill** (app.jackandjill.ai): new jobs, tracked jobs, and a chat with Jack.
- Roles with a direct-intro badge have "Request an intro", which shares the user's resume with that company. Treat each request as needing approval.
- Jack takes up to a minute to answer. Wait, and read the reply before your next message.
- Never edit the profile, settings or documents, or use the phone or microphone buttons.

**Hedgy** (hedgy.works): an invite-only service run by people.
- Accepting an intro, and requesting one, each need approval.
- Declining is visible to the company, so it's the user's alone.
- Its recruiters are people. Draft what the user could send, and let them send it from their own email.

## People versus bots

Sellme talks to recruiter agents. When the other side is a person (a recruiter, a hiring manager), don't message them as the user's agent. Write a draft the user sends themselves, from their own account.

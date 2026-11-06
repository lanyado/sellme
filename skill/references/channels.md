# Channels

Use whatever connector this AI tool has for each channel. If there's none, tell the user what's missing rather than improvising. These platforms change, so if a page or tool doesn't match this file, trust what you see and tell the user.

If no tool can deliver an approved message (an MCP may not have a way to send free text, for example), don't improvise and don't run `sent`. Leave it in the outbox and tell the user what was missing, so they can connect it. Never ask them to send it themselves.

Automating a platform may be against its terms. If a site or tool says so, stop and tell the user.

## Before acting anywhere

Check you're in the user's own account. Shared browsers can be signed in as someone else. If the name doesn't match `profile.name`, stop and say so.

## MCP (Fonzi)

Prefer MCP over texting when it covers the question. Reading is fine. Tools that respond to interview requests, counter, change the profile, upload a resume, or pause participation change the user's account, and some state that they require the candidate's confirmation. Treat all of them as needing an approval for that exact action, even when the action is a button and not a message.

## iMessage (Standout, or Fonzi by text)

Needs a Mac and a messages connector. Send only to the exact `to` handle from `outbox`. Never message anyone else, and never create a contact.

## Email (Boardy, and people with an email address)

Reply in the latest thread with that address, using the email tool's reply (or `replyThreadId`), with no subject line and nobody copied. If there's no thread with them, send a new email to `to` with `subject` exactly as the outbox gives it. Don't stop to ask which: nobody can answer during a send. Send only to the exact `to` address. If the thread includes other people, show the user who'll see it before they approve.

If the outbox item has `attach`, put that object, unchanged, as the only item in the tool's `attachments`: `[{"filename": "<its filename>", "content": "SELLME_RESUME"}]`. Never encode or read the file yourself. The gate swaps in the user's real resume, and refuses the send if the attachment is missing or anything else.

## LinkedIn (people with a LinkedIn profile)

Send with the LinkedIn tool's `send_message`: `linkedin_username` is the exact `to` from `outbox`, `message` the approved text, `confirm_send` true. Nothing else. LinkedIn and iMessage can't carry files here, so a resume goes as the link already in the approved text. If LinkedIn says the person can't be messaged yet, leave it in the outbox and tell the user why.

## Browser (Jack & Jill and most of the catalog)

Needs Claude in Chrome, so runs without it should skip these and say so. Reading is fine on any agent's site.

To send an approved message, do these one tool call at a time, because a batch is refused:

1. Open the agent's site in a tab, and check the signed-in name matches `profile.name`. If it wants a login, run `connect "<agent>" signin` and stop.
2. `read_page` with filter `interactive`, and find its chat box.
3. `computer` with `left_click` and that box's `ref`.
4. `computer` with `type` and the message, exactly as written.
5. `computer` with `key` and `Return`. If Enter doesn't send it here, `read_page` again and `left_click` the Send button's `ref`.
6. Read the page to confirm the message appears in the chat. Then run `sent <id>`, and close the tab.

If there's no chat box, or a step is refused, stop and say so. Don't try another way. A refusal in a run is final.

**Jack & Jill** (app.jackandjill.ai): new jobs, tracked jobs, and a chat with Jack.
- Roles with a direct-intro badge have "Request an intro", which shares the user's resume with that company. Treat each request as needing approval.
- Jack takes up to a minute to answer. Wait, and read the reply before your next message.
- Never edit the profile, settings or documents, or use the phone or microphone buttons.

**Hedgy** (hedgy.works): an invite-only service run by people. It has a dashboard and emails intros, and has no chat.
- Read its dashboard and offers, and `note` what's new. Don't `draft` to Hedgy, since there's nowhere to send it.
- Accepting an intro, and requesting one, each need approval.
- Declining is visible to the company, so it's the user's alone.

**Any other agent on the browser channel** (`{{SELLME}} agents --json` lists each one's `url`): sign-in stays theirs. Read its messages, matches and interview requests, and use its chat through the gate like any other message. Applying, requesting an intro or editing a profile each need approval for that exact action.

## People versus bots

When the other side is a person (a recruiter, a hiring manager), add them once with `add "<name>" --handle "<email, phone or LinkedIn profile>"` and draft in the user's first-person voice. Once the user approves it, it's in the outbox like any other message, with `person: true` and the channel its handle needs: `email`, `imessage` or `linkedin`. Send it from the user's own account exactly as approved. Every message to a person needs the user's yes: auto-approve can't be turned on for one.

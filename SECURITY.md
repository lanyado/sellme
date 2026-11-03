# Security

Sellme handles your job search, so here's what it does and doesn't do. You can check all of it in the code.

## What's in the code

- **No network access.** The helper in `lib/` and `bin/` makes no network calls, and Sellme has no server.
- **No running other programs.** It doesn't start other programs or run code it builds on the fly.
- **No dependencies.** It uses only what comes with Node, and has no install scripts.
- **No API keys.** It doesn't ask for, store or read any. Connectors are set up in your AI tool, which holds their logins.
- **Private local data.** Your profile, facts and pipeline stay in `~/.sellme`, readable only by your user.

To check the first two yourself:

```
grep -rnE "node:(http|https|net|tls|dns|dgram|child_process|vm)|fetch\(|eval\(|new Function" lib bin
```

It should print nothing.

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

---
title: The research terminal's off switch
type: topic
slug: chat-terminal-switch
date: 2026-09-16
updated: 2026-09-16
belongs_to: [marketecx, system-architecture]
source: synthesis
status: active
tags: [web, security, ops, feature-flag]
related: [2026-09-16-public-market-map, console-auth]
---

## What it is

`CHAT_ENABLED` in `web/middleware.ts` — the switch that turns the research
terminal at `stock.tecxmate.com/chat` on and off. It **defaults to off**.

## The four states, and why each is distinguishable

| `CHAT_ENABLED` | `CHAT_PASSWORD` | `/chat`, `/api/*` | Means |
|---|---|---|---|
| unset / anything but `"true"` | — | **404** | Deliberately closed |
| `true` | unset | **503** + "set this variable" | Misconfigured |
| `true` | set | **401**, `200` with credentials | Open to whoever has the shared credential |
| — | — | `/`, `/coverage`, `/market-map` always `200` | Public surface, unaffected |

The first two rows are the point. Before 2026-09-16 there was only one of them:
the chat was unreachable because nobody had set `CHAT_PASSWORD` on Vercel, so
"off" and "broken" produced the same 503 and the code could not tell you which
one was intended.

That is the failure CLAUDE.md already records for Telegram — disabling by
unsetting `TELEGRAM_TOKEN` made a dead notify path look exactly like a quiet
one, and every alert sat at `pushed:false` for weeks behind it. The rule there is
**do not disable by unsetting the secret**, and it applies verbatim here.

## Decisions inside the switch

- **Default off**, so the switch needed nothing set on Vercel to take effect.
  The variable that was *supposed* to be set there is the one nobody set; a
  default-on flag would have depended on the same step failing again.
- **`=== "true"`**, not `!== "false"` and not truthiness. A typo has to land on
  closed. An off switch that a misspelling opens is not an off switch.
- **404 rather than 401 or 503.** 401 invites a password guess; 503 invites a
  retry. Off should look like nothing is there, and it leaks nothing about what
  the route would have reached.
- **Checked before the fail-closed password branch.** Falling through to a
  credential prompt would advertise the surface the switch exists to close.
- **The landing page reads the same flag**, so the nav link and the route turn
  off together. A link to a 404 reads as a broken site rather than a closed one.
  Read at build, which cannot drift within a deployment — and flipping the
  variable needs a redeploy anyway.

## Turning it back on

Two variables in the Vercel project, then redeploy:

```
CHAT_ENABLED=true
CHAT_PASSWORD=<the shared credential>
CHAT_USER=<optional; defaults to "alphatecx">
```

Both are required. Setting only `CHAT_ENABLED` gives the 503 row above — which
is the intended behaviour, not a bug: it says out loud that the deployment is
half-configured rather than quietly serving an open terminal.

## What the gate still does when it is on

It covers `/chat/*` **and** `/api/*`, and that second half is the whole reason
the middleware exists. `/api/chat` is a general-purpose proxy to the MCP server:
it holds the bearer token server-side, reaches all 53 tools including the ones
that write, and spends the Anthropic API key on every message. Anyone who could
call that route directly never needed the page.

The matcher names what is gated rather than excluding what is not, so `/`,
`/coverage` and `/market-map` are public *by construction*. Inverting it — gate
everything except a pattern — silently starts gating a new public page or
silently stops gating a new API route depending on which way the regex is wrong,
and both failures are quiet. `tests/test_web_chat_gate.py` pins that too.

## If real per-person identity is ever wanted

Not a bigger version of this file. The answer is Cloudflare Access on the
hostname; the runbook is already in [`console-auth`](console-auth.md).

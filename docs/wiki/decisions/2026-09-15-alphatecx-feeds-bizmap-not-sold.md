---
title: alphatecx is not sold — it feeds bizmap/marketecx, which is
type: decision
slug: 2026-09-15-alphatecx-feeds-bizmap-not-sold
date: 2026-09-15
updated: 2026-09-15
attributed_to: [niko]
belongs_to: [alphatecx, marketecx]
source: chat
status: active
tags: [commercialization, monetization, licensing, compliance, marketecx, product]
related: [2026-08-08-commercialization-direction, marketecx, niko, claude-agent]
---

## Context

[niko], 2026-09-15:

> monetizing tecxwork and alphatecx both touch legal gray zone, probably need to leverage
> their data to support bizmap only, bizmap, marketecx system is our flagship product

This directly revises [2026-08-08-commercialization-direction](2026-08-08-commercialization-direction.md),
whose Phase 1 was "ship the remote MCP connector (model A), **gated behind a paid
subscription (Stripe)**". That page is now `superseded`.

## Decision

**alphatecx is not a product and will not be sold.** It stays a private connector and a data
source. The commercial surface is bizmap/marketecx, and alphatecx contributes to it as an
input.

## Rationale

The 2026-08-08 page already contained the reason, as a deferred gate rather than a
conclusion. Its 2026-08-09 settlement reads:

> current use is framed as **private, not a commercial sale** — so the
> investment-advice-licensing lawyer step is **set aside for now** … that gate reopens the
> moment this becomes a public/commercial offering.

The Phase 1 plan was the thing that would reopen it. Dropping Phase 1 does not defer the
gate again; it closes it, because the private framing stops being a temporary posture and
becomes the permanent one. Two exposures go with it:

- **Investment-advice licensing.** Selling tools that help funded investors make financial
  decisions can cross into regulated advice depending on jurisdiction. That risk is
  priced by whether money changes hands for the advice surface.
- **The market data's own terms.** FinMind, yfinance and the TWSE scrapes were obtained for
  one person's own use. A paid subscription over the same tools is a different act under the
  same terms.

Neither is a reason the *data* is unusable. They are reasons the *invoice* cannot be for
alphatecx.

## The constraint that is easy to get wrong

**A licence travels with the data, not with the repository it sits in.** Deciding alphatecx
is not sold does not make a FinMind-sourced price series sellable by copying it into
something that is — if it reaches a paid bizmap export, it was sold, and the terms it
breaches are still FinMind's. So "supports bizmap only" is a per-source test, not a
per-repo one.

What may cross into a paid bizmap surface, from this repo:

| From alphatecx | May it reach a paid surface? | Why |
|---|---|---|
| 統編 ↔ 公司代號 ↔ 市場別 bridge (`src/harvester/tax_ids.py` → `listed_companies.csv`) | **Yes** | TWSE 公開資訊觀測站 open data under 政府資料開放授權條款第1版, the same licence as everything else on bizmap's pages |
| Supply-chain node classification | **Yes** | our own editorial judgement over public filings |
| Aggregate or derived signals where no series is republished | **Probably**, case by case | the derivation is ours; the underlying series is not |
| Prices, institutional flows, valuation series (FinMind, yfinance, TWSE scrapes) | **No, not as rows** | vendor terms, obtained for personal use |

The 統編 bridge is the one that carries the near-term value, and it is clean — which is not
luck. [niko] asked for provenance *before* the file was fetched:

> I need the provenance, because bizmap's entire claim is that it's built from government
> open data under 政府資料開放授權條款 — TWSE 公開資訊觀測站 qualifies, a commercial vendor
> feed doesn't and I'd drop the facet rather than muddy that.

A vendor feed with the same columns would have been easier to obtain and would have cost the
facet.

## Consequences

- [2026-08-08-commercialization-direction](2026-08-08-commercialization-direction.md) →
  `status: superseded`. Phase 1 (Stripe gate over OAuth), per-customer metering and the
  disclaimer field on `_stamp()` are **not being built**. The OAuth 2.1 + PKCE work already
  merged still earns its place as access control for a private connector.
- Phase 2 (headless web app embedding Claude) and the mobile shell are off the table on the
  same grounds, not merely deferred.
- **The lawyer's read "before taking money" is not owed here any more** — no money is taken
  here. The compliance question moves to bizmap, where it is a different question
  (registry republication and 個資法, not investment advice) and is already queued in
  `bizmap/docs/legal.md`.
- The `_stamp()` provenance fields stay as they are. They were never only a compliance
  device; they are what makes a tool response auditable.
- New extracts pushed to bizmap must name their source and licence in
  [topics/marketecx.md](../topics/marketecx.md) before they are built, the way the 統編
  bridge was.

## Provenance

- Discussed 2026-09-15 between [niko] (owner) and [claude-agent] (agent).
- Recorded on the bizmap side as `docs/marketecx.md` §11 and a tripwire in
  `docs/legal.md`; on the tecxwork side as the aggregates-only boundary in
  `docs/wiki/decisions/2026-09-14-marketecx-tecxwork-contribution.md`.
- No code changed in this repo.

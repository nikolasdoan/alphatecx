---
title: marketecx — what alphatecx contributes, and the one column it is missing
type: topic
slug: marketecx
date: 2026-09-14
updated: 2026-09-14
belongs_to: [system-architecture, mcp-server]
source: synthesis
status: proposed
tags: [marketecx, integration, mcp, identity]
related: [system-architecture, mcp-server, taiwan-ai-supply-chain]
---

## Summary

[niko] is joining three Tecxmate systems into **marketecx**, a market-intelligence product
reached through a queryable Claude connector: **bizmap** (255,637 Taipei business
registrations, 98% geocoded from the tax registry), **alphatecx**, and **tecxwork** (open
roles, categories, salary bands). The worked example is a street-level question — "what
restaurants are on 永康街" — answered from the business registry and compared against Google
Maps, the gap between the two being itself the information.

alphatecx contributes the market layer: institutional flows, monthly revenue, supply-chain
nodes, and — more importantly — **the only working Claude connector of the three**. The full
proposal lives in `tecxmate/bizmap` → `docs/marketecx.md`
([PR #32](https://github.com/tecxmate/bizmap/pull/32)). This page records what binds *this*
repo.

## Current state

Proposed, not started. Nothing in this repo has changed.

### The missing column

**alphatecx holds no 統一編號 anywhere.** `dim_ticker` is keyed on `ticker_id` and carries
`company_name`, `market`, `ai_pillar`, `node`, `us_partners`. A grep for 統一編號 / `tax_id` /
`unified` across `src/`, `sql/` and `mcp_server/` returns nothing.

The other two sides already have it: bizmap's `company.id` **is** the 統編 for every
registration, straight from 財政部's registry, and tecxwork has
`clients.unified_business_no`. So alphatecx is the side that cannot be joined, and **one
column on `dim_ticker` — from MOPS 基本資料, which publishes 統一編號 beside 證券代號 — closes
the triangle.**

Without it the join falls back to matching Chinese company names, with 股份有限公司 suffixes,
no uniqueness guarantee, and issuer renames — a failure mode this repo has already been bitten
by once ([view_ticker_momentum refresh break](view-ticker-momentum-refresh-break.md)). For a
connector whose output an LLM presents as fact, name matching is how the product returns wrong
answers confidently.

### Why nothing may reach this Postgres

marketecx centralizes into **Cloudflare D1** as a read model. That is the right call on its
own merits (D1's limits are not the constraint: 10 GB per database against tens of MB of
registry and hundreds of MB of daily series), but the decisive reason is ours:

**this Postgres has TLS disabled outright** — `sslmode=require` is rejected — which is why
[the Zeabur migration decision](../decisions/2026-07-31-migrate-neon-to-zeabur.md) tolerates
it only across the project's private network. A Cloudflare Worker at the edge is not on that
network. So the traffic must reverse: **the nightly Actions job, which already holds the
credentials, pushes a derived extract to D1 over the authenticated HTTPS API. Nothing pulls.**

This also settles what cannot move at all. `q_pca_decompose`, `q_cointegration_pair` and
`q_factor_alpha` are numpy over Postgres reads, and SQLite cannot run them. It does not need
to: the MCP tools already read **pre-computed views** rather than doing the maths per request,
and it is those views that ship. The facts centralize; the computation stays where the
libraries are.

### What marketecx is copying from this repo

Recorded here because these are the things that will be got wrong if they are re-derived:

- `_stamp()` — `_source` / `_as_of` / `_freshness` on every response. For a product whose
  pitch is comparing against Google Maps, an answer that cannot say what it counted and when
  is not comparable to anything.
- **The capabilities registry, and the test that pins it.** A tool missing from
  `sc_capabilities` is a tool the model has been told does not exist; the registry drifted to
  33 of 48 before `tests/test_capabilities.py` asserted both directions.
- `query_safety.safe_flow_col` — never interpolate a SQL identifier without a whitelist. In
  marketecx the caller is an LLM assembling arguments from a sentence, which is strictly worse
  than a human with a form.
- Dates are `Asia/Taipei`. Both the exchange and the business registry publish on Taipei
  wall-clock; UTC mislabels the as-of date for ~8 hours a day.
- Tool descriptions are the user interface. marketecx's hardest failure is Claude reporting
  *registrations* as *storefronts*, and the description is what prevents it.
- **The one thing not to copy: URL-as-secret auth.** `/mcp/<token>/` was a Vercel-shaped
  compromise for a single-user server. bizmap already has Google OAuth, server-side sessions
  and an atomic per-day quota, and Cloudflare supports OAuth for remote MCP directly — which
  matters because an LLM issues 400 queries where a human issues four.

## Open questions

- Is marketecx a product or an internal research tool? Republishing TWSE-derived figures
  inside a commercial product is not the same as one person consulting them, and this repo was
  built for the latter.
- Does *hiring lead revenue*? tecxwork's openings against `raw_monthly_revenue`, using the
  `q_lead_lag` / `q_cointegration_pair` machinery that already exists here. It is the entire
  justification for tecxwork's involvement and it is testable on history rather than assumed.
- Does the 2,000-ticker overlap carry a product at all? Listed companies are 0.8% of bizmap's
  census. The value is the **unlisted** layer around them — bizmap's data with alphatecx as
  the lens, not the reverse.

## History

- 2026-09-14 — proposed by [niko]; all three codebases read and the design written up in
  bizmap. The 統編 gap on `dim_ticker` identified as the cheapest and highest-value change in
  the plan. Nothing implemented here.

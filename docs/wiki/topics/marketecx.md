---
title: marketecx — what alphatecx contributes, and the one column it is missing
type: topic
slug: marketecx
date: 2026-09-14
updated: 2026-09-15
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

Proposed. One piece is built: the 統編 bridge — `dim_ticker.tax_id` plus the table bizmap asked
for (see *The bridge — built 2026-09-15* at the end). Nothing else in this repo has changed.

### The missing column — closed 2026-09-15

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

marketecx centralizes into **Cloudflare D1** as a read model, and the decisive reason is ours:

> **Corrected 2026-09-14.** This paragraph first read "D1's limits are not the constraint:
> 10 GB per database against tens of MB of registry and hundreds of MB of daily series."
> That reasoned from the *storage* limits and missed the one that binds — on the free plan
> **D1 caps rows written at 100,000 a day**, so bizmap's 513,807-row census takes six days to
> load. bizmap has since added **Neon as a secondary store** (`a4b47bfe`) precisely because
> the two free tiers meter opposite things: D1 caps writes, Neon caps storage (0.5 GB) and
> does not cap writes. The shape there is now `data/derived/*.json` as the source of truth
> with both databases as read models rebuilt from it — D1 the hot path, Neon holding the
> secondary and spatial indexes and `pg_trgm`.
>
> **What this changes for alphatecx: nothing, and that is worth stating.** The extract this
> repo pushes is ~2,000 rows of pre-computed views, nowhere near either ceiling, and bizmap
> keeps its own Neon project rather than sharing one — a 175 MB registry and a market-data
> warehouse in a single 0.5 GB budget means whichever fills it first breaks the other's
> writes. The direction of travel is unchanged: the mapping is small, so it moves.



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
- 2026-09-15 — the bridge built for [niko] by [claude-agent]: harvester, migration 027, 13
  tests; the table delivered to bizmap; the SQL verified on a throwaway local Postgres. Not yet
  applied to Zeabur.

---

## The 統編 bridge table — spec, 2026-09-14

bizmap stated what it needs, so this is now a specification rather than an intention:
**one table, ~2,000 rows, `統一編號 → ticker → 市場別 → company name`, CSV or JSON.** Only the
統一編號 join key is essential; the rest is display. Two conditions came with it — a per-row
confidence flag if the mapping is name-matched, and clean government provenance, because
bizmap's whole claim is that it is built from open data under 政府資料開放授權條款 and a vendor
feed would muddy that.

**Both conditions are satisfiable, and the first one largely dissolves.**

### The source carries 統一編號 directly — no name matching

TWSE publishes company basic data as open data, and **營利事業統一編號 sits in the same row as
公司代號**. There is no matching step to be confident about:

| | 上市 | 上櫃 | 興櫃 (confirmed 09-15) |
|---|---|---|---|
| data.gov.tw dataset | [18419](https://data.gov.tw/dataset/18419) | [25036](https://data.gov.tw/dataset/25036) | [28568](https://data.gov.tw/dataset/28568) |
| CSV | `https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv` | `https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv` | `https://mopsfin.twse.com.tw/opendata/t187ap03_R.csv` |

Published columns, in order: 出表日期, 公司代號, 公司名稱, 公司簡稱, 外國企業註冊地國, 產業別,
住址, **營利事業統一編號**, 董事長, 總經理, … The file carries far more than is wanted; take four
columns and drop the rest.

**Parse by header name, never by index.** bizmap's own devlog records the cost of the other
habit — an early script read capital and organisation type one column over, tested the invoice
flag as the organisation type, and reported a citywide SME count of **zero**. It failed loudly
that time. The same mistake with a plausible result is invisible, and this file has 30-plus
columns and is republished daily.

### Provenance

Publisher 金融監督管理委員會證券期貨局 via TWSE, distributed on 政府資料開放平臺 under
**政府資料開放授權條款第1版** — the same licence as every source already on bizmap's pages, so the
attribution block gains a line and nothing about the licensing position changes. No vendor feed,
no application, no key. That is exactly the bar bizmap set.

### Shape

```json
{"tax_id": "22099131", "ticker_id": "2330", "market": "上市",
 "name": "台灣積體電路製造股份有限公司", "match": "exact", "source": "twse:t187ap03_L",
 "as_of": "2026-09-14"}
```

`match` is kept even though every row is `exact`, for two reasons: it lets bizmap publish on
`match == "exact"` as it asked, without the column's meaning changing if a fuzzy source is ever
added; and it makes a future degradation visible rather than silent.

### Settled 2026-09-14 — it was built, and both open items resolved

[niko] ran the harvester (`python -m src.harvester.tax_ids`) on a machine that can reach
TWSE, and delivered the table to bizmap as `pipeline/listed_companies.csv`
([tecxmate/bizmap#34](https://github.com/tecxmate/bizmap/pull/34)). **2,340 rows**, and both
caveats below are answered:

- **興櫃 exists after all.** There is a third file, `t187ap03_R`, and it carries 363 rows.
  The split is 上市 1,086 · 上櫃 891 · 興櫃 363, so `市場別` carries all three of its values
  and nothing is absent.
- **The column list was right.** `match` is `exact` on all 2,340 rows — the join came from
  the 統一編號 column, not from name matching, exactly as specified.

Validated against the delivered file rather than its commit message: 2,340 rows, 7 fields on
every row, every `tax_id` eight digits, **zero duplicate `tax_id` and zero duplicate
`ticker_id`**, and `source` splitting 1,086 / 891 / 363 across the three TWSE files.

Two details worth keeping. Three registered names legitimately contain commas —
`TPK Holding Co., Ltd.`, `AES Holding Co., Ltd.`, `91APP, Inc.` — and are correctly quoted,
so a consumer that splits on `,` corrupts three rows while a real CSV parser does not.
bizmap reads every CSV through `csv.reader` / `csv.DictReader`, so it is safe there; it is
the kind of thing that breaks a downstream script written in a hurry. And of the 2,340,
**2,220 are present in bizmap's registry** — the 120 absent are 119 foreign-registered
issuers plus one domestic ticker, which is the expected shape rather than a matching failure.

### What was NOT confirmed when this was written

- **興櫃.** 上市 and 上櫃 are confirmed above. Whether an equivalent open dataset exists for 興櫃
  is unverified — if it does not, `市場別` carries two of its three values and 興櫃 issuers are
  simply absent. Worth one check before the facet promises three.
- **The column itself, by direct observation.** `mopsfin.twse.com.tw` and `data.gov.tw` are both
  refused by this environment's egress proxy (403 on CONNECT), so the field list above comes
  from two independent secondary sources, not from opening the file. **The harvester must verify
  rather than assume**: assert the header contains 公司代號, 公司名稱 and 營利事業統一編號 on every
  run and fail loudly if not. That is the same discipline `apply_delta.py` already applies to
  grants — read it back, fail if it did not land — and the right shape for a daily-republished
  government file whose schema nobody promised to keep.

### Where it lands here

`dim_ticker.tax_id`, nullable, with a unique index. Nullable because ETFs, TDRs and anything
auto-discovered by a T86 fetch will never have one, and a NOT NULL column would make the
harvester's normal case an error.

---

## The bridge — built 2026-09-15

Built to the spec above, on branch `feat/tax-id-bridge`, stacked on
[PR #19](https://github.com/tecxmate/alphatecx/pull/19).

| Piece | Where |
|---|---|
| Fetch, parse, export | `src/harvester/tax_ids.py` — `python -m src.harvester.tax_ids --out listed_companies.csv [--load]` |
| Landing | `loader.upsert_tax_ids`; `sql/027_dim_ticker_tax_id.sql`, listed in `apply_schema.py` and `apply_delta.py` |
| Tests | `tests/test_tax_ids.py` — 13, offline |
| The table | 2,340 rows (上市 1,086 · 上櫃 891 · 興櫃 363), as of 2026-09-14, delivered to `tecxmate/bizmap` as `pipeline/listed_companies.csv` |

### Minimise downloading — and why every column still comes from the file

[niko] asked whether alphatecx's own data could stand in for downloading, since it already
holds most of this. It does hold most of it: **1,967 of the 1,977 上市/上櫃 companies are
already in `dim_ticker`**, with ticker, market and short name. But the one essential column is
in no table at all, so one fetch is unavoidable — **1.45 MB for all three markets** — and the
delivered table was built from that single copy.

The display columns come from the same file anyway, for two reasons found while checking:

- **Provenance.** bizmap's condition is 政府資料開放授權條款. The file carries it; `dim_ticker`'s
  names and markets come from T86 trading feeds, not from an OGDL-licensed dataset.
- **Accuracy.** On the Neon copy (last written 2026-07-30), `dim_ticker.market` disagrees with
  the file for **9 companies** — 3653 健策 and 6515 穎崴 carried as TPEX but listed 上市, 5347 世界
  and 6125 廣運 carried as TWSE but listed 上櫃, among others. Some may be moves since July; not
  re-checked against Zeabur. It also holds 52 four-digit tickers that appear in none of the
  three current files (2311 日月光, 2448 晶電 …, and the TDRs); those stay NULL.

**Consequence: not in the nightly harvest.** A company keeps its 統一編號, so a refresh only
picks up new listings. Run the command when bizmap needs a fresh copy.

### What opening the files showed

Three things the spec could not have known:

- **Every TDR's 統一編號 is `00000000`** in eight rows. They would violate the unique index on
  the first load, so they are skipped.
- **Names carry HTML character references** — `邁&#33834;科技股份有限公司`,
  `&#20870;星科技股份有限公司`. Decoded with `html.unescape`.
- **The CSV is served as `text/csv` with no charset**, so `requests`' `r.text` decodes it as
  ISO-8859-1 and every Chinese column turns to mojibake. The fetch decodes the bytes as UTF-8.

### Verification

- **Against 財政部's registry**, using the copy bizmap already had on disk (snapshot 14-SEP-26,
  no download): beyond the 2,220 / 120 split in *Settled* above, 2,178 are present under an
  identical name, the one domestic absentee is 3718 中光電投資控股, and **676 are registered in
  臺北市 and 417 in 新北市** — the 1,093 bizmap's census can actually join.
- **The SQL, against a throwaway local Postgres 17**, since the suite has no DB: 027 applies
  twice cleanly; `--load` assigns 統編 to listed tickers, leaves ETF, TDR and retired rows NULL
  and writes `ingestion_log`; a re-run touches 0 rows; a ticker change moves the 統編 by
  releasing then assigning, and assigning without releasing first raises `UniqueViolation` —
  the negative control for why the loader orders its two statements that way.

### Not yet live

Migration 027 is applied nowhere. On [niko]'s Mac `.env` still points at the Neon rollback copy
(data ends 2026-07-30), not Zeabur as CLAUDE.md says, so a local `apply_schema.py` would migrate
the wrong database. To land it: `apply_delta.py` against the Zeabur DSN, then
`python -m src.harvester.tax_ids --out listed_companies.csv --load` with `DATABASE_URL` set to
the same DSN.

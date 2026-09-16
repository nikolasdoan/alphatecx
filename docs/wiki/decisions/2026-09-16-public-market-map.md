---
title: The public surface leads with structure, not quotes — the market map
type: decision
slug: 2026-09-16-public-market-map
date: 2026-09-16
attributed_to: [niko]
belongs_to: [marketecx, system-architecture]
source: chat
status: active
tags: [web, visualisation, public-surface, supply-chain]
related: [2026-09-15-alphatecx-feeds-bizmap-not-sold, supply-chain-audit-2026-05-10]
---

## Context

`stock.tecxmate.com` had a landing page and a coverage page, both of them prose.
[niko]: *"make interactive graphs that people care about the market want to see,
search it first, show some data that other 三竹股市 cant show, i dont want to see
all texts and numbers."*

三竹股市 is the dominant Taiwan retail quote app. Searching what users say about
it and what the local ecosystem already offers gave a clear picture of the gap:

- 三竹 is criticised for **standing still** — "該有的功能都有，但不會讓人期待有任何進步"
  — and for a cluttered path to anything that is not a quote. It has no drawing
  tools on the chart and no relationship view at all.
- Institutional flow (三大法人買賣超) is **everywhere** — TWSE and TPEx publish it,
  HiStock, 玩股網, 富邦, FinLab all rank it. Another leaderboard adds nothing.
- Supply-chain information exists as **directories**: 財報狗's per-industry
  上下游類股 pages, TPEx's 產業價值鏈資訊平台. All of them answer "what is 3017 in?"
  one company at a time, as a list. None of them draws the graph.
- Nobody in the Taiwan retail space publishes a **correlation embedding**, a
  **chain-vs-price comparison**, or a **session-timing map**.

## Decision

Ship `/market-map`: three interactive graphs, public, statically generated from
a committed copy of the nightly correlation snapshot.

1. **供應鏈：從上游到下游** — the declared supply edges laid out by longest
   upstream path, so column position *is* chain depth. Hovering walks the graph
   transitively both ways and lights the whole blast radius of one name.
2. **相關性地圖** — the 120-day return-correlation MDS embedding, with the supply
   edges and the ρ ≥ 0.70 edges overlaid as toggles.
3. **市場時鐘** — a 24-hour ring of the seven macro markets against the Taipei
   session, drawn from `when_known` in `src/harvester/macro.py`.

Plus a fourth section that crosses (1) and (2) — see below.

## Rationale

**Structure, not quotes, is the only defensible position.** We cannot beat 三竹
on quotes, charts or flow rankings: they are real-time, we are end-of-day by
construction, and the flow data is public and already visualised by five sites.
What we hold that they do not is the *relationship* layer — a hand-maintained
supply-chain classification and a correlation matrix computed over it. Showing
the relationships is both the differentiated thing and the thing that stays
inside the "public but infrastructure-framed" line from
[`2026-09-15-alphatecx-feeds-bizmap-not-sold`](2026-09-15-alphatecx-feeds-bizmap-not-sold.md):
a topology is a description, a ranking is a recommendation.

**The comparison turned out to be the finding.** Crossing the two edge sets:
**36 declared supply/partner relationships, 15 pairs at ρ ≥ 0.70, and the
overlap is zero.** Every tightly co-moving pair is same-sub-industry — 華邦電/南亞科
(記憶體), 欣興/景碩 (載板), 士電/華城 (重電), 鴻海/緯創/英業達 (伺服器代工) — and not
one is an up/downstream pair. `corr_edges` is not a top-N list; the snapshot
emits every classified pair above the floor, so this is a statement about the
whole classified universe rather than a leaderboard artefact. The page says what
it means (**「A 供貨給 B」不等於「A 和 B 會一起漲」**) and, explicitly, what it cannot
distinguish: a common factor versus our own classification being incomplete.

**Colour follows 台股 convention — red up, green down** — not TradingView's. The
audience is Taiwanese; inverting their convention would be a legibility bug
disguised as consistency.

**The data is a committed copy, not a fetch.** The snapshot the console serves
lives behind the URL-secret gate at `/g/<console_token>/data.json`, so the public
page cannot read it without being handed a credential. A server-side proxy route
would need an env var set on Vercel before the page worked at all — and
`CHAT_PASSWORD` is already sitting unset and closing the chat, so a second
"broken until someone sets a variable" was not a trade worth making. The copy
costs 24 KB and can rot; the page therefore renders `asof` and its age, and
`tests/test_web_market_map.py` fails if the two files differ.

## Amendment, same day — the two zones outside Taiwan

[niko] asked for 終端客戶 as blocks outside the Taiwan rectangle, and for the
foreign upstream (equipment, materials, ASML) outside it on the other side. §01
now draws three zones, and the interesting part is that they have three
different provenances — which is the reason the page can carry hand-written
context at all without undermining the rest.

| Zone | Source | Drawn as |
|---|---|---|
| 台灣上市櫃 (middle) | our data — prices, flow, correlation | filled, coloured by pillar, inside a labelled rectangle |
| 終端客戶 (right) | derived from the classification's `partners` field | outlined, with the count of Taiwan suppliers |
| 國外上游 (left) | hand-written industry context | dashed, unfilled, **no number anywhere** |

Two rules fell out of that:

- **No line per foreign firm.** We hold no edge data upstream, so one aggregate
  inflow arrow says what flows in without asserting who sells to whom.
- **Customer links only for the current selection.** All ~120 at once bury the
  chain. Hovering a customer runs the graph backwards — "who in 台股 sells to
  NVIDIA?" is 14 of the 51.

`partners` needed three filters before it could be counted: end-uses that are
not firms (`auto`, `IDMs`, `various`), one firm spelled two ways
(`NVIDIA-via-PCB` is an edge property, not a second customer), and entries that
are Taiwanese (`TSMC` is 2330; `TPC` is 台電) or upstream (ASML, Applied
Materials, Lam, KLA). `tests/test_web_chain_zones.py` caught `Arm` sitting in
both the upstream band and 2454's partners — invisible today because one mention
is below the threshold, and a double-count the moment a second name cited it.

## Consequences

- New: `web/app/market-map/` (page + three client components), `web/lib/market-map.ts`,
  `web/lib/graph-snapshot.json`, `scripts/sync_web_snapshot.py`,
  `tests/test_web_market_map.py` (12 tests).
- `daily_harvest.yml` re-syncs the copy between the snapshot regenerate and the
  push, so the two land in one commit and cannot drift.
- **`[skip ci]` on that commit is now load-bearing in two directions.** It exists
  because the push uses a DEPLOY KEY, and unlike `GITHUB_TOKEN` a deploy-key push
  *does* re-trigger workflows. Vercel honours the same marker, so the public page
  will not rebuild on its own. An optional `VERCEL_DEPLOY_HOOK` secret closes
  that: set it and the map refreshes nightly; leave it unset and the map refreshes
  on the next deploy while saying how old its data is.
- `web/biome.json` added. There was no biome config at all, so `pnpm lint` walked
  `.next/` and reported ~12,500 errors from build output — the lint script was
  effectively unusable and nobody could have noticed a real one in it.
- `tests/test_web_market_map.py` pins the market clock against
  `src/harvester/macro.py`: every market covered, no market invented, and
  `knownBeforeOpen` equal to `when_known` series by series. This is the page's only
  claim about the *world* rather than about our data, and it is exactly the
  look-ahead bias the `when_known` field was added to prevent — a page that
  disagrees with the harvester is publishing that bias on a public URL.
- The FX pair was added to the clock as a full ring (24h, "取隔夜水位"). Without it
  the page covered 6 of macro.py's 7 markets and the new test would have failed.

## Provenance
- Requested on 2026-09-16 by [niko] in chat; researched and built by [claude-agent].
- Verified against a real production build: `/market-map` prerenders static, zero
  horizontal overflow at 390 px, biome clean, 814 tests pass (was 802),
  `ruff check .` clean. Every section screenshotted and reviewed before shipping —
  three rounds of layout fixes came out of that (arrowheads were landing under the
  labels they pointed at, the correlation labels overlapped because separation was
  radial rather than box-shaped, and the clock's caption sat under its own hand).

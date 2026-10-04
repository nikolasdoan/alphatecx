---
title: The public snapshot moves to object storage — git stops being a data pipeline
type: decision
slug: 2026-10-04-snapshot-to-object-storage
date: 2026-10-04
attributed_to: [niko]
belongs_to: [marketecx, system-architecture]
source: chat
status: active
tags: [infra, cloudflare, r2, web, reliability]
related: [2026-09-16-public-market-map, 2026-07-31-scheduled-work-on-zeabur]
---

## Context

On 2026-10-02 [niko] asked for the demo link for a blog post. The page was
serving a snapshot from 2026-08-14 — 49 days old — while `sc_data_status`
showed `latest_t86_date: 2026-10-02`. **The data was perfectly current; only the
page was frozen.**

The run log gave the cause:

```
[main 707b351] chore(graph): daily refresh [skip ci]
 61 files changed, 1490 insertions(+), 1460 deletions(-)
remote: error: GH013: Repository rule violations found for refs/heads/main.
 ! [remote rejected] main -> main
```

`DASHBOARD_DEPLOY_KEY` had gone missing, so `actions/checkout` silently fell
back to `GITHUB_TOKEN` over HTTPS — which is not a bypass actor on the `main`
ruleset. The snapshot regenerated correctly on every run and was thrown away.

It was invisible for sixteen days because three things stacked, all working as
specified: the push step is `continue-on-error` so the run stayed green;
`TELEGRAM_ENABLED=false` silenced the notify path (the documented accepted cost
of the Telegram switch); and the `::warning title=Dashboard frozen` tripwire —
kept deliberately after fixing this same failure on 2026-09-05 — fired into a
log nobody reads.

[niko] asked whether switching to Cloudflare would solve it.

## Decision

Publish the snapshot to **Cloudflare R2** and have the page read it. Do **not**
move any compute.

The harvester ends with an HTTP `PUT` of a 24 KB JSON
(`scripts/publish_snapshot.py`) instead of `git add && git push`. The page
fetches it with a 30-minute revalidation and falls back to a committed copy,
labelled, when the fetch fails.

## Rationale

**The problem was never where the compute ran.** It was that a data artefact was
delivered by committing into a protected branch. Every symptom descended from
that one choice: the push needs a bypass, so it needs a deploy key; the commit
needs `[skip ci]` so the deploy key's own push does not re-trigger Actions;
Vercel honours the same marker, so the page then needs a deploy hook; and
because only the Actions runner holds the key, the Zeabur cron — the runner that
*actually kept the database current throughout* — could not refresh the page at
all.

Mapping the ask honestly: Cloudflare fixes the stale page and (as a side effect)
the single-runner problem. It does **not** fix the rejected push, the silent
failures, or the schedule — those are a GitHub ruleset, our own
`continue-on-error` + Telegram switch, and a scheduler question respectively.

**Moving the harvester to Workers was rejected, and not narrowly.** Workers run
JS/WASM; Python Workers are Pyodide with a vetted package list, and polars plus
psycopg's native libpq will not load. `src/` is shared by the harvester,
`riskguard`, `src/quant`, backfill and the dashboards, and is mirrored into
`mcp_server/api/quant/` — rewriting in TypeScript orphans all of it and 850
tests. The run is 13 minutes of deliberately slow wall-clock work
(`TWSE_REQUEST_DELAY: 3.0`, to stay polite to TWSE). Cloudflare Containers could
run the image, but that is "Zeabur, but Cloudflare" — a lateral move.

**The fallback is the design, not a safety net.** A page that cannot reach R2
still draws, from `web/lib/graph-snapshot.json`, and says `離線備份` with the
reason. Four failure modes each carry their own reason — unset, non-200,
malformed, unreachable — because "offline" alone cannot distinguish a
misconfiguration from an outage. A stale map that admits it is stale is fine;
a stale map presented as live is the thing being fixed.

**`boto3` over a hand-rolled SigV4 signature.** A subtly wrong signature fails
only against the live endpoint, which is precisely the class of bug this
pipeline keeps paying for. Harvester-only — `mcp_server/requirements.txt` must
not gain it, since the server reads the snapshot and never publishes it.

## Consequences

- New: `scripts/publish_snapshot.py`, `web/lib/snapshot-source.ts`,
  `tests/test_publish_snapshot.py` (12 tests).
- `web/lib/market-map.ts` no longer owns a snapshot. `buildChain`,
  `buildCustomers`, `crossChainAndCorrelation` and `indexById` take one; the
  committed copy is exported as `fallbackSnapshot`. The page is `async` with
  `revalidate = 1800` and threads the snapshot to the three client components.
- `daily_harvest.yml` publishes instead of syncing, and **no longer commits**
  `web/lib/graph-snapshot.json`. The publish step is deliberately *not*
  `continue-on-error`: a failed upload means the page quietly serves an older
  object, which is the failure mode being removed.
- **`deploy/daily-chain.sh` now runs `correlation_snapshot` and publishes.** Its
  comment used to exclude that step because "this worker does not commit" —
  that objection is gone, and this is the point of the change: either runner
  alone can now refresh the public page.
- `Dockerfile` copies `scripts/` so the Zeabur image can publish.
- Tests that asserted the two snapshots stay byte-identical now assert the
  opposite contract: nothing in the nightly path may commit the web copy.

**What this does NOT fix, and should not be mistaken for fixed:**

- The console's other 60 artefacts (`graph-view.html`, `graph-image.png`,
  `dashboard-page.html`, `ticker/*.html`) still reach the console by committing
  to `main`, and still need `DASHBOARD_DEPLOY_KEY`. Step 2, if wanted.
- The silent-failure problem is a policy choice, not a platform limit. It will
  reproduce on any platform until either the Telegram flag covers failures or
  the push step stops being `continue-on-error`.
- The Actions *schedule* not firing on 2026-10-02 is still unexplained; the
  manual dispatch ran fine. Zeabur's cron covers the data either way.

## Provenance
- Diagnosed and decided 2026-10-02 → 2026-10-04 between [niko] and
  [claude-agent]. The quota hypothesis was checked and disproved against the
  live DB before any design work.
- Verified against three production builds: live fetch (`即時讀取`, the
  published `asof`), `SNAPSHOT_URL` unset, and `SNAPSHOT_URL` unreachable —
  the last two render the fallback with their own reason and the build still
  succeeds. 850 tests, ruff clean, biome clean.
- **Needs from the operator before it does anything:** an R2 bucket with public
  read, an R2 API token, and the secrets `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` on GitHub Actions and the Zeabur `cron`
  service, plus `SNAPSHOT_URL` (the public object URL) on the Vercel project.
  Until then everything self-skips and the page serves its labelled fallback.

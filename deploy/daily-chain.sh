#!/bin/sh
# Post-close chain, mirroring the step order and failure semantics of
# .github/workflows/daily_harvest.yml. Read that file before changing this one;
# the two are meant to stay in step.
#
# Failure semantics are not uniform, and the differences are deliberate:
#   harvest    — fatal. Everything downstream reads what it writes.
#   brief      — soft (continue-on-error upstream). Message layer; the data is
#                already committed by the time it runs.
#   riskguard  — FATAL, and pointedly not continue-on-error upstream: a silent
#                failure here is a stop-loss alert that never fired. A non-zero
#                exit also skips the remaining steps, matching how the
#                workflow's `if: success()` guards behave.
#   leadlag    — soft. Feeds the q_lead_lag MCP tool; stale beats absent.
#   thesis     — soft. Telegram/digest heartbeat.
#
# Deliberately absent versus the workflow: dashboard.build and
# build_ticker_pages. Their only output is static files under
# mcp_server/api/static/ that get committed back to main — and this worker does
# not commit. Running them here would burn minutes producing artifacts nobody
# reads. Console dashboard regeneration stays on GitHub Actions.
#
# correlation_snapshot USED TO BE in that list, for the same reason. It is not
# any more: since 2026-10-04 the public market map reads the snapshot from
# object storage rather than from a commit, so this worker can refresh the page
# without any write access to the repository.
#
# That is the point of running it here as well as on Actions. For sixteen days
# in September the Actions push was rejected on every run (GH013, a missing
# deploy key) behind a green tick, while THIS service kept the database
# perfectly current — and the public page still froze, because the only runner
# that could refresh it was the broken one. Now either path alone is enough.
set -u

soft() {
    echo "--- (soft) $* ---"
    if ! "$@"; then
        echo "WARN: '$*' exited $? — continuing, matching continue-on-error upstream"
    fi
}

hard() {
    echo "--- (fatal) $* ---"
    if ! "$@"; then
        echo "FATAL: '$*' exited $? — aborting chain"
        exit 1
    fi
}

echo "=== post-close chain starting $(date -Iseconds) ==="

# soft, NOT hard, and for the same reason daily_harvest.yml absorbs it:
# src.harvester.daily now exits non-zero when any sub-step failed, and `hard`
# would abort the chain before `riskguard.pipeline` — the stop-loss run. A
# failed macro fetch must not cost the stop alerts. This service carries no
# TELEGRAM_TOKEN by design, so GitHub Actions is the path that reports the
# failure; here the priority is simply that the rest of the chain still runs.
soft python -m src.harvester.daily
soft python -m src.cron.brief --mode post_close
hard python -m riskguard.pipeline --mode post_close
soft python -m src.quant.leadlag --window 60 --max-lag 7
soft python -m src.cron.thesis_status

# Public market map. Soft on both counts: the snapshot is presentation, and the
# page falls back to its committed copy — visibly labelled — if neither runner
# published today. publish_snapshot.py self-skips when R2 is unconfigured, so
# an environment without the credentials simply does nothing here.
soft python -m src.quant.correlation_snapshot --window 120
soft python scripts/publish_snapshot.py

echo "=== post-close chain finished $(date -Iseconds) ==="

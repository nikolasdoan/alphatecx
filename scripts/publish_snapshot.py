#!/usr/bin/env python3
"""Publish the correlation snapshot to Cloudflare R2.

WHY THIS EXISTS — and it is not about Cloudflare.

The public market map used to get its data by COMMITTING a 24 KB JSON into
`main` every weeknight. Everything that kept breaking descended from that one
decision: the push needs a bypass on a protected branch, so it needs a deploy
key; the commit needs `[skip ci]` so the deploy key's own push does not
re-trigger Actions; Vercel honours the same marker, so the page then needs a
deploy hook to rebuild; and because only the Actions runner holds the key, the
Zeabur cron — the runner that actually kept the database current through all of
it — could not refresh the page at all.

On 2026-10-02 the deploy key went missing and the push was rejected (GH013) on
every run for sixteen days, behind a green tick, while the data underneath was
perfectly fine. The fix is not a better credential. It is to stop using git as a
data pipeline.

So: the harvester PUTs the snapshot to object storage, and the page reads it.
No branch protection, no deploy key, no `[skip ci]`, no deploy hook, and both
runners can publish because neither needs write access to the repository.

SELF-SKIPS WHEN UNCONFIGURED, deliberately, the way FINMIND_TOKEN does: an
environment without R2 credentials still runs the whole pipeline and simply
does not publish. The page falls back to its committed copy and SAYS SO, so a
skipped publish degrades visibly rather than silently.

Credentials are read from the environment and never logged. R2 speaks the S3
API; boto3 is used rather than a hand-rolled SigV4 signature because a subtly
wrong signature fails only in production, which is the exact class of bug this
repository keeps paying for.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT / "mcp_server" / "api" / "static" / "graph_snapshot.json"

# Keys the public page reads. Checked before upload because a truncated or
# half-written snapshot would render an empty map that looks like a styling bug
# rather than a data one — and unlike a bad commit, a bad upload is live
# immediately with no review in between.
REQUIRED = ("asof", "window_days", "n_tickers", "nodes", "edges", "corr_edges")

# Short enough that a fresh harvest shows up within minutes; long enough that a
# burst of readers does not hit the bucket once per request. The page layers its
# own revalidation on top of this.
CACHE_CONTROL = "public, max-age=300"

ENV_ACCOUNT = "R2_ACCOUNT_ID"
ENV_KEY_ID = "R2_ACCESS_KEY_ID"
ENV_SECRET = "R2_SECRET_ACCESS_KEY"
ENV_BUCKET = "R2_BUCKET"
ENV_KEY = "R2_SNAPSHOT_KEY"

DEFAULT_KEY = "graph-snapshot.json"

log = logging.getLogger("publish_snapshot")


def config() -> dict[str, str] | None:
    """Credentials from the environment, or None when not configured.

    All four are required together. A partially-set environment is treated as
    unconfigured rather than as an error, because the common cause is a runner
    that was never meant to publish — but it is logged at WARNING, since the
    other common cause is a typo in one secret name.
    """
    values = {
        "account": os.getenv(ENV_ACCOUNT, "").strip(),
        "key_id": os.getenv(ENV_KEY_ID, "").strip(),
        "secret": os.getenv(ENV_SECRET, "").strip(),
        "bucket": os.getenv(ENV_BUCKET, "").strip(),
    }
    present = [k for k, v in values.items() if v]
    if not present:
        return None
    missing = [k for k, v in values.items() if not v]
    if missing:
        log.warning(
            "R2 is partially configured — set %s too, or unset the rest. "
            "Not publishing.",
            ", ".join(sorted(missing)),
        )
        return None
    values["key"] = os.getenv(ENV_KEY, "").strip() or DEFAULT_KEY
    return values


def validate(payload: dict) -> None:
    missing = [k for k in REQUIRED if k not in payload]
    if missing:
        raise SystemExit(f"snapshot is missing required key(s): {missing}")
    if not payload["nodes"]:
        raise SystemExit("snapshot has no nodes — refusing to publish an empty map")


def publish(body: bytes, cfg: dict[str, str]) -> str:
    import boto3  # imported here so --check works without the dependency

    client = boto3.client(
        "s3",
        endpoint_url=f"https://{cfg['account']}.r2.cloudflarestorage.com",
        aws_access_key_id=cfg["key_id"],
        aws_secret_access_key=cfg["secret"],
        # R2 ignores the region but boto3 insists on one being set.
        region_name="auto",
    )
    client.put_object(
        Bucket=cfg["bucket"],
        Key=cfg["key"],
        Body=body,
        ContentType="application/json; charset=utf-8",
        CacheControl=CACHE_CONTROL,
    )
    return f"{cfg['bucket']}/{cfg['key']}"


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", default=str(DEFAULT_SOURCE),
                    help="snapshot to publish (default: the console's own copy)")
    ap.add_argument("--check", action="store_true",
                    help="report whether R2 is configured and the snapshot is "
                         "valid, upload nothing")
    args = ap.parse_args(argv)

    source = Path(args.source)
    if not source.exists():
        raise SystemExit(
            f"no snapshot at {source} — run src.quant.correlation_snapshot first"
        )

    body = source.read_bytes()
    validate(json.loads(body))
    asof = json.loads(body)["asof"]

    cfg = config()
    if cfg is None:
        # Not an error. The page falls back to its committed copy and labels it.
        log.info(
            "R2 not configured — snapshot valid (as of %s) but not published; "
            "the public map will serve its committed fallback and label it",
            asof,
        )
        return 0

    if args.check:
        log.info("R2 configured for %s/%s; snapshot valid as of %s",
                 cfg["bucket"], cfg["key"], asof)
        return 0

    target = publish(body, cfg)
    log.info("published %d bytes to %s (as of %s)", len(body), target, asof)
    return 0


if __name__ == "__main__":
    sys.exit(main())

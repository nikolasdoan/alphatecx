#!/usr/bin/env python3
"""Copy the nightly graph snapshot into the Next.js app.

WHY A COPY AND NOT A FETCH. The snapshot the console serves lives behind the
URL-secret gate at `/g/<console_token>/data.json` — the public site cannot read
it without being handed a credential, and handing a public page a credential to
read one document is how credentials end up in bundles. The alternative, a
server-side proxy route, needs an env var set on Vercel before the page works at
all; `CHAT_PASSWORD` is already sitting unset and closing the chat, so a second
"page is broken until someone sets a variable" is not a trade worth making.

A committed copy works with zero configuration and cannot leak anything: it is
the same 51 classified tickers the console shows, and nothing in it is derived
from a vendor series that may not be redistributed (positions come from TWSE/TPEx
closes we compute ourselves; names come from TWSE). What a copy CAN do is rot,
which is why the page renders `asof` and says how old it is rather than implying
it is live, and why `tests/test_web_snapshot.py` fails when the two files differ.

Run by the nightly harvest immediately after `src.quant.correlation_snapshot`,
so the two are committed in the same commit and cannot drift in the first place.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "mcp_server" / "api" / "static" / "graph_snapshot.json"
TARGET = ROOT / "web" / "lib" / "graph-snapshot.json"

# Keys the public page reads. Checked before copying because a truncated or
# half-written snapshot would render an empty map that looks like a styling bug
# rather than a data one.
REQUIRED = ("asof", "window_days", "n_tickers", "nodes", "edges", "corr_edges")


def validate(payload: dict) -> None:
    missing = [k for k in REQUIRED if k not in payload]
    if missing:
        raise SystemExit(f"snapshot is missing required key(s): {missing}")
    if not payload["nodes"]:
        raise SystemExit("snapshot has no nodes — refusing to publish an empty map")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="exit non-zero if the copy is out of date, changing nothing")
    args = ap.parse_args(argv)

    if not SOURCE.exists():
        raise SystemExit(f"no snapshot at {SOURCE} — run src.quant.correlation_snapshot first")

    payload = json.loads(SOURCE.read_text())
    validate(payload)

    if args.check:
        if not TARGET.exists():
            print(f"{TARGET.relative_to(ROOT)} does not exist")
            return 1
        if TARGET.read_bytes() != SOURCE.read_bytes():
            print(f"{TARGET.relative_to(ROOT)} is out of date — run scripts/sync_web_snapshot.py")
            return 1
        print("public snapshot is in sync")
        return 0

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SOURCE, TARGET)
    print(f"{TARGET.relative_to(ROOT)} <- {SOURCE.relative_to(ROOT)} (as of {payload['asof']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())

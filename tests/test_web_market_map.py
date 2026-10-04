"""The public market map makes claims about the pipeline. Pin them to it.

`web/app/market-map/` is a PUBLIC page, statically generated from a committed
copy of the nightly correlation snapshot. Three things can rot silently:

1. The committed copy drifts from the snapshot the console serves, and the page
   shows a different market from the one the rest of the system sees.
2. A new pillar or sub-industry appears in the classification, and the page
   prints its raw slug — `advanced-foundry` — to a Chinese-reading audience.
3. `src/harvester/macro.py` gains a market, or moves one between `before_open`
   and `same_session`, and the market clock keeps asserting the old timing.

(3) is the one that matters most, because it is the page's only claim ABOUT THE
WORLD rather than about our data: "this market had already closed when Taipei
opened" is either true or a look-ahead bias, and `when_known` in macro.py is the
single place that decides. A page that disagrees with it is publishing the exact
error the field exists to prevent.

Parsing TypeScript with regexes is ugly, and it is still the cheaper side of the
trade: the alternative is a Node toolchain in the Python suite, and the
alternative to THAT is no check at all — which is how `sc_capabilities` drifted
to 33 of 48.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "web" / "lib" / "market-map.ts"
PAGE = ROOT / "web" / "app" / "market-map" / "page.tsx"
PUBLIC_SNAPSHOT = ROOT / "web" / "lib" / "graph-snapshot.json"
SOURCE_SNAPSHOT = ROOT / "mcp_server" / "api" / "static" / "graph_snapshot.json"
WORKFLOW = ROOT / ".github" / "workflows" / "daily_harvest.yml"
SYNC = ROOT / "scripts" / "sync_web_snapshot.py"


@pytest.fixture(scope="module")
def lib() -> str:
    return LIB.read_text()


@pytest.fixture(scope="module")
def snapshot() -> dict:
    return json.loads(PUBLIC_SNAPSHOT.read_text())


class TestTheSnapshotIsPublishedNotCommitted:
    """The public map reads object storage; the committed copy is a FALLBACK.

    Until 2026-10-04 these asserted the opposite — that the two files stayed
    byte-identical, because the page was built from the committed one. That
    contract is what put a data pipeline behind branch protection: the nightly
    push needed a deploy-key bypass, the commit needed `[skip ci]` so the
    deploy key would not re-trigger Actions, and Vercel honoured the same marker
    so the page then needed a deploy hook. When the deploy key went missing the
    push was rejected on every run for sixteen days behind a green tick, and the
    page served a seven-week-old map while the database was current.

    So the tests now pin the replacement, and the first one is the important
    one: nothing in the nightly path may go back to committing it.
    """

    def test_the_nightly_job_publishes_rather_than_commits(self):
        wf = WORKFLOW.read_text()
        assert "publish_snapshot.py" in wf, (
            "the daily harvest must publish the snapshot to object storage"
        )
        add_block = wf[wf.index("git add"):wf.index("git diff --cached")]
        assert "web/lib/graph-snapshot.json" not in add_block, (
            "the web copy is a hand-refreshed fallback now; committing it "
            "nightly puts the public page back behind branch protection"
        )

    def test_the_publish_step_runs_after_the_snapshot_is_regenerated(self):
        wf = WORKFLOW.read_text()
        assert wf.index("correlation_snapshot") < wf.index("publish_snapshot.py"), (
            "publishing before regenerating would upload yesterday's snapshot"
        )

    def test_the_zeabur_chain_publishes_too(self):
        """The whole point of moving off a commit: the runner WITHOUT repository
        write access can now refresh the public page. In September it was the
        only one still working, and the page froze anyway."""
        chain = (ROOT / "deploy" / "daily-chain.sh").read_text()
        assert "correlation_snapshot" in chain and "publish_snapshot.py" in chain, (
            "deploy/daily-chain.sh must refresh and publish the snapshot, or "
            "GitHub Actions is once again the single path to the public page"
        )

    def test_publishing_is_not_continue_on_error_in_the_workflow(self):
        """A failed upload means the page keeps serving an older object. That is
        the exact silent staleness this change exists to end."""
        wf = WORKFLOW.read_text()
        step = wf[wf.index("Publish the snapshot to R2"):wf.index("publish_snapshot.py")]
        # Comments stripped first: the step EXPLAINS why it is not
        # continue-on-error, and a bare substring search reads the explanation
        # as the setting. (Same shape as the matcher test below — twice now.)
        keys = [
            ln.split("#")[0].strip()
            for ln in step.splitlines()
            if ln.split("#")[0].strip()
        ]
        assert not any(k.startswith("continue-on-error") for k in keys), keys

    def test_the_committed_fallback_still_exists_and_is_valid(self):
        """It is what the page draws when the fetch fails. An absent or broken
        fallback turns a degraded page into a blank one."""
        assert PUBLIC_SNAPSHOT.exists(), (
            f"{PUBLIC_SNAPSHOT.relative_to(ROOT)} is the page's fallback — "
            "without it a failed fetch renders an empty map"
        )
        payload = json.loads(PUBLIC_SNAPSHOT.read_text())
        for key in ("asof", "window_days", "n_tickers", "nodes", "edges", "corr_edges"):
            assert key in payload, f"fallback snapshot is missing {key}"
        assert payload["nodes"], "fallback snapshot has no nodes"

    def test_the_sync_script_still_works_for_refreshing_the_fallback(self):
        """Kept as a manual tool. The fallback is allowed to be old, but it
        should be refreshable without hand-editing a 24 KB JSON."""
        r = subprocess.run(
            [sys.executable, str(SYNC), "--check"],
            capture_output=True, text=True, cwd=ROOT,
        )
        # Either outcome is fine — in sync, or reporting that it is not. What
        # must not happen is the script erroring out.
        assert r.returncode in (0, 1), r.stdout + r.stderr
        assert "Traceback" not in r.stderr, r.stderr


class TestThePageSaysWhichCopyItIsShowing:
    """The page's whole claim is that its numbers can name their source. The one
    number ABOUT the source cannot be the exception — a stale map presented as
    live is the failure this plumbing was rebuilt to prevent."""

    def _source(self) -> str:
        return (ROOT / "web" / "lib" / "snapshot-source.ts").read_text()

    def test_a_failed_fetch_falls_back_rather_than_throwing(self):
        src = self._source()
        assert "catch" in src and "fallbackSnapshot" in src, (
            "the page must render from its committed copy when the fetch fails; "
            "a 500 over a document we already have is worse than a stale draw"
        )

    def test_every_fallback_path_carries_a_reason(self):
        """Four ways to end up on the fallback — unset, non-200, malformed,
        unreachable. Each has to say which, or the page shows 'offline' with no
        way to tell a misconfiguration from an outage."""
        src = self._source()
        fallbacks = src.count('origin: "fallback"')
        reasons = src.count("reason:")
        assert fallbacks >= 4, f"expected every failure mode branched, got {fallbacks}"
        assert reasons >= fallbacks, "a fallback without a reason is a silent one"

    def test_the_page_renders_the_origin(self):
        page = PAGE.read_text()
        assert "Provenance" in page and "即時讀取" in page and "離線備份" in page

    def test_the_page_revalidates_rather_than_baking_at_build(self):
        """Static export would make the page exactly as fresh as the last
        deploy — which is the problem we just removed."""
        page = PAGE.read_text()
        assert "export const revalidate" in page, (
            "without revalidation the fetched snapshot is frozen at build time"
        )


class TestEveryClassificationHasAChineseLabel:
    """The audience reads 台股 in Chinese. An unlabelled slug is not a styling
    nit — it is English jargon in the middle of a Chinese sentence."""

    def _mapping(self, lib: str, name: str) -> set[str]:
        """Keys of a top-level object literal, quoted or bare.

        Whitespace is flattened first: biome re-wraps these tables on width, so
        anything that parses line by line breaks on the next `pnpm format`.
        """
        body = re.search(rf"\b{name}\b[^=]*=\s*\{{(.*?)\n\}};", lib, re.S)
        assert body, f"could not locate {name} in market-map.ts"
        flat = re.sub(r"\s+", " ", body.group(1))
        keys = set(re.findall(r'[{,]\s*"([^"]+)"\s*:', " {" + flat))
        keys |= set(re.findall(r'[{,]\s*([A-Za-z_][\w-]*)\s*:\s*\{', " {" + flat))
        assert keys, f"{name} parsed to zero keys — the parser, not the data"
        return keys

    def test_every_pillar_in_the_snapshot_is_named(self, lib, snapshot):
        pillars = {n["pillar"] for n in snapshot["nodes"] if n["pillar"]}
        missing = sorted(pillars - self._mapping(lib, "PILLARS"))
        assert not missing, f"PILLARS has no Chinese label for: {missing}"

    def test_every_sub_industry_in_the_snapshot_is_named(self, lib, snapshot):
        nodes = {n["node"] for n in snapshot["nodes"] if n["node"]}
        missing = sorted(nodes - self._mapping(lib, "NODE_LABELS"))
        assert not missing, f"NODE_LABELS has no Chinese label for: {missing}"


class TestTheMarketClockMatchesTheHarvester:
    """`when_known` in src/harvester/macro.py is the authority. The clock is a
    drawing of it, and a drawing that disagrees is a false claim."""

    @pytest.fixture(scope="class")
    @staticmethod
    def sessions(lib) -> dict[str, bool]:
        block = re.search(r"export const SESSIONS: MarketSession\[\] = \[(.*?)\n\];", lib, re.S)
        assert block, "could not locate SESSIONS in market-map.ts"
        # Object at a time, not line at a time: biome re-wraps these rows on
        # width, so a line-based parser passes until someone runs the formatter.
        flat = re.sub(r"\s+", " ", block.group(1))
        out: dict[str, bool] = {}
        for obj in re.findall(r"\{[^{}]*\}", flat):
            m = re.search(r'market:\s*"([^"]+)"', obj)
            if not m:
                continue
            known = re.search(r"knownBeforeOpen:\s*(true|false)", obj)
            assert known, f"SESSIONS row has no knownBeforeOpen: {obj}"
            out[m.group(1)] = known.group(1) == "true"
        assert out, "SESSIONS parsed to zero markets — the parser, not the data"
        return out

    @pytest.fixture(scope="class")
    @staticmethod
    def macro() -> dict[str, bool]:
        from src.harvester.macro import BEFORE_OPEN, SERIES_META
        return {
            m["market"]: m["when_known"] == BEFORE_OPEN
            for m in SERIES_META.values()
        }

    def test_the_clock_covers_every_market_the_harvester_fetches(self, sessions, macro):
        missing = sorted(set(macro) - set(sessions))
        assert not missing, (
            f"macro.py fetches {missing} but the market clock does not draw them, "
            "so the page under-states how much trades alongside Taipei"
        )

    def test_the_clock_invents_no_market(self, sessions, macro):
        extra = sorted(set(sessions) - set(macro))
        assert not extra, f"the clock draws markets the harvester does not fetch: {extra}"

    def test_before_open_matches_series_by_series(self, sessions, macro):
        wrong = {k: (sessions[k], macro[k]) for k in macro if sessions[k] != macro[k]}
        assert not wrong, (
            "the clock and macro.py disagree on which markets are already closed "
            f"when Taipei opens (page, macro.py): {wrong}"
        )

    def test_a_series_cannot_disagree_with_its_own_market(self):
        """Two series in one market with different `when_known` would make the
        clock unrepresentable, and the fixture above would silently take one."""
        from src.harvester.macro import SERIES_META
        seen: dict[str, str] = {}
        for key, meta in SERIES_META.items():
            prior = seen.setdefault(meta["market"], meta["when_known"])
            assert prior == meta["when_known"], (
                f"{key} is {meta['when_known']} but another series in "
                f"{meta['market']} is {prior}"
            )


class TestThePageIsReachableAndScoped:
    def test_the_landing_page_links_to_the_map(self):
        assert 'href="/market-map"' in (ROOT / "web" / "app" / "page.tsx").read_text()

    def test_the_map_is_not_behind_the_chat_gate(self):
        """The gate names exactly what it covers. /market-map must not be in it —
        and if someone later decides it should be, this test is where they say so.

        Scoped to the matcher rather than the whole file: the middleware's
        comments name the public pages when explaining what stays out of the
        gate, and a bare substring search reads that explanation as a violation.
        """
        src = (ROOT / "web" / "middleware.ts").read_text()
        block = re.search(r"matcher:\s*\[(.*?)\]", src, re.S)
        assert block, "could not locate config.matcher"
        assert "market-map" not in block.group(1), (
            "the market map is a public page; gating it needs a deliberate "
            "change here and on the landing page that links to it"
        )

    def test_the_page_states_what_it_does_not_do(self):
        """The 'public but infrastructure-framed' line is load-bearing: the page
        shows structure, never a recommendation. The disclaimer is the artefact
        of that decision and must not be tidied away."""
        page = PAGE.read_text()
        assert "不提供選股、排行或買賣建議" in page
        assert "非投資建議" in page

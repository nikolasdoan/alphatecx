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


class TestTheCommittedCopyIsTheLiveOne:
    def test_the_two_snapshots_are_byte_identical(self):
        assert PUBLIC_SNAPSHOT.exists(), (
            f"{PUBLIC_SNAPSHOT.relative_to(ROOT)} is missing — the public map has "
            "no data. Run scripts/sync_web_snapshot.py."
        )
        assert PUBLIC_SNAPSHOT.read_bytes() == SOURCE_SNAPSHOT.read_bytes(), (
            "the public copy has drifted from the snapshot the console serves. "
            "Run scripts/sync_web_snapshot.py and commit both."
        )

    def test_the_sync_scripts_own_check_agrees(self):
        """Guards the guard: if --check ever stops comparing, the test above is
        the only thing left and the nightly job's safety net is gone."""
        r = subprocess.run(
            [sys.executable, str(SYNC), "--check"],
            capture_output=True, text=True, cwd=ROOT,
        )
        assert r.returncode == 0, r.stdout + r.stderr

    def test_the_nightly_job_refreshes_and_commits_the_copy(self):
        """Drift is prevented rather than detected: the same job that writes the
        snapshot writes the copy, in the same commit."""
        wf = WORKFLOW.read_text()
        assert "sync_web_snapshot" in wf, (
            "the daily harvest must re-sync the public copy or the map freezes "
            "at whatever was last committed by hand"
        )
        assert "web/lib/graph-snapshot.json" in wf, (
            "the refreshed copy must be in the push step's `git add`"
        )
        assert wf.index("sync_web_snapshot") < wf.index("Commit & push refreshed snapshot")


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
        and if someone later decides it should be, this test is where they say so."""
        matcher = (ROOT / "web" / "middleware.ts").read_text()
        assert "market-map" not in matcher, (
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

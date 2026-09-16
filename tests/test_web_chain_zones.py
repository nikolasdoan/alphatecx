"""The supply-chain graph spans three zones with three different provenances.

The middle is our data. The right band is DERIVED from the classification's own
`partners` field. The left band is HAND-WRITTEN context and the only part of the
page not read off the data.

That distinction is the page's whole claim to being honest, and it is exactly
the kind of thing that erodes: someone adds a number to the left band, or a
Taiwanese name drifts into the customer column, and the page quietly starts
asserting things it cannot support. These tests hold the seams.

They parse TypeScript with regexes, which is ugly. It is still the cheaper side
of the trade — the alternative is a Node toolchain inside the Python suite, and
the alternative to that is no check at all.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "web" / "lib" / "market-map.ts"
GRAPH = ROOT / "web" / "app" / "market-map" / "chain-flow.tsx"
SNAPSHOT = ROOT / "web" / "lib" / "graph-snapshot.json"


@pytest.fixture(scope="module")
def lib() -> str:
    return LIB.read_text()


@pytest.fixture(scope="module")
def snapshot() -> dict:
    return json.loads(SNAPSHOT.read_text())


def _set_literal(lib: str, name: str) -> set[str]:
    """Members of a `new Set([...])` declared at module scope."""
    m = re.search(rf"{name}\s*=\s*new Set\(\[(.*?)\]\)", lib, re.S)
    assert m, f"could not locate {name} in market-map.ts"
    return set(re.findall(r'"([^"]+)"', m.group(1)))


def _upstream_names(lib: str) -> set[str]:
    block = re.search(r"UPSTREAM_GROUPS: ForeignGroup\[\] = \[(.*?)\n\];", lib, re.S)
    assert block, "could not locate UPSTREAM_GROUPS"
    return set(re.findall(r'\{\s*name:\s*"([^"]+)"', block.group(1)))


def _customer_group_members(lib: str) -> set[str]:
    """Firm names only — the group's own `zh` label is not a customer."""
    block = re.search(r"CUSTOMER_GROUPS:[^=]*=\s*\[(.*?)\n\];", lib, re.S)
    assert block, "could not locate CUSTOMER_GROUPS"
    names: set[str] = set()
    for arr in re.findall(r"members:\s*\[(.*?)\]", block.group(1), re.S):
        names |= set(re.findall(r'"([^"]+)"', arr))
    assert names, "CUSTOMER_GROUPS parsed to zero members — the parser, not the data"
    return names


class TestTheBandsDoNotOverlap:
    """A firm on both sides of Taiwan would make the picture incoherent — ASML
    is the obvious trap, because 家登 sells EUV pods TO it while it sells
    lithography INTO the same chain."""

    def test_no_firm_is_both_upstream_context_and_a_counted_customer(self, lib):
        upstream = _upstream_names(lib)
        suppliers = _set_literal(lib, "PARTNERS_THAT_ARE_SUPPLIERS")
        overlap = sorted(upstream & _customer_group_members(lib))
        assert not overlap, (
            f"{overlap} appear in both the upstream band and a customer group; "
            "a firm cannot sit on both sides of the box"
        )
        # Anything in the upstream band that the classification ALSO lists as a
        # partner must be excluded from the customer count explicitly.
        also_partners = {
            p
            for n in json.loads(SNAPSHOT.read_text())["nodes"]
            for p in n["partners"]
        } & upstream
        missing = sorted(also_partners - suppliers)
        assert not missing, (
            f"{missing} are drawn as foreign UPSTREAM but are not in "
            "PARTNERS_THAT_ARE_SUPPLIERS, so they would also be counted as "
            "customers on the right"
        )

    def test_taiwanese_entities_never_become_foreign_blocks(self, lib, snapshot):
        """TSMC is 2330 — already a node in the box — and TPC is 台電. Either one
        rendered as a foreign customer would be plainly wrong to a local reader
        and would quietly double-count a name."""
        excluded = _set_literal(lib, "PARTNERS_THAT_ARE_TAIWANESE")
        assert {"TSMC", "TPC"} <= excluded
        assert not (excluded & _upstream_names(lib))

    def test_non_companies_are_filtered_rather_than_rendered(self, lib, snapshot):
        """`partners` mixes firms with end-uses: auto, AI-PC, industrial, IDMs,
        various. Drawing those as customer blocks would invent buyers."""
        not_company = _set_literal(lib, "NOT_A_COMPANY")
        for token in ("auto", "AI-PC", "industrial", "various", "IDMs"):
            assert token in not_company, f"{token} would render as a customer"
        # And every one of them must actually occur, or the list is stale.
        present = {p for n in snapshot["nodes"] for p in n["partners"]}
        unused = sorted(not_company - present)
        assert not unused, (
            f"NOT_A_COMPANY lists tokens the snapshot no longer contains: "
            f"{unused} — stale filters hide the next real one"
        )


class TestAliasesAreResolvedBeforeCounting:
    def test_the_via_pcb_spellings_fold_into_the_firm(self, lib, snapshot):
        """`NVIDIA-via-PCB` records that the relationship is one hop removed —
        a fact about the EDGE, not a different customer. Left unfolded it would
        split NVIDIA's count across two blocks."""
        block = re.search(r"PARTNER_ALIASES[^=]*=\s*\{(.*?)\n\};", lib, re.S)
        assert block, "could not locate PARTNER_ALIASES"
        aliases = dict(re.findall(r'"([^"]+)":\s*"([^"]+)"', block.group(1)))
        present = {p for n in snapshot["nodes"] for p in n["partners"]}
        for raw in present:
            if raw.endswith("-via-PCB"):
                assert raw in aliases, f"{raw} is not folded into its firm"
                assert aliases[raw] == raw.removesuffix("-via-PCB")


class TestTheLeftBandCarriesNoNumbers:
    """It is the one part of the page that is not read off the data. A figure
    there would look exactly like the ones that are, which is the whole problem.
    """

    def test_the_upstream_groups_declare_no_counts_or_shares(self, lib):
        block = re.search(r"UPSTREAM_GROUPS: ForeignGroup\[\] = \[(.*?)\n\];", lib, re.S)
        assert block
        body = block.group(1)
        # `name`, `country`, `zh`, `note` only — no numeric fields at all.
        fields = set(re.findall(r"(\w+):", body))
        assert fields <= {"zh", "note", "members", "name", "country"}, (
            f"unexpected field(s) in the hand-written upstream band: "
            f"{sorted(fields - {'zh', 'note', 'members', 'name', 'country'})}"
        )
        assert not re.search(r":\s*\d", body), (
            "the upstream band must carry no numbers — it is context, not data"
        )

    def test_the_page_says_the_left_band_is_not_data(self):
        src = GRAPH.read_text()
        assert "手寫的產業" in src and "不是資料" in src, (
            "the caption must say the left band is hand-written context; "
            "without it the three zones read as one dataset"
        )

    def test_the_rectangle_says_only_its_inside_carries_data(self):
        src = GRAPH.read_text()
        assert "只有框內有價格與法人資料" in src


class TestTheCustomerBandIsDerivedNotAsserted:
    def test_the_threshold_is_stated_and_at_least_two(self, lib):
        m = re.search(r"buildCustomers\(minSuppliers = (\d+)\)", lib)
        assert m, "buildCustomers must declare its threshold as a default"
        assert int(m.group(1)) >= 2, (
            "one mention is a single business relationship; a wall of one-offs "
            "buries the point the band exists to make"
        )

    def test_every_grouped_customer_actually_appears_in_the_snapshot(self, lib, snapshot):
        """A curated group list can name firms the data does not, which would
        silently mean those blocks never render and nobody notices the list rotted."""
        present = {p for n in snapshot["nodes"] for p in n["partners"]}
        present |= {p.removesuffix("-via-PCB") for p in present}
        missing = sorted(_customer_group_members(lib) - present)
        assert not missing, (
            f"CUSTOMER_GROUPS names firms absent from the snapshot: {missing}"
        )

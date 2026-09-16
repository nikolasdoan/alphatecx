"""The research terminal's off switch must be declared, and must default off.

WHY THIS EXISTS. Before `CHAT_ENABLED`, the chat at stock.tecxmate.com was
unreachable — but only because `CHAT_PASSWORD` had never been set on Vercel, so
the middleware's fail-closed branch returned 503 to everyone. Unreachable by
accident and unreachable on purpose looked identical from the outside and, more
importantly, from the code.

That is the same defect CLAUDE.md already records on the Telegram side, where
"disabling" by unsetting `TELEGRAM_TOKEN` made a dead notify path
indistinguishable from a quiet one and every alert sat at `pushed:false` for
weeks. The fix there was an explicit `TELEGRAM_ENABLED` flag. This is that fix,
for this surface, and these tests are what stop it eroding back into an implicit
state:

1. The flag exists and the middleware actually reads it.
2. It defaults to OFF — so the switch needs nothing set on Vercel to take
   effect, and a typo in the value leaves the terminal closed rather than open.
3. The landing page hides the link behind the same flag, so the nav and the
   route cannot disagree inside one deployment.
4. The gate still covers the API routes, not just the page. That is the whole
   reason the middleware exists: `/api/chat` proxies the MCP server with the
   bearer token server-side and reaches tools that write.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIDDLEWARE = ROOT / "web" / "middleware.ts"
LANDING = ROOT / "web" / "app" / "page.tsx"

FLAG = "CHAT_ENABLED"


def _middleware() -> str:
    return MIDDLEWARE.read_text()


class TestTheSwitchIsExplicit:
    def test_the_flag_is_read_from_the_environment(self):
        assert re.search(rf'process\.env\.{FLAG}\b', _middleware()), (
            f"{FLAG} must be read in the middleware — an unset password is not a "
            "disabled chat, it is an indistinguishable one"
        )

    def test_off_is_the_default(self):
        """`=== "true"` rather than `!== "false"`. Anything unset, misspelled or
        half-configured has to land on closed."""
        src = _middleware()
        assert re.search(rf'process\.env\.{FLAG}\s*===\s*"true"', src), (
            f"{FLAG} must be compared against the exact string \"true\"; any "
            'looser test (`!== "false"`, truthiness) makes a typo open the chat'
        )
        assert '!== "false"' not in src

    def test_the_disabled_branch_comes_before_the_credential_check(self):
        """Order is the point: switched off must not fall through to a password
        prompt, which would advertise the surface it is meant to close."""
        src = _middleware()
        assert src.index(f"if (!{FLAG})") < src.index("!PASSWORD"), (
            "the off switch must be checked before the fail-closed password branch"
        )

    def test_the_disabled_branch_returns_404(self):
        """404, not 401 or 503: those invite a retry. A closed surface should
        look like nothing is there and leak nothing about what it reached."""
        src = _middleware()
        branch = src[src.index(f"if (!{FLAG})"):]
        assert re.search(r"status:\s*404", branch[:400]), (
            "switched off should 404 — 401 says 'guess the password' and 503 "
            "says 'try later', and both advertise the route"
        )


class TestTheGateStillCoversTheApi:
    """Load-bearing regardless of the flag's value: when the chat is turned back
    on, the password must still stand in front of the MCP proxy and not only the
    page. `/api/chat` holds the bearer token server-side and reaches tools that
    write, so anyone able to call it never needed the page."""

    def test_both_prefixes_are_matched(self):
        src = _middleware()
        block = re.search(r"matcher:\s*\[(.*?)\]", src, re.S)
        assert block, "could not locate config.matcher"
        matcher = block.group(1)
        assert '"/chat/:path*"' in matcher
        assert '"/api/:path*"' in matcher

    def test_the_matcher_is_not_inverted(self):
        """A negative lookahead silently starts gating a new public page or
        silently stops gating a new API route depending on which way it is
        wrong, and both failures are quiet."""
        block = re.search(r"matcher:\s*\[(.*?)\]", _middleware(), re.S)
        assert block and "(?!" not in block.group(1), (
            "the matcher names what is gated; inverting it makes the public "
            "pages public by accident rather than by construction"
        )


class TestTheLinkAndTheRouteAgree:
    def test_the_landing_page_hides_the_link_behind_the_same_flag(self):
        """A link to a 404 reads as a broken site rather than a closed one."""
        src = LANDING.read_text()
        assert f'process.env.{FLAG}' in src, (
            "the landing page must read the same flag, or the nav will keep "
            "pointing at a route that is switched off"
        )
        link = src.index('href="/chat"')
        guard = src.index(f"{{{FLAG} &&")
        assert guard < link, "the chat link must sit inside the flag's guard"

    def test_the_public_pages_are_still_linked_unconditionally(self):
        """Turning the terminal off must not take the public surface with it."""
        src = LANDING.read_text()
        for href in ('href="/market-map"', 'href="/coverage"'):
            assert href in src
            assert src.index(href) < src.index(f"{{{FLAG} &&"), (
                f"{href} must not be inside the chat flag's guard"
            )

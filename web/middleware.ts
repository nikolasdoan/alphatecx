import { type NextRequest, NextResponse } from "next/server";

/**
 * Gate on the chat and on every API route.
 *
 * WHY BOTH. Gating only the page would be theatre. `/api/chat` is a
 * general-purpose proxy to the MCP server — it holds the bearer token
 * server-side and reaches all of its tools, several of which WRITE, and it
 * spends the Anthropic API key on every message. Anyone who could call that
 * route directly would not need the page at all. Before this file existed,
 * `web/` had no middleware and both were open to anyone who reached the
 * domain.
 *
 * WHAT STAYS PUBLIC, and why it is a matcher rather than a negative lookahead:
 * `config.matcher` below names exactly the two prefixes that are gated, so `/`
 * and `/coverage` are public *by construction*. Inverting it — gate everything
 * except a pattern — is the version that silently starts gating a new public
 * page, or silently stops gating a new API route, depending on which way the
 * regex is wrong. Both public pages are fully static and call no API, so
 * nothing on them breaks.
 *
 * Basic auth rather than a login form: this is a shared credential for a
 * handful of people, the browser handles the prompt and re-sends it on every
 * request, and there is no session to store, expire or invalidate wrongly.
 * If this ever needs real per-person identity, the answer is Cloudflare Access
 * on the hostname — the runbook is already in
 * docs/wiki/topics/console-auth.md — not a bigger version of this file.
 */

/**
 * OFF SWITCH, and it defaults to OFF.
 *
 * The chat was already unreachable before this existed — `CHAT_PASSWORD` was
 * never set on Vercel, so every request 503'd. That is the exact failure this
 * repo already learned to avoid on the Telegram side: an unset secret is
 * indistinguishable from breakage, and CLAUDE.md says so out loud after every
 * alert sat at `pushed:false` for weeks behind a missing token. "Off" and
 * "broken" have to look different, or nobody can tell which one they are
 * looking at six weeks later.
 *
 * So the state is declared rather than inferred. Default off means the switch
 * needs no action on Vercel to take effect, and turning the terminal back on is
 * two deliberate variables — `CHAT_ENABLED=true` AND a `CHAT_PASSWORD` — rather
 * than one forgotten one. Anything other than the exact string "true" is off:
 * a typo should leave it closed.
 */
const CHAT_ENABLED = process.env.CHAT_ENABLED === "true";

const USER = process.env.CHAT_USER || "alphatecx";
const PASSWORD = process.env.CHAT_PASSWORD;

/**
 * Constant-time string comparison.
 *
 * `node:crypto.timingSafeEqual` is not available in the edge runtime this
 * middleware runs in, so it is written out. Comparing with `===` would return
 * on the first differing byte and leak the password's prefix through response
 * timing. The length is folded into the result rather than short-circuited on,
 * for the same reason.
 */
function safeEqual(a: string, b: string): boolean {
	const enc = new TextEncoder();
	const x = enc.encode(a);
	const y = enc.encode(b);
	let diff = x.length ^ y.length;
	const n = Math.max(x.length, y.length);
	for (let i = 0; i < n; i++) {
		diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
	}
	return diff === 0;
}

function challenge(): NextResponse {
	return new NextResponse("Authentication required.", {
		status: 401,
		headers: {
			"WWW-Authenticate": 'Basic realm="alphatecx", charset="UTF-8"',
			"Cache-Control": "no-store",
		},
	});
}

export function middleware(request: NextRequest) {
	// Switched off: the routes do not exist. 404 rather than 401 or 503 because
	// those both advertise something worth coming back for — 401 says "guess the
	// password" and 503 says "try later". Off should look like nothing is here,
	// and it leaks nothing about what the routes would have reached.
	//
	// Safe for the public pages: `/`, `/coverage` and `/market-map` are fully
	// static and call no API route, so none of this is on their path.
	if (!CHAT_ENABLED) {
		return new NextResponse("Not found.", {
			status: 404,
			headers: { "Cache-Control": "no-store" },
		});
	}

	// FAIL CLOSED. An unset secret must deny, never allow — the failure mode of
	// the opposite choice is a gate that looks installed and is not, which is
	// strictly worse than no gate because nobody goes back to check. 503 rather
	// than 401 because retrying with a password cannot help: the deployment is
	// misconfigured, and the message says which variable to set.
	if (!PASSWORD) {
		return new NextResponse(
			"CHAT_PASSWORD is not set on this deployment, so the chat is closed. " +
				"Set it in the Vercel project's environment variables.",
			{ status: 503, headers: { "Cache-Control": "no-store" } },
		);
	}

	const header = request.headers.get("authorization");
	if (!header?.startsWith("Basic ")) return challenge();

	let decoded: string;
	try {
		decoded = atob(header.slice(6));
	} catch {
		// Malformed base64 — treat as a failed attempt, not a server error.
		return challenge();
	}

	// Split on the FIRST colon only: a password may legitimately contain one.
	const i = decoded.indexOf(":");
	if (i < 0) return challenge();
	const user = decoded.slice(0, i);
	const pass = decoded.slice(i + 1);

	// Both compared, and both constant-time — `&&` on a fast user check would
	// reintroduce the short-circuit this is avoiding.
	const okUser = safeEqual(user, USER);
	const okPass = safeEqual(pass, PASSWORD);
	if (!(okUser && okPass)) return challenge();

	return NextResponse.next();
}

export const config = {
	// Exactly the gated prefixes. `/` and `/coverage` are public because they
	// are not named here — see the note above on why this is not inverted.
	matcher: ["/chat/:path*", "/api/:path*"],
};

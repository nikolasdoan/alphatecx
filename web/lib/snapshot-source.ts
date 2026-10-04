import { fallbackSnapshot, type Snapshot } from "@/lib/market-map";

/**
 * Where the market map's data comes from, and how honest the page is about it.
 *
 * The snapshot used to be committed into this repository every weeknight. That
 * made the page exactly as current as the last deploy, and it put a data
 * pipeline behind branch protection — which is how it ended up serving a
 * seven-week-old map while the database underneath was perfectly current.
 *
 * Now the harvester PUTs the snapshot to object storage
 * (scripts/publish_snapshot.py) and this module reads it. Nothing is committed,
 * so nothing depends on a deploy key, a `[skip ci]` marker, or a deploy hook —
 * and BOTH runners can publish, because neither needs write access to the repo.
 *
 * THE FALLBACK IS THE POINT, not a safety net nobody thinks about. If the fetch
 * fails for any reason the page still renders, from the copy committed in
 * `lib/graph-snapshot.json` — and `origin` tells the caller which one it got so
 * the page can say so. A stale map that admits it is stale is fine. A stale map
 * presented as live is the failure this whole change exists to prevent.
 */

export type SnapshotOrigin = "live" | "fallback";

export interface LoadedSnapshot {
	snapshot: Snapshot;
	origin: SnapshotOrigin;
	/** Why the fallback was used. Rendered on the page; never a silent swallow. */
	reason?: string;
}

/** Minutes, not seconds: the upstream data changes once per trading day. */
const REVALIDATE_SECONDS = 1800;

const REQUIRED_KEYS = [
	"asof",
	"window_days",
	"n_tickers",
	"nodes",
	"edges",
	"corr_edges",
] as const;

/**
 * Structural check before we trust a fetched document.
 *
 * The bucket is public and the page renders whatever it returns, so "it was a
 * 200" is not enough: a truncated upload or a misrouted object would otherwise
 * draw an empty map that reads as a styling bug. Mirrors the same check the
 * publisher runs before upload, deliberately — both ends refuse the same thing.
 */
function looksLikeASnapshot(value: unknown): value is Snapshot {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	for (const k of REQUIRED_KEYS) {
		if (!(k in v)) return false;
	}
	return Array.isArray(v.nodes) && v.nodes.length > 0;
}

export async function loadSnapshot(): Promise<LoadedSnapshot> {
	const url = process.env.SNAPSHOT_URL?.trim();
	if (!url) {
		return {
			snapshot: fallbackSnapshot,
			origin: "fallback",
			reason: "SNAPSHOT_URL 未設定",
		};
	}

	try {
		// Revalidated rather than per-request: the data changes once a day, and
		// a cache miss should cost one reader a round trip, not every reader.
		const res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });
		if (!res.ok) {
			return {
				snapshot: fallbackSnapshot,
				origin: "fallback",
				reason: `資料來源回應 ${res.status}`,
			};
		}
		const body = await res.json();
		if (!looksLikeASnapshot(body)) {
			return {
				snapshot: fallbackSnapshot,
				origin: "fallback",
				reason: "資料來源格式不符",
			};
		}
		return { snapshot: body, origin: "live" };
	} catch {
		// Network error, DNS, timeout, malformed JSON. The page must not 500 over
		// a document it has a copy of.
		return {
			snapshot: fallbackSnapshot,
			origin: "fallback",
			reason: "資料來源無法連線",
		};
	}
}

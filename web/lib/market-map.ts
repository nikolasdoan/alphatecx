/**
 * Shapes and derived geometry for the public market map.
 *
 * The snapshot is the same document the operator console serves at
 * `/g/<token>/data.json`, copied in by `scripts/sync_web_snapshot.py`. Nothing
 * here fetches: the file is imported, so the page is fully static and the
 * graphs have no loading state and no failure mode at request time.
 *
 * Everything below is DESCRIPTION — who supplies whom, what has moved together,
 * when each market is open. There is deliberately no ranking, no screen and no
 * signal: those live behind the gate, and the distinction is the whole reason
 * this page can be public.
 */

import raw from "@/lib/graph-snapshot.json";

export type Pillar =
	| "semiconductor"
	| "equipment"
	| "infrastructure"
	| "energy";

export interface SnapshotNode {
	id: string;
	name: string;
	pillar: string | null;
	node: string | null;
	x: number;
	y: number;
	z: number;
	vol: number;
	ret_30d: number;
	color: string;
	partners: string[];
}

export interface ChainEdge {
	from: string;
	to: string;
	rel: string;
	conf: string;
}

export interface CorrEdge {
	from: string;
	to: string;
	rho: number;
}

export interface Snapshot {
	asof: string;
	window_days: number;
	n_tickers: number;
	nodes: SnapshotNode[];
	edges: ChainEdge[];
	corr_edges: CorrEdge[];
}

export const snapshot = raw as unknown as Snapshot;

/* ── Labels ───────────────────────────────────────────────────────────────
   Chinese first: the audience reads 台股 in Chinese, and the company names in
   the snapshot are TWSE's own Chinese names. English is kept alongside for the
   pillars only, where it is the term the rest of the codebase uses. */

export const PILLARS: Record<
	Pillar,
	{ zh: string; en: string; color: string }
> = {
	semiconductor: { zh: "半導體", en: "Semiconductor", color: "#4f9cff" },
	equipment: { zh: "設備・材料", en: "Equipment", color: "#9b6dff" },
	infrastructure: {
		zh: "伺服器・網通",
		en: "Infrastructure",
		color: "#ff7a59",
	},
	energy: { zh: "電力・能源", en: "Energy", color: "#22c55e" },
};

export const UNCLASSIFIED_COLOR = "#8b8b95";

export const NODE_LABELS: Record<string, string> = {
	"advanced-foundry": "先進製程代工",
	"advanced-packaging": "先進封裝",
	"asic-custom-ip": "客製化 ASIC",
	"dram-memory": "DRAM 記憶體",
	"memory-dram": "DRAM 記憶體",
	"memory-flash": "Flash 記憶體",
	"ic-design": "IC 設計",
	"ic-substrate": "IC 載板",
	"equipment-materials": "設備與材料",
	"facility-cleanroom": "廠務・無塵室",
	"testing-probing": "測試・探針",
	"bmc-management": "BMC 管理晶片",
	"ccl-laminate": "銅箔基板",
	"connectors-cables": "連接器・線材",
	"high-speed-pcb": "高速 PCB",
	"network-communication": "網通",
	"network-switches": "網路交換器",
	"optical-cpo": "光通訊・CPO",
	"pcb-materials": "PCB 材料",
	"server-odm": "伺服器代工",
	"thermal-cooling": "散熱",
	"green-energy": "綠電",
	"heavy-electrical": "重電",
	"server-power-supply": "伺服器電源",
};

export function pillarOf(n: SnapshotNode) {
	const p = n.pillar as Pillar | null;
	return p && p in PILLARS ? PILLARS[p] : null;
}

export function colorOf(n: SnapshotNode) {
	return pillarOf(n)?.color ?? UNCLASSIFIED_COLOR;
}

export function nodeLabel(n: SnapshotNode) {
	return n.node ? (NODE_LABELS[n.node] ?? n.node) : "未分類";
}

export const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));

/* ── The correlation map ──────────────────────────────────────────────────
   `x`/`y` are an MDS embedding of the 120-day return-correlation matrix: two
   dots near each other MOVED together, whatever business either is in. The
   raw coordinates overlap badly at this density, so a few relaxation passes
   push labels apart. That displaces dots by a fraction of the plot width —
   enough to read, small enough that the clusters are still the real ones. */

export interface Placed extends SnapshotNode {
	px: number;
	py: number;
}

const VIEW = 1000;
const PAD = 70;
// Separation is done on BOXES, not on circles. A label is roughly five times
// wider than it is tall, so a radial minimum gap that stops the dots touching
// still leaves the names overlapping — which is the only failure mode anyone
// notices. Widths are in viewBox units and sized for a four-character name.
const BOX_W = 92;
const BOX_H = 40;

export function placeNodes(nodes: SnapshotNode[]): Placed[] {
	const xs = nodes.map((n) => n.x);
	const ys = nodes.map((n) => n.y);
	const spanX = Math.max(...xs) - Math.min(...xs) || 1;
	const spanY = Math.max(...ys) - Math.min(...ys) || 1;
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);

	const placed: Placed[] = nodes.map((n) => ({
		...n,
		px: PAD + ((n.x - minX) / spanX) * (VIEW - 2 * PAD),
		// SVG y grows downward; flip so the embedding reads the same way up as
		// the console's 3-D view.
		py: PAD + (1 - (n.y - minY) / spanY) * (VIEW - 2 * PAD),
	}));

	for (let pass = 0; pass < 400; pass++) {
		let moved = false;
		for (let i = 0; i < placed.length; i++) {
			for (let j = i + 1; j < placed.length; j++) {
				const a = placed[i];
				const b = placed[j];
				const dx = b.px - a.px;
				const dy = b.py - a.py;
				const ox = BOX_W - Math.abs(dx);
				const oy = BOX_H - Math.abs(dy);
				if (ox <= 0 || oy <= 0) continue;
				// Push apart along whichever axis needs the smaller correction,
				// so a cluster spreads sideways rather than unravelling.
				if (ox / BOX_W < oy / BOX_H) {
					const push = (ox / 2 + 0.5) * (dx >= 0 ? 1 : -1);
					a.px -= push;
					b.px += push;
				} else {
					const push = (oy / 2 + 0.5) * (dy >= 0 ? 1 : -1);
					a.py -= push;
					b.py += push;
				}
				moved = true;
			}
		}
		for (const p of placed) {
			p.px = Math.min(VIEW - PAD, Math.max(PAD, p.px));
			p.py = Math.min(VIEW - PAD, Math.max(PAD, p.py));
		}
		if (!moved) break;
	}
	return placed;
}

export const VIEWBOX = VIEW;

/* ── The chain ────────────────────────────────────────────────────────────
   `supplies` is directed: `from` sells to `to`, so `from` is upstream. Tier is
   the longest upstream path, which is what makes 上游 → 下游 read left to right
   rather than as a hairball. `partners-with` is a peer relationship with no
   direction and is deliberately excluded from the layering — including it
   would invent a tier ordering the data does not claim. */

export const SUPPLIES = "supplies";

export interface Tiered extends SnapshotNode {
	tier: number;
	cx: number;
	cy: number;
}

function longestUpstream(edges: ChainEdge[]): Map<string, number> {
	const supplies = edges.filter((e) => e.rel === SUPPLIES);
	const incoming = new Map<string, string[]>();
	for (const e of supplies) {
		const list = incoming.get(e.to) ?? [];
		list.push(e.from);
		incoming.set(e.to, list);
	}
	const tier = new Map<string, number>();
	// Relaxation rather than a topological sort: the classification is
	// hand-maintained and a future edge could close a cycle, which would hang a
	// naive DFS. Capped passes degrade to a slightly-wrong tier, never a hang.
	const ids = new Set<string>();
	for (const e of supplies) {
		ids.add(e.from);
		ids.add(e.to);
	}
	for (const id of ids) tier.set(id, 0);
	for (let pass = 0; pass < ids.size; pass++) {
		let moved = false;
		for (const id of ids) {
			const ups = incoming.get(id) ?? [];
			const want = ups.reduce((m, u) => Math.max(m, (tier.get(u) ?? 0) + 1), 0);
			if (want > (tier.get(id) ?? 0)) {
				tier.set(id, want);
				moved = true;
			}
		}
		if (!moved) break;
	}
	return tier;
}

const CHAIN_W = 1100;
const CHAIN_H = 620;

export function buildChain() {
	const tier = longestUpstream(snapshot.edges);

	// Peers attach to whatever they partner with, so they sit beside it rather
	// than in a column of their own.
	for (const e of snapshot.edges) {
		if (e.rel === SUPPLIES) continue;
		if (!tier.has(e.from)) tier.set(e.from, tier.get(e.to) ?? 0);
		if (!tier.has(e.to)) tier.set(e.to, tier.get(e.from) ?? 0);
	}

	const members = snapshot.nodes.filter((n) => tier.has(n.id));
	const maxTier = Math.max(...members.map((n) => tier.get(n.id) ?? 0));
	const columns: SnapshotNode[][] = Array.from(
		{ length: maxTier + 1 },
		() => [],
	);
	for (const n of members) columns[tier.get(n.id) ?? 0].push(n);
	for (const col of columns) {
		col.sort(
			(a, b) =>
				(a.pillar ?? "").localeCompare(b.pillar ?? "") ||
				a.id.localeCompare(b.id),
		);
	}

	const tiered: Tiered[] = [];
	columns.forEach((col, t) => {
		const step = CHAIN_H / (col.length + 1);
		col.forEach((n, i) => {
			tiered.push({
				...n,
				tier: t,
				cx: 90 + (maxTier === 0 ? 0 : t * ((CHAIN_W - 180) / maxTier)),
				cy: step * (i + 1),
			});
		});
	});

	const unmapped = snapshot.nodes.length - members.length;
	return { tiered, maxTier, unmapped, width: CHAIN_W, height: CHAIN_H };
}

/* ── The thing neither a quote app nor a value-chain directory shows ──────
   A directory tells you 3017 supplies 2382. A quote app tells you both moved.
   Neither tells you whether the relationship SHOWED UP in the prices — so we
   cross the two edge sets and count the overlap.

   `corr_edges` is not a top-N list: the snapshot emits EVERY classified pair at
   rho >= 0.70, so "no supply-chain pair is in it" is a statement about the
   whole universe rather than about a leaderboard's cut-off. That matters,
   because it is the only reading under which the overlap count means anything.
*/

export const RHO_FLOOR = 0.7;

export function crossChainAndCorrelation() {
	const key = (a: string, b: string) => [a, b].sort().join("~");
	const corr = new Map(
		snapshot.corr_edges.map((e) => [key(e.from, e.to), e.rho]),
	);
	const chain = new Set(snapshot.edges.map((e) => key(e.from, e.to)));

	const tight = [...snapshot.corr_edges]
		.map((e) => ({ ...e, linked: chain.has(key(e.from, e.to)) }))
		.sort((a, b) => b.rho - a.rho);

	return {
		tight,
		chainPairs: chain.size,
		tightPairs: tight.length,
		overlap: tight.filter((e) => e.linked).length,
		// Kept so a future snapshot where the two DO overlap can name which.
		linkedAndTight: snapshot.edges
			.filter((e) => corr.has(key(e.from, e.to)))
			.map((e) => ({ ...e, rho: corr.get(key(e.from, e.to)) as number })),
	};
}

/* ── The clock ────────────────────────────────────────────────────────────
   Hours are Asia/Taipei. Mirrors src/harvester/macro.py's `when_known`: a
   market that is still trading while Taipei trades cannot have informed the
   Taipei open, and four of the seven are in that position. */

export interface MarketSession {
	/** The `market` id in src/harvester/macro.py, or null for the Taipei baseline. */
	market: string | null;
	zh: string;
	en: string;
	series: string;
	open: number;
	close: number;
	/** Mirrors `when_known === BEFORE_OPEN` in src/harvester/macro.py. */
	knownBeforeOpen: boolean;
	/** Trades around the clock, so "the overnight level" is a convention. */
	roundTheClock?: boolean;
}

export const SESSIONS: MarketSession[] = [
	{
		market: null,
		zh: "台股",
		en: "Taiwan",
		series: "TAIEX",
		open: 9,
		close: 13.5,
		knownBeforeOpen: false,
	},
	{
		market: "japan",
		zh: "日本",
		en: "Japan",
		series: "Nikkei 225",
		open: 8,
		close: 14,
		knownBeforeOpen: false,
	},
	{
		market: "korea",
		zh: "韓國",
		en: "Korea",
		series: "KOSPI",
		open: 8,
		close: 14.5,
		knownBeforeOpen: false,
	},
	{
		market: "china",
		zh: "中國",
		en: "China",
		series: "上證指數",
		open: 9.5,
		close: 15,
		knownBeforeOpen: false,
	},
	{
		market: "hong_kong",
		zh: "香港",
		en: "Hong Kong",
		series: "恒生指數",
		open: 9.5,
		close: 16,
		knownBeforeOpen: false,
	},
	{
		market: "europe",
		zh: "歐洲",
		en: "Europe",
		series: "Euro Stoxx 50",
		open: 15,
		close: 23.5,
		knownBeforeOpen: true,
	},
	{
		market: "us",
		zh: "美國",
		en: "United States",
		series: "SOX・Nasdaq・TSM ADR・US 10Y",
		open: 21.5,
		close: 28,
		knownBeforeOpen: true,
	},
	{
		market: "fx",
		zh: "匯率",
		en: "FX",
		series: "DXY・USD/TWD",
		open: 0,
		close: 24,
		knownBeforeOpen: true,
		roundTheClock: true,
	},
];

/** Markets whose number is NOT yet final when Taipei opens. */
export const SAME_SESSION_MARKETS = SESSIONS.filter(
	(s) => s.market !== null && !s.knownBeforeOpen,
);
export const MACRO_MARKETS = SESSIONS.filter((s) => s.market !== null);

export const TAIPEI_OPEN = 9;
export const TAIPEI_CLOSE = 13.5;

/* ── Freshness ────────────────────────────────────────────────────────────
   The snapshot is committed, so it is exactly as current as the last deploy.
   Saying so is the difference between a stale page and a dishonest one. */

export function ageInDays(asof: string, now = new Date()): number {
	const then = new Date(`${asof}T00:00:00+08:00`);
	return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000));
}

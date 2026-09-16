"use client";

import { useId, useMemo, useState } from "react";
import {
	buildChain,
	buildCustomers,
	CHAIN,
	type Country,
	type Customer,
	colorOf,
	nodeLabel,
	PILLARS,
	type Pillar,
	snapshot,
	type Tiered,
	UPSTREAM_GROUPS,
} from "@/lib/market-map";

/**
 * 上游 → 台灣 → 終端客戶, in three zones.
 *
 * The middle is the part we hold data on, laid out by how deep each name sits
 * in the chain: column position is the longest upstream path through the
 * declared edges, so a supplier's supplier lands a column further left on its
 * own. Hovering walks it transitively both ways — the blast radius of one name,
 * lit at once, which is the bit a value-chain directory cannot do.
 *
 * The two bands outside exist because the chain does not start or end in
 * Taiwan, and a map that stops at the coastline implies it does. They are drawn
 * differently on purpose: see the provenance note in lib/market-map.ts. The
 * short version is that the right band is derived from the classification's own
 * `partners` field, the left band is hand-written context, and only what is
 * inside the rectangle carries a price.
 */

const TIER_LABELS = ["最上游", "上游", "中游", "下游", "最下游", "終端"];

const BOX_W = 96;
const BOX_H = 30;

const FLAGS: Record<Country, string> = {
	US: "美",
	JP: "日",
	NL: "荷",
	KR: "韓",
	UK: "英",
};

function edgePath(a: Tiered, b: Tiered): string {
	const GAP = 7;
	if (a.cx === b.cx) {
		const bulge = a.cx + BOX_W / 2 + 46;
		const y1 = a.cy + (b.cy > a.cy ? BOX_H / 2 : -BOX_H / 2);
		const y2 = b.cy + (b.cy > a.cy ? -BOX_H / 2 : BOX_H / 2);
		return `M ${a.cx} ${y1} C ${bulge} ${y1}, ${bulge} ${y2}, ${b.cx} ${y2}`;
	}
	const right = b.cx > a.cx;
	const x1 = a.cx + (right ? BOX_W / 2 : -BOX_W / 2);
	const x2 = b.cx + (right ? -BOX_W / 2 - GAP : BOX_W / 2 + GAP);
	const mid = (x1 + x2) / 2;
	return `M ${x1} ${a.cy} C ${mid} ${a.cy}, ${mid} ${b.cy}, ${x2} ${b.cy}`;
}

export default function ChainFlow() {
	const { tiered, maxTier, unmapped, width, height } = useMemo(
		() => buildChain(),
		[],
	);
	const index = useMemo(() => new Map(tiered.map((n) => [n.id, n])), [tiered]);
	const customers = useMemo(() => buildCustomers(), []);
	const [active, setActive] = useState<string | null>(null);
	const [pinned, setPinned] = useState<string | null>(null);
	const [activeCustomer, setActiveCustomer] = useState<string | null>(null);
	const titleId = useId();
	const focus = pinned ?? active;

	const tierHeadings = useMemo(
		() =>
			Array.from({ length: maxTier + 1 }, (_, t) => ({
				label: TIER_LABELS[t] ?? `第 ${t + 1} 層`,
				x:
					CHAIN.twX +
					CHAIN.innerPad +
					(maxTier === 0
						? 0
						: t * ((CHAIN.twW - 2 * CHAIN.innerPad) / maxTier)),
			})),
		[maxTier],
	);

	// Customers are laid out in one column, grouped by the bucket they belong
	// to, so the right band reads as "chip designers, then clouds, then server
	// brands" rather than as a ranked list.
	const placedCustomers = useMemo(() => {
		const order = new Map(
			["晶片設計", "雲端服務", "伺服器品牌", "其他終端"].map((g, i) => [g, i]),
		);
		const sorted = [...customers].sort(
			(a, b) =>
				(order.get(a.group) ?? 9) - (order.get(b.group) ?? 9) ||
				b.suppliers.length - a.suppliers.length,
		);
		const step = (height - CHAIN.top - 60) / (sorted.length + 1);
		return sorted.map((c, i) => ({ ...c, cy: CHAIN.top + step * (i + 1) }));
	}, [customers, height]);

	// Transitive closure both ways over `supplies`; a peer link is worth lighting
	// one hop out but not following, since it claims no direction.
	const lit = useMemo(() => {
		if (!focus) return null;
		const set = new Set<string>([focus]);
		for (const dir of ["down", "up"] as const) {
			let frontier: string[] = [focus];
			while (frontier.length) {
				const next: string[] = [];
				for (const id of frontier) {
					for (const e of snapshot.edges) {
						const hit = dir === "down" ? e.from === id : e.to === id;
						const other = dir === "down" ? e.to : e.from;
						if (!hit) continue;
						if (e.rel !== "supplies" && id !== focus) continue;
						if (!set.has(other)) {
							set.add(other);
							if (e.rel === "supplies") next.push(other);
						}
					}
				}
				frontier = next;
			}
		}
		return set;
	}, [focus]);

	// Hovering a customer lights its Taiwan suppliers, which is the same
	// question asked from the other end: "who in 台股 sells to NVIDIA?"
	const supplierSet = useMemo(() => {
		if (!activeCustomer) return null;
		const c = customers.find((x) => x.name === activeCustomer);
		return c ? new Set(c.suppliers) : null;
	}, [activeCustomer, customers]);

	const highlight = supplierSet ?? lit;
	const on = (id: string) => !highlight || highlight.has(id);

	// Customer links are drawn only for whatever is selected. All of them at once
	// is ~120 lines across the busiest part of the picture, which reads as noise
	// and hides the chain underneath.
	const customerLinks = useMemo(() => {
		if (activeCustomer) {
			const c = customers.find((x) => x.name === activeCustomer);
			return c ? c.suppliers.map((id) => ({ id, customer: c.name })) : [];
		}
		if (!focus) return [];
		const node = snapshot.nodes.find((n) => n.id === focus);
		if (!node) return [];
		const names = new Set(customers.map((c) => c.name));
		return node.partners
			.map((p) =>
				p === "NVIDIA-via-PCB"
					? "NVIDIA"
					: p === "Broadcom-via-PCB"
						? "Broadcom"
						: p,
			)
			.filter((p) => names.has(p))
			.map((customer) => ({ id: focus, customer }));
	}, [activeCustomer, focus, customers]);

	const card = focus ? index.get(focus) : null;
	const customerCard = activeCustomer
		? customers.find((c) => c.name === activeCustomer)
		: null;

	return (
		<div>
			{pinned && (
				<div className="mb-4">
					<button
						type="button"
						onClick={() => setPinned(null)}
						className="rounded-md border border-foreground px-3 py-1.5 text-xs"
					>
						解除鎖定 ✕
					</button>
				</div>
			)}
			<div className="relative overflow-x-auto rounded-lg border border-border bg-background">
				<svg
					viewBox={`0 0 ${width} ${height}`}
					className="block h-auto w-full min-w-[60rem]"
					role="img"
					aria-labelledby={titleId}
				>
					<title id={titleId}>
						台股 AI 供應鏈：國外上游設備與材料、台灣上市櫃廠商、以及終端客戶
					</title>

					<defs>
						<marker
							id="chain-arrow"
							viewBox="0 0 10 10"
							refX="9"
							refY="5"
							markerWidth="6"
							markerHeight="6"
							orient="auto-start-reverse"
						>
							<path d="M 0 0 L 10 5 L 0 10 z" className="fill-foreground" />
						</marker>
						<marker
							id="inflow-arrow"
							viewBox="0 0 10 10"
							refX="9"
							refY="5"
							markerWidth="7"
							markerHeight="7"
							orient="auto-start-reverse"
						>
							<path
								d="M 0 0 L 10 5 L 0 10 z"
								className="fill-muted-foreground"
							/>
						</marker>
					</defs>

					{/* The rectangle. Drawn first so everything sits on top of it. */}
					<rect
						x={CHAIN.twX}
						y={CHAIN.top - 34}
						width={CHAIN.twW}
						height={height - CHAIN.top - 8}
						rx={14}
						fill="none"
						stroke="currentColor"
						className="text-border"
						strokeWidth={2}
					/>
					<text
						x={CHAIN.twX + 16}
						y={CHAIN.top - 44}
						fontSize={13}
						fontWeight={600}
						className="fill-foreground"
					>
						台灣上市櫃
					</text>
					<text
						x={CHAIN.twX + 90}
						y={CHAIN.top - 44}
						fontSize={11}
						className="fill-muted-foreground"
					>
						— 只有框內有價格與法人資料
					</text>

					<BandHeading
						x={CHAIN.upstreamX}
						y={CHAIN.top - 44}
						zh="國外上游"
						note="設備・材料"
					/>
					<BandHeading
						x={CHAIN.customerX}
						y={CHAIN.top - 44}
						zh="終端客戶"
						note="來自分類的 partners"
					/>

					{tierHeadings.map(({ label, x }) => (
						<text
							key={label}
							x={x}
							y={CHAIN.top - 14}
							textAnchor="middle"
							fontSize={11}
							className="fill-muted-foreground"
						>
							{label}
						</text>
					))}

					{/* Foreign upstream. One aggregate inflow arrow rather than a line per
					    firm: we hold no edge data for these, and drawing specific
					    relationships would assert commercial facts the snapshot does not
					    contain. The band says what flows in, not who sells to whom. */}
					<UpstreamBand dimmed={highlight !== null} />
					<path
						d={`M ${CHAIN.upstreamX + CHAIN.bandW + 8} ${height / 2} L ${CHAIN.twX - 10} ${height / 2}`}
						stroke="currentColor"
						className="text-muted-foreground"
						strokeWidth={2}
						strokeDasharray="6 5"
						markerEnd="url(#inflow-arrow)"
						opacity={highlight ? 0.25 : 0.7}
					/>

					{snapshot.edges.map((e) => {
						const a = index.get(e.from);
						const b = index.get(e.to);
						if (!a || !b) return null;
						const show =
							!highlight || (highlight.has(e.from) && highlight.has(e.to));
						return (
							<path
								key={`${e.from}-${e.to}`}
								d={edgePath(a, b)}
								fill="none"
								stroke="currentColor"
								className={show ? "text-foreground" : "text-muted-foreground"}
								strokeWidth={e.conf === "high" ? 1.6 : 1}
								strokeDasharray={e.rel === "supplies" ? undefined : "5 4"}
								strokeOpacity={show ? (highlight ? 0.8 : 0.35) : 0.07}
								markerEnd={
									e.rel === "supplies" && show ? "url(#chain-arrow)" : undefined
								}
							/>
						);
					})}

					{/* Taiwan → customer, only for the current selection. */}
					{customerLinks.map(({ id, customer }) => {
						const a = index.get(id);
						const b = placedCustomers.find((c) => c.name === customer);
						if (!a || !b) return null;
						const x1 = a.cx + BOX_W / 2;
						const x2 = CHAIN.customerX - 8;
						const mid = (x1 + x2) / 2;
						return (
							<path
								key={`${id}-${customer}`}
								d={`M ${x1} ${a.cy} C ${mid} ${a.cy}, ${mid} ${b.cy}, ${x2} ${b.cy}`}
								fill="none"
								className="stroke-primary"
								strokeWidth={1.4}
								strokeOpacity={0.75}
							/>
						);
					})}

					{tiered.map((n) => (
						<ChainNode
							key={n.id}
							n={n}
							on={on(n.id)}
							focused={focus === n.id}
							onEnter={() => setActive(n.id)}
							onLeave={() => setActive(null)}
							onSelect={() => setPinned(pinned === n.id ? null : n.id)}
						/>
					))}

					{placedCustomers.map((c) => {
						const linked = customerLinks.some((l) => l.customer === c.name);
						return (
							// biome-ignore lint/a11y/useSemanticElements: SVG has no <button> element — role + tabIndex + key handling is the accessible form here.
							<g
								key={c.name}
								tabIndex={0}
								role="button"
								aria-label={`${c.name}，${c.suppliers.length} 家台廠供貨`}
								className="cursor-pointer outline-none"
								onMouseEnter={() => setActiveCustomer(c.name)}
								onMouseLeave={() => setActiveCustomer(null)}
								onFocus={() => setActiveCustomer(c.name)}
								onBlur={() => setActiveCustomer(null)}
								opacity={highlight && !linked ? 0.25 : 1}
							>
								<rect
									x={CHAIN.customerX}
									y={c.cy - 14}
									width={CHAIN.bandW}
									height={28}
									rx={6}
									className="fill-background stroke-primary"
									fillOpacity={1}
									strokeWidth={linked ? 2.2 : 1.1}
								/>
								<text
									x={CHAIN.customerX + 11}
									y={c.cy + 1}
									dominantBaseline="middle"
									fontSize={12}
									fontWeight={500}
									className="pointer-events-none fill-foreground"
								>
									{c.name}
								</text>
								<text
									x={CHAIN.customerX + CHAIN.bandW - 11}
									y={c.cy + 1}
									textAnchor="end"
									dominantBaseline="middle"
									fontSize={11}
									className="pointer-events-none fill-muted-foreground"
								>
									{c.suppliers.length}
								</text>
							</g>
						);
					})}
				</svg>

				{card && !customerCard && <ChainCard node={card} lit={lit} />}
				{customerCard && <CustomerCard customer={customerCard} />}
			</div>

			<div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
				{Object.entries(PILLARS).map(([k, v]) => (
					<span key={k} className="flex items-center gap-1.5">
						<span
							className="inline-block h-2.5 w-2.5 rounded-sm"
							style={{ background: v.color }}
						/>
						{v.zh}
					</span>
				))}
				<span className="flex items-center gap-1.5">
					<svg width="22" height="8" aria-hidden="true">
						<line
							x1="0"
							y1="4"
							x2="22"
							y2="4"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeDasharray="5 4"
						/>
					</svg>
					合作關係（非供貨）
				</span>
				<span className="flex items-center gap-1.5">
					<span className="inline-block h-2.5 w-2.5 rounded-sm border-2 border-primary" />
					終端客戶（數字 = 幾家台廠供貨）
				</span>
			</div>

			<p className="mt-4 text-xs leading-relaxed text-muted-foreground">
				滑過台廠會點亮它的上下游與客戶；滑過右邊的客戶，會反過來點亮台股裡誰供貨給它。
				分類共 {snapshot.n_tickers} 檔，其中 {unmapped}{" "}
				檔尚未標註供應關係，只會出現在下面的相關性地圖。
			</p>
			<p className="mt-2 text-xs leading-relaxed text-muted-foreground">
				<span className="text-foreground">
					三個區塊的來源不一樣，所以畫法也不一樣。
				</span>{" "}
				框內是我們持有資料的部分；右側客戶由分類裡的 partners 欄位彙總而來（至少
				2 家台廠點名才成為一格），但我們不持有這些公司的報價； 左側是
				<span className="text-foreground">手寫的產業常識，不是資料</span>
				——
				它沒有任何數字，畫的是「台灣要做這些東西得先向誰買」，而不是個別的供貨合約。
			</p>
		</div>
	);
}

function BandHeading({
	x,
	y,
	zh,
	note,
}: {
	x: number;
	y: number;
	zh: string;
	note: string;
}) {
	return (
		<>
			<text
				x={x}
				y={y}
				fontSize={13}
				fontWeight={600}
				className="fill-foreground"
			>
				{zh}
			</text>
			<text x={x} y={y + 16} fontSize={11} className="fill-muted-foreground">
				{note}
			</text>
		</>
	);
}

/** Hand-written context: no fill, dashed, and carrying no number anywhere. */
function UpstreamBand({ dimmed }: { dimmed: boolean }) {
	// Laid out by walking a cursor down the band rather than by index maths,
	// because the groups have different member counts. Every advance below is
	// the height of what was just drawn — a heading is 13, a note 12, a box 28
	// including its gap — so a row cannot land on top of the one above it.
	let y = CHAIN.top + 4;
	const rows: React.ReactNode[] = [];
	for (const group of UPSTREAM_GROUPS) {
		rows.push(
			<text
				key={`h-${group.zh}`}
				x={CHAIN.upstreamX}
				y={y}
				fontSize={11}
				fontWeight={600}
				className="fill-foreground"
			>
				{group.zh}
			</text>,
		);
		y += 13;
		rows.push(
			<text
				key={`n-${group.zh}`}
				x={CHAIN.upstreamX}
				y={y}
				fontSize={10}
				className="fill-muted-foreground"
			>
				{group.note}
			</text>,
		);
		y += 12;
		for (const m of group.members) {
			rows.push(
				<g key={m.name}>
					<rect
						x={CHAIN.upstreamX}
						y={y}
						width={CHAIN.bandW}
						height={24}
						rx={5}
						fill="none"
						stroke="currentColor"
						className="text-muted-foreground"
						strokeWidth={1}
						strokeDasharray="4 3"
					/>
					<text
						x={CHAIN.upstreamX + 9}
						y={y + 16}
						fontSize={11.5}
						className="fill-foreground"
					>
						{m.name}
					</text>
					<text
						x={CHAIN.upstreamX + CHAIN.bandW - 9}
						y={y + 16}
						textAnchor="end"
						fontSize={10}
						className="fill-muted-foreground"
					>
						{FLAGS[m.country]}
					</text>
				</g>,
			);
			y += 28;
		}
		y += 16;
	}
	return <g opacity={dimmed ? 0.3 : 1}>{rows}</g>;
}

function ChainNode({
	n,
	on,
	focused,
	onEnter,
	onLeave,
	onSelect,
}: {
	n: Tiered;
	on: boolean;
	focused: boolean;
	onEnter: () => void;
	onLeave: () => void;
	onSelect: () => void;
}) {
	const w = BOX_W;
	const h = BOX_H;
	return (
		// biome-ignore lint/a11y/useSemanticElements: SVG has no <button> element — role + tabIndex + key handling is the accessible form here.
		<g
			opacity={on ? 1 : 0.16}
			className="cursor-pointer outline-none"
			tabIndex={0}
			role="button"
			aria-label={`${n.name} ${n.id}`}
			onMouseEnter={onEnter}
			onMouseLeave={onLeave}
			onFocus={onEnter}
			onBlur={onLeave}
			onClick={onSelect}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onSelect();
				}
			}}
		>
			<rect
				x={n.cx - w / 2}
				y={n.cy - h / 2}
				width={w}
				height={h}
				rx={6}
				fill={colorOf(n)}
				fillOpacity={0.16}
				stroke={colorOf(n)}
				strokeWidth={focused ? 2.5 : 1.2}
			/>
			<text
				x={n.cx}
				y={n.cy + 1}
				textAnchor="middle"
				dominantBaseline="middle"
				fontSize={13}
				fontWeight={500}
				className="pointer-events-none fill-foreground"
			>
				{n.name}
			</text>
		</g>
	);
}

function ChainCard({ node, lit }: { node: Tiered; lit: Set<string> | null }) {
	const p = node.pillar as Pillar | null;
	const reach = lit ? lit.size - 1 : 0;
	return (
		<div className="pointer-events-none absolute bottom-3 left-3 max-w-[16rem] rounded-md border border-border bg-background/95 p-4 text-sm shadow-lg backdrop-blur">
			<div className="flex items-baseline gap-2">
				<span className="font-semibold">{node.name}</span>
				<span className="font-mono text-xs text-muted-foreground">
					{node.id}
				</span>
			</div>
			<div className="mt-1 text-xs text-muted-foreground">
				{p && PILLARS[p] ? `${PILLARS[p].zh} · ` : ""}
				{nodeLabel(node)}
			</div>
			{node.partners.length > 0 && (
				<div className="mt-3 border-t border-border pt-2 text-xs">
					<span className="text-muted-foreground">對應終端 </span>
					{node.partners.join("・")}
				</div>
			)}
			<div className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
				與 <span className="font-mono text-foreground">{reach}</span>{" "}
				檔有上下游關聯
			</div>
		</div>
	);
}

function CustomerCard({ customer }: { customer: Customer }) {
	return (
		<div className="pointer-events-none absolute bottom-3 left-3 max-w-[16rem] rounded-md border border-border bg-background/95 p-4 text-sm shadow-lg backdrop-blur">
			<div className="font-semibold">{customer.name}</div>
			<div className="mt-1 text-xs text-muted-foreground">{customer.group}</div>
			<div className="mt-3 border-t border-border pt-2 text-xs">
				<span className="text-muted-foreground">台股供應商 </span>
				<span className="font-mono text-foreground">
					{customer.suppliers.length}
				</span>
				<span className="text-muted-foreground"> 家</span>
			</div>
			<p className="mt-2 text-xs leading-relaxed text-muted-foreground">
				來自分類的 partners 欄位。我們不持有這家公司的報價或法人資料。
			</p>
		</div>
	);
}

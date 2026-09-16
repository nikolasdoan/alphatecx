"use client";

import { useId, useMemo, useState } from "react";
import {
	buildChain,
	colorOf,
	nodeLabel,
	PILLARS,
	type Pillar,
	snapshot,
	type Tiered,
} from "@/lib/market-map";

/**
 * 上游 → 下游, laid out by how deep each name actually sits in the chain.
 *
 * A value-chain directory answers "what is 3017 in?" — one company at a time,
 * as a list. This answers the question underneath it: if 台積電 sneezes, which
 * names are one hop away and which are four? Column position is the longest
 * upstream path through the declared edges, not a category, so a supplier's
 * supplier lands a column further left on its own.
 *
 * Hovering walks the graph transitively in both directions. That is the bit a
 * static org-chart image cannot do and the bit people actually want: the whole
 * blast radius of one name, lit up at once.
 */

const TIER_LABELS = ["最上游", "上游", "中游", "下游", "最下游", "終端"];

const BOX_W = 96;
const BOX_H = 30;

/**
 * An edge runs box-edge to box-edge, with a gap for the arrowhead. Drawing
 * centre-to-centre buries the head under the label of the name it points at,
 * which is the one place the direction actually has to be legible.
 *
 * Peers can land in the SAME column, where a bezier between two points on one
 * vertical degenerates into a straight line indistinguishable from a border.
 * Those get pushed out sideways instead.
 */
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
	const [active, setActive] = useState<string | null>(null);
	const [pinned, setPinned] = useState<string | null>(null);
	const titleId = useId();
	const focus = pinned ?? active;

	const tierHeadings = useMemo(
		() =>
			Array.from({ length: maxTier + 1 }, (_, t) => ({
				label: TIER_LABELS[t] ?? `第 ${t + 1} 層`,
				x: 90 + (maxTier === 0 ? 0 : t * ((width - 180) / maxTier)),
			})),
		[maxTier, width],
	);

	// Transitive closure both ways. The chain is ~30 nodes, so a breadth-first
	// walk per hover is free and there is nothing to memoise around.
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
						// A peer link is worth lighting, but only one hop out: it is
						// not a direction, so following it transitively would claim a
						// chain that does not exist.
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

	const on = (id: string) => !lit || lit.has(id);
	const card = focus ? index.get(focus) : null;

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
					className="block h-auto w-full min-w-[46rem]"
					role="img"
					aria-labelledby={titleId}
				>
					<title id={titleId}>台股 AI 供應鏈由上游到下游的關係圖</title>

					{tierHeadings.map(({ label, x }) => {
						return (
							<text
								key={label}
								x={x}
								y={20}
								textAnchor="middle"
								fontSize={12}
								className="fill-muted-foreground"
							>
								{label}
							</text>
						);
					})}

					{snapshot.edges.map((e) => {
						const a = index.get(e.from);
						const b = index.get(e.to);
						if (!a || !b) return null;
						const d = edgePath(a, b);
						const show = !lit || (lit.has(e.from) && lit.has(e.to));
						return (
							<path
								key={`${e.from}-${e.to}`}
								d={d}
								fill="none"
								stroke="currentColor"
								className={show ? "text-foreground" : "text-muted-foreground"}
								strokeWidth={e.conf === "high" ? 1.6 : 1}
								strokeDasharray={e.rel === "supplies" ? undefined : "5 4"}
								strokeOpacity={show ? (lit ? 0.8 : 0.35) : 0.07}
								markerEnd={
									e.rel === "supplies" && show ? "url(#chain-arrow)" : undefined
								}
							/>
						);
					})}

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
					</defs>

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
				</svg>

				{card && <ChainCard node={card} lit={lit} />}
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
			</div>

			<p className="mt-4 text-xs leading-relaxed text-muted-foreground">
				滑過任一個名字，會一路點亮它的上游與下游。分類共 {snapshot.n_tickers}{" "}
				檔， 其中 {unmapped} 檔尚未標註供應關係，只會出現在上面的相關性地圖。
				<span className="text-foreground"> 關係是人工維護的產業知識</span>
				，不是從財報自動推導出來的 —— 邊有可能缺漏。
			</p>
		</div>
	);
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
		<div className="pointer-events-none absolute right-3 top-3 max-w-[17rem] rounded-md border border-border bg-background/95 p-4 text-sm shadow-lg backdrop-blur">
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
					<span className="text-muted-foreground">終端客戶 </span>
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

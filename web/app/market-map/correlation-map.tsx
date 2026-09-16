"use client";

import { useId, useMemo, useState } from "react";
import {
	byId,
	colorOf,
	nodeLabel,
	PILLARS,
	type Pillar,
	type Placed,
	placeNodes,
	snapshot,
	UNCLASSIFIED_COLOR,
	VIEWBOX,
} from "@/lib/market-map";

/**
 * Where the market actually put each name, over the supply chain we say it is in.
 *
 * Position is not a sector, a market cap or an alphabet — it is a 2-D embedding
 * of the 120-day return-correlation matrix, so two dots sit together because
 * they MOVED together. Laying the declared supply-chain edges over the top is
 * the point of the whole graph: a 散熱 name that plots on the other side of the
 * map from the ODM it sells to is a statement, and it is not one a quote app
 * or a value-chain directory can make, because neither holds both halves.
 */

type ColorMode = "pillar" | "move";

// Diverging scale for the 30-day move. Taiwan reads red as UP and green as
// DOWN — the opposite of the Western convention — and this page is for a
// Taiwanese audience, so it follows 台股 convention rather than TradingView's.
function moveColor(ret: number): string {
	const capped = Math.max(-0.25, Math.min(0.25, ret));
	const t = Math.abs(capped) / 0.25;
	const light = 92 - t * 45;
	if (capped >= 0) return `hsl(2 78% ${light}%)`;
	return `hsl(152 55% ${light}%)`;
}

const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

export default function CorrelationMap() {
	const placed = useMemo(() => placeNodes(snapshot.nodes), []);
	const index = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);

	const [showChain, setShowChain] = useState(true);
	const [showCorr, setShowCorr] = useState(true);
	const [mode, setMode] = useState<ColorMode>("pillar");
	const [active, setActive] = useState<string | null>(null);
	const [pinned, setPinned] = useState<string | null>(null);
	const titleId = useId();

	const focus = pinned ?? active;

	// Everything the focused name touches, by either kind of edge. Used to dim
	// the rest rather than to hide it — the density IS the information.
	const related = useMemo(() => {
		if (!focus) return null;
		const set = new Set<string>([focus]);
		for (const e of snapshot.edges) {
			if (e.from === focus) set.add(e.to);
			if (e.to === focus) set.add(e.from);
		}
		for (const e of snapshot.corr_edges) {
			if (e.from === focus) set.add(e.to);
			if (e.to === focus) set.add(e.from);
		}
		return set;
	}, [focus]);

	const dim = (id: string) => (related && !related.has(id) ? 0.12 : 1);
	const edgeDim = (a: string, b: string) =>
		related ? (related.has(a) && related.has(b) ? 1 : 0.06) : 0.55;

	const card = focus ? index.get(focus) : null;

	return (
		<div>
			<div className="mb-4 flex flex-wrap items-center gap-2">
				<Toggle on={showChain} onClick={() => setShowChain(!showChain)}>
					<span className="inline-block h-px w-4 align-middle bg-foreground" />
					<span className="ml-2">供應鏈關係</span>
				</Toggle>
				<Toggle on={showCorr} onClick={() => setShowCorr(!showCorr)}>
					<span className="inline-block h-px w-4 align-middle bg-[#8c52ff]" />
					<span className="ml-2">同步走勢 ρ &gt; 0.70</span>
				</Toggle>
				{pinned && (
					<button
						type="button"
						onClick={() => setPinned(null)}
						className="rounded-md border border-foreground px-3 py-1.5 text-xs"
					>
						解除鎖定 ✕
					</button>
				)}
				<div className="ml-auto flex overflow-hidden rounded-md border border-border text-xs">
					<button
						type="button"
						onClick={() => setMode("pillar")}
						className={`px-3 py-1.5 ${mode === "pillar" ? "bg-foreground text-background" : "hover:bg-accent"}`}
					>
						依產業
					</button>
					<button
						type="button"
						onClick={() => setMode("move")}
						className={`px-3 py-1.5 ${mode === "move" ? "bg-foreground text-background" : "hover:bg-accent"}`}
					>
						依 30 日漲跌
					</button>
				</div>
			</div>

			<div className="relative overflow-hidden rounded-lg border border-border bg-background">
				<svg
					viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
					className="block h-auto w-full touch-manipulation"
					role="img"
					aria-labelledby={titleId}
				>
					<title id={titleId}>
						51 檔台股依 120 日報酬相關性排列，並疊上供應鏈關係
					</title>

					{showCorr &&
						snapshot.corr_edges.map((e) => {
							const a = index.get(e.from);
							const b = index.get(e.to);
							if (!a || !b) return null;
							return (
								<line
									key={`c-${e.from}-${e.to}`}
									x1={a.px}
									y1={a.py}
									x2={b.px}
									y2={b.py}
									stroke="#8c52ff"
									strokeWidth={1 + (e.rho - 0.7) * 18}
									strokeOpacity={edgeDim(e.from, e.to)}
								/>
							);
						})}

					{showChain &&
						snapshot.edges.map((e) => {
							const a = index.get(e.from);
							const b = index.get(e.to);
							if (!a || !b) return null;
							return (
								<line
									key={`s-${e.from}-${e.to}`}
									x1={a.px}
									y1={a.py}
									x2={b.px}
									y2={b.py}
									stroke="currentColor"
									className="text-foreground"
									strokeWidth={e.rel === "supplies" ? 1.1 : 0.9}
									strokeDasharray={e.rel === "supplies" ? undefined : "4 4"}
									strokeOpacity={edgeDim(e.from, e.to) * 0.75}
								/>
							);
						})}

					{placed.map((n) => (
						<Dot
							key={n.id}
							n={n}
							mode={mode}
							opacity={dim(n.id)}
							focused={focus === n.id}
							onEnter={() => setActive(n.id)}
							onLeave={() => setActive(null)}
							onSelect={() => setPinned(pinned === n.id ? null : n.id)}
						/>
					))}
				</svg>

				{card && <Card node={card} />}
			</div>

			<Legend mode={mode} />

			<p className="mt-4 text-xs leading-relaxed text-muted-foreground">
				點一下鎖定、再點一次解除；灰掉的是與所選個股無任何關係的名字。
				<span className="text-foreground">
					{" "}
					相關性不是因果，也不會延續到未來
				</span>
				—— 這張圖說的是過去 {snapshot.window_days}{" "}
				天發生了什麼，不是接下來會發生什麼。
			</p>
		</div>
	);
}

function Dot({
	n,
	mode,
	opacity,
	focused,
	onEnter,
	onLeave,
	onSelect,
}: {
	n: Placed;
	mode: ColorMode;
	opacity: number;
	focused: boolean;
	onEnter: () => void;
	onLeave: () => void;
	onSelect: () => void;
}) {
	// Radius carries 30-day realised volatility: a big dot swings harder. It is
	// the one extra dimension worth spending, because "these two move together"
	// means something different when both are twice as volatile as the market.
	const r = 7 + Math.min(1, Math.max(0, (n.vol - 0.3) / 0.8)) * 11;
	const fill = mode === "pillar" ? colorOf(n) : moveColor(n.ret_30d);
	return (
		// biome-ignore lint/a11y/useSemanticElements: SVG has no <button> element — role + tabIndex + key handling is the accessible form here.
		<g
			opacity={opacity}
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
			<circle
				cx={n.px}
				cy={n.py}
				r={r}
				fill={fill}
				stroke={focused ? "currentColor" : "#ffffff"}
				className={focused ? "text-foreground" : undefined}
				strokeWidth={focused ? 3 : 1.5}
			/>
			<text
				x={n.px}
				y={n.py + r + 13}
				textAnchor="middle"
				className="pointer-events-none fill-foreground"
				fontSize={13}
				fontWeight={500}
			>
				{n.name}
			</text>
		</g>
	);
}

function Card({ node }: { node: Placed }) {
	const chain = snapshot.edges.filter(
		(e) => e.from === node.id || e.to === node.id,
	);
	const corr = snapshot.corr_edges
		.filter((e) => e.from === node.id || e.to === node.id)
		.sort((a, b) => b.rho - a.rho);
	const p = node.pillar as Pillar | null;

	return (
		<div className="pointer-events-none absolute left-3 top-3 max-w-[19rem] rounded-md border border-border bg-background/95 p-4 text-sm shadow-lg backdrop-blur">
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
			<div className="mt-3 flex gap-5 font-mono text-xs">
				<span>
					<span className="text-muted-foreground">30日 </span>
					<span
						className={node.ret_30d >= 0 ? "text-red-600" : "text-emerald-600"}
					>
						{pct(node.ret_30d)}
					</span>
				</span>
				<span>
					<span className="text-muted-foreground">年化波動 </span>
					{(node.vol * 100).toFixed(0)}%
				</span>
			</div>

			{chain.length > 0 && (
				<div className="mt-3 border-t border-border pt-2">
					<div className="mb-1 text-xs font-medium">供應鏈</div>
					<ul className="space-y-0.5 text-xs text-muted-foreground">
						{chain.slice(0, 5).map((e) => {
							const other = byId.get(e.from === node.id ? e.to : e.from);
							const arrow =
								e.rel !== "supplies"
									? "—"
									: e.from === node.id
										? "供貨給 →"
										: "← 供應商";
							return (
								<li key={`${e.from}-${e.to}`}>
									{arrow} {other?.name ?? e.to}
								</li>
							);
						})}
					</ul>
				</div>
			)}

			{corr.length > 0 && (
				<div className="mt-3 border-t border-border pt-2">
					<div className="mb-1 text-xs font-medium">走勢最同步</div>
					<ul className="space-y-0.5 font-mono text-xs text-muted-foreground">
						{corr.slice(0, 3).map((e) => {
							const other = byId.get(e.from === node.id ? e.to : e.from);
							return (
								<li key={`${e.from}-${e.to}`}>
									ρ {e.rho.toFixed(2)} · {other?.name ?? e.to}
								</li>
							);
						})}
					</ul>
				</div>
			)}
		</div>
	);
}

function Legend({ mode }: { mode: ColorMode }) {
	return (
		<div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
			{mode === "pillar" ? (
				<>
					{Object.entries(PILLARS).map(([k, v]) => (
						<span key={k} className="flex items-center gap-1.5">
							<span
								className="inline-block h-2.5 w-2.5 rounded-full"
								style={{ background: v.color }}
							/>
							{v.zh}
						</span>
					))}
					<span className="flex items-center gap-1.5">
						<span
							className="inline-block h-2.5 w-2.5 rounded-full"
							style={{ background: UNCLASSIFIED_COLOR }}
						/>
						未分類
					</span>
				</>
			) : (
				<span className="flex items-center gap-2">
					<span className="flex items-center gap-1.5">
						<span
							className="inline-block h-2.5 w-2.5 rounded-full"
							style={{ background: moveColor(-0.25) }}
						/>
						跌 25%
					</span>
					<span className="h-1.5 w-24 rounded-full bg-gradient-to-r from-[hsl(152_55%_47%)] via-[hsl(0_0%_93%)] to-[hsl(2_78%_47%)]" />
					<span className="flex items-center gap-1.5">
						<span
							className="inline-block h-2.5 w-2.5 rounded-full"
							style={{ background: moveColor(0.25) }}
						/>
						漲 25%
					</span>
				</span>
			)}
			<span className="ml-auto">圓圈大小 = 波動度</span>
		</div>
	);
}

function Toggle({
	on,
	onClick,
	children,
}: {
	on: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={on}
			className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
				on
					? "border-foreground bg-accent"
					: "border-border text-muted-foreground hover:bg-accent"
			}`}
		>
			{children}
		</button>
	);
}

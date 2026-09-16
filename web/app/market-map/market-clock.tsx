"use client";

import { useEffect, useId, useState } from "react";
import {
	MACRO_MARKETS,
	SAME_SESSION_MARKETS,
	SESSIONS,
	TAIPEI_CLOSE,
	TAIPEI_OPEN,
} from "@/lib/market-map";

/**
 * Which of the seven markets had already CLOSED when Taipei opened.
 *
 * This looks decorative and is not. Every "台股受隔夜美股影響" chart quietly
 * assumes the other market's number was knowable before the Taipei open. For
 * the US, Europe and FX that is true. For Japan, Korea, China and Hong Kong it
 * is false — they trade at the same time as Taipei, so their stored close is
 * YESTERDAY's while today's move is still happening alongside. Treating those
 * four as overnight information is a look-ahead bias dressed as a correlation,
 * and the ring is the fastest way to see which side of the line a market is on.
 *
 * Hours are Asia/Taipei and mirror src/harvester/macro.py's `when_known`.
 */

const SIZE = 440;
const C = SIZE / 2;
const R_OUTER = 190;
const RING = 18;
const GAP = 3;

function polar(hour: number, r: number) {
	// Midnight at the top, clockwise — a clock face, because that is what it is.
	const a = ((hour / 24) * 360 - 90) * (Math.PI / 180);
	return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) };
}

function arc(from: number, to: number, r: number) {
	const s = polar(from, r);
	const e = polar(to, r);
	const large = to - from > 12 ? 1 : 0;
	return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

export default function MarketClock() {
	const [now, setNow] = useState<number | null>(null);
	const titleId = useId();

	// Read the clock only after mount. Rendering server-side time would hydrate
	// into a different hand position on every visit — a real hydration error,
	// for a hand that is decoration relative to the point of the graph.
	useEffect(() => {
		const tick = () => {
			const taipei = new Date(
				new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }),
			);
			setNow(taipei.getHours() + taipei.getMinutes() / 60);
		};
		tick();
		const id = setInterval(tick, 60_000);
		return () => clearInterval(id);
	}, []);

	const [hover, setHover] = useState<string | null>(null);

	// Ring order is not list order. FX never closes, so its ring is a complete
	// circle — drawn anywhere but the outside it reads as a solid disc in the
	// middle of the clock rather than as "always open", and it swallows the hub.
	const ringOrder = [
		...SESSIONS.filter((s) => s.roundTheClock),
		...SESSIONS.filter((s) => !s.roundTheClock),
	].map((s) => s.en);

	return (
		<div className="grid items-center gap-10 lg:grid-cols-2">
			<div className="mx-auto w-full max-w-[30rem]">
				<svg
					viewBox={`0 0 ${SIZE} ${SIZE}`}
					className="h-auto w-full"
					role="img"
					aria-labelledby={titleId}
				>
					<title id={titleId}>
						七個市場的交易時段，以台北時間排列成 24 小時時鐘
					</title>

					{/* The Taipei session as a wedge behind everything: the window in
					    which a number has to already exist to be usable today. */}
					<path
						d={`M ${C} ${C} L ${polar(TAIPEI_OPEN, R_OUTER + 14).x} ${
							polar(TAIPEI_OPEN, R_OUTER + 14).y
						} A ${R_OUTER + 14} ${R_OUTER + 14} 0 0 1 ${
							polar(TAIPEI_CLOSE, R_OUTER + 14).x
						} ${polar(TAIPEI_CLOSE, R_OUTER + 14).y} Z`}
						className="fill-primary"
						fillOpacity={0.09}
					/>

					{[0, 3, 6, 9, 12, 15, 18, 21].map((h) => {
						const p = polar(h, R_OUTER + 20);
						return (
							<text
								key={h}
								x={p.x}
								y={p.y}
								textAnchor="middle"
								dominantBaseline="middle"
								fontSize={11}
								className="fill-muted-foreground font-mono"
							>
								{String(h).padStart(2, "0")}
							</text>
						);
					})}

					{SESSIONS.map((s) => {
						const r = R_OUTER - ringOrder.indexOf(s.en) * (RING + GAP);
						const isTaipei = s.en === "Taiwan";
						const faded = hover !== null && hover !== s.en;
						return (
							// biome-ignore lint/a11y/useSemanticElements: SVG has no <button> element — role + tabIndex + key handling is the accessible form here.
							<g
								key={s.en}
								tabIndex={0}
								role="button"
								aria-label={`${s.zh} ${fmt(s.open)}–${fmt(s.close)}`}
								className="cursor-pointer outline-none"
								onMouseEnter={() => setHover(s.en)}
								onMouseLeave={() => setHover(null)}
								onFocus={() => setHover(s.en)}
								onBlur={() => setHover(null)}
								onClick={() => setHover(s.en)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										setHover(hover === s.en ? null : s.en);
									}
								}}
								opacity={faded ? 0.25 : 1}
							>
								<circle
									cx={C}
									cy={C}
									r={r}
									fill="none"
									stroke="currentColor"
									className="text-border"
									strokeWidth={RING}
									strokeOpacity={0.35}
								/>
								{s.roundTheClock ? (
									<circle
										cx={C}
										cy={C}
										r={r}
										fill="none"
										strokeWidth={RING}
										className="stroke-foreground"
										strokeOpacity={0.85}
									/>
								) : (
									<path
										d={arc(s.open, s.close, r)}
										fill="none"
										strokeWidth={RING}
										strokeLinecap="butt"
										className={
											isTaipei
												? "stroke-primary"
												: s.knownBeforeOpen
													? "stroke-foreground"
													: "stroke-muted-foreground"
										}
										strokeOpacity={
											isTaipei ? 1 : s.knownBeforeOpen ? 0.85 : 0.45
										}
									/>
								)}
							</g>
						);
					})}

					{now !== null && (
						<>
							<line
								x1={C}
								y1={C}
								x2={polar(now, R_OUTER + 10).x}
								y2={polar(now, R_OUTER + 10).y}
								className="stroke-primary"
								strokeWidth={2}
							/>
							<circle cx={C} cy={C} r={4} className="fill-primary" />
						</>
					)}
				</svg>
				<p className="mt-2 text-center font-mono text-xs text-muted-foreground">
					{now === null
						? "台北時間"
						: `台北 ${String(Math.floor(now)).padStart(2, "0")}:${String(
								Math.floor((now % 1) * 60),
							).padStart(2, "0")}`}
				</p>
			</div>

			<div>
				<div className="space-y-px overflow-hidden rounded-lg border border-border bg-border">
					{SESSIONS.map((s) => (
						<button
							type="button"
							key={s.en}
							className="block w-full bg-background px-4 py-2.5 text-left"
							onMouseEnter={() => setHover(s.en)}
							onMouseLeave={() => setHover(null)}
							onFocus={() => setHover(s.en)}
							onBlur={() => setHover(null)}
						>
							<div className="flex items-baseline justify-between gap-3">
								<span className="text-sm font-medium">
									{s.zh}
									{s.en === "Taiwan" && (
										<span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
											基準
										</span>
									)}
								</span>
								<span className="font-mono text-xs text-muted-foreground">
									{s.roundTheClock ? "24h" : `${fmt(s.open)}–${fmt(s.close)}`}
								</span>
							</div>
							<div className="mt-0.5 flex items-baseline justify-between gap-3">
								<span className="text-xs text-muted-foreground">
									{s.series}
								</span>
								<span
									className={`text-xs ${
										s.en === "Taiwan"
											? "text-muted-foreground"
											: s.knownBeforeOpen
												? "text-muted-foreground"
												: "font-medium text-foreground"
									}`}
								>
									{s.market === null
										? "—"
										: s.roundTheClock
											? "取隔夜水位"
											: s.knownBeforeOpen
												? "開盤前已收盤"
												: "與台股同時交易"}
								</span>
							</div>
						</button>
					))}
				</div>
				<p className="mt-4 text-xs leading-relaxed text-muted-foreground">
					{MACRO_MARKETS.length} 個宏觀市場裡，有 {SAME_SESSION_MARKETS.length}{" "}
					個<span className="text-foreground">和台股同時在交易</span>
					。把它們今天的數字當成「隔夜資訊」來解釋台股，是用還沒發生的事解釋已經發生的事
					—— 回測會因此漂亮得不真實。
				</p>
			</div>
		</div>
	);
}

function fmt(h: number) {
	const wrapped = h % 24;
	const hh = Math.floor(wrapped);
	const mm = Math.round((wrapped - hh) * 60);
	return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

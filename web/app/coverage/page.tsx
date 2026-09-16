import Link from "next/link";

export const metadata = {
	title: "Coverage & method — alphatecx",
	description:
		"What the pipeline collects, when each source becomes knowable, and the methodology constraints applied to anything measured from it.",
};

const DATASETS = [
	{
		name: "Institutional flow (T86)",
		scope: "~7,000 TWSE + TPEx tickers",
		cadence: "Daily, published ~15:00 Taipei",
		note: "Foreign investors, investment trusts, dealers — net buy/sell per ticker.",
	},
	{
		name: "Company identity bridge",
		scope: "2,340 listed companies",
		cadence: "On demand",
		note: "統一編號 joined to ticker from the same source row, so no name-matching is involved. Refreshed only when new listings appear — a company keeps its 統編.",
	},
	{
		name: "Price history (OHLCV)",
		scope: "Classified universe + benchmark",
		cadence: "Daily after close",
		note: "Bounded recent windows; older all-market raw data is pruned on a retention policy.",
	},
	{
		name: "Monthly revenue",
		scope: "Listed companies",
		cadence: "Monthly, per MOPS",
		note: "Filed on the exchange's calendar, not a fixed day-of-month.",
	},
	{
		name: "Macro",
		scope: "11 series across 7 markets",
		cadence: "Daily close per market",
		note: "Two vendors by design, so a single outage costs a subset rather than the set.",
	},
	{
		name: "News",
		scope: "16 feeds, zh-Hant and English",
		cadence: "Polled every 180s",
		note: "Conditional GET; deduplicated on canonical URL and on a normalised headline hash.",
	},
];

/* The timing map. This is the piece most likely to be got wrong by anyone
   assembling the same data, and it is a property of the exchanges rather than
   of any implementation — which is why it is worth publishing. */
const TIMING = [
	{
		market: "United States",
		series: "SOX, Nasdaq, TSMC ADR, 10Y",
		when: "Closed before Taipei opens",
		known: true,
	},
	{
		market: "FX",
		series: "DXY, USD/TWD",
		when: "24h; the overnight level",
		known: true,
	},
	{
		market: "Europe",
		series: "Euro Stoxx 50",
		when: "Closes ~00:30 Taipei",
		known: true,
	},
	{
		market: "Japan",
		series: "Nikkei 225",
		when: "Trades alongside Taipei",
		known: false,
	},
	{
		market: "Korea",
		series: "KOSPI",
		when: "Trades alongside Taipei",
		known: false,
	},
	{
		market: "China",
		series: "Shanghai Composite",
		when: "Trades alongside Taipei",
		known: false,
	},
	{
		market: "Hong Kong",
		series: "Hang Seng",
		when: "Trades alongside Taipei",
		known: false,
	},
];

const METHOD = [
	{
		claim: "A hit rate is not a result without a baseline.",
		body: "Any rule measured against this data is compared to the unconditional return of the same universe over the same window. A 58% hit rate against a 56% baseline is a two-point edge, not a 58% one — and that comparison is computed rather than left to the reader.",
	},
	{
		claim: "Costs decide short-horizon results.",
		body: "Taiwan round-trip friction is ~0.585% — 0.1425% brokerage each way plus a 0.30% securities transaction tax on the sell. A five-day rule averaging +0.4% gross is a losing rule. Results are reported net.",
	},
	{
		claim: "Correlated observations are not independent ones.",
		body: "Taiwan semiconductor names move together, and overlapping forward windows re-count the same move. Observations are clustered by date, so 400 raw triggers may be reported as 25 effective ones, and confidence intervals use the smaller number.",
	},
	{
		claim: "Entry is the next session's close.",
		body: "A signal computed from a closing price cannot be transacted at that price. Measurements enter on the following session — the earliest price actually reachable.",
	},
	{
		claim: "Survivorship is not corrected, and says so.",
		body: "The universe is the one classified today applied backwards, and no point-in-time membership is recorded. That bias is upward. It is named on every result rather than quietly absorbed.",
	},
];

function Row({ children }: { children: React.ReactNode }) {
	return <div className="bg-background p-5">{children}</div>;
}

export default function CoveragePage() {
	return (
		<main className="min-h-dvh bg-background text-foreground">
			<div className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
				<Link
					href="/"
					className="mb-10 inline-block font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
				>
					← alphatecx
				</Link>

				<h1 className="mb-4 text-3xl font-semibold tracking-tight sm:text-4xl">
					Coverage &amp; method
				</h1>
				<p className="mb-16 max-w-2xl text-lg leading-relaxed text-muted-foreground">
					What the pipeline holds, when each source actually becomes knowable,
					and the constraints applied to anything measured from it.
				</p>

				<section className="mb-16">
					<h2 className="mb-6 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
						Datasets
					</h2>
					<div className="space-y-px overflow-hidden rounded-lg border border-border bg-border">
						{DATASETS.map((d) => (
							<Row key={d.name}>
								<div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
									<span className="font-medium">{d.name}</span>
									<span className="font-mono text-xs text-muted-foreground">
										{d.cadence}
									</span>
								</div>
								<div className="mb-1.5 text-sm">{d.scope}</div>
								<p className="text-sm leading-relaxed text-muted-foreground">
									{d.note}
								</p>
							</Row>
						))}
					</div>
				</section>

				<section className="mb-16">
					<h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
						When each market is knowable
					</h2>
					<p className="mb-6 max-w-2xl text-sm leading-relaxed text-muted-foreground">
						Seven of the eleven macro series had closed before Taipei opens and
						can inform the session. The other four{" "}
						<span className="text-foreground">
							trade at the same time as Taipei
						</span>{" "}
						— their stored value is a previous close while today&apos;s move is
						still happening. Treating those as overnight information is a false
						statement about the world, so the distinction is carried on every
						row rather than left to the reader.
					</p>
					<div className="overflow-x-auto rounded-lg border border-border">
						<table className="w-full min-w-[34rem] text-sm">
							<thead>
								<tr className="border-b border-border text-left">
									<th className="p-3 font-medium">Market</th>
									<th className="p-3 font-medium">Series</th>
									<th className="p-3 font-medium">
										Relative to the Taipei open
									</th>
								</tr>
							</thead>
							<tbody>
								{TIMING.map((t) => (
									<tr
										key={t.market}
										className="border-b border-border last:border-0"
									>
										<td className="p-3 font-medium">{t.market}</td>
										<td className="p-3 text-muted-foreground">{t.series}</td>
										<td className="p-3">
											<span
												className={
													t.known
														? "text-muted-foreground"
														: "font-medium text-foreground"
												}
											>
												{t.when}
											</span>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<p className="mt-4 text-sm text-muted-foreground">
						The same distinction, drawn as a 24-hour clock:{" "}
						<Link
							href="/market-map"
							className="text-foreground underline underline-offset-4"
						>
							市場時鐘
						</Link>
						.
					</p>
				</section>

				<section className="mb-16">
					<h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
						Method
					</h2>
					<p className="mb-6 max-w-2xl text-sm leading-relaxed text-muted-foreground">
						Constraints applied to any measurement taken from this data. They
						exist because each one, left out, makes a result look better than it
						is — and all five omissions bias the same direction.
					</p>
					<div className="space-y-px overflow-hidden rounded-lg border border-border bg-border">
						{METHOD.map((m) => (
							<Row key={m.claim}>
								<div className="mb-1.5 font-medium">{m.claim}</div>
								<p className="text-sm leading-relaxed text-muted-foreground">
									{m.body}
								</p>
							</Row>
						))}
					</div>
				</section>

				<section className="mb-16 rounded-lg border border-border p-6">
					<h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
						Redistribution
					</h2>
					<p className="text-sm leading-relaxed text-muted-foreground">
						A licence travels with the data, not with the code that fetched it.
						The company identity bridge is derived from TWSE/TPEx open data
						under{" "}
						<span className="text-foreground">政府資料開放授權條款第1版</span>{" "}
						and may be redistributed, including into a paid surface. Third-party
						vendor series carry their own terms, are not redistributable as
						rows, and are not passed through.
					</p>
				</section>

				<footer className="border-t border-border pt-6 text-xs leading-relaxed text-muted-foreground">
					Informational market data only — not investment, legal or tax advice.
					Dates are Asia/Taipei. Not affiliated with TWSE or TPEx.
				</footer>
			</div>
		</main>
	);
}

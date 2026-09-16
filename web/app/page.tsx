import Link from "next/link";

export const metadata = {
	title: "alphatecx — Taiwan market data infrastructure",
	description:
		"A scheduled pipeline that turns TWSE/TPEx filings, institutional flow and macro prints into a queryable, provenance-stamped database.",
};

/* Figures are read off the codebase, not estimated. Update them here and in
   /coverage together — a number on a public page that drifts from the system
   is the same class of problem as a stale tutorial. */
const STATS = [
	{
		n: "~7,000",
		label: "TWSE + TPEx tickers",
		sub: "daily institutional flow (T86)",
	},
	{
		n: "2,340",
		label: "companies bridged to 統編",
		sub: "上市 1,086 · 上櫃 891 · 興櫃 363",
	},
	{ n: "11", label: "macro series", sub: "across 7 markets" },
	{ n: "16", label: "news feeds", sub: "polled every 180s" },
];

const PIPELINE = [
	{
		step: "Collect",
		body: "TWSE and TPEx publish on Taipei wall-clock. Institutional flow (T86) lands once daily near 15:00; monthly revenue on MOPS; company basic data carries the 統一編號. Macro comes from two vendors on purpose, so one outage costs a subset rather than everything.",
	},
	{
		step: "Store",
		body: "Postgres, upserted on composite primary keys so a re-run is a no-op rather than a duplicate. Reads target materialized views; every table reachable by the query layer holds an explicit read grant, verified by reading the privileges back after each migration.",
	},
	{
		step: "Serve",
		body: "53 read-only query tools over pre-computed views. Every response carries its own source, as-of date and freshness label — a number that cannot say where it came from does not leave the system.",
	},
];

export default function Home() {
	return (
		<main className="min-h-dvh bg-background text-foreground">
			<div className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
				<header className="mb-16">
					<p className="mb-3 font-mono text-xs uppercase tracking-widest text-muted-foreground">
						Taiwan equity data infrastructure
					</p>
					<h1 className="mb-5 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
						The plumbing under{" "}
						<span className="font-[family-name:var(--font-brand-script)] italic">
							Taiwan market data
						</span>
					</h1>
					<p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
						A scheduled pipeline that turns exchange filings, institutional flow
						and overnight macro prints into a queryable database — with the
						provenance of every figure attached to it.
					</p>
				</header>

				<section className="mb-16 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
					{STATS.map((s) => (
						<div key={s.label} className="bg-background p-5">
							<div className="mb-1 font-mono text-2xl font-semibold tabular-nums">
								{s.n}
							</div>
							<div className="text-sm font-medium">{s.label}</div>
							<div className="mt-1 text-xs leading-snug text-muted-foreground">
								{s.sub}
							</div>
						</div>
					))}
				</section>

				<section className="mb-16">
					<h2 className="mb-6 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
						How it works
					</h2>
					<div className="space-y-px overflow-hidden rounded-lg border border-border bg-border">
						{PIPELINE.map((p, i) => (
							<div
								key={p.step}
								className="grid gap-3 bg-background p-6 sm:grid-cols-[8rem_1fr]"
							>
								<div className="flex items-baseline gap-3">
									<span className="font-mono text-xs text-muted-foreground">
										0{i + 1}
									</span>
									<span className="font-medium">{p.step}</span>
								</div>
								<p className="text-sm leading-relaxed text-muted-foreground">
									{p.body}
								</p>
							</div>
						))}
					</div>
				</section>

				{/* The honest-limits block. It is on the landing page rather than buried
				    because the constraints below are the reason to trust the rest. */}
				<section className="mb-16 rounded-lg border border-border p-6">
					<h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
						What it does not do
					</h2>
					<ul className="space-y-3 text-sm leading-relaxed text-muted-foreground">
						<li>
							<span className="font-medium text-foreground">
								It is not investment advice, and not a product for sale.
							</span>{" "}
							This is data infrastructure. It emits no buy signals and makes no
							recommendations, by design rather than by disclaimer.
						</li>
						<li>
							<span className="font-medium text-foreground">
								It cannot make end-of-day data intraday.
							</span>{" "}
							Institutional flow publishes once a day. No transport changes
							that, so anything built on it is structurally end-of-day.
						</li>
						<li>
							<span className="font-medium text-foreground">
								A licence travels with the data, not the repository.
							</span>{" "}
							The 統編 bridge is derived from TWSE/TPEx open data under
							政府資料開放授權條款第1版 and may be redistributed. Third-party
							vendor series may not be passed through as rows, and are not.
						</li>
					</ul>
				</section>

				<nav className="flex flex-wrap gap-3">
					<Link
						href="/market-map"
						className="rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
					>
						台股結構地圖 →
					</Link>
					<Link
						href="/coverage"
						className="rounded-md border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
					>
						Coverage &amp; method
					</Link>
					<Link
						href="/chat"
						className="rounded-md border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
					>
						Research terminal
					</Link>
				</nav>

				<footer className="mt-20 border-t border-border pt-6 text-xs text-muted-foreground">
					Dates are Asia/Taipei. Exchange data is published by TWSE and TPEx;
					this site is not affiliated with either.
				</footer>
			</div>
		</main>
	);
}

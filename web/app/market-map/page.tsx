import Link from "next/link";
import {
	ageInDays,
	byId,
	crossChainAndCorrelation,
	nodeLabel,
	PILLARS,
	type Pillar,
	RHO_FLOOR,
	snapshot,
} from "@/lib/market-map";
import ChainFlow from "./chain-flow";
import CorrelationMap from "./correlation-map";
import MarketClock from "./market-clock";

export const metadata = {
	title: "台股結構地圖 — alphatecx",
	description:
		"台股 AI 供應鏈的上下游關係、120 日報酬相關性地圖，以及七個市場相對台北開盤的交易時段。",
};

/**
 * The public, graph-first surface.
 *
 * SCOPE, deliberately: this page shows STRUCTURE — who supplies whom, what has
 * moved together, which markets were open when. It shows no ranking, no screen,
 * no institutional-flow leaderboard and no signal, which is the line the
 * "public but infrastructure-framed" decision drew and the reason the page can
 * be open while the terminal behind /chat is not.
 *
 * All three graphs read one committed snapshot, so the page is fully static:
 * no request-time fetch, no token in the bundle, nothing to fall over.
 */

export default function MarketMapPage() {
	const { tight, chainPairs, tightPairs, overlap } = crossChainAndCorrelation();
	const age = ageInDays(snapshot.asof);

	return (
		<main className="min-h-dvh bg-background text-foreground">
			<div className="mx-auto max-w-6xl px-6 py-14 sm:py-20">
				<Link
					href="/"
					className="mb-10 inline-block font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
				>
					← alphatecx
				</Link>

				<header className="mb-14">
					<p className="mb-3 font-mono text-xs uppercase tracking-widest text-muted-foreground">
						Structure, not quotes
					</p>
					<h1 className="mb-5 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
						台股的{" "}
						<span className="font-[family-name:var(--font-brand-script)] italic">
							結構地圖
						</span>
					</h1>
					<p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
						報價軟體告訴你每一檔漲跌多少。這裡回答的是另一個問題：
						<span className="text-foreground">它們彼此是什麼關係</span>
						——
						誰供貨給誰、哪些名字實際上一起動、以及哪個市場的數字在台股開盤前就已經知道了。
					</p>

					<div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-xs text-muted-foreground">
						<span>
							快照日 <span className="text-foreground">{snapshot.asof}</span>
						</span>
						<span>
							相關性視窗{" "}
							<span className="text-foreground">
								{snapshot.window_days} 個交易日
							</span>
						</span>
						<span>
							分類{" "}
							<span className="text-foreground">{snapshot.n_tickers} 檔</span>
						</span>
						<span className={age > 10 ? "text-foreground" : undefined}>
							{age === 0 ? "今日更新" : `${age} 天前`}
						</span>
					</div>
				</header>

				<Section
					n="01"
					zh="供應鏈：從國外上游，到台灣，到終端客戶"
					lead="一條產業鏈不是一張清單，而且它不從台灣開始、也不在台灣結束。左邊是台灣得先向誰買設備和材料，中間是我們持有資料的台股，右邊是誰在買。框內的橫向位置就是鏈上的深度：離台積電一步、還是四步。"
				>
					<ChainFlow />
				</Section>

				<Section
					n="02"
					zh="相關性地圖：市場怎麼分群"
					lead="位置不是產業別，是 120 日報酬相關性的二維投影 —— 兩個點靠在一起，是因為它們真的一起動。把供應鏈的線疊上去，看得到哪些關係反映在價格上，哪些沒有。"
				>
					<CorrelationMap />
				</Section>

				<Section
					n="03"
					zh="鏈上說的，和價格說的"
					lead={`把兩張圖交叉起來看，會得到一個不太舒服的結果：120 日相關性 ρ ≥ ${RHO_FLOOR.toFixed(
						2,
					)} 的配對共 ${tightPairs} 組，而標註過的供應關係有 ${chainPairs} 組 —— 兩邊重疊 ${overlap} 組。`}
				>
					<div className="mb-8 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
						<Stat n={chainPairs} label="標註的供應／合作關係" />
						<Stat
							n={tightPairs}
							label={`高度同步的配對 ρ ≥ ${RHO_FLOOR.toFixed(2)}`}
						/>
						<Stat n={overlap} label="兩者同時成立" emphasis />
					</div>

					<ul className="space-y-px overflow-hidden rounded-lg border border-border bg-border">
						{tight.map((e) => (
							<li
								key={`${e.from}-${e.to}`}
								className="flex items-center gap-3 bg-background px-4 py-3 text-sm"
							>
								<Chip id={e.from} />
								<span
									aria-hidden="true"
									className="h-0.5 flex-1 rounded-full bg-[#8c52ff]"
									style={{ opacity: 0.25 + (e.rho - RHO_FLOOR) * 3 }}
								/>
								<Chip id={e.to} />
								<span className="w-11 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
									{e.rho.toFixed(2)}
								</span>
								<span className="w-28 shrink-0 text-right text-xs text-muted-foreground">
									{e.linked ? "鏈上有關係" : sharedGround(e.from, e.to)}
								</span>
							</li>
						))}
					</ul>

					<p className="mt-4 text-xs leading-relaxed text-muted-foreground">
						這不代表供應鏈沒用。ρ ≥ {RHO_FLOOR.toFixed(2)}{" "}
						是很高的門檻，而台股電子股本來就整批跟著大盤走； 上面這 {tightPairs}{" "}
						組多半是同一個細分市場的同業（記憶體、載板、重電），
						不是上下游。真正的解讀是：
						<span className="text-foreground">
							「A 供貨給 B」不等於「A 和 B 會一起漲」
						</span>
						——
						中間還隔著訂單、庫存與議價能力。至於為什麼同業比上下游更同步，這張圖回答不了，
						可能是共同的驅動因素，也可能只是我們的關係標註還不夠完整。
					</p>
				</Section>

				<Section
					n="04"
					zh="市場時鐘：誰先收盤"
					lead="台股 09:00 開盤的時候，美股和歐股早就收了，日韓中港還在交易。這條線決定了哪些數字可以拿來解釋今天。"
				>
					<MarketClock />
				</Section>

				<section className="mt-20 rounded-lg border border-border p-6">
					<h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
						這頁不做的事
					</h2>
					<ul className="space-y-3 text-sm leading-relaxed text-muted-foreground">
						<li>
							<span className="font-medium text-foreground">
								不提供選股、排行或買賣建議。
							</span>{" "}
							這裡只描述結構與已經發生的走勢，沒有任何一張圖在告訴你該買什麼。
						</li>
						<li>
							<span className="font-medium text-foreground">
								不是即時報價。
							</span>{" "}
							快照每日重算一次；三大法人買賣超本來就是每天收盤後才公布，換任何傳輸方式都一樣。
						</li>
						<li>
							<span className="font-medium text-foreground">
								相關性會變，而且常常變。
							</span>{" "}
							{snapshot.window_days} 天的視窗換成 60
							天，分群就會不一樣。這是描述，不是規律。
						</li>
					</ul>
				</section>

				<nav className="mt-10 flex flex-wrap gap-3">
					<Link
						href="/coverage"
						className="rounded-md border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
					>
						資料涵蓋與方法
					</Link>
					<Link
						href="/"
						className="rounded-md border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
					>
						回首頁
					</Link>
				</nav>

				<footer className="mt-16 border-t border-border pt-6 text-xs leading-relaxed text-muted-foreground">
					日期為
					Asia/Taipei。行情資料由臺灣證券交易所與證券櫃檯買賣中心公布，本站與兩者無隸屬關係。
					僅供資訊參考，非投資建議。
				</footer>
			</div>
		</main>
	);
}

function Section({
	n,
	zh,
	lead,
	children,
}: {
	n: string;
	zh: string;
	lead: string;
	children: React.ReactNode;
}) {
	return (
		<section className="mb-20">
			<div className="mb-6 flex items-baseline gap-3">
				<span className="font-mono text-xs text-muted-foreground">{n}</span>
				<h2 className="text-xl font-semibold tracking-tight">{zh}</h2>
			</div>
			<p className="mb-6 max-w-2xl text-sm leading-relaxed text-muted-foreground">
				{lead}
			</p>
			{children}
		</section>
	);
}

function Stat({
	n,
	label,
	emphasis,
}: {
	n: number;
	label: string;
	emphasis?: boolean;
}) {
	return (
		<div className="bg-background p-5">
			<div
				className={`mb-1 font-mono text-3xl font-semibold tabular-nums ${
					emphasis ? "text-primary" : ""
				}`}
			>
				{n}
			</div>
			<div className="text-xs leading-snug text-muted-foreground">{label}</div>
		</div>
	);
}

/**
 * What a co-moving pair has in common when the chain links nothing. Almost
 * always the same sub-industry — which is the point the paragraph below the
 * list is making, and it is better made by the rows themselves than asserted.
 */
function sharedGround(a: string, b: string): string {
	const x = byId.get(a);
	const y = byId.get(b);
	if (!x || !y) return "";
	// Compared on the LABEL, not the raw slug: the classification carries
	// aliases (`dram-memory` and `memory-dram` are the same business), and a
	// string compare would call two memory names "跨產業".
	if (x.node && y.node && nodeLabel(x) === nodeLabel(y))
		return `同為${nodeLabel(x)}`;
	if (x.pillar && x.pillar === y.pillar) {
		return `同為${PILLARS[x.pillar as Pillar]?.zh ?? x.pillar}`;
	}
	return "跨產業";
}

function Chip({ id }: { id: string }) {
	const n = byId.get(id);
	return (
		<span className="shrink-0 rounded border border-border px-2 py-0.5 text-xs">
			{n?.name ?? id}
		</span>
	);
}

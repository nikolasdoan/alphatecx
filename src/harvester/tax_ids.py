"""統一編號 ↔ ticker bridge, from TWSE/TPEx company basic data.

alphatecx held no 統一編號 anywhere, and it is the only key that joins this repo to bizmap
(`company.id`) and tecxwork (`clients.unified_business_no`) without matching Chinese company
names. The government files carry it in the same row as 公司代號, so nothing here is matched:
every row is exact. See docs/wiki/topics/marketecx.md.

    python -m src.harvester.tax_ids --out listed_companies.csv          # the table only
    python -m src.harvester.tax_ids --out listed_companies.csv --load   # + dim_ticker.tax_id

Deliberately not part of the nightly harvest. A company keeps its 統一編號, so a refresh only
picks up new listings — run it when bizmap needs a fresh copy.
"""

from __future__ import annotations

import argparse
import csv
import html
import io
import logging
import re
from pathlib import Path

import requests

from src.config import HTTP_TIMEOUT, USER_AGENT
from src.harvester import loader

log = logging.getLogger("tax_ids")

URL = "https://mopsfin.twse.com.tw/opendata/{dataset}.csv"

# 市場別 → dataset. All three are 金管會證期局 open data under 政府資料開放授權條款第1版
# (data.gov.tw 18419, 25036, 28568) — the licence bizmap requires of every source it carries,
# which is why every column comes from these files rather than from dim_ticker's T86-sourced
# names.
SOURCES = (("上市", "t187ap03_L"), ("上櫃", "t187ap03_O"), ("興櫃", "t187ap03_R"))

# Read by header name, never by position: the files have 33 columns, are regenerated daily,
# and a column read one over still produces plausible values.
REQUIRED = ("出表日期", "公司代號", "公司名稱", "營利事業統一編號")

# Every TDR (-DR) is a foreign issuer with no Taiwan registration, and the file fills the
# column with zeros for all of them — eight rows that would collide on a unique index.
NO_TAX_ID = "00000000"

FIELDS = ("tax_id", "ticker_id", "market", "name", "match", "source", "as_of")


def fetch(dataset: str) -> str:
    r = requests.get(URL.format(dataset=dataset), headers={"User-Agent": USER_AGENT},
                     timeout=HTTP_TIMEOUT)
    r.raise_for_status()
    # Served as text/csv with no charset, so r.text would decode it as ISO-8859-1.
    return r.content.decode("utf-8-sig")


def _roc_date(value: str) -> str:
    """'1150914' -> '2026-09-14'."""
    if not re.fullmatch(r"\d{7}", value):
        raise ValueError(f"出表日期 {value!r} is not a ROC yyyMMdd date")
    return f"{int(value[:3]) + 1911}-{value[3:5]}-{value[5:]}"


def parse(text: str, market: str, dataset: str) -> list[dict]:
    """Bridge rows from one basic-data file. Raises rather than guess at a changed file."""
    reader = csv.DictReader(io.StringIO(text))
    missing = [col for col in REQUIRED if col not in (reader.fieldnames or ())]
    if missing:
        raise ValueError(f"{dataset}: header has no {', '.join(missing)} — not the expected file")
    rows = []
    for r in reader:
        tax_id = r["營利事業統一編號"].strip()
        if tax_id == NO_TAX_ID:
            continue
        if not re.fullmatch(r"\d{8}", tax_id):
            raise ValueError(f"{dataset}: {r['公司代號']} has 統一編號 {tax_id!r}, not 8 digits")
        rows.append({
            "tax_id": tax_id,
            "ticker_id": r["公司代號"].strip(),
            "market": market,
            # A few names arrive as HTML character references: 邁&#33834;科技股份有限公司.
            "name": html.unescape(r["公司名稱"].strip()),
            "match": "exact",
            "source": f"twse:{dataset}",
            "as_of": _roc_date(r["出表日期"].strip()),
        })
    if not rows:
        raise ValueError(f"{dataset}: no companies — an empty file is not an empty market")
    return rows


def bridge(files: dict[str, str]) -> list[dict]:
    """Every market's rows from {dataset: file text}. A 統一編號 may appear only once."""
    rows = [row for market, dataset in SOURCES for row in parse(files[dataset], market, dataset)]
    tickers: dict[str, list[str]] = {}
    for row in rows:
        tickers.setdefault(row["tax_id"], []).append(row["ticker_id"])
    dupes = {tax_id: codes for tax_id, codes in tickers.items() if len(codes) > 1}
    if dupes:
        raise ValueError(f"統一編號 on more than one row: {dupes}")
    return rows


def write_csv(rows: list[dict], path: Path) -> None:
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="統一編號 ↔ ticker bridge for bizmap")
    ap.add_argument("--out", type=Path, required=True, help="CSV to write")
    ap.add_argument("--load", action="store_true", help="also set dim_ticker.tax_id")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")

    rows = bridge({dataset: fetch(dataset) for _, dataset in SOURCES})
    write_csv(rows, args.out)
    log.info("wrote %d rows to %s", len(rows), args.out)
    if args.load:
        with loader.atomic() as c:
            n = loader.upsert_tax_ids(rows, c=c)
            loader.log_ingestion("tax_ids", max(r["as_of"] for r in rows), n, c=c)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

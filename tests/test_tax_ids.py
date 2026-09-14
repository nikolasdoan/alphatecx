"""統一編號 bridge (src/harvester/tax_ids.py).

The rows below are shaped like the real t187ap03 files, including the three things those
files actually do: zeros in place of a 統一編號 for every TDR, company names carrying HTML
character references, and a text/csv response with no charset. TSMC's 22099131 is real;
every other tax ID here is a placeholder.
"""

from __future__ import annotations

import csv
from unittest import mock

import pytest

from src.harvester import loader, tax_ids

HEADER = "出表日期,公司代號,公司名稱,公司簡稱,外國企業註冊地國,產業別,住址,營利事業統一編號,董事長"
TSMC = '"1150914","2330","台灣積體電路製造股份有限公司","台積電","－ ","24","","22099131",""'
M31 = '"1150914","6643","&#20870;星科技股份有限公司","M31","－ ","","","11111111",""'
FWS = '"1150914","1260","富味鄉食品股份有限公司","富味鄉","－ ","","","22222222",""'


def _file(*rows: str, header: str = HEADER) -> str:
    return "\n".join((header, *rows)) + "\n"


def _all_markets(listed: str = TSMC) -> dict[str, str]:
    return {"t187ap03_L": _file(listed), "t187ap03_O": _file(M31), "t187ap03_R": _file(FWS)}


def test_reads_columns_by_name_not_position():
    shuffled = _file('"22099131","台灣積體電路製造股份有限公司","1150914","2330"',
                     header="營利事業統一編號,公司名稱,出表日期,公司代號")
    assert tax_ids.parse(shuffled, "上市", "t187ap03_L") == [{
        "tax_id": "22099131", "ticker_id": "2330", "market": "上市",
        "name": "台灣積體電路製造股份有限公司", "match": "exact",
        "source": "twse:t187ap03_L", "as_of": "2026-09-14",
    }]


def test_a_file_without_the_tax_id_column_is_refused():
    text = _file('"1150914","2330","台積電"', header="出表日期,公司代號,公司名稱")
    with pytest.raises(ValueError, match="營利事業統一編號"):
        tax_ids.parse(text, "上市", "t187ap03_L")


def test_a_block_page_is_not_a_dataset():
    with pytest.raises(ValueError, match="header has no"):
        tax_ids.parse("<html><body>連線已遭阻擋</body></html>", "上市", "t187ap03_L")


def test_tdr_zeros_are_skipped_rather_than_collided():
    tdr = '"1150914","9105","某存託憑證發行公司","DR-樣本","","","","00000000",""'
    rows = tax_ids.parse(_file(TSMC, tdr, tdr.replace('"9105"', '"9136"')), "上市", "t187ap03_L")
    assert [r["ticker_id"] for r in rows] == ["2330"]


def test_a_malformed_tax_id_fails_loudly():
    with pytest.raises(ValueError, match="not 8 digits"):
        tax_ids.parse(_file(TSMC.replace("22099131", "2209913")), "上市", "t187ap03_L")


def test_html_character_references_in_names_are_decoded():
    [row] = tax_ids.parse(_file(M31), "上櫃", "t187ap03_O")
    assert row["name"] == "円星科技股份有限公司"


def test_a_header_with_no_rows_is_refused():
    with pytest.raises(ValueError, match="no companies"):
        tax_ids.parse(_file(), "興櫃", "t187ap03_R")


def test_each_market_is_labelled_from_its_own_file():
    rows = tax_ids.bridge(_all_markets())
    assert [(r["ticker_id"], r["market"], r["source"]) for r in rows] == [
        ("2330", "上市", "twse:t187ap03_L"),
        ("6643", "上櫃", "twse:t187ap03_O"),
        ("1260", "興櫃", "twse:t187ap03_R"),
    ]


def test_one_tax_id_on_two_rows_is_refused():
    files = _all_markets()
    files["t187ap03_O"] = _file(TSMC.replace('"2330"', '"9999"'))
    with pytest.raises(ValueError, match="22099131"):
        tax_ids.bridge(files)


def test_fetch_decodes_utf8_although_the_server_declares_no_charset():
    body = ("﻿" + _file(TSMC)).encode("utf-8")
    # requests infers ISO-8859-1 for a text/* response with no charset, so .text is mojibake.
    response = mock.Mock(content=body, text=body.decode("iso-8859-1"))
    with mock.patch.object(tax_ids.requests, "get", return_value=response) as get:
        text = tax_ids.fetch("t187ap03_L")
    assert get.call_args.args[0] == "https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv"
    assert tax_ids.parse(text, "上市", "t187ap03_L")[0]["name"] == "台灣積體電路製造股份有限公司"


def test_main_writes_the_table_without_touching_the_database(tmp_path, monkeypatch):
    monkeypatch.setattr(tax_ids, "fetch", _all_markets().__getitem__)
    monkeypatch.setattr(loader, "atomic", mock.Mock(side_effect=AssertionError("no --load, no DB")))
    out = tmp_path / "listed_companies.csv"

    assert tax_ids.main(["--out", str(out)]) == 0

    with out.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        assert tuple(reader.fieldnames) == tax_ids.FIELDS
        assert [r["tax_id"] for r in reader] == ["22099131", "11111111", "22222222"]


class _RecordingCursor:
    rowcount = 0

    def __init__(self):
        self.calls = []

    def execute(self, sql, params=None):
        self.calls.append((" ".join(sql.split()), params))


def test_upsert_releases_a_stale_tax_id_before_assigning_it():
    """The index is unique and a company that changes its code keeps its 統一編號, so the old
    row has to let go of it before the new row can take it."""
    c = _RecordingCursor()
    loader.upsert_tax_ids([{"ticker_id": "2330", "tax_id": "22099131"}], c=c)
    (clear_sql, clear_params), (set_sql, set_params) = c.calls
    assert "SET tax_id = NULL" in clear_sql
    assert "SET tax_id = i.tax_id" in set_sql
    assert clear_params == set_params == (["2330"], ["22099131"])


def test_upsert_of_nothing_touches_nothing():
    c = _RecordingCursor()
    assert loader.upsert_tax_ids([], c=c) == 0
    assert c.calls == []

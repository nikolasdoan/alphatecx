-- 027 — 統一編號 on dim_ticker: the one column that joins alphatecx to bizmap and tecxwork.
--
-- Filled by `python -m src.harvester.tax_ids --load` from TWSE/TPEx company basic data;
-- see docs/wiki/topics/marketecx.md.
--
-- Nullable: ETFs, TDRs and every warrant or bond code a T86 fetch auto-discovers will never
-- have one, so NOT NULL would make the ordinary row an error. Unique: one registration is
-- one company, and PostgreSQL lets NULLs repeat under a unique index.
--
-- No grant: mcp_viewer's SELECT on dim_ticker is table-level (003), which covers a column
-- added afterwards.

ALTER TABLE dim_ticker ADD COLUMN IF NOT EXISTS tax_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_dt_tax_id ON dim_ticker (tax_id);

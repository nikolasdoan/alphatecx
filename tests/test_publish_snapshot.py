"""`scripts/publish_snapshot.py` — the step that replaced the nightly commit.

WHY THIS IS TESTED OFFLINE AND CAREFULLY. This script is now the only thing
standing between a harvest and what the public page shows. It holds write
credentials, it uploads to a bucket the internet reads, and it runs unattended
on two different runners. Three of its behaviours are load-bearing and none of
them is obvious from reading the happy path:

1. It SELF-SKIPS when unconfigured, rather than failing. A runner without R2
   credentials must still complete its pipeline.
2. It refuses to upload a snapshot that fails validation — and it must refuse
   BEFORE looking at credentials, because an invalid object is live the instant
   it lands, with no review in between (which a commit at least had).
3. A partially-configured environment must not upload. Half a credential set is
   a typo in a secret name, and attempting the upload would turn a clear
   misconfiguration into an opaque auth error.

boto3 is faked rather than mocked at the client level, so the test also proves
the import is lazy: an unconfigured run must not need the dependency at all.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "publish_snapshot.py"


def _load():
    spec = importlib.util.spec_from_file_location("publish_snapshot", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def mod():
    return _load()


@pytest.fixture
def good_snapshot(tmp_path: Path) -> Path:
    payload = {
        "asof": "2026-10-03",
        "window_days": 120,
        "n_tickers": 2,
        "nodes": [{"id": "2330"}, {"id": "2317"}],
        "edges": [],
        "corr_edges": [],
    }
    p = tmp_path / "snap.json"
    p.write_text(json.dumps(payload))
    return p


@pytest.fixture
def captured_uploads(monkeypatch):
    """A fake boto3 whose client records put_object calls."""
    calls: list[dict] = []

    class _Client:
        def put_object(self, **kw):
            calls.append(kw)

    fake = types.ModuleType("boto3")
    fake.client = lambda *a, **kw: _Client()  # type: ignore[attr-defined]
    fake.last_client_kwargs = None  # type: ignore[attr-defined]

    def client(*_a, **kw):
        fake.last_client_kwargs = kw  # type: ignore[attr-defined]
        return _Client()

    fake.client = client  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "boto3", fake)
    return calls, fake


def _configure(monkeypatch, **overrides):
    env = {
        "R2_ACCOUNT_ID": "acct",
        "R2_ACCESS_KEY_ID": "key",
        "R2_SECRET_ACCESS_KEY": "secret",
        "R2_BUCKET": "alphatecx-public",
    }
    env.update(overrides)
    for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
              "R2_BUCKET", "R2_SNAPSHOT_KEY"):
        monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        if v is not None:
            monkeypatch.setenv(k, v)


class TestItSelfSkipsRatherThanFailing:
    def test_no_credentials_exits_zero_and_uploads_nothing(
        self, mod, good_snapshot, captured_uploads, monkeypatch
    ):
        calls, _ = captured_uploads
        _configure(monkeypatch, R2_ACCOUNT_ID=None, R2_ACCESS_KEY_ID=None,
                   R2_SECRET_ACCESS_KEY=None, R2_BUCKET=None)
        assert mod.main(["--source", str(good_snapshot)]) == 0
        assert calls == []

    def test_an_unconfigured_run_never_imports_boto3(
        self, mod, good_snapshot, monkeypatch
    ):
        """The import is inside publish() on purpose. A runner that does not
        publish must not need the dependency installed."""
        monkeypatch.setitem(sys.modules, "boto3", None)
        _configure(monkeypatch, R2_ACCOUNT_ID=None, R2_ACCESS_KEY_ID=None,
                   R2_SECRET_ACCESS_KEY=None, R2_BUCKET=None)
        assert mod.main(["--source", str(good_snapshot)]) == 0

    def test_partial_configuration_does_not_upload(
        self, mod, good_snapshot, captured_uploads, monkeypatch
    ):
        """Half a credential set is a typo in a secret name. Trying anyway turns
        a clear misconfiguration into an opaque auth failure."""
        calls, _ = captured_uploads
        _configure(monkeypatch, R2_SECRET_ACCESS_KEY=None)
        assert mod.main(["--source", str(good_snapshot)]) == 0
        assert calls == []


class TestItRefusesToPublishRubbish:
    @pytest.mark.parametrize("mutate,why", [
        (lambda d: d.pop("nodes"), "missing nodes"),
        (lambda d: d.pop("asof"), "missing asof"),
        (lambda d: d.update(nodes=[]), "empty nodes"),
    ])
    def test_invalid_snapshots_raise_and_upload_nothing(
        self, mod, tmp_path, captured_uploads, monkeypatch, mutate, why
    ):
        calls, _ = captured_uploads
        payload = {
            "asof": "2026-10-03", "window_days": 120, "n_tickers": 1,
            "nodes": [{"id": "2330"}], "edges": [], "corr_edges": [],
        }
        mutate(payload)
        p = tmp_path / "bad.json"
        p.write_text(json.dumps(payload))
        _configure(monkeypatch)
        with pytest.raises(SystemExit):
            mod.main(["--source", str(p)])
        assert calls == [], f"uploaded despite {why}"

    def test_a_missing_source_is_a_hard_error(self, mod, tmp_path, monkeypatch):
        _configure(monkeypatch)
        with pytest.raises(SystemExit):
            mod.main(["--source", str(tmp_path / "nope.json")])


class TestTheUpload:
    def test_it_sends_the_bytes_with_json_type_and_a_short_cache(
        self, mod, good_snapshot, captured_uploads, monkeypatch
    ):
        calls, fake = captured_uploads
        _configure(monkeypatch)
        assert mod.main(["--source", str(good_snapshot)]) == 0
        assert len(calls) == 1
        sent = calls[0]
        assert sent["Bucket"] == "alphatecx-public"
        assert sent["Key"] == mod.DEFAULT_KEY
        assert sent["Body"] == good_snapshot.read_bytes()
        assert "application/json" in sent["ContentType"]
        # Short enough that a fresh harvest is visible within minutes.
        assert "max-age=300" in sent["CacheControl"]

    def test_it_targets_the_accounts_r2_endpoint(
        self, mod, good_snapshot, captured_uploads, monkeypatch
    ):
        _, fake = captured_uploads
        _configure(monkeypatch)
        mod.main(["--source", str(good_snapshot)])
        kw = fake.last_client_kwargs
        assert kw["endpoint_url"] == "https://acct.r2.cloudflarestorage.com"
        # R2 ignores the region, but boto3 refuses to sign without one.
        assert kw["region_name"] == "auto"

    def test_the_object_key_is_overridable(
        self, mod, good_snapshot, captured_uploads, monkeypatch
    ):
        calls, _ = captured_uploads
        _configure(monkeypatch, R2_SNAPSHOT_KEY="v2/graph.json")
        mod.main(["--source", str(good_snapshot)])
        assert calls[0]["Key"] == "v2/graph.json"

    def test_check_validates_without_uploading(
        self, mod, good_snapshot, captured_uploads, monkeypatch
    ):
        calls, _ = captured_uploads
        _configure(monkeypatch)
        assert mod.main(["--source", str(good_snapshot), "--check"]) == 0
        assert calls == []


class TestItAgreesWithTheConsumer:
    def test_both_ends_require_the_same_keys(self, mod):
        """The publisher refuses to upload what the page would refuse to draw.
        If these drift, one end starts trusting what the other rejects."""
        ts = (ROOT / "web" / "lib" / "snapshot-source.ts").read_text()
        block = ts[ts.index("REQUIRED_KEYS"):ts.index("] as const")]
        consumer = set(part.strip().strip('",') for part in block.splitlines()[1:])
        consumer.discard("")
        assert consumer == set(mod.REQUIRED), (
            f"publisher requires {sorted(mod.REQUIRED)}, page requires "
            f"{sorted(consumer)}"
        )

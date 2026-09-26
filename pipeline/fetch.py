"""Raw cache: every network response lands in data/raw/<YYYY-MM-DD>/ with a manifest.

Processing reads only from this cache, so re-running processing on the same cache gives
byte-identical output. The fetch layer never invents data: on failure it retries with backoff,
then raises.
"""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import io
import json
import time
from pathlib import Path
from typing import Any, Callable

import requests

REPO = Path(__file__).resolve().parent.parent
RAW_ROOT = REPO / "data" / "raw"
USER_AGENT = (
    "24x100-pipeline/0.1 (AI for Housing Hackathon, Pittsburgh; "
    "public-records research on vacant lots; contact via github.com)"
)
MANIFEST = "manifest.json"


class FetchError(RuntimeError):
    pass


class OfflineMiss(RuntimeError):
    pass


def today() -> str:
    return dt.date.today().isoformat()


def _now_utc() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def latest_raw_date(required: list[str] | None = None) -> str:
    """Newest data/raw/<date> whose manifest has every required key."""
    if not RAW_ROOT.exists():
        raise OfflineMiss("no data/raw directory; run without --offline first")
    dates = sorted((p.name for p in RAW_ROOT.iterdir() if p.is_dir() and (p / MANIFEST).exists()), reverse=True)
    for d in dates:
        man = json.loads((RAW_ROOT / d / MANIFEST).read_text())
        if not required or all(k in man for k in required):
            return d
    raise OfflineMiss(f"no raw cache has all of {required}")


def drop_csv_columns(raw: bytes, drop: set[str]) -> bytes:
    """Rewrite a CSV without the named columns (used to keep owner names off disk)."""
    text = raw.decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return raw
    header = rows[0]
    keep = [i for i, h in enumerate(header) if h not in drop]
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\n")
    for r in rows:
        w.writerow([r[i] if i < len(r) else "" for i in keep])
    return out.getvalue().encode("utf-8")


class RawCache:
    """One dated folder of raw responses plus manifest.json {key: {url, params, fetched_at, sha256, ...}}."""

    def __init__(self, date: str | None = None, offline: bool = False):
        self.date = date or today()
        self.offline = offline
        self.dir = RAW_ROOT / self.date
        self._manifest: dict[str, Any] | None = None

    # manifest ---------------------------------------------------------------------------
    @property
    def manifest(self) -> dict[str, Any]:
        if self._manifest is None:
            p = self.dir / MANIFEST
            self._manifest = json.loads(p.read_text()) if p.exists() else {}
        return self._manifest

    def _save_manifest(self) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / MANIFEST).write_text(json.dumps(self.manifest, sort_keys=True, indent=1) + "\n")

    def has(self, key: str) -> bool:
        return key in self.manifest and (self.dir / self.manifest[key]["file"]).exists()

    def entry(self, key: str) -> dict[str, Any]:
        return self.manifest[key]

    def read(self, key: str) -> bytes:
        if not self.has(key):
            raise OfflineMiss(f"raw cache {self.date} has no '{key}'")
        return (self.dir / self.manifest[key]["file"]).read_bytes()

    def read_json(self, key: str) -> Any:
        return json.loads(self.read(key))

    # fetch ------------------------------------------------------------------------------
    def get(
        self,
        key: str,
        url: str,
        params: dict[str, Any] | None = None,
        *,
        method: str = "GET",
        data: dict[str, Any] | None = None,
        ext: str = "json",
        transform: Callable[[bytes], bytes] | None = None,
        transform_note: str | None = None,
        validate: Callable[[bytes], None] | None = None,
        retries: int = 4,
        backoff: float = 2.0,
        timeout: int = 120,
    ) -> bytes:
        """Return cached bytes for key, fetching once if absent (unless offline).

        A cached entry whose url/params/post data differ from this request is stale: offline it
        is an error, online it is refetched and overwritten.
        """
        if self.has(key):
            e = self.manifest[key]
            same = e["url"] == url and e.get("params", {}) == (params or {}) and e.get("post_data") == data
            if same:
                return self.read(key)
            if self.offline:
                raise OfflineMiss(f"--offline: cached '{key}' was fetched with different parameters")
        if self.offline:
            raise OfflineMiss(f"--offline: raw cache {self.date} has no '{key}'")
        last: Exception | None = None
        for attempt in range(retries):
            try:
                r = requests.request(
                    method, url, params=params, data=data, timeout=timeout,
                    headers={"User-Agent": USER_AGENT},
                )
                if r.status_code != 200:
                    raise FetchError(f"HTTP {r.status_code} for {r.url}: {r.text[:200]!r}")
                body = r.content
                if validate:
                    validate(body)
                break
            except Exception as e:  # noqa: BLE001 - retried, then re-raised
                last = e
                if attempt < retries - 1:
                    time.sleep(backoff * 2 ** attempt)
        else:
            raise FetchError(f"'{key}' failed after {retries} attempts: {last}") from last
        stored = transform(body) if transform else body
        fname = key.replace("/", "__") + "." + ext
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / fname).write_bytes(stored)
        entry: dict[str, Any] = {
            "file": fname,
            "url": url,
            "params": params or {},
            "method": method,
            "fetched_at": _now_utc(),
            "sha256": sha256(stored),
            "bytes": len(stored),
        }
        if data:
            entry["post_data"] = data
        if transform:
            entry["sha256_response"] = sha256(body)
            entry["transform"] = transform_note or "transformed before caching"
        self.manifest[key] = entry
        self._save_manifest()
        return stored


    def put_local(self, key: str, path: Path, url: str, ext: str, note: str) -> bytes:
        """Cache a file a person downloaded by hand (e.g. behind a browser challenge)."""
        body = Path(path).expanduser().read_bytes()
        fname = key.replace("/", "__") + "." + ext
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / fname).write_bytes(body)
        self.manifest[key] = {
            "file": fname, "url": url, "params": {}, "method": "GET", "fetched_at": _now_utc(),
            "sha256": sha256(body), "bytes": len(body), "manual_download": note,
        }
        self._save_manifest()
        return body


def validate_geojson(body: bytes) -> None:
    j = json.loads(body)
    if "error" in j:
        raise FetchError(f"ArcGIS error: {j['error']}")
    if j.get("type") != "FeatureCollection":
        raise FetchError("not a FeatureCollection")
    if j.get("properties", {}).get("exceededTransferLimit") or j.get("exceededTransferLimit"):
        raise FetchError("exceededTransferLimit: page the query")


def validate_ckan(body: bytes) -> None:
    j = json.loads(body)
    if not j.get("success"):
        raise FetchError(f"CKAN error: {j.get('error')}")

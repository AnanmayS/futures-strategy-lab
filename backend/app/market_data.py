"""
Fetch futures OHLCV data from Yahoo Finance via yfinance.
Produces the same candle format as CSV upload: [{time, open, high, low, close, volume}, ...]
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import date
from pathlib import Path
from typing import Any

import yfinance as yf
import pandas as pd

logger = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).resolve().parent.parent / "cache"

# yfinance futures symbols
FUTURES_SYMBOLS: dict[str, str] = {
    "MES": "MES=F",
    "ES": "ES=F",
    "MNQ": "MNQ=F",
    "NQ": "NQ=F",
}


def _cache_key(symbol: str, interval: str, start: str, end: str) -> str:
    """Deterministic cache filename for a request."""
    raw = f"{symbol}_{interval}_{start}_{end}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16] + ".json"


def _load_cache(cache_path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]] | None:
    """Return (candles, metadata) or None."""
    if not cache_path.exists():
        return None
    try:
        data = json.loads(cache_path.read_text())
        if isinstance(data, dict) and "candles" in data and "metadata" in data:
            if len(data["candles"]) > 0:
                return data["candles"], data["metadata"]
    except (json.JSONDecodeError, OSError):
        pass
    return None


def _save_cache(cache_path: Path, candles: list[dict[str, Any]], metadata: dict[str, Any]) -> None:
    """Write candles and metadata to cache file."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps({"candles": candles, "metadata": metadata}, default=str))


def _flatten_yfinance(df: pd.DataFrame) -> pd.DataFrame:
    """Flatten MultiIndex or single-level columns from yfinance download into simple lowercase names."""
    # yfinance returns either a MultiIndex [('Close','MES=F'),...] or flat ['Close',...]
    cols: list[str] = []
    for col in df.columns:
        if isinstance(col, tuple):
            cols.append(str(col[0]).lower())
        else:
            cols.append(str(col).lower())
    df.columns = cols
    return df


def fetch_futures_data(
    contract: str,
    interval: str = "5m",
    start_date: str | None = None,
    end_date: str | None = None,
    use_cache: bool = True,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    Fetch futures OHLCV data and return (candles, metadata).

    Arguments
    ---------
    contract : one of "MES", "ES", "MNQ", "NQ"
    interval : yfinance interval string — "1m", "5m", "15m", "30m", "1h", "1d", etc.
    start_date : ISO date string, e.g. "2026-05-01". None = let yfinance decide.
    end_date : ISO date string, e.g. "2026-06-18". None = today.
    use_cache : if True, check disk cache before hitting Yahoo.

    Returns
    -------
    (candles, metadata)
    """
    yf_symbol = FUTURES_SYMBOLS.get(contract.upper())
    if yf_symbol is None:
        raise ValueError(f"Unknown contract: {contract}. Must be one of {list(FUTURES_SYMBOLS)}")

    cache_path = CACHE_DIR / _cache_key(yf_symbol, interval, start_date or "none", end_date or "none")

    if use_cache:
        cached_result = _load_cache(cache_path)
        if cached_result is not None:
            cached_candles, cached_meta = cached_result
            logger.info("Cache hit: %s %s (%d candles)", contract, interval, len(cached_candles))
            return cached_candles, {**cached_meta, "source": "cache"}

    # Fetch from Yahoo
    kwargs: dict[str, Any] = {
        "interval": interval,
        "progress": False,
        "auto_adjust": True,
    }

    if start_date and end_date:
        kwargs["start"] = start_date
        kwargs["end"] = end_date
    elif start_date:
        kwargs["start"] = start_date
    elif end_date:
        kwargs["end"] = end_date
    else:
        # Default to last 30 days of 5m data
        kwargs["period"] = "30d"

    df = yf.download(yf_symbol, **kwargs)  # type: ignore[assignment]

    if not isinstance(df, pd.DataFrame) or df.empty:
        raise ValueError(
            f"No data returned for {contract} ({yf_symbol}) "
            f"with interval={interval}, range={start_date or 'none'}→{end_date or 'none'}. "
            f"Yahoo Finance limits 5m data to ~60 days."
        )

    df = _flatten_yfinance(df)

    # Ensure we have all required columns
    required = {"open", "high", "low", "close", "volume"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Missing columns from yfinance: {missing}. Got columns: {list(df.columns)}")

    # Build candle list
    candles: list[dict[str, Any]] = []
    for i, (_, row) in enumerate(df.iterrows()):
        ts = pd.Timestamp(str(df.index[i]))  # type: ignore[arg-type]
        candles.append({
            "time": ts.isoformat().replace("+00:00", "Z"),  # type: ignore[union-attr]
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
            "volume": int(row["volume"]),
        })

    if not candles:
        raise ValueError("No candles after processing")

    metadata = {
        "source": "yfinance",
        "contract": contract,
        "interval": interval,
        "start_date": start_date,
        "end_date": end_date,
        "candle_count": len(candles),
        "cache_key": cache_path.name,
    }
    _save_cache(cache_path, candles, metadata)
    logger.info("Fetched %s %s: %d candles → cached", contract, interval, len(candles))

    return candles, metadata

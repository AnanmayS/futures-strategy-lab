"""
Live backtest: fetch futures data for a date, filter to NYSE market hours, run backtest.
No CSV upload needed — one endpoint does everything.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, time, timedelta as dt_timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

from .backtest import run_backtest
from .market_data import FUTURES_SYMBOLS, _flatten_yfinance, CACHE_DIR, _cache_key, _load_cache, _save_cache
from .models import BacktestConfig

logger = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")

# Market hours: 8:30 AM – 5:00 PM ET (NYSE open 9:30 AM ± 1 hour buffer)
MARKET_OPEN_ET = time(8, 30)
MARKET_CLOSE_ET = time(17, 0)

# Need at least 2 extra days of data for EMA warmup
WARMUP_DAYS = 3

DEFAULT_MIN_CANDLES = 23


def _to_et(iso_str: str) -> str:
    """Convert a UTC ISO timestamp (with Z suffix) to ET and return as ISO string."""
    ts = pd.Timestamp(iso_str).tz_convert(ET)
    return ts.isoformat()  # type: ignore[union-attr]


def _convert_result_times_to_et(result: dict[str, Any]) -> None:
    """Mutate all timestamp fields in the backtest result from UTC to ET."""
    for candle in result.get("candles", []):
        if "time" in candle:
            candle["time"] = _to_et(candle["time"])
    for indicator in result.get("indicators", []):
        if "time" in indicator:
            indicator["time"] = _to_et(indicator["time"])
    for trade in result.get("trades", []):
        for field in ("entry_time", "exit_time"):
            if field in trade:
                trade[field] = _to_et(trade[field])
    for point in result.get("equity_curve", []):
        if "time" in point:
            point["time"] = _to_et(point["time"])


def _market_window(target_date: date) -> tuple[datetime, datetime]:
    """Return (open_dt, close_dt) in timezone-aware datetime for the given date in ET."""
    open_dt = datetime.combine(target_date, MARKET_OPEN_ET, tzinfo=ET)
    close_dt = datetime.combine(target_date, MARKET_CLOSE_ET, tzinfo=ET)
    return open_dt, close_dt


def list_available_backtest_dates(
    contract: str = "MES",
    interval: str = "5m",
    min_candles: int = DEFAULT_MIN_CANDLES,
) -> dict[str, Any]:
    """Inspect local cache files and return ET dates with enough market-hours candles."""
    contract_upper = contract.upper()
    if contract_upper not in FUTURES_SYMBOLS:
        raise ValueError(f"Unknown contract: {contract}")

    dates: dict[str, dict[str, Any]] = {}
    cache_files = sorted(CACHE_DIR.glob("*.json"))
    for cache_file in cache_files:
        try:
            cached = json.loads(cache_file.read_text())
        except (json.JSONDecodeError, OSError):
            continue

        metadata = cached.get("metadata", {})
        if metadata.get("contract", "").upper() != contract_upper:
            continue
        if metadata.get("interval") and metadata.get("interval") != interval:
            continue

        candles = cached.get("candles", [])
        if not isinstance(candles, list):
            continue

        for candle in candles:
            try:
                ts = pd.Timestamp(candle["time"])
            except (KeyError, ValueError, TypeError):
                continue
            et_date = ts.tz_convert(ET).date() if ts.tzinfo else ts.tz_localize("UTC").tz_convert(ET).date()
            open_dt, close_dt = _market_window(et_date)
            if open_dt <= ts <= close_dt:
                item = dates.setdefault(
                    et_date.isoformat(),
                    {"date": et_date.isoformat(), "timestamps": set(), "cache_files": set()},
                )
                item["timestamps"].add(ts.isoformat())
                item["cache_files"].add(cache_file.name)

    available_dates = [
        {
            "date": item["date"],
            "candle_count": len(item["timestamps"]),
            "cache_files": sorted(item["cache_files"]),
        }
        for item in dates.values()
        if len(item["timestamps"]) >= min_candles
    ]
    available_dates.sort(key=lambda item: item["date"])

    latest = available_dates[-1]["date"] if available_dates else None
    return {
        "contract": contract_upper,
        "interval": interval,
        "min_candles": min_candles,
        "latest_date": latest,
        "dates": available_dates,
    }


def run_live_backtest(
    target_date: str,
    contract: str = "MES",
    strategy: str = "ema_crossover",
    interval: str = "5m",
    fast_ema: int = 9,
    slow_ema: int = 21,
    initial_capital: float = 25_000,
    contracts: int = 1,
    commission_per_side: float = 0.62,
    slippage_ticks: float = 1.0,
    spread_ticks: float = 1.0,
    stop_loss_points: float = 0.0,
    take_profit_points: float = 0.0,
    bb_period: int = 20,
    bb_stddev: float = 2.0,
    rsi_period: int = 14,
    rsi_overbought: float = 70.0,
    rsi_oversold: float = 30.0,
    use_cache: bool = True,
) -> dict[str, Any]:
    """
    Fetch futures data, filter to NYSE market hours, and run a backtest.

    Returns the full backtest result dict (same shape as POST /api/backtest),
    with all timestamps converted to ET.
    """
    yf_symbol = FUTURES_SYMBOLS.get(contract.upper())
    if yf_symbol is None:
        raise ValueError(f"Unknown contract: {contract}")

    parsed_date = date.fromisoformat(target_date)
    open_dt, close_dt = _market_window(parsed_date)

    fetch_start = (parsed_date - dt_timedelta(days=WARMUP_DAYS)).isoformat()
    fetch_end = (parsed_date + dt_timedelta(days=1)).isoformat()

    config = BacktestConfig(
        strategy=strategy,  # type: ignore[arg-type]
        initial_capital=initial_capital,
        contract_type=contract.upper(),  # type: ignore[arg-type]
        contracts=contracts,
        commission_per_side=commission_per_side,
        slippage_ticks=slippage_ticks,
        spread_ticks=spread_ticks,
        stop_loss_points=stop_loss_points,
        take_profit_points=take_profit_points,
        fast_ema=fast_ema,
        slow_ema=slow_ema,
        bb_period=bb_period,
        bb_stddev=bb_stddev,
        rsi_period=rsi_period,
        rsi_overbought=rsi_overbought,
        rsi_oversold=rsi_oversold,
        backtest_date=parsed_date,
    )

    # Check cache
    cache_path = CACHE_DIR / _cache_key(yf_symbol, interval, fetch_start, fetch_end)
    if use_cache:
        cached = _load_cache(cache_path)
        if cached is not None:
            candles_raw, _ = cached
            data_source = "cache"
        else:
            candles_raw = None
    else:
        candles_raw = None

    # Fetch if not cached
    if candles_raw is None:
        data_source = "yfinance"
        import yfinance as yf

        df = yf.download(yf_symbol, interval=interval, start=fetch_start, end=fetch_end, progress=False, auto_adjust=True)

        if not isinstance(df, pd.DataFrame) or df.empty:
            raise ValueError(
                f"No {interval} data available for {contract} ({yf_symbol}) around {target_date}. "
                f"Yahoo Finance only provides 5m data for the last ~60 days."
            )

        df = _flatten_yfinance(df)

        candles_raw = []
        for i, (_, row) in enumerate(df.iterrows()):
            ts = pd.Timestamp(str(df.index[i]))  # type: ignore[arg-type]
            candles_raw.append({
                "time": ts.isoformat().replace("+00:00", "Z"),  # type: ignore[union-attr]
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": int(row["volume"]),
            })

        _save_cache(cache_path, candles_raw, {
            "contract": contract,
            "interval": interval,
            "fetch_start": fetch_start,
            "fetch_end": fetch_end,
            "candle_count": len(candles_raw),
        })

    # Filter to market hours window
    market_candles = []
    for c in candles_raw:
        ts = pd.Timestamp(c["time"])
        if open_dt <= ts <= close_dt:
            market_candles.append(c)

    if not market_candles:
        raise ValueError(
            f"No candles found in market hours window ({open_dt.isoformat()} → {close_dt.isoformat()}) "
            f"for {target_date}. The market may have been closed or no data is available."
        )

    # Convert to DataFrame for backtest engine (still UTC internally)
    rows = []
    for c in market_candles:
        rows.append({
            "timestamp": pd.Timestamp(c["time"]),
            "open": float(c["open"]),
            "high": float(c["high"]),
            "low": float(c["low"]),
            "close": float(c["close"]),
            "volume": int(c["volume"]),
        })
    frame = pd.DataFrame(rows)
    frame = frame.sort_values("timestamp").drop_duplicates("timestamp").reset_index(drop=True)

    if len(frame) < config.slow_ema + 2:
        raise ValueError(
            f"Only {len(frame)} candles in the market hours window. "
            f"Need at least {config.slow_ema + 2} candles for EMA {config.fast_ema}/{config.slow_ema}."
        )

    result = run_backtest(frame, config)

    # Convert all timestamps from UTC to ET so the chart shows market hours
    _convert_result_times_to_et(result)

    result["market_hours"] = {
        "open_et": open_dt.isoformat(),
        "close_et": close_dt.isoformat(),
        "total_candles_fetched": len(candles_raw),
        "candles_in_window": len(market_candles),
    }
    result["data_metadata"] = {
        "source": data_source,
        "contract": contract.upper(),
        "interval": interval,
        "fetch_start": fetch_start,
        "fetch_end": fetch_end,
        "cache_key": cache_path.name,
    }
    return result

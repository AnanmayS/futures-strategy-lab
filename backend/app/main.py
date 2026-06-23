import io
import json

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from .backtest import filter_frame_by_date, run_backtest
from .live_backtest import DEFAULT_MIN_CANDLES, list_available_backtest_dates, run_live_backtest
from .market_data import fetch_futures_data
from .models import BacktestConfig


REQUIRED_COLUMNS = ["timestamp", "open", "high", "low", "close", "volume"]

app = FastAPI(title="Futures Strategy Lab API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/market-data")
async def market_data(
    contract: str = Query(..., description="Contract symbol: MES, ES, MNQ, NQ"),
    interval: str = Query(default="5m", description="Bar interval: 1m, 5m, 15m, 30m, 1h, 1d"),
    start: str | None = Query(default=None, description="Start date (ISO format, e.g. 2026-05-01)"),
    end: str | None = Query(default=None, description="End date (ISO format, e.g. 2026-06-18)"),
    refresh: bool = Query(default=False, description="Bypass cache and re-fetch from Yahoo"),
) -> dict:
    contract_upper = contract.upper()
    if contract_upper not in ("MES", "ES", "MNQ", "NQ"):
        raise HTTPException(status_code=400, detail="Contract must be one of: MES, ES, MNQ, NQ")
    try:
        candles, metadata = fetch_futures_data(
            contract=contract_upper,
            interval=interval,
            start_date=start,
            end_date=end,
            use_cache=not refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"candles": candles, "metadata": metadata}


@app.get("/api/available-dates")
async def available_dates(
    contract: str = Query(default="MES", description="Contract: MES, ES, MNQ, NQ"),
    interval: str = Query(default="5m", description="Bar interval: 1m, 5m, 15m, 30m, 1h, 1d"),
    min_candles: int = Query(default=DEFAULT_MIN_CANDLES, ge=1, description="Minimum market-hours candles required"),
) -> dict:
    contract_upper = contract.upper()
    if contract_upper not in ("MES", "ES", "MNQ", "NQ"):
        raise HTTPException(status_code=400, detail="Contract must be one of: MES, ES, MNQ, NQ")
    try:
        return list_available_backtest_dates(
            contract=contract_upper,
            interval=interval,
            min_candles=min_candles,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/backtest-live")
async def backtest_live(
    date: str = Query(..., description="Backtest date (ISO format, e.g. 2026-06-17)"),
    contract: str = Query(default="MES", description="Contract: MES, ES, MNQ, NQ"),
    strategy: str = Query(default="ema_crossover", description="Strategy: ema_crossover, sma_crossover, bollinger_bands, rsi_mean_reversion"),
    interval: str = Query(default="5m", description="Bar interval: 1m or 5m"),
    fast_ema: int = Query(default=9, ge=1, description="Fast EMA/SMA period"),
    slow_ema: int = Query(default=21, ge=2, description="Slow EMA/SMA period"),
    bb_period: int = Query(default=20, ge=2, description="Bollinger Bands period"),
    bb_stddev: float = Query(default=2.0, gt=0, description="Bollinger Bands stddev multiplier"),
    rsi_period: int = Query(default=14, ge=2, description="RSI period"),
    rsi_overbought: float = Query(default=70.0, gt=50, le=100, description="RSI overbought threshold"),
    rsi_oversold: float = Query(default=30.0, ge=0, lt=50, description="RSI oversold threshold"),
    initial_capital: float = Query(default=25000, gt=0),
    contracts: int = Query(default=1, ge=1),
    commission_per_side: float = Query(default=0.62, ge=0),
    slippage_ticks: float = Query(default=1.0, ge=0),
    spread_ticks: float = Query(default=1.0, ge=0),
    stop_loss_points: float = Query(default=0, ge=0, description="Stop-loss in points (0 = disabled)"),
    take_profit_points: float = Query(default=0, ge=0, description="Take-profit in points (0 = disabled)"),
) -> dict:
    contract_upper = contract.upper()
    if contract_upper not in ("MES", "ES", "MNQ", "NQ"):
        raise HTTPException(status_code=400, detail="Contract must be one of: MES, ES, MNQ, NQ")
    if fast_ema >= slow_ema:
        raise HTTPException(status_code=400, detail="Fast EMA must be smaller than slow EMA")
    try:
        return run_live_backtest(
            target_date=date,
            contract=contract_upper,
            strategy=strategy,
            interval=interval,
            fast_ema=fast_ema,
            slow_ema=slow_ema,
            bb_period=bb_period,
            bb_stddev=bb_stddev,
            rsi_period=rsi_period,
            rsi_overbought=rsi_overbought,
            rsi_oversold=rsi_oversold,
            initial_capital=initial_capital,
            contracts=contracts,
            commission_per_side=commission_per_side,
            slippage_ticks=slippage_ticks,
            spread_ticks=spread_ticks,
            stop_loss_points=stop_loss_points,
            take_profit_points=take_profit_points,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/sweep")
async def sweep(
    start_date: str = Query(..., description="Start date (ISO)"),
    end_date: str = Query(..., description="End date (ISO, inclusive)"),
    strategies: str = Query(default="ema_crossover", description="Comma-separated strategies"),
    contract: str = Query(default="MES"),
    interval: str = Query(default="5m"),
    fast_ema: int = Query(default=9, ge=1),
    slow_ema: int = Query(default=21, ge=2),
    bb_period: int = Query(default=20, ge=2),
    bb_stddev: float = Query(default=2.0, gt=0),
    rsi_period: int = Query(default=14, ge=2),
    rsi_overbought: float = Query(default=70.0, gt=50, le=100),
    rsi_oversold: float = Query(default=30.0, ge=0, lt=50),
    initial_capital: float = Query(default=25000, gt=0),
    contracts: int = Query(default=1, ge=1),
    commission_per_side: float = Query(default=0.62, ge=0),
    slippage_ticks: float = Query(default=1.0, ge=0),
    spread_ticks: float = Query(default=1.0, ge=0),
    stop_loss_points: float = Query(default=0, ge=0),
    take_profit_points: float = Query(default=0, ge=0),
) -> list[dict]:
    from datetime import timedelta as td

    strategy_list = [s.strip() for s in strategies.split(",") if s.strip()]
    valid = {"ema_crossover", "sma_crossover", "bollinger_bands", "rsi_mean_reversion"}
    for s in strategy_list:
        if s not in valid:
            raise HTTPException(status_code=400, detail=f"Unknown strategy: {s}")

    try:
        sd = __import__("datetime").date.fromisoformat(start_date)
        ed = __import__("datetime").date.fromisoformat(end_date)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid date: {e}") from e
    if sd > ed:
        raise HTTPException(status_code=400, detail="start_date must be <= end_date")

    results: list[dict] = []
    current = sd
    while current <= ed:
        for strat in strategy_list:
            try:
                result = run_live_backtest(
                    target_date=current.isoformat(),
                    contract=contract.upper(),
                    strategy=strat,
                    interval=interval,
                    fast_ema=fast_ema,
                    slow_ema=slow_ema,
                    bb_period=bb_period,
                    bb_stddev=bb_stddev,
                    rsi_period=rsi_period,
                    rsi_overbought=rsi_overbought,
                    rsi_oversold=rsi_oversold,
                    initial_capital=initial_capital,
                    contracts=contracts,
                    commission_per_side=commission_per_side,
                    slippage_ticks=slippage_ticks,
                    spread_ticks=spread_ticks,
                    stop_loss_points=stop_loss_points,
                    take_profit_points=take_profit_points,
                )
                results.append({
                    "date": current.isoformat(),
                    "strategy": strat,
                    "metrics": result["metrics"],
                    "candle_count": len(result["candles"]),
                    "market_hours": result.get("market_hours", {}),
                })
            except ValueError as exc:
                results.append({
                    "date": current.isoformat(),
                    "strategy": strat,
                    "error": str(exc),
                })
        current += td(days=1)

    return results


@app.post("/api/backtest")
async def backtest(
    file: UploadFile = File(...), config: str = Form(...)
) -> dict:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Upload a .csv file")
    try:
        parsed_config = BacktestConfig.model_validate(json.loads(config))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        contents = await file.read()
        frame = pd.read_csv(io.BytesIO(contents))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="The CSV could not be read") from exc

    frame.columns = [column.strip().lower() for column in frame.columns]
    missing = [column for column in REQUIRED_COLUMNS if column not in frame.columns]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(missing)}")

    frame = frame[REQUIRED_COLUMNS].copy()
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True, errors="coerce")
    for column in REQUIRED_COLUMNS[1:]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    if frame.isna().any().any():
        raise HTTPException(status_code=400, detail="CSV contains invalid timestamps or numeric values")
    if (frame["high"] < frame[["open", "close", "low"]].max(axis=1)).any() or (
        frame["low"] > frame[["open", "close", "high"]].min(axis=1)
    ).any():
        raise HTTPException(status_code=400, detail="CSV contains invalid OHLC relationships")
    if (frame["volume"] < 0).any():
        raise HTTPException(status_code=400, detail="Volume cannot be negative")

    frame = frame.sort_values("timestamp").drop_duplicates("timestamp").reset_index(drop=True)
    frame = filter_frame_by_date(frame, parsed_config.backtest_date).reset_index(drop=True)
    if frame.empty:
        selected = parsed_config.backtest_date.isoformat() if parsed_config.backtest_date else "the selection"
        raise HTTPException(status_code=400, detail=f"No candles were found for {selected} UTC")
    if len(frame) < parsed_config.slow_ema + 2:
        selected = f" on {parsed_config.backtest_date.isoformat()} UTC" if parsed_config.backtest_date else ""
        raise HTTPException(
            status_code=400,
            detail=f"CSV needs at least {parsed_config.slow_ema + 2} candles{selected} for these EMA settings",
        )
    return run_backtest(frame, parsed_config)

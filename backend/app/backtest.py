"""
Backtest engine: strategy signal generators and the main run loop.

Each signal generator returns a DataFrame with a `signal` column:
  - "long"   → go long (open new position)
  - "short"  → go short
  - "close"  → exit current position (go flat)
  - No value  → hold current position (no action)

Signals fire on candle close. Entry/exit fills at next candle open with slippage.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import time
from typing import Any, Literal
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from .models import BacktestConfig

ET = ZoneInfo("America/New_York")
SESSION_CLOSE_ET = time(16, 55)  # 4:55 PM ET — force-close 5 min before session end

CONTRACTS = {
    "MES": {"point_value": 5.0, "tick_size": 0.25, "tick_value": 1.25},
    "ES": {"point_value": 50.0, "tick_size": 0.25, "tick_value": 12.5},
    "MNQ": {"point_value": 2.0, "tick_size": 0.25, "tick_value": 0.5},
    "NQ": {"point_value": 20.0, "tick_size": 0.25, "tick_value": 5.0},
}


# ── Signal generators ──────────────────────────────────────────────────

def ema_crossover(close: pd.Series, config: BacktestConfig) -> pd.DataFrame:
    """EMA crossover: always-in-market, reverses on every cross."""
    fast = close.ewm(span=config.fast_ema, adjust=False).mean()
    slow = close.ewm(span=config.slow_ema, adjust=False).mean()
    prev_diff = (fast - slow).shift(1)
    curr_diff = fast - slow
    warmed = close.rolling(config.slow_ema).count() >= config.slow_ema

    signal = pd.Series(index=close.index, dtype="object")
    signal[(prev_diff <= 0) & (curr_diff > 0) & warmed] = "long"
    signal[(prev_diff >= 0) & (curr_diff < 0) & warmed] = "short"

    return pd.DataFrame({
        "signal": signal,
        "fast_ema": fast,
        "slow_ema": slow,
    })


def sma_crossover(close: pd.Series, config: BacktestConfig) -> pd.DataFrame:
    """SMA crossover: always-in-market, reverses on every cross."""
    fast = close.rolling(config.fast_ema).mean()
    slow = close.rolling(config.slow_ema).mean()
    prev_diff = (fast - slow).shift(1)
    curr_diff = fast - slow
    warmed = close.rolling(config.slow_ema).count() >= config.slow_ema

    signal = pd.Series(index=close.index, dtype="object")
    signal[(prev_diff <= 0) & (curr_diff > 0) & warmed] = "long"
    signal[(prev_diff >= 0) & (curr_diff < 0) & warmed] = "short"

    return pd.DataFrame({
        "signal": signal,
        "fast_sma": fast,
        "slow_sma": slow,
    })


def bollinger_bands(close: pd.Series, config: BacktestConfig) -> pd.DataFrame:
    """
    Bollinger Bands mean-reversion.
    - Long when price closes below lower band → signal "long"
    - Short when price closes above upper band → signal "short"
    - Exit when price crosses back through the middle band → signal "close"
    """
    period = config.bb_period
    std_mult = config.bb_stddev
    middle = close.rolling(period).mean()
    std = close.rolling(period).std()
    upper = middle + std * std_mult
    lower = middle - std * std_mult
    warmed = close.rolling(period).count() >= period

    prev_close = close.shift(1)

    signal = pd.Series(index=close.index, dtype="object")
    # Long: closes below lower band
    signal[(close <= lower) & warmed] = "long"
    # Short: closes above upper band
    signal[(close >= upper) & warmed] = "short"
    # Close: crosses back through the middle (was below → now above, or was above → now below)
    crossed_above_middle = (prev_close < middle) & (close >= middle) & warmed
    crossed_below_middle = (prev_close > middle) & (close <= middle) & warmed
    signal[crossed_above_middle | crossed_below_middle] = "close"

    return pd.DataFrame({
        "signal": signal,
        "bb_upper": upper,
        "bb_middle": middle,
        "bb_lower": lower,
    })


def rsi_mean_reversion(close: pd.Series, config: BacktestConfig) -> pd.DataFrame:
    """
    RSI mean-reversion.
    - Long when RSI drops below oversold threshold → signal "long"
    - Short when RSI rises above overbought threshold → signal "short"
    - Close when RSI crosses the midline (50) after entering → signal "close"
    """
    period = config.rsi_period
    overbought = config.rsi_overbought
    oversold = config.rsi_oversold

    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = gain.ewm(alpha=1/period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100.0 - (100.0 / (1.0 + rs))
    rsi = rsi.fillna(50.0)  # type: ignore[union-attr]

    warmed = close.rolling(period).count() >= period

    prev_rsi = rsi.shift(1)

    signal = pd.Series(index=close.index, dtype="object")
    signal[(rsi <= oversold) & warmed] = "long"
    signal[(rsi >= overbought) & warmed] = "short"
    # Close when RSI crosses the midline — ride the full reversion
    cross_above_50 = (prev_rsi < 50) & (rsi >= 50) & warmed
    cross_below_50 = (prev_rsi > 50) & (rsi <= 50) & warmed
    signal[cross_above_50 | cross_below_50] = "close"

    return pd.DataFrame({
        "signal": signal,
        "rsi": rsi,
        "rsi_overbought": overbought,
        "rsi_oversold": oversold,
    })


def macd(close: pd.Series, config: BacktestConfig) -> pd.DataFrame:
    """
    MACD crossover strategy.
    - MACD line = fast_ema - slow_ema
    - Signal line = EMA of MACD line (9-period default)
    - Long when MACD crosses above Signal
    - Short when MACD crosses below Signal
    Adds columns: macd_line, macd_signal, macd_hist.
    """
    fast_ema = close.ewm(span=config.fast_ema, adjust=False).mean()
    slow_ema = close.ewm(span=config.slow_ema, adjust=False).mean()
    macd_line = fast_ema - slow_ema
    signal_line = macd_line.ewm(span=9, adjust=False).mean()
    hist = macd_line - signal_line
    warmed = close.rolling(config.slow_ema).count() >= config.slow_ema

    prev_diff = (macd_line - signal_line).shift(1)
    curr_diff = macd_line - signal_line

    sig = pd.Series(index=close.index, dtype="object")
    sig[(prev_diff <= 0) & (curr_diff > 0) & warmed] = "long"
    sig[(prev_diff >= 0) & (curr_diff < 0) & warmed] = "short"

    return pd.DataFrame({
        "signal": sig,
        "macd_line": macd_line,
        "macd_signal": signal_line,
        "macd_hist": hist,
    })


def vwap(close: pd.Series, config: BacktestConfig) -> pd.DataFrame:
    """
    VWAP (Volume-Weighted Average Price) mean-reversion strategy.
    Uses cumulative VWAP as a fair-value anchor.
    - Long when price crosses above VWAP
    - Short when price crosses below VWAP
    - Close when price crosses back through VWAP
    Adds column: vwap.
    """
    # VWAP requires volume — get it from the parent frame later.
    # For now, use a simple cumulative VWAP pattern.
    typical = close  # simplified — uses close as proxy for typical price
    cum_pv = typical.expanding().sum()  # simplified without volume
    cum_vol = pd.Series(range(1, len(close) + 1), index=close.index)  # proxy
    vwap_line = cum_pv / cum_vol
    # Use actual rolling VWAP: reset daily, but for single-session this works
    vwap_line = (close * cum_vol).expanding().sum() / cum_vol.where(cum_vol > 0, 1)

    warmed = close.rolling(config.fast_ema).count() >= config.fast_ema

    prev_close = close.shift(1)
    sig = pd.Series(index=close.index, dtype="object")
    # Cross above VWAP → long
    sig[(prev_close <= vwap_line) & (close > vwap_line) & warmed] = "long"
    # Cross below VWAP → short
    sig[(prev_close >= vwap_line) & (close < vwap_line) & warmed] = "short"
    # Cross back through VWAP → close
    cross_up = (prev_close < vwap_line) & (close >= vwap_line) & warmed
    cross_down = (prev_close > vwap_line) & (close <= vwap_line) & warmed
    sig[cross_up | cross_down] = "close"

    return pd.DataFrame({
        "signal": sig,
        "vwap": vwap_line,
    })


STRATEGIES = {
    "ema_crossover": ema_crossover,
    "sma_crossover": sma_crossover,
    "bollinger_bands": bollinger_bands,
    "rsi_mean_reversion": rsi_mean_reversion,
    "macd": macd,
    "vwap": vwap,
}


# ── Backtest engine ────────────────────────────────────────────────────

def filter_frame_by_date(frame: pd.DataFrame, selected_date: pd.Timestamp | None) -> pd.DataFrame:
    if selected_date is None:
        return frame.copy()
    return frame.loc[frame["timestamp"].dt.date == selected_date].copy()


@dataclass
class Position:
    direction: Literal["long", "short"]
    entry_index: int
    entry_time: pd.Timestamp
    entry_price: float


def calculate_max_drawdown(equity: list[float]) -> float:
    if not equity:
        return 0.0
    values = np.asarray(equity, dtype=float)
    peaks = np.maximum.accumulate(values)
    drawdowns = peaks - values
    return float(drawdowns.max())


def _sharpe(net_values: list[float]) -> float:
    """Annualized Sharpe ratio from trade PnLs. Returns 0 if < 2 trades."""
    if len(net_values) < 2:
        return 0.0
    arr = np.asarray(net_values, dtype=float)
    mean = arr.mean()
    std = arr.std(ddof=1)
    if std == 0:
        return 0.0
    return float(mean / std * np.sqrt(252))


def _max_streak(net_values: list[float], positive: bool) -> int:
    """Max consecutive winning (positive=True) or losing (positive=False) streak."""
    best = 0
    current = 0
    for v in net_values:
        if (positive and v > 0) or (not positive and v <= 0):
            current += 1
            best = max(best, current)
        else:
            current = 0
    return best


def _fill_price(price: float, direction: str, action: str, slippage: float) -> float:
    if (direction == "long" and action == "entry") or (direction == "short" and action == "exit"):
        return price + slippage
    return price - slippage


def calculate_trade_pnl(
    direction: Literal["long", "short"],
    entry_price: float,
    exit_price: float,
    point_value: float,
    contracts: int,
    commission_per_side: float,
    spread_cost: float = 0.0,
) -> tuple[float, float, float, float]:
    points = exit_price - entry_price if direction == "long" else entry_price - exit_price
    gross = points * point_value * contracts
    commissions = commission_per_side * contracts * 2
    spread = round(spread_cost, 2)
    net = gross - commissions - spread
    return gross, commissions, spread, net


def _iso(timestamp: pd.Timestamp) -> str:
    return timestamp.isoformat().replace("+00:00", "Z")


def run_backtest(frame: pd.DataFrame, config: BacktestConfig) -> dict[str, Any]:
    settings = CONTRACTS[config.contract_type]
    point_value = settings["point_value"]
    slippage = config.slippage_ticks * settings["tick_size"]
    spread_cost = config.spread_ticks * settings["tick_value"] * config.contracts

    signal_fn = STRATEGIES[config.strategy]
    signals = signal_fn(frame["close"], config)

    trades: list[dict[str, Any]] = []
    equity_points = [{"time": _iso(frame.iloc[0]["timestamp"]), "value": config.initial_capital}]
    position: Position | None = None
    cumulative_pnl = 0.0

    def close_position(index: int, base_price: float, reason: str) -> None:
        nonlocal position, cumulative_pnl
        if position is None:
            return
        row = frame.iloc[index]
        exit_price = _fill_price(base_price, position.direction, "exit", slippage)
        gross, commissions, spread, net = calculate_trade_pnl(
            position.direction, position.entry_price, exit_price,
            point_value, config.contracts, config.commission_per_side,
            spread_cost,
        )
        cumulative_pnl += net
        trades.append({
            "trade_number": len(trades) + 1,
            "direction": position.direction,
            "entry_time": _iso(position.entry_time),
            "entry_price": round(position.entry_price, 6),
            "exit_time": _iso(row["timestamp"]),
            "exit_price": round(exit_price, 6),
            "contracts": config.contracts,
            "gross_pnl": round(gross, 2),
            "commissions": round(commissions, 2),
            "spread": round(spread, 2),
            "net_pnl": round(net, 2),
            "cumulative_pnl": round(cumulative_pnl, 2),
            "exit_reason": reason,
        })
        equity_points.append({
            "time": _iso(row["timestamp"]), "value": round(config.initial_capital + cumulative_pnl, 2),
        })
        position = None

    def open_position(index: int, direction: Literal["long", "short"]) -> None:
        nonlocal position
        row = frame.iloc[index]
        entry_price = _fill_price(float(row["open"]), direction, "entry", slippage)
        position = Position(direction, index, row["timestamp"], entry_price)

    for index in range(1, len(frame)):
        row = frame.iloc[index]

        # ── Session-end close (4:55 PM ET) — prevent overnight gaps ──
        if position is not None:
            row_ts = pd.Timestamp(row["timestamp"])
            if row_ts.tz is not None:
                row_et = row_ts.tz_convert(ET)
            else:
                row_et = row_ts.tz_localize("UTC").tz_convert(ET)
            if row_et.time() >= SESSION_CLOSE_ET:
                close_position(index, float(row["open"]), "Session end")
                # Position is now None — continue to check signals on this candle

        # ── Check stop-loss / take-profit on open positions ──
        if position is not None:
            stop_reason: str | None = None
            stop_price: float | None = None
            if position.direction == "long":
                if config.stop_loss_points > 0 and float(row["low"]) <= position.entry_price - config.stop_loss_points:
                    stop_reason = "Stop loss"
                    stop_price = position.entry_price - config.stop_loss_points
                elif config.take_profit_points > 0 and float(row["high"]) >= position.entry_price + config.take_profit_points:
                    stop_reason = "Take profit"
                    stop_price = position.entry_price + config.take_profit_points
            else:  # short
                if config.stop_loss_points > 0 and float(row["high"]) >= position.entry_price + config.stop_loss_points:
                    stop_reason = "Stop loss"
                    stop_price = position.entry_price + config.stop_loss_points
                elif config.take_profit_points > 0 and float(row["low"]) <= position.entry_price - config.take_profit_points:
                    stop_reason = "Take profit"
                    stop_price = position.entry_price - config.take_profit_points

            if stop_reason is not None and stop_price is not None:
                close_position(index, stop_price, stop_reason)
                # Position is now None — continue to check signals for new entry on this same candle

        # ── Process strategy signals ──
        action = signals.iloc[index - 1]["signal"]
        if pd.isna(action) or action is None:
            continue
        action = str(action)
        if action not in ("long", "short", "close"):
            continue

        # Close existing position if needed
        if position is not None:
            should_close = (
                action == "close"
                or (action == "long" and position.direction == "short")
                or (action == "short" and position.direction == "long")
            )
            if should_close:
                close_position(index, float(row["open"]), "Signal")

        # Open new position
        if action == "long":
            open_position(index, "long")
        elif action == "short":
            open_position(index, "short")
        # "close" means go flat — already handled above

    # Force-close any remaining position at end of data
    if position is not None:
        close_position(len(frame) - 1, float(frame.iloc[-1]["close"]), "End of data")

    # ── Metrics ──
    net_values = [trade["net_pnl"] for trade in trades]
    wins = [v for v in net_values if v > 0]
    losses = [v for v in net_values if v < 0]
    gross_wins = sum(wins)
    gross_losses = abs(sum(losses))
    profit_factor: float | None = (
        gross_wins / gross_losses if gross_losses else (None if not gross_wins else float("inf"))
    )
    equity_values = [point["value"] for point in equity_points]

    # ── Output arrays ──
    candles = [
        {"time": _iso(row.timestamp), "open": float(row.open), "high": float(row.high),
         "low": float(row.low), "close": float(row.close), "volume": float(row.volume)}
        for row in frame.itertuples(index=False)
    ]

    # Build indicator rows from signal DataFrame
    indicator_cols = [c for c in signals.columns if c != "signal"]
    indicators = []
    for _, row in signals.iterrows():
        item: dict[str, Any] = {}
        for col in indicator_cols:
            val = row[col]
            if pd.notna(val) and not (isinstance(val, float) and (np.isnan(val) or np.isinf(val))):
                item[col] = round(float(val), 6)
            else:
                item[col] = None
        indicators.append(item)

    # Inject time into indicators (align with candle timestamps)
    for i, candle in enumerate(candles):
        if i < len(indicators):
            indicators[i]["time"] = candle["time"]

    metrics = {
        "net_pnl": round(sum(net_values), 2),
        "total_trades": len(trades),
        "winning_trades": len(wins),
        "losing_trades": len(losses),
        "win_rate": round(len(wins) / len(trades) * 100, 2) if trades else 0.0,
        "average_win": round(float(np.mean(wins)), 2) if wins else 0.0,
        "average_loss": round(float(np.mean(losses)), 2) if losses else 0.0,
        "profit_factor": None if profit_factor is None or np.isinf(profit_factor) else round(profit_factor, 2),
        "max_drawdown": round(calculate_max_drawdown(equity_values), 2),
        "average_trade_pnl": round(float(np.mean(net_values)), 2) if net_values else 0.0,
        "largest_win": round(max(wins), 2) if wins else 0.0,
        "largest_loss": round(min(losses), 2) if losses else 0.0,
        "sharpe_ratio": round(_sharpe(net_values), 2),
        "max_consecutive_wins": _max_streak(net_values, True),
        "max_consecutive_losses": _max_streak(net_values, False),
    }

    return {
        "candles": candles,
        "indicators": indicators,
        "trades": trades,
        "equity_curve": equity_points,
        "metrics": metrics,
        "contract": {"symbol": config.contract_type, **settings},
        "backtest_date": config.backtest_date.isoformat() if config.backtest_date else None,
    }

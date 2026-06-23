from datetime import date

import pandas as pd
import pytest

from app.backtest import calculate_max_drawdown, calculate_trade_pnl, ema_crossover, filter_frame_by_date
from app.models import BacktestConfig


def test_long_and_short_pnl_include_round_trip_commission() -> None:
    long_result = calculate_trade_pnl("long", 5000, 5002, 5, 2, 0.62)
    short_result = calculate_trade_pnl("short", 5002, 5000, 5, 2, 0.62)
    assert long_result == pytest.approx((20, 2.48, 0, 17.52))
    assert short_result == pytest.approx((20, 2.48, 0, 17.52))


def test_max_drawdown_uses_peak_to_trough_dollars() -> None:
    assert calculate_max_drawdown([10_000, 10_500, 10_200, 10_800, 9_900, 10_100]) == 900
    assert calculate_max_drawdown([]) == 0


def test_ema_crossover_detection_finds_both_directions() -> None:
    close = pd.Series([10, 9, 8, 9, 11, 13, 12, 10, 8], dtype=float)
    signals = ema_crossover(close, BacktestConfig(fast_ema=2, slow_ema=4))
    assert signals["signal"].eq("long").sum() == 1
    assert signals["signal"].eq("short").sum() == 1
    assert signals.index[signals["signal"].eq("long")].tolist() == [4]
    assert signals.index[signals["signal"].eq("short")].tolist() == [7]


def test_filter_frame_by_date_uses_utc_calendar_day() -> None:
    frame = pd.DataFrame(
        {
            "timestamp": pd.to_datetime(
                ["2025-01-06T23:55:00Z", "2025-01-07T00:00:00Z", "2025-01-07T09:30:00Z"],
                utc=True,
            ),
            "close": [1, 2, 3],
        }
    )
    filtered = filter_frame_by_date(frame, date(2025, 1, 7))
    assert filtered["close"].tolist() == [2, 3]
    assert len(filter_frame_by_date(frame, None)) == 3

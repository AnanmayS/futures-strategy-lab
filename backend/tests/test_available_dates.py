import json

from app import live_backtest


def test_available_dates_uses_et_market_hours_from_cache(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(live_backtest, "CACHE_DIR", tmp_path)
    (tmp_path / "sample.json").write_text(
        json.dumps(
            {
                "metadata": {"contract": "MES", "interval": "5m"},
                "candles": [
                    {"time": "2026-06-17T12:25:00Z"},  # 8:25 AM ET, outside window
                    {"time": "2026-06-17T12:30:00Z"},  # 8:30 AM ET
                    {"time": "2026-06-17T13:00:00Z"},
                    {"time": "2026-06-17T21:00:00Z"},  # 5:00 PM ET
                    {"time": "2026-06-17T21:05:00Z"},  # outside window
                ],
            }
        )
    )

    result = live_backtest.list_available_backtest_dates("MES", "5m", min_candles=3)

    assert result["latest_date"] == "2026-06-17"
    assert result["dates"] == [
        {"date": "2026-06-17", "candle_count": 3, "cache_files": ["sample.json"]}
    ]


def test_available_dates_filters_by_contract_interval_and_minimum(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(live_backtest, "CACHE_DIR", tmp_path)
    (tmp_path / "mes-5m.json").write_text(
        json.dumps(
            {
                "metadata": {"contract": "MES", "interval": "5m"},
                "candles": [{"time": "2026-06-17T13:00:00Z"}],
            }
        )
    )
    (tmp_path / "mnq-5m.json").write_text(
        json.dumps(
            {
                "metadata": {"contract": "MNQ", "interval": "5m"},
                "candles": [{"time": "2026-06-18T13:00:00Z"}],
            }
        )
    )
    (tmp_path / "mes-1m.json").write_text(
        json.dumps(
            {
                "metadata": {"contract": "MES", "interval": "1m"},
                "candles": [{"time": "2026-06-19T13:00:00Z"}],
            }
        )
    )

    result = live_backtest.list_available_backtest_dates("MES", "5m", min_candles=2)

    assert result["latest_date"] is None
    assert result["dates"] == []

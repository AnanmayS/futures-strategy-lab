from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator

ContractType = Literal["MES", "MNQ", "ES", "NQ"]
StrategyType = Literal["ema_crossover", "sma_crossover", "bollinger_bands", "rsi_mean_reversion"]


class BacktestConfig(BaseModel):
    strategy: StrategyType = "ema_crossover"
    initial_capital: float = Field(default=25_000, gt=0)
    contract_type: ContractType = "MES"
    contracts: int = Field(default=1, ge=1)
    commission_per_side: float = Field(default=0.62, ge=0)
    slippage_ticks: float = Field(default=1, ge=0)
    spread_ticks: float = Field(default=1, ge=0)
    stop_loss_points: float = Field(default=0, ge=0, description="Stop-loss in points (0 = disabled)")
    take_profit_points: float = Field(default=0, ge=0, description="Take-profit in points (0 = disabled)")

    # EMA / SMA crossover params (fast/slow periods)
    fast_ema: int = Field(default=9, ge=1)
    slow_ema: int = Field(default=21, ge=2)

    # Bollinger Bands params
    bb_period: int = Field(default=20, ge=2)
    bb_stddev: float = Field(default=2.0, gt=0)

    # RSI params
    rsi_period: int = Field(default=14, ge=2)
    rsi_overbought: float = Field(default=70.0, gt=50, le=100)
    rsi_oversold: float = Field(default=30.0, ge=0, lt=50)

    backtest_date: date | None = None

    @model_validator(mode="after")
    def validate_crossover(self) -> "BacktestConfig":
        if self.strategy in ("ema_crossover", "sma_crossover"):
            if self.fast_ema >= self.slow_ema:
                raise ValueError("Fast period must be smaller than slow period")
        return self

    @model_validator(mode="after")
    def validate_rsi(self) -> "BacktestConfig":
        if self.strategy == "rsi_mean_reversion":
            if self.rsi_oversold >= self.rsi_overbought:
                raise ValueError("oversold threshold must be below overbought threshold")
        return self

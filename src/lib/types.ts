export type ContractType = "MES" | "MNQ" | "ES" | "NQ";
export type StrategyType = "ema_crossover" | "sma_crossover" | "bollinger_bands" | "rsi_mean_reversion";

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Indicator {
  time?: string;
  fast_ema?: number;
  slow_ema?: number;
  fast_sma?: number;
  slow_sma?: number;
  bb_upper?: number;
  bb_middle?: number;
  bb_lower?: number;
  rsi?: number;
  rsi_overbought?: number;
  rsi_oversold?: number;
}

export interface Trade {
  trade_number: number;
  direction: "long" | "short";
  entry_time: string;
  entry_price: number;
  exit_time: string;
  exit_price: number;
  contracts: number;
  gross_pnl: number;
  commissions: number;
  spread: number;
  net_pnl: number;
  cumulative_pnl: number;
  exit_reason: string;
}

export interface Metrics {
  net_pnl: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  average_win: number;
  average_loss: number;
  profit_factor: number | null;
  max_drawdown: number;
  average_trade_pnl: number;
  largest_win: number;
  largest_loss: number;
}

export interface BacktestResult {
  candles: Candle[];
  indicators: Indicator[];
  trades: Trade[];
  equity_curve: { time: string; value: number }[];
  metrics: Metrics;
  backtest_date: string | null;
  contract: {
    symbol: ContractType;
    point_value: number;
    tick_size: number;
    tick_value: number;
  };
  market_hours?: {
    open_et: string;
    close_et: string;
    total_candles_fetched: number;
    candles_in_window: number;
  };
  data_metadata?: {
    source: string;
    contract: ContractType;
    interval: string;
    fetch_start: string;
    fetch_end: string;
    cache_key: string;
  };
}

export interface MarketDataMeta {
  source: string;
  contract: string;
  interval: string;
  start_date: string | null;
  end_date: string | null;
  candle_count: number;
  cache_key: string;
}

export interface MarketDataResponse {
  candles: Candle[];
  metadata: MarketDataMeta;
}

export interface AvailableDate {
  date: string;
  candle_count: number;
  cache_files: string[];
}

export interface AvailableDatesResponse {
  contract: ContractType;
  interval: string;
  min_candles: number;
  latest_date: string | null;
  dates: AvailableDate[];
}

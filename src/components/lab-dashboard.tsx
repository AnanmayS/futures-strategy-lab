"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { BarChart3, Download, FlaskConical, LoaderCircle, Play, RotateCcw, Zap } from "lucide-react";
import { EquityChart } from "@/components/equity-chart";
import { MarketChart } from "@/components/market-chart";
import { MetricStrip } from "@/components/metric-strip";
import { TradeTable } from "@/components/trade-table";
import { SweepCharts } from "@/components/sweep-charts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { AvailableDatesResponse, BacktestResult, ContractType, Metrics, StrategyType } from "@/lib/types";
import { money } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const SETTINGS_KEY = "futures-strategy-lab.settings.v1";
const KNOWN_GOOD_DATE = "2026-06-22";

function today(): string { return new Date().toISOString().slice(0, 10); }

function formatSession(value?: string): string {
  if (!value) return "N/A";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(new Date(value));
}

function errorMessage(detail: unknown): string {
  if (typeof detail === "string") return detail;
  return "Request failed";
}

function sweepErrorLabel(error?: string): string {
  if (!error) return "";
  if (error.startsWith("No candles found in market hours window")) {
    return "Market holiday / unavailable";
  }
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStrategy(value: unknown): value is StrategyType {
  return typeof value === "string" && ALL_STRATEGIES.includes(value as StrategyType);
}

function isContract(value: unknown): value is ContractType {
  return value === "MES" || value === "MNQ" || value === "ES" || value === "NQ";
}

function isMetrics(value: unknown): value is Metrics {
  if (!isRecord(value)) return false;
  return [
    "net_pnl", "total_trades", "winning_trades", "losing_trades", "win_rate",
    "average_win", "average_loss", "max_drawdown", "average_trade_pnl",
    "largest_win", "largest_loss",
  ].every((key) => typeof value[key] === "number");
}

function isBacktestResult(value: unknown): value is BacktestResult {
  if (!isRecord(value)) return false;
  return Array.isArray(value.candles)
    && Array.isArray(value.indicators)
    && Array.isArray(value.trades)
    && Array.isArray(value.equity_curve)
    && isMetrics(value.metrics);
}

function isAvailableDatesResponse(value: unknown): value is AvailableDatesResponse {
  if (!isRecord(value)) return false;
  return isContract(value.contract)
    && typeof value.interval === "string"
    && (typeof value.latest_date === "string" || value.latest_date === null)
    && Array.isArray(value.dates)
    && value.dates.every((item) => isRecord(item) && typeof item.date === "string" && typeof item.candle_count === "number");
}

function isSweepRows(value: unknown): value is SweepRow[] {
  return Array.isArray(value)
    && value.every((row) => isRecord(row) && typeof row.date === "string" && typeof row.strategy === "string" && (row.metrics === undefined || isMetrics(row.metrics)));
}

type PersistedSettings = {
  contract: ContractType;
  strategy: StrategyType;
  sweepStrats: StrategyType[];
  interval: string;
  fastPeriod: number;
  slowPeriod: number;
  bbPeriod: number;
  bbStddev: number;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
  initialCapital: number;
  contracts: number;
  commission: number;
  slippage: number;
  spread: number;
  stopLoss: number;
  takeProfit: number;
  windowStart: string;
  windowEnd: string;
};

function readStoredSettings(): Partial<PersistedSettings> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function csvValue(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function NumericField({ id, label, value, step = 1, min = 0, max, onChange }: { id: string; label: string; value: number; step?: number; min?: number; max?: number; onChange: (v: number) => void }) {
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} min={min} max={max} onChange={(e) => onChange(Number(e.target.value))} step={step} type="number" value={value} /></div>;
}

const STRATEGY_LABELS: Record<StrategyType, string> = { ema_crossover: "EMA crossover", sma_crossover: "SMA crossover", bollinger_bands: "Bollinger Bands", rsi_mean_reversion: "RSI mean-reversion", macd: "MACD crossover", vwap: "VWAP mean-reversion" };
const ALL_STRATEGIES: StrategyType[] = ["ema_crossover", "sma_crossover", "bollinger_bands", "rsi_mean_reversion", "macd", "vwap"];

type SweepRow = { date: string; strategy: string; interval?: string; metrics?: Metrics; error?: string };
export type StrategySweepGroup = {
  strategy: string;
  interval?: string;
  label: string;
  rows: SweepRow[];
  totalNetPnl: number;
  tradingDays: number;
  errorDays: number;
  totalTrades: number;
  weightedWinRate: number;
  averageDailyPnl: number;
  maxDrawdown: number;
  bestDay: SweepRow | null;
  worstDay: SweepRow | null;
};
type DateLoadState = {
  key: string;
  data: AvailableDatesResponse | null;
  notice: string | null;
};

export function LabDashboard() {
  const [storedSettings] = useState(() => readStoredSettings());
  const [mode, setMode] = useState<"single" | "sweep">("single");
  const [date, setDate] = useState(today());
  const [startDate, setStartDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 5); return d.toISOString().slice(0, 10); });
  const [endDate, setEndDate] = useState(today());
  const [contract, setContract] = useState<ContractType>(() => isContract(storedSettings.contract) ? storedSettings.contract : "MES");
  const [strategy, setStrategy] = useState<StrategyType>(() => isStrategy(storedSettings.strategy) ? storedSettings.strategy : "ema_crossover");
  const [sweepStrats, setSweepStrats] = useState<StrategyType[]>(() => storedSettings.sweepStrats?.filter(isStrategy).length ? storedSettings.sweepStrats.filter(isStrategy) : ["ema_crossover"]);
  const [interval, setInterval] = useState(() => storedSettings.interval ?? "5m");
  const [fastPeriod, setFastPeriod] = useState(() => storedSettings.fastPeriod ?? 9);
  const [slowPeriod, setSlowPeriod] = useState(() => storedSettings.slowPeriod ?? 21);
  const [bbPeriod, setBbPeriod] = useState(() => storedSettings.bbPeriod ?? 20);
  const [bbStddev, setBbStddev] = useState(() => storedSettings.bbStddev ?? 2.0);
  const [rsiPeriod, setRsiPeriod] = useState(() => storedSettings.rsiPeriod ?? 14);
  const [rsiOverbought, setRsiOverbought] = useState(() => storedSettings.rsiOverbought ?? 70);
  const [rsiOversold, setRsiOversold] = useState(() => storedSettings.rsiOversold ?? 30);
  const [initialCapital, setInitialCapital] = useState(() => storedSettings.initialCapital ?? 25000);
  const [contracts, setContracts] = useState(() => storedSettings.contracts ?? 1);
  const [commission, setCommission] = useState(() => storedSettings.commission ?? 0.62);
  const [slippage, setSlippage] = useState(() => storedSettings.slippage ?? 1);
  const [spread, setSpread] = useState(() => storedSettings.spread ?? 1);
  const [stopLoss, setStopLoss] = useState(() => storedSettings.stopLoss ?? 0);
  const [compareIntervals, setCompareIntervals] = useState(false);
  const [takeProfit, setTakeProfit] = useState(() => storedSettings.takeProfit ?? 0);
  const [windowStart, setWindowStart] = useState(() => storedSettings.windowStart ?? "");
  const [windowEnd, setWindowEnd] = useState(() => storedSettings.windowEnd ?? "");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [sweepResults, setSweepResults] = useState<SweepRow[] | null>(null);
  const [sweepSort, setSweepSort] = useState<{ key: "date" | "strategy" | keyof Metrics; direction: "asc" | "desc" }>({ key: "net_pnl", direction: "desc" });
  const [dateLoad, setDateLoad] = useState<DateLoadState>({ key: "", data: null, notice: null });
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const dateRef = useRef(date);

  useEffect(() => {
    dateRef.current = date;
  }, [date]);

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      contract, strategy, sweepStrats, interval, fastPeriod, slowPeriod, bbPeriod, bbStddev,
      rsiPeriod, rsiOverbought, rsiOversold, initialCapital, contracts, commission,
      slippage, spread, stopLoss, takeProfit,
    } satisfies PersistedSettings));
  }, [bbPeriod, bbStddev, commission, contract, contracts, fastPeriod, initialCapital, interval, rsiOverbought, rsiOversold, rsiPeriod, slowPeriod, slippage, spread, stopLoss, strategy, sweepStrats, takeProfit, windowStart, windowEnd]);

  useEffect(() => {
    const controller = new AbortController();
    const key = `${contract}:${interval}`;

    async function loadAvailableDates() {
      try {
        const params = new URLSearchParams({ contract, interval, refresh: "true" });
        const resp = await fetch(`${API_URL}/api/available-dates?${params.toString()}`, {
          signal: controller.signal,
        });
        const payload = await resp.json();
        if (!resp.ok) throw new Error(errorMessage(payload.detail));

        if (!isAvailableDatesResponse(payload)) throw new Error("Available dates response was not recognized");
        const parsed = payload;
        let notice: string | null = null;
        if (parsed.latest_date && !parsed.dates.some((item) => item.date === dateRef.current)) {
          setDate(parsed.latest_date);
          setEndDate(parsed.latest_date);
          const start = new Date(`${parsed.latest_date}T00:00:00`);
          start.setDate(start.getDate() - 5);
          setStartDate(start.toISOString().slice(0, 10));
          notice = `Using latest cached session: ${parsed.latest_date}`;
        } else if (!parsed.latest_date) {
          notice = `No cached ${contract} ${interval} sessions are available yet.`;
        }
        setDateLoad({ key, data: parsed, notice });
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setDateLoad({
          key,
          data: null,
          notice: caught instanceof Error ? caught.message : "Could not load available dates",
        });
      }
    }

    loadAvailableDates();
    return () => controller.abort();
  }, [contract, interval]);

  const commonParams = () => ({
    contract, interval,
    fast_ema: String(fastPeriod), slow_ema: String(slowPeriod),
    bb_period: String(bbPeriod), bb_stddev: String(bbStddev),
    rsi_period: String(rsiPeriod), rsi_overbought: String(rsiOverbought), rsi_oversold: String(rsiOversold),
    initial_capital: String(initialCapital), contracts: String(contracts),
    commission_per_side: String(commission), slippage_ticks: String(slippage),
    spread_ticks: String(spread), stop_loss_points: String(stopLoss), take_profit_points: String(takeProfit),
    ...(windowStart ? { window_start: windowStart } : {}),
    ...(windowEnd ? { window_end: windowEnd } : {}),
  });

  async function runSingle() {
    setError(null); setResult(null); setIsRunning(true);
    try {
      const p = new URLSearchParams({ date, strategy, ...commonParams() });
      const resp = await fetch(`${API_URL}/api/backtest-live?${p.toString()}`);
      const payload = await resp.json();
      if (!resp.ok) throw new Error(errorMessage(payload.detail));
      if (!isBacktestResult(payload)) throw new Error("Backtest response was not recognized");
      setResult(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Backend unreachable");
    } finally { setIsRunning(false); }
  }

  async function runSweep() {
    setError(null); setSweepResults(null); setIsRunning(true);
    try {
      const intervals = compareIntervals ? ["1m", "5m"] : [interval];
      let allRows: SweepRow[] = [];
      for (const intv of intervals) {
        const p = new URLSearchParams({ start_date: startDate, end_date: endDate, strategies: sweepStrats.join(","), ...commonParams(), interval: intv });
        const resp = await fetch(`${API_URL}/api/sweep?${p.toString()}`);
        const payload = await resp.json();
        if (!resp.ok) throw new Error(errorMessage(payload.detail));
        if (!isSweepRows(payload)) throw new Error("Sweep response was not recognized");
        allRows = allRows.concat(payload.map((r: SweepRow) => ({ ...r, interval: intv })));
      }
      setSweepResults(allRows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Backend unreachable");
    } finally { setIsRunning(false); }
  }

  function toggleSweepStrat(s: StrategyType) {
    setSweepStrats((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  }

  function useKnownGoodRun() {
    setMode("single");
    setContract("MES");
    setInterval("5m");
    setStrategy("ema_crossover");
    setFastPeriod(9);
    setSlowPeriod(21);
    setDate(availableDates?.latest_date ?? KNOWN_GOOD_DATE);
  }

  function changeSweepSort(key: typeof sweepSort.key) {
    setSweepSort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  }

  function exportSweepCsv() {
    if (!sweepResults?.length) return;
    const lines: Array<Array<string | number | null | undefined>> = [
      ["Strategy summary"],
      ["Strategy", "Trading days", "Error days", "Total Net PnL", "Avg Daily PnL", "Trades", "Weighted Win %", "Max DD", "Best Day", "Worst Day"],
      ...strategyGroups.map((group) => [
        group.label,
        group.tradingDays,
        group.errorDays,
        group.totalNetPnl,
        group.averageDailyPnl,
        group.totalTrades,
        group.weightedWinRate,
        group.maxDrawdown,
        group.bestDay ? `${group.bestDay.date} (${money(group.bestDay.metrics?.net_pnl ?? 0)})` : "",
        group.worstDay ? `${group.worstDay.date} (${money(group.worstDay.metrics?.net_pnl ?? 0)})` : "",
      ]),
      [],
      ["Daily results"],
    ];

    for (const group of strategyGroups) {
      lines.push([], [group.label], ["Date", "Trades", "Win %", "Net PnL", "Profit Factor", "Max DD", "Average Trade", "Error"]);
      for (const row of group.rows) {
        lines.push([
          row.date,
          row.metrics?.total_trades,
          row.metrics?.win_rate,
          row.metrics?.net_pnl,
          row.metrics?.profit_factor ?? "",
          row.metrics?.max_drawdown,
          row.metrics?.average_trade_pnl,
          sweepErrorLabel(row.error),
        ]);
      }
    }

    const csv = lines.map((row) => row.map(csvValue).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `futures-sweep-${startDate}-to-${endDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const availableDates = dateLoad.data;
  const isLoadingDates = dateLoad.key !== `${contract}:${interval}`;
  const dateNotice = dateLoad.notice;
  const selectedDateInfo = availableDates?.dates.find((item) => item.date === date);
  const selectedDateHasData = Boolean(selectedDateInfo);
  const sessionSummary = result?.market_hours
    ? `${formatSession(result.market_hours.open_et)} to ${formatSession(result.market_hours.close_et)}`
    : null;
  const dataSummary = result?.data_metadata
    ? `${result.data_metadata.source} · ${result.data_metadata.fetch_start} to ${result.data_metadata.fetch_end}`
    : null;
  const strategyGroups: StrategySweepGroup[] = Object.values(
    (sweepResults ?? []).reduce<Record<string, SweepRow[]>>((groups, row) => {
      const key = row.interval ? `${row.strategy}@${row.interval}` : row.strategy;
      groups[key] = [...(groups[key] ?? []), row];
      return groups;
    }, {}),
  ).map((rows) => {
    const sortedRows = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const metricRows = sortedRows.filter((row) => row.metrics);
    const totalNetPnl = metricRows.reduce((sum, row) => sum + (row.metrics?.net_pnl ?? 0), 0);
    const totalTrades = metricRows.reduce((sum, row) => sum + (row.metrics?.total_trades ?? 0), 0);
    const winningTrades = metricRows.reduce((sum, row) => sum + (row.metrics?.winning_trades ?? 0), 0);
    const maxDrawdown = metricRows.reduce((max, row) => Math.max(max, row.metrics?.max_drawdown ?? 0), 0);
    const byPnl = [...metricRows].sort((a, b) => (a.metrics?.net_pnl ?? 0) - (b.metrics?.net_pnl ?? 0));
    const strategyKey = sortedRows[0]?.strategy ?? "";
    const intv = sortedRows[0]?.interval;
    return {
      strategy: strategyKey,
      interval: intv,
      label: (STRATEGY_LABELS[strategyKey as StrategyType] ?? strategyKey) + (intv ? ` ${intv}` : ""),
      rows: sortedRows,
      totalNetPnl,
      tradingDays: metricRows.length,
      errorDays: sortedRows.length - metricRows.length,
      totalTrades,
      weightedWinRate: totalTrades ? (winningTrades / totalTrades) * 100 : 0,
      averageDailyPnl: metricRows.length ? totalNetPnl / metricRows.length : 0,
      maxDrawdown,
      bestDay: byPnl.at(-1) ?? null,
      worstDay: byPnl[0] ?? null,
    };
  }).sort((a, b) => {
    if (sweepSort.key === "strategy") {
      return sweepSort.direction === "asc" ? a.label.localeCompare(b.label) : b.label.localeCompare(a.label);
    }
    if (sweepSort.key === "date") {
      const aDate = a.rows[0]?.date ?? "";
      const bDate = b.rows[0]?.date ?? "";
      return sweepSort.direction === "asc" ? aDate.localeCompare(bDate) : bDate.localeCompare(aDate);
    }
    const aValue = sweepSort.key === "net_pnl" ? a.totalNetPnl
      : sweepSort.key === "total_trades" ? a.totalTrades
        : sweepSort.key === "win_rate" ? a.weightedWinRate
          : sweepSort.key === "max_drawdown" ? a.maxDrawdown
            : sweepSort.key === "average_trade_pnl" ? a.averageDailyPnl
              : sweepSort.key === "profit_factor" ? a.bestDay?.metrics?.net_pnl ?? Number.NEGATIVE_INFINITY
              : a.totalNetPnl;
    const bValue = sweepSort.key === "net_pnl" ? b.totalNetPnl
      : sweepSort.key === "total_trades" ? b.totalTrades
        : sweepSort.key === "win_rate" ? b.weightedWinRate
          : sweepSort.key === "max_drawdown" ? b.maxDrawdown
            : sweepSort.key === "average_trade_pnl" ? b.averageDailyPnl
              : sweepSort.key === "profit_factor" ? b.bestDay?.metrics?.net_pnl ?? Number.NEGATIVE_INFINITY
              : b.totalNetPnl;
    return sweepSort.direction === "asc" ? aValue - bValue : bValue - aValue;
  });
  const bestStrategyPnl = strategyGroups.length ? Math.max(...strategyGroups.map((group) => group.totalNetPnl)) : null;

  return (
    <div className="min-h-screen bg-background text-foreground" suppressHydrationWarning>
      <header className="border-b border-border bg-background/95">
        <div className="mx-auto flex h-16 max-w-[1720px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground"><FlaskConical className="size-4.5" aria-hidden="true" /></span>
            <div><h1 className="text-sm font-semibold tracking-tight sm:text-base">Futures Strategy Lab</h1><p className="hidden text-xs text-muted-foreground sm:block">Backtest. Compare. Find edges.</p></div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">Live</span>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1720px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside>
          <Card className="sticky top-5 overflow-hidden">
            <div className="border-b border-border px-4 py-4">
              <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{mode === "single" ? "Single run" : "Sweep"}</h2>
                <div className="flex rounded-md border border-border text-[11px]">
                  <button className={`px-2 py-1 ${mode === "single" ? "bg-muted font-medium" : ""}`} onClick={() => setMode("single")}>Single</button>
                  <button className={`px-2 py-1 ${mode === "sweep" ? "bg-muted font-medium" : ""}`} onClick={() => setMode("sweep")}>Sweep</button>
                </div>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{contract} {interval} · 8:30 AM–5:00 PM ET</p>
            </div>
            <div className="space-y-4 p-4">

              {mode === "single" ? (
                <>
                  <div className="space-y-1.5"><Label htmlFor="live-date">Date</Label><Input id="live-date" max={today()} onChange={(e) => setDate(e.target.value)} type="date" value={date} /></div>
                  {(dateNotice || selectedDateInfo || isLoadingDates) && (
                    <p className="rounded-md border border-border bg-muted/35 px-3 py-2 text-xs leading-5 text-muted-foreground">
                      {isLoadingDates ? "Checking cached sessions..." : selectedDateInfo ? `${selectedDateInfo.candle_count} cached market-hours candles available.` : dateNotice}
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5"><Label htmlFor="live-contract">Contract</Label><Select id="live-contract" onChange={(e) => setContract(e.target.value as ContractType)} value={contract}>{(["MES","MNQ","ES","NQ"] as ContractType[]).map((s) => <option key={s} value={s}>{s}</option>)}</Select></div>
                    <div className="space-y-1.5"><Label htmlFor="live-interval">Interval</Label><Select id="live-interval" onChange={(e) => setInterval(e.target.value)} value={interval}><option value="1m">1m</option><option value="5m">5m</option></Select></div>
                  </div>
                  <div className="space-y-1.5"><Label htmlFor="live-strategy">Strategy</Label><Select id="live-strategy" onChange={(e) => setStrategy(e.target.value as StrategyType)} value={strategy}>{(Object.entries(STRATEGY_LABELS) as [StrategyType, string][]).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
                  {(strategy === "ema_crossover" || strategy === "sma_crossover") && <div className="grid grid-cols-2 gap-3"><NumericField id="fp" label={strategy === "ema_crossover" ? "Fast EMA" : "Fast SMA"} min={1} onChange={setFastPeriod} value={fastPeriod} /><NumericField id="sp" label={strategy === "ema_crossover" ? "Slow EMA" : "Slow SMA"} min={2} onChange={setSlowPeriod} value={slowPeriod} /></div>}
                  {strategy === "bollinger_bands" && <div className="grid grid-cols-2 gap-3"><NumericField id="bbp" label="BB Period" min={2} onChange={setBbPeriod} value={bbPeriod} /><NumericField id="bbs" label="StdDev mult" min={0.5} onChange={setBbStddev} step={0.5} value={bbStddev} /></div>}
                  {strategy === "rsi_mean_reversion" && <><NumericField id="rp" label="RSI Period" min={2} onChange={setRsiPeriod} value={rsiPeriod} /><div className="grid grid-cols-2 gap-3"><NumericField id="ro" label="Oversold" max={rsiOverbought - 1} onChange={setRsiOversold} value={rsiOversold} /><NumericField id="rb" label="Overbought" min={rsiOversold + 1} onChange={setRsiOverbought} value={rsiOverbought} /></div></>}
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5"><Label htmlFor="sweep-start">Start</Label><Input id="sweep-start" max={today()} onChange={(e) => setStartDate(e.target.value)} type="date" value={startDate} /></div>
                    <div className="space-y-1.5"><Label htmlFor="sweep-end">End</Label><Input id="sweep-end" max={today()} onChange={(e) => setEndDate(e.target.value)} type="date" value={endDate} /></div>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="space-y-1.5"><Label htmlFor="sweep-contract">Contract</Label><Select id="sweep-contract" onChange={(e) => setContract(e.target.value as ContractType)} value={contract}>{(["MES","MNQ","ES","NQ"] as ContractType[]).map((s) => <option key={s} value={s}>{s}</option>)}</Select></div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Strategies</Label>
                    <div className="space-y-1">
                      {ALL_STRATEGIES.map((s) => (
                        <label key={s} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors ${sweepStrats.includes(s) ? "border-primary/40 bg-primary/8" : "border-border hover:bg-muted/50"}`}>
                          <input checked={sweepStrats.includes(s)} className="sr-only" onChange={() => toggleSweepStrat(s)} type="checkbox" />
                          <span className={`size-3 rounded border ${sweepStrats.includes(s) ? "border-primary bg-primary" : "border-border"}`}>{sweepStrats.includes(s) && <svg className="size-3 text-primary-foreground" viewBox="0 0 12 12"><path d="M3 6l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>}</span>
                          {STRATEGY_LABELS[s]}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Intervals</Label>
                    <div className="flex gap-3">
                      <label className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors ${compareIntervals ? 'border-primary/40 bg-primary/8' : interval === '1m' ? 'border-primary/40 bg-primary/8' : 'border-border hover:bg-muted/50'}`}>
                        <input checked={compareIntervals || interval === '1m'} className="sr-only" onChange={() => { if (compareIntervals) { setCompareIntervals(false); setInterval('5m'); } else if (interval === '1m') { return; } else { setCompareIntervals(true); } }} type="checkbox" />
                        <span className={`flex size-3 items-center justify-center rounded border ${compareIntervals || interval === '1m' ? 'border-primary bg-primary' : 'border-border'}`}>{compareIntervals || interval === '1m' ? <svg className="size-2.5 text-primary-foreground" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 6l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg> : null}</span>
                        1m
                      </label>
                      <label className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors ${compareIntervals ? 'border-primary/40 bg-primary/8' : interval === '5m' ? 'border-primary/40 bg-primary/8' : 'border-border hover:bg-muted/50'}`}>
                        <input checked={compareIntervals || interval === '5m'} className="sr-only" onChange={() => { if (compareIntervals) { setCompareIntervals(false); setInterval('1m'); } else if (interval === '5m') { return; } else { setCompareIntervals(true); } }} type="checkbox" />
                        <span className={`flex size-3 items-center justify-center rounded border ${compareIntervals || interval === '5m' ? 'border-primary bg-primary' : 'border-border'}`}>{compareIntervals || interval === '5m' ? <svg className="size-2.5 text-primary-foreground" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 6l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg> : null}</span>
                        5m
                      </label>
                    </div>
                  </div>
                </>
              )}

              <details className="border-t border-border pt-4">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Costs & stops</summary>
                <div className="mt-3 space-y-3">
                  <NumericField id="capital" label="Initial capital ($)" min={1} onChange={setInitialCapital} step={1000} value={initialCapital} />
                  <div className="grid grid-cols-2 gap-3"><NumericField id="contracts" label="Contracts" min={1} onChange={setContracts} value={contracts} /><NumericField id="commission" label="Commission / side" onChange={setCommission} step={0.01} value={commission} /></div>
                  <NumericField id="slippage" label="Slippage (ticks)" onChange={setSlippage} step={0.25} value={slippage} />
                  <NumericField id="spread" label="Spread (ticks)" onChange={setSpread} step={0.25} value={spread} />
                  <div className="grid grid-cols-2 gap-3"><NumericField id="stop" label="Stop loss (pts)" onChange={setStopLoss} step={1} value={stopLoss} /><NumericField id="target" label="Take profit (pts)" onChange={setTakeProfit} step={1} value={takeProfit} /></div>
                  <div className="grid grid-cols-2 gap-3"><div className="space-y-1.5"><Label htmlFor="win-start">Window start (ET)</Label><Input id="win-start" onChange={(e) => setWindowStart(e.target.value)} placeholder="08:30" type="time" value={windowStart} /></div><div className="space-y-1.5"><Label htmlFor="win-end">Window end (ET)</Label><Input id="win-end" onChange={(e) => setWindowEnd(e.target.value)} placeholder="17:00" type="time" value={windowEnd} /></div></div>
                </div>
              </details>

              {error && <div className="rounded-md border border-negative/30 bg-negative/8 px-3 py-2.5 text-xs leading-5 text-negative" role="alert">{error}</div>}

              <Button className="w-full" onClick={useKnownGoodRun} size="sm" type="button" variant="outline">
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Known-good run
              </Button>

              {!selectedDateHasData && mode === "single" && availableDates?.latest_date && !isLoadingDates && (
                <button className="text-left text-xs font-medium text-primary hover:underline" onClick={() => setDate(availableDates.latest_date ?? date)} type="button">
                  Use latest cached date ({availableDates.latest_date})
                </button>
              )}

              <Button className="w-full" disabled={isRunning || isLoadingDates || (mode === "sweep" && sweepStrats.length === 0)} onClick={mode === "single" ? runSingle : runSweep} type="button">
                {isRunning ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : mode === "single" ? <Play className="size-4" aria-hidden="true" /> : <Zap className="size-4" aria-hidden="true" />}
                {isLoadingDates ? "Checking dates..." : isRunning ? "Running…" : mode === "single" ? `Run ${date}` : `Sweep ${startDate} → ${endDate}`}
              </Button>
            </div>
          </Card>
        </aside>

        <div className="min-w-0 space-y-5">
          {mode === "single" && result ? (
            <>
              <MetricStrip metrics={result.metrics} />
              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
                  <div><h2 className="text-sm font-semibold">Price & signals</h2><p className="mt-0.5 text-xs text-muted-foreground">{result.contract.symbol} · {result.candles.length.toLocaleString()} candles · {date} · {STRATEGY_LABELS[strategy]}</p>{sessionSummary && <p className="mt-1 text-xs text-muted-foreground">{sessionSummary}</p>}</div>
                </div>
                <MarketChart result={result} />
              </Card>
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(260px,.5fr)]">
                <Card className="overflow-hidden"><div className="border-b border-border px-4 py-3 sm:px-5"><h2 className="text-sm font-semibold">Equity curve</h2></div><EquityChart result={result} /></Card>
                <Card className="p-4 sm:p-5"><h2 className="text-sm font-semibold">Performance detail</h2>{dataSummary && <p className="mt-1 text-xs text-muted-foreground">{dataSummary}</p>}<dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">{([
                  ["Winning trades", result.metrics.winning_trades], ["Losing trades", result.metrics.losing_trades], ["Average win", money(result.metrics.average_win)], ["Average loss", money(result.metrics.average_loss)], ["Average trade", money(result.metrics.average_trade_pnl)], ["Largest win", money(result.metrics.largest_win)], ["Largest loss", money(result.metrics.largest_loss)], ["Ending equity", money(initialCapital + result.metrics.net_pnl)],
                ] as const).map(([label, value]) => <div className="border-b border-border/70 pb-2" key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 font-mono font-semibold">{value}</dd></div>)}</dl></Card>
              </div>
              <Card className="overflow-hidden"><div className="flex items-end justify-between border-b border-border px-4 py-3 sm:px-5"><div><h2 className="text-sm font-semibold">Trade log</h2></div><span className="font-mono text-xs text-muted-foreground">{result.trades.length} rows</span></div>{result.trades.length ? <TradeTable trades={result.trades} /> : <div className="grid min-h-40 place-items-center px-5 text-center text-sm text-muted-foreground">No trades.</div>}</Card>
            </>
          ) : mode === "sweep" && sweepResults ? (
            <div className="space-y-5">
              {strategyGroups.length > 0 && <SweepCharts groups={strategyGroups} />}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Sweep results</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{sweepResults.length} daily rows · {strategyGroups.length} strategies · sorted by {String(sweepSort.key).replaceAll("_", " ")}</p>
                </div>
                <Button disabled={!sweepResults.length} onClick={exportSweepCsv} size="sm" type="button" variant="outline">
                  <Download className="size-3.5" aria-hidden="true" />
                  Export CSV
                </Button>
              </div>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[920px] border-collapse text-left text-xs">
                  <thead><tr className="border-b border-border bg-muted/50 text-muted-foreground">
                    {[
                      ["Strategy", "strategy"], ["Days", "date"], ["Trades", "total_trades"], ["Win %", "win_rate"],
                      ["Overall PnL", "net_pnl"], ["Avg Daily", "average_trade_pnl"], ["Max DD", "max_drawdown"], ["Best day", "profit_factor"],
                    ].map(([label, key]) => (
                      <th className="whitespace-nowrap px-3 py-2.5 font-medium" key={key}>
                        <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => changeSweepSort(key as typeof sweepSort.key)} type="button">
                          {label}{sweepSort.key === key && <span aria-hidden="true">{sweepSort.direction === "asc" ? "↑" : "↓"}</span>}
                        </button>
                      </th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {strategyGroups.map((group) => (
                      <tr className="border-b border-border/70 last:border-0 hover:bg-muted/35" key={group.strategy}>
                        <td className="px-3 py-2.5 font-medium">{group.label}{group.totalNetPnl === bestStrategyPnl && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Best</span>}</td>
                        <td className="px-3 py-2.5 font-mono">{group.tradingDays}<span className="text-muted-foreground"> / {group.rows.length}</span></td>
                        <td className="px-3 py-2.5 font-mono">{group.totalTrades}</td>
                        <td className="px-3 py-2.5 font-mono">{group.weightedWinRate.toFixed(1)}%</td>
                        <td className={`px-3 py-2.5 font-mono font-semibold ${group.totalNetPnl >= 0 ? "text-positive" : "text-negative"}`}>{money(group.totalNetPnl)}</td>
                        <td className={`px-3 py-2.5 font-mono ${group.averageDailyPnl >= 0 ? "text-positive" : "text-negative"}`}>{money(group.averageDailyPnl)}</td>
                        <td className="px-3 py-2.5 font-mono">{money(group.maxDrawdown)}</td>
                        <td className="px-3 py-2.5 font-mono">{group.bestDay?.date ?? "N/A"}{group.bestDay?.metrics && <span className={group.bestDay.metrics.net_pnl >= 0 ? "text-positive" : "text-negative"}> · {money(group.bestDay.metrics.net_pnl)}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-4">
                {strategyGroups.map((group) => (
                  <section className="overflow-hidden rounded-xl border border-border bg-card" key={group.strategy}>
                    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border bg-muted/25 px-4 py-3 sm:px-5">
                      <div>
                        <h3 className="text-sm font-semibold">{group.label}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {group.tradingDays} trading days · {group.errorDays} unavailable · overall <span className={group.totalNetPnl >= 0 ? "font-mono text-positive" : "font-mono text-negative"}>{money(group.totalNetPnl)}</span> · avg daily <span className={group.averageDailyPnl >= 0 ? "font-mono text-positive" : "font-mono text-negative"}>{money(group.averageDailyPnl)}</span>
                        </p>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <div>Best: <span className="font-mono text-positive">{group.bestDay ? `${group.bestDay.date} ${money(group.bestDay.metrics?.net_pnl ?? 0)}` : "N/A"}</span></div>
                        <div>Worst: <span className="font-mono text-negative">{group.worstDay ? `${group.worstDay.date} ${money(group.worstDay.metrics?.net_pnl ?? 0)}` : "N/A"}</span></div>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px] border-collapse text-left text-xs">
                        <thead>
                          <tr className="border-b border-border bg-muted/35 text-muted-foreground">
                            {["Date", "Trades", "Win %", "Daily PnL", "Running PnL", "PF", "Max DD", "Avg Trade"].map((label) => (
                              <th className="whitespace-nowrap px-3 py-2.5 font-medium" key={label}>{label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.reduce<{ running: number; rows: ReactNode[] }>((acc, row) => {
                            if (row.metrics) acc.running += row.metrics.net_pnl;
                            acc.rows.push(
                              <tr className="border-b border-border/70 last:border-0 hover:bg-muted/35" key={`${group.strategy}-${row.date}`}>
                                <td className="whitespace-nowrap px-3 py-2.5 font-mono">{row.date}</td>
                                {row.error ? (
                                  <td className="px-3 py-2.5 text-muted-foreground" colSpan={7}>{sweepErrorLabel(row.error)}</td>
                                ) : row.metrics ? (
                                  <>
                                    <td className="px-3 py-2.5 font-mono">{row.metrics.total_trades}</td>
                                    <td className="px-3 py-2.5 font-mono">{row.metrics.win_rate.toFixed(1)}%</td>
                                    <td className={`px-3 py-2.5 font-mono font-semibold ${row.metrics.net_pnl >= 0 ? "text-positive" : "text-negative"}`}>{money(row.metrics.net_pnl)}</td>
                                    <td className={`px-3 py-2.5 font-mono ${acc.running >= 0 ? "text-positive" : "text-negative"}`}>{money(acc.running)}</td>
                                    <td className="px-3 py-2.5 font-mono">{row.metrics.profit_factor !== null ? row.metrics.profit_factor.toFixed(2) : "N/A"}</td>
                                    <td className="px-3 py-2.5 font-mono">{money(row.metrics.max_drawdown)}</td>
                                    <td className="px-3 py-2.5 font-mono">{money(row.metrics.average_trade_pnl)}</td>
                                  </>
                                ) : (
                                  <td className="px-3 py-2.5" colSpan={7}>No metrics returned.</td>
                                )}
                              </tr>,
                            );
                            return acc;
                          }, { running: 0, rows: [] }).rows}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))}
              </div>
            </div>
          ) : (
            <Card className="grid min-h-[660px] place-items-center border-dashed p-6 text-center">
              <div className="max-w-md"><span className="mx-auto grid size-12 place-items-center rounded-xl bg-muted"><BarChart3 className="size-5 text-muted-foreground" aria-hidden="true" /></span><h2 className="mt-5 text-lg font-semibold tracking-tight">Your {mode === "single" ? "backtest" : "sweep"} will appear here</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{mode === "single" ? "Pick a date and strategy, then run." : "Pick a date range and strategies, then sweep."}</p></div>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}

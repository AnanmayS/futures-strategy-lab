"use client";

import { useEffect, useRef } from "react";
import { ColorType, CrosshairMode, createChart, type SeriesMarker, type Time, type UTCTimestamp } from "lightweight-charts";
import type { BacktestResult, Indicator } from "@/lib/types";

function chartTime(value: string): UTCTimestamp {
  return Math.floor(new Date(value).getTime() / 1000) as UTCTimestamp;
}

function indicatorLine(result: BacktestResult, key: keyof Indicator) {
  return result.indicators
    .map((item) => ({ time: item.time, value: item[key] }))
    .filter((item): item is { time: string; value: number } => typeof item.time === "string" && typeof item.value === "number")
    .map((item) => ({ time: chartTime(item.time), value: item.value }));
}

export function MarketChart({ result }: { result: BacktestResult }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || result.candles.length === 0) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 460,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#73746f", fontFamily: "SFMono-Regular, monospace", fontSize: 11 },
      grid: { vertLines: { color: "rgba(83, 83, 76, 0.08)" }, horzLines: { color: "rgba(83, 83, 76, 0.08)" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(83, 83, 76, 0.14)" },
      timeScale: { borderColor: "rgba(83, 83, 76, 0.14)", timeVisible: true, secondsVisible: false, rightOffset: 4 },
      localization: { priceFormatter: (price: number) => price.toFixed(2) },
    });
    const candles = chart.addCandlestickSeries({ upColor: "#257a62", downColor: "#bf5b45", wickUpColor: "#257a62", wickDownColor: "#bf5b45", borderVisible: false });
    candles.setData(result.candles.map(({ time, open, high, low, close }) => ({ time: chartTime(time), open, high, low, close })));
    const indicatorSeries = [
      { key: "fast_ema", title: "Fast EMA", color: "#c07a24" },
      { key: "slow_ema", title: "Slow EMA", color: "#6a65a8" },
      { key: "fast_sma", title: "Fast SMA", color: "#c07a24" },
      { key: "slow_sma", title: "Slow SMA", color: "#6a65a8" },
      { key: "bb_upper", title: "BB upper", color: "#6a65a8" },
      { key: "bb_middle", title: "BB middle", color: "#73746f" },
      { key: "bb_lower", title: "BB lower", color: "#6a65a8" },
    ] as const;

    for (const item of indicatorSeries) {
      const data = indicatorLine(result, item.key);
      if (!data.length) continue;
      const line = chart.addLineSeries({ color: item.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: item.title });
      line.setData(data);
    }

    const markers: SeriesMarker<Time>[] = result.trades.flatMap((trade) => [
      {
        time: chartTime(trade.entry_time),
        position: trade.direction === "long" ? "belowBar" : "aboveBar",
        color: trade.direction === "long" ? "#257a62" : "#bf5b45",
        shape: trade.direction === "long" ? "arrowUp" : "arrowDown",
        text: trade.direction === "long" ? "Long" : "Short",
      },
      {
        time: chartTime(trade.exit_time),
        position: trade.direction === "long" ? "aboveBar" : "belowBar",
        color: "#6a65a8",
        shape: "circle",
        text: `Exit ${trade.net_pnl >= 0 ? "+" : ""}$${trade.net_pnl.toFixed(0)}`,
      },
    ]);
    markers.sort((a, b) => Number(a.time) - Number(b.time));
    candles.setMarkers(markers);
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [result]);

  if (result.candles.length === 0) {
    return <div className="grid h-[460px] place-items-center px-5 text-center text-sm text-muted-foreground">No candles to chart for this run.</div>;
  }

  return <div ref={containerRef} className="h-[460px] w-full" aria-label="Candlestick chart with strategy lines and trade markers" />;
}

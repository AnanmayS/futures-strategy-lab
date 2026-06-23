"use client";

import { useEffect, useRef } from "react";
import { ColorType, createChart, type UTCTimestamp } from "lightweight-charts";
import type { BacktestResult } from "@/lib/types";

export function EquityChart({ result }: { result: BacktestResult }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!containerRef.current || result.equity_curve.length === 0) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 220,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#73746f", fontFamily: "SFMono-Regular, monospace", fontSize: 11 },
      grid: { vertLines: { color: "rgba(83, 83, 76, 0.07)" }, horzLines: { color: "rgba(83, 83, 76, 0.07)" } },
      rightPriceScale: { borderColor: "rgba(83, 83, 76, 0.14)" },
      timeScale: { borderColor: "rgba(83, 83, 76, 0.14)", timeVisible: true },
      localization: { priceFormatter: (price: number) => `$${price.toLocaleString("en-US", { maximumFractionDigits: 0 })}` },
    });
    const area = chart.addAreaSeries({ lineColor: "#6a65a8", topColor: "rgba(106,101,168,.22)", bottomColor: "rgba(106,101,168,0)", lineWidth: 2, priceLineVisible: false });
    area.setData(result.equity_curve.map((item) => ({ time: Math.floor(new Date(item.time).getTime() / 1000) as UTCTimestamp, value: item.value })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [result]);
  if (result.equity_curve.length === 0) {
    return <div className="grid h-[220px] place-items-center px-5 text-center text-sm text-muted-foreground">No realized equity points yet.</div>;
  }

  return <div ref={containerRef} className="h-[220px] w-full" aria-label="Equity curve chart" />;
}

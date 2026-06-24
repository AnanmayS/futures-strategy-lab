"use client";

import { useEffect, useRef } from "react";
import { ColorType, createChart, type UTCTimestamp } from "lightweight-charts";
import type { StrategySweepGroup } from "@/components/lab-dashboard";

function chartTime(value: string): UTCTimestamp {
  return Math.floor(new Date(value + "T12:00:00").getTime() / 1000) as UTCTimestamp;
}

const COLORS = ["#257a62", "#c07a24", "#6a65a8", "#bf5b45", "#3b82f6", "#ec4899"];

function chartOptions(title: string) {
  return {
    autoSize: true,
    height: 260,
    layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#73746f", fontFamily: "SFMono-Regular, monospace", fontSize: 11 },
    grid: { vertLines: { color: "rgba(83, 83, 76, 0.08)" }, horzLines: { color: "rgba(83, 83, 76, 0.08)" } },
    rightPriceScale: { borderColor: "rgba(83, 83, 76, 0.14)" },
    timeScale: { borderColor: "rgba(83, 83, 76, 0.14)", timeVisible: false },
    localization: { priceFormatter: (p: number) => "$" + p.toFixed(0) },
  };
}

export function SweepCharts({ groups }: { groups: StrategySweepGroup[] }) {
  const dailyRef = useRef<HTMLDivElement>(null);
  const cumRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dailyRef.current || !cumRef.current || !groups.length) return;

    // ── Daily PnL chart ──
    const dailyChart = createChart(dailyRef.current, chartOptions("Daily PnL"));
    // ── Cumulative PnL chart ──
    const cumChart = createChart(cumRef.current, chartOptions("Cumulative PnL"));

    groups.forEach((group, gi) => {
      const color = COLORS[gi % COLORS.length];
      const sorted = [...group.rows].sort((a, b) => a.date.localeCompare(b.date));

      // Daily PnL
      const dailyData = sorted
        .filter((r) => r.metrics)
        .map((r) => ({ time: chartTime(r.date), value: r.metrics!.net_pnl }));
      if (dailyData.length) {
        const line = dailyChart.addLineSeries({ color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: group.label });
        line.setData(dailyData);
      }

      // Cumulative PnL
      let cum = 0;
      const cumData = sorted
        .filter((r) => r.metrics)
        .map((r) => { cum += r.metrics!.net_pnl; return { time: chartTime(r.date), value: cum }; });
      if (cumData.length) {
        const line = cumChart.addLineSeries({ color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: group.label });
        line.setData(cumData);
      }
    });

    dailyChart.timeScale().fitContent();
    cumChart.timeScale().fitContent();

    return () => { dailyChart.remove(); cumChart.remove(); };
  }, [groups]);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card/50 p-2">
        <p className="mb-2 px-2 text-[11px] font-medium text-muted-foreground">Daily PnL by strategy</p>
        <div ref={dailyRef} className="h-[260px] w-full" />
        <div className="mt-1 flex flex-wrap gap-3 px-2 pb-1">
          {groups.map((g, i) => (
            <span key={g.strategy} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
              {g.label} <span className={g.totalNetPnl >= 0 ? "text-positive" : "text-negative"}>{g.totalNetPnl >= 0 ? "+" : ""}${g.totalNetPnl.toFixed(0)}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card/50 p-2">
        <p className="mb-2 px-2 text-[11px] font-medium text-muted-foreground">Cumulative PnL</p>
        <div ref={cumRef} className="h-[260px] w-full" />
      </div>
    </div>
  );
}

import { Activity, CirclePercent, GitCommitHorizontal, Scale, TrendingUp } from "lucide-react";
import type { Metrics } from "@/lib/types";
import { money } from "@/lib/utils";

const items = [
  { key: "net_pnl", label: "Net PnL", icon: TrendingUp, format: (value: number) => money(value) },
  { key: "win_rate", label: "Win rate", icon: CirclePercent, format: (value: number) => `${value.toFixed(1)}%` },
  { key: "total_trades", label: "Trades", icon: GitCommitHorizontal, format: (value: number) => String(value) },
  { key: "max_drawdown", label: "Max drawdown", icon: Activity, format: (value: number) => money(value) },
  { key: "profit_factor", label: "Profit factor", icon: Scale, format: (value: number | null) => value === null ? "N/A" : value.toFixed(2) },
] as const;

export function MetricStrip({ metrics }: { metrics: Metrics }) {
  return (
    <section aria-label="Performance summary" className="grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm md:grid-cols-5 md:divide-y-0">
      {items.map(({ key, label, icon: Icon, format }, index) => {
        const value = metrics[key];
        return (
          <div className={`min-w-0 px-4 py-4 ${index === 4 ? "col-span-2 md:col-span-1" : ""}`} key={key}>
            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-3.5" aria-hidden="true" />{label}</div>
            <p className={`font-mono text-lg font-semibold tracking-tight ${key === "net_pnl" ? (Number(value) >= 0 ? "text-positive" : "text-negative") : ""}`}>{format(value as never)}</p>
          </div>
        );
      })}
    </section>
  );
}

import { ArrowDown, ArrowUp } from "lucide-react";
import type { Trade } from "@/lib/types";
import { formatTime, money } from "@/lib/utils";

export function TradeTable({ trades }: { trades: Trade[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1260px] border-collapse text-left text-xs">
        <caption className="sr-only">Completed backtest trades</caption>
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            {["#", "Direction", "Entry time", "Entry", "Exit time", "Exit", "Qty", "Gross", "Comm", "Spread", "Net", "Cum.", "Reason"].map((heading) => (
              <th className="whitespace-nowrap px-3 py-3 font-medium" key={heading}>{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr className="border-b border-border/70 transition-colors last:border-0 hover:bg-muted/55" key={trade.trade_number}>
              <td className="px-3 py-3 font-mono text-muted-foreground">{String(trade.trade_number).padStart(2, "0")}</td>
              <td className="px-3 py-3">
                <span className="inline-flex items-center gap-1.5 font-semibold capitalize">
                  {trade.direction === "long" ? <ArrowUp className="size-3.5 text-positive" aria-hidden="true" /> : <ArrowDown className="size-3.5 text-negative" aria-hidden="true" />}
                  {trade.direction}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-3 font-mono">{formatTime(trade.entry_time)}</td>
              <td className="px-3 py-3 font-mono">{trade.entry_price.toFixed(2)}</td>
              <td className="whitespace-nowrap px-3 py-3 font-mono">{formatTime(trade.exit_time)}</td>
              <td className="px-3 py-3 font-mono">{trade.exit_price.toFixed(2)}</td>
              <td className="px-3 py-3 font-mono">{trade.contracts}</td>
              <td className="px-3 py-3 font-mono">{money(trade.gross_pnl)}</td>
              <td className="px-3 py-3 font-mono text-muted-foreground">{money(trade.commissions)}</td>
              <td className="px-3 py-3 font-mono text-muted-foreground">{money(trade.spread)}</td>
              <td className={`px-3 py-3 font-mono font-semibold ${trade.net_pnl >= 0 ? "text-positive" : "text-negative"}`}>{money(trade.net_pnl)}</td>
              <td className="px-3 py-3 font-mono">{money(trade.cumulative_pnl)}</td>
              <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{trade.exit_reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

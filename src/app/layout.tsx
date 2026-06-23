import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Futures Strategy Lab",
  description: "Upload futures candle data and inspect an EMA crossover backtest.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

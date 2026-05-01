"use client";

import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { HistogramBin } from "@/lib/types";

function formatDisplayValue(value: number) {
  if (Math.abs(value) < 1 && value !== 0) {
    return `${(value * 100).toFixed(2)}%`;
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(value);
}

export default function DistributionChart({
  histogram,
  valueAtRisk,
  confidenceLevel,
  loading
}: {
  histogram: HistogramBin[];
  valueAtRisk: number;
  confidenceLevel: number;
  loading: boolean;
}) {
  const tailThreshold = -Math.abs(valueAtRisk);
  const bars = histogram.map((bin) => {
    const isTail =
      bin.bin_end <= tailThreshold || (bin.bin_start <= tailThreshold && tailThreshold < bin.bin_end);
    return {
      ...bin,
      label: `${formatDisplayValue(bin.bin_start)} to ${formatDisplayValue(bin.bin_end)}`,
      isTail
    };
  });

  return (
    <section className="rounded-[2rem] border border-white/60 bg-slate-950 p-6 text-white shadow-[0_24px_80px_rgba(15,23,42,0.24)]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-teal-300/70">Distribution</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Simulation histogram</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-300">
            50 bins from the backend. The selected loss tail is highlighted red.
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <div className="text-xs uppercase tracking-[0.24em] text-slate-400">VaR {Math.round(confidenceLevel * 100)}%</div>
          <div className="mt-1 text-lg font-semibold text-rose-300">{formatDisplayValue(valueAtRisk)}</div>
        </div>
      </div>

      <div className="mt-6 h-[360px]">
        {loading ? (
          <div className="flex h-full flex-col justify-end gap-2 rounded-2xl bg-white/5 p-4">
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div className="simulation-progress h-full rounded-full bg-teal-300" />
            </div>
            <div className="grid h-64 grid-cols-12 items-end gap-2">
              {Array.from({ length: 48 }, (_, index) => (
                <div
                  key={index}
                  className="animate-pulse rounded-t-md bg-white/10"
                  style={{ height: `${18 + ((index * 17) % 74)}%` }}
                />
              ))}
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis
                dataKey="bin_start"
                tickFormatter={(value) => formatDisplayValue(Number(value))}
                stroke="rgba(226,232,240,0.55)"
                tickLine={false}
                axisLine={{ stroke: "rgba(226,232,240,0.18)" }}
                minTickGap={22}
              />
              <YAxis
                stroke="rgba(226,232,240,0.55)"
                tickLine={false}
                axisLine={{ stroke: "rgba(226,232,240,0.18)" }}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.06)" }}
                contentStyle={{
                  borderRadius: 16,
                  border: "1px solid rgba(148, 163, 184, 0.18)",
                  background: "rgba(15, 23, 42, 0.96)",
                  color: "#fff"
                }}
                labelStyle={{ color: "#cbd5e1" }}
                formatter={((value) => [new Intl.NumberFormat("en-US").format(Number(value ?? 0)), "Frequency"]) as (
                  value: unknown
                ) => [string, string]}
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as { label?: string } | undefined;
                  return row?.label ?? "";
                }}
              />
              <Bar dataKey="frequency" radius={[10, 10, 0, 0]} barSize={12}>
                {bars.map((entry) => (
                  <Cell key={`${entry.bin_start}-${entry.bin_end}`} fill={entry.isTail ? "#ef4444" : "#38bdf8"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

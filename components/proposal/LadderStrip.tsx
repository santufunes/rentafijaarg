'use client';

import type { ProposalLine } from '@/lib/builder/construct';
import type { UsdLineExtra } from '@/lib/builder/usdportfolio';
import { fmtArs, fmtDate, fmtUsd } from '@/lib/format';

const TIER_COLORS: Record<number, string> = { 1: '#10b981', 2: '#f59e0b', 3: '#ef4444' };

/** Barras de vencimiento contra el horizonte del inversor. */
export default function LadderStrip({
  lines,
  asOf,
  horizonMonths,
  extras,
  showUsd,
  mep,
}: {
  lines: ProposalLine[];
  asOf: string;
  horizonMonths: number;
  extras?: Record<string, UsdLineExtra>;
  showUsd?: boolean;
  mep?: number;
}) {
  const months = (maturity: string) =>
    (Date.parse(maturity) - Date.parse(asOf)) / 86_400_000 / 30.44;
  const maxScale = Math.max(horizonMonths * 1.25, ...lines.map((l) => months(l.position.priced.instrument.maturity) * 1.05), 1);
  const horizonPct = Math.min(100, (horizonMonths / maxScale) * 100);

  return (
    <div className="space-y-2">
      {lines.map((l) => {
        const i = l.position.priced.instrument;
        const m = months(i.maturity);
        const pct = Math.min(100, (m / maxScale) * 100);
        const extra = extras?.[i.ticker];
        return (
          <div key={i.ticker} className="flex items-center gap-2 font-mono text-xs">
            <span className="w-14 shrink-0 font-bold text-stone-100">{i.ticker}</span>
            {extra?.tier ? (
              <span
                className="w-7 shrink-0 rounded px-1 text-center text-[9px] font-bold text-stone-950"
                style={{ background: TIER_COLORS[extra.tier] }}
                title={extra.rating}
              >
                T{extra.tier}
              </span>
            ) : (
              <span className="w-7 shrink-0" />
            )}
            <div className="relative h-5 flex-1 overflow-hidden rounded bg-stone-900">
              <div
                className="flex h-full items-center justify-end rounded bg-gradient-to-r from-emerald-900/40 to-emerald-500/70 pr-2"
                style={{ width: `${pct}%` }}
              >
                <span className="whitespace-nowrap text-[10px] font-bold text-emerald-100">
                  {fmtDate(i.maturity)} · {(l.position.priced.tir * 100).toFixed(1)}%
                </span>
              </div>
            </div>
            <span className="w-24 shrink-0 text-right text-stone-400">
              {showUsd && mep ? fmtUsd(l.position.investedArs / mep) : fmtArs(l.position.investedArs)}
            </span>
          </div>
        );
      })}
      <div className="flex items-center gap-2 font-mono text-[10px] text-stone-500">
        <span className="w-14 shrink-0" />
        <span className="w-7 shrink-0" />
        <div className="relative flex-1">
          <div
            className="absolute -top-1 h-2 border-l border-dashed border-stone-400"
            style={{ left: `${horizonPct}%` }}
          />
          <div className="pt-1" style={{ marginLeft: `${Math.max(0, horizonPct - 6)}%` }}>
            ← tu horizonte ({horizonMonths}m)
          </div>
        </div>
        <span className="w-24 shrink-0" />
      </div>
    </div>
  );
}

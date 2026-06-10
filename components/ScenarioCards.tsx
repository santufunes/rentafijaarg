'use client';

import type { ScenarioResult } from '@/lib/engine/portfolio';
import { fmtArs, fmtPct, fmtUsd } from '@/lib/format';

export default function ScenarioCards({ scenarios }: { scenarios: ScenarioResult[] }) {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      {scenarios.map((s) => (
        <div
          key={s.scenario.key}
          className={`rounded-xl border p-4 ${
            s.scenario.key === 'base'
              ? 'border-stone-300 bg-stone-50'
              : s.scenario.key === 'optimista'
                ? 'border-emerald-200 bg-emerald-50/50'
                : 'border-red-200 bg-red-50/50'
          }`}
        >
          <div className="text-sm font-semibold">{s.scenario.label}</div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{fmtArs(s.valueArs)}</div>
          <div className="text-sm tabular-nums text-stone-600">
            {s.directReturnPct >= 0 ? '+' : ''}
            {fmtPct(s.directReturnPct)} directo · {s.annualizedPct >= 0 ? '+' : ''}
            {fmtPct(s.annualizedPct)} anualizado
          </div>
          <div className="mt-1 text-xs tabular-nums text-stone-500">
            {fmtUsd(s.valueUsd)} al MEP proyectado ({fmtArs(s.mepAtHorizon)}) ·{' '}
            {s.usdReturnPct >= 0 ? '+' : ''}
            {fmtPct(s.usdReturnPct)} en USD
          </div>
          <p className="mt-3 text-xs leading-snug text-stone-500">{s.scenario.description}</p>
        </div>
      ))}
    </div>
  );
}

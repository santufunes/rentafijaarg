'use client';

import type { ScenarioResult } from '@/lib/engine/portfolio';
import { fmtArs, fmtPct, fmtUsd } from '@/lib/format';

export default function ScenarioCards({ scenarios }: { scenarios: ScenarioResult[] }) {
  const pesimista = scenarios.find((s) => s.scenario.key === 'pesimista');
  const base = scenarios.find((s) => s.scenario.key === 'base');
  const nominalTrap = pesimista && base && pesimista.valueArs > base.valueArs;
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      {scenarios.map((s) => (
        <div
          key={s.scenario.key}
          className={`rounded-xl border p-4 ${
            s.scenario.key === 'base'
              ? 'border-stone-700 bg-stone-900'
              : s.scenario.key === 'optimista'
                ? 'border-emerald-900 bg-emerald-500/10'
                : 'border-red-900 bg-red-500/10'
          }`}
        >
          <div className="text-sm font-semibold text-stone-100">{s.scenario.label}</div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-stone-100">
            {fmtArs(s.valueArs)}
          </div>
          <div className="font-mono text-sm tabular-nums text-stone-400">
            {s.directReturnPct >= 0 ? '+' : ''}
            {fmtPct(s.directReturnPct)} directo · {s.annualizedPct >= 0 ? '+' : ''}
            {fmtPct(s.annualizedPct)} anualizado
          </div>
          <div className="mt-1 font-mono text-xs tabular-nums text-stone-500">
            {fmtUsd(s.valueUsd)} al MEP proyectado ({fmtArs(s.mepAtHorizon)}) ·{' '}
            {s.usdReturnPct >= 0 ? '+' : ''}
            {fmtPct(s.usdReturnPct)} en USD
          </div>
          <p className="mt-3 text-xs leading-snug text-stone-500">{s.scenario.description}</p>
        </div>
      ))}
      {nominalTrap && (
        <p className="sm:col-span-3 rounded-lg border border-stone-800 bg-stone-900 p-3 text-xs leading-snug text-stone-400">
          Ojo con los pesos nominales: en el escenario pesimista hay <em>más pesos</em> porque la
          inflación y el dólar suben más — pero compran menos. Para comparar escenarios mirá la
          línea en dólares (o pensá en términos reales).
        </p>
      )}
    </div>
  );
}

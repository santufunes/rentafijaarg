'use client';

import { useMemo } from 'react';
import { INSTRUMENTS } from '@/lib/data/registry';
import type { MarketContext, Quote } from '@/lib/engine/types';
import { fmtArs, fmtDate } from '@/lib/format';
import { simulate } from '@/lib/terminal';

/** Cronograma compacto de pagos de UNA línea de la cartera (mismo motor que el Simulador). */
export default function PayoutsInline({
  ticker,
  investedArs,
  quotes,
  ctx,
}: {
  ticker: string;
  investedArs: number;
  quotes: Map<string, Quote>;
  ctx: MarketContext;
}) {
  const sim = useMemo(() => {
    const instr = INSTRUMENTS.find((i) => i.ticker === ticker);
    if (!instr) return null;
    try {
      // monto +0.5% para que el floor de nominales reproduzca la posición real
      return simulate(instr, quotes, ctx, investedArs * 1.005);
    } catch {
      return null;
    }
  }, [ticker, investedArs, quotes, ctx]);

  if (!sim) return <p className="py-2 font-mono text-xs text-stone-500">Sin cronograma disponible.</p>;

  const isUsd = sim.payCcy === 'USD';
  const shown = sim.payouts.slice(0, 8);
  const rest = sim.payouts.length - shown.length;

  return (
    <div className="rounded-lg border border-stone-800 bg-stone-950 p-3">
      <table className="w-full font-mono text-[11px]">
        <thead className="text-[9px] uppercase text-stone-600">
          <tr>
            <th className="py-1 text-left">Fecha</th>
            <th className="py-1 text-right">Renta</th>
            <th className="py-1 text-right">Capital</th>
            <th className="py-1 text-right">Total {sim.payCcy}</th>
            <th className="py-1 text-right">≈ ARS hoy</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((p) => (
            <tr key={p.date} className="border-t border-stone-900">
              <td className="py-1 text-stone-400">{fmtDate(p.date)}</td>
              <td className="py-1 text-right text-sky-300">{p.interest === 0 ? '—' : p.interest.toFixed(2)}</td>
              <td className="py-1 text-right text-emerald-300">
                {p.amortization === 0 ? '—' : p.amortization.toFixed(2)}
              </td>
              <td className="py-1 text-right font-semibold text-stone-200">{p.totalPayCcy.toFixed(2)}</td>
              <td className="py-1 text-right text-stone-500">{fmtArs(p.totalArs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1.5 font-mono text-[10px] text-stone-600">
        {rest > 0 ? `+${rest} pagos más · ` : ''}Total a cobrar: {isUsd ? 'US$ ' : '$ '}
        {sim.totalReceivedPayCcy.toLocaleString('es-AR', { maximumFractionDigits: 0 })} ·{' '}
        {sim.payouts.length} pago{sim.payouts.length > 1 ? 's' : ''} · simulado con el Simulador de la
        terminal
      </p>
    </div>
  );
}

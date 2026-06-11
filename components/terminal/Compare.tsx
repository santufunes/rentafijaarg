'use client';

import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { INSTRUMENTS } from '@/lib/data/registry';
import type { MarketContext, Quote } from '@/lib/engine/types';
import { FAMILY_META } from '@/lib/familyMeta';
import { simulate, type TerminalRow } from '@/lib/terminal';
import { fmtArs, fmtDate, fmtMonth, fmtNum } from '@/lib/format';

const OVERLAY_AMOUNT = 1_000_000;

export default function Compare({
  rows,
  onRemove,
  quotes,
  ctx,
}: {
  rows: TerminalRow[];
  onRemove: (ticker: string) => void;
  quotes: Map<string, Quote>;
  ctx: MarketContext;
}) {
  // Mismo $1M invertido en cada uno: ¿quién paga cuánto y cuándo? (ARS al FX de hoy)
  const overlay = useMemo(() => {
    const byMonth = new Map<string, Record<string, number>>();
    const okTickers: string[] = [];
    for (const r of rows) {
      const instr = INSTRUMENTS.find((i) => i.ticker === r.ticker);
      if (!instr) continue;
      try {
        const sim = simulate(instr, quotes, ctx, OVERLAY_AMOUNT);
        okTickers.push(r.ticker);
        for (const p of sim.payouts) {
          const m = p.date.slice(0, 7);
          const b = byMonth.get(m) ?? {};
          b[r.ticker] = (b[r.ticker] ?? 0) + p.totalArs;
          byMonth.set(m, b);
        }
      } catch {
        // lote mínimo no alcanzado con $1M u otro límite: queda fuera del overlay
      }
    }
    const data = [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([m, v]) => ({ month: fmtMonth(m), ...v }));
    return { data, okTickers };
  }, [rows, quotes, ctx]);
  if (rows.length === 0)
    return (
      <p className="rounded-lg border border-stone-800 p-8 text-center font-mono text-sm text-stone-500">
        Marcá hasta 4 instrumentos en la pestaña Pantalla para compararlos acá.
      </p>
    );

  const metrics: { label: string; value: (r: TerminalRow) => string; cls?: (r: TerminalRow) => string }[] = [
    { label: 'Familia', value: (r) => FAMILY_META[r.family].label },
    { label: 'Emisor', value: (r) => r.issuer ?? '—' },
    { label: 'Ley', value: (r) => r.law ?? '—' },
    { label: 'Vence', value: (r) => `${fmtDate(r.maturity)} (${r.months.toFixed(0)}m)` },
    {
      label: 'TIR',
      value: (r) => `${r.tirPct.toFixed(2)}% ${r.tirKind}`,
      cls: (r) => (r.tirPct >= 0 ? 'text-emerald-300' : 'text-red-400'),
    },
    { label: 'TEM', value: (r) => (r.temPct !== null ? `${r.temPct.toFixed(2)}%` : '—') },
    { label: 'Duración mod.', value: (r) => `${r.mdYears.toFixed(2)} años` },
    { label: 'Px ARS / 100 VN', value: (r) => (r.pxArs !== null ? fmtNum(r.pxArs) : '—') },
    { label: 'Px USD / 100 VN', value: (r) => (r.pxUsd !== null ? r.pxUsd.toFixed(2) : '—') },
    {
      label: 'Vol ARS/día',
      value: (r) =>
        r.turnoverArs >= 1e9
          ? `${(r.turnoverArs / 1e9).toFixed(1)}B`
          : `${(r.turnoverArs / 1e6).toFixed(0)}M`,
    },
    { label: 'Líquido', value: (r) => (r.liquid ? 'sí' : 'no') },
    { label: 'Lote mínimo', value: (r) => `${r.priced.instrument.minLot || 1} VN` },
    { label: 'Próximo pago', value: (r) => fmtDate(r.priced.projectedCashflows[0]?.date ?? r.maturity) },
    { label: 'Pagos restantes', value: (r) => String(r.priced.projectedCashflows.length) },
  ];

  return (
    <div className="space-y-4">
      {overlay.data.length > 0 && (
        <div className="rounded-lg border border-stone-800 p-3">
          <h3 className="font-mono text-[11px] uppercase text-stone-500">
            Mismos {fmtArs(OVERLAY_AMOUNT)} invertidos en cada uno: qué paga y cuándo (ARS al FX de
            hoy{overlay.okTickers.length < rows.length ? ' · algunos quedan fuera por lote mínimo' : ''})
          </h3>
          <div className="mt-2 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={overlay.data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#292524" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#78716c' }} tickLine={false} axisLine={false} />
                <YAxis
                  tickFormatter={(v) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : `${Math.round(v / 1000)}k`)}
                  tick={{ fontSize: 10, fill: '#78716c' }}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                />
                <Tooltip
                  formatter={(v) => fmtArs(Number(v))}
                  contentStyle={{ background: '#1c1917', border: '1px solid #44403c', fontFamily: 'monospace', fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'monospace' }} />
                {overlay.okTickers.map((t) => {
                  const fam = rows.find((r) => r.ticker === t)!.family;
                  return <Bar isAnimationActive={false} key={t} dataKey={t} fill={FAMILY_META[fam].color} />;
                })}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-stone-800">
      <table className="w-full font-mono text-xs">
        <thead>
          <tr className="bg-stone-900">
            <th className="px-3 py-2 text-left text-[11px] uppercase text-stone-500">Métrica</th>
            {rows.map((r) => (
              <th key={r.ticker} className="px-3 py-2 text-right">
                <div className="flex items-center justify-end gap-2">
                  <span
                    className="rounded px-1 text-[10px] text-stone-950"
                    style={{ background: FAMILY_META[r.family].color }}
                  >
                    {FAMILY_META[r.family].short}
                  </span>
                  <span className="text-sm font-bold text-stone-100">{r.ticker}</span>
                  <button
                    onClick={() => onRemove(r.ticker)}
                    className="text-stone-600 hover:text-red-400"
                    aria-label={`Quitar ${r.ticker}`}
                  >
                    ×
                  </button>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.label} className="border-t border-stone-900">
              <td className="px-3 py-1.5 text-stone-500">{m.label}</td>
              {rows.map((r) => (
                <td
                  key={r.ticker}
                  className={`px-3 py-1.5 text-right text-stone-200 ${m.cls?.(r) ?? ''}`}
                >
                  {m.value(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

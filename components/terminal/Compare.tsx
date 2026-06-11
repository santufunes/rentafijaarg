'use client';

import { FAMILY_META } from '@/lib/familyMeta';
import type { TerminalRow } from '@/lib/terminal';
import { fmtDate, fmtNum } from '@/lib/format';

export default function Compare({
  rows,
  onRemove,
}: {
  rows: TerminalRow[];
  onRemove: (ticker: string) => void;
}) {
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
  );
}

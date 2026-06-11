'use client';

import type { SegmentTrace } from '@/lib/builder/construct';
import { SEGMENT_LABELS, type SegmentKey } from '@/lib/builder/profiles';
import { FAMILY_META } from '@/lib/familyMeta';

/** "¿Por qué estos y no otros?" — las trazas del builder, en versión minorista. */
export default function TracesAccordion({ traces }: { traces: SegmentTrace[] }) {
  const withCandidates = traces.filter((t) => t.candidates.length > 0 && t.targetWeightPct > 0);
  if (withCandidates.length === 0) return null;
  return (
    <details className="rounded-2xl border border-stone-800 bg-stone-900/60 p-6">
      <summary className="cursor-pointer text-lg font-semibold text-stone-100">
        ¿Por qué estos instrumentos y no otros?
        <span className="ml-2 align-middle font-mono text-[10px] uppercase text-stone-500">
          cada candidato evaluado, con su motivo
        </span>
      </summary>
      <div className="mt-4 space-y-4">
        {withCandidates.map((trace, idx) => (
          <div key={idx} className="rounded-lg border border-stone-800">
            <div className="border-b border-stone-800 px-3 py-2 font-mono text-[11px] font-bold uppercase text-stone-400">
              {SEGMENT_LABELS[trace.segment as SegmentKey]?.label ?? trace.segment} · objetivo{' '}
              {trace.targetWeightPct.toFixed(0)}%
            </div>
            <table className="w-full font-mono text-xs">
              <tbody>
                {trace.candidates.slice(0, 8).map((c) => (
                  <tr
                    key={c.ticker}
                    className={`border-t border-stone-900 ${c.selected ? 'bg-emerald-500/10' : c.liquid ? '' : 'opacity-40'}`}
                  >
                    <td className="w-24 px-3 py-1.5">
                      <span className={c.selected ? 'font-bold text-emerald-300' : 'text-stone-200'}>
                        {c.selected ? '✓ ' : ''}
                        {c.ticker}
                      </span>
                    </td>
                    <td className="w-12 px-1 py-1.5">
                      <span
                        className="rounded px-1 text-[9px] text-stone-950"
                        style={{ background: FAMILY_META[c.family].color }}
                      >
                        {FAMILY_META[c.family].short}
                      </span>
                    </td>
                    <td className="w-14 px-2 py-1.5 text-right text-stone-400">{c.months.toFixed(0)}m</td>
                    <td className="w-16 px-2 py-1.5 text-right text-stone-300">{c.tirPct.toFixed(1)}%</td>
                    <td className="px-3 py-1.5 leading-snug text-stone-400">{c.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {trace.candidates.length > 8 && (
              <p className="px-3 py-1.5 font-mono text-[10px] text-stone-600">
                +{trace.candidates.length - 8} candidatos más en la pestaña Asignación de la terminal.
              </p>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

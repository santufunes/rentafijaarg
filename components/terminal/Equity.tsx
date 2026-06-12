'use client';

import { useMemo, useState } from 'react';
import { EQUITY_UNIVERSE, type EquityMeta } from '@/lib/core/portfolios';
import type { Quote } from '@/lib/engine/types';
import { fmtArs, fmtPct } from '@/lib/format';

type SortKey = 'turnover' | 'vol1yPct' | 'ret1yPct' | 'ret3mPct' | 'maxDd1yPct' | 'ticker';

export default function Equity({ quotes }: { quotes: Map<string, Quote> }) {
  const [kind, setKind] = useState<'todas' | 'accion' | 'cedear'>('todas');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('turnover');
  const [desc, setDesc] = useState(true);

  const rows = useMemo(() => {
    let out = EQUITY_UNIVERSE.map((m) => {
      const q = quotes.get(m.ticker);
      return { ...m, px: q?.last ?? m.lastClose ?? 0, turnover: (q?.volume ?? 0) * (q?.last ?? 0) };
    }).filter((r) => r.px > 0);
    if (kind !== 'todas') out = out.filter((r) => r.kind === kind);
    if (search.trim()) {
      const s = search.trim().toUpperCase();
      out = out.filter((r) => r.ticker.includes(s) || r.name.toUpperCase().includes(s) || r.sector.toUpperCase().includes(s));
    }
    return out.sort((a, b) => {
      const va = (a as any)[sortKey] ?? -Infinity;
      const vb = (b as any)[sortKey] ?? -Infinity;
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : Number(va) - Number(vb);
      return desc ? -cmp : cmp;
    });
  }, [quotes, kind, search, sortKey, desc]);

  const TH = ({ k, label }: { k: SortKey; label: string }) => (
    <th
      onClick={() => (k === sortKey ? setDesc(!desc) : (setSortKey(k), setDesc(true)))}
      className="cursor-pointer px-2 py-2 text-right hover:text-stone-300"
    >
      {label}
      {sortKey === k && (desc ? ' ↓' : ' ↑')}
    </th>
  );

  if (EQUITY_UNIVERSE.length === 0)
    return (
      <p className="rounded-lg border border-stone-800 p-8 text-center font-mono text-sm text-stone-500">
        Universo equity aún no generado (npm run equity).
      </p>
    );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar ticker / empresa / sector…"
          className="w-60 rounded-md border border-stone-700 bg-stone-900 px-2 py-1 font-mono text-xs outline-none placeholder:text-stone-600 focus:border-emerald-500"
        />
        {(['todas', 'accion', 'cedear'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`rounded-md px-2.5 py-1 font-mono text-xs transition ${
              kind === k ? 'bg-emerald-500/15 text-emerald-300' : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            {k === 'todas' ? 'TODAS' : k === 'accion' ? 'ACCIONES' : 'CEDEARS'}
          </button>
        ))}
        <span className="ml-auto font-mono text-[11px] text-stone-600">
          {rows.length} papeles · stats sobre 1 año de historia real
        </span>
      </div>
      <div className="mt-3 max-h-[70vh] overflow-auto rounded-lg border border-stone-800">
        <table className="w-full font-mono text-xs">
          <thead className="sticky top-0 z-10 bg-stone-900 text-[11px] uppercase text-stone-500">
            <tr>
              <th className="px-2 py-2 text-left">Ticker</th>
              <th className="px-2 py-2 text-left">Empresa · sector</th>
              <th className="px-2 py-2 text-right">Px ARS</th>
              <TH k="turnover" label="Vol ARS/día" />
              <TH k="vol1yPct" label="Vol 1a" />
              <TH k="ret3mPct" label="Ret 3m" />
              <TH k="ret1yPct" label="Ret 1a" />
              <TH k="maxDd1yPct" label="Peor caída" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={r.ticker} className={`border-t border-stone-900 ${idx % 2 === 1 ? 'bg-stone-900/30' : ''}`}>
                <td className="px-2 py-1.5">
                  <span className="font-bold text-stone-100">{r.ticker}</span>{' '}
                  <span className={`rounded px-1 text-[9px] text-stone-950 ${r.kind === 'accion' ? 'bg-sky-400' : 'bg-amber-400'}`}>
                    {r.kind === 'accion' ? 'AR' : 'CED'}
                  </span>
                </td>
                <td className="max-w-xs truncate px-2 py-1.5 text-stone-400">
                  {r.name} <span className="text-stone-600">· {r.sector}</span>
                </td>
                <td className="px-2 py-1.5 text-right text-stone-200">{fmtArs(r.px)}</td>
                <td className="px-2 py-1.5 text-right text-stone-400">
                  {r.turnover >= 1e9 ? `${(r.turnover / 1e9).toFixed(1)}B` : `${Math.round(r.turnover / 1e6)}M`}
                </td>
                <td className="px-2 py-1.5 text-right text-stone-300">{r.vol1yPct !== null ? fmtPct(r.vol1yPct, 0) : '—'}</td>
                <Cell v={r.ret3mPct ?? null} />
                <Cell v={r.ret1yPct} />
                <td className="px-2 py-1.5 text-right text-red-400">{r.maxDd1yPct !== null ? fmtPct(r.maxDd1yPct, 0) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ v }: { v: number | null }) {
  return (
    <td className={`px-2 py-1.5 text-right ${(v ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-400'}`}>
      {v !== null ? fmtPct(v, 0) : '—'}
    </td>
  );
}

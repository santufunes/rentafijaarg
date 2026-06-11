'use client';

import { useMemo, useState } from 'react';
import { FAMILY_META } from '@/lib/familyMeta';
import type { TerminalRow } from '@/lib/terminal';
import { fmtDate, fmtNum } from '@/lib/format';
import type { Family } from '@/lib/engine/types';

type SortKey = 'months' | 'tirPct' | 'mdYears' | 'turnoverArs' | 'ticker' | 'temPct';

const COLUMNS: { key: SortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'ticker', label: 'Ticker', align: 'left' },
  { key: 'months', label: 'Vence', align: 'right' },
  { key: 'tirPct', label: 'TIR', align: 'right' },
  { key: 'temPct', label: 'TEM', align: 'right' },
  { key: 'mdYears', label: 'MD', align: 'right' },
  { key: 'turnoverArs', label: 'Vol ARS/día', align: 'right' },
];

export default function Screener({
  rows,
  selected,
  onToggle,
  onSimulate,
}: {
  rows: TerminalRow[];
  selected: string[];
  onToggle: (ticker: string) => void;
  onSimulate: (ticker: string) => void;
}) {
  const [families, setFamilies] = useState<Set<Family>>(new Set());
  const [search, setSearch] = useState('');
  const [onlyLiquid, setOnlyLiquid] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('months');
  const [sortDesc, setSortDesc] = useState(false);
  const [detail, setDetail] = useState<TerminalRow | null>(null);

  const allFamilies = useMemo(
    () => [...new Set(rows.map((r) => r.family))] as Family[],
    [rows],
  );

  const filtered = useMemo(() => {
    let out = rows;
    if (families.size > 0) out = out.filter((r) => families.has(r.family));
    if (onlyLiquid) out = out.filter((r) => r.liquid);
    if (search.trim()) {
      const q = search.trim().toUpperCase();
      out = out.filter(
        (r) =>
          r.ticker.includes(q) ||
          r.name.toUpperCase().includes(q) ||
          (r.issuer ?? '').toUpperCase().includes(q),
      );
    }
    return [...out].sort((a, b) => {
      const va = a[sortKey] ?? -Infinity;
      const vb = b[sortKey] ?? -Infinity;
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : Number(va) - Number(vb);
      return sortDesc ? -cmp : cmp;
    });
  }, [rows, families, search, onlyLiquid, sortKey, sortDesc]);

  function toggleFamily(f: Family) {
    setFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }

  function clickSort(k: SortKey) {
    if (k === sortKey) setSortDesc((d) => !d);
    else {
      setSortKey(k);
      setSortDesc(k === 'tirPct' || k === 'turnoverArs');
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div>
        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar ticker / emisor…"
            className="w-48 rounded-md border border-stone-700 bg-stone-900 px-2 py-1 font-mono text-xs outline-none placeholder:text-stone-600 focus:border-emerald-500"
          />
          {allFamilies.map((f) => (
            <button
              key={f}
              onClick={() => toggleFamily(f)}
              className={`rounded-full border px-2 py-0.5 font-mono text-[11px] transition ${
                families.size === 0 || families.has(f)
                  ? 'border-transparent text-stone-950'
                  : 'border-stone-700 text-stone-500'
              }`}
              style={
                families.size === 0 || families.has(f)
                  ? { background: FAMILY_META[f].color }
                  : undefined
              }
            >
              {FAMILY_META[f].short}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-stone-400">
            <input
              type="checkbox"
              checked={onlyLiquid}
              onChange={(e) => setOnlyLiquid(e.target.checked)}
              className="accent-emerald-500"
            />
            solo líquidos
          </label>
          <button
            onClick={() => exportCsv(filtered)}
            className="rounded-md border border-stone-700 px-2 py-1 font-mono text-[11px] text-stone-400 hover:border-emerald-600 hover:text-emerald-300"
          >
            ⬇ CSV
          </button>
        </div>

        {/* Tabla */}
        <div className="mt-3 max-h-[70vh] overflow-auto rounded-lg border border-stone-800">
          <table className="w-full font-mono text-xs">
            <thead className="sticky top-0 z-10 bg-stone-900 text-[11px] uppercase text-stone-500">
              <tr>
                <th className="px-2 py-2"></th>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    onClick={() => clickSort(c.key)}
                    className={`cursor-pointer px-2 py-2 hover:text-stone-300 ${
                      c.align === 'right' ? 'text-right' : 'text-left'
                    }`}
                  >
                    {c.label}
                    {sortKey === c.key && (sortDesc ? ' ↓' : ' ↑')}
                  </th>
                ))}
                <th className="px-2 py-2 text-right">Px ARS</th>
                <th className="px-2 py-2 text-right">Px USD</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, idx) => (
                <tr
                  key={r.ticker}
                  onClick={() => setDetail(r)}
                  className={`group cursor-pointer border-t border-stone-900 transition hover:bg-stone-900 ${
                    detail?.ticker === r.ticker ? 'bg-stone-900' : idx % 2 === 1 ? 'bg-stone-900/30' : ''
                  } ${r.liquid ? '' : 'opacity-50'}`}
                >
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={selected.includes(r.ticker)}
                      onChange={() => onToggle(r.ticker)}
                      onClick={(e) => e.stopPropagation()}
                      className="accent-emerald-500"
                      aria-label={`Comparar ${r.ticker}`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="font-semibold text-stone-100">{r.ticker}</span>{' '}
                    <span
                      className="rounded px-1 text-[10px] text-stone-950"
                      style={{ background: FAMILY_META[r.family].color }}
                    >
                      {FAMILY_META[r.family].short}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right text-stone-300">
                    {fmtDate(r.maturity)}
                    <span className="ml-1 text-stone-600">({r.months.toFixed(0)}m)</span>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {r.family === 'dual_tamar' && r.tirPct < -5 ? (
                      // el piso fijo está lejos de ser el leg ganador: la TIR
                      // del piso no describe el rendimiento esperado
                      <span className="text-stone-500" title="El leg TAMAR domina: la TIR del piso fijo no es representativa">
                        n/d <span className="text-[10px] text-stone-600">TAMAR</span>
                      </span>
                    ) : (
                      <>
                        <span className={r.tirPct >= 0 ? 'text-emerald-300' : 'text-red-400'}>
                          {r.tirPct.toFixed(2)}%
                        </span>
                        <span className="ml-1 text-[10px] text-stone-600">{r.tirKind}</span>
                      </>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right text-stone-300">
                    {r.temPct !== null ? `${r.temPct.toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right text-stone-300">{r.mdYears.toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-right text-stone-400">
                    {r.turnoverArs >= 1e9
                      ? `${(r.turnoverArs / 1e9).toFixed(1)}B`
                      : r.turnoverArs >= 1e6
                        ? `${(r.turnoverArs / 1e6).toFixed(0)}M`
                        : `${(r.turnoverArs / 1e3).toFixed(0)}k`}
                  </td>
                  <td className="px-2 py-1.5 text-right text-stone-300">
                    {r.pxArs !== null ? fmtNum(r.pxArs) : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right text-stone-300">
                    {r.pxUsd !== null ? r.pxUsd.toFixed(2) : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSimulate(r.ticker);
                      }}
                      className="invisible rounded border border-emerald-700 px-1.5 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/15 group-hover:visible"
                      title={`Simular inversión en ${r.ticker}`}
                    >
                      SIM
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 font-mono text-[11px] text-stone-600">
          {filtered.length} instrumentos · TIR efectiva anual act/365 sobre precio sucio · CER en
          términos reales · duales valuados al piso fijo · filas opacas = sin liquidez para
          propuestas
        </p>
      </div>

      {/* Panel de detalle */}
      <DetailPanel row={detail} />
    </div>
  );
}

function exportCsv(rows: TerminalRow[]) {
  const header = 'ticker,familia,emisor,vencimiento,meses,tir_pct,tipo_tir,tem_pct,md_anios,vol_ars_dia,px_ars,px_usd,liquido';
  const lines = rows.map((r) =>
    [
      r.ticker,
      r.family,
      `"${(r.issuer ?? '').replace(/"/g, '')}"`,
      r.maturity,
      r.months.toFixed(1),
      r.tirPct.toFixed(3),
      r.tirKind,
      r.temPct?.toFixed(3) ?? '',
      r.mdYears.toFixed(3),
      Math.round(r.turnoverArs),
      r.pxArs ?? '',
      r.pxUsd ?? '',
      r.liquid ? 1 : 0,
    ].join(','),
  );
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rentafija_screener_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function DetailPanel({ row }: { row: TerminalRow | null }) {
  if (!row)
    return (
      <div className="hidden rounded-lg border border-stone-800 p-4 font-mono text-xs text-stone-600 lg:block">
        Clic en una fila para ver flujos, fuentes y detalle del instrumento.
      </div>
    );
  const i = row.priced.instrument;
  return (
    <div className="rounded-lg border border-stone-800 p-4 font-mono text-xs">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-bold text-stone-100">{row.ticker}</h3>
        <span
          className="rounded px-1.5 py-0.5 text-[10px] text-stone-950"
          style={{ background: FAMILY_META[row.family].color }}
        >
          {FAMILY_META[row.family].label}
        </span>
      </div>
      <p className="mt-1 leading-snug text-stone-400">{row.name}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-stone-300">
        {i.issuer && (
          <>
            <dt className="text-stone-600">Emisor</dt>
            <dd>{i.issuer}</dd>
          </>
        )}
        {i.law && (
          <>
            <dt className="text-stone-600">Ley</dt>
            <dd>{i.law}</dd>
          </>
        )}
        <dt className="text-stone-600">Vence</dt>
        <dd>{fmtDate(row.maturity)}</dd>
        <dt className="text-stone-600">TIR ({row.tirKind})</dt>
        <dd className={row.tirPct >= 0 ? 'text-emerald-300' : 'text-red-400'}>
          {row.tirPct.toFixed(2)}%
        </dd>
        <dt className="text-stone-600">MD</dt>
        <dd>{row.mdYears.toFixed(2)} años</dd>
        <dt className="text-stone-600">Lote mín.</dt>
        <dd>{i.minLot || 1} VN</dd>
        <dt className="text-stone-600">Tickers</dt>
        <dd>
          {[i.tickers.ars, i.tickers.mep, i.tickers.cable].filter(Boolean).join(' / ')}
        </dd>
      </dl>
      <h4 className="mt-4 text-[11px] uppercase text-stone-500">
        Flujos remanentes (por 100 VN, {i.payCcy})
      </h4>
      <div className="mt-1 max-h-56 overflow-y-auto">
        <table className="w-full">
          <tbody>
            {row.priced.projectedCashflows.map((cf) => (
              <tr key={cf.date} className="border-t border-stone-900">
                <td className="py-1 text-stone-400">{fmtDate(cf.date)}</td>
                <td className="py-1 text-right text-stone-200">{cf.amount.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {row.family === 'boncer' && (
        <p className="mt-2 leading-snug text-stone-600">
          Flujos proyectados con la senda REM; la TIR mostrada es real (sobre CER).
        </p>
      )}
      {row.family === 'dual_tamar' && (
        <p className="mt-2 leading-snug text-stone-600">
          Valuado al piso fijo: el leg TAMAR solo puede mejorar el pago final.
        </p>
      )}
      {(i.sources ?? []).length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] uppercase text-stone-500">
            Fuentes ({i.sources!.length})
          </summary>
          <ul className="mt-1 space-y-1 break-all text-[10px] text-stone-500">
            {i.sources!.slice(0, 6).map((s) => (
              <li key={s}>
                <a href={s} target="_blank" rel="noreferrer" className="hover:text-emerald-400">
                  {s}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

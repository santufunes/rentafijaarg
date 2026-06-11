'use client';

import { useEffect, useMemo, useState } from 'react';
import Allocation from '@/components/terminal/Allocation';
import Compare from '@/components/terminal/Compare';
import Curves from '@/components/terminal/Curves';
import Screener from '@/components/terminal/Screener';
import {
  INSTRUMENTS,
  toMarketContext,
  toQuotesMap,
  type MarketPayload,
} from '@/lib/data/registry';
import { buildRows } from '@/lib/terminal';
import { fmtArs } from '@/lib/format';

const TABS = [
  { key: 'pantalla', label: 'Pantalla' },
  { key: 'curvas', label: 'Curvas' },
  { key: 'comparar', label: 'Comparar' },
  { key: 'asignacion', label: 'Asignación' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function Terminal() {
  const [market, setMarket] = useState<MarketPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('pantalla');
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/market')
      .then((r) => r.json())
      .then(setMarket)
      .catch((e) => setError(String(e)));
  }, []);

  const data = useMemo(() => {
    if (!market) return null;
    const quotes = toQuotesMap(market);
    const ctx = toMarketContext(market);
    return { ...buildRows(INSTRUMENTS, quotes, ctx), quotes, ctx };
  }, [market]);

  function toggleSelect(ticker: string) {
    setSelected((prev) =>
      prev.includes(ticker)
        ? prev.filter((t) => t !== ticker)
        : prev.length >= 4
          ? prev
          : [...prev, ticker],
    );
  }

  return (
    <div className="-mx-4 -my-8 min-h-screen bg-stone-950 px-4 py-6 text-stone-100">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-mono text-lg font-bold tracking-tight">
              TERMINAL <span className="text-emerald-400">RENTA FIJA</span>
            </h1>
            {market && data && (
              <p className="font-mono text-xs text-stone-400">
                {data.rows.length} instrumentos · liq. {data.settlement} (T+1) · MEP{' '}
                {fmtArs(market.mep)} · A3500 {fmtArs(market.a3500)} ·{' '}
                {market.source === 'live' ? (
                  <span className="text-emerald-400">DATOS EN VIVO (~20 min)</span>
                ) : (
                  <span className="text-amber-400">SNAPSHOT {market.asOf}</span>
                )}
              </p>
            )}
          </div>
          <nav className="flex gap-1 rounded-lg border border-stone-800 p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-md px-3 py-1.5 font-mono text-xs transition ${
                  tab === t.key
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'text-stone-400 hover:text-stone-200'
                }`}
              >
                {t.label.toUpperCase()}
                {t.key === 'comparar' && selected.length > 0 && (
                  <span className="ml-1 text-emerald-400">({selected.length})</span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {error && (
          <p className="mt-6 rounded-lg bg-red-950 p-4 font-mono text-sm text-red-300">{error}</p>
        )}
        {!market && !error && (
          <p className="mt-10 text-center font-mono text-sm text-stone-500">
            Cargando precios de mercado…
          </p>
        )}

        {data && (
          <div className="mt-5">
            {tab === 'pantalla' && (
              <Screener rows={data.rows} selected={selected} onToggle={toggleSelect} />
            )}
            {tab === 'curvas' && <Curves rows={data.rows} />}
            {tab === 'comparar' && (
              <Compare
                rows={data.rows.filter((r) => selected.includes(r.ticker))}
                onRemove={toggleSelect}
              />
            )}
            {tab === 'asignacion' && <Allocation quotes={data.quotes} ctx={data.ctx} />}
          </div>
        )}
      </div>
    </div>
  );
}

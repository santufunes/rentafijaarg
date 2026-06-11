'use client';

import { JetBrains_Mono } from 'next/font/google';
import { useEffect, useMemo, useState } from 'react';
import Allocation from '@/components/terminal/Allocation';
import Compare from '@/components/terminal/Compare';
import Curves from '@/components/terminal/Curves';
import Screener from '@/components/terminal/Screener';
import Simulator from '@/components/terminal/Simulator';
import {
  INSTRUMENTS,
  toMarketContext,
  toQuotesMap,
  type MarketPayload,
} from '@/lib/data/registry';
import { buildRows } from '@/lib/terminal';
import { fmtArs, fmtNum } from '@/lib/format';

const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '700'] });

const TABS = [
  { key: 'pantalla', label: 'Pantalla' },
  { key: 'curvas', label: 'Curvas' },
  { key: 'simulador', label: 'Simulador' },
  { key: 'comparar', label: 'Comparar' },
  { key: 'asignacion', label: 'Asignación' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function tabFromHash(): TabKey {
  if (typeof window === 'undefined') return 'pantalla';
  const h = window.location.hash.replace('#', '');
  return (TABS.find((t) => t.key === h)?.key ?? 'pantalla') as TabKey;
}

export default function Terminal() {
  const [market, setMarket] = useState<MarketPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTabState] = useState<TabKey>('pantalla');
  const [selected, setSelected] = useState<string[]>([]);
  const [simTicker, setSimTicker] = useState<string | undefined>(undefined);

  useEffect(() => {
    setTabState(tabFromHash());
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener('hashchange', onHash);
    fetch('/api/market')
      .then((r) => r.json())
      .then(setMarket)
      .catch((e) => setError(String(e)));
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function setTab(t: TabKey) {
    setTabState(t);
    window.history.replaceState(null, '', `#${t}`);
  }

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

  function simulateTicker(ticker: string) {
    setSimTicker(ticker);
    setTab('simulador');
  }

  const dataAgeMin = market
    ? Math.max(0, Math.round((Date.now() - Date.parse(market.timestamp)) / 60_000))
    : null;
  const lastCer = market?.cerHistory.filter((c) => Date.parse(c.date) <= Date.now()).at(-1);

  return (
    <div className={`${mono.className} -mx-4 -my-8 min-h-screen bg-stone-950 px-0 py-0 text-stone-100`}>
      {/* Cinta de mercado */}
      <div className="overflow-x-auto whitespace-nowrap border-b border-stone-800 bg-stone-900/60 px-4 py-1.5 text-[11px]">
        {market && data ? (
          <div className="flex gap-6">
            <Tape label="MEP" value={fmtArs(market.mep)} />
            <Tape label="A3500" value={fmtArs(market.a3500)} />
            {lastCer && <Tape label="CER" value={fmtNum(lastCer.value)} />}
            <Tape label="LIQ" value={`${data.settlement} (T+1)`} />
            <Tape label="INSTRUMENTOS" value={String(data.rows.length)} />
            <span className={market.source === 'live' ? 'text-emerald-400' : 'text-amber-400'}>
              {market.source === 'live'
                ? `● EN VIVO · datos de hace ${dataAgeMin ?? '?'} min (feed ~20 min demorado)`
                : `● SNAPSHOT ${market.asOf}`}
            </span>
          </div>
        ) : (
          <span className="text-stone-600">conectando con el mercado…</span>
        )}
      </div>

      <div className="mx-auto max-w-7xl px-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-bold tracking-tight">
            TERMINAL <span className="text-emerald-400">RENTA FIJA</span>
          </h1>
          <nav className="flex gap-1 rounded-lg border border-stone-800 bg-stone-900/40 p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-md px-3 py-1.5 text-xs transition ${
                  tab === t.key
                    ? 'bg-emerald-500/15 text-emerald-300 shadow-[inset_0_0_0_1px_rgba(16,185,129,.35)]'
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
          <p className="mt-6 rounded-lg bg-red-950 p-4 text-sm text-red-300">{error}</p>
        )}
        {!market && !error && <Skeleton />}

        {data && (
          <div className="mt-5">
            {tab === 'pantalla' && (
              <Screener
                rows={data.rows}
                selected={selected}
                onToggle={toggleSelect}
                onSimulate={simulateTicker}
              />
            )}
            {tab === 'curvas' && <Curves rows={data.rows} />}
            {tab === 'simulador' && (
              <Simulator rows={data.rows} quotes={data.quotes} ctx={data.ctx} initialTicker={simTicker} />
            )}
            {tab === 'comparar' && (
              <Compare
                rows={data.rows.filter((r) => selected.includes(r.ticker))}
                onRemove={toggleSelect}
                quotes={data.quotes}
                ctx={data.ctx}
              />
            )}
            {tab === 'asignacion' && <Allocation quotes={data.quotes} ctx={data.ctx} />}
          </div>
        )}
      </div>
    </div>
  );
}

function Tape({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-stone-400">
      <span className="text-stone-600">{label}</span> <span className="text-stone-200">{value}</span>
    </span>
  );
}

function Skeleton() {
  return (
    <div className="mt-5 animate-pulse space-y-3">
      <div className="h-8 w-1/3 rounded bg-stone-900" />
      <div className="h-64 rounded-lg bg-stone-900" />
      <div className="h-40 rounded-lg bg-stone-900" />
    </div>
  );
}

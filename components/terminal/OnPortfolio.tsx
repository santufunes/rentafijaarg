'use client';

import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { HORIZONS } from '@/lib/builder/profiles';
import {
  buildOnPortfolio,
  CREDIT_PROFILES,
  type CreditProfile,
} from '@/lib/builder/onportfolio';
import { INSTRUMENTS } from '@/lib/data/registry';
import { cashflowCalendar } from '@/lib/engine/portfolio';
import type { MarketContext, Quote } from '@/lib/engine/types';
import { fmtArs, fmtDate, fmtMonth, fmtNum, fmtPct, fmtUsd } from '@/lib/format';

const TIER_COLORS: Record<number, string> = { 1: '#10b981', 2: '#f59e0b', 3: '#ef4444' };

export default function OnPortfolio({
  quotes,
  ctx,
}: {
  quotes: Map<string, Quote>;
  ctx: MarketContext;
}) {
  const [amountText, setAmountText] = useState('10.000.000');
  const [horizon, setHorizon] = useState(24);
  const [credit, setCredit] = useState<CreditProfile>('balanceado');

  const amount = Number(amountText.trim().replace(/\./g, '').replace(/,/g, '.'));
  const amountOk = Number.isFinite(amount) && amount > 0;

  const portfolio = useMemo(() => {
    if (!amountOk) return null;
    try {
      return buildOnPortfolio(INSTRUMENTS, quotes, ctx, {
        amountArs: amount,
        horizonMonths: horizon,
        credit,
        commissionPct: 0.5,
      });
    } catch {
      return null;
    }
  }, [amount, amountOk, horizon, credit, quotes, ctx]);

  const calendar = useMemo(
    () => (portfolio ? cashflowCalendar(portfolio.lines.map((l) => l.position), ctx) : []),
    [portfolio, ctx],
  );

  return (
    <div className="space-y-4">
      {/* Inputs */}
      <div className="grid gap-3 rounded-lg border border-stone-800 p-3 lg:grid-cols-[220px_1fr_1fr]">
        <div>
          <label className="font-mono text-[11px] uppercase text-stone-500">Monto (ARS)</label>
          <input
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            inputMode="numeric"
            className={`mt-1 w-full rounded-md border bg-stone-900 px-2 py-1.5 font-mono text-sm outline-none focus:border-emerald-500 ${
              amountOk ? 'border-stone-700' : 'border-red-500'
            }`}
          />
        </div>
        <div>
          <label className="font-mono text-[11px] uppercase text-stone-500">Horizonte</label>
          <div className="mt-1 flex flex-wrap gap-1">
            {HORIZONS.map((h) => (
              <button
                key={h.months}
                onClick={() => setHorizon(h.months)}
                className={`rounded-md px-2.5 py-1.5 font-mono text-xs transition ${
                  horizon === h.months
                    ? 'bg-emerald-500/15 text-emerald-300 shadow-[inset_0_0_0_1px_rgba(16,185,129,.35)]'
                    : 'border border-stone-800 text-stone-400 hover:text-stone-200'
                }`}
              >
                {h.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="font-mono text-[11px] uppercase text-stone-500">Perfil de crédito</label>
          <div className="mt-1 flex flex-wrap gap-1">
            {CREDIT_PROFILES.map((c) => (
              <button
                key={c.key}
                onClick={() => setCredit(c.key)}
                title={c.description}
                className={`rounded-md px-2.5 py-1.5 font-mono text-xs transition ${
                  credit === c.key
                    ? 'bg-emerald-500/15 text-emerald-300 shadow-[inset_0_0_0_1px_rgba(16,185,129,.35)]'
                    : 'border border-stone-800 text-stone-400 hover:text-stone-200'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="mt-1 font-mono text-[10px] leading-snug text-stone-600">
            {CREDIT_PROFILES.find((c) => c.key === credit)?.description}
          </p>
        </div>
      </div>

      {portfolio && portfolio.lines.length > 0 ? (
        <>
          {/* Métricas */}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Metric label="TIR cartera" value={`${portfolio.metrics.tirUsdPct.toFixed(2)}%`} sub="anual en USD" accent />
            <Metric
              label="Spread vs soberanos"
              value={`${portfolio.metrics.avgSpreadBp >= 0 ? '+' : ''}${portfolio.metrics.avgSpreadBp.toFixed(0)} pb`}
              sub="prima de crédito corporativo"
            />
            <Metric label="Duración" value={`${portfolio.metrics.durationYears.toFixed(2)} años`} sub="modificada, ponderada" />
            <Metric label="Emisores" value={String(portfolio.metrics.issuers)} sub={`${portfolio.lines.length} líneas · máx 25% c/u`} />
            <Metric label="Invertido" value={fmtArs(portfolio.totalInvestedArs)} sub={`costos ${fmtArs(portfolio.estimatedFeesArs)}`} />
          </div>

          {/* Escalera */}
          <div className="rounded-lg border border-stone-800 p-3">
            <h3 className="font-mono text-[11px] uppercase text-stone-500">
              Escalera de vencimientos (cada peldaño ≈ {fmtPct(100 / portfolio.traces.length, 0)} de la cartera)
            </h3>
            <div className="mt-3 space-y-2">
              {portfolio.lines.map((l) => {
                const months =
                  (Date.parse(l.position.priced.instrument.maturity) - Date.parse(ctx.asOf)) / 86_400_000 / 30.44;
                const pct = Math.min(100, (months / Math.max(horizon * 1.2, 1)) * 100);
                return (
                  <div key={l.position.priced.instrument.ticker} className="flex items-center gap-2 font-mono text-xs">
                    <span className="w-14 font-bold text-stone-100">{l.position.priced.instrument.ticker}</span>
                    <span
                      className="rounded px-1 text-[9px] font-bold text-stone-950"
                      style={{ background: TIER_COLORS[l.tier] }}
                      title={l.rating}
                    >
                      T{l.tier}
                    </span>
                    <div className="relative h-5 flex-1 overflow-hidden rounded bg-stone-900">
                      <div
                        className="flex h-full items-center justify-end rounded bg-gradient-to-r from-emerald-900/40 to-emerald-500/70 pr-2 text-[10px] text-stone-950"
                        style={{ width: `${pct}%` }}
                      >
                        <span className="font-bold text-emerald-100">
                          {fmtDate(l.position.priced.instrument.maturity)} · {(l.position.priced.tir * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <span className="w-24 text-right text-stone-400">{fmtArs(l.position.investedArs)}</span>
                  </div>
                );
              })}
              {/* marcador de horizonte */}
              <div className="flex items-center gap-2 font-mono text-[10px] text-stone-600">
                <span className="w-14"></span>
                <span className="w-7"></span>
                <div className="relative flex-1">
                  <div
                    className="absolute -top-1 h-2 border-l border-dashed border-stone-500"
                    style={{ left: `${Math.min(100, (horizon / Math.max(horizon * 1.2, 1)) * 100)}%` }}
                  />
                  <div className="pt-1" style={{ marginLeft: `${Math.min(96, (horizon / Math.max(horizon * 1.2, 1)) * 100 - 4)}%` }}>
                    ← tu horizonte ({horizon}m)
                  </div>
                </div>
                <span className="w-24"></span>
              </div>
            </div>
          </div>

          {/* Líneas */}
          <div className="overflow-x-auto rounded-lg border border-stone-800">
            <table className="w-full font-mono text-xs">
              <thead className="bg-stone-900 text-[10px] uppercase text-stone-500">
                <tr>
                  <th className="px-3 py-2 text-left">Peldaño</th>
                  <th className="px-2 py-2 text-left">ON</th>
                  <th className="px-2 py-2 text-left">Emisor / sector</th>
                  <th className="px-2 py-2 text-left">Calificación</th>
                  <th className="px-2 py-2 text-right">Vence</th>
                  <th className="px-2 py-2 text-right">TIR USD</th>
                  <th className="px-2 py-2 text-right">Spread</th>
                  <th className="px-2 py-2 text-right">VN</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.lines.map((l) => {
                  const i = l.position.priced.instrument;
                  return (
                    <tr key={i.ticker} className="border-t border-stone-900 hover:bg-stone-900/60">
                      <td className="px-3 py-2 text-stone-500">#{l.rung}</td>
                      <td className="px-2 py-2 font-bold text-stone-100">{i.ticker}</td>
                      <td className="px-2 py-2 text-stone-300">
                        {i.issuer}
                        <span className="ml-1 text-stone-600">· {i.sector}</span>
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-bold text-stone-950"
                          style={{ background: TIER_COLORS[l.tier] }}
                        >
                          {l.rating}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right text-stone-300">{fmtDate(i.maturity)}</td>
                      <td className="px-2 py-2 text-right text-emerald-300">
                        {(l.position.priced.tir * 100).toFixed(2)}%
                      </td>
                      <td className="px-2 py-2 text-right text-stone-300">
                        {l.spreadBp >= 0 ? '+' : ''}
                        {l.spreadBp.toFixed(0)} pb
                      </td>
                      <td className="px-2 py-2 text-right text-stone-300">{fmtNum(l.position.nominals)}</td>
                      <td className="px-3 py-2 text-right text-stone-200">{fmtArs(l.position.investedArs)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Calendario de cobros */}
          <div className="rounded-lg border border-stone-800 p-3">
            <h3 className="font-mono text-[11px] uppercase text-stone-500">
              Cuándo cobrás (USD, cupones + amortizaciones)
            </h3>
            <div className="mt-2 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={calendar.map((b) => ({ month: fmtMonth(b.month), USD: Math.round(b.usd) }))}
                  margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#292524" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#78716c' }} tickLine={false} axisLine={false} />
                  <YAxis
                    tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                    tick={{ fontSize: 10, fill: '#78716c' }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                  />
                  <Tooltip
                    formatter={(v) => fmtUsd(Number(v))}
                    contentStyle={{ background: '#1c1917', border: '1px solid #44403c', fontFamily: 'monospace', fontSize: 12 }}
                  />
                  <Bar isAnimationActive={false} dataKey="USD" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Por qué cada peldaño */}
          {portfolio.traces.map((trace) => (
            <div key={trace.rung} className="rounded-lg border border-stone-800">
              <div className="border-b border-stone-800 px-3 py-2 font-mono text-xs font-bold uppercase text-stone-300">
                Peldaño #{trace.rung} <span className="font-normal text-stone-500">objetivo ~{trace.targetMonths.toFixed(0)} meses</span>
              </div>
              <table className="w-full font-mono text-xs">
                <tbody>
                  {trace.candidates.map((c) => (
                    <tr
                      key={c.ticker}
                      className={`border-t border-stone-900 ${c.selected && c.rung === trace.rung ? 'bg-emerald-500/10' : ''}`}
                    >
                      <td className="w-20 px-3 py-1.5">
                        <span className={c.selected && c.rung === trace.rung ? 'font-bold text-emerald-300' : 'text-stone-200'}>
                          {c.selected && c.rung === trace.rung ? '✓ ' : ''}
                          {c.ticker}
                        </span>
                      </td>
                      <td className="w-24 px-2 py-1.5">
                        <span className="rounded px-1 text-[9px] font-bold text-stone-950" style={{ background: TIER_COLORS[c.tier] }}>
                          {c.rating.slice(0, 12)}
                        </span>
                      </td>
                      <td className="w-16 px-2 py-1.5 text-right text-stone-400">{c.months.toFixed(0)}m</td>
                      <td className="w-20 px-2 py-1.5 text-right text-stone-300">
                        {c.spreadBp >= 0 ? '+' : ''}
                        {c.spreadBp.toFixed(0)} pb
                      </td>
                      <td className="px-3 py-1.5 leading-snug text-stone-400">{c.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {/* Excluidas */}
          {portfolio.excluded.length > 0 && (
            <details className="rounded-lg border border-stone-800 p-3">
              <summary className="cursor-pointer font-mono text-[11px] uppercase text-stone-500">
                ONs fuera del universo elegible ({portfolio.excluded.length})
              </summary>
              <table className="mt-2 w-full font-mono text-xs">
                <tbody>
                  {portfolio.excluded.map((c) => (
                    <tr key={c.ticker} className="border-t border-stone-900">
                      <td className="w-20 px-2 py-1.5 text-stone-300">{c.ticker}</td>
                      <td className="px-2 py-1.5 leading-snug text-stone-500">{c.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          {portfolio.warnings.length > 0 && (
            <div className="space-y-0.5 rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 font-mono text-[11px] text-amber-300">
              {portfolio.warnings.map((w) => (
                <p key={w}>⚠ {w}</p>
              ))}
            </div>
          )}
          <p className="font-mono text-[10px] leading-snug text-stone-600">
            Cobrás en dólares MEP. Spread = TIR de la ON menos la TIR soberana interpolada a igual
            duración. Calificaciones de FIX/Moody's local relevadas de fuentes públicas. No es
            asesoramiento financiero.
          </p>
        </>
      ) : (
        <p className="rounded-lg border border-stone-800 p-8 text-center font-mono text-sm text-stone-500">
          {amountOk
            ? 'No se pudo armar una escalera con este monto/horizonte/perfil — probá relajando el perfil de crédito o subiendo el monto.'
            : 'Ingresá un monto válido.'}
        </p>
      )}
    </div>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? 'border-emerald-800 bg-emerald-500/10' : 'border-stone-800'}`}>
      <div className="font-mono text-[10px] uppercase text-stone-500">{label}</div>
      <div className={`mt-0.5 font-mono text-xl font-bold tabular-nums ${accent ? 'text-emerald-300' : 'text-stone-100'}`}>
        {value}
      </div>
      {sub && <div className="font-mono text-[10px] text-stone-500">{sub}</div>}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import CashflowChart from '@/components/CashflowChart';
import { CORE_PORTFOLIOS, type MixedPortfolio } from '@/lib/core/portfolios';
import {
  INSTRUMENTS,
  toMarketContext,
  toQuotesMap,
  type MarketPayload,
} from '@/lib/data/registry';
import { backtest, type BacktestResult } from '@/lib/equity/backtest';
import { monteCarlo, type McResult } from '@/lib/equity/montecarlo';
import { alignSeries, covarianceMatrix, type PricePoint } from '@/lib/equity/stats';
import { cashflowCalendar } from '@/lib/engine/portfolio';
import type { MarketContext } from '@/lib/engine/types';
import { fmtArs, fmtDate, fmtNum, fmtPct } from '@/lib/format';

interface Histories {
  histories: Record<string, [string, number][]>;
  bondHistories: Record<string, [string, number][]>;
}

const RISK_LABEL = ['', 'Muy conservadora', 'Conservadora', 'Moderada', 'Audaz', 'Agresiva'];

export default function Carteras() {
  const [market, setMarket] = useState<MarketPayload | null>(null);
  const [hist, setHist] = useState<Histories | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [amountText, setAmountText] = useState('10.000.000');
  const [horizon, setHorizon] = useState(24);

  useEffect(() => {
    Promise.all([
      fetch('/api/market').then((r) => r.json()),
      fetch('/api/equity-histories').then((r) => r.json()),
    ])
      .then(([m, h]) => {
        setMarket(m);
        setHist(h);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const amount = Number(amountText.trim().replace(/\./g, '').replace(/,/g, '.'));
  const amountOk = Number.isFinite(amount) && amount > 0;

  const env = useMemo(() => {
    if (!market) return null;
    return { quotes: toQuotesMap(market), ctx: toMarketContext(market) };
  }, [market]);

  const def = CORE_PORTFOLIOS.find((p) => p.key === selected) ?? null;
  // un solo horizonte efectivo para construcción Y analytics
  const effHorizon = def ? Math.max(horizon, def.minHorizonMonths) : horizon;

  const portfolio: MixedPortfolio | null = useMemo(() => {
    if (!env || !def || !amountOk) return null;
    try {
      return def.build(INSTRUMENTS, env.quotes, env.ctx, amount, effHorizon);
    } catch {
      return null;
    }
  }, [env, def, amount, amountOk, effHorizon]);

  const analytics = useMemo(() => {
    if (!portfolio || !env || !hist) return null;
    return computeAnalytics(portfolio, env.ctx, hist, effHorizon);
  }, [portfolio, env, hist, effHorizon]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-stone-100">
          Carteras <span className="text-emerald-400">modelo</span>
        </h1>
        <p className="mt-1 text-stone-400">
          Recetas fijas y auditables sobre todo el universo BYMA: renta fija verificada + acciones y
          CEDEARs seleccionados por liquidez real. Elegí una, poné monto y horizonte, y simulá.
        </p>
      </div>

      {error && <p className="rounded-lg border border-red-900 bg-red-950/50 p-4 text-sm text-red-300">{error}</p>}
      {!market && !error && (
        <div className="animate-pulse space-y-3">
          <div className="h-40 rounded-2xl bg-stone-900" />
          <div className="h-40 rounded-2xl bg-stone-900" />
        </div>
      )}

      {/* Galería */}
      {market && !selected && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CORE_PORTFOLIOS.map((p) => (
            <button
              key={p.key}
              onClick={() => {
                setSelected(p.key);
                setHorizon(Math.max(24, p.minHorizonMonths));
              }}
              className="rounded-2xl border border-stone-800 bg-stone-900/60 p-5 text-left transition hover:border-emerald-700"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-stone-100">{p.name}</h2>
                <RiskDots risk={p.risk} />
              </div>
              <p className="mt-2 text-sm leading-snug text-stone-400">{p.tagline}</p>
              <p className="mt-3 font-mono text-[10px] uppercase text-stone-600">
                {RISK_LABEL[p.risk]} · horizonte mín. {p.minHorizonMonths}m
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Detalle + simulador */}
      {market && def && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <button onClick={() => setSelected(null)} className="text-sm text-stone-500 hover:text-stone-200">
                ← Todas las carteras
              </button>
              <h2 className="mt-1 text-2xl font-bold text-stone-100">{def.name}</h2>
              <p className="font-mono text-xs text-stone-500">{def.rule}</p>
            </div>
            <RiskDots risk={def.risk} />
          </div>

          {/* Controles del simulador */}
          <div className="grid gap-3 rounded-2xl border border-stone-800 bg-stone-900/60 p-4 sm:grid-cols-[220px_1fr]">
            <div>
              <label className="font-mono text-[11px] uppercase text-stone-500">Monto (ARS)</label>
              <input
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                inputMode="numeric"
                className={`mt-1 w-full rounded-md border bg-stone-950 px-2 py-1.5 font-mono text-sm text-stone-100 outline-none focus:border-emerald-500 ${amountOk ? 'border-stone-700' : 'border-red-500'}`}
              />
            </div>
            <div>
              <label className="font-mono text-[11px] uppercase text-stone-500">
                Horizonte: <span className="text-emerald-400">{horizon} meses</span>
                {horizon < def.minHorizonMonths && (
                  <span className="ml-2 text-amber-400">se usa el mínimo de la cartera ({def.minHorizonMonths}m)</span>
                )}
              </label>
              <input
                type="range"
                min={3}
                max={48}
                value={horizon}
                onChange={(e) => setHorizon(Number(e.target.value))}
                className="horizon mt-3 w-full"
                style={{ ['--fill' as never]: `${((horizon - 3) / 45) * 100}%` }}
              />
            </div>
          </div>

          {portfolio && analytics && (
            <>
              {/* Métricas */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Metric label="Invertido" value={fmtArs(portfolio.totalInvestedArs)} sub={`costos ${fmtArs(portfolio.estimatedFeesArs)}`} />
                {analytics.fiTirPct !== null && (
                  <Metric label="TIR tramo renta fija" value={fmtPct(analytics.fiTirPct)} sub={analytics.fiTirLabel} accent={portfolio.eqLines.length === 0} />
                )}
                {/* métricas de backtest solo cuando cubren la mayoría de la cartera */}
                {analytics.bt && analytics.bt.coveredWeight >= 0.5 && (
                  <>
                    <Metric
                      label={`Volatilidad (${analytics.bt.windowMonths}m reales)`}
                      value={fmtPct(analytics.bt.annualizedVolPct)}
                      sub={`backtest sobre ${fmtPct(analytics.bt.coveredWeight * 100, 0)} de la cartera`}
                    />
                    <Metric
                      label={`Peor caída (${analytics.bt.windowMonths}m)`}
                      value={fmtPct(analytics.bt.maxDrawdownPct)}
                      sub="máx. drawdown histórico"
                    />
                  </>
                )}
                {analytics.mc && (
                  <Metric
                    label="Prob. de pérdida"
                    value={fmtPct(analytics.mc.probLossPct, 0)}
                    sub={`en pesos nominales, a ${effHorizon}m (${analytics.mc.paths} escenarios) — no descuenta inflación`}
                    accent={portfolio.eqLines.length > 0}
                  />
                )}
              </div>

              {/* Composición */}
              <section className="rounded-2xl border border-stone-800 bg-stone-900/60 p-5">
                <h3 className="text-lg font-semibold text-stone-100">Composición</h3>
                {portfolio.fi && (
                  <div className="mt-3">
                    <h4 className="font-mono text-[11px] uppercase text-stone-500">
                      Renta fija ({portfolio.fiWeightPct}%)
                    </h4>
                    <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-stone-300">
                      {portfolio.fi.lines.map((l) => (
                        <span key={l.position.priced.instrument.ticker}>
                          {l.position.priced.instrument.ticker}{' '}
                          <span className="text-emerald-300">{fmtPct(l.position.priced.tir * 100)}</span>{' '}
                          <span className="text-stone-600">{fmtDate(l.position.priced.instrument.maturity)}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {portfolio.eqLines.length > 0 && (
                  <div className="mt-4 overflow-x-auto">
                    <h4 className="font-mono text-[11px] uppercase text-stone-500">
                      Renta variable ({portfolio.eqWeightPct}%)
                    </h4>
                    <table className="mt-1 w-full font-mono text-xs">
                      <thead className="text-[10px] uppercase text-stone-600">
                        <tr>
                          <th className="py-1.5 text-left">Ticker</th>
                          <th className="py-1.5 text-left">Empresa · sector</th>
                          <th className="py-1.5 text-right">Cant.</th>
                          <th className="py-1.5 text-right">Precio</th>
                          <th className="py-1.5 text-right">Monto</th>
                          <th className="py-1.5 text-right">Vol 1a</th>
                          <th className="py-1.5 text-right">Ret 1a</th>
                        </tr>
                      </thead>
                      <tbody>
                        {portfolio.eqLines.map((l) => (
                          <tr key={l.meta.ticker} className="border-t border-stone-900">
                            <td className="py-1.5 font-bold text-stone-100">{l.meta.ticker}</td>
                            <td className="py-1.5 text-stone-400">
                              {l.meta.name} <span className="text-stone-600">· {l.meta.sector}</span>
                            </td>
                            <td className="py-1.5 text-right text-stone-300">{fmtNum(l.nominals)}</td>
                            <td className="py-1.5 text-right text-stone-300">{fmtArs(l.priceArs)}</td>
                            <td className="py-1.5 text-right text-stone-200">{fmtArs(l.investedArs)}</td>
                            <td className="py-1.5 text-right text-stone-400">
                              {l.meta.vol1yPct !== null ? fmtPct(l.meta.vol1yPct, 0) : '—'}
                            </td>
                            <td className={`py-1.5 text-right ${(l.meta.ret1yPct ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-400'}`}>
                              {l.meta.ret1yPct !== null ? fmtPct(l.meta.ret1yPct, 0) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Backtest */}
              {analytics.bt && (
                <section className="rounded-2xl border border-stone-800 bg-stone-900/60 p-5">
                  <h3 className="text-lg font-semibold text-stone-100">
                    Últimos {analytics.bt.windowMonths} meses, de verdad
                  </h3>
                  <p className="mt-1 text-sm text-stone-500">
                    Evolución real de $100 en esta cartera (buy & hold, precios históricos de la API;
                    las series de bonos son solo-precio, sin cupones).
                    {analytics.bt.windowMonths < 11 && (
                      <>
                        {' '}La ventana la recorta la serie más corta de la canasta (
                        {analytics.bt.windowDays} ruedas).
                      </>
                    )}
                    {analytics.bt.coveredWeight < 0.999 && (
                      <>
                        {' '}Cubre el {fmtPct(analytics.bt.coveredWeight * 100, 0)} de la cartera — sin historia
                        para: {analytics.bt.excluded.join(', ')} (letras/ONs/BONCER no tienen serie pública).
                      </>
                    )}
                  </p>
                  <div className="mt-3 h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={analytics.bt.dates.map((d, i) => ({ d: d.slice(2), nav: Math.round(analytics.bt!.nav[i] * 10) / 10 }))} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#292524" />
                        <XAxis dataKey="d" tick={{ fontSize: 9, fill: '#78716c' }} tickLine={false} axisLine={false} minTickGap={40} />
                        <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#78716c' }} tickLine={false} axisLine={false} width={44} />
                        <Tooltip contentStyle={{ background: '#1c1917', border: '1px solid #44403c', fontFamily: 'monospace', fontSize: 12 }} />
                        <Line isAnimationActive={false} type="monotone" dataKey="nav" stroke="#10b981" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="font-mono text-[11px] text-stone-500">
                    Retorno {analytics.bt.windowMonths}m: {fmtPct(analytics.bt.totalReturnPct)} · vol{' '}
                    {fmtPct(analytics.bt.annualizedVolPct)} · peor caída {fmtPct(analytics.bt.maxDrawdownPct)}
                  </p>
                </section>
              )}

              {/* Monte Carlo */}
              {analytics.mc && (
                <section className="rounded-2xl border border-stone-800 bg-stone-900/60 p-5">
                  <h3 className="text-lg font-semibold text-stone-100">Los próximos {effHorizon} meses, simulados</h3>
                  <p className="mt-1 text-sm leading-snug text-stone-500">
                    {analytics.mc.paths} escenarios con la volatilidad y correlaciones reales de la
                    historia disponible. Acciones/CEDEARs derivan a la inflación REM con deriva real
                    cero (el cono muestra riesgo, no promete retorno extra); la renta fija devenga su
                    TIR hasta cada vencimiento y después queda en efectivo
                    {portfolio.fi?.lines.some((l) => l.position.priced.instrument.payCcy === 'USD')
                      ? '; el MEP sigue la inflación REM (escenario base)'
                      : ''}
                    .
                  </p>
                  <div className="mt-3 h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={analytics.mc.months.map((m, i) => ({
                          m: `${m}m`,
                          banda: [Math.round(analytics.mc!.p5[i]), Math.round(analytics.mc!.p95[i])],
                          mediana: Math.round(analytics.mc!.p50[i]),
                        }))}
                        margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#292524" />
                        <XAxis dataKey="m" tick={{ fontSize: 9, fill: '#78716c' }} tickLine={false} axisLine={false} minTickGap={30} />
                        <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#78716c' }} tickLine={false} axisLine={false} width={44} />
                        <Tooltip contentStyle={{ background: '#1c1917', border: '1px solid #44403c', fontFamily: 'monospace', fontSize: 12 }} />
                        <Area isAnimationActive={false} dataKey="banda" stroke="none" fill="#10b981" fillOpacity={0.15} />
                        <Line isAnimationActive={false} type="monotone" dataKey="mediana" stroke="#10b981" strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="font-mono text-[11px] text-stone-500">
                    Banda 5%–95% sobre $100 iniciales · mediana {fmtNum(analytics.mc.p50[analytics.mc.p50.length - 1])} ·
                    peor 5%: {fmtNum(analytics.mc.p5[analytics.mc.p5.length - 1])}
                  </p>
                </section>
              )}

              {/* Calendario RF */}
              {portfolio.fi && analytics.calendar.length > 0 && (
                <section className="rounded-2xl border border-stone-800 bg-stone-900/60 p-5">
                  <h3 className="text-lg font-semibold text-stone-100">Cuándo cobra el tramo de renta fija</h3>
                  <CashflowChart calendar={analytics.calendar} />
                </section>
              )}

              {portfolio.warnings.length > 0 && (
                <div className="space-y-0.5 rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 font-mono text-xs text-amber-300">
                  {portfolio.warnings.map((w) => (
                    <p key={w}>⚠ {w}</p>
                  ))}
                </div>
              )}
              <p className="font-mono text-[10px] leading-snug text-stone-600">
                Backtest y simulación con datos reales de data912 (~20 min de demora) sin costos de
                rebalanceo. Rendimiento pasado no garantiza resultados futuros. No es asesoramiento
                financiero. Detalle de cada instrumento en la{' '}
                <a href="/terminal" className="text-emerald-400 hover:underline">TERMINAL</a>.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function computeAnalytics(
  portfolio: MixedPortfolio,
  ctx: MarketContext,
  hist: Histories,
  horizonMonths: number,
) {
  const toSeries = (arr?: [string, number][]): PricePoint[] =>
    (arr ?? []).map(([date, close]) => ({ date, close }));

  // --- backtest: equity + soberanos con historia; el resto declaradamente fuera
  const holdings: { key: string; weight: number; series: PricePoint[] }[] = [];
  const total = portfolio.totalInvestedArs || 1;
  for (const l of portfolio.eqLines)
    holdings.push({ key: l.meta.ticker, weight: l.investedArs / total, series: toSeries(hist.histories[l.meta.ticker]) });
  if (portfolio.fi)
    for (const l of portfolio.fi.lines) {
      const t = l.position.priced.instrument.tickers.ars;
      holdings.push({ key: t, weight: l.position.investedArs / total, series: toSeries(hist.bondHistories[t]) });
    }
  const bt = backtest({ holdings, lookbackDays: 252 });

  // --- Monte Carlo: equity GBM correlacionado + RF determinística
  let mc: McResult | null = null;
  const eqSeries: Record<string, PricePoint[]> = {};
  for (const l of portfolio.eqLines) {
    const s = toSeries(hist.histories[l.meta.ticker]);
    if (s.length > 60) eqSeries[l.meta.ticker] = s.slice(-253);
  }
  const eqKeys = Object.keys(eqSeries);
  const fiLines = portfolio.fi?.lines ?? [];
  const fiSpent = fiLines.reduce((s, l) => s + l.position.investedArs, 0);

  // crecimiento RF: cada línea devenga su TIR (nominal para CER) HASTA su
  // vencimiento — después queda en efectivo, sin reinversión (mismo supuesto
  // conservador que los escenarios). Las líneas USD se proyectan con MEP
  // siguiendo la inflación REM (escenario base), anclada al mes calendario actual.
  const remPath = ctx.remMonthlyPct;
  const nowYm = ctx.asOf.slice(0, 7);
  let remStart = remPath.findIndex((r) => r.month >= nowYm);
  if (remStart < 0) remStart = Math.max(0, remPath.length - 1);
  const inflFactor = (tYears: number) => {
    let f = 1;
    const months = Math.round(tYears * 12);
    for (let m = 0; m < months; m++) {
      const pct = remPath[Math.min(remStart + m, remPath.length - 1)]?.pct ?? 1.5;
      f *= 1 + pct / 100;
    }
    return f;
  };
  const fiGrowth = (tYears: number) => {
    if (fiSpent === 0) return 1;
    let v = 0;
    for (const l of fiLines) {
      const p = l.position.priced;
      const tir = p.instrument.kind === 'cer' ? (p.tirNominal ?? p.tir) : p.tir;
      const isUsd = p.instrument.payCcy === 'USD';
      const yearsToMat = Math.max(
        0,
        (Date.parse(p.instrument.maturity) - Date.parse(ctx.asOf)) / 86_400_000 / 365,
      );
      const accrualYears = Math.min(tYears, yearsToMat);
      v +=
        (l.position.investedArs / fiSpent) *
        Math.pow(1 + tir, accrualYears) *
        (isUsd ? inflFactor(tYears) : 1);
    }
    return v;
  };

  if (eqKeys.length > 0 || fiSpent > 0) {
    const aligned = alignSeries(eqSeries);
    const { cov } = eqKeys.length > 0 ? covarianceMatrix(aligned.closes) : { cov: [] };
    // simetría de escenario: las acciones/CEDEARs derivan a la inflación REM
    // (deriva REAL cero) — el mismo supuesto base que las líneas USD de RF.
    const eqDrift = Math.log(inflFactor(1));
    const assets = eqKeys.map((k) => {
      const l = portfolio.eqLines.find((x) => x.meta.ticker === k)!;
      return { key: k, weight: l.investedArs / total, driftAnnual: eqDrift };
    });
    mc = monteCarlo(assets, cov, { weight: fiSpent / total, growth: fiGrowth }, horizonMonths);
  }

  // --- TIR del tramo RF
  let fiTirPct: number | null = null;
  let fiTirLabel = '';
  if (portfolio.fi && fiSpent > 0) {
    fiTirPct = fiLines.reduce((s, l) => s + l.position.priced.tir * 100 * (l.position.investedArs / fiSpent), 0);
    fiTirLabel = 'usd' in portfolio.fi ? 'anual en USD' : 'mezcla ARS/real/USD por tramo';
  }

  const calendar = portfolio.fi ? cashflowCalendar(portfolio.fi.lines.map((l) => l.position), ctx) : [];

  return { bt, mc, fiTirPct, fiTirLabel, calendar };
}

function RiskDots({ risk }: { risk: number }) {
  return (
    <span className="flex gap-0.5" title={`Riesgo ${risk}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`h-2 w-2 rounded-full ${i <= risk ? 'bg-emerald-400' : 'bg-stone-700'}`} />
      ))}
    </span>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? 'border-emerald-800 bg-emerald-500/10' : 'border-stone-800 bg-stone-900/60'}`}>
      <div className="font-mono text-[10px] uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 font-mono text-xl font-bold tabular-nums ${accent ? 'text-emerald-300' : 'text-stone-100'}`}>{value}</div>
      {sub && <div className="text-[11px] text-stone-500">{sub}</div>}
    </div>
  );
}

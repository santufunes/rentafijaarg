'use client';

import { useState } from 'react';
import AllocationDonut from '@/components/AllocationDonut';
import CashflowChart from '@/components/CashflowChart';
import ScenarioCards from '@/components/ScenarioCards';
import LadderStrip from '@/components/proposal/LadderStrip';
import PayoutsInline from '@/components/proposal/PayoutsInline';
import TracesAccordion from '@/components/proposal/TracesAccordion';
import type { Proposal as ProposalType } from '@/lib/builder/construct';
import type { UsdProposal } from '@/lib/builder/usdportfolio';
import { SEGMENT_LABELS, type SegmentKey } from '@/lib/builder/profiles';
import {
  cashflowCalendar,
  runScenarios,
  sleeveMetrics,
  weightedDuration,
} from '@/lib/engine/portfolio';
import type { MarketContext, Quote } from '@/lib/engine/types';
import type { MarketPayload } from '@/lib/data/registry';
import { fmtArs, fmtArs2, fmtDate, fmtNum, fmtPct, fmtUsd } from '@/lib/format';

const TIER_COLORS: Record<number, string> = { 1: '#10b981', 2: '#f59e0b', 3: '#ef4444' };

function isUsdProposal(p: ProposalType | UsdProposal): p is UsdProposal {
  return 'usd' in p;
}

export default function Proposal({
  proposal,
  ctx,
  market,
  quotes,
  onBack,
}: {
  proposal: ProposalType | UsdProposal;
  ctx: MarketContext;
  market: MarketPayload;
  quotes: Map<string, Quote>;
  onBack: () => void;
}) {
  const usd = isUsdProposal(proposal) ? proposal.usd : null;
  const positions = proposal.lines.map((l) => l.position);
  const calendar = cashflowCalendar(positions, ctx);
  const scenarios = runScenarios(positions, proposal.inputs.horizonMonths, ctx);
  const sleeves = usd ? [] : sleeveMetrics(positions);
  const md = usd ? usd.durationYears : weightedDuration(positions);
  const [openPayouts, setOpenPayouts] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button onClick={onBack} className="text-sm text-stone-500 transition hover:text-stone-200">
            ← Cambiar respuestas
          </button>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-stone-100">
            Tu cartera {usd ? 'en dólares' : 'en pesos'}
          </h1>
          <p className="font-mono text-xs text-stone-500">
            {proposal.inputs.horizonMonths} meses · perfil {proposal.inputs.profile} · liquidación{' '}
            {fmtDate(proposal.settlement)} (T+1)
          </p>
        </div>
        <DataBadge market={market} />
      </div>

      {/* Métricas */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Total invertido"
          value={usd ? fmtUsd(proposal.totalInvestedArs / usd.mepUsed) : fmtArs(proposal.totalInvestedArs)}
          sub={usd ? `≈ ${fmtArs(proposal.totalInvestedArs)} (órdenes en pesos)` : undefined}
        />
        {usd ? (
          <>
            <Metric label="TIR de la cartera" value={fmtPct(usd.tirUsdPct)} sub="anual en USD" accent />
            <Metric
              label="Spread vs soberanos"
              value={`${usd.avgSpreadBp >= 0 ? '+' : ''}${usd.avgSpreadBp.toFixed(0)} pb`}
              sub="prima/descuento de crédito"
            />
          </>
        ) : (
          sleeves.map((s) => (
            <Metric
              key={s.segment}
              label={`TIR ${SEGMENT_LABELS[s.segment as SegmentKey].label}`}
              value={fmtPct(s.tir * 100)}
              sub={s.ccyLabel === 'real (CER)' ? 'real, sobre inflación' : `anual en ${s.ccyLabel}`}
            />
          ))
        )}
        <Metric label="Duración modificada" value={`${fmtNum(md)} años`} sub="sensibilidad a tasas" />
      </div>

      {/* Composición */}
      <section className="rounded-2xl border border-stone-800 bg-stone-900/60 p-6">
        <h2 className="text-lg font-semibold text-stone-100">Qué comprás y por qué</h2>
        <div className={`mt-4 grid items-start gap-6 ${usd ? '' : 'lg:grid-cols-[260px_1fr]'}`}>
          {!usd && <AllocationDonut sleeves={sleeves} />}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 text-left font-mono text-[10px] uppercase tracking-wide text-stone-500">
                  <th className="py-2 pr-3">Instrumento</th>
                  {usd && <th className="py-2 pr-3 text-left">Calificación</th>}
                  <th className="py-2 pr-3 text-right">Cantidad (VN)</th>
                  <th className="py-2 pr-3 text-right">Monto</th>
                  <th className="py-2 pr-3 text-right">% </th>
                  <th className="py-2 pr-3 text-right">TIR</th>
                  {usd && <th className="py-2 pr-3 text-right">Spread</th>}
                  <th className="py-2 text-right">Vence</th>
                  <th className="py-2 pl-2"></th>
                </tr>
              </thead>
              <tbody>
                {proposal.lines.map((l) => {
                  const i = l.position.priced.instrument;
                  const isCer = i.kind === 'cer';
                  const extra = usd?.lineExtras[i.ticker];
                  const open = openPayouts === i.ticker;
                  return (
                    <FragmentRow
                      key={i.ticker}
                      open={open}
                      payoutsRow={
                        open && (
                          <tr>
                            <td colSpan={usd ? 9 : 7} className="pb-3">
                              <PayoutsInline
                                ticker={i.ticker}
                                investedArs={l.position.investedArs}
                                nominals={l.position.nominals}
                                quotes={quotes}
                                ctx={ctx}
                              />
                            </td>
                          </tr>
                        )
                      }
                    >
                      <tr className="border-b border-stone-800/60 align-top">
                        <td className="py-3 pr-3">
                          <div className="font-mono font-semibold text-stone-100">{i.ticker}</div>
                          <div className="text-xs text-stone-500">{i.issuer ?? i.name}</div>
                          <div className="mt-1 max-w-sm text-xs leading-snug text-stone-500">
                            {l.rationale}
                          </div>
                        </td>
                        {usd && (
                          <td className="py-3 pr-3">
                            {extra?.rating ? (
                              <span
                                className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold text-stone-950"
                                style={{ background: TIER_COLORS[extra.tier ?? 3] }}
                              >
                                {extra.rating}
                              </span>
                            ) : (
                              <span className="font-mono text-[10px] text-stone-600">soberano/BCRA</span>
                            )}
                          </td>
                        )}
                        <td className="py-3 pr-3 text-right font-mono text-stone-200">
                          {fmtNum(l.position.nominals)}
                          <div className="text-[10px] text-stone-600">
                            a {fmtArs2(l.position.investedArs / (l.position.nominals / 100))}
                          </div>
                        </td>
                        <td className="py-3 pr-3 text-right font-mono text-stone-200">
                          {usd ? fmtUsd(l.position.investedArs / usd.mepUsed) : fmtArs(l.position.investedArs)}
                        </td>
                        <td className="py-3 pr-3 text-right font-mono text-stone-300">
                          {fmtPct((l.position.investedArs / proposal.totalInvestedArs) * 100, 0)}
                        </td>
                        <td className="py-3 pr-3 text-right font-mono text-emerald-300">
                          {fmtPct(l.position.priced.tir * 100)}
                          <div className="text-[10px] text-stone-600">
                            {isCer ? 'real (CER)' : i.payCcy === 'USD' ? 'en USD' : 'en ARS'}
                          </div>
                        </td>
                        {usd && (
                          <td className="py-3 pr-3 text-right font-mono text-stone-300">
                            {extra ? `${extra.spreadBp >= 0 ? '+' : ''}${extra.spreadBp.toFixed(0)} pb` : '—'}
                          </td>
                        )}
                        <td className="py-3 text-right font-mono text-stone-300">{fmtDate(i.maturity)}</td>
                        <td className="py-3 pl-2 text-right">
                          <button
                            onClick={() => setOpenPayouts(open ? null : i.ticker)}
                            className="rounded border border-stone-700 px-1.5 py-0.5 font-mono text-[10px] text-stone-400 transition hover:border-emerald-600 hover:text-emerald-300"
                          >
                            {open ? 'cerrar' : 'pagos'}
                          </button>
                        </td>
                      </tr>
                    </FragmentRow>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-stone-500">
              <span>Efectivo sin invertir: {fmtArs(Math.max(0, proposal.cashLeftArs))}</span>
              <span>
                Costos estimados (comisión {proposal.inputs.commissionPct}% + IVA + derechos):{' '}
                {fmtArs(proposal.estimatedFeesArs)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Escalera (solo USD) */}
      {usd && proposal.lines.length > 1 && (
        <section className="rounded-2xl border border-stone-800 bg-stone-900/60 p-6">
          <h2 className="text-lg font-semibold text-stone-100">Vencimientos vs tu horizonte</h2>
          <p className="mt-1 text-sm text-stone-500">
            La escalera reparte los vencimientos para que el grueso de la cartera no dependa del
            precio de venta.
          </p>
          <div className="mt-4">
            <LadderStrip
              lines={proposal.lines}
              asOf={ctx.asOf}
              horizonMonths={proposal.inputs.horizonMonths}
              extras={usd.lineExtras}
              showUsd
              mep={usd.mepUsed}
            />
          </div>
        </section>
      )}

      {/* Calendario */}
      <section className="rounded-2xl border border-stone-800 bg-stone-900/60 p-6">
        <h2 className="text-lg font-semibold text-stone-100">Cuándo cobrás</h2>
        <p className="mt-1 text-sm text-stone-500">
          {usd
            ? 'Cupones y amortizaciones en dólares MEP (mostrados también al MEP de hoy).'
            : `Pagos proyectados. Los flujos CER usan la senda REM; los pagos en USD se muestran al MEP de hoy (${fmtArs(ctx.mep)}).`}
        </p>
        <CashflowChart calendar={calendar} />
      </section>

      {/* Escenarios */}
      <section className="rounded-2xl border border-stone-800 bg-stone-900/60 p-6">
        <h2 className="text-lg font-semibold text-stone-100">
          ¿Qué pasa con tu plata a los {proposal.inputs.horizonMonths} meses?
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          Tres escenarios sobre inflación, tasas de salida y dólar. Sin reinversión de cupones
          (supuesto conservador).{usd ? ' Para una cartera en dólares, mirá la línea en USD.' : ''}
        </p>
        <ScenarioCards scenarios={scenarios} />
      </section>

      {/* Por qué estos */}
      <TracesAccordion traces={proposal.traces} />

      {/* Ejecución */}
      <section className="rounded-2xl border border-stone-800 bg-stone-900/60 p-6">
        <h2 className="text-lg font-semibold text-stone-100">Cómo ejecutarla en tu broker</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-stone-400">
          <li>
            Abrí tu cuenta en cualquier ALyC (Cocos, IOL, Balanz, Bull Market…) y acreditá{' '}
            {fmtArs(proposal.inputs.amountArs)}
            {usd ? ` (o tus ${fmtUsd(usd.amountUsd)} ya dolarizados)` : ''}.
          </li>
          <li>
            Cargá una orden <strong className="text-stone-200">limitada</strong> por cada línea, con
            el ticker y la cantidad exacta de nominales de la tabla.
          </li>
          <li>
            {usd
              ? 'Todos estos instrumentos pagan en dólar MEP: cupones y amortizaciones te llegan en USD a tu cuenta.'
              : 'Los bonos en dólares (AL30, ONs…) se compran acá en pesos; los cupones los cobrás en dólar MEP.'}
          </li>
          <li>La liquidación estándar es T+1: los títulos aparecen el día hábil siguiente.</li>
        </ol>
        <p className="mt-3 font-mono text-[11px] text-stone-600">
          ¿Querés ver más? Cada instrumento está en la{' '}
          <a href="/terminal" className="text-emerald-400 hover:underline">
            TERMINAL
          </a>{' '}
          con sus flujos, fuentes primarias, curvas y el simulador.
        </p>
        {proposal.warnings.length > 0 && (
          <div className="mt-4 space-y-0.5 rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 font-mono text-xs text-amber-300">
            {proposal.warnings.map((w) => (
              <p key={w}>⚠ {w}</p>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function FragmentRow({
  children,
  payoutsRow,
}: {
  children: React.ReactNode;
  open: boolean;
  payoutsRow: React.ReactNode;
}) {
  return (
    <>
      {children}
      {payoutsRow}
    </>
  );
}

function Metric({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        accent ? 'border-emerald-800 bg-emerald-500/10' : 'border-stone-800 bg-stone-900/60'
      }`}
    >
      <div className="font-mono text-[10px] uppercase tracking-wide text-stone-500">{label}</div>
      <div
        className={`mt-1 font-mono text-2xl font-bold tabular-nums ${accent ? 'text-emerald-300' : 'text-stone-100'}`}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

function DataBadge({ market }: { market: MarketPayload }) {
  const live = market.source === 'live';
  const preopen = market.session === 'preopen';
  return (
    <div
      className={`rounded-full border px-3 py-1 font-mono text-xs ${
        live && !preopen
          ? 'border-emerald-800 bg-emerald-500/10 text-emerald-300'
          : 'border-amber-900 bg-amber-950/40 text-amber-300'
      }`}
    >
      {live
        ? preopen
          ? '● Pre-apertura · precios del último cierre'
          : '● Precios BYMA en vivo (demora ~20 min)'
        : `● Precios al ${market.asOf} (snapshot)`}
    </div>
  );
}

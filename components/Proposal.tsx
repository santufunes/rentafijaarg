'use client';

import AllocationDonut from '@/components/AllocationDonut';
import CashflowChart from '@/components/CashflowChart';
import ScenarioCards from '@/components/ScenarioCards';
import type { Proposal as ProposalType } from '@/lib/builder/construct';
import { SEGMENT_LABELS, type SegmentKey } from '@/lib/builder/profiles';
import {
  cashflowCalendar,
  runScenarios,
  sleeveMetrics,
  weightedDuration,
} from '@/lib/engine/portfolio';
import type { MarketContext } from '@/lib/engine/types';
import type { MarketPayload } from '@/lib/data/registry';
import { fmtArs, fmtArs2, fmtDate, fmtNum, fmtPct, fmtUsd } from '@/lib/format';

export default function Proposal({
  proposal,
  ctx,
  market,
  onBack,
}: {
  proposal: ProposalType;
  ctx: MarketContext;
  market: MarketPayload;
  onBack: () => void;
}) {
  const positions = proposal.lines.map((l) => l.position);
  const sleeves = sleeveMetrics(positions);
  const calendar = cashflowCalendar(positions, ctx);
  const scenarios = runScenarios(positions, proposal.inputs.horizonMonths, ctx);
  const md = weightedDuration(positions);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button onClick={onBack} className="text-sm text-stone-500 hover:text-stone-900">
            ← Cambiar respuestas
          </button>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Tu propuesta de cartera</h1>
          <p className="text-sm text-stone-500">
            {proposal.inputs.horizonMonths} meses · perfil {proposal.inputs.profile} · objetivo en{' '}
            {proposal.inputs.goal} · liquidación {fmtDate(proposal.settlement)} (T+1)
          </p>
        </div>
        <DataBadge market={market} />
      </div>

      {/* Métricas principales */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Total invertido" value={fmtArs(proposal.totalInvestedArs)} />
        {sleeves.map((s) => (
          <Metric
            key={s.segment}
            label={`TIR ${SEGMENT_LABELS[s.segment as SegmentKey].label}`}
            value={fmtPct(s.tir * 100)}
            sub={s.ccyLabel === 'real (CER)' ? 'real, sobre inflación' : `anual en ${s.ccyLabel}`}
          />
        ))}
        <Metric label="Duración modificada" value={`${fmtNum(md)} años`} sub="sensibilidad a tasas" />
      </div>

      {/* Composición */}
      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Qué comprás y por qué</h2>
        <div className="mt-4 grid items-start gap-6 lg:grid-cols-[260px_1fr]">
          <AllocationDonut sleeves={sleeves} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
                  <th className="py-2 pr-3">Instrumento</th>
                  <th className="py-2 pr-3 text-right">Cantidad (VN)</th>
                  <th className="py-2 pr-3 text-right">Precio</th>
                  <th className="py-2 pr-3 text-right">Monto</th>
                  <th className="py-2 pr-3 text-right">% cartera</th>
                  <th className="py-2 pr-3 text-right">TIR</th>
                  <th className="py-2 text-right">Vence</th>
                </tr>
              </thead>
              <tbody>
                {proposal.lines.map((l) => {
                  const i = l.position.priced.instrument;
                  const isCer = i.kind === 'cer';
                  return (
                    <tr key={i.ticker} className="border-b border-stone-100 align-top">
                      <td className="py-3 pr-3">
                        <div className="font-semibold">{i.ticker}</div>
                        <div className="text-xs text-stone-500">{i.name}</div>
                        <div className="mt-1 max-w-xs text-xs leading-snug text-stone-400">
                          {l.rationale}
                        </div>
                      </td>
                      <td className="py-3 pr-3 text-right font-medium">
                        {fmtNum(l.position.nominals)}
                      </td>
                      <td className="py-3 pr-3 text-right">
                        {fmtArs2(l.position.investedArs / (l.position.nominals / 100))}
                        <div className="text-xs text-stone-400">por 100 VN</div>
                      </td>
                      <td className="py-3 pr-3 text-right">{fmtArs(l.position.investedArs)}</td>
                      <td className="py-3 pr-3 text-right">
                        {fmtPct((l.position.investedArs / proposal.totalInvestedArs) * 100, 0)}
                      </td>
                      <td className="py-3 pr-3 text-right">
                        {fmtPct(l.position.priced.tir * 100)}
                        <div className="text-xs text-stone-400">
                          {isCer ? 'real (CER)' : i.payCcy === 'USD' ? 'en USD' : 'en ARS'}
                        </div>
                      </td>
                      <td className="py-3 text-right">{fmtDate(i.maturity)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-stone-500">
              <span>Efectivo sin invertir: {fmtArs(proposal.cashLeftArs)}</span>
              <span>
                Costos estimados (comisión {proposal.inputs.commissionPct}% + IVA + derechos):{' '}
                {fmtArs(proposal.estimatedFeesArs)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Calendario de pagos */}
      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Cuándo cobrás</h2>
        <p className="mt-1 text-sm text-stone-500">
          Pagos proyectados de cupones y amortizaciones. Los flujos CER usan la senda de inflación
          del REM; los pagos en USD se muestran al MEP de hoy ({fmtArs(ctx.mep)}).
        </p>
        <CashflowChart calendar={calendar} />
      </section>

      {/* Escenarios */}
      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">
          ¿Qué pasa con tu plata a los {proposal.inputs.horizonMonths} meses?
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          Tres escenarios sobre inflación, tasas de salida y dólar MEP. Sin reinversión de cupones
          (supuesto conservador). Partís de {fmtArs(proposal.totalInvestedArs)} (
          {fmtUsd(proposal.totalInvestedArs / ctx.mep)} al MEP de hoy).
        </p>
        <ScenarioCards scenarios={scenarios} />
      </section>

      {/* Cómo ejecutar */}
      <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Cómo ejecutarla en tu broker</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-stone-600">
          <li>
            Abrí tu cuenta en cualquier ALyC (Cocos, IOL, Balanz, Bull Market…) y acreditá{' '}
            {fmtArs(proposal.inputs.amountArs)}.
          </li>
          <li>
            Cargá una orden <strong>limitada</strong> por cada línea de la tabla, con el ticker y la
            cantidad exacta de nominales. Usá el precio de la tabla como referencia y ajustá al
            mejor precio de pantalla.
          </li>
          <li>
            Los bonos en dólares (AL30, BOPREAL…) se compran acá <strong>en pesos</strong>; los
            cupones y amortizaciones los cobrás en dólar MEP en tu cuenta.
          </li>
          <li>La liquidación estándar es T+1: los títulos aparecen el día hábil siguiente.</li>
        </ol>
        {proposal.warnings.length > 0 && (
          <div className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            {proposal.warnings.map((w) => (
              <p key={w}>⚠ {w}</p>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-stone-400">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-stone-400">{sub}</div>}
    </div>
  );
}

function DataBadge({ market }: { market: MarketPayload }) {
  const live = market.source === 'live';
  return (
    <div
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        live ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
      }`}
    >
      {live ? '● Precios BYMA en vivo (demora ~20 min)' : `● Precios al ${market.asOf} (snapshot)`}
    </div>
  );
}

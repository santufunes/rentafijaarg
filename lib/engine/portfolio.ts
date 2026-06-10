/**
 * Agregación de cartera: métricas ponderadas, calendario de flujos y escenarios.
 *
 * Decisiones metodológicas (visibles en la página de metodología):
 * - Las TIR solo se promedian dentro de cada moneda/segmento (no se mezcla TIR
 *   USD con TIR ARS en un único número).
 * - Calendario de flujos: USD convertido a ARS al MEP actual (constante), solo
 *   a fines ilustrativos.
 * - Escenarios a horizonte: los cupones cobrados antes del horizonte no se
 *   reinvierten (supuesto conservador); el remanente se valúa a la TIR de
 *   salida del escenario; la senda CER sigue el REM ajustado por el shock del
 *   escenario; el MEP sigue la inflación del escenario más un ajuste real.
 */

import { cerAt, cerRatio } from './cer';
import { addDays, daysBetween, yearFraction } from './dates';
import { presentValue, type DatedAmount } from './solver';
import type { Instrument, MarketContext, PricedInstrument } from './types';

export interface Position {
  priced: PricedInstrument;
  /** Nominales (VN) comprados. */
  nominals: number;
  /** Efectivo invertido en moneda de pago (nominales/100 × precio sucio). */
  investedPayCcy: number;
  /** Equivalente en ARS al MEP/A3500 actual. */
  investedArs: number;
  /** Peso objetivo del segmento al que pertenece. */
  segment: string;
}

export interface SleeveMetrics {
  segment: string;
  ccyLabel: string;
  investedArs: number;
  weight: number;
  /** TIR ponderada del segmento (real para CER). */
  tir: number;
  modifiedDuration: number;
}

export interface CalendarBucket {
  month: string; // YYYY-MM
  ars: number;
  usd: number;
  arsEquivalent: number;
}

export function sleeveMetrics(positions: Position[]): SleeveMetrics[] {
  const totalArs = positions.reduce((s, p) => s + p.investedArs, 0);
  const bySegment = new Map<string, Position[]>();
  for (const p of positions) {
    const arr = bySegment.get(p.segment) ?? [];
    arr.push(p);
    bySegment.set(p.segment, arr);
  }
  return [...bySegment.entries()].map(([segment, ps]) => {
    const inv = ps.reduce((s, p) => s + p.investedArs, 0);
    const tir = ps.reduce((s, p) => s + p.priced.tir * p.investedArs, 0) / inv;
    const md = ps.reduce((s, p) => s + p.priced.modifiedDuration * p.investedArs, 0) / inv;
    const isCer = ps.some((p) => p.priced.instrument.kind === 'cer');
    const isUsd = ps.every((p) => p.priced.instrument.payCcy === 'USD');
    return {
      segment,
      ccyLabel: isCer ? 'real (CER)' : isUsd ? 'USD' : 'ARS',
      investedArs: inv,
      weight: inv / totalArs,
      tir,
      modifiedDuration: md,
    };
  });
}

export function weightedDuration(positions: Position[]): number {
  const total = positions.reduce((s, p) => s + p.investedArs, 0);
  return positions.reduce((s, p) => s + p.priced.modifiedDuration * p.investedArs, 0) / total;
}

/** Calendario mensual de flujos de la cartera. */
export function cashflowCalendar(positions: Position[], ctx: MarketContext): CalendarBucket[] {
  const buckets = new Map<string, CalendarBucket>();
  for (const p of positions) {
    const scale = p.nominals / 100;
    for (const cf of p.priced.projectedCashflows) {
      const month = cf.date.slice(0, 7);
      const b = buckets.get(month) ?? { month, ars: 0, usd: 0, arsEquivalent: 0 };
      const isUsdFlow =
        p.priced.instrument.payCcy === 'USD' || p.priced.instrument.kind === 'dollar_linked';
      if (isUsdFlow) {
        b.usd += cf.amount * scale;
        b.arsEquivalent += cf.amount * scale * ctx.mep;
      } else {
        b.ars += cf.amount * scale;
        b.arsEquivalent += cf.amount * scale;
      }
      buckets.set(month, b);
    }
  }
  return [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month));
}

// ---------------------------------------------------------------------------
// Escenarios
// ---------------------------------------------------------------------------

export interface Scenario {
  key: 'pesimista' | 'base' | 'optimista';
  label: string;
  description: string;
  /** Multiplicador sobre la senda de inflación REM (1 = REM). */
  inflationFactor: number;
  /** Shift paralelo de TIRs de salida, en puntos básicos. */
  exitYieldShiftBp: number;
  /** Ajuste real anual del MEP además de la inflación (+ = depreciación real). */
  mepRealDriftPct: number;
}

export const SCENARIOS: Scenario[] = [
  {
    key: 'pesimista',
    label: 'Pesimista',
    description:
      'Inflación 30% por encima del REM, tasas de salida +250 pb, dólar MEP se deprecia 10% real.',
    inflationFactor: 1.3,
    exitYieldShiftBp: 250,
    mepRealDriftPct: 10,
  },
  {
    key: 'base',
    label: 'Base',
    description:
      'Inflación según consenso REM, tasas de salida sin cambios, MEP estable en términos reales.',
    inflationFactor: 1,
    exitYieldShiftBp: 0,
    mepRealDriftPct: 0,
  },
  {
    key: 'optimista',
    label: 'Optimista',
    description:
      'Inflación 25% por debajo del REM, tasas de salida −150 pb, MEP se aprecia 5% real.',
    inflationFactor: 0.75,
    exitYieldShiftBp: -150,
    mepRealDriftPct: -5,
  },
];

export interface ScenarioResult {
  scenario: Scenario;
  valueArs: number;
  directReturnPct: number;
  annualizedPct: number;
  valueUsd: number;
  usdReturnPct: number;
  mepAtHorizon: number;
}

function scenarioCtx(ctx: MarketContext, factor: number): MarketContext {
  return { ...ctx, remMonthlyPct: ctx.remMonthlyPct.map((r) => ({ ...r, pct: r.pct * factor })) };
}

/** Inflación acumulada entre asOf y horizonte bajo la senda escalada. */
function cumulativeInflation(ctx: MarketContext, horizon: string): number {
  return cerAt(horizon, ctx) / cerAt(ctx.asOf, ctx);
}

function positionValueAtHorizon(
  p: Position,
  horizon: string,
  sc: Scenario,
  sctx: MarketContext,
): { ccy: 'ARS' | 'USD'; value: number } {
  const instr = p.priced.instrument;
  const scale = p.nominals / 100;
  const shift = sc.exitYieldShiftBp / 10_000;

  // Flujos bajo el contexto del escenario (CER reproyectado).
  const flows = reprojectFlows(instr, p.priced.projectedCashflows, sctx);

  let cashReceived = 0;
  const remaining: DatedAmount[] = [];
  for (const cf of flows) {
    if (daysBetween(horizon, cf.date) <= 0) cashReceived += cf.amount;
    else remaining.push(cf);
  }

  let exitValue = 0;
  if (remaining.length > 0) {
    const exitYield = Math.max(-0.99, p.priced.tir + shift);
    // PV a la fecha horizonte (yearFraction desde horizon).
    exitValue = presentValue(remaining, horizon, exitYield);
  }

  const totalPer100 = cashReceived + exitValue;
  const isUsd = instr.payCcy === 'USD' || instr.kind === 'dollar_linked';
  return { ccy: isUsd ? 'USD' : 'ARS', value: totalPer100 * scale };
}

/** Reproyecta flujos CER bajo el contexto del escenario; el resto queda igual. */
function reprojectFlows(
  instr: Instrument,
  original: DatedAmount[],
  sctx: MarketContext,
): DatedAmount[] {
  if (instr.kind !== 'cer') return original;
  return instr.realCashflows
    .filter((cf) => original.some((o) => o.date === cf.date))
    .map((cf) => ({
      date: cf.date,
      amount: (cf.interest + cf.amortization) * cerRatio(cf.date, instr.cerBase, sctx),
    }));
}

export function runScenarios(
  positions: Position[],
  horizonMonths: number,
  ctx: MarketContext,
): ScenarioResult[] {
  const horizon = addDays(ctx.asOf, Math.round(horizonMonths * 30.44));
  const investedArs = positions.reduce((s, p) => s + p.investedArs, 0);
  const years = yearFraction(ctx.asOf, horizon);

  return SCENARIOS.map((sc) => {
    const sctx = scenarioCtx(ctx, sc.inflationFactor);
    const inflation = cumulativeInflation(sctx, horizon);
    const mepAtHorizon =
      ctx.mep * inflation * Math.pow(1 + sc.mepRealDriftPct / 100, years);

    let ars = 0;
    let usd = 0;
    for (const p of positions) {
      const v = positionValueAtHorizon(p, horizon, sc, sctx);
      if (v.ccy === 'USD') usd += v.value;
      else ars += v.value;
    }
    const valueArs = ars + usd * mepAtHorizon;
    const valueUsd = valueArs / mepAtHorizon;
    const investedUsd = investedArs / ctx.mep;
    const direct = valueArs / investedArs - 1;
    return {
      scenario: sc,
      valueArs,
      directReturnPct: direct * 100,
      annualizedPct: (Math.pow(1 + direct, 1 / years) - 1) * 100,
      valueUsd,
      usdReturnPct: (valueUsd / investedUsd - 1) * 100,
      mepAtHorizon,
    };
  });
}

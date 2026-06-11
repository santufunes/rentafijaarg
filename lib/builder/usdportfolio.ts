/**
 * Cartera 100% en dólares (MEP) para el flujo minorista "invierto en USD".
 *
 * Composición = soberanos/BCRA + escalera de ONs según estilo:
 *  - el tramo soberano se elige por estilo (corto/BOPREAL → AL30+tramo medio →
 *    largos) con conciencia de horizonte;
 *  - el tramo corporativo delega en la escalera de ONs (crédito primero,
 *    peldaños por horizonte, spreads sobre la curva soberana, topes de
 *    concentración) — la misma maquinaria de la terminal.
 * Devuelve la MISMA forma `Proposal` del flujo en pesos para que la UI sea una
 * sola, más extras USD (métricas, rating/spread por línea).
 */

import { daysBetween, settlementT1 } from '../engine/dates';
import { priceInstrument } from '../engine/pricing';
import type { Instrument, MarketContext, PricedInstrument, Quote } from '../engine/types';
import { isLiquid, Tracer, type Proposal, type ProposalLine, type SegmentTrace } from './construct';
import { buildOnPortfolio } from './onportfolio';
import { sovereignCurve, spreadBp } from './oncurve';
import { USD_STYLES, type UsdComposition, type UsdStyle } from './profiles';

export interface UsdBuilderInputs {
  amountUsd: number;
  horizonMonths: number;
  style: UsdStyle;
  composition: UsdComposition;
  commissionPct: number;
}

export interface UsdLineExtra {
  rating?: string;
  tier?: number;
  spreadBp: number;
  rung?: number;
}

export interface UsdProposal extends Proposal {
  usd: {
    amountUsd: number;
    mepUsed: number;
    tirUsdPct: number;
    durationYears: number;
    avgSpreadBp: number;
    issuers: number;
    /** extras por ticker (rating/spread/peldaño) para chips de la UI. */
    lineExtras: Record<string, UsdLineExtra>;
  };
}

export function buildUsdPortfolio(
  universe: Instrument[],
  quotes: Map<string, Quote>,
  ctx: MarketContext,
  inputs: UsdBuilderInputs,
): UsdProposal {
  const settlement = settlementT1(ctx.asOf);
  const warnings: string[] = [];
  const amountArs = inputs.amountUsd * ctx.mep;
  const style = USD_STYLES.find((s) => s.key === inputs.style)!;

  const sovShare =
    inputs.composition === 'soberanos' ? 1 : inputs.composition === 'corporativos' ? 0 : style.sovPct / 100;

  const feeRate = (inputs.commissionPct / 100) * 1.21 + 0.0001;

  // --- valuar universo USD -------------------------------------------------
  const priced: PricedInstrument[] = [];
  for (const instr of universe) {
    if (!['soberano_usd', 'bopreal', 'on'].includes(instr.family)) continue;
    const arsQ = quotes.get(instr.tickers.ars);
    if (!arsQ || arsQ.last <= 0) continue;
    try {
      priced.push(priceInstrument(instr, quotes, settlement, ctx));
    } catch {
      /* vencido o sin precio */
    }
  }
  const curve = sovereignCurve(priced);
  const lineExtras: Record<string, UsdLineExtra> = {};
  const lines: ProposalLine[] = [];
  const traces: SegmentTrace[] = [];

  // --- tramo soberano/BCRA -------------------------------------------------
  let sovSpent = 0;
  if (sovShare > 0) {
    const sovUniverse = priced.filter((p) =>
      ['soberano_usd', 'bopreal'].includes(p.instrument.family),
    );
    const tracer = new Tracer(sovUniverse, quotes, ctx.asOf);
    const liquid = sovUniverse.filter((p) => isLiquid(p, quotes));
    const months = (p: PricedInstrument) => daysBetween(ctx.asOf, p.instrument.maturity) / 30.44;

    const picks: { p: PricedInstrument; why: string }[] = [];
    if (inputs.style === 'conservador') {
      // calzado al horizonte si existe; si no, la menor duración disponible
      const within = liquid
        .filter((p) => months(p) <= inputs.horizonMonths + 6)
        .sort((a, b) => b.tir - a.tir);
      const pick =
        within[0] ??
        [...liquid].sort((a, b) => a.modifiedDuration - b.modifiedDuration || b.tir - a.tir)[0];
      if (pick)
        picks.push({
          p: pick,
          why:
            months(pick) <= inputs.horizonMonths + 6
              ? `Vence dentro de tu horizonte: cobrás el flujo completo sin depender del precio de venta. Mejor TIR del tramo (${(pick.tir * 100).toFixed(1)}% USD).`
              : `No hay soberano que venza dentro de tu horizonte: se toma la menor duración disponible (${pick.modifiedDuration.toFixed(1)} años).`,
        });
      const second = liquid
        .filter((p) => p !== pick && p.instrument.family !== pick?.instrument.family)
        .sort((a, b) => a.modifiedDuration - b.modifiedDuration || b.tir - a.tir)[0];
      if (second)
        picks.push({
          p: second,
          why: 'Diversifica emisor público (Tesoro vs BCRA) manteniendo duración corta.',
        });
    } else if (inputs.style === 'moderado') {
      const al30 = liquid.find((p) => p.instrument.ticker === 'AL30') ?? liquid[0];
      if (al30) picks.push({ p: al30, why: 'El soberano más líquido del mercado; ancla de la posición.' });
      const belly = liquid
        .filter((p) => p !== al30 && p.modifiedDuration > (al30?.modifiedDuration ?? 0))
        .sort((a, b) => b.tir - a.tir)[0];
      if (belly)
        picks.push({ p: belly, why: 'Tramo medio: más rendimiento a cambio de más duración.' });
    } else {
      const sorted = [...liquid]
        .filter((p) => p.instrument.family === 'soberano_usd')
        .sort((a, b) => b.modifiedDuration - a.modifiedDuration);
      if (sorted[0])
        picks.push({ p: sorted[0], why: 'Tramo largo: máxima sensibilidad a una compresión del riesgo país.' });
      const second = sorted.slice(1).sort((a, b) => b.tir - a.tir)[0];
      if (second)
        picks.push({ p: second, why: 'Segunda línea larga: diversifica ley y vencimiento.' });
    }

    // sizing del tramo soberano
    const sovBudget = (amountArs / (1 + feeRate)) * sovShare;
    const perLine = sovBudget / Math.max(1, picks.length);
    for (const { p, why } of picks) {
      const pxVN = (quotes.get(p.instrument.tickers.ars)?.last ?? 0) / 100;
      if (pxVN <= 0) continue;
      const nominals = Math.floor(perLine / pxVN);
      if (nominals < 1) {
        warnings.push(`${p.instrument.ticker}: el monto asignado no alcanza para 1 nominal; línea omitida.`);
        continue;
      }
      const investedArs = nominals * pxVN;
      sovSpent += investedArs;
      tracer.select(p, why);
      lines.push({
        position: {
          priced: p,
          nominals,
          investedPayCcy: investedArs / ctx.mep,
          investedArs,
          segment: 'dolar',
        },
        rationale: why,
      });
      lineExtras[p.instrument.ticker] = { spreadBp: spreadBp(p, curve) };
    }
    traces.push({
      segment: 'dolar',
      targetWeightPct: sovShare * 100,
      candidates: tracer.finish('No entró en la combinación duración/TIR del estilo elegido.'),
    });
  }

  // --- tramo corporativo (escalera de ONs) ---------------------------------
  let onFees = 0;
  if (sovShare < 1) {
    const onPortfolio = buildOnPortfolio(universe, quotes, ctx, {
      amountArs: amountArs * (1 - sovShare),
      horizonMonths: inputs.horizonMonths,
      credit: style.credit,
      commissionPct: inputs.commissionPct,
    });
    onFees = onPortfolio.estimatedFeesArs;
    warnings.push(...onPortfolio.warnings);
    for (const l of onPortfolio.lines) {
      lines.push({ position: l.position, rationale: l.rationale });
      lineExtras[l.position.priced.instrument.ticker] = {
        rating: l.rating,
        tier: l.tier,
        spreadBp: l.spreadBp,
        rung: l.rung,
      };
    }
    // trazas de la escalera, adaptadas a la forma de la UI unificada
    for (const rung of onPortfolio.traces) {
      traces.push({
        segment: 'dolar',
        targetWeightPct: ((1 - sovShare) * 100) / onPortfolio.traces.length,
        candidates: rung.candidates.map((c) => ({
          ticker: c.ticker,
          name: `${c.issuer} · ${c.rating}`,
          family: 'on' as const,
          months: c.months,
          tirPct: c.tirPct,
          mdYears: c.mdYears,
          turnoverArs: c.turnoverArs,
          liquid: c.liquid,
          selected: c.selected && c.rung === rung.rung,
          reason: c.reason,
        })),
      });
    }
  }

  // --- totales y métricas ---------------------------------------------------
  const sovFees = sovSpent * feeRate;
  const totalSpent = lines.reduce((s, l) => s + l.position.investedArs, 0);
  const fees = sovFees + onFees;
  const totalInv = totalSpent || 1;
  const w = (l: ProposalLine) => l.position.investedArs / totalInv;
  const issuers = new Set(
    lines.map((l) => l.position.priced.instrument.issuer ?? l.position.priced.instrument.ticker),
  ).size;

  if (lines.length === 0) warnings.push('No se pudo armar ninguna línea con este monto/estilo.');

  return {
    inputs: {
      amountArs,
      horizonMonths: inputs.horizonMonths,
      profile: inputs.style,
      goal: 'dolares',
      commissionPct: inputs.commissionPct,
    },
    settlement,
    lines,
    totalInvestedArs: totalSpent,
    cashLeftArs: amountArs - totalSpent - fees,
    estimatedFeesArs: fees,
    warnings,
    traces,
    usd: {
      amountUsd: inputs.amountUsd,
      mepUsed: ctx.mep,
      tirUsdPct: lines.reduce((s, l) => s + l.position.priced.tir * 100 * w(l), 0),
      durationYears: lines.reduce((s, l) => s + l.position.priced.modifiedDuration * w(l), 0),
      avgSpreadBp: lines.reduce(
        (s, l) => s + (lineExtras[l.position.priced.instrument.ticker]?.spreadBp ?? 0) * w(l),
        0,
      ),
      issuers,
      lineExtras,
    },
  };
}

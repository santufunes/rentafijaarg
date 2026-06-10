/**
 * Construcción de la propuesta: selección de instrumentos por segmento,
 * sizing a nominales enteros y costos.
 *
 * Reglas de selección:
 * - Liquidez primero: dentro de cada segmento solo se consideran instrumentos
 *   con volumen operado relevante (o que pertenecen a la lista de "siempre
 *   líquidos": AL30/GD30 y la LECAP más corta).
 * - Calce de horizonte: tasa fija y CER se eligen con vencimiento lo más
 *   cercano posible al horizonte (sin pasarse más de 3 meses); en dólares la
 *   duración objetivo crece con el perfil.
 * - Diversificación mínima: hasta 2 instrumentos por segmento si el monto lo
 *   permite (ticket mínimo por línea: 5% del total o 1 nominal, lo que sea mayor).
 */

import { daysBetween, settlementT1 } from '../engine/dates';
import { priceInstrument } from '../engine/pricing';
import type { Instrument, MarketContext, PricedInstrument, Quote } from '../engine/types';
import type { Position } from '../engine/portfolio';
import { targetWeights, type CurrencyGoal, type ProfileKey, type SegmentKey } from './profiles';

export interface BuilderInputs {
  amountArs: number;
  horizonMonths: number;
  profile: ProfileKey;
  goal: CurrencyGoal;
  /** Comisión del broker en %, configurable (default 0.5% + IVA). */
  commissionPct: number;
}

export interface ProposalLine {
  position: Position;
  rationale: string;
}

export interface Proposal {
  inputs: BuilderInputs;
  settlement: string;
  lines: ProposalLine[];
  totalInvestedArs: number;
  cashLeftArs: number;
  estimatedFeesArs: number;
  warnings: string[];
}

const ALWAYS_LIQUID = new Set(['AL30', 'GD30', 'AL35', 'GD35', 'AE38', 'GD41']);
const MIN_VOLUME_ARS = 1_000_000; // volumen mínimo diario aproximado para considerar líquido

function segmentOf(instr: Instrument): SegmentKey | null {
  switch (instr.family) {
    case 'lecap':
    case 'boncap':
    case 'bonte':
      return 'tasa_fija';
    case 'boncer':
      return 'cer';
    case 'soberano_usd':
    case 'bopreal':
      return 'dolar';
    default:
      return null; // duales y dollar-linked quedan fuera del MVP de propuestas
  }
}

function monthsToMaturity(p: PricedInstrument, asOf: string): number {
  return daysBetween(asOf, p.instrument.maturity) / 30.44;
}

function isLiquid(p: PricedInstrument): boolean {
  if (ALWAYS_LIQUID.has(p.instrument.ticker)) return true;
  const vol = p.quote.volume ?? 0;
  const pricePerVN = p.quote.last / 100;
  return vol * pricePerVN >= MIN_VOLUME_ARS;
}

/** Precio en ARS de 1 VN (para sizing siempre se compra el ticker en pesos). */
function arsPricePerVN(p: PricedInstrument, quotes: Map<string, Quote>): number {
  const ars = quotes.get(p.instrument.tickers.ars);
  if (ars && ars.last > 0) return ars.last / 100;
  throw new Error(`Sin precio ARS para ${p.instrument.ticker}`);
}

interface Pick {
  priced: PricedInstrument;
  targetArs: number;
  rationale: string;
}

function pickTasaFija(universe: PricedInstrument[], horizon: number, asOf: string): Omit<Pick, 'targetArs'>[] {
  const candidates = universe
    .filter((p) => ['lecap', 'boncap', 'bonte'].includes(p.instrument.family))
    .filter(isLiquid)
    .filter((p) => p.instrument.kind === 'zero')
    .sort((a, b) => a.instrument.maturity.localeCompare(b.instrument.maturity));
  if (candidates.length === 0) return [];

  // Calce: el de vencimiento más cercano al horizonte sin pasarse de horizonte+3m.
  const within = candidates.filter((p) => monthsToMaturity(p, asOf) <= horizon + 3);
  const anchorPool = within.length > 0 ? within : [candidates[0]];
  const anchor = anchorPool.reduce((best, p) =>
    Math.abs(monthsToMaturity(p, asOf) - horizon) < Math.abs(monthsToMaturity(best, asOf) - horizon)
      ? p
      : best,
  );
  const picks: Omit<Pick, 'targetArs'>[] = [
    {
      priced: anchor,
      rationale: `Vence cerca de tu horizonte: cobrás el pago final fijo sin depender del precio de venta.`,
    },
  ];

  // Escalonado: una letra a ~mitad de camino, si existe y es distinta.
  if (horizon >= 6) {
    const half = candidates
      .filter((p) => p !== anchor && monthsToMaturity(p, asOf) >= 1)
      .reduce<PricedInstrument | null>(
        (best, p) =>
          best === null ||
          Math.abs(monthsToMaturity(p, asOf) - horizon / 2) <
            Math.abs(monthsToMaturity(best, asOf) - horizon / 2)
            ? p
            : best,
        null,
      );
    if (half && Math.abs(monthsToMaturity(half, asOf) - horizon / 2) < horizon / 4) {
      picks.push({
        priced: half,
        rationale: 'Escalona vencimientos: te devuelve liquidez a mitad de camino.',
      });
    }
  }
  return picks;
}

function pickCer(universe: PricedInstrument[], horizon: number, asOf: string): Omit<Pick, 'targetArs'>[] {
  const candidates = universe
    .filter((p) => p.instrument.family === 'boncer')
    .filter(isLiquid)
    .sort((a, b) => a.instrument.maturity.localeCompare(b.instrument.maturity));
  if (candidates.length === 0) return [];
  // El BONCER con vencimiento más cercano al horizonte (tolerancia +6m: el CER
  // necesita tiempo para devengar; mejor pasarse un poco que quedarse corto).
  const best = candidates.reduce((bestSoFar, p) =>
    Math.abs(monthsToMaturity(p, asOf) - horizon) <
    Math.abs(monthsToMaturity(bestSoFar, asOf) - horizon)
      ? p
      : bestSoFar,
  );
  return [
    {
      priced: best,
      rationale: 'Ajusta capital por inflación (CER): protege tu poder de compra.',
    },
  ];
}

function pickDolar(
  universe: PricedInstrument[],
  profile: ProfileKey,
  horizon: number,
  asOf: string,
): Omit<Pick, 'targetArs'>[] {
  const sovereigns = universe
    .filter((p) => p.instrument.family === 'soberano_usd')
    .filter(isLiquid);
  const bopreal = universe.filter((p) => p.instrument.family === 'bopreal').filter(isLiquid);
  const picks: Omit<Pick, 'targetArs'>[] = [];

  if (profile === 'conservador') {
    // Lo más corto posible en USD: BOPREAL corto si existe, si no el soberano de menor MD.
    // strips BOPREAL con igual duración: el de mayor TIR es el que no paga prima por el put
    const shortBopreal = bopreal.sort(
      (a, b) => a.modifiedDuration - b.modifiedDuration || b.tir - a.tir,
    )[0];
    const shortSov = sovereigns.sort((a, b) => a.modifiedDuration - b.modifiedDuration)[0];
    const pick = shortBopreal ?? shortSov;
    if (pick)
      picks.push({
        priced: pick,
        rationale: 'Dólares con la menor duración disponible: menos sensible a tasas.',
      });
  } else if (profile === 'moderado') {
    const al30 = sovereigns.find((p) => p.instrument.ticker === 'AL30') ?? sovereigns[0];
    if (al30)
      picks.push({
        priced: al30,
        rationale: 'El soberano en dólares más líquido del mercado; tramo corto de la curva.',
      });
    const belly = sovereigns
      .filter((p) => p !== al30 && p.modifiedDuration > (al30?.modifiedDuration ?? 0))
      .sort((a, b) => b.tir - a.tir)[0];
    if (belly && horizon >= 12)
      picks.push({
        priced: belly,
        rationale: 'Tramo medio de la curva: más rendimiento a cambio de más duración.',
      });
  } else {
    // Agresivo: maximiza TIR/convexidad en el tramo largo.
    const sorted = sovereigns.sort((a, b) => b.modifiedDuration - a.modifiedDuration);
    const long = sorted[0];
    if (long)
      picks.push({
        priced: long,
        rationale: 'Tramo largo: máxima sensibilidad a una compresión del riesgo país.',
      });
    const second = sorted.slice(1).sort((a, b) => b.tir - a.tir)[0];
    if (second)
      picks.push({ priced: second, rationale: 'Segunda línea larga: diversifica ley y vencimiento.' });
  }
  return picks;
}

export function buildProposal(
  universe: Instrument[],
  quotes: Map<string, Quote>,
  ctx: MarketContext,
  inputs: BuilderInputs,
): Proposal {
  const settlement = settlementT1(ctx.asOf);
  const warnings: string[] = [];

  // Valuar todo el universo; los que fallan (sin precio, vencidos) se excluyen.
  const priced: PricedInstrument[] = [];
  for (const instr of universe) {
    if (segmentOf(instr) === null) continue;
    // El sizing compra el ticker en pesos: sin precio ARS no hay línea posible.
    const arsQuote = quotes.get(instr.tickers.ars);
    if (!arsQuote || arsQuote.last <= 0) continue;
    try {
      priced.push(priceInstrument(instr, quotes, settlement, ctx));
    } catch {
      // sin precio o sin flujos futuros: fuera del universo de hoy
    }
  }

  const weights = targetWeights(inputs.profile, inputs.goal, inputs.horizonMonths);
  const picksBySegment: Record<SegmentKey, Omit<Pick, 'targetArs'>[]> = {
    tasa_fija: pickTasaFija(priced, inputs.horizonMonths, ctx.asOf),
    cer: pickCer(priced, inputs.horizonMonths, ctx.asOf),
    dolar: pickDolar(priced, inputs.profile, inputs.horizonMonths, ctx.asOf),
  };

  // Redistribuir pesos de segmentos sin candidatos.
  let missing = 0;
  const segs: SegmentKey[] = ['tasa_fija', 'cer', 'dolar'];
  for (const s of segs) {
    if (weights[s] > 0 && picksBySegment[s].length === 0) {
      missing += weights[s];
      warnings.push(`Sin instrumentos líquidos para el segmento ${s}; peso redistribuido.`);
      weights[s] = 0;
    }
  }
  if (missing > 0) {
    const alive = segs.filter((s) => weights[s] > 0);
    for (const s of alive) weights[s] += missing / alive.length;
  }

  // Ticket mínimo por línea: 5% del monto. Si una línea no llega, se concentra en la primera del segmento.
  const minTicket = Math.max(inputs.amountArs * 0.05, 1);
  const picks: Pick[] = [];
  for (const s of segs) {
    const segPicks = picksBySegment[s];
    if (segPicks.length === 0 || weights[s] === 0) continue;
    const segArs = (weights[s] / 100) * inputs.amountArs;
    const perLine = segArs / segPicks.length;
    if (segPicks.length > 1 && perLine < minTicket) {
      picks.push({ ...segPicks[0], targetArs: segArs });
    } else {
      for (const sp of segPicks) picks.push({ ...sp, targetArs: perLine });
    }
  }

  // Sizing a nominales enteros (se compra el ticker en pesos).
  const lines: ProposalLine[] = [];
  let spent = 0;
  for (const pick of picks) {
    const pxVN = arsPricePerVN(pick.priced, quotes);
    const nominals = Math.floor(pick.targetArs / pxVN);
    if (nominals < Math.max(1, pick.priced.instrument.minLot)) {
      warnings.push(
        `${pick.priced.instrument.ticker}: el monto asignado no alcanza para 1 nominal; línea omitida.`,
      );
      continue;
    }
    const investedArs = nominals * pxVN;
    spent += investedArs;
    const isUsd = pick.priced.instrument.payCcy === 'USD';
    lines.push({
      position: {
        priced: pick.priced,
        nominals,
        investedPayCcy: isUsd ? investedArs / ctx.mep : investedArs,
        investedArs,
        segment: segmentOf(pick.priced.instrument)!,
      },
      rationale: pick.rationale,
    });
  }

  // Remanente: intentar agregar nominales del instrumento más barato por VN.
  let cashLeft = inputs.amountArs - spent;
  const byCheapest = [...lines].sort(
    (a, b) => arsPricePerVN(a.position.priced, quotes) - arsPricePerVN(b.position.priced, quotes),
  );
  for (const line of byCheapest) {
    const pxVN = arsPricePerVN(line.position.priced, quotes);
    const extra = Math.floor(cashLeft / pxVN);
    if (extra > 0) {
      line.position.nominals += extra;
      const addArs = extra * pxVN;
      line.position.investedArs += addArs;
      line.position.investedPayCcy +=
        line.position.priced.instrument.payCcy === 'USD' ? addArs / ctx.mep : addArs;
      spent += addArs;
      cashLeft -= addArs;
    }
  }

  // Costos estimados: comisión + IVA sobre comisión + derechos de mercado.
  const commission = spent * (inputs.commissionPct / 100);
  const fees = commission * 1.21 + spent * 0.0001;

  if (inputs.amountArs < 100_000)
    warnings.push('Con montos chicos la diversificación es limitada; considerá un FCI money market.');

  return {
    inputs,
    settlement,
    lines,
    totalInvestedArs: spent,
    cashLeftArs: cashLeft,
    estimatedFeesArs: fees,
    warnings,
  };
}

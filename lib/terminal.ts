/**
 * Capa de datos de la terminal: valúa TODO el registro (incluidas familias que
 * no entran en propuestas, como duales y dollar-linked) y arma filas
 * comparables para el screener, las curvas y el comparador.
 */

import { isLiquid, arsTurnover } from './builder/construct';
import { cerRatio } from './engine/cer';
import { daysBetween, settlementT1 } from './engine/dates';
import { priceInstrument } from './engine/pricing';
import { solveTir } from './engine/solver';
import type { Instrument, MarketContext, Quote, PricedInstrument } from './engine/types';
import { FAMILY_META } from './familyMeta';

export interface TerminalRow {
  ticker: string;
  name: string;
  family: Instrument['family'];
  issuer?: string;
  law?: string;
  maturity: string;
  months: number;
  pxArs: number | null;
  pxUsd: number | null;
  tirPct: number;
  tirKind: string;
  /** TEM equivalente, solo para cupón cero en ARS. */
  temPct: number | null;
  mdYears: number;
  turnoverArs: number;
  liquid: boolean;
  priced: PricedInstrument;
}

export function buildRows(
  instruments: Instrument[],
  quotes: Map<string, Quote>,
  ctx: MarketContext,
): { rows: TerminalRow[]; settlement: string; errors: string[] } {
  const settlement = settlementT1(ctx.asOf);
  const rows: TerminalRow[] = [];
  const errors: string[] = [];

  for (const instr of instruments) {
    try {
      const priced = priceInstrument(instr, quotes, settlement, ctx);
      const arsQ = quotes.get(instr.tickers.ars);
      const mepQ = instr.tickers.mep ? quotes.get(instr.tickers.mep) : undefined;
      const isArsZero =
        (instr.kind === 'zero' || instr.kind === 'dual_tamar') && instr.payCcy === 'ARS';
      rows.push({
        ticker: instr.ticker,
        name: instr.name,
        family: instr.family,
        issuer: instr.issuer,
        law: instr.law,
        maturity: instr.maturity,
        months: daysBetween(ctx.asOf, instr.maturity) / 30.44,
        pxArs: arsQ && arsQ.last > 0 ? arsQ.last : null,
        pxUsd: mepQ && mepQ.last > 0 ? mepQ.last : null,
        tirPct: priced.tir * 100,
        tirKind: FAMILY_META[instr.family].tirKind,
        temPct: isArsZero ? (Math.pow(1 + priced.tir, 30 / 365) - 1) * 100 : null,
        mdYears: priced.modifiedDuration,
        turnoverArs: arsTurnover(priced, quotes),
        liquid: isLiquid(priced, quotes),
        priced,
      });
    } catch (e) {
      errors.push(`${instr.ticker}: ${String(e).slice(0, 80)}`);
    }
  }
  rows.sort((a, b) => a.months - b.months);
  return { rows, settlement, errors };
}

// ---------------------------------------------------------------------------
// Simulador: "si invierto $X en TICKER a precio P, ¿qué cobro y cuándo?"
// ---------------------------------------------------------------------------

export interface SimPayout {
  date: string;
  /** Renta (interés) por el total de nominales, en moneda de pago. */
  interest: number;
  /** Amortización de capital por el total de nominales, en moneda de pago. */
  amortization: number;
  totalPayCcy: number;
  /** Equivalente en ARS al MEP/A3500 de HOY (constante, solo ilustrativo). */
  totalArs: number;
  cumulativeArs: number;
}

export interface SimulationResult {
  instrument: Instrument;
  settlement: string;
  /** Precio sucio usado, ARS por 100 VN. */
  priceArsPer100: number;
  nominals: number;
  spentArs: number;
  leftoverArs: number;
  /** TIR efectiva anual implícita en ESE precio (real para CER, USD para hard-dollar). */
  tirPct: number;
  tirKind: string;
  payCcy: 'ARS' | 'USD';
  payouts: SimPayout[];
  totalInterest: number;
  totalAmortization: number;
  totalReceivedPayCcy: number;
  totalReceivedArs: number;
  multiple: number;
  caveats: string[];
}

/** Flujos remanentes por 100 VN con renta y capital separados, indexación aplicada. */
function splitCashflows(
  instr: Instrument,
  settlement: string,
  ctx: MarketContext,
): { date: string; interest: number; amortization: number }[] {
  switch (instr.kind) {
    case 'fixed':
      return instr.cashflows.filter((cf) => daysBetween(settlement, cf.date) > 0);
    case 'zero':
      return daysBetween(settlement, instr.maturity) > 0
        ? [
            {
              date: instr.maturity,
              interest: instr.finalPaymentPer100 - 100,
              amortization: 100,
            },
          ]
        : [];
    case 'dual_tamar':
      return daysBetween(settlement, instr.maturity) > 0
        ? [
            {
              date: instr.maturity,
              interest: instr.fixedFinalPaymentPer100 - 100,
              amortization: 100,
            },
          ]
        : [];
    case 'cer':
      return instr.realCashflows
        .filter((cf) => daysBetween(settlement, cf.date) > 0)
        .map((cf) => {
          const ratio = cerRatio(cf.date, instr.cerBase, ctx);
          return { date: cf.date, interest: cf.interest * ratio, amortization: cf.amortization * ratio };
        });
    case 'dollar_linked':
      return instr.usdCashflows.filter((cf) => daysBetween(settlement, cf.date) > 0);
  }
}

export function simulate(
  instr: Instrument,
  quotes: Map<string, Quote>,
  ctx: MarketContext,
  amountArs: number,
  priceArsPer100?: number,
): SimulationResult {
  const settlement = settlementT1(ctx.asOf);
  const marketArs = quotes.get(instr.tickers.ars)?.last;
  const px = priceArsPer100 ?? marketArs;
  if (!px || px <= 0) throw new Error(`Sin precio ARS para ${instr.ticker}`);

  const minLot = Math.max(1, instr.minLot || 1);
  const nominals = Math.floor(amountArs / (px / 100));
  if (nominals < minLot)
    throw new Error(
      `Con ${Math.round(amountArs).toLocaleString('es-AR')} ARS a precio ${px} no llegás al lote mínimo de ${minLot} VN (necesitás ~$${Math.round((minLot * px) / 100).toLocaleString('es-AR')}).`,
    );
  const spentArs = nominals * (px / 100);
  const scale = nominals / 100;

  const split = splitCashflows(instr, settlement, ctx);
  if (split.length === 0) throw new Error(`${instr.ticker} no tiene pagos futuros`);

  // TIR implícita en el precio ingresado (misma convención que el resto del motor).
  const isUsd = instr.payCcy === 'USD';
  const isDl = instr.kind === 'dollar_linked';
  let tirPct: number;
  if (instr.kind === 'cer') {
    const ratioNow = cerRatio(settlement, instr.cerBase, ctx);
    const realFlows = instr.realCashflows
      .filter((cf) => daysBetween(settlement, cf.date) > 0)
      .map((cf) => ({ date: cf.date, amount: cf.interest + cf.amortization }));
    tirPct = solveTir(realFlows, settlement, px / ratioNow) * 100;
  } else {
    const flows = split.map((cf) => ({ date: cf.date, amount: cf.interest + cf.amortization }));
    // hard-dollar: usar el FX implícito del PROPIO bono (precio ARS / precio D)
    // para que la TIR coincida exactamente con la del motor; si no hay línea D,
    // caer al MEP general. Dollar-linked: A3500.
    let dirtyPayCcy = px;
    if (isUsd) {
      const usdQ = instr.tickers.mep ? quotes.get(instr.tickers.mep) : undefined;
      const ownFx = marketArs && usdQ && usdQ.last > 0 ? marketArs / usdQ.last : ctx.mep;
      dirtyPayCcy = px / ownFx;
    } else if (isDl) {
      dirtyPayCcy = px / ctx.a3500;
    }
    tirPct = solveTir(flows, settlement, dirtyPayCcy) * 100;
  }

  // Conversión a ARS de cada pago: USD al MEP de hoy; dollar-linked al A3500 de hoy.
  const fxToArs = isUsd ? ctx.mep : isDl ? ctx.a3500 : 1;

  let cumulative = 0;
  const payouts: SimPayout[] = split.map((cf) => {
    const interest = cf.interest * scale;
    const amortization = cf.amortization * scale;
    const totalPayCcy = interest + amortization;
    const totalArs = totalPayCcy * fxToArs;
    cumulative += totalArs;
    return { date: cf.date, interest, amortization, totalPayCcy, totalArs, cumulativeArs: cumulative };
  });

  const totalInterest = payouts.reduce((s, p) => s + p.interest, 0);
  const totalAmortization = payouts.reduce((s, p) => s + p.amortization, 0);
  const totalReceivedPayCcy = totalInterest + totalAmortization;
  const totalReceivedArs = totalReceivedPayCcy * fxToArs;

  const caveats: string[] = [];
  if (instr.kind === 'cer')
    caveats.push(
      'Los montos CER usan la senda de inflación del REM: son proyecciones, no promesas. El ajuste real se conoce 10 días hábiles antes de cada pago.',
    );
  if (isUsd)
    caveats.push(
      'Cobrás en dólares MEP. El equivalente en pesos usa el MEP de hoy, constante: si el dólar sube, cobrás más pesos.',
    );
  if (isDl)
    caveats.push(
      'Paga en pesos al tipo de cambio oficial (A3500) de cada fecha; acá se muestra al A3500 de hoy, constante.',
    );
  if (instr.kind === 'dual_tamar')
    caveats.push(
      'Se muestra el PISO fijo del dual: si la rama TAMAR termina ganando, cobrás más que esto.',
    );
  if (instr.kind === 'zero' || instr.kind === 'dual_tamar')
    caveats.push('Instrumento "cupón cero": no hay pagos intermedios, cobrás todo al vencimiento.');

  return {
    instrument: instr,
    settlement,
    priceArsPer100: px,
    nominals,
    spentArs,
    leftoverArs: amountArs - spentArs,
    tirPct,
    tirKind: FAMILY_META[instr.family].tirKind,
    payCcy: isDl ? 'ARS' : instr.payCcy,
    payouts,
    totalInterest,
    totalAmortization,
    totalReceivedPayCcy,
    totalReceivedArs,
    multiple: totalReceivedArs / spentArs,
    caveats,
  };
}

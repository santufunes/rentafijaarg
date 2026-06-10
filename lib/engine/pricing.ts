/**
 * Valuación: de (instrumento, precio de mercado) a TIR, duración y flujos proyectados.
 *
 * Los precios BYMA son sucios y por 100 VN original. Para instrumentos que pagan
 * USD se usa el ticker D (precio en USD); si solo hay precio en ARS se convierte
 * por MEP. Para CER la TIR principal es la REAL (sobre CER), y se informa además
 * la TIR nominal proyectada con la senda REM.
 */

import { cerRatio } from './cer';
import { daysBetween } from './dates';
import { durations, solveTir, type DatedAmount } from './solver';
import type { Instrument, MarketContext, PricedInstrument, Quote } from './types';

/** Flujos remanentes por 100 VN en la moneda de pago, indexación aplicada. */
export function projectCashflows(
  instr: Instrument,
  settlement: string,
  ctx: MarketContext,
): DatedAmount[] {
  switch (instr.kind) {
    case 'fixed':
      return instr.cashflows
        .filter((cf) => daysBetween(settlement, cf.date) > 0)
        .map((cf) => ({ date: cf.date, amount: cf.interest + cf.amortization }));
    case 'zero':
      return daysBetween(settlement, instr.maturity) > 0
        ? [{ date: instr.maturity, amount: instr.finalPaymentPer100 }]
        : [];
    case 'dual_tamar':
      // Piso: leg fijo. El leg TAMAR solo puede mejorar el pago final.
      return daysBetween(settlement, instr.maturity) > 0
        ? [{ date: instr.maturity, amount: instr.fixedFinalPaymentPer100 }]
        : [];
    case 'cer':
      return instr.realCashflows
        .filter((cf) => daysBetween(settlement, cf.date) > 0)
        .map((cf) => ({
          date: cf.date,
          amount: (cf.interest + cf.amortization) * cerRatio(cf.date, instr.cerBase, ctx),
        }));
    case 'dollar_linked':
      return instr.usdCashflows
        .filter((cf) => daysBetween(settlement, cf.date) > 0)
        .map((cf) => ({ date: cf.date, amount: cf.interest + cf.amortization }));
  }
}

/** Flujos reales (sin indexar) de un bono CER — para TIR real. */
function realCashflows(instr: Extract<Instrument, { kind: 'cer' }>, settlement: string): DatedAmount[] {
  return instr.realCashflows
    .filter((cf) => daysBetween(settlement, cf.date) > 0)
    .map((cf) => ({ date: cf.date, amount: cf.interest + cf.amortization }));
}

/** Elige el mejor quote disponible y devuelve el precio sucio en la moneda de pago. */
export function dirtyPriceInPayCcy(
  instr: Instrument,
  quotes: Map<string, Quote>,
  ctx: MarketContext,
): { price: number; quote: Quote } {
  const mepQuote = instr.tickers.mep ? quotes.get(instr.tickers.mep) : undefined;
  const arsQuote = quotes.get(instr.tickers.ars);

  if (instr.payCcy === 'USD') {
    if (mepQuote && mepQuote.last > 0) return { price: mepQuote.last, quote: mepQuote };
    if (arsQuote && arsQuote.last > 0)
      return { price: arsQuote.last / ctx.mep, quote: arsQuote };
    throw new Error(`Sin precio para ${instr.ticker}`);
  }
  if (arsQuote && arsQuote.last > 0) return { price: arsQuote.last, quote: arsQuote };
  throw new Error(`Sin precio para ${instr.ticker}`);
}

export function priceInstrument(
  instr: Instrument,
  quotes: Map<string, Quote>,
  settlement: string,
  ctx: MarketContext,
): PricedInstrument {
  const { price, quote } = dirtyPriceInPayCcy(instr, quotes, ctx);
  const projected = projectCashflows(instr, settlement, ctx);
  if (projected.length === 0) throw new Error(`${instr.ticker} sin flujos futuros`);

  let tir: number;
  let tirNominal: number | undefined;
  let durationFlows = projected;
  let durationRate: number;

  if (instr.kind === 'cer') {
    // TIR real: precio deflactado por el coeficiente actual vs flujos sin indexar.
    const ratioNow = cerRatio(settlement, instr.cerBase, ctx);
    const realFlows = realCashflows(instr, settlement);
    tir = solveTir(realFlows, settlement, price / ratioNow);
    tirNominal = solveTir(projected, settlement, price);
    durationFlows = realFlows;
    durationRate = tir;
  } else if (instr.kind === 'dollar_linked') {
    // Precio ARS por 100 VN USD → precio en USD por A3500 (convención de mercado).
    const usdPrice = price / ctx.a3500;
    tir = solveTir(projected, settlement, usdPrice);
    durationRate = tir;
  } else {
    tir = solveTir(projected, settlement, price);
    durationRate = tir;
  }

  const { macaulay, modified } = durations(durationFlows, settlement, durationRate);

  return {
    instrument: instr,
    quote,
    settlement,
    tir,
    tirNominal,
    macaulay,
    modifiedDuration: modified,
    projectedCashflows: projected,
    dirtyPricePayCcy: instr.kind === 'dollar_linked' ? price / ctx.a3500 : price,
  };
}

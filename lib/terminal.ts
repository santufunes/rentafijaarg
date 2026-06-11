/**
 * Capa de datos de la terminal: valúa TODO el registro (incluidas familias que
 * no entran en propuestas, como duales y dollar-linked) y arma filas
 * comparables para el screener, las curvas y el comparador.
 */

import { isLiquid, arsTurnover } from './builder/construct';
import { daysBetween, settlementT1 } from './engine/dates';
import { priceInstrument } from './engine/pricing';
import type { Instrument, MarketContext, PricedInstrument, Quote } from './engine/types';
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

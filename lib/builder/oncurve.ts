/**
 * Curva soberana USD y spreads corporativos.
 *
 * El valor de una ON no es su TIR aislada sino su SPREAD contra el soberano de
 * duración comparable: cuánto paga el crédito corporativo por encima de la
 * curva AL/GD/AN/AO. El spread se calcula contra la curva soberana interpolada
 * linealmente por duración modificada (flat fuera de los extremos).
 */

import type { PricedInstrument } from '../engine/types';

export interface CurvePoint {
  md: number;
  tirPct: number;
  ticker: string;
}

export function sovereignCurve(priced: PricedInstrument[]): CurvePoint[] {
  return priced
    .filter((p) => p.instrument.family === 'soberano_usd')
    .map((p) => ({ md: p.modifiedDuration, tirPct: p.tir * 100, ticker: p.instrument.ticker }))
    .sort((a, b) => a.md - b.md);
}

/** TIR soberana interpolada a una duración dada. */
export function sovereignYieldAt(curve: CurvePoint[], md: number): number {
  if (curve.length === 0) throw new Error('Curva soberana vacía');
  if (md <= curve[0].md) return curve[0].tirPct;
  if (md >= curve[curve.length - 1].md) return curve[curve.length - 1].tirPct;
  for (let i = 1; i < curve.length; i++) {
    if (md <= curve[i].md) {
      const a = curve[i - 1];
      const b = curve[i];
      const w = (md - a.md) / (b.md - a.md);
      return a.tirPct + w * (b.tirPct - a.tirPct);
    }
  }
  return curve[curve.length - 1].tirPct;
}

/** Spread de un instrumento USD sobre la curva soberana, en puntos básicos. */
export function spreadBp(p: PricedInstrument, curve: CurvePoint[]): number {
  return (p.tir * 100 - sovereignYieldAt(curve, p.modifiedDuration)) * 100;
}

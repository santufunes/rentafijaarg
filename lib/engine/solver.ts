/**
 * Solver de TIR: tasa efectiva anual r tal que
 *   sum( cf_i / (1+r)^(días_i/365) ) = precio sucio
 *
 * Bisección con bracketing — convergencia garantizada y sin explosiones de
 * Newton cerca de flujos cortos. Precisión 1e-10 en tasa.
 */

import { yearFraction } from './dates';

export interface DatedAmount {
  date: string;
  amount: number;
}

/** Valor presente de flujos a tasa efectiva anual r, descontando act/365 desde settlement. */
export function presentValue(cashflows: DatedAmount[], settlement: string, r: number): number {
  let pv = 0;
  for (const cf of cashflows) {
    const t = yearFraction(settlement, cf.date);
    if (t < 0) continue; // flujo ya pagado
    pv += cf.amount / Math.pow(1 + r, t);
  }
  return pv;
}

/**
 * TIR efectiva anual desde precio sucio. Lanza si no hay flujos futuros o no
 * se puede bracketear (precio fuera de todo rango razonable).
 */
export function solveTir(cashflows: DatedAmount[], settlement: string, dirtyPrice: number): number {
  const future = cashflows.filter((cf) => yearFraction(settlement, cf.date) > 0);
  if (future.length === 0) throw new Error('Sin flujos futuros a la fecha de liquidación');
  if (dirtyPrice <= 0) throw new Error(`Precio inválido: ${dirtyPrice}`);

  const f = (r: number) => presentValue(future, settlement, r) - dirtyPrice;

  // Bracket: TIR entre -99.9% y 1000% EA cubre cualquier instrumento real.
  let lo = -0.999;
  let hi = 10;
  let flo = f(lo);
  let fhi = f(hi);
  if (flo * fhi > 0) {
    // precio por debajo del PV a 1000%: subir el techo
    hi = 1000;
    fhi = f(hi);
    if (flo * fhi > 0) throw new Error('No se pudo bracketear la TIR');
  }

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < 1e-12 || hi - lo < 1e-10) return mid;
    if (flo * fm <= 0) {
      hi = mid;
      fhi = fm;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

/** Duración de Macaulay (años) y modificada, sobre flujos futuros a TIR efectiva anual. */
export function durations(
  cashflows: DatedAmount[],
  settlement: string,
  tir: number,
): { macaulay: number; modified: number } {
  let pv = 0;
  let weighted = 0;
  for (const cf of cashflows) {
    const t = yearFraction(settlement, cf.date);
    if (t <= 0) continue;
    const d = cf.amount / Math.pow(1 + tir, t);
    pv += d;
    weighted += t * d;
  }
  if (pv === 0) return { macaulay: 0, modified: 0 };
  const macaulay = weighted / pv;
  // Convención de mercado local: MD = D / (1 + TIR) con TIR efectiva anual.
  return { macaulay, modified: macaulay / (1 + tir) };
}

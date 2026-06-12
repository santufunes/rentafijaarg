/**
 * Proyección Monte Carlo del portafolio mixto:
 *  - Tramo equity: GBM multivariado con covarianza HISTÓRICA (Cholesky) y
 *    deriva configurable por activo (default: la TIR esperada NO se inventa —
 *    se usa deriva 0 real, es decir, solo el dólar/inflación implícitos los
 *    pone el usuario; el cono muestra el RIESGO, no una promesa de retorno).
 *  - Tramo renta fija: determinístico al devengamiento de su TIR (efectiva
 *    anual), el supuesto estándar de hold-to-maturity. Su riesgo de mercado
 *    intermedio no se simula y se declara.
 * Semilla determinística (mulberry32) para que la misma cartera muestre el
 * mismo cono — reproducibilidad antes que teatro.
 */

import { cholesky } from './stats';

export interface McAsset {
  key: string;
  weight: number;
  /** deriva anual esperada (log), p.ej. 0 = sin opinión de retorno. */
  driftAnnual: number;
}

export interface McFixedLeg {
  weight: number;
  /** Crecimiento determinístico del tramo RF: valor relativo a t años (1 en t=0). */
  growth: (tYears: number) => number;
}

export interface McResult {
  /** meses 0..horizonte */
  months: number[];
  p5: number[];
  p50: number[];
  p95: number[];
  /** prob. de terminar por debajo del capital inicial. */
  probLossPct: number;
  paths: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normal estándar por Box-Muller con PRNG sembrado. */
function gaussianFactory(seed: number) {
  const rand = mulberry32(seed);
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };
}

export function monteCarlo(
  assets: McAsset[],
  covAnnual: number[][],
  fixedLeg: McFixedLeg,
  horizonMonths: number,
  paths = 500,
  seed = 20260611,
): McResult {
  const n = assets.length;
  const stepsPerMonth = 1;
  const steps = horizonMonths * stepsPerMonth;
  const dt = 1 / 12;
  const L = n > 0 ? cholesky(covAnnual) : [];
  const gauss = gaussianFactory(seed);

  const eqWeight = assets.reduce((s, a) => s + a.weight, 0);
  const months = Array.from({ length: steps + 1 }, (_, i) => i);
  const values: number[][] = Array.from({ length: steps + 1 }, () => []);

  for (let p = 0; p < paths; p++) {
    const eq = assets.map((a) => a.weight);
    let t = 0;
    values[0].push(100);
    for (let s = 1; s <= steps; s++) {
      t = s * dt;
      // shock correlacionado
      const z = Array.from({ length: n }, () => gauss());
      for (let i = 0; i < n; i++) {
        let corr = 0;
        for (let k = 0; k <= i; k++) corr += L[i][k] * z[k];
        const sigma2 = covAnnual[i][i];
        eq[i] *= Math.exp((assets[i].driftAnnual - sigma2 / 2) * dt + corr * Math.sqrt(dt));
      }
      const fi = fixedLeg.weight * fixedLeg.growth(t);
      const eqSum = eq.reduce((s2, x) => s2 + x, 0);
      values[s].push((fi + eqSum) * (100 / (fixedLeg.weight + eqWeight)));
    }
  }

  const pct = (arr: number[], q: number) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
    return sorted[idx];
  };

  const final = values[steps];
  return {
    months,
    p5: values.map((v) => pct(v, 0.05)),
    p50: values.map((v) => pct(v, 0.5)),
    p95: values.map((v) => pct(v, 0.95)),
    probLossPct: (final.filter((v) => v < 100).length / final.length) * 100,
    paths,
  };
}

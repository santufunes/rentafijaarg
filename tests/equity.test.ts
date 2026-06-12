/**
 * Invariantes del motor multi-activo (independientes de los datos generados):
 *  - estadística: vol/retornos/drawdown sobre series construidas a mano;
 *  - covarianza/Cholesky: L·Lᵀ ≈ cov; activos idénticos → correlación 1;
 *  - backtest: pesos renormalizados, NAV inicial 100, exclusiones declaradas;
 *  - Monte Carlo: determinístico por semilla; RF pura sin dispersión y
 *    creciendo a su TIR; con equities el p95 > p5; prob. de pérdida coherente.
 */

import { describe, expect, it } from 'vitest';
import { backtest } from '@/lib/equity/backtest';
import { monteCarlo } from '@/lib/equity/montecarlo';
import {
  alignSeries,
  annualizedVol,
  cholesky,
  covarianceMatrix,
  cumulativeReturn,
  dailyLogReturns,
  maxDrawdown,
  type PricePoint,
} from '@/lib/equity/stats';

function syntheticSeries(n: number, dailyR: number, start = 100): PricePoint[] {
  const out: PricePoint[] = [];
  let c = start;
  const d0 = Date.UTC(2025, 0, 1);
  for (let i = 0; i < n; i++) {
    out.push({ date: new Date(d0 + i * 86_400_000).toISOString().slice(0, 10), close: c });
    c *= Math.exp(dailyR);
  }
  return out;
}

describe('stats', () => {
  it('serie constante: vol 0, retorno 0, drawdown 0', () => {
    const s = syntheticSeries(100, 0);
    expect(annualizedVol(dailyLogReturns(s).map((x) => x.r))).toBeCloseTo(0, 10);
    expect(cumulativeReturn(s)).toBeCloseTo(0, 10);
    expect(maxDrawdown(s)).toBeCloseTo(0, 10);
  });

  it('crecimiento determinístico: retorno acumulado exacto', () => {
    const s = syntheticSeries(253, Math.log(1.001));
    expect(cumulativeReturn(s)).toBeCloseTo(Math.pow(1.001, 252) - 1, 6);
  });

  it('covarianza de un activo consigo mismo → correlación 1 y Cholesky reproduce', () => {
    const a = syntheticSeries(120, 0.001).map((p, i) => ({ ...p, close: p.close * (1 + 0.01 * Math.sin(i)) }));
    const { closes } = alignSeries({ A: a, B: a });
    const { cov } = covarianceMatrix(closes);
    expect(cov[0][0]).toBeCloseTo(cov[1][1], 10);
    expect(cov[0][1]).toBeCloseTo(cov[0][0], 10);
    const L = cholesky(cov);
    const rebuilt = [
      [L[0][0] ** 2, L[0][0] * L[1][0]],
      [L[0][0] * L[1][0], L[1][0] ** 2 + L[1][1] ** 2],
    ];
    expect(rebuilt[0][0]).toBeCloseTo(cov[0][0], 8);
    expect(rebuilt[0][1]).toBeCloseTo(cov[0][1], 8);
  });
});

describe('backtest', () => {
  it('NAV arranca en 100 y excluye lo que no tiene historia, renormalizando', () => {
    const r = backtest({
      holdings: [
        { key: 'A', weight: 0.5, series: syntheticSeries(260, 0.001) },
        { key: 'SIN_HIST', weight: 0.3, series: [] },
        { key: 'B', weight: 0.2, series: syntheticSeries(260, -0.0005) },
      ],
      lookbackDays: 252,
    })!;
    expect(r.nav[0]).toBeCloseTo(100, 8);
    expect(r.excluded).toEqual(['SIN_HIST']);
    expect(r.coveredWeight).toBeCloseTo(0.7, 8);
    expect(r.totalReturnPct).toBeGreaterThan(0); // A domina
  });

  it('cartera de un solo activo reproduce su retorno', () => {
    const s = syntheticSeries(260, 0.001);
    const r = backtest({ holdings: [{ key: 'A', weight: 1, series: s }], lookbackDays: 252 })!;
    const win = s.slice(-253);
    expect(r.totalReturnPct).toBeCloseTo((win[win.length - 1].close / win[0].close - 1) * 100, 6);
  });
});

describe('monte carlo', () => {
  it('RF pura: sin dispersión y crece exactamente a su TIR', () => {
    const r = monteCarlo([], [], { weight: 1, growth: (t) => Math.pow(1.3, t) }, 12, 200);
    const last = r.months.length - 1;
    expect(r.p5[last]).toBeCloseTo(r.p95[last], 6);
    expect(r.p50[last]).toBeCloseTo(130, 4);
    expect(r.probLossPct).toBe(0);
  });

  it('equity con vol: banda abre y es determinística por semilla', () => {
    const cov = [[0.25]]; // 50% vol anual
    const a = monteCarlo([{ key: 'X', weight: 1, driftAnnual: 0 }], cov, { weight: 0, growth: () => 1 }, 24, 400, 7);
    const b = monteCarlo([{ key: 'X', weight: 1, driftAnnual: 0 }], cov, { weight: 0, growth: () => 1 }, 24, 400, 7);
    const last = a.months.length - 1;
    expect(a.p95[last]).toBeGreaterThan(a.p5[last] + 20);
    expect(a.p50[last]).toBeCloseTo(b.p50[last], 10); // misma semilla, mismo cono
    expect(a.probLossPct).toBeGreaterThan(20); // drift 0 + vol → ~50% bajo el capital
    expect(a.probLossPct).toBeLessThan(80);
  });

  it('mezcla 50/50: el piso del cono queda sostenido por la RF', () => {
    const cov = [[0.25]];
    const mix = monteCarlo(
      [{ key: 'X', weight: 0.5, driftAnnual: 0 }],
      cov,
      { weight: 0.5, growth: (t) => Math.pow(1.3, t) },
      12,
      400,
      7,
    );
    const pure = monteCarlo(
      [{ key: 'X', weight: 1, driftAnnual: 0 }],
      cov,
      { weight: 0, growth: () => 1 },
      12,
      400,
      7,
    );
    const last = mix.months.length - 1;
    expect(mix.p5[last]).toBeGreaterThan(pure.p5[last]);
    expect(mix.probLossPct).toBeLessThan(pure.probLossPct);
  });
});

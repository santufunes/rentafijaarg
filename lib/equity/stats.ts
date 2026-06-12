/**
 * Estadística de series de precios (acciones/CEDEARs/bonos con historia).
 *
 * Convenciones:
 * - Retornos diarios logarítmicos sobre cierres; 252 ruedas por año.
 * - Volatilidad anualizada = desvío(diarios) × √252.
 * - Covarianza sobre la intersección de fechas (series alineadas por fecha).
 */

export interface PricePoint {
  date: string;
  close: number;
}

export const TRADING_DAYS = 252;

export function dailyLogReturns(series: PricePoint[]): { date: string; r: number }[] {
  const out: { date: string; r: number }[] = [];
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1].close > 0 && series[i].close > 0)
      out.push({ date: series[i].date, r: Math.log(series[i].close / series[i - 1].close) });
  }
  return out;
}

export function annualizedVol(returns: number[]): number {
  if (returns.length < 20) return NaN;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS);
}

/** Retorno acumulado simple entre el primer y el último cierre. */
export function cumulativeReturn(series: PricePoint[]): number {
  if (series.length < 2) return NaN;
  return series[series.length - 1].close / series[0].close - 1;
}

export function maxDrawdown(series: PricePoint[]): number {
  let peak = -Infinity;
  let maxDd = 0;
  for (const p of series) {
    peak = Math.max(peak, p.close);
    maxDd = Math.min(maxDd, p.close / peak - 1);
  }
  return maxDd;
}

/** Recorta una serie a las últimas n ruedas. */
export function lastN(series: PricePoint[], n: number): PricePoint[] {
  return series.slice(Math.max(0, series.length - n));
}

/**
 * Alinea varias series por fecha (intersección) y devuelve fechas + matriz de
 * cierres [activo][t].
 */
export function alignSeries(seriesByKey: Record<string, PricePoint[]>): {
  dates: string[];
  closes: Record<string, number[]>;
} {
  const keys = Object.keys(seriesByKey);
  if (keys.length === 0) return { dates: [], closes: {} };
  const maps = keys.map((k) => new Map(seriesByKey[k].map((p) => [p.date, p.close])));
  const dates = seriesByKey[keys[0]]
    .map((p) => p.date)
    .filter((d) => maps.every((m) => m.has(d)))
    .sort();
  const closes: Record<string, number[]> = {};
  keys.forEach((k, i) => {
    closes[k] = dates.map((d) => maps[i].get(d)!);
  });
  return { dates, closes };
}

/** Matriz de covarianza ANUALIZADA de retornos log diarios sobre series alineadas. */
export function covarianceMatrix(closes: Record<string, number[]>): {
  keys: string[];
  cov: number[][];
} {
  const keys = Object.keys(closes);
  const rets = keys.map((k) => {
    const c = closes[k];
    const r: number[] = [];
    for (let i = 1; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1]));
    return r;
  });
  const n = rets[0]?.length ?? 0;
  const means = rets.map((r) => r.reduce((s, x) => s + x, 0) / (n || 1));
  const cov = keys.map((_, a) =>
    keys.map((_, b) => {
      let s = 0;
      for (let t = 0; t < n; t++) s += (rets[a][t] - means[a]) * (rets[b][t] - means[b]);
      return (s / Math.max(1, n - 1)) * TRADING_DAYS;
    }),
  );
  return { keys, cov };
}

/** Descomposición de Cholesky (para simular normales correlacionadas). */
export function cholesky(cov: number[][]): number[][] {
  const n = cov.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k];
      if (i === j) {
        // jitter mínimo para matrices casi singulares
        L[i][j] = Math.sqrt(Math.max(cov[i][i] - sum, 1e-12));
      } else {
        L[i][j] = (cov[i][j] - sum) / L[j][j];
      }
    }
  }
  return L;
}

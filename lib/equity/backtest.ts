/**
 * Backtest honesto: SOLO instrumentos con historia de precios real de la API
 * (acciones, CEDEARs y los soberanos del whitelist histórico). Lo que no tiene
 * historia (LECAPs, ONs, BONCER) queda explícitamente fuera del tramo
 * histórico y se informa — nunca se inventa una serie.
 */

import { alignSeries, lastN, maxDrawdown, type PricePoint } from './stats';

export interface BacktestInput {
  /** peso → serie histórica. Los pesos se renormalizan sobre lo backtesteable. */
  holdings: { key: string; weight: number; series: PricePoint[] }[];
  lookbackDays: number;
}

export interface BacktestResult {
  dates: string[];
  /** NAV normalizado a 100 en el inicio (buy & hold, sin rebalanceo). */
  nav: number[];
  totalReturnPct: number;
  annualizedVolPct: number;
  maxDrawdownPct: number;
  /** Fracción del portafolio que SÍ tiene historia (los pesos se renormalizaron sobre esto). */
  coveredWeight: number;
  excluded: string[];
}

export function backtest(input: BacktestInput): BacktestResult | null {
  const usable = input.holdings.filter((h) => h.series.length > 30 && h.weight > 0);
  const excluded = input.holdings.filter((h) => !usable.includes(h)).map((h) => h.key);
  if (usable.length === 0) return null;

  const seriesByKey: Record<string, PricePoint[]> = {};
  for (const h of usable) seriesByKey[h.key] = lastN(h.series, input.lookbackDays + 1);
  const { dates, closes } = alignSeries(seriesByKey);
  if (dates.length < 30) return null;

  const coveredWeight = usable.reduce((s, h) => s + h.weight, 0);
  const totalIn = input.holdings.reduce((s, h) => s + h.weight, 0) || 1;

  // buy & hold: unidades fijas compradas el día 0 con pesos renormalizados
  const units = usable.map((h) => h.weight / coveredWeight / closes[h.key][0]);
  const nav = dates.map((_, t) =>
    usable.reduce((s, h, i) => s + units[i] * closes[h.key][t], 0) * 100,
  );

  const navSeries: PricePoint[] = dates.map((d, t) => ({ date: d, close: nav[t] }));
  const rets: number[] = [];
  for (let t = 1; t < nav.length; t++) rets.push(Math.log(nav[t] / nav[t - 1]));
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const vol = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252);

  return {
    dates,
    nav,
    totalReturnPct: (nav[nav.length - 1] / nav[0] - 1) * 100,
    annualizedVolPct: vol * 100,
    maxDrawdownPct: maxDrawdown(navSeries) * 100,
    coveredWeight: coveredWeight / totalIn,
    excluded,
  };
}

/**
 * Registro de instrumentos: generado por scripts/build-registry.ts a partir de
 * research/*.json (especificaciones verificadas contra fuentes primarias).
 * No editar instruments.generated.json a mano.
 */

import type { Instrument, MarketContext, Quote } from '../engine/types';
import generated from './instruments.generated.json';

export const INSTRUMENTS: Instrument[] = generated.instruments as Instrument[];
export const REGISTRY_ASOF: string = generated.asOf;

export interface MarketPayload {
  source: 'live' | 'snapshot';
  /** preopen = el mercado aún no operó hoy; volúmenes de referencia del último cierre. */
  session?: 'preopen' | 'open';
  volumeReferenceDate?: string;
  asOf: string;
  timestamp: string;
  quotes: { ticker: string; last: number; bid?: number; ask?: number; volume?: number }[];
  cerHistory: { date: string; value: number }[];
  a3500: number;
  mep: number;
  remMonthlyPct: { month: string; pct: number }[];
}

export function toQuotesMap(payload: MarketPayload): Map<string, Quote> {
  const map = new Map<string, Quote>();
  for (const q of payload.quotes) {
    map.set(q.ticker, {
      ticker: q.ticker,
      last: q.last,
      bid: q.bid,
      ask: q.ask,
      volume: q.volume,
      currency: q.ticker.endsWith('D') || q.ticker.endsWith('C') ? 'USD' : 'ARS',
    });
  }
  return map;
}

export function toMarketContext(payload: MarketPayload): MarketContext {
  return {
    asOf: payload.asOf,
    cerHistory: payload.cerHistory,
    remMonthlyPct: payload.remMonthlyPct,
    a3500: payload.a3500,
    mep: payload.mep,
  };
}

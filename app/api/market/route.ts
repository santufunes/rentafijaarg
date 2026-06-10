/**
 * Datos de mercado agregados para el cliente:
 * - Precios data912 (bonos soberanos + letras), con caché de 5 minutos.
 * - CER (historia 45 días) y A3500 del BCRA.
 * - MEP implícito AL30/AL30D.
 * - Fallback completo a snapshot embebido si alguna fuente falla.
 */

import { NextResponse } from 'next/server';
import snapshot from '@/lib/data/snapshot.json';

export const revalidate = 300;

interface D912Row {
  symbol: string;
  c: number;
  px_bid: number;
  px_ask: number;
  v: number;
  q_op: number;
}

async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<T> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function GET() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const [bonds, notes, cer, a3500] = await Promise.all([
      fetchJson<D912Row[]>('https://data912.com/live/arg_bonds'),
      fetchJson<D912Row[]>('https://data912.com/live/arg_notes'),
      fetchJson<{ results: { fecha: string; valor: number }[] }>(
        `https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/${snapshot.bcraIds.cer}?desde=${addDaysIso(today, -60)}&hasta=${today}`,
      ),
      fetchJson<{ results: { fecha: string; valor: number }[] }>(
        `https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/${snapshot.bcraIds.a3500}?desde=${addDaysIso(today, -10)}&hasta=${today}`,
      ),
    ]);

    const quotes = [...bonds, ...notes]
      .filter((r) => r.c > 0)
      .map((r) => ({ ticker: r.symbol, last: r.c, bid: r.px_bid, ask: r.px_ask, volume: r.v }));

    const cerHistory = cer.results
      .map((r) => ({ date: r.fecha, value: r.valor }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const a3500Sorted = a3500.results.sort((a, b) => a.fecha.localeCompare(b.fecha));
    const a3500Last = a3500Sorted[a3500Sorted.length - 1]?.valor;

    const al30 = quotes.find((q) => q.ticker === 'AL30')?.last;
    const al30d = quotes.find((q) => q.ticker === 'AL30D')?.last;
    const mep = al30 && al30d ? al30 / al30d : snapshot.market.mep;

    if (!cerHistory.length || !a3500Last) throw new Error('BCRA incompleto');

    return NextResponse.json({
      source: 'live',
      asOf: today,
      timestamp: new Date().toISOString(),
      quotes,
      cerHistory,
      a3500: a3500Last,
      mep,
      remMonthlyPct: snapshot.market.remMonthlyPct,
    });
  } catch (err) {
    // Fallback: snapshot embebido (fechado) — la UI lo señala con claridad.
    return NextResponse.json({
      source: 'snapshot',
      sourceError: String(err),
      asOf: snapshot.asOf,
      timestamp: snapshot.timestamp,
      quotes: snapshot.quotes,
      cerHistory: snapshot.cerHistory,
      a3500: snapshot.market.a3500,
      mep: snapshot.market.mep,
      remMonthlyPct: snapshot.market.remMonthlyPct,
    });
  }
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

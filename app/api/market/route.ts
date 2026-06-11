/**
 * Datos de mercado agregados para el cliente:
 * - Precios data912 (bonos soberanos + letras), con caché de 5 minutos.
 * - CER (historia 45 días) y A3500 del BCRA.
 * - MEP implícito AL30/AL30D.
 * - Fallback completo a snapshot embebido si alguna fuente falla.
 */

import { NextResponse } from 'next/server';
import generated from '@/lib/data/instruments.generated.json';
import snapshot from '@/lib/data/snapshot.json';

/** Tickers de ONs del registro: del panel corp solo interesan esas líneas. */
const ON_TICKERS = new Set(
  (generated.instruments as any[])
    .filter((i) => i.family === 'on')
    .flatMap((i) => [i.tickers?.ars, i.tickers?.mep, i.tickers?.cable].filter(Boolean)),
);

// La ruta debe ejecutarse en cada request (con caché de 5 min en los fetches
// upstream): prerenderizada estáticamente serviría precios congelados del
// build como si fueran "en vivo".
export const dynamic = 'force-dynamic';

/** Fecha calendario en Buenos Aires (UTC-3): después de las 21:00 ART la fecha UTC ya es mañana. */
function todayBuenosAires(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date());
}

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
  const today = todayBuenosAires();
  try {
    // BCRA v4: los valores vienen anidados en results[0].detalle. El "hasta" se
    // extiende unos días: el BCRA publica el cronograma CER con anticipación.
    type BcraSeries = { results: { detalle: { fecha: string; valor: number }[] }[] };
    const [bonds, notes, corp, cer, a3500] = await Promise.all([
      fetchJson<D912Row[]>('https://data912.com/live/arg_bonds'),
      fetchJson<D912Row[]>('https://data912.com/live/arg_notes'),
      fetchJson<D912Row[]>('https://data912.com/live/arg_corp').catch(() => [] as D912Row[]),
      fetchJson<BcraSeries>(
        `https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/${snapshot.bcraIds.cer}?desde=${addDaysIso(today, -60)}&hasta=${addDaysIso(today, 20)}`,
      ),
      fetchJson<BcraSeries>(
        `https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/${snapshot.bcraIds.a3500}?desde=${addDaysIso(today, -10)}&hasta=${today}`,
      ),
    ]);

    const quotes = [...bonds, ...notes, ...corp.filter((r) => ON_TICKERS.has(r.symbol))]
      .filter((r) => r.c > 0)
      .map((r) => ({ ticker: r.symbol, last: r.c, bid: r.px_bid, ask: r.px_ask, volume: r.v }));

    const cerHistory = (cer.results[0]?.detalle ?? [])
      .map((r) => ({ date: r.fecha, value: r.valor }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const a3500Sorted = (a3500.results[0]?.detalle ?? []).sort((a, b) =>
      a.fecha.localeCompare(b.fecha),
    );
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

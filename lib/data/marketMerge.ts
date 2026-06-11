/**
 * Volumen de referencia para liquidez.
 *
 * El feed en vivo trae el volumen acumulado DE HOY: antes de la apertura (y en
 * la primera hora de rueda) es ~0 para todo el panel, lo que haría que el
 * filtro de liquidez marque ilíquido al mercado entero. La liquidez de un
 * instrumento no desaparece a la madrugada: se evalúa contra
 * max(volumen de hoy, volumen del último cierre archivado en el snapshot).
 */

export interface RawQuote {
  ticker: string;
  last: number;
  bid?: number;
  ask?: number;
  volume?: number;
}

export function withReferenceVolumes(live: RawQuote[], reference: RawQuote[]): RawQuote[] {
  const refVol = new Map(reference.map((q) => [q.ticker, q.volume ?? 0]));
  return live.map((q) => ({
    ...q,
    volume: Math.max(q.volume ?? 0, refVol.get(q.ticker) ?? 0),
  }));
}

/**
 * Unión vivo ∪ referencia: el panel corporativo de data912 directamente NO
 * LISTA los tickers que todavía no operaron hoy (pre-apertura queda vacío).
 * Un ticker ausente del feed vivo no dejó de existir: cae al último cierre
 * archivado, con su precio y volumen de ese día.
 */
export function mergeWithReference(live: RawQuote[], reference: RawQuote[]): RawQuote[] {
  const out = new Map<string, RawQuote>(reference.map((q) => [q.ticker, { ...q }]));
  for (const q of live) {
    if (!(q.last > 0)) continue;
    const ref = out.get(q.ticker);
    out.set(q.ticker, { ...q, volume: Math.max(q.volume ?? 0, ref?.volume ?? 0) });
  }
  return [...out.values()];
}

/** Pre-apertura: la gran mayoría del panel todavía no operó. */
export function isPreOpen(live: RawQuote[]): boolean {
  if (live.length === 0) return false;
  const traded = live.filter((q) => (q.volume ?? 0) > 0).length;
  return traded / live.length < 0.2;
}

/**
 * Fechas: aritmética sobre días corridos (act/365) y días hábiles argentinos.
 * Todas las fechas son strings ISO (YYYY-MM-DD) interpretadas en UTC para evitar
 * corrimientos de zona horaria.
 */

const MS_DAY = 86_400_000;

export function toUTC(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function fromUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Días corridos entre dos fechas ISO (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUTC(b) - toUTC(a)) / MS_DAY);
}

export function addDays(iso: string, n: number): string {
  return fromUTC(toUTC(iso) + n * MS_DAY);
}

/** Fracción de año actual/365 (convención IAMC para TIR efectiva anual). */
export function yearFraction(a: string, b: string): number {
  return daysBetween(a, b) / 365;
}

/**
 * Feriados nacionales argentinos (días no hábiles cambiarios/bursátiles).
 * 2026 confirmados por Decreto + turísticos; 2027 previstos (los fijos son exactos,
 * los trasladables se ajustan cuando se publique el decreto).
 * Solo afectan el cálculo de liquidación T+1 y el rezago CER t-10: un error de un
 * día hábil en 2027 tiene impacto despreciable en TIR.
 */
const HOLIDAYS = new Set<string>([
  // 2026
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-03-24', '2026-04-02',
  '2026-04-03', '2026-05-01', '2026-05-25', '2026-06-15', '2026-06-20',
  '2026-07-09', '2026-08-17', '2026-10-12', '2026-11-23', '2026-12-07',
  '2026-12-08', '2026-12-25',
  // 2027 (fijos + trasladables previstos)
  '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-24', '2027-03-25',
  '2027-03-26', '2027-04-02', '2027-05-01', '2027-05-25', '2027-06-21',
  '2027-07-09', '2027-08-16', '2027-10-11', '2027-11-22', '2027-12-08',
  '2027-12-25',
]);

export function isBusinessDay(iso: string): boolean {
  const dow = new Date(toUTC(iso)).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !HOLIDAYS.has(iso);
}

export function nextBusinessDay(iso: string): string {
  let d = addDays(iso, 1);
  while (!isBusinessDay(d)) d = addDays(d, 1);
  return d;
}

/** Resta n días hábiles (para el rezago CER t-10). */
export function subtractBusinessDays(iso: string, n: number): string {
  let d = iso;
  let left = n;
  while (left > 0) {
    d = addDays(d, -1);
    if (isBusinessDay(d)) left--;
  }
  return d;
}

/** Liquidación estándar BYMA: T+1 hábil desde la fecha de concertación. */
export function settlementT1(tradeDate: string): string {
  return nextBusinessDay(tradeDate);
}

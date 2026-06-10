/**
 * CER: coeficiente aplicable y proyección.
 *
 * - Los bonos CER ajustan por CER(fecha - 10 días hábiles) / CER base de emisión
 *   (Ley 25.827 y condiciones de emisión vigentes).
 * - Para fechas pasadas se usa la serie oficial BCRA.
 * - Para fechas futuras se proyecta desde el último dato con la senda de
 *   inflación mensual del REM (capitalización diaria dentro del mes).
 */

import { addDays, subtractBusinessDays, toUTC } from './dates';
import type { MarketContext } from './types';

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** CER en una fecha calendario (observado, o proyectado con REM si es futura). */
export function cerAt(date: string, ctx: MarketContext): number {
  const hist = ctx.cerHistory;
  if (hist.length === 0) throw new Error('Sin historia CER');
  const last = hist[hist.length - 1];

  if (toUTC(date) <= toUTC(last.date)) {
    // serie diaria: tomar el último valor <= date
    for (let i = hist.length - 1; i >= 0; i--) {
      if (toUTC(hist[i].date) <= toUTC(date)) return hist[i].value;
    }
    return hist[0].value;
  }

  // Proyección: capitalización diaria con la tasa mensual REM del mes correspondiente.
  let value = last.value;
  let cursor = last.date;
  while (toUTC(cursor) < toUTC(date)) {
    cursor = addDays(cursor, 1);
    const ym = cursor.slice(0, 7);
    const rem =
      ctx.remMonthlyPct.find((r) => r.month === ym) ??
      ctx.remMonthlyPct[ctx.remMonthlyPct.length - 1];
    const pct = rem ? rem.pct : 0;
    const [y, m] = ym.split('-').map(Number);
    const dailyFactor = Math.pow(1 + pct / 100, 1 / daysInMonth(y, m));
    value *= dailyFactor;
  }
  return value;
}

/** CER aplicable a una liquidación/pago: CER(fecha − 10 hábiles). */
export function applicableCer(date: string, ctx: MarketContext): number {
  return cerAt(subtractBusinessDays(date, 10), ctx);
}

/** Ratio de indexación de un bono CER a una fecha dada. */
export function cerRatio(date: string, cerBase: number, ctx: MarketContext): number {
  if (cerBase <= 0) throw new Error(`CER base inválido: ${cerBase}`);
  return applicableCer(date, ctx) / cerBase;
}

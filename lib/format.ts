/** Formato es-AR. */

const ars0 = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});
const ars2 = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usd2 = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const num = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

export const fmtArs = (v: number) => ars0.format(v);
export const fmtArs2 = (v: number) => ars2.format(v);
export const fmtUsd = (v: number) => usd2.format(v);
export const fmtNum = (v: number) => num.format(v);
export const fmtPct = (v: number, digits = 1) =>
  `${new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v)}%`;

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS_ES[Number(m) - 1]} ${y}`;
}

export function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MONTHS_ES[Number(m) - 1]} ${y.slice(2)}`;
}

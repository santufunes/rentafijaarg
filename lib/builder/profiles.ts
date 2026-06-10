/**
 * Perfiles y matrices de asignación.
 *
 * Tres segmentos:
 *  - tasa_fija: LECAP/BONCAP en pesos (carry nominal, baja volatilidad de precio
 *    a vencimiento si se calza con el horizonte).
 *  - cer: BONCER cupón cero (protección contra inflación).
 *  - dolar: soberanos hard-dollar y BOPREAL (dolarización; mayor volatilidad).
 *
 * Los pesos base dependen del perfil de riesgo y de la moneda en la que el
 * inversor piensa su objetivo; el horizonte ajusta (horizontes cortos reducen
 * exposición a duración larga en dólares y a CER).
 */

export type ProfileKey = 'conservador' | 'moderado' | 'agresivo';
export type CurrencyGoal = 'pesos' | 'mixto' | 'dolares';
export type SegmentKey = 'tasa_fija' | 'cer' | 'dolar';

export interface Profile {
  key: ProfileKey;
  label: string;
  description: string;
}

export const PROFILES: Profile[] = [
  {
    key: 'conservador',
    label: 'Conservador',
    description: 'Priorizás no perder. Instrumentos cortos, calzados con tu horizonte.',
  },
  {
    key: 'moderado',
    label: 'Moderado',
    description: 'Aceptás algo de variación en el camino a cambio de mejor rendimiento.',
  },
  {
    key: 'agresivo',
    label: 'Agresivo',
    description: 'Buscás maximizar el rendimiento y tolerás caídas transitorias fuertes.',
  },
];

export const CURRENCY_GOALS: { key: CurrencyGoal; label: string; description: string }[] = [
  { key: 'pesos', label: 'En pesos', description: 'Tu objetivo es ganarle a la inflación en ARS.' },
  { key: 'mixto', label: 'Mixto', description: 'Parte en pesos, parte dolarizada.' },
  { key: 'dolares', label: 'En dólares', description: 'Tu objetivo es acumular dólares (MEP).' },
];

export const HORIZONS: { months: number; label: string }[] = [
  { months: 3, label: '3 meses' },
  { months: 6, label: '6 meses' },
  { months: 12, label: '1 año' },
  { months: 24, label: '2 años' },
  { months: 36, label: '3 años o más' },
];

type Weights = Record<SegmentKey, number>;

const BASE_WEIGHTS: Record<CurrencyGoal, Record<ProfileKey, Weights>> = {
  pesos: {
    conservador: { tasa_fija: 60, cer: 40, dolar: 0 },
    moderado: { tasa_fija: 45, cer: 35, dolar: 20 },
    agresivo: { tasa_fija: 30, cer: 30, dolar: 40 },
  },
  mixto: {
    conservador: { tasa_fija: 40, cer: 30, dolar: 30 },
    moderado: { tasa_fija: 30, cer: 25, dolar: 45 },
    agresivo: { tasa_fija: 20, cer: 20, dolar: 60 },
  },
  dolares: {
    conservador: { tasa_fija: 20, cer: 10, dolar: 70 },
    moderado: { tasa_fija: 10, cer: 10, dolar: 80 },
    agresivo: { tasa_fija: 0, cer: 0, dolar: 100 },
  },
};

/**
 * Pesos objetivo ajustados por horizonte:
 * - Horizonte ≤ 3 meses: el CER corto pierde sentido (el ajuste llega con rezago
 *   y la curva corta CER suele rendir menos que la tasa fija) → se pasa a tasa fija.
 * - Conservador con horizonte ≤ 6 meses: la mitad del bucket dólar (bonos largos,
 *   MD alta) se pasa a tasa fija para no exponer un horizonte corto a duración.
 */
export function targetWeights(
  profile: ProfileKey,
  goal: CurrencyGoal,
  horizonMonths: number,
): Weights {
  const w = { ...BASE_WEIGHTS[goal][profile] };
  if (horizonMonths <= 3) {
    w.tasa_fija += w.cer;
    w.cer = 0;
  }
  if (profile === 'conservador' && horizonMonths <= 6 && w.dolar > 0) {
    const shift = w.dolar / 2;
    w.dolar -= shift;
    w.tasa_fija += shift;
  }
  return w;
}

export const SEGMENT_LABELS: Record<SegmentKey, { label: string; color: string }> = {
  tasa_fija: { label: 'Tasa fija en pesos', color: '#0ea5e9' },
  cer: { label: 'Ajuste por inflación (CER)', color: '#8b5cf6' },
  dolar: { label: 'Dólares (bonos hard-dollar)', color: '#10b981' },
};

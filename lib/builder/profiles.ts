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
  focus: PesoFocus = 'equilibrado',
): Weights {
  // El enfoque inclina los pesos BASE; las reglas de horizonte se aplican
  // después y son finales (un horizonte de 3 meses anula el CER aunque el
  // usuario haya pedido enfoque inflación: el ajuste llega con rezago).
  const w = applyPesoFocus({ ...BASE_WEIGHTS[goal][profile] }, focus);
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

// ---------------------------------------------------------------------------
// Enfoque del flujo en pesos: inclina la balanza tasa fija ↔ CER sin tocar el
// bucket dólar (eso lo decide el objetivo pesos/mixto).
// ---------------------------------------------------------------------------

export type PesoFocus = 'equilibrado' | 'tasa_fija' | 'inflacion';

export const PESO_FOCUSES: { key: PesoFocus; label: string; description: string }[] = [
  {
    key: 'equilibrado',
    label: 'Equilibrado',
    description: 'Mitad tasa fija, mitad protección inflación, según tu perfil.',
  },
  {
    key: 'tasa_fija',
    label: 'Tasa fija',
    description: 'Priorizá la tasa nominal: rendís más si la inflación baja como espera el mercado.',
  },
  {
    key: 'inflacion',
    label: 'Inflación',
    description: 'Priorizá CER: tu capital sigue al IPC aunque la inflación sorprenda al alza.',
  },
];

/** Mueve la mitad del peso del bucket desfavorecido hacia el favorecido. */
export function applyPesoFocus(
  w: Record<SegmentKey, number>,
  focus: PesoFocus,
): Record<SegmentKey, number> {
  const out = { ...w };
  if (focus === 'tasa_fija') {
    const shift = out.cer / 2;
    out.cer -= shift;
    out.tasa_fija += shift;
  } else if (focus === 'inflacion') {
    const shift = out.tasa_fija / 2;
    out.tasa_fija -= shift;
    out.cer += shift;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Flujo en dólares: estilo (riesgo) × composición (qué tipo de papel).
// ---------------------------------------------------------------------------

export type UsdStyle = 'conservador' | 'moderado' | 'agresivo';
export type UsdComposition = 'mixto' | 'soberanos' | 'corporativos';

export const USD_STYLES: {
  key: UsdStyle;
  label: string;
  description: string;
  /** % del bucket dólar en soberanos/BCRA cuando la composición es mixta. */
  sovPct: number;
  /** Perfil de crédito que hereda la escalera de ONs. */
  credit: 'solido' | 'balanceado' | 'rendidor';
}[] = [
  {
    key: 'conservador',
    label: 'Conservador',
    description: 'Mayoría ONs AAA con vencimientos calzados; algo de BOPREAL/soberano corto.',
    sovPct: 30,
    credit: 'solido',
  },
  {
    key: 'moderado',
    label: 'Moderado',
    description: 'Mitad soberanos (AL30 + tramo medio), mitad ONs investment grade local.',
    sovPct: 50,
    credit: 'balanceado',
  },
  {
    key: 'agresivo',
    label: 'Agresivo',
    description: 'Mayoría soberanos largos (apuesta a compresión del riesgo país) + ONs de spread.',
    sovPct: 70,
    credit: 'rendidor',
  },
];

export const USD_COMPOSITIONS: { key: UsdComposition; label: string; description: string }[] = [
  { key: 'mixto', label: 'Mixto', description: 'Soberanos + ONs según tu estilo.' },
  { key: 'soberanos', label: 'Solo soberanos', description: 'Curva AL/GD/Bonar + BOPREAL.' },
  { key: 'corporativos', label: 'Solo ONs', description: 'Escalera de crédito corporativo.' },
];

/**
 * Tipos del motor de renta fija.
 *
 * Convenciones (mercado argentino / IAMC):
 * - Precios por cada 100 de valor nominal (VN) original, sucios (incluyen interés corrido).
 * - TIR: tasa efectiva anual, descuento actual/365 sobre días corridos.
 * - Liquidación estándar BYMA: T+1 hábil.
 * - Flujos expresados por 100 VN original.
 */

export type Family =
  | 'soberano_usd'
  | 'bopreal'
  | 'on'
  | 'lecap'
  | 'boncap'
  | 'bonte'
  | 'boncer'
  | 'dual_tamar'
  | 'dollar_linked';

export type Currency = 'ARS' | 'USD';

/** Un flujo de fondos por 100 VN original, en la moneda de pago del instrumento. */
export interface Cashflow {
  date: string; // ISO YYYY-MM-DD
  interest: number;
  amortization: number;
}

interface InstrumentBase {
  ticker: string; // ticker en pesos (panel principal BYMA)
  name: string;
  family: Family;
  payCcy: Currency;
  issueDate: string;
  maturity: string;
  minLot: number;
  /** Variantes de liquidación: D = dólar MEP, C = cable. */
  tickers: { ars: string; mep?: string; cable?: string };
  law?: 'AR' | 'NY';
  /** Emisor y sector (ONs). */
  issuer?: string;
  sector?: string;
  /** Calificación local (ONs), p.ej. "AAA(arg)"; tier normalizado 1 (mejor) a 3 (peor/sin calificar). */
  rating?: string | null;
  ratingAgency?: string | null;
  ratingTier?: 1 | 2 | 3;
  sources?: string[];
}

/** Bono con flujos fijos explícitos (soberanos USD, BOPREAL, BONTE). */
export interface FixedCashflowInstrument extends InstrumentBase {
  kind: 'fixed';
  cashflows: Cashflow[];
}

/** Letra/bono a tasa fija capitalizable, cupón cero (LECAP, BONCAP, leg fijo de dual). */
export interface ZeroFixedInstrument extends InstrumentBase {
  kind: 'zero';
  /** Pago final por 100 VN, fijado en la emisión. */
  finalPaymentPer100: number;
  /** TEM de emisión (informativa). */
  temIssuePct?: number;
}

/** Instrumento CER: flujos definidos en términos reales, indexados por CER(t-10)/cerBase. */
export interface CerInstrument extends InstrumentBase {
  kind: 'cer';
  /** CER base de emisión (oficial, del prospecto/licitación). */
  cerBase: number;
  /** Flujos por 100 VN en términos reales (sin indexar). */
  realCashflows: Cashflow[];
}

/** Dual TAMAR: max(leg fijo capitalizable, leg TAMAR). Se valúa el leg fijo y se marca el piso. */
export interface DualTamarInstrument extends InstrumentBase {
  kind: 'dual_tamar';
  fixedFinalPaymentPer100: number;
  temIssuePct?: number;
}

/** Dollar-linked: paga en ARS el equivalente de 100 VN USD al A3500. Cotiza en ARS por 100 VN USD. */
export interface DollarLinkedInstrument extends InstrumentBase {
  kind: 'dollar_linked';
  /** Flujos por 100 VN en USD-equivalentes. */
  usdCashflows: Cashflow[];
}

export type Instrument =
  | FixedCashflowInstrument
  | ZeroFixedInstrument
  | CerInstrument
  | DualTamarInstrument
  | DollarLinkedInstrument;

/** Contexto de mercado necesario para valuar. */
export interface MarketContext {
  /** Fecha de "hoy" (datos), ISO. */
  asOf: string;
  /** CER: historia reciente [{fecha, valor}] ordenada ascendente, suficiente para t-10 hábiles. */
  cerHistory: { date: string; value: number }[];
  /** Proyección de inflación mensual (REM), % mensual, para proyectar CER hacia adelante. */
  remMonthlyPct: { month: string; pct: number }[];
  /** A3500 mayorista último. */
  a3500: number;
  /** MEP implícito (AL30/AL30D o similar). */
  mep: number;
}

export interface Quote {
  ticker: string;
  /** Último precio sucio por 100 VN, en la moneda del ticker (ARS para el principal, USD para D). */
  last: number;
  bid?: number;
  ask?: number;
  /** Volumen nominal operado (proxy de liquidez). */
  volume?: number;
  currency: Currency;
}

export interface PricedInstrument {
  instrument: Instrument;
  quote: Quote;
  settlement: string;
  /** TIR efectiva anual (decimal, p.ej. 0.105). Para CER es TIR real; para el resto, en su moneda de pago. */
  tir: number;
  /** Sobre flujos nominales proyectados (CER: con REM). */
  tirNominal?: number;
  macaulay: number; // años
  modifiedDuration: number;
  /** Flujos remanentes por 100 VN en moneda de pago, ya indexados/proyectados si aplica. */
  projectedCashflows: { date: string; amount: number }[];
  /** Precio usado (sucio, por 100 VN, en payCcy — convertido si el quote está en ARS y paga USD). */
  dirtyPricePayCcy: number;
}

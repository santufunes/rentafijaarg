/**
 * Carteras modelo ("core portfolios"): recetas fijas y auditables que combinan
 * los constructores de renta fija ya verificados con canastas de acciones y
 * CEDEARs seleccionadas por liquidez real (turnover del panel) y diversificación
 * sectorial. Cada receta declara su regla — nada discrecional escondido.
 */

import equityData from '../data/equity.generated.json';
import { buildProposal, type Proposal } from '../builder/construct';
import { buildUsdPortfolio, type UsdProposal } from '../builder/usdportfolio';
import type { MarketContext, Quote } from '../engine/types';
import type { Instrument } from '../engine/types';

export interface EquityMeta {
  ticker: string;
  kind: 'accion' | 'cedear';
  name: string;
  sector: string;
  country?: string;
  isEtf?: boolean;
  vol1yPct: number | null;
  ret1mPct?: number | null;
  ret3mPct?: number | null;
  ret1yPct: number | null;
  maxDd1yPct: number | null;
  lastClose: number | null;
  lastVolume?: number;
}

export const EQUITY_UNIVERSE: EquityMeta[] = [
  ...(equityData.stocks as EquityMeta[]),
  ...(equityData.cedears as EquityMeta[]),
];

export interface EquityLine {
  meta: EquityMeta;
  targetWeight: number;
  nominals: number;
  priceArs: number;
  investedArs: number;
  rationale: string;
}

export interface MixedPortfolio {
  key: string;
  name: string;
  horizonMonths: number;
  fi: Proposal | UsdProposal | null;
  fiWeightPct: number;
  eqLines: EquityLine[];
  eqWeightPct: number;
  totalInvestedArs: number;
  cashLeftArs: number;
  estimatedFeesArs: number;
  warnings: string[];
}

export interface CorePortfolioDef {
  key: string;
  name: string;
  tagline: string;
  /** 1 (muy conservadora) … 5 (agresiva). */
  risk: 1 | 2 | 3 | 4 | 5;
  rule: string;
  minHorizonMonths: number;
  fiWeightPct: number;
  build: (
    universe: Instrument[],
    quotes: Map<string, Quote>,
    ctx: MarketContext,
    amountArs: number,
    horizonMonths: number,
  ) => MixedPortfolio;
}

const EQ_FEE_RATE = (0.5 / 100) * 1.21 + 0.0005; // comisión+IVA + derechos acciones/CEDEARs

/** Canasta de acciones líderes: top-N por turnover con tope sectorial. */
export function pickEquities(
  kind: 'accion' | 'cedear' | 'ambas',
  quotes: Map<string, Quote>,
  n: number,
  maxPerSector = 2,
): { meta: EquityMeta; priceArs: number; rationale: string }[] {
  const pool = EQUITY_UNIVERSE.filter((m) => kind === 'ambas' || m.kind === kind);
  const withQuote = pool
    .map((m) => {
      const q = quotes.get(m.ticker);
      return { meta: m, q, turnover: (q?.volume ?? 0) * (q?.last ?? 0) };
    })
    .filter((x) => x.q && x.q.last > 0)
    .sort((a, b) => b.turnover - a.turnover);
  const out: { meta: EquityMeta; priceArs: number; rationale: string }[] = [];
  const bySector = new Map<string, number>();
  for (const x of withQuote) {
    if (out.length >= n) break;
    const s = x.meta.sector;
    if ((bySector.get(s) ?? 0) >= maxPerSector) continue;
    bySector.set(s, (bySector.get(s) ?? 0) + 1);
    out.push({
      meta: x.meta,
      priceArs: x.q!.last,
      rationale: `Top liquidez del panel (${(x.turnover / 1e9).toFixed(1)}B ARS/día), sector ${s}.`,
    });
  }
  return out;
}

function sizeEquities(
  picks: { meta: EquityMeta; priceArs: number; rationale: string }[],
  budgetArs: number,
): { lines: EquityLine[]; spent: number; warnings: string[] } {
  const warnings: string[] = [];
  const lines: EquityLine[] = [];
  let spent = 0;
  const perLine = budgetArs / Math.max(1, picks.length);
  for (const p of picks) {
    const nominals = Math.floor(perLine / p.priceArs);
    if (nominals < 1) {
      warnings.push(`${p.meta.ticker}: el monto asignado no alcanza para 1 acción ($${Math.round(p.priceArs).toLocaleString('es-AR')}); línea omitida.`);
      continue;
    }
    const invested = nominals * p.priceArs;
    spent += invested;
    lines.push({
      meta: p.meta,
      targetWeight: perLine / budgetArs,
      nominals,
      priceArs: p.priceArs,
      investedArs: invested,
      rationale: p.rationale,
    });
  }
  return { lines, spent, warnings };
}

function mixed(
  key: string,
  name: string,
  horizonMonths: number,
  fi: Proposal | UsdProposal | null,
  fiWeightPct: number,
  eq: { lines: EquityLine[]; spent: number; warnings: string[] } | null,
  amountArs: number,
): MixedPortfolio {
  const eqSpent = eq?.spent ?? 0;
  const eqFees = eqSpent * EQ_FEE_RATE;
  const fiSpent = fi?.totalInvestedArs ?? 0;
  const fiFees = fi?.estimatedFeesArs ?? 0;
  return {
    key,
    name,
    horizonMonths,
    fi,
    fiWeightPct,
    eqLines: eq?.lines ?? [],
    eqWeightPct: 100 - fiWeightPct,
    totalInvestedArs: fiSpent + eqSpent,
    cashLeftArs: amountArs - fiSpent - fiFees - eqSpent - eqFees,
    estimatedFeesArs: fiFees + eqFees,
    warnings: [...(fi?.warnings ?? []), ...(eq?.warnings ?? [])],
  };
}

export const CORE_PORTFOLIOS: CorePortfolioDef[] = [
  {
    key: 'carry_pesos',
    name: 'Carry en Pesos',
    tagline: 'Tasa fija calzada a tu horizonte. El clásico para ganarle al plazo fijo.',
    risk: 1,
    rule: 'Renta fija en pesos, enfoque tasa fija, perfil conservador.',
    minHorizonMonths: 3,
    fiWeightPct: 100,
    build: (u, q, ctx, amount, h) =>
      mixed('carry_pesos', 'Carry en Pesos', h,
        buildProposal(u, q, ctx, { amountArs: amount, horizonMonths: h, profile: 'conservador', goal: 'pesos', focus: 'tasa_fija', commissionPct: 0.5 }),
        100, null, amount),
  },
  {
    key: 'inflacion_plus',
    name: 'Inflación Plus',
    tagline: 'Tu capital sigue al IPC, con un tramo de tasa fija para el carry.',
    risk: 2,
    rule: 'Renta fija en pesos, enfoque inflación, perfil moderado.',
    minHorizonMonths: 6,
    fiWeightPct: 100,
    build: (u, q, ctx, amount, h) =>
      mixed('inflacion_plus', 'Inflación Plus', h,
        buildProposal(u, q, ctx, { amountArs: amount, horizonMonths: h, profile: 'moderado', goal: 'pesos', focus: 'inflacion', commissionPct: 0.5 }),
        100, null, amount),
  },
  {
    key: 'dolarizador',
    name: 'Dolarizador',
    tagline: 'Todo a dólares MEP: soberanos cortos + ONs AAA calzadas al horizonte.',
    risk: 2,
    rule: 'Flujo USD estilo conservador, composición mixta.',
    minHorizonMonths: 6,
    fiWeightPct: 100,
    build: (u, q, ctx, amount, h) =>
      mixed('dolarizador', 'Dolarizador', h,
        buildUsdPortfolio(u, q, ctx, { amountUsd: amount / ctx.mep, horizonMonths: h, style: 'conservador', composition: 'mixto', commissionPct: 0.5 }),
        100, null, amount),
  },
  {
    key: 'credito_corporativo',
    name: 'Crédito Corporativo',
    tagline: 'Escalera de ONs investment grade local: cobrás cupones en USD todo el camino.',
    risk: 3,
    rule: 'Flujo USD composición solo-ONs, crédito balanceado.',
    minHorizonMonths: 12,
    fiWeightPct: 100,
    build: (u, q, ctx, amount, h) =>
      mixed('credito_corporativo', 'Crédito Corporativo', h,
        buildUsdPortfolio(u, q, ctx, { amountUsd: amount / ctx.mep, horizonMonths: h, style: 'moderado', composition: 'corporativos', commissionPct: 0.5 }),
        100, null, amount),
  },
  {
    key: 'sesenta_cuarenta',
    name: '60/40 Argentino',
    tagline: 'Renta fija mixta + acciones líderes. El balanceado local.',
    risk: 4,
    rule: '60% renta fija (pesos mixto, moderado) + 40% top-6 acciones líderes por turnover (máx. 2 por sector), peso igual.',
    minHorizonMonths: 12,
    fiWeightPct: 60,
    build: (u, q, ctx, amount, h) => {
      const fi = buildProposal(u, q, ctx, { amountArs: amount * 0.6, horizonMonths: h, profile: 'moderado', goal: 'mixto', focus: 'equilibrado', commissionPct: 0.5 });
      const eqBudget = (amount * 0.4) / (1 + EQ_FEE_RATE);
      const eq = sizeEquities(pickEquities('accion', q, 6), eqBudget);
      return mixed('sesenta_cuarenta', '60/40 Argentino', h, fi, 60, eq, amount);
    },
  },
  {
    key: 'acciones_argentina',
    name: 'Acciones Argentina',
    tagline: 'Las 8 líderes más operadas del panel, diversificadas por sector.',
    risk: 5,
    rule: 'Top-8 acciones por turnover, máx. 2 por sector, peso igual. 100% renta variable.',
    minHorizonMonths: 24,
    fiWeightPct: 0,
    build: (u, q, ctx, amount, h) => {
      const eqBudget = amount / (1 + EQ_FEE_RATE);
      const eq = sizeEquities(pickEquities('accion', q, 8), eqBudget);
      return mixed('acciones_argentina', 'Acciones Argentina', h, null, 0, eq, amount);
    },
  },
  {
    key: 'global_cedears',
    name: 'Global CEDEARs',
    tagline: 'Exposición global en pesos: las 10 CEDEARs más líquidas, máx. 2 por sector.',
    risk: 4,
    rule: 'Top-10 CEDEARs por turnover, máx. 2 por sector, peso igual. Dolarización implícita vía CCL.',
    minHorizonMonths: 24,
    fiWeightPct: 0,
    build: (u, q, ctx, amount, h) => {
      const eqBudget = amount / (1 + EQ_FEE_RATE);
      const eq = sizeEquities(pickEquities('cedear', q, 10), eqBudget);
      return mixed('global_cedears', 'Global CEDEARs', h, null, 0, eq, amount);
    },
  },
];

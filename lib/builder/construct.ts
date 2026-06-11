/**
 * Construcción de la propuesta: selección de instrumentos por segmento,
 * sizing a nominales enteros y costos.
 *
 * Reglas de selección:
 * - Liquidez primero: dentro de cada segmento solo se consideran instrumentos
 *   con volumen operado relevante en la línea en pesos (o de la lista de
 *   "siempre líquidos").
 * - Calce de horizonte: tasa fija y CER se eligen con vencimiento lo más
 *   cercano posible al horizonte; en dólares la duración objetivo crece con el
 *   perfil, y las ONs (crédito corporativo) entran como carry de menor beta en
 *   perfiles conservador y moderado.
 * - Cada decisión queda registrada en `traces`: qué candidatos se miraron, por
 *   qué se eligió cada línea y por qué se descartó el resto. Es la misma
 *   información que muestra la pestaña Asignación de la terminal.
 */

import { daysBetween, settlementT1 } from '../engine/dates';
import { priceInstrument } from '../engine/pricing';
import type { Family, Instrument, MarketContext, PricedInstrument, Quote } from '../engine/types';
import type { Position } from '../engine/portfolio';
import {
  applyPesoFocus,
  targetWeights,
  type CurrencyGoal,
  type PesoFocus,
  type ProfileKey,
  type SegmentKey,
} from './profiles';

export interface BuilderInputs {
  amountArs: number;
  horizonMonths: number;
  profile: ProfileKey;
  goal: CurrencyGoal;
  /** Enfoque del flujo en pesos: inclina tasa fija ↔ CER. */
  focus?: PesoFocus;
  /** Comisión del broker en %, configurable (default 0.5% + IVA). */
  commissionPct: number;
}

export interface ProposalLine {
  position: Position;
  rationale: string;
}

export interface CandidateTrace {
  ticker: string;
  name: string;
  family: Family;
  months: number;
  tirPct: number;
  mdYears: number;
  turnoverArs: number;
  liquid: boolean;
  selected: boolean;
  /** Por qué se eligió, o por qué quedó afuera. Siempre presente. */
  reason: string;
}

export interface SegmentTrace {
  segment: SegmentKey;
  targetWeightPct: number;
  candidates: CandidateTrace[];
}

export interface Proposal {
  inputs: BuilderInputs;
  settlement: string;
  lines: ProposalLine[];
  totalInvestedArs: number;
  cashLeftArs: number;
  estimatedFeesArs: number;
  warnings: string[];
  traces: SegmentTrace[];
}

const ALWAYS_LIQUID = new Set(['AL30', 'GD30', 'AL35', 'GD35', 'AE38', 'GD41']);
const MIN_VOLUME_ARS = 1_000_000; // volumen mínimo diario aproximado para considerar líquido

const SEGMENT_FAMILIES: Record<SegmentKey, Family[]> = {
  tasa_fija: ['lecap', 'boncap', 'bonte'],
  cer: ['boncer'],
  dolar: ['soberano_usd', 'bopreal', 'on'],
};

function segmentOf(instr: Instrument): SegmentKey | null {
  for (const seg of Object.keys(SEGMENT_FAMILIES) as SegmentKey[]) {
    if (SEGMENT_FAMILIES[seg].includes(instr.family)) return seg;
  }
  return null; // duales y dollar-linked quedan fuera de las propuestas
}

function monthsToMaturity(p: PricedInstrument, asOf: string): number {
  return daysBetween(asOf, p.instrument.maturity) / 30.44;
}

/**
 * Liquidez medida sobre la línea en PESOS (el ticker que efectivamente se
 * compra), no sobre la línea D: el volumen del panel USD está en USD y
 * compararlo contra un umbral en ARS excluiría instrumentos perfectamente
 * líquidos.
 */
export function arsTurnover(p: PricedInstrument, quotes: Map<string, Quote>): number {
  const q = quotes.get(p.instrument.tickers.ars);
  return ((q?.volume ?? 0) * (q?.last ?? 0)) / 100;
}

export function isLiquid(p: PricedInstrument, quotes: Map<string, Quote>): boolean {
  if (ALWAYS_LIQUID.has(p.instrument.ticker)) return true;
  return arsTurnover(p, quotes) >= MIN_VOLUME_ARS;
}

/** Precio en ARS de 1 VN (para sizing siempre se compra el ticker en pesos). */
function arsPricePerVN(p: PricedInstrument, quotes: Map<string, Quote>): number {
  const ars = quotes.get(p.instrument.tickers.ars);
  if (ars && ars.last > 0) return ars.last / 100;
  throw new Error(`Sin precio ARS para ${p.instrument.ticker}`);
}

interface Pick {
  priced: PricedInstrument;
  targetArs: number;
  rationale: string;
}

/** Registro de decisiones de un segmento: cada candidato termina con un motivo. */
export class Tracer {
  private map = new Map<string, CandidateTrace>();

  constructor(
    candidates: PricedInstrument[],
    quotes: Map<string, Quote>,
    asOf: string,
  ) {
    for (const p of candidates) {
      const turnover = arsTurnover(p, quotes);
      const liquid = isLiquid(p, quotes);
      this.map.set(p.instrument.ticker, {
        ticker: p.instrument.ticker,
        name: p.instrument.name,
        family: p.instrument.family,
        months: monthsToMaturity(p, asOf),
        tirPct: p.tir * 100,
        mdYears: p.modifiedDuration,
        turnoverArs: turnover,
        liquid,
        selected: false,
        reason: liquid
          ? ''
          : `Volumen diario ~$${Math.round(turnover / 1000)}k < $1M: sin liquidez suficiente para proponerlo.`,
      });
    }
  }

  select(p: PricedInstrument, reason: string) {
    const e = this.map.get(p.instrument.ticker);
    if (e) {
      e.selected = true;
      e.reason = reason;
    }
  }

  why(p: PricedInstrument, reason: string) {
    const e = this.map.get(p.instrument.ticker);
    if (e && !e.selected && !e.reason) e.reason = reason;
  }

  /** Motivo por defecto para los que quedaron sin explicación específica. */
  finish(defaultReason: string): CandidateTrace[] {
    const list = [...this.map.values()];
    for (const e of list) if (!e.selected && !e.reason) e.reason = defaultReason;
    return list.sort((a, b) => Number(b.selected) - Number(a.selected) || a.months - b.months);
  }
}

function pickTasaFija(
  liquid: PricedInstrument[],
  tracer: Tracer,
  horizon: number,
  asOf: string,
): Omit<Pick, 'targetArs'>[] {
  const candidates = liquid
    .filter((p) => p.instrument.kind === 'zero')
    .sort((a, b) => a.instrument.maturity.localeCompare(b.instrument.maturity));
  if (candidates.length === 0) return [];

  // Calce: el de vencimiento más cercano al horizonte sin pasarse de horizonte+3m.
  const within = candidates.filter((p) => monthsToMaturity(p, asOf) <= horizon + 3);
  for (const p of candidates) {
    if (!within.includes(p))
      tracer.why(p, `Vence a los ${monthsToMaturity(p, asOf).toFixed(0)} meses: más de 3 meses después de tu horizonte.`);
  }
  const anchorPool = within.length > 0 ? within : [candidates[0]];
  const anchor = anchorPool.reduce((best, p) =>
    Math.abs(monthsToMaturity(p, asOf) - horizon) < Math.abs(monthsToMaturity(best, asOf) - horizon)
      ? p
      : best,
  );
  const anchorMonths = monthsToMaturity(anchor, asOf);
  const anchorMatchesHorizon = anchorMonths >= horizon - 3;
  const anchorRationale = anchorMatchesHorizon
    ? `Vence cerca de tu horizonte: cobrás el pago final fijo sin depender del precio de venta.`
    : `La tasa fija más larga con liquidez vence a los ~${Math.round(anchorMonths)} meses: al cobrarla vas a tener que reinvertir hasta tu horizonte.`;
  tracer.select(anchor, anchorRationale);
  const picks: Omit<Pick, 'targetArs'>[] = [{ priced: anchor, rationale: anchorRationale }];

  // Escalonado: una letra a ~mitad de camino, si existe y es distinta.
  if (horizon >= 6) {
    const half = candidates
      .filter((p) => p !== anchor && monthsToMaturity(p, asOf) >= 1)
      .reduce<PricedInstrument | null>(
        (best, p) =>
          best === null ||
          Math.abs(monthsToMaturity(p, asOf) - horizon / 2) <
            Math.abs(monthsToMaturity(best, asOf) - horizon / 2)
            ? p
            : best,
        null,
      );
    if (half && Math.abs(monthsToMaturity(half, asOf) - horizon / 2) < horizon / 4) {
      const r = 'Escalona vencimientos: te devuelve liquidez a mitad de camino.';
      tracer.select(half, r);
      picks.push({ priced: half, rationale: r });
    }
  }
  return picks;
}

function pickCer(
  liquid: PricedInstrument[],
  tracer: Tracer,
  horizon: number,
  asOf: string,
): Omit<Pick, 'targetArs'>[] {
  const candidates = liquid
    .filter((p) => p.instrument.family === 'boncer')
    .sort((a, b) => a.instrument.maturity.localeCompare(b.instrument.maturity));
  if (candidates.length === 0) return [];
  // El BONCER con vencimiento más cercano al horizonte (tolerancia +6m: el CER
  // necesita tiempo para devengar; mejor pasarse un poco que quedarse corto).
  const best = candidates.reduce((bestSoFar, p) =>
    Math.abs(monthsToMaturity(p, asOf) - horizon) <
    Math.abs(monthsToMaturity(bestSoFar, asOf) - horizon)
      ? p
      : bestSoFar,
  );
  const r = 'Ajusta capital por inflación (CER): protege tu poder de compra. Es el vencimiento más cercano a tu horizonte.';
  tracer.select(best, r);
  return [{ priced: best, rationale: r }];
}

function pickDolar(
  liquid: PricedInstrument[],
  tracer: Tracer,
  profile: ProfileKey,
  horizon: number,
  segmentBudgetArs: number,
  quotes: Map<string, Quote>,
): Omit<Pick, 'targetArs'>[] {
  const sovereigns = liquid.filter((p) => p.instrument.family === 'soberano_usd');
  const bopreal = liquid.filter((p) => p.instrument.family === 'bopreal');
  // Varias ONs tienen lote mínimo de 1.000 o 10.000 VN: si el lote no entra en
  // la mitad del presupuesto del segmento, la ON no es proponible.
  const ons = liquid
    .filter((p) => p.instrument.family === 'on')
    .filter((p) => {
      const arsQ = quotes.get(p.instrument.tickers.ars);
      const lotArs = ((arsQ?.last ?? 0) / 100) * Math.max(1, p.instrument.minLot || 1);
      const fits = lotArs <= segmentBudgetArs / 2;
      if (!fits)
        tracer.why(
          p,
          `Lote mínimo de ${p.instrument.minLot} VN ≈ $${Math.round(lotArs / 1000)}k: no entra en el presupuesto del segmento.`,
        );
      return fits;
    });
  const picks: Omit<Pick, 'targetArs'>[] = [];
  const issuerOf = (p: PricedInstrument) => {
    const raw = p.instrument.issuer ?? p.instrument.ticker;
    return raw
      .replace(/\(.*?\)/g, '')
      .split(/\s+/)
      .filter((w) => !/^(S\.?A\.?U?\.?|Sociedad|Anónima)$/i.test(w))
      .slice(0, 2)
      .join(' ')
      .trim();
  };

  if (profile === 'conservador') {
    // Piso soberano/BCRA: lo más corto posible. Strips BOPREAL con igual
    // duración: el de mayor TIR es el que no paga prima por el put.
    const floorPool = [...bopreal, ...sovereigns].sort(
      (a, b) => a.modifiedDuration - b.modifiedDuration || b.tir - a.tir,
    );
    const floor = floorPool[0];
    if (floor) {
      const r = 'Dólares con la menor duración disponible: lo más parecido a un plazo fijo en USD.';
      tracer.select(floor, r);
      picks.push({ priced: floor, rationale: r });
      for (const p of floorPool.slice(1))
        tracer.why(p, `Duración ${p.modifiedDuration.toFixed(1)} años ≥ la del elegido: más sensibilidad a tasas de la necesaria.`);
    }
    // Carry corporativo corto: ON con MD ≤ 3. Crédito primero: mejor tier de
    // calificación local; a igual tier, la de menor TIR (el mercado le exige
    // menos spread = menos riesgo percibido).
    const tierOf = (p: PricedInstrument) => p.instrument.ratingTier ?? 3;
    const shortOns = ons
      .filter((p) => p.modifiedDuration <= 3)
      .sort((a, b) => tierOf(a) - tierOf(b) || a.tir - b.tir);
    const onPick = shortOns[0];
    if (onPick) {
      const ratingTxt = onPick.instrument.rating ? ` (${onPick.instrument.rating})` : '';
      const r = `ON corta de ${issuerOf(onPick)}${ratingTxt}: el crédito corporativo más sólido del tramo.`;
      tracer.select(onPick, r);
      picks.push({ priced: onPick, rationale: r });
      for (const p of shortOns.slice(1))
        tracer.why(
          p,
          tierOf(p) > tierOf(onPick)
            ? `Calificación ${p.instrument.rating ?? 'sin calificación pública'}: por debajo de la elegida.`
            : `TIR ${(p.tir * 100).toFixed(1)}% > ${(onPick.tir * 100).toFixed(1)}% a igual calificación: más riesgo percibido.`,
        );
      for (const p of ons.filter((x) => x.modifiedDuration > 3))
        tracer.why(p, `Duración ${p.modifiedDuration.toFixed(1)} años: larga para un perfil conservador.`);
    }
  } else if (profile === 'moderado') {
    const al30 = sovereigns.find((p) => p.instrument.ticker === 'AL30') ?? sovereigns[0];
    if (al30) {
      const r = 'El soberano en dólares más líquido del mercado; tramo corto de la curva.';
      tracer.select(al30, r);
      picks.push({ priced: al30, rationale: r });
    }
    // ON de mejor TIR sin irse a duración larga.
    const eligibleOns = ons
      .filter((p) => p.modifiedDuration <= 4.5)
      .sort((a, b) => b.tir - a.tir);
    const onPick = eligibleOns[0];
    if (onPick) {
      const r = `ON de ${issuerOf(onPick)}: rendimiento corporativo (${(onPick.tir * 100).toFixed(1)}% USD) diversificando el riesgo soberano.`;
      tracer.select(onPick, r);
      picks.push({ priced: onPick, rationale: r });
      for (const p of eligibleOns.slice(1)) tracer.why(p, 'Menor TIR que la ON elegida dentro del tramo ≤4,5 años de duración.');
      for (const p of ons.filter((x) => x.modifiedDuration > 4.5))
        tracer.why(p, `Duración ${p.modifiedDuration.toFixed(1)} años: excede el tope de 4,5 para el perfil moderado.`);
    }
    const belly = sovereigns
      .filter((p) => p !== al30 && p.modifiedDuration > (al30?.modifiedDuration ?? 0))
      .sort((a, b) => b.tir - a.tir)[0];
    if (belly && horizon >= 12) {
      const r = 'Tramo medio de la curva soberana: más rendimiento a cambio de más duración.';
      tracer.select(belly, r);
      picks.push({ priced: belly, rationale: r });
    }
  } else {
    // Agresivo: maximiza TIR/convexidad en el tramo largo soberano.
    const sorted = [...sovereigns].sort((a, b) => b.modifiedDuration - a.modifiedDuration);
    const long = sorted[0];
    if (long) {
      const r = 'Tramo largo: máxima sensibilidad a una compresión del riesgo país.';
      tracer.select(long, r);
      picks.push({ priced: long, rationale: r });
    }
    const second = sorted.slice(1).sort((a, b) => b.tir - a.tir)[0];
    if (second) {
      const r = 'Segunda línea larga: diversifica ley y vencimiento manteniendo la duración.';
      tracer.select(second, r);
      picks.push({ priced: second, rationale: r });
    }
    for (const p of ons)
      tracer.why(p, 'Las ONs tienen menos beta al riesgo país: diluyen la tesis agresiva de compresión de spreads.');
    for (const p of bopreal)
      tracer.why(p, 'Duración corta y spread BCRA comprimido: no aporta a la tesis larga.');
  }
  return picks;
}

export function buildProposal(
  universe: Instrument[],
  quotes: Map<string, Quote>,
  ctx: MarketContext,
  inputs: BuilderInputs,
): Proposal {
  const settlement = settlementT1(ctx.asOf);
  const warnings: string[] = [];

  // Valuar todo el universo; los que fallan (sin precio, vencidos) se excluyen.
  const priced: PricedInstrument[] = [];
  for (const instr of universe) {
    if (segmentOf(instr) === null) continue;
    // El sizing compra el ticker en pesos: sin precio ARS no hay línea posible.
    const arsQuote = quotes.get(instr.tickers.ars);
    if (!arsQuote || arsQuote.last <= 0) continue;
    try {
      priced.push(priceInstrument(instr, quotes, settlement, ctx));
    } catch {
      // sin precio o sin flujos futuros: fuera del universo de hoy
    }
  }

  const weights = applyPesoFocus(
    targetWeights(inputs.profile, inputs.goal, inputs.horizonMonths),
    inputs.focus ?? 'equilibrado',
  );
  const segs: SegmentKey[] = ['tasa_fija', 'cer', 'dolar'];

  // Las comisiones se reservan ANTES de asignar: las órdenes propuestas tienen
  // que poder fondearse con el depósito que indica la UI, costos incluidos.
  const feeRate = (inputs.commissionPct / 100) * 1.21 + 0.0001;
  const investable = inputs.amountArs / (1 + feeRate);

  const traces: SegmentTrace[] = [];
  const picksBySegment = {} as Record<SegmentKey, Omit<Pick, 'targetArs'>[]>;
  const defaultReasons: Record<SegmentKey, string> = {
    tasa_fija: 'Otro candidato quedó más cerca del calce de horizonte buscado.',
    cer: 'Otro BONCER quedó más cerca del horizonte.',
    dolar: 'No entró en la combinación duración/TIR buscada para este perfil.',
  };

  for (const seg of segs) {
    const segCandidates = priced.filter((p) => segmentOf(p.instrument) === seg);
    const tracer = new Tracer(segCandidates, quotes, ctx.asOf);
    const liquid = segCandidates.filter((p) => isLiquid(p, quotes));

    let picks: Omit<Pick, 'targetArs'>[] = [];
    if (weights[seg] > 0) {
      picks =
        seg === 'tasa_fija'
          ? pickTasaFija(liquid, tracer, inputs.horizonMonths, ctx.asOf)
          : seg === 'cer'
            ? pickCer(liquid, tracer, inputs.horizonMonths, ctx.asOf)
            : pickDolar(
                liquid,
                tracer,
                inputs.profile,
                inputs.horizonMonths,
                (weights.dolar / 100) * investable,
                quotes,
              );
    }
    picksBySegment[seg] = picks;
    traces.push({
      segment: seg,
      targetWeightPct: weights[seg],
      candidates: tracer.finish(
        weights[seg] > 0
          ? defaultReasons[seg]
          : 'El segmento no tiene asignación para este perfil/objetivo/horizonte.',
      ),
    });
  }

  // Redistribuir pesos de segmentos sin candidatos.
  let missing = 0;
  for (const s of segs) {
    if (weights[s] > 0 && picksBySegment[s].length === 0) {
      missing += weights[s];
      warnings.push(`Sin instrumentos líquidos para el segmento ${s}; peso redistribuido.`);
      weights[s] = 0;
    }
  }
  if (missing > 0) {
    const alive = segs.filter((s) => weights[s] > 0);
    for (const s of alive) weights[s] += missing / alive.length;
  }

  // Ticket mínimo por línea: 5% del monto. Si el segmento no banca todas sus
  // líneas, se recortan las de menor prioridad (el orden de picks es prioridad).
  const minTicket = Math.max(investable * 0.05, 1);
  const picks: Pick[] = [];
  for (const s of segs) {
    const segPicks = picksBySegment[s];
    if (segPicks.length === 0 || weights[s] === 0) continue;
    const segArs = (weights[s] / 100) * investable;
    const maxLines = Math.max(1, Math.floor(segArs / minTicket));
    const kept = segPicks.slice(0, Math.min(segPicks.length, maxLines));
    const perLine = segArs / kept.length;
    for (const sp of kept) picks.push({ ...sp, targetArs: perLine });
  }

  // Sizing a nominales enteros (se compra el ticker en pesos).
  const lines: ProposalLine[] = [];
  let spent = 0;
  for (const pick of picks) {
    const pxVN = arsPricePerVN(pick.priced, quotes);
    const nominals = Math.floor(pick.targetArs / pxVN);
    const minLot = Math.max(1, pick.priced.instrument.minLot || 1);
    if (nominals < minLot) {
      warnings.push(
        `${pick.priced.instrument.ticker}: el monto asignado no alcanza para el lote mínimo (${minLot} VN); línea omitida.`,
      );
      continue;
    }
    const investedArs = nominals * pxVN;
    spent += investedArs;
    const isUsd = pick.priced.instrument.payCcy === 'USD';
    lines.push({
      position: {
        priced: pick.priced,
        nominals,
        investedPayCcy: isUsd ? investedArs / ctx.mep : investedArs,
        investedArs,
        segment: segmentOf(pick.priced.instrument)!,
      },
      rationale: pick.rationale,
    });
  }

  // Remanente: intentar agregar nominales del instrumento más barato por VN.
  let cashLeft = investable - spent;
  const byCheapest = [...lines].sort(
    (a, b) => arsPricePerVN(a.position.priced, quotes) - arsPricePerVN(b.position.priced, quotes),
  );
  for (const line of byCheapest) {
    const pxVN = arsPricePerVN(line.position.priced, quotes);
    const extra = Math.floor(cashLeft / pxVN);
    if (extra > 0) {
      line.position.nominals += extra;
      const addArs = extra * pxVN;
      line.position.investedArs += addArs;
      line.position.investedPayCcy +=
        line.position.priced.instrument.payCcy === 'USD' ? addArs / ctx.mep : addArs;
      spent += addArs;
      cashLeft -= addArs;
    }
  }

  // Costos estimados: comisión + IVA sobre comisión + derechos de mercado.
  const fees = spent * feeRate;

  // Tamaño de orden vs volumen diario: avisar cuando la ejecución va a mover el precio.
  for (const line of lines) {
    const turnover = arsTurnover(line.position.priced, quotes);
    if (turnover > 0 && line.position.investedArs > 0.2 * turnover) {
      warnings.push(
        `${line.position.priced.instrument.ticker}: la orden representa ~${Math.round(
          (line.position.investedArs / turnover) * 100,
        )}% del volumen diario; ejecutala en tramos o esperá desvíos de precio.`,
      );
    }
  }

  // Si la tasa fija no llega al horizonte, hay riesgo de reinversión real.
  const tfLines = lines.filter((l) => l.position.segment === 'tasa_fija');
  if (tfLines.length > 0) {
    const maxMonths = Math.max(
      ...tfLines.map((l) => daysBetween(ctx.asOf, l.position.priced.instrument.maturity) / 30.44),
    );
    if (maxMonths < inputs.horizonMonths - 3) {
      warnings.push(
        `La curva de tasa fija líquida llega hasta ~${Math.round(maxMonths)} meses: parte de la cartera va a requerir reinversión antes de tu horizonte de ${inputs.horizonMonths} meses.`,
      );
    }
  }

  if (inputs.amountArs < 100_000)
    warnings.push('Con montos chicos la diversificación es limitada; considerá un FCI money market.');

  return {
    inputs,
    settlement,
    lines,
    totalInvestedArs: spent,
    cashLeftArs: inputs.amountArs - spent - fees,
    estimatedFeesArs: fees,
    warnings,
    traces,
  };
}

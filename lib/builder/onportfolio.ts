/**
 * Cartera de ONs (crédito corporativo hard-dollar) escalonada por horizonte.
 *
 * Metodología (la misma que usaría una mesa institucional, explicada simple):
 * 1. CRÉDITO PRIMERO: el perfil define qué calificaciones entran
 *    (sólido = tier 1; balanceado = tier 1-2; rendidor = todas, incl. sin
 *    calificación pública). La TIR nunca compra una baja de calidad: primero
 *    se filtra crédito, después se elige valor.
 * 2. ESCALERA (ladder): el horizonte se divide en peldaños y cada peldaño
 *    recibe el mismo peso. Vencimientos calzados = el grueso de la cartera no
 *    depende del precio de venta. El tope de vencimiento depende del perfil
 *    (sólido: horizonte+3m; balanceado: +6m; rendidor: +12m con aviso).
 * 3. VALOR = SPREAD, no TIR: dentro de cada peldaño gana la ON con mayor
 *    spread sobre la curva soberana de duración comparable.
 * 4. CONCENTRACIÓN: máx. 25% por emisor y 50% por sector (si el universo no
 *    da, se permite con aviso explícito, nunca en silencio).
 * 5. Lotes mínimos y nominales enteros, comisiones reservadas del monto.
 */

import { daysBetween, settlementT1 } from '../engine/dates';
import { priceInstrument } from '../engine/pricing';
import type { Instrument, MarketContext, PricedInstrument, Quote } from '../engine/types';
import type { Position } from '../engine/portfolio';
import { arsTurnover, isLiquid } from './construct';
import { sovereignCurve, spreadBp, type CurvePoint } from './oncurve';

export type CreditProfile = 'solido' | 'balanceado' | 'rendidor';

export const CREDIT_PROFILES: { key: CreditProfile; label: string; description: string }[] = [
  {
    key: 'solido',
    label: 'Sólido',
    description: 'Solo calificación AAA/AA+ local. Vencimientos calzados al horizonte (+3m).',
  },
  {
    key: 'balanceado',
    label: 'Balanceado',
    description: 'Calificación AA o mejor. Busca spread sin bajar de investment grade local.',
  },
  {
    key: 'rendidor',
    label: 'Rendidor',
    description: 'Todo el universo líquido, incluso sin calificación pública. Máximo spread, más riesgo.',
  },
];

const MAX_ISSUER_WEIGHT = 0.25;
const MAX_SECTOR_WEIGHT = 0.5;

export interface OnCandidateTrace {
  ticker: string;
  issuer: string;
  sector: string;
  rating: string;
  tier: number;
  months: number;
  tirPct: number;
  spreadBp: number;
  mdYears: number;
  turnoverArs: number;
  minLotArs: number;
  liquid: boolean;
  rung: number | null;
  selected: boolean;
  reason: string;
}

export interface OnRungTrace {
  rung: number;
  targetMonths: number;
  candidates: OnCandidateTrace[];
}

export interface OnLine {
  position: Position;
  rationale: string;
  rating: string;
  tier: number;
  spreadBp: number;
  rung: number;
}

export interface OnPortfolio {
  inputs: { amountArs: number; horizonMonths: number; credit: CreditProfile; commissionPct: number };
  settlement: string;
  lines: OnLine[];
  totalInvestedArs: number;
  cashLeftArs: number;
  estimatedFeesArs: number;
  metrics: {
    tirUsdPct: number;
    durationYears: number;
    avgSpreadBp: number;
    issuers: number;
    maxMaturityMonths: number;
  };
  curve: CurvePoint[];
  traces: OnRungTrace[];
  /** ONs que no entraron a ningún peldaño, con su motivo (liquidez/crédito/vencimiento/lote). */
  excluded: OnCandidateTrace[];
  warnings: string[];
}

const tierOf = (i: Instrument): number => i.ratingTier ?? 3;
const ratingLabel = (i: Instrument): string => i.rating ?? 'sin calificación pública';

/** Clave de emisor normalizada: "YPF Sociedad Anónima (YPF S.A.)" y "YPF S.A." son el mismo crédito. */
export function issuerKey(i: Instrument): string {
  return (i.issuer ?? i.ticker)
    .toUpperCase()
    .replace(/\(.*?\)/g, '')
    .replace(/\b(S\.?A\.?U?\.?|SOCIEDAD|AN[ÓO]NIMA|S\.?A\.?C\.?I\.?F?\.?( Y A\.?)?)\b/g, '')
    .replace(/[^A-ZÑ ]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(' ');
}

function maturityCapMonths(credit: CreditProfile, horizon: number): number {
  return credit === 'solido' ? horizon + 3 : credit === 'balanceado' ? horizon + 6 : horizon + 12;
}

function tierCap(credit: CreditProfile): number {
  return credit === 'solido' ? 1 : credit === 'balanceado' ? 2 : 3;
}

export function buildOnPortfolio(
  universe: Instrument[],
  quotes: Map<string, Quote>,
  ctx: MarketContext,
  inputs: { amountArs: number; horizonMonths: number; credit: CreditProfile; commissionPct: number },
): OnPortfolio {
  const settlement = settlementT1(ctx.asOf);
  const warnings: string[] = [];

  // Valuar soberanos (para la curva) y ONs.
  const pricedAll: PricedInstrument[] = [];
  for (const instr of universe) {
    if (instr.family !== 'on' && instr.family !== 'soberano_usd') continue;
    const arsQ = quotes.get(instr.tickers.ars);
    if (!arsQ || arsQ.last <= 0) continue;
    try {
      pricedAll.push(priceInstrument(instr, quotes, settlement, ctx));
    } catch {
      /* vencido o sin precio */
    }
  }
  const curve = sovereignCurve(pricedAll);
  const ons = pricedAll.filter((p) => p.instrument.family === 'on');

  const feeRate = (inputs.commissionPct / 100) * 1.21 + 0.0001;
  const investable = inputs.amountArs / (1 + feeRate);

  // Escalera: cantidad de peldaños según horizonte.
  const H = inputs.horizonMonths;
  const rungCount = H <= 9 ? 1 : H <= 18 ? 2 : H <= 30 ? 3 : 4;
  const rungTargets = Array.from({ length: rungCount }, (_, i) => (H * (i + 1)) / rungCount);
  const rungBudget = investable / rungCount;

  const monthsOf = (p: PricedInstrument) => daysBetween(ctx.asOf, p.instrument.maturity) / 30.44;
  const matCap = maturityCapMonths(inputs.credit, H);
  let maxTier = tierCap(inputs.credit);

  // Sin calificaciones cargadas, el filtro de crédito no puede operar: se
  // degrada a "todo el universo" con aviso explícito en lugar de devolver vacío.
  const ratingsLoaded = ons.some((p) => tierOf(p.instrument) < 3);
  if (!ratingsLoaded && inputs.credit !== 'rendidor') {
    maxTier = 3;
    warnings.push(
      'Calificaciones crediticias aún no cargadas en el registro: el filtro de crédito no aplica y se considera todo el universo líquido.',
    );
  }

  // Trazas por candidato (común a todos los peldaños; rung asignado al elegir).
  const baseTrace = (p: PricedInstrument): OnCandidateTrace => {
    const lotArs = ((quotes.get(p.instrument.tickers.ars)?.last ?? 0) / 100) * Math.max(1, p.instrument.minLot || 1);
    return {
      ticker: p.instrument.ticker,
      issuer: p.instrument.issuer ?? p.instrument.ticker,
      sector: p.instrument.sector ?? 's/d',
      rating: ratingLabel(p.instrument),
      tier: tierOf(p.instrument),
      months: monthsOf(p),
      tirPct: p.tir * 100,
      spreadBp: spreadBp(p, curve),
      mdYears: p.modifiedDuration,
      turnoverArs: arsTurnover(p, quotes),
      minLotArs: lotArs,
      liquid: isLiquid(p, quotes),
      rung: null,
      selected: false,
      reason: '',
    };
  };
  const traceMap = new Map<string, OnCandidateTrace>(ons.map((p) => [p.instrument.ticker, baseTrace(p)]));
  const t = (p: PricedInstrument) => traceMap.get(p.instrument.ticker)!;

  // Filtros globales con motivo.
  let eligible = ons.filter((p) => {
    const e = t(p);
    if (!e.liquid) {
      e.reason = `Volumen diario ~$${Math.round(e.turnoverArs / 1e6)}M < $1M: sin liquidez suficiente.`;
      return false;
    }
    if (e.tier > maxTier) {
      e.reason = `Calificación ${e.rating} (tier ${e.tier}) por debajo del mínimo del perfil ${inputs.credit}.`;
      return false;
    }
    if (e.months > matCap) {
      e.reason = `Vence a los ${e.months.toFixed(0)} meses: más allá del tope del perfil (${matCap.toFixed(0)}m).`;
      return false;
    }
    if (e.minLotArs > rungBudget) {
      e.reason = `Lote mínimo ≈ $${Math.round(e.minLotArs / 1000)}k: no entra en el presupuesto del peldaño ($${Math.round(rungBudget / 1000)}k).`;
      return false;
    }
    return true;
  });

  // Fallback de vencimiento: si NINGUNA ON líquida vence dentro del tope del
  // perfil (pasa con horizontes cortos: el papel corporativo corto escasea),
  // se admiten las más cortas disponibles con aviso de riesgo de duración.
  if (eligible.length === 0) {
    const byMaturity = ons
      .filter((p) => {
        const e = t(p);
        return e.liquid && e.tier <= maxTier && e.minLotArs <= rungBudget;
      })
      .sort((a, b) => monthsOf(a) - monthsOf(b))
      .slice(0, Math.max(2, rungCount));
    if (byMaturity.length > 0) {
      const shortest = monthsOf(byMaturity[0]);
      warnings.push(
        `No hay ONs líquidas que venzan dentro de tu horizonte (+${matCap - H}m): la más corta vence a los ~${shortest.toFixed(0)} meses. En tu horizonte vas a vender a precio de mercado (riesgo de duración).`,
      );
      for (const p of byMaturity) {
        const e = t(p);
        if (e.reason.startsWith('Vence')) e.reason = '';
      }
      eligible = byMaturity;
    }
  }

  // Fallback de crédito: si el perfil sólido deja <2 nombres, abrir a tier 2 con aviso.
  if (inputs.credit === 'solido' && ratingsLoaded && eligible.length < 2) {
    const tier2 = ons.filter((p) => {
      const e = t(p);
      return e.liquid && e.tier === 2 && e.months <= matCap && e.minLotArs <= rungBudget;
    });
    if (tier2.length > 0) {
      warnings.push(
        'Pocas ONs tier 1 disponibles para este horizonte: se admite calificación AA (tier 2) para poder diversificar.',
      );
      eligible = [...eligible, ...tier2];
    }
  }

  // Asignación por peldaño: el candidato del bucket con mayor spread, respetando
  // topes de emisor y sector.
  const lines: OnLine[] = [];
  const issuerWeight = new Map<string, number>();
  const sectorWeight = new Map<string, number>();
  const used = new Set<string>();
  const rungWeightPct = 1 / rungCount;

  // Con pocos peldaños el tope del 25% es inalcanzable (cada peldaño pesa más):
  // la regla operativa pasa a ser "un peldaño por emisor", y se informa.
  const issuerCap = Math.max(MAX_ISSUER_WEIGHT, rungWeightPct * 1.001);
  const sectorCap = Math.max(MAX_SECTOR_WEIGHT, rungWeightPct * 1.001);
  if (rungWeightPct > MAX_ISSUER_WEIGHT)
    warnings.push(
      `Con ${rungCount} peldaño(s) cada emisor pesa ~${Math.round(rungWeightPct * 100)}%: el tope del 25% por emisor se reemplaza por "un peldaño por emisor".`,
    );

  const traces: OnRungTrace[] = [];
  for (let r = 0; r < rungCount; r++) {
    const target = rungTargets[r];
    // candidatos del peldaño: a ≤ media distancia entre peldaños del target
    const halfStep = rungCount > 1 ? H / rungCount / 2 + 1.5 : H / 2 + 3;
    const inBucket = eligible
      .filter((p) => !used.has(p.instrument.ticker))
      .filter((p) => Math.abs(monthsOf(p) - target) <= halfStep);
    const pool = inBucket.length > 0
      ? inBucket
      : eligible
          .filter((p) => !used.has(p.instrument.ticker))
          .sort((a, b) => Math.abs(monthsOf(a) - target) - Math.abs(monthsOf(b) - target))
          .slice(0, 3);

    const ranked = [...pool].sort((a, b) => spreadBp(b, curve) - spreadBp(a, curve));
    let chosen: PricedInstrument | null = null;
    for (const p of ranked) {
      const e = t(p);
      const issuer = issuerKey(p.instrument);
      const sector = e.sector;
      if ((issuerWeight.get(issuer) ?? 0) + rungWeightPct > issuerCap + 1e-9) {
        e.reason = `Tope de concentración: ${issuer} ya tiene ${Math.round((issuerWeight.get(issuer) ?? 0) * 100)}% de la cartera.`;
        continue;
      }
      if ((sectorWeight.get(sector) ?? 0) + rungWeightPct > sectorCap + 1e-9) {
        e.reason = `Tope sectorial: ${sector} ya concentra ${Math.round((sectorWeight.get(sector) ?? 0) * 100)}%.`;
        continue;
      }
      chosen = p;
      break;
    }
    // Si los topes bloquearon todo el bucket, tomar el mejor igual con aviso.
    if (!chosen && ranked.length > 0) {
      chosen = ranked[0];
      warnings.push(
        `Peldaño ${r + 1}: el universo no permite respetar los topes de concentración; se asigna ${chosen.instrument.ticker} igual.`,
      );
    }

    if (chosen) {
      const e = t(chosen);
      used.add(chosen.instrument.ticker);
      const ik = issuerKey(chosen.instrument);
      issuerWeight.set(ik, (issuerWeight.get(ik) ?? 0) + rungWeightPct);
      sectorWeight.set(e.sector, (sectorWeight.get(e.sector) ?? 0) + rungWeightPct);
      e.selected = true;
      e.rung = r + 1;
      e.reason = `Peldaño ${r + 1} (~${target.toFixed(0)}m): el mayor spread del tramo (${e.spreadBp.toFixed(0)} pb sobre soberanos) con calificación ${e.rating}.`;
    }

    // traza del peldaño: solo los candidatos que compitieron en este bucket
    traces.push({
      rung: r + 1,
      targetMonths: target,
      candidates: ranked
        .map((p) => {
          const e = { ...t(p) };
          if (!e.selected && !e.reason)
            e.reason = `Spread ${e.spreadBp.toFixed(0)} pb: menor que el del elegido en este peldaño.`;
          return e;
        })
        .sort((a, b) => Number(b.selected) - Number(a.selected) || b.spreadBp - a.spreadBp),
    });

    if (chosen) {
      const pxVN = (quotes.get(chosen.instrument.tickers.ars)!.last) / 100;
      const minLot = Math.max(1, chosen.instrument.minLot || 1);
      let nominals = Math.floor(rungBudget / pxVN);
      if (chosen.instrument.minLot > 1) nominals = Math.floor(nominals / minLot) * minLot;
      if (nominals >= minLot) {
        const investedArs = nominals * pxVN;
        lines.push({
          position: {
            priced: chosen,
            nominals,
            investedPayCcy: investedArs / ctx.mep,
            investedArs,
            segment: 'dolar',
          },
          rationale: t(chosen).reason,
          rating: t(chosen).rating,
          tier: t(chosen).tier,
          spreadBp: t(chosen).spreadBp,
          rung: r + 1,
        });
      } else {
        warnings.push(`${chosen.instrument.ticker}: el presupuesto del peldaño no cubre el lote mínimo; peldaño vacío.`);
      }
    } else {
      warnings.push(`Peldaño ${r + 1} (~${target.toFixed(0)}m): sin ONs elegibles en ese tramo.`);
    }
  }

  // Remanente (incluye peldaños vacíos): se redistribuye RESPETANDO el tope de
  // 25% por emisor. Si aun así sobra más del 5%, segunda pasada superando los
  // topes con aviso explícito — nunca concentración silenciosa.
  let spent = lines.reduce((s, l) => s + l.position.investedArs, 0);
  let cashLeft = investable - spent;
  const issuerInvested = () => {
    const m = new Map<string, number>();
    for (const l of lines) {
      const k = issuerKey(l.position.priced.instrument);
      m.set(k, (m.get(k) ?? 0) + l.position.investedArs);
    }
    return m;
  };
  const addToLine = (line: OnLine, budget: number) => {
    const pxVN = (quotes.get(line.position.priced.instrument.tickers.ars)!.last) / 100;
    const extra = Math.floor(Math.min(budget, cashLeft) / pxVN);
    if (extra <= 0) return;
    line.position.nominals += extra;
    const add = extra * pxVN;
    line.position.investedArs += add;
    line.position.investedPayCcy += add / ctx.mep;
    spent += add;
    cashLeft -= add;
  };

  // pasada 1: hasta el tope por emisor, priorizando el mayor spread
  for (const line of [...lines].sort((a, b) => b.spreadBp - a.spreadBp)) {
    const inv = issuerInvested();
    const room = issuerCap * investable - (inv.get(issuerKey(line.position.priced.instrument)) ?? 0);
    if (room > 0) addToLine(line, room);
  }
  // pasada 2: si el universo es tan chico que los topes dejan >5% líquido
  if (cashLeft > 0.05 * investable && lines.length > 0) {
    warnings.push(
      `Universo elegible de solo ${new Set(lines.map((l) => issuerKey(l.position.priced.instrument))).size} emisor(es): para invertir todo se superan los topes de concentración del 25%.`,
    );
    for (const line of [...lines].sort((a, b) => b.spreadBp - a.spreadBp)) addToLine(line, cashLeft);
  }

  const fees = spent * feeRate;

  // Avisos de ejecución y reinversión (mismos estándares que la cartera general).
  for (const line of lines) {
    const turnover = arsTurnover(line.position.priced, quotes);
    if (turnover > 0 && line.position.investedArs > 0.2 * turnover)
      warnings.push(
        `${line.position.priced.instrument.ticker}: la orden es ~${Math.round((line.position.investedArs / turnover) * 100)}% del volumen diario; ejecutala en tramos.`,
      );
  }
  const maxMat = lines.length > 0 ? Math.max(...lines.map((l) => monthsOf(l.position.priced))) : 0;
  if (lines.length > 0 && maxMat < H - 3)
    warnings.push(
      `La curva ON elegible llega hasta ~${Math.round(maxMat)} meses: vas a reinvertir antes de tu horizonte de ${H} meses.`,
    );
  if (inputs.credit === 'rendidor' && lines.some((l) => l.tier === 3))
    warnings.push('Incluye ONs sin calificación pública verificada o por debajo de AA: el spread extra paga ese riesgo.');

  const totalInv = lines.reduce((s, l) => s + l.position.investedArs, 0);
  const w = (l: OnLine) => l.position.investedArs / (totalInv || 1);
  const metrics = {
    tirUsdPct: lines.reduce((s, l) => s + l.position.priced.tir * 100 * w(l), 0),
    durationYears: lines.reduce((s, l) => s + l.position.priced.modifiedDuration * w(l), 0),
    avgSpreadBp: lines.reduce((s, l) => s + l.spreadBp * w(l), 0),
    issuers: new Set(lines.map((l) => issuerKey(l.position.priced.instrument))).size,
    maxMaturityMonths: maxMat,
  };

  const excluded = [...traceMap.values()].filter((c) => !c.selected && c.reason !== '');

  return {
    inputs,
    settlement,
    lines,
    totalInvestedArs: spent,
    cashLeftArs: inputs.amountArs - spent - fees,
    estimatedFeesArs: fees,
    metrics,
    curve,
    traces,
    excluded,
    warnings,
  };
}

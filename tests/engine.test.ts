/**
 * Tests del motor:
 *  1. Primitivas (XIRR, fechas hábiles, CER) contra valores construidos a mano.
 *  2. GOLDEN: el motor debe reproducir la TIR publicada por IAMC/BYMA usando el
 *     MISMO precio sucio y la MISMA fecha de liquidación del informe diario
 *     (research/market_context.json). Al ser matemática contra matemática, la
 *     tolerancia es estricta: 0,25 pp para flujos fijos, 0,60 pp para CER
 *     (sensible al timing del coeficiente). Letras a <25 días del vencimiento
 *     se excluyen (el redondeo del precio domina la TIR).
 *  3. Todo el registro se valúa sin errores con el snapshot de precios.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { daysBetween, settlementT1, subtractBusinessDays } from '@/lib/engine/dates';
import { cerRatio } from '@/lib/engine/cer';
import { projectCashflows, priceInstrument } from '@/lib/engine/pricing';
import { durations, solveTir } from '@/lib/engine/solver';
import type { Instrument, MarketContext, Quote } from '@/lib/engine/types';

const ROOT = path.resolve(__dirname, '..');
const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

describe('primitivas', () => {
  it('XIRR: un flujo de 110 a 365 días comprado a 100 rinde 10% EA', () => {
    const tir = solveTir([{ date: '2027-06-11', amount: 110 }], '2026-06-11', 100);
    expect(tir).toBeCloseTo(0.1, 8);
  });

  it('XIRR: el PV a la TIR resuelta reproduce el precio', () => {
    const flows = [
      { date: '2026-12-10', amount: 50 },
      { date: '2027-06-10', amount: 60 },
    ];
    const tir = solveTir(flows, '2026-06-10', 100);
    const pv = flows.reduce(
      (s, f) => s + f.amount / Math.pow(1 + tir, daysBetween('2026-06-10', f.date) / 365),
      0,
    );
    expect(pv).toBeCloseTo(100, 8);
  });

  it('duración Macaulay de un cupón cero = plazo en años', () => {
    const { macaulay, modified } = durations(
      [{ date: '2027-06-10', amount: 130 }],
      '2026-06-10',
      0.3,
    );
    expect(macaulay).toBeCloseTo(1, 6);
    expect(modified).toBeCloseTo(1 / 1.3, 6);
  });

  it('liquidación T+1 salta fines de semana y feriados', () => {
    // viernes 12-jun-2026; lunes 15-jun feriado → liquida martes 16
    expect(settlementT1('2026-06-12')).toBe('2026-06-16');
    expect(settlementT1('2026-06-10')).toBe('2026-06-11');
  });

  it('t-10 hábiles retrocede al menos 14 días corridos', () => {
    const d = subtractBusinessDays('2026-06-10', 10);
    expect(daysBetween(d, '2026-06-10')).toBeGreaterThanOrEqual(14);
  });
});

describe('golden: el motor reproduce las TIR publicadas por IAMC', () => {
  const generated = readJson('lib/data/instruments.generated.json');
  const snapshot = readJson('lib/data/snapshot.json');
  const mctx = readJson('research/market_context.json');

  const instruments: Instrument[] = generated.instruments;
  const ctx: MarketContext = {
    asOf: snapshot.asOf,
    cerHistory: snapshot.cerHistory,
    remMonthlyPct: snapshot.market.remMonthlyPct,
    a3500: snapshot.market.a3500,
    mep: snapshot.market.mep,
  };

  interface Golden {
    ticker: string;
    tirPct: number;
    price: number;
    priceBasis: string;
    settlement: string;
  }

  const goldens: Golden[] = (mctx.goldenYields ?? [])
    .map((g: any) => {
      const ps = g.primarySource ?? g;
      const settleMatch = String(ps.asOf ?? '').match(/settlement (\d{4}-\d{2}-\d{2})/);
      return {
        ticker: g.ticker,
        tirPct: ps.publishedTIRPct,
        price: ps.priceUsed,
        priceBasis: String(ps.priceBasis ?? ''),
        settlement: settleMatch ? settleMatch[1] : '2026-06-10',
      };
    })
    .filter(
      (g: Golden) =>
        Number.isFinite(g.tirPct) &&
        Number.isFinite(g.price) &&
        instruments.some((i) => i.ticker === g.ticker),
    )
    // letras casi vencidas: la TIR es puro redondeo de precio
    .filter((g: Golden) => {
      const instr = instruments.find((i) => i.ticker === g.ticker)!;
      return daysBetween(g.settlement, instr.maturity) >= 25;
    });

  it('hay al menos 10 puntos golden utilizables', () => {
    expect(goldens.length).toBeGreaterThanOrEqual(10);
  });

  for (const g of goldens) {
    it(`${g.ticker}: TIR motor ≈ ${g.tirPct}% publicada (precio ${g.price})`, () => {
      const instr = instruments.find((i) => i.ticker === g.ticker)!;
      let computed: number;
      if (instr.kind === 'cer') {
        // TIR real: precio deflactado por el coeficiente CER aplicable a la liquidación.
        const ratio = cerRatio(g.settlement, instr.cerBase, ctx);
        const realFlows = instr.realCashflows
          .filter((cf) => daysBetween(g.settlement, cf.date) > 0)
          .map((cf) => ({ date: cf.date, amount: cf.interest + cf.amortization }));
        computed = solveTir(realFlows, g.settlement, g.price / ratio);
      } else {
        const flows = projectCashflows(instr, g.settlement, ctx);
        computed = solveTir(flows, g.settlement, g.price);
      }
      const tol = instr.kind === 'cer' ? 0.6 : 0.25;
      expect(
        Math.abs(computed * 100 - g.tirPct),
        `computada ${(computed * 100).toFixed(2)}% vs publicada ${g.tirPct}%`,
      ).toBeLessThanOrEqual(tol);
    });
  }

  it('todo el registro se valúa sin error con el snapshot', () => {
    const quotes = new Map<string, Quote>(
      snapshot.quotes.map((q: any) => [
        q.ticker,
        { ...q, currency: q.ticker.endsWith('D') || q.ticker.endsWith('C') ? 'USD' : 'ARS' },
      ]),
    );
    const settlement = settlementT1(snapshot.asOf);
    const failures: string[] = [];
    for (const instr of instruments) {
      try {
        const p = priceInstrument(instr, quotes, settlement, ctx);
        if (!Number.isFinite(p.tir) || !Number.isFinite(p.modifiedDuration))
          failures.push(`${instr.ticker}: TIR/MD no finita`);
        else if (p.tir < -0.9 || p.tir > 5)
          failures.push(`${instr.ticker}: TIR implausible ${(p.tir * 100).toFixed(1)}%`);
      } catch (e) {
        if (!String(e).includes('Sin precio') && !String(e).includes('sin flujos futuros'))
          failures.push(`${instr.ticker}: ${e}`);
      }
    }
    expect(failures, failures.join('; ')).toEqual([]);
  });
});

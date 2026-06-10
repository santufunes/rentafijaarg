/**
 * Tests del motor:
 *  1. Primitivas (XIRR, fechas hábiles, CER) contra valores construidos a mano.
 *  2. GOLDEN: TIR calculada por el motor vs TIR publicada por el mercado
 *     (IAMC/brokers, relevada en research/market_context.json) usando los
 *     precios del snapshot. Tolerancias por familia: la diferencia admisible
 *     cubre demoras de precio y redondeos de la fuente.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { settlementT1, subtractBusinessDays, daysBetween } from '@/lib/engine/dates';
import { solveTir, durations } from '@/lib/engine/solver';
import { priceInstrument } from '@/lib/engine/pricing';
import type { Instrument, MarketContext, Quote } from '@/lib/engine/types';

const ROOT = path.resolve(__dirname, '..');
const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

describe('primitivas', () => {
  it('XIRR: un flujo de 110 a 365 días comprado a 100 rinde 10% EA', () => {
    const tir = solveTir([{ date: '2027-06-11', amount: 110 }], '2026-06-11', 100);
    expect(tir).toBeCloseTo(0.1, 8);
  });

  it('XIRR: dos flujos conocidos', () => {
    // 50 a 6 meses + 60 a 12 meses a precio 100: r tal que 50/(1+r)^0.5 + 60/(1+r) = 100
    const tir = solveTir(
      [
        { date: '2026-12-10', amount: 50 },
        { date: '2027-06-10', amount: 60 },
      ],
      '2026-06-10',
      100,
    );
    const pv = 50 / Math.pow(1 + tir, daysBetween('2026-06-10', '2026-12-10') / 365) +
      60 / Math.pow(1 + tir, daysBetween('2026-06-10', '2027-06-10') / 365);
    expect(pv).toBeCloseTo(100, 8);
    expect(tir).toBeGreaterThan(0.09);
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
    // 2026-06-12 es viernes; 15-jun-2026 feriado (Güemes) → lunes salta a martes 16
    expect(settlementT1('2026-06-12')).toBe('2026-06-16');
    // miércoles 10-jun-2026 → jueves 11
    expect(settlementT1('2026-06-10')).toBe('2026-06-11');
  });

  it('t-10 hábiles retrocede correctamente', () => {
    const d = subtractBusinessDays('2026-06-10', 10);
    expect(daysBetween(d, '2026-06-10')).toBeGreaterThanOrEqual(14); // 10 hábiles ≥ 14 corridos
  });
});

describe('golden: motor vs mercado', () => {
  const generated = readJson('lib/data/instruments.generated.json');
  const snapshot = readJson('lib/data/snapshot.json');
  const mctx = readJson('research/market_context.json');

  const TOLERANCE_PP: Record<string, number> = {
    soberano_usd: 0.75,
    bopreal: 1.0,
    lecap: 1.5,
    boncap: 1.5,
    bonte: 1.5,
    boncer: 1.5,
  };

  const instruments: Instrument[] = generated.instruments;
  const quotes = new Map<string, Quote>(
    snapshot.quotes.map((q: any) => [
      q.ticker,
      { ...q, currency: q.ticker.endsWith('D') || q.ticker.endsWith('C') ? 'USD' : 'ARS' },
    ]),
  );
  const ctx: MarketContext = {
    asOf: snapshot.asOf,
    cerHistory: snapshot.cerHistory,
    remMonthlyPct: snapshot.market.remMonthlyPct,
    a3500: snapshot.market.a3500,
    mep: snapshot.market.mep,
  };
  const settlement = settlementT1(snapshot.asOf);

  const goldens: any[] = (mctx.goldenYields ?? []).filter(
    (g: any) =>
      Number.isFinite(g.publishedTIRPct) && instruments.some((i) => i.ticker === g.ticker),
  );

  it('hay al menos 8 puntos golden utilizables', () => {
    expect(goldens.length).toBeGreaterThanOrEqual(8);
  });

  for (const g of goldens) {
    it(`${g.ticker}: TIR del motor ≈ TIR publicada (${g.publishedTIRPct}%)`, () => {
      const instr = instruments.find((i) => i.ticker === g.ticker)!;
      const priced = priceInstrument(instr, quotes, settlement, ctx);
      const tol = TOLERANCE_PP[instr.family] ?? 1.5;
      expect(Math.abs(priced.tir * 100 - g.publishedTIRPct)).toBeLessThanOrEqual(tol);
    });
  }

  it('todos los instrumentos del registro se pueden valuar sin error', () => {
    const failures: string[] = [];
    for (const instr of instruments) {
      try {
        const p = priceInstrument(instr, quotes, settlement, ctx);
        if (!Number.isFinite(p.tir) || !Number.isFinite(p.modifiedDuration))
          failures.push(`${instr.ticker}: TIR/MD no finita`);
        if (p.tir < -0.9 || p.tir > 5)
          failures.push(`${instr.ticker}: TIR fuera de rango plausible: ${(p.tir * 100).toFixed(1)}%`);
      } catch (e) {
        // sin precio en el snapshot es aceptable; otros errores no
        if (!String(e).includes('Sin precio')) failures.push(`${instr.ticker}: ${e}`);
      }
    }
    expect(failures, failures.join('; ')).toEqual([]);
  });
});

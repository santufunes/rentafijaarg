/**
 * Tests del simulador: invariantes que deben cumplirse para CUALQUIER
 * instrumento del registro con precio en el snapshot.
 *  - Conservación: la suma de pagos == suma de flujos remanentes × nominales.
 *  - Coherencia con el motor: la TIR a precio de mercado == TIR de priceInstrument.
 *  - Monotonía: pagar más caro SIEMPRE baja la TIR; los pagos no cambian.
 *  - Sizing: nominales enteros, gastado ≤ monto, sobrante < precio de 1 VN.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { settlementT1 } from '@/lib/engine/dates';
import { priceInstrument } from '@/lib/engine/pricing';
import type { Instrument, MarketContext, Quote } from '@/lib/engine/types';
import { simulate } from '@/lib/terminal';

const ROOT = path.resolve(__dirname, '..');
const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const generated = readJson('lib/data/instruments.generated.json');
const snapshot = readJson('lib/data/snapshot.json');

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
const AMOUNT = 50_000_000; // grande para que el lote mínimo de 10.000 VN también entre

describe('simulador: invariantes sobre todo el registro', () => {
  const simulable = instruments.filter((i) => {
    const q = quotes.get(i.tickers.ars);
    return q && q.last > 0;
  });

  it('hay al menos 60 instrumentos simulables', () => {
    expect(simulable.length).toBeGreaterThanOrEqual(60);
  });

  for (const instr of simulable) {
    it(`${instr.ticker}: conservación, coherencia de TIR, sizing`, () => {
      let sim;
      try {
        sim = simulate(instr, quotes, ctx, AMOUNT);
      } catch (e) {
        // vencido o sin pagos futuros es aceptable; cualquier otro error no
        expect(String(e)).toMatch(/pagos futuros|lote mínimo/);
        return;
      }

      // Sizing
      expect(Number.isInteger(sim.nominals)).toBe(true);
      expect(sim.spentArs).toBeLessThanOrEqual(AMOUNT + 1e-6);
      expect(sim.leftoverArs).toBeGreaterThanOrEqual(-1e-6);
      expect(sim.leftoverArs).toBeLessThan(sim.priceArsPer100 / 100 + 1e-6);

      // Conservación: total == suma de pagos; acumulado final == total ARS
      const sumPayouts = sim.payouts.reduce((s, p) => s + p.totalPayCcy, 0);
      expect(sumPayouts).toBeCloseTo(sim.totalReceivedPayCcy, 6);
      const lastCum = sim.payouts[sim.payouts.length - 1].cumulativeArs;
      expect(lastCum).toBeCloseTo(sim.totalReceivedArs, 4);

      // Renta y capital no negativos
      for (const p of sim.payouts) {
        expect(p.amortization).toBeGreaterThanOrEqual(-1e-9);
        // la renta del simulador puede ser negativa solo si un cupón cero cotizara bajo par
        if (instr.kind !== 'zero' && instr.kind !== 'dual_tamar')
          expect(p.interest).toBeGreaterThanOrEqual(-1e-9);
      }

      // Coherencia: TIR del simulador a precio de mercado == TIR del motor
      const engineTir = priceInstrument(instr, quotes, settlement, ctx).tir * 100;
      expect(Math.abs(sim.tirPct - engineTir)).toBeLessThan(0.01);

      // Monotonía: +5% de precio => menor TIR, mismos pagos por nominal
      const dearer = simulate(instr, quotes, ctx, AMOUNT, sim.priceArsPer100 * 1.05);
      expect(dearer.tirPct).toBeLessThan(sim.tirPct);
      const perVnBase = sim.totalReceivedPayCcy / sim.nominals;
      const perVnDearer = dearer.totalReceivedPayCcy / dearer.nominals;
      expect(perVnDearer).toBeCloseTo(perVnBase, 8);
    });
  }

  it('el lote mínimo corta con mensaje claro (MGCRO con $100k)', () => {
    const mgcr = instruments.find((i) => i.ticker === 'MGCRO');
    if (!mgcr) return; // si no está en el registro, nada que probar
    expect(() => simulate(mgcr, quotes, ctx, 100_000)).toThrow(/lote mínimo/);
  });
});

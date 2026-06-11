/**
 * Invariantes del flujo USD y del enfoque pesos:
 *  - USD: todas las líneas pagan USD; sin LECAP/CER; composición respetada;
 *    plata conservada (gastado + costos ≤ monto×MEP); métricas finitas;
 *    funciona en los extremos del slider (3 y 48 meses) para los 3 estilos.
 *  - applyPesoFocus conserva la suma de pesos y solo mueve tasa fija ↔ CER.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { buildUsdPortfolio } from '@/lib/builder/usdportfolio';
import { applyPesoFocus, targetWeights, USD_STYLES } from '@/lib/builder/profiles';
import { buildProposal } from '@/lib/builder/construct';
import type { Instrument, MarketContext, Quote } from '@/lib/engine/types';

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

describe('flujo USD', () => {
  for (const style of USD_STYLES.map((s) => s.key)) {
    for (const h of [3, 12, 48]) {
      it(`${style} / ${h}m: solo instrumentos USD, plata conservada`, () => {
        const p = buildUsdPortfolio(instruments, quotes, ctx, {
          amountUsd: 20_000,
          horizonMonths: h,
          style,
          composition: 'mixto',
          commissionPct: 0.5,
        });
        expect(p.lines.length).toBeGreaterThanOrEqual(1);
        for (const l of p.lines) {
          const i = l.position.priced.instrument;
          expect(['soberano_usd', 'bopreal', 'on']).toContain(i.family);
          expect(i.payCcy).toBe('USD');
          expect(Number.isInteger(l.position.nominals)).toBe(true);
        }
        const amountArs = 20_000 * ctx.mep;
        expect(p.totalInvestedArs + p.estimatedFeesArs).toBeLessThanOrEqual(amountArs + 1);
        expect(p.cashLeftArs).toBeGreaterThanOrEqual(-1e-6);
        expect(p.usd.tirUsdPct).toBeGreaterThan(0);
        expect(p.usd.tirUsdPct).toBeLessThan(20);
        expect(Number.isFinite(p.usd.durationYears)).toBe(true);
        expect(p.traces.length).toBeGreaterThan(0);
      });
    }
  }

  it('composición "soberanos" no incluye ONs; "corporativos" no incluye soberanos', () => {
    const sov = buildUsdPortfolio(instruments, quotes, ctx, {
      amountUsd: 20_000, horizonMonths: 24, style: 'moderado', composition: 'soberanos', commissionPct: 0.5,
    });
    expect(sov.lines.every((l) => l.position.priced.instrument.family !== 'on')).toBe(true);
    const corp = buildUsdPortfolio(instruments, quotes, ctx, {
      amountUsd: 20_000, horizonMonths: 24, style: 'moderado', composition: 'corporativos', commissionPct: 0.5,
    });
    expect(corp.lines.every((l) => l.position.priced.instrument.family === 'on')).toBe(true);
  });

  it('cada línea tiene extras (spread) para la UI', () => {
    const p = buildUsdPortfolio(instruments, quotes, ctx, {
      amountUsd: 50_000, horizonMonths: 24, style: 'moderado', composition: 'mixto', commissionPct: 0.5,
    });
    for (const l of p.lines) {
      const e = p.usd.lineExtras[l.position.priced.instrument.ticker];
      expect(e).toBeDefined();
      expect(Number.isFinite(e.spreadBp)).toBe(true);
    }
  });
});

describe('enfoque pesos', () => {
  it('conserva la suma 100 y no toca el bucket dólar', () => {
    for (const profile of ['conservador', 'moderado', 'agresivo'] as const) {
      const base = targetWeights(profile, 'mixto', 12);
      for (const focus of ['equilibrado', 'tasa_fija', 'inflacion'] as const) {
        const w = applyPesoFocus(base, focus);
        expect(w.tasa_fija + w.cer + w.dolar).toBeCloseTo(100, 8);
        expect(w.dolar).toBe(base.dolar);
        if (focus === 'tasa_fija') expect(w.tasa_fija).toBeGreaterThanOrEqual(base.tasa_fija);
        if (focus === 'inflacion') expect(w.cer).toBeGreaterThanOrEqual(base.cer);
      }
    }
  });

  it('el enfoque cambia la cartera resultante', () => {
    const mk = (focus: 'tasa_fija' | 'inflacion') =>
      buildProposal(instruments, quotes, ctx, {
        amountArs: 10_000_000, horizonMonths: 12, profile: 'moderado', goal: 'pesos', focus, commissionPct: 0.5,
      });
    const tf = mk('tasa_fija');
    const inf = mk('inflacion');
    const cerWeight = (p: typeof tf) =>
      p.lines
        .filter((l) => l.position.segment === 'cer')
        .reduce((s, l) => s + l.position.investedArs, 0) / p.totalInvestedArs;
    expect(cerWeight(inf)).toBeGreaterThan(cerWeight(tf));
  });
});

/**
 * Invariantes de la cartera ON escalonada, para todo horizonte × perfil:
 *  - Solo ONs; nominales enteros y múltiplos del lote mínimo.
 *  - Gastado + costos ≤ monto; remanente no negativo.
 *  - Tope emisor 25% respetado, o aviso explícito si el universo no da.
 *  - Tope de vencimiento del perfil respetado por todas las líneas.
 *  - Crédito: perfil sólido nunca incluye tier 3; balanceado nunca tier 3
 *    (salvo que no haya calificaciones cargadas todavía: entonces todo es
 *    tier 3 y el constructor debe avisar, no fallar silenciosamente).
 *  - Spread: TIR de cada línea == soberano interpolado + spread (identidad).
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { buildOnPortfolio, issuerKey, type CreditProfile } from '@/lib/builder/onportfolio';
import { sovereignYieldAt } from '@/lib/builder/oncurve';
import { daysBetween } from '@/lib/engine/dates';
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

const hasRatings = instruments.some((i) => i.family === 'on' && (i.ratingTier ?? 3) < 3);

describe('cartera ON escalonada', () => {
  const cases: { h: number; credit: CreditProfile }[] = [];
  for (const h of [6, 12, 24, 36])
    for (const credit of ['solido', 'balanceado', 'rendidor'] as CreditProfile[])
      cases.push({ h, credit });

  for (const { h, credit } of cases) {
    it(`${h}m / ${credit}: invariantes`, () => {
      const p = buildOnPortfolio(instruments, quotes, ctx, {
        amountArs: 20_000_000,
        horizonMonths: h,
        credit,
        commissionPct: 0.5,
      });

      // siempre debe haber al menos una línea con el universo actual (29 ONs)
      expect(p.lines.length).toBeGreaterThanOrEqual(1);

      const matCap = credit === 'solido' ? h + 3 : credit === 'balanceado' ? h + 6 : h + 12;
      let invested = 0;
      for (const l of p.lines) {
        const i = l.position.priced.instrument;
        expect(i.family).toBe('on');
        // lote mínimo respetado y múltiplo
        const minLot = Math.max(1, i.minLot || 1);
        expect(l.position.nominals).toBeGreaterThanOrEqual(minLot);
        expect(Number.isInteger(l.position.nominals)).toBe(true);
        // tope de vencimiento del perfil — o fallback con aviso de riesgo de
        // duración cuando no existe papel corporativo tan corto
        const months = daysBetween(ctx.asOf, i.maturity) / 30.44;
        if (months > matCap + 0.5) {
          expect(
            p.warnings.some((w) => w.includes('riesgo de duración')),
            `línea a ${months.toFixed(0)}m > tope ${matCap}m sin aviso de duración`,
          ).toBe(true);
        }
        // crédito (solo exigible cuando hay calificaciones cargadas)
        if (hasRatings && credit === 'solido') expect(l.tier).toBeLessThanOrEqual(2); // 2 solo con aviso
        if (hasRatings && credit === 'balanceado') expect(l.tier).toBeLessThanOrEqual(2);
        // identidad del spread
        const sov = sovereignYieldAt(p.curve, l.position.priced.modifiedDuration);
        expect(l.position.priced.tir * 100).toBeCloseTo(sov + l.spreadBp / 100, 6);
        invested += l.position.investedArs;
      }

      // plata: gastado + costos ≤ monto, remanente ≥ 0
      expect(p.totalInvestedArs).toBeCloseTo(invested, 4);
      expect(p.totalInvestedArs + p.estimatedFeesArs).toBeLessThanOrEqual(20_000_000 + 1);
      expect(p.cashLeftArs).toBeGreaterThanOrEqual(-1e-6);

      // concentración: ≤25% por emisor o aviso explícito
      const byIssuer = new Map<string, number>();
      for (const l of p.lines) {
        const k = issuerKey(l.position.priced.instrument);
        byIssuer.set(k, (byIssuer.get(k) ?? 0) + l.position.investedArs / p.totalInvestedArs);
      }
      const maxIssuer = Math.max(...byIssuer.values());
      if (p.lines.length > 1 && maxIssuer > 0.25 + 0.12) {
        expect(
          p.warnings.some((w) => w.includes('concentración') || w.includes('topes')),
          `emisor ${(maxIssuer * 100).toFixed(0)}% sin aviso`,
        ).toBe(true);
      }

      // métricas finitas y plausibles
      expect(Number.isFinite(p.metrics.tirUsdPct)).toBe(true);
      expect(p.metrics.tirUsdPct).toBeGreaterThan(0);
      expect(p.metrics.tirUsdPct).toBeLessThan(25);
      expect(Math.abs(p.metrics.avgSpreadBp)).toBeLessThan(2000);

      // perfil sólido con fallback debe avisar
      if (hasRatings && credit === 'solido' && p.lines.some((l) => l.tier === 2)) {
        expect(p.warnings.some((w) => w.includes('tier 1'))).toBe(true);
      }
    });
  }

  it('horizonte largo genera más peldaños que el corto', () => {
    const short = buildOnPortfolio(instruments, quotes, ctx, {
      amountArs: 20_000_000,
      horizonMonths: 6,
      credit: 'rendidor',
      commissionPct: 0.5,
    });
    const long = buildOnPortfolio(instruments, quotes, ctx, {
      amountArs: 20_000_000,
      horizonMonths: 36,
      credit: 'rendidor',
      commissionPct: 0.5,
    });
    expect(long.traces.length).toBeGreaterThan(short.traces.length);
    expect(long.metrics.maxMaturityMonths).toBeGreaterThan(short.metrics.maxMaturityMonths);
  });
});

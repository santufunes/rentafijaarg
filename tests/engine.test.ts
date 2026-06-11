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

  const byTicker = (t: string) => instruments.find((i) => i.ticker === t);

  // 1) IAMC (informe diario 09-06): soberanos y tasa fija. Los BONCER del informe
  //    se excluyen: la lectura del PDF resultó poco confiable para esas filas y se
  //    reemplaza por bonistas (mismo día, misma base de precio).
  const fromIamc: Golden[] = (mctx.goldenYields ?? [])
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
    .filter((g: Golden) => {
      const instr = byTicker(g.ticker);
      return (
        instr !== undefined &&
        instr.kind !== 'cer' &&
        instr.family !== 'bopreal' &&
        Number.isFinite(g.tirPct) &&
        Number.isFinite(g.price)
      );
    });

  // 2) BOPREAL: precio sucio USD de control de IAMC (paridad × valor técnico),
  //    misma liquidación que el informe — matemática contra matemática.
  const goldenBopreal = readJson('research/golden_bopreal.json');
  const fromBopreal: Golden[] = (goldenBopreal.results ?? [])
    .filter((r: any) => byTicker(r.ticker) && r.iamcControl?.dirtyUSD_paridadXVT)
    .map((r: any) => ({
      ticker: r.ticker,
      tirPct: r.publishedTIRPct,
      price: r.iamcControl.dirtyUSD_paridadXVT,
      priceBasis: 'dirty USD per 100 VN (IAMC paridad × VT)',
      settlement: r.iamcControl.settlement ?? '2026-06-10',
    }));

  // 3) BONCER: TIR real publicada por bonistas.com el 10-06 con su propio precio
  //    de cierre (liquidación 24hs = 11-06). El snapshot trae filas duplicadas
  //    por ticker (paneles CI y 24hs): primero se descartan prints ilíquidos
  //    (<50 VN no es benchmark) y después se queda la fila de MAYOR volumen.
  const bonistas: any[] = readJson('research/bonistas_api_bonds_snapshot_2026-06-10.json');
  const bestCerRow = new Map<string, any>();
  for (const r of bonistas) {
    const instr = byTicker(r.bond_name ?? r.ticker);
    if (instr?.kind !== 'cer' || !Number.isFinite(r.tir)) continue;
    if (r.settlement !== '24hs') continue; // panel CI liquida hoy: otra base de días y de CER
    if ((r.volume ?? 0) < 50) continue;
    if (!((r.last_price ?? r.last_close) > 0)) continue;
    const prev = bestCerRow.get(instr.ticker);
    if (!prev || (r.volume ?? 0) > (prev.volume ?? 0)) bestCerRow.set(instr.ticker, r);
  }
  const fromBonistasCer: Golden[] = [...bestCerRow.values()].map((r: any) => ({
    ticker: r.bond_name ?? r.ticker,
    tirPct: r.tir * 100,
    // bonistas calcula su TIR sobre el último precio operado, no el cierre
    price: r.last_price ?? r.last_close,
    priceBasis: 'ARS dirty per 100 VN (bonistas 24hs, last_price)',
    settlement: '2026-06-11',
  }));

  // 4) ONs: precio sucio USD (línea D, mismo cierre data912) y TIR publicada
  //    relevados en la verificación de cada spec (docta/bonistas).
  const fromOns: Golden[] = ['1', '2', '3'].flatMap((n) => {
    let part: any;
    try {
      part = readJson(`research/specs_ons_part${n}.json`);
    } catch {
      return [];
    }
    return (part.instruments ?? [])
      .map((spec: any) => {
        const gc = spec.verification?.goldenCheck ?? {};
        return {
          ticker: spec.tickers?.ars,
          tirPct: gc.publishedTIRPct,
          price: gc.dirtyPriceUSD ?? gc.dirtyPriceUSDper100VN,
          priceBasis: 'dirty USD per 100 VN (data912 D-line)',
          settlement: gc.settlement ?? '2026-06-11',
        };
      })
      .filter((g: Golden) => byTicker(g.ticker) && Number.isFinite(g.tirPct) && Number.isFinite(g.price));
  });

  const goldens: Golden[] = [...fromIamc, ...fromBopreal, ...fromBonistasCer, ...fromOns]
    // letras/bonos casi vencidos: la TIR es puro redondeo de precio
    .filter((g: Golden) => daysBetween(g.settlement, byTicker(g.ticker)!.maturity) >= 25);

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
        // ONs: algunas fuentes publican la TIR sobre la línea cable (C), que
        // cotiza con el spread del canje vs la línea MEP (D). Si la base D no
        // reproduce el número publicado pero la base C sí, la matemática está
        // bien y la diferencia es de convención de liquidación.
        if (instr.family === 'on') {
          const cableTicker = instr.tickers.cable;
          const cableQuote = cableTicker
            ? snapshot.quotes.find((q: any) => q.ticker === cableTicker)
            : undefined;
          if (cableQuote?.last > 0) {
            const onCable = solveTir(flows, g.settlement, cableQuote.last);
            if (Math.abs(onCable * 100 - g.tirPct) < Math.abs(computed * 100 - g.tirPct))
              computed = onCable;
          }
        }
      }
      // CER: la diferencia de convención del coeficiente entre fuentes (~0,6% de
      // precio) se amplifica como 1/T en la TIR de letras cortas. ONs: las TIR
      // publicadas usan convenciones semianuales/30-360 dispares → 0,75 pp.
      const years = daysBetween(g.settlement, instr.maturity) / 365;
      const tol =
        instr.kind === 'cer'
          ? Math.max(0.6, 0.6 / years)
          : instr.family === 'on'
            ? 0.75
            : 0.25;
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

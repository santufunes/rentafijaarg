/**
 * Convierte research/*.json (especificaciones verificadas) en:
 *  - lib/data/instruments.generated.json  (registro tipado de instrumentos)
 *  - lib/data/snapshot.json               (foto de precios/CER/REM de respaldo)
 *
 * Valida duro: cualquier inconsistencia corta el build con la lista de errores.
 * Uso: npm run registry
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.join(__dirname, '..');
const R = (f: string) => path.join(ROOT, 'research', f);

type Cf = { date: string; interest: number; amortization: number };
const errors: string[] = [];
const skipped: string[] = [];

function readJson(file: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function assertIso(t: string, field: string, v: unknown): v is string {
  if (typeof v !== 'string' || !ISO.test(v)) {
    errors.push(`${t}: ${field} inválida: ${JSON.stringify(v)}`);
    return false;
  }
  return true;
}

function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

/** Genera flujos explícitos de un bono step-up amortizable (canje 2020 / BOPREAL). */
function generateFixedCashflows(t: string, spec: any): Cf[] {
  if (Array.isArray(spec.remainingCashflows) && spec.remainingCashflows.length > 0) {
    // BOPREAL: flujos remanentes explícitos con roll a día hábil ya aplicado.
    return spec.remainingCashflows.map((c: any) => ({
      date: c.expectedPayDate ?? c.scheduledDate ?? c.date,
      interest: Number(c.interestPer100VN ?? c.interest ?? 0),
      amortization: Number(c.capitalPer100VN ?? c.amortization ?? 0),
    }));
  }
  if (Array.isArray(spec.cashflows) && spec.cashflows.length > 0) {
    // flujos ya explícitos
    return spec.cashflows.map((c: any) => ({
      date: c.date,
      interest: Number(c.interest ?? c.interestPct ?? 0),
      amortization: Number(c.amortization ?? c.amortizationPct ?? c.amort ?? 0),
    }));
  }
  const coupons: { from: string; annualRatePct: number }[] = (spec.couponStepUpSchedule ?? spec.couponSchedule ?? [])
    .map((c: any) => ({ from: c.from, annualRatePct: Number(c.annualRatePct ?? c.ratePct ?? c.rate) }))
    .sort((a: any, b: any) => a.from.localeCompare(b.from));
  const amorts: { date: string; pct: number }[] = (spec.amortizationSchedule ?? [])
    .map((a: any) => ({ date: a.date, pct: Number(a.pctOfOriginalFace ?? a.pct) }))
    .sort((a: any, b: any) => a.date.localeCompare(b.date));
  const freqMonths = Number(spec.paymentFrequencyMonths ?? 6);
  const maturity: string = spec.maturity;
  const issue: string = spec.issueDate;
  if (!issue || !maturity || coupons.length === 0) {
    errors.push(`${t}: faltan couponSchedule/issueDate/maturity y no hay cashflows explícitos`);
    return [];
  }

  // Fechas de pago: hacia atrás desde maturity cada freqMonths hasta issue.
  const dates: string[] = [];
  let d = maturity;
  while (d > issue) {
    dates.unshift(d);
    d = addMonths(d, -freqMonths);
  }

  const flows: Cf[] = [];
  let residual = 100;
  let prev = d; // primer inicio de período (≈ issue)
  for (const payDate of dates) {
    const rate = [...coupons].reverse().find((c) => c.from <= prev)?.annualRatePct ?? 0;
    const interest = (rate / 100) * residual * (freqMonths / 12);
    const amort = amorts.filter((a) => a.date === payDate).reduce((s, a) => s + a.pct, 0);
    flows.push({ date: payDate, interest: round6(interest), amortization: round6(amort) });
    residual -= amort;
    prev = payDate;
  }
  // amortizaciones que no cayeron exactamente en fechas de cupón
  const matched = new Set(dates);
  for (const a of amorts) {
    if (!matched.has(a.date)) {
      flows.push({ date: a.date, interest: 0, amortization: round6(a.pct) });
    }
  }
  flows.sort((a, b) => a.date.localeCompare(b.date));
  return flows;
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

function validateFixed(t: string, flows: Cf[], maturity: string, opts?: { remaining?: boolean }) {
  const amortSum = flows.reduce((s, f) => s + f.amortization, 0);
  if (opts?.remaining) {
    // flujos remanentes: puede haber amortizaciones ya pagadas
    if (amortSum <= 0 || amortSum > 100.02)
      errors.push(`${t}: amortizaciones remanentes suman ${amortSum.toFixed(4)} (esperado (0,100])`);
  } else if (Math.abs(amortSum - 100) > 0.02) {
    errors.push(`${t}: amortizaciones suman ${amortSum.toFixed(4)} ≠ 100`);
  }
  for (const f of flows) {
    if (!ISO.test(f.date)) errors.push(`${t}: fecha de flujo inválida ${f.date}`);
    if (f.interest < 0 || f.amortization < 0) errors.push(`${t}: flujo negativo en ${f.date}`);
  }
  const last = flows[flows.length - 1];
  if (last) {
    const drift = Math.abs(
      (Date.parse(last.date) - Date.parse(maturity)) / 86_400_000,
    );
    // el último pago puede rolar hasta 5 días hábiles después del vencimiento
    if (drift > 5) errors.push(`${t}: último flujo ${last.date} lejos de maturity ${maturity}`);
  }
}

// ---------------------------------------------------------------------------

const instruments: any[] = [];
const d912 = readJson(R('data912_map.json'));
const allSymbols = new Set<string>([
  ...((d912?.panels?.arg_bonds as string[]) ?? []),
  ...((d912?.panels?.arg_notes as string[]) ?? []),
]);
const variant = (tk: string, suffix: string) =>
  allSymbols.has(tk + suffix) ? tk + suffix : undefined;

function tickersFor(tk: string) {
  return { ars: tk, mep: variant(tk, 'D'), cable: variant(tk, 'C') };
}

function isUncertain(spec: any): boolean {
  return spec.verification?.status === 'uncertain' || spec.confidence === 'low';
}

// --- soberanos USD + bopreal ----------------------------------------------
for (const [file, family] of [
  ['specs_soberanos_usd.json', 'soberano_usd'],
  ['specs_soberanos_usd_nuevos.json', 'soberano_usd'],
  ['specs_bopreal.json', 'bopreal'],
] as const) {
  const data = readJson(R(file));
  if (!data) {
    errors.push(`falta ${file}`);
    continue;
  }
  for (const spec of data.instruments ?? []) {
    const t = spec.ticker;
    if (isUncertain(spec)) {
      skipped.push(`${t} (${family}): verificación incierta`);
      continue;
    }
    if (!assertIso(t, 'maturity', spec.maturity)) continue;
    const flows = generateFixedCashflows(t, spec);
    if (flows.length === 0) continue;
    validateFixed(t, flows, spec.maturity, {
      remaining: Array.isArray(spec.remainingCashflows) && spec.remainingCashflows.length > 0,
    });
    instruments.push({
      kind: 'fixed',
      ticker: t,
      name: spec.name ?? t,
      family,
      payCcy: 'USD',
      issueDate: spec.issueDate,
      maturity: spec.maturity,
      minLot: Number(spec.minDenomination?.amount ?? spec.minDenomination ?? 1),
      tickers: spec.tickers?.ars
        ? spec.tickers
        : spec.tickerVariants?.ars_byma
          ? {
              ars: spec.tickerVariants.ars_byma,
              mep: spec.tickerVariants.usd_mep_byma ?? undefined,
              cable: spec.tickerVariants.usd_cable_byma ?? undefined,
            }
          : tickersFor(t),
      law: spec.law,
      sources: spec.sources ?? [],
      cashflows: flows,
    });
  }
}

// --- peso tasa fija ---------------------------------------------------------
{
  const data = readJson(R('specs_peso_fija.json'));
  if (!data) errors.push('falta specs_peso_fija.json');
  for (const spec of data?.instruments ?? []) {
    const t = spec.ticker;
    const type = (spec.type ?? spec.classification ?? '').toLowerCase();
    const maturity = spec.maturity ?? spec.maturityDate;
    if (isUncertain(spec)) {
      skipped.push(`${t} (peso_fija): verificación incierta`);
      continue;
    }
    if (type.includes('provincial')) {
      skipped.push(`${t} (peso_fija): crédito provincial, fuera del universo Tesoro`);
      continue;
    }
    if (!assertIso(t, 'maturity', maturity)) continue;

    // BONTE con cupones: flujos remanentes explícitos {date, amountPer100VN}.
    const remKey = Object.keys(spec).find((k) => k.startsWith('remainingCashflows'));
    const rem: any[] = remKey ? spec[remKey] : [];
    if (type.includes('bonte') && Array.isArray(rem) && rem.length > 0) {
      const flows: Cf[] = rem.map((c: any, idx: number) => {
        const amount = Number(c.amountPer100VN ?? c.amount);
        const isLast = idx === rem.length - 1;
        return {
          date: c.date,
          interest: isLast ? round6(amount - 100) : amount,
          amortization: isLast ? 100 : 0,
        };
      });
      validateFixed(t, flows, maturity, { remaining: true });
      instruments.push({
        kind: 'fixed', ticker: t, name: spec.name ?? t, family: 'bonte', payCcy: 'ARS',
        issueDate: spec.issueDate, maturity, minLot: 1,
        tickers: spec.tickers?.ars ? spec.tickers : tickersFor(t),
        sources: spec.sources ?? [], cashflows: flows,
      });
      continue;
    }

    const final = Number(spec.finalPaymentPer100VN ?? spec.finalPaymentPer100 ?? spec.finalPayment);
    if (!Number.isFinite(final) || final < 100) {
      skipped.push(`${t} (peso_fija): sin valor final confirmado`);
      continue;
    }
    instruments.push({
      kind: 'zero',
      ticker: t,
      name: spec.name ?? t,
      family: type === 'boncap' ? 'boncap' : type.includes('bonte') ? 'bonte' : 'lecap',
      payCcy: 'ARS',
      issueDate: spec.issueDate,
      maturity,
      minLot: 1,
      tickers: spec.tickers?.ars ? spec.tickers : tickersFor(t),
      sources: spec.sources ?? [],
      finalPaymentPer100: final,
      temIssuePct: spec.temIssuePct ?? spec.temAtIssuancePct ?? spec.tem ?? null,
    });
  }
}

// --- CER + duales + dollar-linked -------------------------------------------
{
  const data = readJson(R('specs_cer_dl.json'));
  if (!data) errors.push('falta specs_cer_dl.json');
  for (const spec of data?.instruments ?? []) {
    const t = spec.ticker;
    spec.maturity = spec.maturity ?? spec.maturityDate;
    const type = (spec.type ?? spec.classification ?? spec.structure ?? '').toLowerCase();
    if (isUncertain(spec)) {
      skipped.push(`${t} (cer_dl): verificación incierta`);
      continue;
    }
    if (!assertIso(t, 'maturity', spec.maturity)) continue;

    if (type.includes('dual')) {
      const fixedFinal = Number(
        spec.fixedFinalPaymentPer100 ??
          spec.fixedLeg?.finalPaymentPer100 ??
          spec.fixedLeg?.finalPaymentPer100VN,
      );
      if (!Number.isFinite(fixedFinal)) { skipped.push(`${t}: dual sin leg fijo confirmado`); continue; }
      instruments.push({
        kind: 'dual_tamar', ticker: t, name: spec.name ?? t, family: 'dual_tamar', payCcy: 'ARS',
        issueDate: spec.issueDate, maturity: spec.maturity, minLot: 1, tickers: tickersFor(t),
        sources: spec.sources ?? [], fixedFinalPaymentPer100: fixedFinal,
      });
      continue;
    }
    if (type.includes('dollar') || t.startsWith('D')) {
      instruments.push({
        kind: 'dollar_linked', ticker: t, name: spec.name ?? t, family: 'dollar_linked', payCcy: 'ARS',
        issueDate: spec.issueDate, maturity: spec.maturity, minLot: 1, tickers: tickersFor(t),
        sources: spec.sources ?? [],
        usdCashflows: [{ date: spec.maturity, interest: 0, amortization: 100 }],
      });
      continue;
    }
    // BONCER (cero o con cupón)
    const cerBase = Number(spec.cerBase);
    if (!Number.isFinite(cerBase) || cerBase <= 0) {
      skipped.push(`${t} (cer): sin CER base confirmado`);
      continue;
    }
    let realFlows: Cf[];
    if (Array.isArray(spec.realCashflows) && spec.realCashflows.length > 0) {
      realFlows = spec.realCashflows.map((c: any) => ({
        date: c.date, interest: Number(c.interest ?? 0), amortization: Number(c.amortization ?? c.amort ?? 0),
      }));
    } else if (type.includes('zero') || !spec.realCouponPct) {
      realFlows = [{ date: spec.maturity, interest: 0, amortization: 100 }];
    } else {
      // BONCER con cupón y amortización sin estructura verificable: no se genera
      // desde prosa — mejor afuera del registro que mal valuado.
      skipped.push(`${t} (cer): cupón+amortización sin flujos estructurados`);
      continue;
    }
    validateFixed(t, realFlows, spec.maturity, {
      remaining: Array.isArray(spec.realCashflows) && spec.realCashflows.length > 0,
    });
    instruments.push({
      kind: 'cer', ticker: t, name: spec.name ?? t, family: 'boncer', payCcy: 'ARS',
      issueDate: spec.issueDate, maturity: spec.maturity, minLot: 1, tickers: tickersFor(t),
      sources: spec.sources ?? [], cerBase, realCashflows: realFlows,
    });
  }
}

// --- snapshot ---------------------------------------------------------------
async function buildSnapshot() {
  const bcra = readJson(R('bcra_series.json'));
  const mctx = readJson(R('market_context.json'));
  if (!bcra) errors.push('falta bcra_series.json');

  async function fetchRetry(url: string, tries = 3): Promise<any> {
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (r.ok) return await r.json();
      } catch {
        await new Promise((res) => setTimeout(res, 1500));
      }
    }
    return null;
  }

  let quotes: any[] = [];
  const bonds = await fetchRetry('https://data912.com/live/arg_bonds');
  const notes = await fetchRetry('https://data912.com/live/arg_notes');
  if (bonds && notes) {
    quotes = [...bonds, ...notes]
      .filter((r: any) => r.c > 0)
      .map((r: any) => ({ ticker: r.symbol, last: r.c, bid: r.px_bid, ask: r.px_ask, volume: r.v }));
  } else {
    const prev = readJson(path.join(ROOT, 'lib/data/snapshot.json'));
    if (Array.isArray(prev?.quotes) && prev.quotes.length > 50) {
      quotes = prev.quotes;
      console.warn('AVISO: data912 no respondió; se reusan los precios del snapshot anterior.');
    } else {
      errors.push('no se pudieron bajar precios para el snapshot y no hay snapshot previo');
    }
  }

  const cerHistory = (bcra?.series?.cer?.history45d ?? [])
    .map((r: any) => ({ date: r.fecha ?? r.date, value: Number(r.valor ?? r.value) }))
    .sort((a: any, b: any) => a.date.localeCompare(b.date));
  if (cerHistory.length < 20) errors.push(`historia CER corta: ${cerHistory.length} puntos`);

  const a3500 = Number(bcra?.series?.a3500?.latest?.valor);
  const al30 = quotes.find((q) => q.ticker === 'AL30')?.last;
  const al30d = quotes.find((q) => q.ticker === 'AL30D')?.last;
  const mep = al30 && al30d ? al30 / al30d : Number(mctx?.macro?.mep);

  const remRaw =
    mctx?.macro?.remMonthlyPct ??
    mctx?.macro?.rem?.ipcMonthlyMedianPct ??
    (Array.isArray(mctx?.macro?.rem) ? mctx.macro.rem : []);
  let rem: { month: string; pct: number }[] = (remRaw ?? [])
    .map((r: any) => ({ month: String(r.month).slice(0, 7), pct: Number(r.expectedPct ?? r.pct) }))
    .filter((r: any) => /^\d{4}-\d{2}$/.test(r.month) && Number.isFinite(r.pct));
  if (rem.length === 0) {
    errors.push('sin senda REM en market_context.json (macro.remMonthlyPct)');
  }

  const today = new Date().toISOString().slice(0, 10);
  return {
    asOf: today,
    timestamp: new Date().toISOString(),
    bcraIds: { cer: Number(bcra?.series?.cer?.id ?? 30), a3500: Number(bcra?.series?.a3500?.id ?? 5) },
    market: { mep, a3500, remMonthlyPct: rem },
    quotes,
    cerHistory,
  };
}

(async () => {
  const snapshot = await buildSnapshot();

  if (errors.length > 0) {
    console.error('ERRORES DE VALIDACIÓN:');
    for (const e of errors) console.error(' -', e);
    process.exit(1);
  }

  instruments.sort((a, b) => a.ticker.localeCompare(b.ticker));
  fs.writeFileSync(
    path.join(ROOT, 'lib/data/instruments.generated.json'),
    JSON.stringify({ asOf: snapshot.asOf, instruments }, null, 1),
  );
  fs.writeFileSync(path.join(ROOT, 'lib/data/snapshot.json'), JSON.stringify(snapshot, null, 1));

  console.log(`OK: ${instruments.length} instrumentos generados.`);
  const byFamily = instruments.reduce<Record<string, number>>((acc, i) => {
    acc[i.family] = (acc[i.family] ?? 0) + 1;
    return acc;
  }, {});
  console.log('Por familia:', byFamily);
  if (skipped.length > 0) {
    console.log(`Omitidos (${skipped.length}):`);
    for (const s of skipped) console.log(' -', s);
  }
})();

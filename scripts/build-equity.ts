/**
 * Genera el universo equity (acciones + CEDEARs) desde data912:
 *  - research/equity_meta.json (curado por agentes: ticker, nombre, sector)
 *  - historia diaria real de la API → stats (vol 1a, retornos, max drawdown)
 *  - lib/data/equity.generated.json        (meta + stats, liviano, va al bundle)
 *  - lib/data/equity-histories.generated.json (cierres diarios 1a+, lo sirve /api/equity-histories)
 * También captura la historia de los soberanos del registro (whitelist
 * /historical/bonds) para backtests de carteras mixtas.
 *
 * Uso: npx tsx scripts/build-equity.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.join(__dirname, '..');
const DAYS_KEPT = 280; // ~13 meses de ruedas

async function fetchRetry(url: string, tries = 3): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        headers: { 'User-Agent': 'curl/8' },
      });
      if (r.ok) return await r.json();
      if (r.status === 429) await new Promise((res) => setTimeout(res, 5000));
    } catch {
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface HistRow {
  date: string;
  c: number;
  v?: number;
  dr?: number;
  /** factor acumulado de ajuste por splits/cambios de ratio (data912). */
  sa?: number;
}

/**
 * Cierres AJUSTADOOS por splits/cambios de ratio de CEDEAR (c × sa) y
 * renormalizados para que el último punto coincida con el último cierre crudo:
 * los retornos quedan correctos y el precio final es el real de pantalla.
 * Sin esto, un cambio de ratio aparece como un crash de -50/-96% en un día y
 * corrompe vol, retornos, drawdown, backtest y Monte Carlo.
 */
function adjustedCloses(rows: HistRow[]): { date: string; c: number; v?: number }[] {
  const adj = rows.map((r) => ({ date: r.date, c: r.c * (r.sa ?? 1), v: r.v }));
  const lastAdj = adj[adj.length - 1]?.c ?? 1;
  const lastRaw = rows[rows.length - 1]?.c ?? 1;
  const k = lastAdj > 0 ? lastRaw / lastAdj : 1;
  return adj.map((r) => ({ ...r, c: r.c * k }));
}

/** Saltos residuales >35% diarios tras el ajuste: casi seguro un dato roto. */
function residualJumps(rows: { date: string; c: number }[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i].c / rows[i - 1].c - 1;
    if (Math.abs(r) > 0.35) out.push(`${rows[i].date}: ${(r * 100).toFixed(1)}%`);
  }
  return out;
}

function stats(rows: { date: string; c: number; v?: number }[]) {
  const r1y = rows.slice(-252);
  const closes = r1y.map((r) => r.c);
  const statsDays = r1y.length;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++)
    if (closes[i - 1] > 0 && closes[i] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  const mean = rets.reduce((s, r) => s + r, 0) / (rets.length || 1);
  const vol =
    Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1)) *
    Math.sqrt(252);
  const ret = (n: number) => {
    const win = rows.slice(-(n + 1));
    return win.length > n && win[0].c > 0 ? win[win.length - 1].c / win[0].c - 1 : null;
  };
  let peak = -Infinity;
  let maxDd = 0;
  for (const c of closes) {
    peak = Math.max(peak, c);
    maxDd = Math.min(maxDd, c / peak - 1);
  }
  // ventanas honestas: si no hay ~1 año de datos, las métricas "1a" van null
  const fullYear = statsDays >= 200;
  return {
    statsDays,
    vol1yPct: fullYear ? Math.round(vol * 1000) / 10 : null,
    ret1mPct: ret(21) !== null ? Math.round(ret(21)! * 1000) / 10 : null,
    ret3mPct: ret(63) !== null ? Math.round(ret(63)! * 1000) / 10 : null,
    ret1yPct: ret(252) !== null ? Math.round(ret(252)! * 1000) / 10 : null,
    maxDd1yPct: fullYear ? Math.round(maxDd * 1000) / 10 : null,
    lastClose: closes[closes.length - 1] ?? null,
    lastVolume: r1y[r1y.length - 1]?.v ?? 0,
    lastDate: r1y[r1y.length - 1]?.date ?? null,
  };
}

(async () => {
  const metaPath = path.join(ROOT, 'research/equity_meta.json');
  if (!fs.existsSync(metaPath)) {
    console.error('Falta research/equity_meta.json (lo genera el agente de metadatos).');
    process.exit(1);
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const stocks: any[] = meta.stocks ?? [];
  const cedears: any[] = meta.cedears ?? [];

  const histories: Record<string, [string, number][]> = {};
  const enrich = async (list: any[], kind: 'stocks' | 'cedears') => {
    const out: any[] = [];
    for (const m of list) {
      const rows: HistRow[] | null = await fetchRetry(
        `https://data912.com/historical/${kind}/${m.ticker}`,
      );
      await sleep(350); // 120 req/min
      if (!Array.isArray(rows) || rows.length < 60) {
        console.warn(`  sin historia útil: ${m.ticker} (${rows?.length ?? 'null'})`);
        continue;
      }
      const kept = adjustedCloses(rows.slice(-DAYS_KEPT).filter((r) => r.c > 0));
      const jumps = residualJumps(kept);
      if (jumps.length > 0)
        console.warn(`  ⚠ ${m.ticker}: saltos residuales tras ajuste: ${jumps.join(', ')}`);
      histories[m.ticker] = kept.map((r) => [r.date, Math.round(r.c * 1000) / 1000]);
      out.push({ ...m, ...stats(kept) });
      process.stdout.write('.');
    }
    console.log('');
    return out;
  };

  console.log(`Acciones (${stocks.length})…`);
  const stocksOut = await enrich(stocks, 'stocks');
  console.log(`CEDEARs (${cedears.length})…`);
  const cedearsOut = await enrich(cedears, 'cedears');

  // Historia de soberanos del registro (whitelist /historical/bonds, línea ARS).
  const registry = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'lib/data/instruments.generated.json'), 'utf8'),
  );
  const sovTickers: string[] = registry.instruments
    .filter((i: any) => i.family === 'soberano_usd')
    .map((i: any) => i.tickers.ars);
  console.log(`Soberanos con historia (${sovTickers.length})…`);
  const bondHistories: Record<string, [string, number][]> = {};
  for (const t of sovTickers) {
    const rows: HistRow[] | null = await fetchRetry(`https://data912.com/historical/bonds/${t}`);
    await sleep(350);
    if (Array.isArray(rows) && rows.length > 60) {
      bondHistories[t] = rows
        .slice(-DAYS_KEPT)
        .filter((r) => r.c > 0)
        .map((r) => [r.date, r.c]);
      process.stdout.write('.');
    }
  }
  console.log('');

  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(
    path.join(ROOT, 'lib/data/equity.generated.json'),
    JSON.stringify({ asOf: today, selectionRule: meta.selectionRule, stocks: stocksOut, cedears: cedearsOut }, null, 1),
  );
  fs.writeFileSync(
    path.join(ROOT, 'lib/data/equity-histories.generated.json'),
    JSON.stringify({ asOf: today, daysKept: DAYS_KEPT, histories, bondHistories }),
  );
  console.log(
    `OK: ${stocksOut.length} acciones + ${cedearsOut.length} CEDEARs, ${Object.keys(bondHistories).length} soberanos con historia.`,
  );
})();

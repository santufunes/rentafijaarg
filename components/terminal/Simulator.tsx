'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { INSTRUMENTS } from '@/lib/data/registry';
import type { MarketContext, Quote } from '@/lib/engine/types';
import { FAMILY_META } from '@/lib/familyMeta';
import { fmtArs, fmtArs2, fmtDate, fmtNum, fmtUsd } from '@/lib/format';
import { simulate, type TerminalRow } from '@/lib/terminal';

export default function Simulator({
  rows,
  quotes,
  ctx,
  initialTicker,
}: {
  rows: TerminalRow[];
  quotes: Map<string, Quote>;
  ctx: MarketContext;
  initialTicker?: string;
}) {
  const [ticker, setTicker] = useState(initialTicker ?? 'AL30');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (initialTicker) setTicker(initialTicker);
  }, [initialTicker]);
  const [amountText, setAmountText] = useState('1.000.000');
  const [priceText, setPriceText] = useState('');

  const parseNum = (t: string) => Number(t.trim().replace(/\./g, '').replace(/,/g, '.'));
  const amount = parseNum(amountText);
  const amountOk = Number.isFinite(amount) && amount > 0;

  const row = rows.find((r) => r.ticker === ticker);
  const marketPx = row?.pxArs ?? null;
  const customPx = priceText.trim() === '' ? null : parseNum(priceText);
  const priceOk = customPx === null || (Number.isFinite(customPx) && customPx > 0);

  const sim = useMemo(() => {
    if (!row || !amountOk || !priceOk) return null;
    const instr = INSTRUMENTS.find((i) => i.ticker === ticker);
    if (!instr) return null;
    try {
      return { result: simulate(instr, quotes, ctx, amount, customPx ?? undefined), error: null };
    } catch (e) {
      return { result: null, error: String(e).replace('Error: ', '') };
    }
  }, [row, ticker, amount, customPx, amountOk, priceOk, quotes, ctx]);

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toUpperCase();
    return rows.filter(
      (r) => r.ticker.includes(q) || (r.issuer ?? '').toUpperCase().includes(q) || r.name.toUpperCase().includes(q),
    );
  }, [rows, search]);

  const r = sim?.result ?? null;
  const isUsdView = r !== null && r.payCcy === 'USD';

  return (
    <div className="grid gap-4 lg:grid-cols-[290px_1fr]">
      {/* Panel de inputs */}
      <div className="space-y-3">
        <div className="rounded-lg border border-stone-800 p-3">
          <label className="font-mono text-[11px] uppercase text-stone-500">Instrumento</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrar…"
            className="mt-1 w-full rounded-md border border-stone-700 bg-stone-900 px-2 py-1 font-mono text-xs outline-none placeholder:text-stone-600 focus:border-emerald-500"
          />
          <div className="mt-2 max-h-64 overflow-y-auto">
            {filteredRows.map((fr) => (
              <button
                key={fr.ticker}
                onClick={() => setTicker(fr.ticker)}
                className={`flex w-full items-center justify-between rounded px-2 py-1 text-left font-mono text-xs transition ${
                  fr.ticker === ticker
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'text-stone-300 hover:bg-stone-900'
                }`}
              >
                <span>
                  {fr.ticker}{' '}
                  <span
                    className="rounded px-1 text-[9px] text-stone-950"
                    style={{ background: FAMILY_META[fr.family].color }}
                  >
                    {FAMILY_META[fr.family].short}
                  </span>
                </span>
                <span className="text-stone-500">{fr.months.toFixed(0)}m</span>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-stone-800 p-3">
          <label className="font-mono text-[11px] uppercase text-stone-500">Monto a invertir (ARS)</label>
          <input
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            inputMode="numeric"
            className={`mt-1 w-full rounded-md border bg-stone-900 px-2 py-1.5 font-mono text-sm outline-none focus:border-emerald-500 ${
              amountOk ? 'border-stone-700' : 'border-red-500'
            }`}
          />
          <label className="mt-3 block font-mono text-[11px] uppercase text-stone-500">
            Precio (ARS por 100 VN)
          </label>
          <input
            value={priceText}
            onChange={(e) => setPriceText(e.target.value)}
            placeholder={marketPx !== null ? `mercado: ${fmtNum(marketPx)}` : 'sin precio'}
            inputMode="numeric"
            className={`mt-1 w-full rounded-md border bg-stone-900 px-2 py-1.5 font-mono text-sm outline-none placeholder:text-stone-600 focus:border-emerald-500 ${
              priceOk ? 'border-stone-700' : 'border-red-500'
            }`}
          />
          <p className="mt-1 font-mono text-[10px] leading-snug text-stone-600">
            Dejalo vacío para usar el último precio de mercado. Cambialo para simular tu precio de
            ejecución.
          </p>
        </div>
      </div>

      {/* Resultado */}
      <div>
        {sim?.error && (
          <p className="rounded-lg border border-amber-900 bg-amber-950/40 p-4 font-mono text-xs text-amber-300">
            {sim.error}
          </p>
        )}
        {r && (
          <div className="space-y-4">
            {/* Resumen */}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <SimMetric
                label="Comprás"
                value={`${fmtNum(r.nominals)} VN`}
                sub={`a ${fmtArs2(r.priceArsPer100)} · gastás ${fmtArs(r.spentArs)}`}
              />
              <SimMetric
                label="Cobrás en total"
                value={isUsdView ? fmtUsd(r.totalReceivedPayCcy) : fmtArs(r.totalReceivedArs)}
                sub={
                  isUsdView
                    ? `≈ ${fmtArs(r.totalReceivedArs)} al MEP de hoy`
                    : `${r.payouts.length} pago${r.payouts.length > 1 ? 's' : ''}`
                }
                accent
              />
              <SimMetric
                label="TIR a tu precio"
                value={`${r.tirPct.toFixed(2)}%`}
                sub={`efectiva anual, ${r.tirKind}`}
              />
              <SimMetric
                label="Multiplicador"
                value={`${r.multiple.toFixed(2)}×`}
                sub={`renta ${isUsdView ? fmtUsd(r.totalInterest) : fmtArs(r.totalInterest * (r.totalReceivedArs / r.totalReceivedPayCcy))} + capital`}
              />
            </div>

            {/* Timeline */}
            <div className="rounded-lg border border-stone-800 p-3">
              <h3 className="font-mono text-[11px] uppercase text-stone-500">
                Cuándo cobrás cada pago {isUsdView ? '(USD)' : '(ARS)'}
              </h3>
              <div className="mt-2 h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={r.payouts.map((p) => ({
                      date: fmtDate(p.date),
                      Renta: Math.round(isUsdView ? p.interest : p.interest * (p.totalArs / (p.totalPayCcy || 1))),
                      Capital: Math.round(isUsdView ? p.amortization : p.amortization * (p.totalArs / (p.totalPayCcy || 1))),
                    }))}
                    margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#292524" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#78716c' }} tickLine={false} axisLine={false} />
                    <YAxis
                      tickFormatter={(v) =>
                        v >= 1_000_000 ? `${Math.round(v / 1_000_000)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
                      }
                      tick={{ fontSize: 10, fill: '#78716c' }}
                      tickLine={false}
                      axisLine={false}
                      width={44}
                    />
                    <Tooltip
                      formatter={(v) => (isUsdView ? fmtUsd(Number(v)) : fmtArs(Number(v)))}
                      contentStyle={{ background: '#1c1917', border: '1px solid #44403c', fontFamily: 'monospace', fontSize: 12 }}
                    />
                    <Bar isAnimationActive={false} dataKey="Renta" stackId="a" fill="#0ea5e9" />
                    <Bar isAnimationActive={false} dataKey="Capital" stackId="a" fill="#10b981" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Tabla de pagos */}
            <div className="overflow-x-auto rounded-lg border border-stone-800">
              <table className="w-full font-mono text-xs">
                <thead className="bg-stone-900 text-[10px] uppercase text-stone-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Fecha</th>
                    <th className="px-2 py-2 text-right">Renta ({r.payCcy})</th>
                    <th className="px-2 py-2 text-right">Capital ({r.payCcy})</th>
                    <th className="px-2 py-2 text-right">Total ({r.payCcy})</th>
                    <th className="px-2 py-2 text-right">≈ ARS hoy</th>
                    <th className="px-3 py-2 text-right">Acumulado ARS</th>
                  </tr>
                </thead>
                <tbody>
                  {r.payouts.map((p) => (
                    <tr key={p.date} className="border-t border-stone-900 hover:bg-stone-900/60">
                      <td className="px-3 py-1.5 text-stone-300">{fmtDate(p.date)}</td>
                      <td className="px-2 py-1.5 text-right text-sky-300">
                        {p.interest === 0 ? '—' : p.interest.toFixed(2)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-emerald-300">
                        {p.amortization === 0 ? '—' : p.amortization.toFixed(2)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-semibold text-stone-100">
                        {p.totalPayCcy.toFixed(2)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-stone-400">{fmtArs(p.totalArs)}</td>
                      <td className="px-3 py-1.5 text-right text-stone-400">{fmtArs(p.cumulativeArs)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-stone-700 bg-stone-900/60 font-semibold">
                  <tr>
                    <td className="px-3 py-2 text-stone-300">Total</td>
                    <td className="px-2 py-2 text-right text-sky-300">{r.totalInterest.toFixed(2)}</td>
                    <td className="px-2 py-2 text-right text-emerald-300">{r.totalAmortization.toFixed(2)}</td>
                    <td className="px-2 py-2 text-right text-stone-100">{r.totalReceivedPayCcy.toFixed(2)}</td>
                    <td className="px-2 py-2 text-right text-stone-300">{fmtArs(r.totalReceivedArs)}</td>
                    <td className="px-3 py-2"></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Caveats + sobrante */}
            <div className="space-y-1 font-mono text-[11px] leading-snug text-stone-500">
              {r.leftoverArs > 0.01 && (
                <p>
                  Te sobran {fmtArs(r.leftoverArs)} (los nominales son enteros). Liquidación{' '}
                  {fmtDate(r.settlement)} (T+1).
                </p>
              )}
              {r.caveats.map((c) => (
                <p key={c}>⚠ {c}</p>
              ))}
              <p>
                No incluye comisiones del broker (~0,5% + IVA) ni derechos de mercado. No es
                asesoramiento financiero.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SimMetric({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        accent ? 'border-emerald-800 bg-emerald-500/10' : 'border-stone-800'
      }`}
    >
      <div className="font-mono text-[10px] uppercase text-stone-500">{label}</div>
      <div className={`mt-0.5 font-mono text-xl font-bold tabular-nums ${accent ? 'text-emerald-300' : 'text-stone-100'}`}>
        {value}
      </div>
      {sub && <div className="font-mono text-[10px] text-stone-500">{sub}</div>}
    </div>
  );
}

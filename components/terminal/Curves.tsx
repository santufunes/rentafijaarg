'use client';

import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { FAMILY_META } from '@/lib/familyMeta';
import type { TerminalRow } from '@/lib/terminal';
import type { Family } from '@/lib/engine/types';

const CURVE_SETS: { key: string; label: string; families: Family[]; yLabel: string }[] = [
  {
    key: 'usd',
    label: 'Dólares (soberanos + BCRA + ONs)',
    families: ['soberano_usd', 'bopreal', 'on'],
    yLabel: 'TIR % USD',
  },
  {
    key: 'ars',
    label: 'Tasa fija en pesos',
    families: ['lecap', 'boncap', 'bonte', 'dual_tamar'],
    yLabel: 'TIR % ARS (EA)',
  },
  { key: 'cer', label: 'CER (TIR real)', families: ['boncer'], yLabel: 'TIR % real' },
];

export default function Curves({ rows }: { rows: TerminalRow[] }) {
  const [setKey, setSetKey] = useState('usd');
  const [xAxis, setXAxis] = useState<'mdYears' | 'months'>('mdYears');
  const curveSet = CURVE_SETS.find((c) => c.key === setKey)!;

  const series = useMemo(
    () =>
      curveSet.families
        .map((f) => ({
          family: f,
          data: rows
            .filter((r) => r.family === f && r.liquid)
            .map((r) => ({ x: xAxis === 'mdYears' ? r.mdYears : r.months, y: r.tirPct, ticker: r.ticker })),
        }))
        .filter((s) => s.data.length > 0),
    [rows, curveSet, xAxis],
  );

  return (
    <div className="rounded-lg border border-stone-800 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {CURVE_SETS.map((c) => (
          <button
            key={c.key}
            onClick={() => setSetKey(c.key)}
            className={`rounded-md px-3 py-1 font-mono text-xs transition ${
              setKey === c.key
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            {c.label}
          </button>
        ))}
        <button
          onClick={() => setXAxis((x) => (x === 'mdYears' ? 'months' : 'mdYears'))}
          className="ml-auto rounded-md border border-stone-700 px-3 py-1 font-mono text-xs text-stone-400 hover:text-stone-200"
        >
          eje X: {xAxis === 'mdYears' ? 'duración (años)' : 'meses al vencimiento'}
        </button>
      </div>
      <div className="mt-3 h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#292524" />
            <XAxis
              type="number"
              dataKey="x"
              name={xAxis === 'mdYears' ? 'MD (años)' : 'Meses'}
              tick={{ fontSize: 11, fill: '#78716c' }}
              stroke="#44403c"
            />
            <YAxis
              type="number"
              dataKey="y"
              name="TIR %"
              tick={{ fontSize: 11, fill: '#78716c' }}
              stroke="#44403c"
              width={50}
            />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              content={({ payload }) => {
                const p = payload?.[0]?.payload;
                if (!p) return null;
                return (
                  <div className="rounded border border-stone-700 bg-stone-900 px-2 py-1 font-mono text-xs text-stone-100">
                    <strong>{p.ticker}</strong> · TIR {p.y.toFixed(2)}% ·{' '}
                    {xAxis === 'mdYears' ? `MD ${p.x.toFixed(2)}` : `${p.x.toFixed(0)}m`}
                  </div>
                );
              }}
            />
            {series.map((s) => (
              <Scatter isAnimationActive={false}
                key={s.family}
                name={FAMILY_META[s.family].label}
                data={s.data}
                fill={FAMILY_META[s.family].color}
              >
                <LabelList
                  dataKey="ticker"
                  position="top"
                  style={{ fontSize: 9, fill: '#78716c', fontFamily: 'monospace' }}
                />
              </Scatter>
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 font-mono text-[11px] text-stone-400">
        {series.map((s) => (
          <span key={s.family} className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: FAMILY_META[s.family].color }}
            />
            {FAMILY_META[s.family].label} ({s.data.length})
          </span>
        ))}
        <span className="ml-auto text-stone-600">solo instrumentos líquidos · {curveSet.yLabel}</span>
      </div>
    </div>
  );
}

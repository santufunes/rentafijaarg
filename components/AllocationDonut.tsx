'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { SEGMENT_LABELS, type SegmentKey } from '@/lib/builder/profiles';
import type { SleeveMetrics } from '@/lib/engine/portfolio';
import { fmtArs, fmtPct } from '@/lib/format';

export default function AllocationDonut({ sleeves }: { sleeves: SleeveMetrics[] }) {
  const data = sleeves.map((s) => ({
    name: SEGMENT_LABELS[s.segment as SegmentKey].label,
    value: s.investedArs,
    weight: s.weight,
    color: SEGMENT_LABELS[s.segment as SegmentKey].color,
  }));

  return (
    <div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie isAnimationActive={false}
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={55}
              outerRadius={85}
              strokeWidth={2}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => fmtArs(Number(v))} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 space-y-1 text-xs">
        {data.map((d) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
            <span className="text-stone-600">{d.name}</span>
            <span className="ml-auto font-medium tabular-nums">{fmtPct(d.weight * 100, 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

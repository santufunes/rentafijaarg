'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CalendarBucket } from '@/lib/engine/portfolio';
import { fmtArs, fmtMonth } from '@/lib/format';

export default function CashflowChart({ calendar }: { calendar: CalendarBucket[] }) {
  const data = calendar.map((b) => ({
    month: fmtMonth(b.month),
    Pesos: Math.round(b.ars),
    'Dólares (en ARS al MEP)': Math.round(b.arsEquivalent - b.ars),
  }));

  return (
    <div className="mt-4 h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis
            tickFormatter={(v) => (v >= 1_000_000 ? `${Math.round(v / 1_000_000)}M` : `${Math.round(v / 1000)}k`)}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={42}
          />
          <Tooltip formatter={(v) => fmtArs(Number(v))} />
          <Bar dataKey="Pesos" stackId="a" fill="#0ea5e9" radius={[0, 0, 0, 0]} />
          <Bar dataKey="Dólares (en ARS al MEP)" stackId="a" fill="#10b981" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

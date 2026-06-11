'use client';

import { useMemo, useState } from 'react';
import { buildProposal } from '@/lib/builder/construct';
import {
  CURRENCY_GOALS,
  HORIZONS,
  PROFILES,
  SEGMENT_LABELS,
  type CurrencyGoal,
  type ProfileKey,
  type SegmentKey,
} from '@/lib/builder/profiles';
import { INSTRUMENTS } from '@/lib/data/registry';
import type { MarketContext, Quote } from '@/lib/engine/types';
import { FAMILY_META } from '@/lib/familyMeta';
import { fmtArs, fmtPct } from '@/lib/format';

export default function Allocation({
  quotes,
  ctx,
}: {
  quotes: Map<string, Quote>;
  ctx: MarketContext;
}) {
  const [profile, setProfile] = useState<ProfileKey>('moderado');
  const [goal, setGoal] = useState<CurrencyGoal>('mixto');
  const [horizon, setHorizon] = useState(12);
  const amount = 10_000_000;

  const proposal = useMemo(() => {
    try {
      return buildProposal(INSTRUMENTS, quotes, ctx, {
        amountArs: amount,
        horizonMonths: horizon,
        profile,
        goal,
        commissionPct: 0.5,
      });
    } catch {
      return null;
    }
  }, [quotes, ctx, profile, goal, horizon]);

  return (
    <div className="space-y-4">
      {/* Selectores */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-stone-800 p-3 font-mono text-xs">
        <Selector
          label="Perfil"
          options={PROFILES.map((p) => ({ key: p.key, label: p.label }))}
          value={profile}
          onChange={(v) => setProfile(v as ProfileKey)}
        />
        <Selector
          label="Objetivo"
          options={CURRENCY_GOALS.map((g) => ({ key: g.key, label: g.label }))}
          value={goal}
          onChange={(v) => setGoal(v as CurrencyGoal)}
        />
        <Selector
          label="Horizonte"
          options={HORIZONS.map((h) => ({ key: String(h.months), label: h.label }))}
          value={String(horizon)}
          onChange={(v) => setHorizon(Number(v))}
        />
        <span className="ml-auto text-stone-500">
          simulado con {fmtArs(amount)} · misma lógica que el armado minorista
        </span>
      </div>

      {proposal === null && (
        <p className="rounded-lg bg-red-950 p-4 font-mono text-sm text-red-300">
          No se pudo construir la asignación con los datos actuales.
        </p>
      )}

      {proposal && (
        <>
          {/* Barra de pesos */}
          <div>
            <div className="flex h-7 overflow-hidden rounded-md border border-stone-800">
              {proposal.traces
                .filter((t) => t.targetWeightPct > 0)
                .map((t) => (
                  <div
                    key={t.segment}
                    className="flex items-center justify-center font-mono text-[11px] font-bold text-stone-950"
                    style={{
                      width: `${t.targetWeightPct}%`,
                      background: SEGMENT_LABELS[t.segment as SegmentKey].color,
                    }}
                  >
                    {t.targetWeightPct.toFixed(0)}%
                  </div>
                ))}
            </div>
            <div className="mt-1 flex flex-wrap gap-4 font-mono text-[11px] text-stone-400">
              {proposal.traces.map((t) => (
                <span key={t.segment} className="flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: SEGMENT_LABELS[t.segment as SegmentKey].color }}
                  />
                  {SEGMENT_LABELS[t.segment as SegmentKey].label}: {t.targetWeightPct.toFixed(0)}%
                </span>
              ))}
            </div>
          </div>

          {/* Trazas por segmento */}
          {proposal.traces.map((trace) => (
            <div key={trace.segment} className="rounded-lg border border-stone-800">
              <div className="flex items-center justify-between border-b border-stone-800 px-3 py-2">
                <h3 className="font-mono text-xs font-bold uppercase text-stone-300">
                  {SEGMENT_LABELS[trace.segment as SegmentKey].label}
                  <span className="ml-2 font-normal text-stone-500">
                    objetivo {trace.targetWeightPct.toFixed(0)}% · {trace.candidates.length}{' '}
                    candidatos
                  </span>
                </h3>
              </div>
              <table className="w-full font-mono text-xs">
                <thead className="text-[10px] uppercase text-stone-600">
                  <tr>
                    <th className="px-3 py-1.5 text-left">Candidato</th>
                    <th className="px-2 py-1.5 text-right">Vence (m)</th>
                    <th className="px-2 py-1.5 text-right">TIR</th>
                    <th className="px-2 py-1.5 text-right">MD</th>
                    <th className="px-2 py-1.5 text-right">Vol/día</th>
                    <th className="px-3 py-1.5 text-left">Decisión</th>
                  </tr>
                </thead>
                <tbody>
                  {trace.candidates.map((c) => (
                    <tr
                      key={c.ticker}
                      className={`border-t border-stone-900 ${
                        c.selected ? 'bg-emerald-500/10' : c.liquid ? '' : 'opacity-40'
                      }`}
                    >
                      <td className="px-3 py-1.5">
                        <span className={c.selected ? 'font-bold text-emerald-300' : 'text-stone-200'}>
                          {c.selected ? '✓ ' : ''}
                          {c.ticker}
                        </span>{' '}
                        <span
                          className="rounded px-1 text-[9px] text-stone-950"
                          style={{ background: FAMILY_META[c.family].color }}
                        >
                          {FAMILY_META[c.family].short}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right text-stone-400">{c.months.toFixed(0)}</td>
                      <td className="px-2 py-1.5 text-right text-stone-300">{c.tirPct.toFixed(1)}%</td>
                      <td className="px-2 py-1.5 text-right text-stone-300">{c.mdYears.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right text-stone-500">
                        {c.turnoverArs >= 1e9
                          ? `${(c.turnoverArs / 1e9).toFixed(1)}B`
                          : `${(c.turnoverArs / 1e6).toFixed(0)}M`}
                      </td>
                      <td className="max-w-md px-3 py-1.5 leading-snug text-stone-400">{c.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {/* Resultado final */}
          <div className="rounded-lg border border-emerald-900/60 bg-emerald-500/5 p-3 font-mono text-xs">
            <h3 className="font-bold uppercase text-emerald-300">Cartera resultante</h3>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-stone-300">
              {proposal.lines.map((l) => (
                <span key={l.position.priced.instrument.ticker}>
                  {l.position.priced.instrument.ticker}{' '}
                  {fmtPct((l.position.investedArs / proposal.totalInvestedArs) * 100, 0)}
                </span>
              ))}
              <span className="ml-auto text-stone-500">
                invertido {fmtArs(proposal.totalInvestedArs)} · costos{' '}
                {fmtArs(proposal.estimatedFeesArs)}
              </span>
            </div>
            {proposal.warnings.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[11px] text-amber-400">
                {proposal.warnings.map((w) => (
                  <li key={w}>⚠ {w}</li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Selector({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-stone-500">{label}:</span>
      <div className="flex gap-0.5 rounded-md border border-stone-800 p-0.5">
        {options.map((o) => (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            className={`rounded px-2 py-0.5 transition ${
              value === o.key
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

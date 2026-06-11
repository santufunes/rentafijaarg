'use client';

import { useEffect, useMemo, useState } from 'react';
import Proposal from '@/components/Proposal';
import Wizard, { type WizardValues } from '@/components/Wizard';
import { buildProposal } from '@/lib/builder/construct';
import { buildUsdPortfolio } from '@/lib/builder/usdportfolio';
import {
  INSTRUMENTS,
  toMarketContext,
  toQuotesMap,
  type MarketPayload,
} from '@/lib/data/registry';

export default function Home() {
  const [market, setMarket] = useState<MarketPayload | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [values, setValues] = useState<WizardValues | null>(null);

  useEffect(() => {
    fetch('/api/market')
      .then((r) => r.json())
      .then(setMarket)
      .catch((e) => setMarketError(String(e)));
  }, []);

  const built = useMemo(() => {
    if (!market || !values) return null;
    const quotes = toQuotesMap(market);
    const ctx = toMarketContext(market);
    try {
      const proposal =
        values.currency === 'USD'
          ? buildUsdPortfolio(INSTRUMENTS, quotes, ctx, {
              amountUsd: values.amountUsd,
              horizonMonths: values.horizonMonths,
              style: values.style,
              composition: values.composition,
              commissionPct: 0.5,
            })
          : buildProposal(INSTRUMENTS, quotes, ctx, {
              amountArs: values.amountArs,
              horizonMonths: values.horizonMonths,
              profile: values.profile,
              goal: values.goal,
              focus: values.focus,
              commissionPct: 0.5,
            });
      if (proposal.lines.length === 0) {
        return {
          proposal: null,
          quotes,
          ctx,
          error:
            'No alcanzó para armar una cartera con este monto (ningún instrumento entra con nominales enteros). Probá con un monto mayor.',
        };
      }
      return { proposal, quotes, ctx, error: null as string | null };
    } catch (e) {
      return { proposal: null, quotes, ctx, error: String(e) };
    }
  }, [market, values]);

  return (
    <div>
      {!values && (
        <Wizard
          onSubmit={setValues}
          marketReady={market !== null}
          marketSource={market?.source ?? null}
          mep={market?.mep ?? null}
        />
      )}
      {marketError && (
        <p className="mt-6 rounded-lg border border-red-900 bg-red-950/50 p-4 text-sm text-red-300">
          No se pudieron cargar los datos de mercado: {marketError}
        </p>
      )}
      {values && built?.error && (
        <p className="mt-6 rounded-lg border border-amber-900 bg-amber-950/40 p-4 text-sm text-amber-300">
          {built.error.replace('Error: ', '')}
        </p>
      )}
      {values && built?.proposal && market && (
        <Proposal
          proposal={built.proposal}
          ctx={built.ctx}
          market={market}
          quotes={built.quotes}
          onBack={() => setValues(null)}
        />
      )}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import Proposal from '@/components/Proposal';
import Wizard, { type WizardValues } from '@/components/Wizard';
import { buildProposal } from '@/lib/builder/construct';
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

  const proposal = useMemo(() => {
    if (!market || !values) return null;
    try {
      return {
        proposal: buildProposal(INSTRUMENTS, toQuotesMap(market), toMarketContext(market), {
          amountArs: values.amountArs,
          horizonMonths: values.horizonMonths,
          profile: values.profile,
          goal: values.goal,
          commissionPct: 0.5,
        }),
        ctx: toMarketContext(market),
        error: null as string | null,
      };
    } catch (e) {
      return { proposal: null, ctx: null, error: String(e) };
    }
  }, [market, values]);

  return (
    <div>
      {!values && (
        <Wizard
          onSubmit={setValues}
          marketReady={market !== null}
          marketSource={market?.source ?? null}
        />
      )}
      {marketError && (
        <p className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          No se pudieron cargar los datos de mercado: {marketError}
        </p>
      )}
      {values && proposal?.error && (
        <p className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          No se pudo armar la propuesta: {proposal.error}
        </p>
      )}
      {values && proposal?.proposal && market && proposal.ctx && (
        <Proposal
          proposal={proposal.proposal}
          ctx={proposal.ctx}
          market={market}
          onBack={() => setValues(null)}
        />
      )}
    </div>
  );
}

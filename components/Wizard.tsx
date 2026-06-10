'use client';

import { useState } from 'react';
import {
  CURRENCY_GOALS,
  HORIZONS,
  PROFILES,
  type CurrencyGoal,
  type ProfileKey,
} from '@/lib/builder/profiles';
import { fmtArs } from '@/lib/format';

export interface WizardValues {
  amountArs: number;
  horizonMonths: number;
  goal: CurrencyGoal;
  profile: ProfileKey;
}

const AMOUNT_CHIPS = [500_000, 2_000_000, 5_000_000, 20_000_000];

export default function Wizard({
  onSubmit,
  marketReady,
  marketSource,
}: {
  onSubmit: (v: WizardValues) => void;
  marketReady: boolean;
  marketSource: 'live' | 'snapshot' | null;
}) {
  const [step, setStep] = useState(0);
  const [amountText, setAmountText] = useState('2.000.000');
  const [horizon, setHorizon] = useState<number | null>(null);
  const [goal, setGoal] = useState<CurrencyGoal | null>(null);
  const [profile, setProfile] = useState<ProfileKey | null>(null);

  // El texto es la única fuente de verdad: formato es-AR (punto = miles,
  // coma = decimal). Si no parsea, el botón se deshabilita — nunca se sigue
  // con un valor viejo en silencio.
  const parsed = Number(amountText.trim().replace(/\./g, '').replace(/,/g, '.'));
  const amount = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;

  const steps = ['Monto', 'Horizonte', 'Moneda', 'Perfil'];

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          Tu cartera de renta fija, <span className="text-emerald-600">bien hecha</span>
        </h1>
        <p className="mt-2 text-stone-500">
          Cuatro preguntas. Bonos y letras reales de BYMA, matemática exacta, supuestos a la vista.
        </p>
      </div>

      <div className="mb-8 mt-6 flex justify-center gap-2">
        {steps.map((s, i) => (
          <button
            key={s}
            onClick={() => i < step && setStep(i)}
            className={`h-1.5 w-16 rounded-full transition-colors ${
              i <= step ? 'bg-emerald-500' : 'bg-stone-200'
            }`}
            aria-label={s}
          />
        ))}
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
        {step === 0 && (
          <div>
            <h2 className="text-xl font-semibold">¿Cuánto querés invertir?</h2>
            <p className="mt-1 text-sm text-stone-500">En pesos. Después podés ajustarlo.</p>
            <div
              className={`mt-5 flex items-center gap-2 rounded-xl border px-4 py-3 text-2xl font-semibold focus-within:border-emerald-500 ${
                amount === null ? 'border-red-400' : 'border-stone-300'
              }`}
            >
              <span className="text-stone-400">$</span>
              <input
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                onBlur={() => {
                  if (amount !== null) setAmountText(new Intl.NumberFormat('es-AR').format(amount));
                }}
                inputMode="numeric"
                className="w-full outline-none"
                aria-label="Monto a invertir en pesos"
              />
            </div>
            {amount === null && (
              <p className="mt-2 text-sm text-red-600">
                No entiendo ese monto. Usá punto para miles y coma para decimales: 2.000.000
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {AMOUNT_CHIPS.map((a) => (
                <button
                  key={a}
                  onClick={() => setAmountText(new Intl.NumberFormat('es-AR').format(a))}
                  className="rounded-full border border-stone-200 px-3 py-1 text-sm text-stone-600 hover:border-emerald-500 hover:text-emerald-700"
                >
                  {fmtArs(a)}
                </button>
              ))}
            </div>
            <NextButton disabled={amount === null} onClick={() => setStep(1)} />
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 className="text-xl font-semibold">¿Por cuánto tiempo podés dejarlo invertido?</h2>
            <p className="mt-1 text-sm text-stone-500">
              La cartera se arma para que los vencimientos acompañen tu horizonte.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {HORIZONS.map((h) => (
                <OptionCard
                  key={h.months}
                  selected={horizon === h.months}
                  title={h.label}
                  onClick={() => setHorizon(h.months)}
                />
              ))}
            </div>
            <NextButton disabled={horizon === null} onClick={() => setStep(2)} />
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-xl font-semibold">¿En qué moneda pensás tu objetivo?</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {CURRENCY_GOALS.map((g) => (
                <OptionCard
                  key={g.key}
                  selected={goal === g.key}
                  title={g.label}
                  subtitle={g.description}
                  onClick={() => setGoal(g.key)}
                />
              ))}
            </div>
            <NextButton disabled={goal === null} onClick={() => setStep(3)} />
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="text-xl font-semibold">¿Cuánto riesgo estás dispuesto a tomar?</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {PROFILES.map((p) => (
                <OptionCard
                  key={p.key}
                  selected={profile === p.key}
                  title={p.label}
                  subtitle={p.description}
                  onClick={() => setProfile(p.key)}
                />
              ))}
            </div>
            <button
              disabled={profile === null || amount === null || !marketReady}
              onClick={() =>
                onSubmit({
                  amountArs: amount!,
                  horizonMonths: horizon!,
                  goal: goal!,
                  profile: profile!,
                })
              }
              className="mt-6 w-full rounded-xl bg-emerald-600 py-3 text-lg font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              {marketReady ? 'Armar mi cartera' : 'Cargando precios de mercado…'}
            </button>
            {marketSource === 'snapshot' && (
              <p className="mt-2 text-center text-xs text-amber-600">
                Sin conexión a datos en vivo: se usarán precios de la última foto guardada.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function OptionCard({
  selected,
  title,
  subtitle,
  onClick,
}: {
  selected: boolean;
  title: string;
  subtitle?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition ${
        selected
          ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500'
          : 'border-stone-200 hover:border-stone-400'
      }`}
    >
      <div className="font-semibold">{title}</div>
      {subtitle && <div className="mt-1 text-xs leading-snug text-stone-500">{subtitle}</div>}
    </button>
  );
}

function NextButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="mt-6 w-full rounded-xl bg-stone-900 py-3 text-lg font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-300"
    >
      Continuar
    </button>
  );
}

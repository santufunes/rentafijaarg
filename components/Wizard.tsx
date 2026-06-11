'use client';

import { useState } from 'react';
import {
  CURRENCY_GOALS,
  PESO_FOCUSES,
  PROFILES,
  USD_COMPOSITIONS,
  USD_STYLES,
  type CurrencyGoal,
  type PesoFocus,
  type ProfileKey,
  type UsdComposition,
  type UsdStyle,
} from '@/lib/builder/profiles';
import { fmtArs, fmtUsd } from '@/lib/format';

export type WizardValues =
  | {
      currency: 'ARS';
      amountArs: number;
      horizonMonths: number;
      goal: 'pesos' | 'mixto';
      focus: PesoFocus;
      profile: ProfileKey;
    }
  | {
      currency: 'USD';
      amountUsd: number;
      horizonMonths: number;
      style: UsdStyle;
      composition: UsdComposition;
    };

const ARS_CHIPS = [500_000, 2_000_000, 5_000_000, 20_000_000];
const USD_CHIPS = [1_000, 5_000, 20_000, 100_000];

const fmtMonths = (m: number) => (m < 12 ? `${m} meses` : m % 12 === 0 ? `${m / 12} año${m >= 24 ? 's' : ''}` : `${m} meses`);

function horizonDateLabel(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
}

export default function Wizard({
  onSubmit,
  marketReady,
  marketSource,
  mep,
}: {
  onSubmit: (v: WizardValues) => void;
  marketReady: boolean;
  marketSource: 'live' | 'snapshot' | null;
  mep: number | null;
}) {
  const [step, setStep] = useState(0);
  const [currency, setCurrency] = useState<'ARS' | 'USD' | null>(null);
  const [amountText, setAmountText] = useState('');
  const [horizon, setHorizon] = useState(12);
  // pesos
  const [goal, setGoal] = useState<'pesos' | 'mixto' | null>(null);
  const [focus, setFocus] = useState<PesoFocus>('equilibrado');
  const [profile, setProfile] = useState<ProfileKey | null>(null);
  // usd
  const [style, setStyle] = useState<UsdStyle | null>(null);
  const [composition, setComposition] = useState<UsdComposition>('mixto');

  const parsed = Number(amountText.trim().replace(/\./g, '').replace(/,/g, '.'));
  const amount = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;

  const steps =
    currency === 'USD'
      ? ['Moneda', 'Monto', 'Horizonte', 'Estilo']
      : ['Moneda', 'Monto', 'Horizonte', 'Objetivo', 'Perfil'];

  const chips = currency === 'USD' ? USD_CHIPS : ARS_CHIPS;
  const fmtAmt = currency === 'USD' ? fmtUsd : fmtArs;

  function submit() {
    if (currency === 'USD') {
      onSubmit({ currency: 'USD', amountUsd: amount!, horizonMonths: horizon, style: style!, composition });
    } else {
      onSubmit({
        currency: 'ARS',
        amountArs: amount!,
        horizonMonths: horizon,
        goal: goal!,
        focus,
        profile: profile!,
      });
    }
  }

  const sliderFill = ((horizon - 3) / (48 - 3)) * 100;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-stone-100">
          Tu cartera de renta fija, <span className="text-emerald-400">bien hecha</span>
        </h1>
        <p className="mt-2 text-stone-400">
          Bonos y letras reales de BYMA, matemática exacta, decisiones explicadas. Lo mismo que ves
          en la <span className="font-mono text-xs text-emerald-400">TERMINAL</span>, en simple.
        </p>
      </div>

      <div className="mb-8 mt-6 flex justify-center gap-2">
        {steps.map((s, i) => (
          <button
            key={s}
            onClick={() => i < step && setStep(i)}
            className={`h-1.5 w-14 rounded-full transition-colors ${i <= step ? 'bg-emerald-500' : 'bg-stone-800'}`}
            aria-label={s}
          />
        ))}
      </div>

      <div className="rounded-2xl border border-stone-800 bg-stone-900/60 p-8">
        {step === 0 && (
          <div>
            <h2 className="text-xl font-semibold text-stone-100">¿En qué moneda invertís?</h2>
            <p className="mt-1 text-sm text-stone-500">
              Define el universo completo: en dólares solo verás instrumentos que pagan USD.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <BigOption
                selected={currency === 'ARS'}
                title="Pesos"
                subtitle="LECAPs y BONCAPs a tasa fija, BONCER que siguen a la inflación, y dólar opcional."
                badge="ARS"
                onClick={() => {
                  if (currency !== 'ARS') setAmountText('');
                  setCurrency('ARS');
                }}
              />
              <BigOption
                selected={currency === 'USD'}
                title="Dólares (MEP)"
                subtitle="Soberanos AL/GD, BOPREAL y ONs corporativas con calificación. Cobrás todo en USD."
                badge="USD"
                onClick={() => {
                  if (currency !== 'USD') setAmountText('');
                  setCurrency('USD');
                }}
              />
            </div>
            <NextButton disabled={currency === null} onClick={() => setStep(1)} />
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 className="text-xl font-semibold text-stone-100">
              ¿Cuánto querés invertir? <span className="text-stone-500">({currency})</span>
            </h2>
            <div
              className={`mt-5 flex items-center gap-2 rounded-xl border bg-stone-950 px-4 py-3 font-mono text-2xl font-semibold text-stone-100 focus-within:border-emerald-500 ${
                amount === null && amountText !== '' ? 'border-red-500' : 'border-stone-700'
              }`}
            >
              <span className="text-stone-500">{currency === 'USD' ? 'US$' : '$'}</span>
              <input
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                onBlur={() => {
                  if (amount !== null) setAmountText(new Intl.NumberFormat('es-AR').format(amount));
                }}
                inputMode="numeric"
                placeholder={currency === 'USD' ? '10.000' : '2.000.000'}
                className="w-full bg-transparent outline-none placeholder:text-stone-700"
                aria-label={`Monto a invertir en ${currency}`}
              />
            </div>
            {amount === null && amountText !== '' && (
              <p className="mt-2 text-sm text-red-400">
                No entiendo ese monto. Usá punto para miles: {currency === 'USD' ? '10.000' : '2.000.000'}
              </p>
            )}
            {currency === 'USD' && amount !== null && mep !== null && (
              <p className="mt-2 font-mono text-xs text-stone-500">
                ≈ {fmtArs(amount * mep)} al MEP de hoy ({fmtArs(mep)}) — las órdenes se cargan en
                pesos, cobrás en dólares.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {chips.map((a) => (
                <button
                  key={a}
                  onClick={() => setAmountText(new Intl.NumberFormat('es-AR').format(a))}
                  className="rounded-full border border-stone-700 px-3 py-1 font-mono text-sm text-stone-400 transition hover:border-emerald-500 hover:text-emerald-300"
                >
                  {fmtAmt(a)}
                </button>
              ))}
            </div>
            <NextButton disabled={amount === null} onClick={() => setStep(2)} />
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-xl font-semibold text-stone-100">
              ¿Por cuánto tiempo podés dejarlo invertido?
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              La cartera se construye estrictamente para este plazo: vencimientos calzados y
              escalonados a tu horizonte.
            </p>
            <div className="mt-8">
              <div className="text-center">
                <span className="font-mono text-4xl font-bold text-emerald-400">
                  {fmtMonths(horizon)}
                </span>
                <p className="mt-1 font-mono text-xs text-stone-500">
                  ≈ hasta {horizonDateLabel(horizon)}
                </p>
              </div>
              <input
                type="range"
                min={3}
                max={48}
                step={1}
                value={horizon}
                onChange={(e) => setHorizon(Number(e.target.value))}
                className="horizon mt-6 w-full"
                style={{ ['--fill' as never]: `${sliderFill}%` }}
                aria-label="Horizonte en meses"
              />
              <div className="mt-2 flex justify-between font-mono text-[10px] text-stone-600">
                {[3, 6, 12, 24, 36, 48].map((m) => (
                  <button
                    key={m}
                    onClick={() => setHorizon(m)}
                    className={`transition hover:text-emerald-400 ${horizon === m ? 'text-emerald-400' : ''}`}
                  >
                    {fmtMonths(m)}
                  </button>
                ))}
              </div>
            </div>
            <NextButton disabled={false} onClick={() => setStep(3)} />
          </div>
        )}

        {step === 3 && currency === 'USD' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-stone-100">¿Cómo querés tus dólares?</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {USD_STYLES.map((s) => (
                  <OptionCard
                    key={s.key}
                    selected={style === s.key}
                    title={s.label}
                    subtitle={s.description}
                    onClick={() => setStyle(s.key)}
                  />
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-stone-300">Composición</h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {USD_COMPOSITIONS.map((c) => (
                  <OptionCard
                    key={c.key}
                    selected={composition === c.key}
                    title={c.label}
                    subtitle={c.description}
                    small
                    onClick={() => setComposition(c.key)}
                  />
                ))}
              </div>
            </div>
            <SubmitButton
              disabled={style === null || !marketReady}
              marketReady={marketReady}
              onClick={submit}
            />
            {marketSource === 'snapshot' && <SnapshotNote />}
          </div>
        )}

        {step === 3 && currency === 'ARS' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-stone-100">¿Pesos puros o con algo de dólar?</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {CURRENCY_GOALS.filter((g) => g.key !== 'dolares').map((g) => (
                  <OptionCard
                    key={g.key}
                    selected={goal === g.key}
                    title={g.label}
                    subtitle={g.description}
                    onClick={() => setGoal(g.key as 'pesos' | 'mixto')}
                  />
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-stone-300">
                Dentro de los pesos, ¿qué priorizás?
              </h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {PESO_FOCUSES.map((f) => (
                  <OptionCard
                    key={f.key}
                    selected={focus === f.key}
                    title={f.label}
                    subtitle={f.description}
                    small
                    onClick={() => setFocus(f.key)}
                  />
                ))}
              </div>
            </div>
            <NextButton disabled={goal === null} onClick={() => setStep(4)} />
          </div>
        )}

        {step === 4 && currency === 'ARS' && (
          <div>
            <h2 className="text-xl font-semibold text-stone-100">
              ¿Cuánto riesgo estás dispuesto a tomar?
            </h2>
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
            <SubmitButton
              disabled={profile === null || !marketReady}
              marketReady={marketReady}
              onClick={submit}
            />
            {marketSource === 'snapshot' && <SnapshotNote />}
          </div>
        )}
      </div>
    </div>
  );
}

function BigOption({
  selected,
  title,
  subtitle,
  badge,
  onClick,
}: {
  selected: boolean;
  title: string;
  subtitle: string;
  badge: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border p-5 text-left transition ${
        selected
          ? 'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500'
          : 'border-stone-700 bg-stone-950 hover:border-stone-500'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold text-stone-100">{title}</span>
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
            selected ? 'bg-emerald-500 text-stone-950' : 'bg-stone-800 text-stone-400'
          }`}
        >
          {badge}
        </span>
      </div>
      <p className="mt-2 text-xs leading-snug text-stone-400">{subtitle}</p>
    </button>
  );
}

function OptionCard({
  selected,
  title,
  subtitle,
  small,
  onClick,
}: {
  selected: boolean;
  title: string;
  subtitle?: string;
  small?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border text-left transition ${small ? 'p-3' : 'p-4'} ${
        selected
          ? 'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500'
          : 'border-stone-700 bg-stone-950 hover:border-stone-500'
      }`}
    >
      <div className={`font-semibold text-stone-100 ${small ? 'text-sm' : ''}`}>{title}</div>
      {subtitle && <div className="mt-1 text-xs leading-snug text-stone-500">{subtitle}</div>}
    </button>
  );
}

function NextButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="mt-6 w-full rounded-xl bg-stone-100 py-3 text-lg font-semibold text-stone-950 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-stone-800 disabled:text-stone-600"
    >
      Continuar
    </button>
  );
}

function SubmitButton({
  disabled,
  marketReady,
  onClick,
}: {
  disabled: boolean;
  marketReady: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="w-full rounded-xl bg-emerald-500 py-3 text-lg font-semibold text-stone-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-stone-800 disabled:text-stone-600"
    >
      {marketReady ? 'Armar mi cartera' : 'Cargando precios de mercado…'}
    </button>
  );
}

function SnapshotNote() {
  return (
    <p className="mt-2 text-center font-mono text-xs text-amber-400">
      Sin conexión a datos en vivo: se usan precios de la última foto guardada.
    </p>
  );
}

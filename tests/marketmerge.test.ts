/**
 * Volumen de referencia: el escenario "mañana antes de la apertura" (volumen
 * vivo 0 en todo el panel) no debe marcar ilíquido al mercado entero.
 */

import { describe, expect, it } from 'vitest';
import { isPreOpen, mergeWithReference, withReferenceVolumes } from '@/lib/data/marketMerge';

const ref = [
  { ticker: 'AL30', last: 92700, volume: 165_275_242 },
  { ticker: 'T31Y7', last: 121, volume: 4_858_997_840 },
  { ticker: 'BPOD7', last: 148600, volume: 4_166_797 },
];

describe('volumen de referencia', () => {
  it('pre-apertura: volumen vivo 0 hereda el del último cierre', () => {
    const live = ref.map((q) => ({ ...q, volume: 0 }));
    const merged = withReferenceVolumes(live, ref);
    expect(merged.find((q) => q.ticker === 'AL30')!.volume).toBe(165_275_242);
    expect(merged.find((q) => q.ticker === 'T31Y7')!.volume).toBe(4_858_997_840);
  });

  it('intradía: si hoy ya se operó más que ayer, gana el vivo', () => {
    const live = [{ ticker: 'AL30', last: 92900, volume: 200_000_000 }];
    expect(withReferenceVolumes(live, ref)[0].volume).toBe(200_000_000);
  });

  it('ticker nuevo sin referencia conserva su volumen vivo', () => {
    const live = [{ ticker: 'NUEVO', last: 100, volume: 5000 }];
    expect(withReferenceVolumes(live, ref)[0].volume).toBe(5000);
  });

  it('el precio vivo nunca se pisa con el de referencia', () => {
    const live = [{ ticker: 'AL30', last: 99999, volume: 0 }];
    expect(withReferenceVolumes(live, ref)[0].last).toBe(99999);
  });

  it('detección de pre-apertura: <20% del panel operado', () => {
    expect(isPreOpen(ref.map((q) => ({ ...q, volume: 0 })))).toBe(true);
    expect(isPreOpen(ref)).toBe(false);
    expect(isPreOpen([])).toBe(false);
  });

  it('unión: un ticker AUSENTE del feed vivo cae al último cierre completo', () => {
    // pre-apertura el panel corporativo no lista los tickers sin operaciones
    const live = [{ ticker: 'AL30', last: 92900, volume: 1000 }];
    const merged = mergeWithReference(live, ref);
    const t31 = merged.find((q) => q.ticker === 'T31Y7');
    expect(t31).toBeDefined();
    expect(t31!.last).toBe(121);
    expect(t31!.volume).toBe(4_858_997_840);
    // y el vivo pisa precio pero hereda el máximo volumen
    const al30 = merged.find((q) => q.ticker === 'AL30')!;
    expect(al30.last).toBe(92900);
    expect(al30.volume).toBe(165_275_242);
  });

  it('unión: un vivo con last=0 no pisa la referencia', () => {
    const live = [{ ticker: 'AL30', last: 0, volume: 0 }];
    const merged = mergeWithReference(live, ref);
    expect(merged.find((q) => q.ticker === 'AL30')!.last).toBe(92700);
  });
});

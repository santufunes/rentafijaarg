import type { Family } from './engine/types';

export interface FamilyMeta {
  label: string;
  short: string;
  color: string;
  /** En qué moneda/término está expresada la TIR de esta familia. */
  tirKind: 'USD' | 'ARS' | 'real' | 'piso ARS' | 'USD-linked';
}

export const FAMILY_META: Record<Family, FamilyMeta> = {
  soberano_usd: { label: 'Soberano USD', short: 'SOB', color: '#10b981', tirKind: 'USD' },
  bopreal: { label: 'BOPREAL (BCRA)', short: 'BPO', color: '#34d399', tirKind: 'USD' },
  on: { label: 'ON corporativa', short: 'ON', color: '#f59e0b', tirKind: 'USD' },
  lecap: { label: 'LECAP', short: 'LEC', color: '#0ea5e9', tirKind: 'ARS' },
  boncap: { label: 'BONCAP', short: 'BCP', color: '#38bdf8', tirKind: 'ARS' },
  bonte: { label: 'BONTE', short: 'BTE', color: '#818cf8', tirKind: 'ARS' },
  boncer: { label: 'BONCER (CER)', short: 'CER', color: '#8b5cf6', tirKind: 'real' },
  dual_tamar: { label: 'Dual TAMAR', short: 'DUA', color: '#f472b6', tirKind: 'piso ARS' },
  dollar_linked: { label: 'Dollar-linked', short: 'DLK', color: '#a3e635', tirKind: 'USD-linked' },
};

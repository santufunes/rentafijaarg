/**
 * Historias diarias (1 año+) del universo equity y de los soberanos con
 * historia, capturadas en build por scripts/build-equity.ts. Se sirven por API
 * para no inflar el bundle del cliente; cachea fuerte (cambian 1 vez por día).
 */

import { NextResponse } from 'next/server';
import histories from '@/lib/data/equity-histories.generated.json';

export function GET() {
  return NextResponse.json(histories, {
    headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' },
  });
}

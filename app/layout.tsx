import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'RentaFijaArg — Tu cartera de renta fija, bien hecha',
  description:
    'Propuestas de cartera de renta fija argentina (BYMA) para inversores minoristas, con matemática de nivel institucional: TIR exacta, duración, CER y escenarios.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body className="min-h-screen antialiased">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-xl font-bold tracking-tight">
                RentaFija<span className="text-emerald-600">Arg</span>
              </span>
              <span className="hidden text-xs text-stone-400 sm:block">
                renta fija BYMA para minoristas, con estándares institucionales
              </span>
            </Link>
            <nav className="flex gap-4 text-sm text-stone-500">
              <Link href="/metodologia" className="hover:text-stone-900">
                Metodología
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 pb-10 pt-4 text-xs leading-relaxed text-stone-400">
          <p>
            RentaFijaArg es una herramienta educativa. No constituye asesoramiento financiero ni una
            recomendación de inversión en los términos de la normativa CNV. Los precios provienen de
            fuentes públicas con demora; verificá todo con tu agente (ALyC) antes de operar. Los
            rendimientos pasados y proyectados no garantizan resultados futuros.
          </p>
        </footer>
      </body>
    </html>
  );
}

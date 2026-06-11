import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const jbMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-jbmono',
});

export const metadata: Metadata = {
  title: 'RentaFijaArg — Tu cartera de renta fija, bien hecha',
  description:
    'Carteras de renta fija argentina (BYMA) para inversores minoristas, con matemática de nivel institucional: TIR exacta, duración, CER, spreads y escaleras de vencimientos.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body className={`${jbMono.variable} min-h-screen antialiased`}>
        <header className="border-b border-stone-800 bg-stone-950/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-xl font-bold tracking-tight text-stone-100">
                RentaFija<span className="text-emerald-400">Arg</span>
              </span>
              <span className="hidden font-mono text-[11px] text-stone-500 sm:block">
                renta fija BYMA · estándares institucionales
              </span>
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link
                href="/"
                className="text-stone-400 transition hover:text-stone-100"
              >
                Armar cartera
              </Link>
              <Link
                href="/terminal"
                className="rounded-md border border-emerald-800 bg-emerald-500/10 px-2.5 py-1 font-mono text-xs text-emerald-300 transition hover:bg-emerald-500/20"
              >
                TERMINAL
              </Link>
              <Link href="/metodologia" className="text-stone-400 transition hover:text-stone-100">
                Metodología
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-10 pt-4 text-xs leading-relaxed text-stone-600">
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

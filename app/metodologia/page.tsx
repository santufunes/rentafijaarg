export const metadata = { title: 'Metodología — RentaFijaArg' };

export default function Metodologia() {
  return (
    <article className="mx-auto max-w-3xl space-y-6 text-stone-300">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-stone-100">Metodología</h1>
        <p className="mt-2 text-stone-500">
          Todo lo que la herramienta calcula, con qué convenciones y bajo qué supuestos. Si algo no
          está acá, preguntá — no debería haber magia.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-semibold text-stone-100">Datos</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          <li>
            <strong>Precios:</strong> panel de títulos públicos y letras de BYMA vía data912.com
            (demora ~20 minutos). Los precios son <em>sucios</em> (incluyen interés corrido) y se
            expresan por cada 100 de valor nominal original.
          </li>
          <li>
            <strong>CER y A3500:</strong> API de estadísticas del BCRA (serie diaria oficial).
          </li>
          <li>
            <strong>Dólar MEP:</strong> implícito en AL30/AL30D al momento de la consulta.
          </li>
          <li>
            <strong>Especificaciones de cada instrumento</strong> (cupones escalonados,
            amortizaciones, valores finales de LECAP/BONCAP, CER base de cada BONCER): relevadas de
            fuentes primarias (prospectos del canje 2020, resultados de licitación de la Secretaría
            de Finanzas, comunicaciones BCRA, fichas técnicas IAMC) y verificadas de forma cruzada
            contra los rendimientos publicados por el mercado.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-stone-100">Matemática financiera</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          <li>
            <strong>TIR:</strong> tasa interna de retorno <em>efectiva anual</em>, descuento
            exponencial con días corridos actual/365 (convención IAMC). Se resuelve por bisección
            sobre los flujos remanentes contra el precio sucio. Para bonos en dólares la TIR es en
            USD usando el precio del ticker D; para CER es la TIR <em>real</em> (precio deflactado
            por el coeficiente CER aplicable).
          </li>
          <li>
            <strong>Liquidación:</strong> T+1 hábil (estándar BYMA), con calendario de feriados
            argentinos.
          </li>
          <li>
            <strong>CER:</strong> los pagos ajustan por CER(fecha de pago − 10 días hábiles) ÷ CER
            base de emisión. Hacia adelante el CER se proyecta con la mediana de inflación mensual
            del REM (BCRA), capitalizada diariamente.
          </li>
          <li>
            <strong>Duración:</strong> Macaulay en años sobre flujos descontados a la TIR;
            modificada = Macaulay ÷ (1 + TIR).
          </li>
          <li>
            <strong>LECAP/BONCAP:</strong> el pago final por 100 VN está fijado en la emisión
            (capitalización mensual de la TEM de corte); se valúan como cupón cero contra ese pago.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-stone-100">Construcción de la cartera</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          <li>
            <strong>Segmentos:</strong> tasa fija en pesos (LECAP/BONCAP), ajuste por inflación
            (BONCER) y dólares (soberanos hard-dollar y BOPREAL). Los pesos objetivo dependen del
            perfil, la moneda del objetivo y el horizonte (matriz publicada en el código).
          </li>
          <li>
            <strong>Selección:</strong> solo instrumentos con liquidez relevante; tasa fija y CER se
            calzan con el horizonte; en dólares la duración objetivo crece con el perfil.
          </li>
          <li>
            <strong>Liquidez:</strong> se evalúa contra un <em>volumen de referencia</em>: el mayor
            entre el volumen operado hoy y el del último cierre archivado. Antes de la apertura el
            volumen del día es cero para todo el panel — eso no significa que el mercado se haya
            vuelto ilíquido.
          </li>
          <li>
            <strong>Sizing:</strong> nominales enteros; el remanente se reasigna al instrumento más
            barato por nominal; lo que no alcanza queda como “efectivo sin invertir”.
          </li>
          <li>
            <strong>Costos:</strong> comisión configurable (default 0,5% + IVA) más derechos de
            mercado estimados (0,01%). Son estimaciones: cada ALyC tiene su esquema.
          </li>
          <li>
            <strong>Flujo en dólares:</strong> universo 100% USD (soberanos AL/GD/Bonar, BOPREAL y
            ONs corporativas). El estilo define la mezcla soberanos/ONs y el piso de calificación
            de la escalera corporativa (crédito primero, valor por spread sobre la curva soberana,
            topes de concentración del 25% por emisor — la misma maquinaria de la pestaña Cartera ON
            de la terminal). El enfoque del flujo en pesos inclina tasa fija ↔ CER sin tocar el
            bucket dólar.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-stone-100">Escenarios</h2>
        <p className="mt-2 text-sm">
          El valor a horizonte combina: (a) cupones y amortizaciones cobrados antes del horizonte,
          sin reinversión (supuesto conservador); (b) el valor de venta del remanente descontado a
          la TIR de salida del escenario; (c) la senda CER del escenario; y (d) un MEP proyectado
          que sigue la inflación del escenario más una deriva real explícita. Los tres escenarios
          (pesimista / base / optimista) muestran sus supuestos en la propia tarjeta. Son
          ilustrativos: no son pronósticos.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold text-stone-100">Límites conocidos</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          <li>No se modelan bonos duales TAMAR ni dollar-linked en las propuestas (el piso fijo de
            los duales y la convención A3500 están implementados, pero preferimos no proponer lo
            que no podemos explicar simple).</li>
          <li>No se modela el riesgo de crédito más allá del precio de mercado (no hay
            probabilidades de default explícitas).</li>
          <li>Los precios tienen demora; en mercados volátiles el precio de ejecución puede diferir.</li>
          <li>No se contemplan impuestos personales (Bienes Personales, cedulares provinciales).</li>
        </ul>
      </section>
    </article>
  );
}

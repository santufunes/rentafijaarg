# RentaFijaArg

Propuestas de cartera de **renta fija argentina (BYMA)** para inversores minoristas.
Simple por delante, exacto por detrás: *built for retail with standards institutions expect*.

## Qué hace

Cuatro preguntas (monto, horizonte, moneda del objetivo, perfil) → una cartera concreta de
bonos y letras reales con:

- **Cantidades exactas en nominales enteros**, precio por línea y efectivo remanente.
- **TIR efectiva anual (act/365)** por instrumento y por segmento — en USD para hard-dollar,
  real (sobre CER) para BONCER, nominal para tasa fija.
- **Duración modificada**, calendario mensual de cupones y amortizaciones.
- **Escenarios a horizonte** (pesimista/base/optimista) con supuestos explícitos.
- Costos estimados (comisión + IVA + derechos de mercado) y guía de ejecución en cualquier ALyC.

## Estándares

- Especificaciones de cada instrumento (cupones step-up del canje 2020, amortizaciones,
  valores finales de LECAP/BONCAP, CER base de cada BONCER) relevadas de **fuentes primarias**
  y verificadas de forma cruzada; ver `research/`.
- Motor de valuación con liquidación T+1 hábil (calendario argentino), rezago CER t−10 hábiles,
  proyección CER con senda REM, solver de TIR por bisección con bracketing garantizado.
- **Tests golden**: la TIR del motor se valida contra los rendimientos publicados por el
  mercado (IAMC/brokers) — `npm test`.
- Datos en vivo: precios data912.com (~20 min de demora), CER/A3500 del BCRA, MEP implícito
  AL30/AL30D. Fallback a snapshot fechado si las fuentes no responden.

## Correr

```bash
npm install
npm run registry   # regenera el registro de instrumentos desde research/*.json
npm test           # tests del motor + golden vs mercado
npm run dev        # http://localhost:3000
```

## Disclaimers

Herramienta educativa. No es asesoramiento financiero ni recomendación de inversión (normativa
CNV). Precios con demora; verificá con tu ALyC antes de operar.

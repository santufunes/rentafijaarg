#!/usr/bin/env python3
"""Independent quant validation of soberanos_usd family (hard-dollar sovereigns, canje 2020).

Method:
- Cashflows per 100 VN original face, built from specs_soberanos_usd.json
  (step-up coupon schedule + amortization schedule, 30/360 semiannual => coupon = residual * rate/2).
- IRR = effective annual yield, actual/365: solve sum(cf/(1+r)^(days/365)) = dirty price (bisection).
- USD D-ticker prices are dirty USD per 100 VN original face (paridad * valor tecnico),
  cashflows in USD => consistent.
- Primary check: live data912 D-ticker close (2026-06-10) with settlement 2026-06-11 (T+1, next
  Argentine business day; 2026-06-11 is a regular Thursday, no holiday) vs golden IAMC TIR
  (2026-06-09 close, settlement 2026-06-10).
- Control check: IAMC's own dirty USD price with settlement 2026-06-10 (same inputs IAMC used)
  - isolates spec errors from one-day market moves.
- Secondary cross-check: bonistas.com 24hs TIR (same price snapshot as data912 close).
"""
import json, datetime as dt

BASE = "/Users/s/RentaFijaArg"
spec = json.load(open(f"{BASE}/research/specs_soberanos_usd.json"))
mc   = json.load(open(f"{BASE}/research/market_context.json"))
live = json.load(open("/tmp/d912_bonds.json"))
bon  = json.load(open(f"{BASE}/research/bonistas_api_bonds_snapshot_2026-06-10.json"))

TODAY = dt.date(2026, 6, 10)
SETTLE_LIVE = dt.date(2026, 6, 11)   # next ARG business day after 2026-06-10 (Thu, not a holiday)
SETTLE_IAMC = dt.date(2026, 6, 10)   # settlement used by IAMC informe (06-09 close, T+1)

live_px = {r["symbol"]: r.get("c") for r in live}
golden = {g["ticker"]: g for g in mc["goldenYields"]}
bon24 = {}
for r in bon:
    if r.get("settlement") == "24hs":
        bon24[r["ticker"]] = r

def d(s): return dt.date.fromisoformat(s)

def build_cashflows(inst, settle):
    """Remaining (date, cf) per 100 VN original face, strictly after settlement."""
    issue, mat = d(inst["issueDate"]), d(inst["maturity"])
    steps = sorted([(d(s["from"]), s["annualRatePct"]) for s in inst["couponStepUpSchedule"]])
    amort = {d(a["date"]): a["pctOfOriginalFace"] for a in inst["amortizationSchedule"]}
    # payment dates: Jan 9 / Jul 9 from first coupon to maturity
    pay_dates = []
    y, m = issue.year, issue.month
    cur = dt.date(2021, 7, 9) if d(inst["issueDate"]) == dt.date(2020, 9, 4) else None
    assert cur is not None
    while cur <= mat:
        pay_dates.append(cur)
        cur = dt.date(cur.year + (cur.month == 7), 1 if cur.month == 7 else 7, 9)
    assert pay_dates[-1] == mat, (inst["ticker"], pay_dates[-1], mat)
    cfs = []
    prev = issue
    outstanding = 100.0
    for pd_ in pay_dates:
        # rate in force during period [prev, pd_): latest step with from <= prev
        rate = max((r for f, r in steps if f <= prev), key=lambda x: 0)  # placeholder
        rate = [r for f, r in steps if f <= prev][-1]
        # 30/360 accrual: full semiannual period = 0.5; first long coupon accrued from issue
        if prev == issue:
            d1, d2 = issue, pd_
            days360 = (d2.year - d1.year) * 360 + (d2.month - d1.month) * 30 + (min(d2.day, 30) - min(d1.day, 30))
            frac = days360 / 360.0
        else:
            frac = 0.5
        coupon = outstanding * rate / 100.0 * frac
        am = amort.get(pd_, 0.0)
        if pd_ > settle:
            cfs.append((pd_, coupon + am))
        outstanding -= am
        prev = pd_
    assert abs(outstanding) < 1e-6, (inst["ticker"], outstanding)
    return cfs

def residual_asof(inst, asof):
    return 100.0 - sum(a["pctOfOriginalFace"] for a in inst["amortizationSchedule"] if d(a["date"]) <= asof)

def irr_eff_annual(price, cfs, settle):
    def pv(r):
        return sum(cf / (1.0 + r) ** ((dte - settle).days / 365.0) for dte, cf in cfs)
    lo, hi = -0.5, 3.0
    flo, fhi = pv(lo) - price, pv(hi) - price
    if flo * fhi > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        fm = pv(mid) - price
        if flo * fm <= 0:
            hi = mid
        else:
            lo, flo = mid, fm
    return (lo + hi) / 2

def mod_duration(price, cfs, settle, r):
    mac = sum(((dte - settle).days / 365.0) * cf / (1.0 + r) ** ((dte - settle).days / 365.0) for dte, cf in cfs) / price
    return mac / (1.0 + r)

results, details = [], []
for inst in spec["instruments"]:
    t = inst["ticker"]
    row = {"ticker": t}
    det = {"ticker": t, "name": inst["name"], "maturity": inst["maturity"]}
    # sanity: implied residual vs spec residual
    res = residual_asof(inst, TODAY)
    det["impliedResidual_2026-06-10"] = round(res, 6)
    det["specResidual"] = inst.get("residualValue")
    res_ok = abs(res - (inst.get("residualValue") or res)) < 0.01

    cfs_live = build_cashflows(inst, SETTLE_LIVE)
    det["remainingCashflowCount"] = len(cfs_live)
    det["next3Cashflows"] = [{"date": str(dd), "amountUSDper100VN": round(cf, 6)} for dd, cf in cfs_live[:3]]
    det["totalRemainingUSDper100VN"] = round(sum(cf for _, cf in cfs_live), 6)

    px_d = live_px.get(t + "D")
    det["livePriceUSD_data912_D"] = px_d
    det["livePriceARS_data912"] = live_px.get(t)
    comp_live = irr_eff_annual(px_d, cfs_live, SETTLE_LIVE) if px_d else None
    det["computedTIRPct_liveD_settle_2026-06-11"] = round(comp_live * 100, 4) if comp_live is not None else None
    if comp_live is not None:
        det["computedModifiedDurationYears_live"] = round(mod_duration(px_d, cfs_live, SETTLE_LIVE, comp_live), 4)

    g = golden.get(t)
    if g:
        ps = g["primarySource"]
        pub = ps["publishedTIRPct"]
        cfs_iamc = build_cashflows(inst, SETTLE_IAMC)
        comp_iamc = irr_eff_annual(ps["priceUsed"], cfs_iamc, SETTLE_IAMC)
        det["goldenSource"] = "IAMC/BYMA Informe Diario Titulos Publicos 2026-06-09 (settlement 2026-06-10)"
        det["goldenPriceUSDdirty"] = ps["priceUsed"]
        det["goldenPublishedTIRPct"] = pub
        det["goldenPublishedMDYears"] = ps.get("publishedMD")
        det["controlTIRPct_iamcPrice_settle_2026-06-10"] = round(comp_iamc * 100, 4) if comp_iamc is not None else None
        det["controlDeltaPp_vsIAMC"] = round(comp_iamc * 100 - pub, 4) if comp_iamc is not None else None
        if comp_iamc is not None:
            det["controlModifiedDurationYears"] = round(mod_duration(ps["priceUsed"], cfs_iamc, SETTLE_IAMC, comp_iamc), 4)
        computed = comp_live
        published_label = "IAMC"
    else:
        b = bon24.get(t)
        pub = round(b["tir"] * 100, 4) if b else None
        det["goldenSource"] = "bonistas.com /api/bonds snapshot 2026-06-10, settlement 24hs (secondary; no IAMC golden in market_context)"
        det["goldenPublishedTIRPct"] = pub
        det["goldenPublishedMDYears"] = round(b["modified_duration"], 4) if b else None
        computed = comp_live
        published_label = "bonistas"

    bb = bon24.get(t)
    det["bonistas24hsTIRPct"] = round(bb["tir"] * 100, 4) if bb else None
    det["bonistas24hsPriceARS"] = bb.get("last_price") if bb else None
    det["deltaPp_live_vs_bonistas"] = (round(comp_live * 100 - bb["tir"] * 100, 4)
                                       if (comp_live is not None and bb) else None)

    comp_pct = round(computed * 100, 4) if computed is not None else None
    delta = round(comp_pct - pub, 4) if (comp_pct is not None and pub is not None) else None
    ok = (delta is not None and abs(delta) <= 0.75 and res_ok)
    note_bits = []
    note_bits.append(f"published TIR source: {published_label}")
    if g:
        note_bits.append(f"computed {comp_pct}% from live D-ticker USD dirty price {px_d} (data912 2026-06-10 close, settle 2026-06-11) vs IAMC published {pub}% (06-09 close, settle 06-10); part of delta is the one-day market move")
        if det.get("controlDeltaPp_vsIAMC") is not None:
            note_bits.append(f"control on IAMC's own price/settlement reproduces published TIR within {det['controlDeltaPp_vsIAMC']:+.2f}pp")
    else:
        note_bits.append(f"computed {comp_pct}% from live D-ticker USD dirty price {px_d} vs bonistas 24hs published {pub}% (same price snapshot)")
    if not res_ok:
        note_bits.append(f"RESIDUAL MISMATCH: implied {res} vs spec {inst.get('residualValue')}")
    row.update({"publishedTIRPct": pub, "computedTIRPct": comp_pct, "deltaPp": delta,
                "pass": bool(ok), "note": "; ".join(note_bits)})
    det["pass"] = bool(ok)
    det["deltaPp"] = delta
    results.append(row)
    details.append(det)

out = {
    "family": "soberanos_usd",
    "asOf": "2026-06-10",
    "settlementUsed": {"liveComputation": str(SETTLE_LIVE), "iamcControl": str(SETTLE_IAMC),
                       "note": "2026-06-11 = next Argentine business day after 2026-06-10 (Thursday, no holiday)"},
    "method": {
        "irr": "effective annual, actual/365 exponent, bisection on sum(cf/(1+r)^(days/365)) = dirty price",
        "cashflows": "per 100 VN original face from spec step-up + amortization schedules; semiannual 30/360 => coupon = residual_at_period_start * rate/2",
        "priceBasis": "data912 D-ticker = dirty USD per 100 VN original face (paridad x valor tecnico); cross-checked = bonistas 24hs ARS price / implicit MEP",
        "tolerancePp": 0.75
    },
    "sources": [
        "https://data912.com/live/arg_bonds (fetched 2026-06-10)",
        "https://www.iamc.com.ar/Informe/InformeDiarioTitulosPublicos09062026/ (golden, via market_context.json)",
        "https://bonistas.com/api/bonds (snapshot research/bonistas_api_bonds_snapshot_2026-06-10.json)",
        "https://servicios.infoleg.gob.ar/infolegInternet/anexos/340000-344999/341150/dec676-4.pdf (spec terms)"
    ],
    "results": results,
    "details": details
}
with open(f"{BASE}/research/golden_soberanos_usd.json", "w") as f:
    json.dump(out, f, indent=1, ensure_ascii=False)

for r in results:
    print(f"{r['ticker']:6s} pub={r['publishedTIRPct']} comp={r['computedTIRPct']} delta={r['deltaPp']} pass={r['pass']}")
print()
for dd in details:
    extra = ""
    if dd.get("controlDeltaPp_vsIAMC") is not None:
        extra = f" controlDelta={dd['controlDeltaPp_vsIAMC']:+.3f}pp ctrlMD={dd.get('controlModifiedDurationYears')} pubMD={dd.get('goldenPublishedMDYears')}"
    print(f"{dd['ticker']:6s} resid {dd['impliedResidual_2026-06-10']} vs {dd['specResidual']} | dBon={dd['deltaPp_live_vs_bonistas']}{extra}")

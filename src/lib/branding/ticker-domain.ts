import { sanitizeSymbol } from "@/lib/utils";

export const TICKER_TO_DOMAIN: Record<string, string> = {
  AAPL: "apple.com",
  MSFT: "microsoft.com",
  NVDA: "nvidia.com",
  AMZN: "amazon.com",
  GOOGL: "google.com",
  GOOG: "google.com",
  META: "meta.com",
  TSLA: "tesla.com",
  NFLX: "netflix.com",
  INTC: "intel.com",
  AMD: "amd.com",
  AVGO: "broadcom.com",
  ORCL: "oracle.com",
  CRM: "salesforce.com",
  ADBE: "adobe.com",
  CSCO: "cisco.com",
  QCOM: "qualcomm.com",
  IBM: "ibm.com",
  NOW: "servicenow.com",
  SHOP: "shopify.com",
  JPM: "jpmorganchase.com",
  BAC: "bankofamerica.com",
  WFC: "wellsfargo.com",
  C: "citigroup.com",
  GS: "goldmansachs.com",
  MS: "morganstanley.com",
  BLK: "blackrock.com",
  V: "visa.com",
  MA: "mastercard.com",
  AXP: "americanexpress.com",
  PYPL: "paypal.com",
  UNH: "unitedhealthgroup.com",
  JNJ: "jnj.com",
  PFE: "pfizer.com",
  ABBV: "abbvie.com",
  MRK: "merck.com",
  LLY: "lilly.com",
  AMGN: "amgen.com",
  GILD: "gilead.com",
  BMY: "bms.com",
  WMT: "walmart.com",
  COST: "costco.com",
  KO: "coca-colacompany.com",
  PEP: "pepsico.com",
  PG: "pg.com",
  MCD: "mcdonalds.com",
  NKE: "nike.com",
  HD: "homedepot.com",
  LOW: "lowes.com",
  DIS: "disney.com",
  CMCSA: "corporate.comcast.com",
  T: "att.com",
  VZ: "verizon.com",
  TMUS: "t-mobile.com",
  XOM: "exxonmobil.com",
  CVX: "chevron.com",
  COP: "conocophillips.com",
  SLB: "slb.com",
  OXY: "oxy.com",
  CAT: "cat.com",
  DE: "deere.com",
  GE: "ge.com",
  BA: "boeing.com",
  UPS: "ups.com",
  LMT: "lockheedmartin.com",
  RTX: "rtx.com",
  HON: "honeywell.com",
  MMM: "3m.com",
  NEE: "nexteraenergy.com",
  DUK: "duke-energy.com",
  SO: "southerncompany.com",
  AEP: "aep.com",
  AMT: "americantower.com",
  PLD: "prologis.com",
  CCI: "crowncastle.com",
  LIN: "linde.com",
  SHW: "sherwin-williams.com",
  NTR: "nutrien.com"
};

function normalizeDomain(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

export function resolveDomainForTicker(
  ticker: string,
  websiteCandidates: Array<string | null | undefined> = []
): string | null {
  const symbol = sanitizeSymbol(ticker);
  const mapped = symbol ? TICKER_TO_DOMAIN[symbol] : undefined;

  if (mapped) {
    return normalizeDomain(mapped);
  }

  for (const candidate of websiteCandidates) {
    if (!candidate) continue;
    const domain = normalizeDomain(candidate);
    if (domain) return domain;
  }

  return null;
}

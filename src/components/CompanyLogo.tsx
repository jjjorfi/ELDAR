"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import Image from "next/image";
import {
  Building2,
  CircleHelp,
  Cpu,
  Factory,
  Flame,
  HeartPulse,
  Landmark,
  Radio,
  ShoppingBasket,
  Store,
  Zap
} from "lucide-react";

import { normalizeSectorName } from "@/lib/scoring/sector/config";

interface CompanyLogoProps {
  ticker: string;
  domain?: string | null;
  sector?: string | null;
  companyName?: string | null;
  className?: string;
  size?: number;
}

function iconForSector(rawSector: string | null | undefined): typeof CircleHelp {
  switch (normalizeSectorName(rawSector)) {
    case "Information Technology":
      return Cpu;
    case "Financials":
      return Landmark;
    case "Health Care":
      return HeartPulse;
    case "Consumer Discretionary":
      return ShoppingBasket;
    case "Communication Services":
      return Radio;
    case "Industrials":
      return Factory;
    case "Consumer Staples":
      return Store;
    case "Energy":
      return Flame;
    case "Utilities":
      return Zap;
    case "Real Estate":
      return Building2;
    case "Materials":
      return Factory;
    default:
      return CircleHelp;
  }
}

export function CompanyLogo({
  ticker,
  domain,
  sector,
  companyName,
  className,
  size = 32
}: CompanyLogoProps): JSX.Element {
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    setLogoFailed(false);
  }, [ticker, domain]);

  const logoUrl = useMemo(() => {
    if (!domain || logoFailed) {
      return null;
    }

    return `https://logos.hunter.io/${domain}`;
  }, [domain, logoFailed]);

  const Icon = useMemo(() => iconForSector(sector), [sector]);

  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center overflow-hidden border border-white/15 bg-[#1A1A1A] shadow-sm shadow-black/60",
        className
      )}
      style={{ width: size, height: size }}
      aria-label={`${companyName ?? ticker} logo`}
    >
      {logoUrl ? (
        <Image
          src={logoUrl}
          alt={`${companyName ?? ticker} logo`}
          className="h-full w-full object-contain p-1"
          width={size}
          height={size}
          sizes={`${size}px`}
          onError={() => setLogoFailed(true)}
          loading="lazy"
          unoptimized
        />
      ) : (
        <Icon className="h-4 w-4 text-[#999999]" aria-hidden="true" />
      )}
    </span>
  );
}

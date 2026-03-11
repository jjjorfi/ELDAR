export const SECTOR_FORWARD_PE_MEDIAN: Record<string, number> = {
  "Basic Materials": 17,
  CommunicationServices: 19,
  "Communication Services": 19,
  "Consumer Cyclical": 24,
  "Consumer Defensive": 21,
  Energy: 13,
  "Financial Services": 14,
  Healthcare: 22,
  Industrials: 21,
  "Real Estate": 28,
  Technology: 29,
  Utilities: 18
};

export const DEFAULT_FORWARD_PE_MEDIAN = 21;

export const SECTOR_QUARTILES: Record<
  string,
  {
    fcfYieldTop: number;
    fcfYieldBottom: number;
    revenueGrowthTop: number;
    revenueGrowthBottom: number;
  }
> = {
  "Basic Materials": { fcfYieldTop: 0.055, fcfYieldBottom: 0.018, revenueGrowthTop: 0.1, revenueGrowthBottom: -0.01 },
  "Communication Services": { fcfYieldTop: 0.045, fcfYieldBottom: 0.012, revenueGrowthTop: 0.11, revenueGrowthBottom: 0.01 },
  "Consumer Cyclical": { fcfYieldTop: 0.042, fcfYieldBottom: 0.01, revenueGrowthTop: 0.12, revenueGrowthBottom: 0.005 },
  "Consumer Defensive": { fcfYieldTop: 0.05, fcfYieldBottom: 0.018, revenueGrowthTop: 0.08, revenueGrowthBottom: -0.005 },
  Energy: { fcfYieldTop: 0.07, fcfYieldBottom: 0.02, revenueGrowthTop: 0.09, revenueGrowthBottom: -0.02 },
  "Financial Services": { fcfYieldTop: 0.045, fcfYieldBottom: 0.012, revenueGrowthTop: 0.1, revenueGrowthBottom: -0.01 },
  Healthcare: { fcfYieldTop: 0.04, fcfYieldBottom: 0.008, revenueGrowthTop: 0.1, revenueGrowthBottom: 0 },
  Industrials: { fcfYieldTop: 0.048, fcfYieldBottom: 0.015, revenueGrowthTop: 0.09, revenueGrowthBottom: -0.005 },
  "Real Estate": { fcfYieldTop: 0.052, fcfYieldBottom: 0.018, revenueGrowthTop: 0.06, revenueGrowthBottom: -0.01 },
  Technology: { fcfYieldTop: 0.032, fcfYieldBottom: 0.003, revenueGrowthTop: 0.14, revenueGrowthBottom: 0.03 },
  Utilities: { fcfYieldTop: 0.05, fcfYieldBottom: 0.02, revenueGrowthTop: 0.05, revenueGrowthBottom: -0.01 }
};

export const DEFAULT_QUARTILES = {
  fcfYieldTop: 0.045,
  fcfYieldBottom: 0.012,
  revenueGrowthTop: 0.1,
  revenueGrowthBottom: 0
};

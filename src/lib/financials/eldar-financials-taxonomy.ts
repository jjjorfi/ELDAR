const SIC_TO_GICS: Record<string, string> = {
  "1311": "Energy", "1381": "Energy", "1382": "Energy", "1389": "Energy", "2911": "Energy", "5171": "Energy",
  "1040": "Materials", "2600": "Materials", "2800": "Materials", "2810": "Materials", "2820": "Materials",
  "2860": "Materials", "3300": "Materials", "3310": "Materials",
  "3510": "Industrials", "3520": "Industrials", "3530": "Industrials", "3560": "Industrials", "3720": "Industrials",
  "3730": "Industrials", "4210": "Industrials", "4213": "Industrials", "4412": "Industrials", "4512": "Industrials",
  "7389": "Industrials",
  "2300": "Consumer Discretionary", "5511": "Consumer Discretionary", "5531": "Consumer Discretionary",
  "5651": "Consumer Discretionary", "5712": "Consumer Discretionary", "5731": "Consumer Discretionary",
  "7011": "Consumer Discretionary", "7812": "Consumer Discretionary",
  "2000": "Consumer Staples", "2010": "Consumer Staples", "2020": "Consumer Staples", "2080": "Consumer Staples",
  "2090": "Consumer Staples", "2100": "Consumer Staples", "5400": "Consumer Staples", "5411": "Consumer Staples",
  "2830": "Health Care", "2833": "Health Care", "2835": "Health Care", "2836": "Health Care", "3841": "Health Care",
  "3842": "Health Care", "8000": "Health Care", "8011": "Health Care", "8062": "Health Care",
  "6020": "Financials", "6022": "Financials", "6035": "Financials", "6099": "Financials", "6141": "Financials",
  "6199": "Financials", "6211": "Financials", "6282": "Financials", "6311": "Financials", "6331": "Financials",
  "6411": "Financials",
  "6500": "Real Estate", "6510": "Real Estate", "6512": "Real Estate", "6552": "Real Estate",
  "3571": "Information Technology", "3572": "Information Technology", "3576": "Information Technology",
  "3577": "Information Technology", "3661": "Information Technology", "3669": "Information Technology",
  "3672": "Information Technology", "3674": "Information Technology", "7370": "Information Technology",
  "7371": "Information Technology", "7372": "Information Technology", "7374": "Information Technology",
  "7379": "Information Technology",
  "4800": "Communication Services", "4812": "Communication Services", "4813": "Communication Services",
  "4833": "Communication Services", "4841": "Communication Services", "7375": "Communication Services",
  "4911": "Utilities", "4931": "Utilities", "4941": "Utilities"
};

export function sicToGics(sic: string): string {
  return SIC_TO_GICS[sic] ?? "Unknown";
}

export const XBRL_TAGS = {
  revenue: [
    "Revenues",
    "OperatingLeaseLeaseIncome",
    "RentalRevenue",
    "RentalIncome",
    "RevenueMineralSales",
    "OilAndGasRevenue",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet",
    "SalesRevenueGoodsNet",
    "RevenuesNetOfInterestExpense",
    "RealEstateRevenueNet",
    "HealthCareOrganizationRevenue",
    // Financial-sector fallbacks
    "InterestRevenueExpenseNet",
    "InterestIncomeExpenseNet",
    "PremiumsEarnedNet",
    "NetInvestmentIncome",
    "NoninterestIncome",
    // Utility-sector revenue tags
    "OperatingRevenues",
    "ElectricDomesticRegulatedRevenue",
    "GasDomesticRegulatedRevenue",
    "ElectricUtilityRevenue",
    "UtilityRevenue",
    "RegulatedAndUnregulatedOperatingRevenue"
  ],
  costOfRevenue: [
    "CostOfRevenue",
    "CostOfGoodsAndServicesSold",
    "CostOfGoodsSold",
    "CostOfServices",
    "CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization"
  ],
  grossProfit: ["GrossProfit"],
  researchDevelopment: ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"],
  sellingGeneralAdmin: ["SellingGeneralAndAdministrativeExpense", "GeneralAndAdministrativeExpense"],
  depreciationAmortization: [
    "DepreciationDepletionAndAmortization",
    "DepreciationAndAmortization",
    "Depreciation",
    "AmortizationOfIntangibleAssets"
  ],
  ebit: ["OperatingIncomeLoss"],
  interestExpense: ["InterestExpense", "InterestAndDebtExpense", "InterestExpenseDebt"],
  interestIncome: ["InvestmentIncomeInterest", "InterestAndDividendIncomeOperating", "InterestIncomeOperating"],
  incomeBeforeTax: [
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"
  ],
  incomeTaxExpense: ["IncomeTaxExpenseBenefit"],
  netIncome: ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss"],
  epsDiluted: ["EarningsPerShareDiluted", "EarningsPerShareBasic"],
  epsBasic: ["EarningsPerShareBasic"],
  sharesDiluted: ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingDiluted"],
  sharesBasic: ["WeightedAverageNumberOfSharesOutstandingBasic"],
  dividendsPerShare: ["CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid"],
  stockBasedCompensation: ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"],
  cash: [
    "Cash",
    "CashAndCashEquivalentsAtCarryingValue",
    "CashAndDueFromBanks",
    "CashCashEquivalentsAndShortTermInvestments",
    "CashAndCashEquivalentsAndShortTermInvestments",
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsIncludingDisposalGroupAndDiscontinuedOperations",
    "RestrictedCashAndCashEquivalents"
  ],
  shortTermInvestments: ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesCurrent"],
  accountsReceivable: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"],
  inventory: ["InventoryNet", "InventoryFinishedGoodsNetOfReserves", "FIFOInventoryAmount"],
  totalCurrentAssets: ["AssetsCurrent"],
  ppAndENet: [
    "PropertyPlantAndEquipmentNet",
    "PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization"
  ],
  ppAndEGross: ["PropertyPlantAndEquipmentGross"],
  goodwill: ["Goodwill"],
  intangibleAssets: ["FiniteLivedIntangibleAssetsNet", "IntangibleAssetsNetExcludingGoodwill"],
  totalAssets: ["Assets"],
  accountsPayable: ["AccountsPayableCurrent", "AccountsPayableAndAccruedLiabilitiesCurrent"],
  shortTermDebt: ["ShortTermBorrowings", "CommercialPaper", "NotesPayableCurrent"],
  currentPortionLongTermDebt: ["LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"],
  deferredRevenueCurrent: ["DeferredRevenueCurrent", "ContractWithCustomerLiabilityCurrent"],
  totalCurrentLiabilities: ["LiabilitiesCurrent"],
  longTermDebt: ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermDebt"],
  operatingLeaseLiability: ["OperatingLeaseLiabilityNoncurrent"],
  totalLiabilities: ["Liabilities"],
  retainedEarnings: ["RetainedEarningsAccumulatedDeficit"],
  treasuryStock: ["TreasuryStockValue", "TreasuryStockCommonValue"],
  stockholdersEquity: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  sharesOutstanding: ["CommonStockSharesOutstanding", "EntityCommonStockSharesOutstanding"],
  operatingCashFlow: [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"
  ],
  capex: [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "CapitalExpendituresIncurringObligation",
    "PaymentsForCapitalImprovements"
  ],
  acquisitions: ["PaymentsToAcquireBusinessesNetOfCashAcquired", "PaymentsToAcquireBusinessesAndInterestInAffiliates"],
  purchasesOfInvestments: [
    "PaymentsToAcquireAvailableForSaleSecurities",
    "PaymentsToAcquireInvestments",
    "PaymentsToAcquireMarketableSecurities"
  ],
  salesOfInvestments: [
    "ProceedsFromSaleOfAvailableForSaleSecurities",
    "ProceedsFromMaturitiesPrepaymentsAndCallsOfAvailableForSaleSecurities",
    "ProceedsFromSaleMaturityAndCollectionsOfInvestments"
  ],
  investingCashFlow: ["NetCashProvidedByUsedInInvestingActivities"],
  debtIssuance: ["ProceedsFromIssuanceOfLongTermDebt", "ProceedsFromDebtNetOfIssuanceCosts", "ProceedsFromLinesOfCredit"],
  debtRepayment: ["RepaymentsOfLongTermDebt", "RepaymentsOfDebt", "RepaymentsOfLinesOfCredit"],
  shareIssuance: ["ProceedsFromIssuanceOfCommonStock", "ProceedsFromStockOptionsExercised"],
  shareBuybacks: ["PaymentsForRepurchaseOfCommonStock", "TreasuryStockValueAcquiredCostMethod"],
  dividendsPaid: ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"],
  financingCashFlow: ["NetCashProvidedByUsedInFinancingActivities"]
} as const;

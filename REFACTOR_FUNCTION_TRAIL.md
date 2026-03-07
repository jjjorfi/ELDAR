# Refactor Function Trail

Purpose: machine-generated function trail for refactor continuity.
Generated: 2026-03-06T08:40:59.446Z
Scope: src/** and realtime-server/**

## realtime-server/adapters/state-adapter.js
- `createStateAdapter` (line 142) — No inline summary.

## realtime-server/config/shared-config.js
- `parseNumber` (line 22) — No inline summary.
- `parseCsv` (line 27) — No inline summary.
- `loadEnvFile` (line 34) — No inline summary.
- `loadRootEnv` (line 54) — No inline summary.
- `normalizeOrigin` (line 60) — No inline summary.
- `architectAlert` (line 70) — No inline summary.
- `getRealtimeConfig` (line 76) — No inline summary.

## realtime-server/server.js
- `normalizeBearerToken` (line 58) — No inline summary.
- `userRoom` (line 64) — No inline summary.
- `orgRoom` (line 68) — No inline summary.
- `main` (line 72) — No inline summary.

## src/app/api/context/route.ts
- `pruneContextCache` (line 47) — No inline summary.
- `round1` (line 55) — No inline summary.
- `latestBySymbol` (line 70) — No inline summary.
- `parseQueryScore` (line 90) — No inline summary.
- `parseLive` (line 96) — No inline summary.
- `refreshAnalysisScore` (line 100) — No inline summary.
- `GET` (line 123) — No inline summary.

## src/app/api/cron/mag7/route.ts
- `GET` (line 9) — No inline summary.

## src/app/api/earnings/route.ts
- `normalizeTickerSymbol` (line 62) — Normalizes ticker symbols across providers (e.g. BRK-B -> BRK.B).
- `toIsoDateString` (line 72) — Formats a Date into YYYY-MM-DD.
- `toDayEpoch` (line 82) — Converts a day string into UTC epoch ms.
- `outcomeFromSurprise` (line 96) — Classifies earnings outcome using surprise or derived values.
- `hasUpcomingInfo` (line 116) — Checks whether row has complete upcoming earnings info for UI.
- `hasPassedInfo` (line 126) — Checks whether row has complete passed earnings info for UI.
- `sortUpcoming` (line 159) — Sorts upcoming rows by nearest future date, then symbol.
- `sortPassed` (line 173) — Sorts passed rows by most recent date first, then symbol.
- `normalizeCompanyName` (line 187) — Normalizes human-readable company names.
- `uniqueEarningsRows` (line 199) — Removes duplicate earnings rows by symbol/date/period, preserving first occurrence.
- `normalizeFmpRows` (line 221) — Converts FMP earnings rows into normalized internal rows.
- `normalizeFinnhubRows` (line 241) — Converts Finnhub earnings rows into normalized internal rows.
- `filterSp500DatedRows` (line 262) — Filters to S&P 500 members and valid dated rows.
- `pickLatestCompletePassedRows` (line 273) — Picks latest passed earnings rows with complete info, rotating symbols when data is missing.
- `GET` (line 290) — No inline summary.

## src/app/api/health/route.ts
- `keyExists` (line 16) — No inline summary.
- `redactProviderEndpoint` (line 21) — No inline summary.
- `timedFetch` (line 35) — No inline summary.
- `safeToken` (line 75) — No inline summary.
- `sampleSymbol` (line 82) — No inline summary.
- `toEodhdSymbol` (line 88) — No inline summary.
- `GET` (line 92) — No inline summary.

## src/app/api/history/route.ts
- `GET` (line 11) — No inline summary.

## src/app/api/home/dashboard/route.ts
- `safeNumber` (line 100) — No inline summary.
- `yieldFromQuote` (line 109) — No inline summary.
- `asIsoDateFromYmd` (line 115) — No inline summary.
- `asIsoDateFromYmdWithTime` (line 122) — No inline summary.
- `asIsoDateFromMdy` (line 131) — No inline summary.
- `percentTone` (line 140) — No inline summary.
- `buildRegimeLabel` (line 147) — No inline summary.
- `buildRegimeSummary` (line 154) — No inline summary.
- `ratingBandFromScore` (line 171) — No inline summary.
- `latestAndPreviousBySymbol` (line 178) — No inline summary.
- `buildSignalMovers` (line 193) — No inline summary.
- `buildSectorRotation` (line 231) — No inline summary.
- `fetchQuotes` (line 262) — No inline summary.
- `fetchProviderFallbackQuote` (line 318) — No inline summary.
- `toStooqSymbol` (line 340) — No inline summary.
- `fetchStooqQuote` (line 354) — No inline summary.
- `fetchFredTenYearYieldQuote` (line 458) — No inline summary.
- `fetchCboeVixQuote` (line 506) — No inline summary.
- `mergeQuoteRows` (line 553) — No inline summary.
- `enrichMissingQuotes` (line 563) — No inline summary.
- `toYahooSymbol` (line 625) — No inline summary.
- `quoteValue` (line 629) — No inline summary.
- `buildMarketMovers` (line 642) — No inline summary.
- `buildBasePayload` (line 672) — No inline summary.
- `GET` (line 866) — No inline summary.

## src/app/api/indices/ytd/route.ts
- `parseCsvNumber` (line 52) — No inline summary.
- `downsample` (line 58) — No inline summary.
- `fetchStooqYtdRow` (line 74) — No inline summary.
- `fetchYahooYtdRow` (line 198) — No inline summary.
- `fetchRobustIndexRow` (line 283) — No inline summary.
- `GET` (line 297) — No inline summary.

## src/app/api/journal/entries/[id]/finalize/route.ts
- `resolveStatus` (line 21) — No inline summary.
- `POST` (line 26) — No inline summary.

## src/app/api/journal/entries/[id]/route.ts
- `GET` (line 41) — No inline summary.
- `PATCH` (line 69) — No inline summary.
- `DELETE` (line 104) — No inline summary.

## src/app/api/journal/entries/route.ts
- `parseStatus` (line 18) — No inline summary.
- `GET` (line 23) — No inline summary.
- `POST` (line 57) — No inline summary.

## src/app/api/macro/fred/route.ts
- `parseFredValue` (line 137) — No inline summary.
- `changeFromMode` (line 143) — No inline summary.
- `fetchIndicator` (line 172) — No inline summary.
- `GET` (line 238) — No inline summary.

## src/app/api/mag7/route.ts
- `GET` (line 13) — No inline summary.

## src/app/api/movers/route.ts
- `safeNumber` (line 37) — No inline summary.
- `safeString` (line 52) — No inline summary.
- `toYahooSymbol` (line 60) — No inline summary.
- `fromYahooSymbol` (line 64) — No inline summary.
- `normalizeRowSymbol` (line 76) — No inline summary.
- `mapQuoteRows` (line 83) — No inline summary.
- `sortBiggestMoves` (line 127) — No inline summary.
- `fetchYahooScreenerRows` (line 133) — No inline summary.
- `fetchYahooQuotes` (line 163) — No inline summary.
- `loadDirectory` (line 197) — No inline summary.
- `GET` (line 225) — No inline summary.

## src/app/api/portfolio/route.ts
- `normalizeHoldings` (line 40) — No inline summary.
- `GET` (line 51) — No inline summary.
- `POST` (line 77) — No inline summary.

## src/app/api/price/history/route.ts
- `toYahooSymbol` (line 42) — No inline summary.
- `parseRange` (line 47) — No inline summary.
- `parseRows` (line 54) — No inline summary.
- `computeChangePercent` (line 102) — No inline summary.
- `GET` (line 111) — No inline summary.

## src/app/api/rate/route.ts
- `isCachedAnalysisFresh` (line 28) — No inline summary.
- `refreshLatestPriceWithFallback` (line 36) — No inline summary.
- `POST` (line 75) — No inline summary.

## src/app/api/realtime/token/route.ts
- `GET` (line 33) — No inline summary.

## src/app/api/search/route.ts
- `fmpApiKey` (line 40) — No inline summary.
- `asString` (line 45) — No inline summary.
- `boundedLimit` (line 54) — No inline summary.
- `normalizeSearchRows` (line 79) — No inline summary.
- `rankSearchRows` (line 107) — No inline summary.
- `rankSP500Items` (line 135) — No inline summary.
- `dedupeBySymbol` (line 160) — No inline summary.
- `fallbackResults` (line 176) — No inline summary.
- `cloneResults` (line 212) — No inline summary.
- `getCachedResults` (line 216) — No inline summary.
- `setCachedResults` (line 226) — No inline summary.
- `GET` (line 237) — No inline summary.

## src/app/api/sectors/sentiment/route.ts
- `safeNumber` (line 30) — No inline summary.
- `classifySentiment` (line 35) — No inline summary.
- `fetchStooqSectorSentiment` (line 42) — No inline summary.
- `GET` (line 111) — No inline summary.

## src/app/api/watchlist/route.ts
- `GET` (line 17) — No inline summary.
- `POST` (line 40) — No inline summary.
- `DELETE` (line 85) — No inline summary.

## src/app/journal/page.tsx
- `isTypingTarget` (line 17) — No inline summary.
- `normalizeTicker` (line 48) — No inline summary.
- `formatPct` (line 52) — No inline summary.
- `statusTone` (line 57) — No inline summary.
- `setupTone` (line 63) — No inline summary.
- `ratingTone` (line 69) — No inline summary.
- `toNumberOrNull` (line 75) — No inline summary.
- `riskReward` (line 81) — No inline summary.
- `computeLiveReturn` (line 89) — No inline summary.
- `sortClosedEntries` (line 94) — No inline summary.
- `StatCard` (line 110) — No inline summary.

## src/app/layout.tsx
- `metadataBase` (line 11) — No inline summary.
- `PageVignette` (line 49) — No inline summary.

## src/app/macro/page.tsx
- `isTypingTarget` (line 12) — No inline summary.
- `formatValue` (line 30) — No inline summary.
- `formatChange` (line 40) — No inline summary.
- `changeTone` (line 47) — No inline summary.
- `XBrandIcon` (line 52) — No inline summary.
- `TelegramBrandIcon` (line 60) — No inline summary.

## src/app/sectors/page.tsx
- `isTypingTarget` (line 15) — No inline summary.
- `createDefaultSentimentMap` (line 57) — No inline summary.
- `sentimentLabel` (line 70) — No inline summary.
- `sentimentClass` (line 76) — No inline summary.
- `sentimentRank` (line 82) — No inline summary.
- `nextSortMode` (line 88) — No inline summary.
- `sortLabel` (line 100) — No inline summary.
- `extractTopTickers` (line 112) — No inline summary.
- `heatTileTone` (line 119) — No inline summary.
- `XBrandIcon` (line 125) — No inline summary.
- `TelegramBrandIcon` (line 133) — No inline summary.

## src/components/AppLeftSidebar.tsx
- `XBrandIcon` (line 36) — No inline summary.
- `TelegramBrandIcon` (line 44) — No inline summary.
- `SidebarIconButton` (line 52) — No inline summary.
- `AppLeftSidebar` (line 79) — No inline summary.

## src/components/CompanyLogo.tsx
- `iconForSector` (line 31) — No inline summary.
- `CompanyLogo` (line 60) — No inline summary.

## src/components/FactorBarChart.tsx
- `FactorBarChart` (line 24) — No inline summary.

## src/components/HeaderFeedStrip.tsx
- `HeaderFeedStrip` (line 11) — No inline summary.

## src/components/portfolio/CompositeScoreBreakdown.tsx
- `CompositeScoreBreakdown` (line 6) — No inline summary.

## src/components/portfolio/HoldingsAlphaTable.tsx
- `HoldingsAlphaTable` (line 8) — No inline summary.

## src/components/portfolio/index.tsx
- `PortfolioRatingPanel` (line 10) — No inline summary.

## src/components/portfolio/MethodologyDisclosure.tsx
- `MethodologyDisclosure` (line 1) — No inline summary.

## src/components/portfolio/PillarScoreGrid.tsx
- `statusIcon` (line 5) — No inline summary.
- `metricRows` (line 12) — No inline summary.
- `PillarScoreGrid` (line 21) — No inline summary.

## src/components/portfolio/PortfolioRatingHeader.tsx
- `renderStars` (line 26) — No inline summary.
- `clampScore` (line 30) — No inline summary.
- `pointAt` (line 34) — No inline summary.
- `polygonPoints` (line 44) — No inline summary.
- `PortfolioRatingHeader` (line 57) — No inline summary.

## src/components/portfolio/RiskCharts.tsx
- `toPath` (line 5) — No inline summary.
- `RiskCharts` (line 20) — No inline summary.

## src/components/share-cards/ComparisonCard.tsx
- `ComparisonBar` (line 7) — No inline summary.
- `StockColumn` (line 44) — No inline summary.
- `ComparisonCard` (line 66) — No inline summary.

## src/components/share-cards/PortfolioXRayCard.tsx
- `PortfolioXRayCard` (line 7) — No inline summary.

## src/components/share-cards/SignalCard.tsx
- `SignalCard` (line 7) — No inline summary.

## src/components/share-cards/utils.tsx
- `getRatingColor` (line 4) — No inline summary.
- `scoreCircle` (line 8) — No inline summary.

## src/components/SmoothScrollProvider.tsx
- `SmoothScrollProvider` (line 6) — No inline summary.

## src/components/StockDashboard.tsx
- `isTypingTarget` (line 248) — No inline summary.
- `EldarLogo` (line 254) — No inline summary.
- `NavigationBar` (line 294) — No inline summary.
- `XBrandIcon` (line 432) — No inline summary.
- `TelegramBrandIcon` (line 440) — No inline summary.
- `AnalysisRadarOverlay` (line 453) — No inline summary.
- `scoreLabel` (line 473) — No inline summary.
- `ratingToneByScore` (line 478) — No inline summary.
- `ratingLabelFromKey` (line 484) — No inline summary.
- `ratingLabelToneClass` (line 488) — No inline summary.
- `percentWithSign` (line 496) — No inline summary.
- `sectorHeatFromScore` (line 500) — No inline summary.
- `sectorHeatLabel` (line 506) — No inline summary.
- `toConfidenceLevel` (line 510) — No inline summary.
- `scoreFactorBucket` (line 516) — No inline summary.
- `buildComparisonFactorTuple` (line 528) — No inline summary.
- `HackingScore` (line 549) — No inline summary.
- `hackerizeText` (line 591) — No inline summary.
- `HackingValueText` (line 601) — No inline summary.
- `formatOptionalDecimal` (line 646) — No inline summary.
- `formatEarningsDate` (line 653) — No inline summary.
- `dedupeSearchResultsBySymbol` (line 660) — No inline summary.
- `sortMag7Cards` (line 676) — No inline summary.
- `buildSparklinePath` (line 683) — No inline summary.
- `polarToCartesian` (line 704) — No inline summary.
- `describeDonutSlicePath` (line 712) — No inline summary.
- `scoreBandColor` (line 735) — No inline summary.
- `mergeIndexRows` (line 744) — No inline summary.
- `extractFirstNumeric` (line 767) — No inline summary.
- `findFactorMatch` (line 775) — No inline summary.
- `findFactorMetric` (line 788) — No inline summary.
- `findFactorSignal` (line 797) — No inline summary.
- `factorSignalToneClass` (line 806) — No inline summary.
- `formatSignedPercent` (line 812) — No inline summary.
- `factorActionHint` (line 817) — No inline summary.
- `sectorRelativeState` (line 827) — No inline summary.
- `areMag7CardsEqual` (line 868) — No inline summary.
- `StockDashboard` (line 897) — No inline summary.

## src/components/ThemedClerkProvider.tsx
- `resolveThemeMode` (line 8) — No inline summary.
- `ThemedClerkProvider` (line 26) — No inline summary.

## src/components/ui/AnalysisPrimitives.tsx
- `SignalHero` (line 14) — No inline summary.
- `DriversList` (line 47) — No inline summary.
- `EvidenceAccordions` (line 86) — No inline summary.

## src/components/ui/DirtyTerminalPrimitives.tsx
- `CardPlain` (line 9) — No inline summary.
- `CardFramed` (line 17) — No inline summary.
- `CardNote` (line 25) — No inline summary.
- `EditorialDivider` (line 31) — No inline summary.
- `Chip` (line 35) — No inline summary.
- `TerminalButton` (line 43) — No inline summary.
- `TinyTooltip` (line 65) — No inline summary.
- `SkeletonBlock` (line 77) — No inline summary.
- `TableSurface` (line 81) — No inline summary.
- `ExpandableRowShell` (line 87) — No inline summary.

## src/components/ui/FintechPrimitives.tsx
- `TrustSignal` (line 13) — No inline summary.
- `ChartAsOf` (line 34) — No inline summary.
- `ConfidenceBadge` (line 42) — No inline summary.
- `EmptyState` (line 57) — No inline summary.
- `RatingCardSkeleton` (line 81) — No inline summary.
- `LinesSkeleton` (line 92) — No inline summary.

## src/components/ui/GlobalCommandPalette.tsx
- `isTypingTarget` (line 26) — No inline summary.
- `stashDashboardIntent` (line 32) — No inline summary.
- `GlobalCommandPalette` (line 60) — No inline summary.

## src/hooks/useSocket.ts
- `fetchRealtimeToken` (line 66) — No inline summary.
- `getOrCreateSocket` (line 87) — No inline summary.
- `disconnectSingletonIfUnused` (line 155) — No inline summary.
- `useSocket` (line 167) — No inline summary.

## src/lib/analyze.ts
- `analyzeStock` (line 5) — No inline summary.

## src/lib/api/auth-context.ts
- `getApiAuthContext` (line 24) — No inline summary.

## src/lib/api/responses.ts
- `mergeHeaders` (line 30) — No inline summary.
- `jsonError` (line 49) — No inline summary.
- `unauthorized` (line 60) — No inline summary.
- `badRequest` (line 64) — No inline summary.
- `notFound` (line 68) — No inline summary.
- `internalServerError` (line 72) — No inline summary.

## src/lib/api/route-security.ts
- `runRouteGuards` (line 18) — Runs shared route security gates in a single helper.

## src/lib/branding/ticker-domain.ts
- `normalizeDomain` (line 84) — No inline summary.
- `resolveDomainForTicker` (line 99) — No inline summary.

## src/lib/cache/redis.ts
- `redisEnabledByConfig` (line 9) — No inline summary.
- `redisUrl` (line 13) — No inline summary.
- `getClient` (line 17) — No inline summary.
- `keyName` (line 53) — No inline summary.
- `cacheSetJson` (line 70) — No inline summary.
- `cacheDelete` (line 83) — No inline summary.
- `redisCacheMode` (line 94) — No inline summary.

## src/lib/journal/store.ts
- `resolveLocalPath` (line 53) — No inline summary.
- `toNumberOrNull` (line 61) — No inline summary.
- `normalizeTicker` (line 66) — No inline summary.
- `normalizeTags` (line 70) — No inline summary.
- `computeOutcomeMetrics` (line 75) — No inline summary.
- `hydrateEntry` (line 97) — No inline summary.
- `reviewFromClosed` (line 106) — No inline summary.
- `readLocalStore` (line 190) — No inline summary.
- `writeLocalStore` (line 204) — No inline summary.
- `ensureDbReady` (line 209) — No inline summary.
- `mapDbRow` (line 249) — No inline summary.
- `buildEntry` (line 281) — No inline summary.
- `applyFilters` (line 317) — No inline summary.
- `assertOpenReady` (line 369) — No inline summary.
- `patchEntry` (line 378) — No inline summary.
- `createJournalEntry` (line 409) — No inline summary.
- `listJournalEntries` (line 440) — No inline summary.
- `getJournalEntryById` (line 469) — No inline summary.
- `updateJournalEntry` (line 492) — No inline summary.
- `setJournalEntryStatus` (line 536) — No inline summary.
- `softDeleteJournalEntry` (line 566) — No inline summary.

## src/lib/mag7.ts
- `cloneCards` (line 28) — No inline summary.
- `getDailyRefreshAnchor` (line 32) — No inline summary.
- `isRefreshDue` (line 43) — No inline summary.
- `sortCards` (line 53) — No inline summary.
- `fetchLatestQuoteWithFallback` (line 60) — No inline summary.
- `enrichCardsWithLatestQuotes` (line 92) — No inline summary.
- `refreshMag7Scores` (line 109) — No inline summary.
- `getHomepageMag7Scores` (line 134) — No inline summary.
- `refreshMag7ScoresIfDue` (line 151) — No inline summary.
- `getMag7LiveScores` (line 161) — No inline summary.

## src/lib/market/adapter-utils.ts
- `readEnvToken` (line 66) — Reads and trims a server-side env var value.
- `parseOptionalNumber` (line 78) — Converts unknown payload values into finite numbers.
- `parseOptionalString` (line 119) — Normalizes a non-empty string field.
- `toRecord` (line 134) — Safely narrows an unknown payload into a key/value record.
- `parseTimestampMs` (line 144) — Parses epoch-like timestamps (seconds/ms/ns) or ISO date strings into epoch milliseconds.
- `pickFirstNumber` (line 171) — Returns the first parseable numeric field from an object using ordered keys.
- `parseApiKeyList` (line 192) — Parses a potentially multi-key env value into validated token candidates.
- `setUrlSearchParams` (line 244) — Applies non-null query parameters to an existing URL.
- `getFetchSignal` (line 293) — Builds an AbortSignal with timeout when supported by the current runtime.

## src/lib/market/alpha-vantage.ts
- `alphaVantageApiKey` (line 37) — Reads the configured Alpha Vantage API key.
- `isAlphaVantageConfigured` (line 46) — Indicates whether Alpha Vantage integration is available.
- `parseNumeric` (line 56) — Parses numeric values from Alpha Vantage fields.
- `parseRatio` (line 66) — Parses and normalizes ratio values into decimal form.
- `fetchAlphaVantage` (line 78) — Calls Alpha Vantage endpoint with provided parameters.
- `parseOverview` (line 112) — Parses company/fundamental fields from the OVERVIEW endpoint.
- `scoreSentiment` (line 163) — Classifies sentiment from optional score/label pair.
- `parseNews` (line 185) — Parses and aggregates bullish/bearish counts from NEWS_SENTIMENT feed.
- `fetchAlphaVantageFallbackData` (line 256) — Fetches Alpha Vantage fallback fundamentals and sentiment.
- `fetchAlphaVantageDailyHistory` (line 294) — Fetches full adjusted daily time series and converts to sorted history points.
- `fetchAlphaVantageQuotePrice` (line 343) — Fetches only quote price from Alpha Vantage global quote endpoint.
- `parseQuoteTimestampMs` (line 354) — Converts Alpha "latest trading day" field to epoch milliseconds.
- `fetchAlphaVantageQuoteSnapshot` (line 375) — Fetches Alpha Vantage global quote snapshot with timestamp.

## src/lib/market/eodhd.ts
- `eodhdApiKey` (line 41) — Reads the configured EODHD API key from env.
- `isEodhdConfigured` (line 50) — Indicates whether EODHD integration is configured.
- `eodSymbol` (line 60) — Normalizes tickers to EODHD exchange format.
- `asNumber` (line 71) — Parses a numeric payload field from EODHD responses.
- `asString` (line 81) — Parses an optional non-empty string from payload values.
- `fromRecord` (line 91) — Safely narrows unknown payload objects.
- `extractQuotePrice` (line 138) — Extracts the best-effort quote price from EODHD quote payloads.
- `extractQuoteTimestampMs` (line 155) — Extracts quote timestamp in milliseconds from EODHD payloads.
- `emptyFallback` (line 172) — Creates the empty EODHD fallback payload shape.
- `fetchEodhdQuoteSnapshot` (line 196) — Fetches a lightweight EODHD quote snapshot.
- `fetchEodhdQuotePrice` (line 214) — Fetches only quote price from EODHD.
- `fetchEodhdFallbackData` (line 225) — Fetches EODHD fundamentals plus quote fallback fields for model inputs.

## src/lib/market/finnhub-metrics.ts
- `emptyMetrics` (line 29) — Creates an empty Finnhub metrics object when payload is missing/invalid.
- `toDecimalPercent` (line 60) — Converts Finnhub percent-style metrics into decimal form.
- `toAbsoluteShares` (line 75) — Normalizes share-count style fields that may be shipped in millions.
- `extractFinnhubMetrics` (line 89) — Extracts normalized metrics from Finnhub stock/metric payload.

## src/lib/market/finnhub.ts
- `getFinnhubApiKeys` (line 91) — Reads and parses Finnhub API keys from env, including concatenated-key paste mistakes.
- `isFinnhubConfigured` (line 109) — Indicates whether at least one Finnhub API key is configured.
- `toNumber` (line 159) — Parses a numeric value from unknown payload data.
- `toStringValue` (line 169) — Parses a non-empty string from unknown payload data.
- `firstNumeric` (line 180) — Finds the first numeric field from an ordered key list.
- `parseLatestEarnings` (line 190) — Parses latest earnings row from Finnhub earnings history payload.
- `parseOptionFlow` (line 241) — Parses options flow payload into aggregated put/call metrics.
- `recommendationSignal` (line 369) — Converts recommendation trends to a normalized sentiment signal.
- `newsSignal` (line 398) — Converts news sentiment payload to a normalized sentiment signal.
- `fetchFinnhubSentiment` (line 424) — Fetches combined recommendation and news sentiment signal.
- `fetchFinnhubOptionFlow` (line 449) — Fetches ticker-level options flow snapshot.
- `fetchFinnhubQuotePrice` (line 469) — Fetches current quote price.
- `fetchFinnhubQuoteSnapshot` (line 493) — Fetches quote snapshot with percent change and timestamp.
- `fetchFinnhubCompanyProfile` (line 521) — Fetches company profile fields used for sector/industry normalization.
- `fetchFinnhubMetrics` (line 568) — Fetches full Finnhub metrics payload used by metrics extractor.
- `fetchFinnhubInsiderSignal` (line 583) — Aggregates 90-day insider transaction flow into a net-share signal.
- `fetchFinnhubCompanyNews` (line 659) — Fetches recent company headlines from Finnhub.
- `fetchFinnhubLatestEarnings` (line 709) — Fetches most recent earnings rows and returns latest populated snapshot.
- `fetchFinnhubEarningsCalendar` (line 732) — Fetches earnings calendar entries for a date window.

## src/lib/market/fmp.ts
- `fmpApiKey` (line 50) — Reads the configured FMP API key.
- `asNumber` (line 60) — Parses numeric FMP fields.
- `asString` (line 70) — Parses optional non-empty string fields.
- `fetchSearchSymbol` (line 118) — Resolves canonical ticker identity via FMP search endpoint.
- `emptyFallback` (line 134) — Builds an empty fallback shape.
- `extractFirstPrice` (line 156) — Extracts first valid quote price from mixed payload shapes.
- `extractFirstQuoteSnapshot` (line 187) — Extracts first valid quote snapshot from array/object payloads.
- `fetchFmpQuoteSnapshot` (line 230) — Fetches best available FMP quote snapshot from stable then v3 quote endpoint.
- `fetchFmpQuotePrice` (line 254) — Fetches only current quote price from FMP.
- `fetchFmpFallbackData` (line 265) — Fetches fallback fundamentals used when primary providers are incomplete.
- `normalizeEarningsPeriod` (line 323) — Builds a quarter/year period label from mixed payload fields.
- `parseFmpEarningsRows` (line 345) — Parses mixed FMP earnings payload rows into a normalized shape.
- `fetchFmpEarningsCalendar` (line 394) — Fetches FMP earnings calendar rows for a date range.
- `fetchFmpEarningsHistory` (line 410) — Fetches historical earnings rows for a single symbol.

## src/lib/market/indicators.ts
- `sma` (line 6) — No inline summary.
- `ema` (line 13) — No inline summary.
- `rsi` (line 26) — No inline summary.
- `macd` (line 54) — No inline summary.
- `monthSeasonalityRatio` (line 75) — No inline summary.

## src/lib/market/macro.ts
- `parsePercentValue` (line 35) — No inline summary.
- `parseProbability` (line 48) — No inline summary.
- `normalizeKey` (line 68) — No inline summary.
- `toIsoDate` (line 72) — No inline summary.
- `walkUnknown` (line 97) — No inline summary.
- `collectObjects` (line 117) — No inline summary.
- `findMeetingDate` (line 138) — No inline summary.
- `findActionProbability` (line 158) — No inline summary.
- `normalizeTriplet` (line 197) — No inline summary.
- `toFedSignal` (line 228) — No inline summary.
- `buildFedOddsSnapshot` (line 246) — No inline summary.
- `tryParseJson` (line 269) — No inline summary.
- `parseFedOddsFromPayload` (line 304) — No inline summary.
- `fetchFedOddsFromCme` (line 342) — No inline summary.
- `fetchFedOddsFromTradingEconomics` (line 377) — No inline summary.
- `fetchFedOddsSignal` (line 441) — No inline summary.
- `fetchGdpSurprise` (line 455) — No inline summary.
- `median` (line 495) — No inline summary.
- `fetchGdpSurpriseFromFred` (line 504) — No inline summary.
- `fetchVixLevel` (line 545) — No inline summary.
- `fetchMarketPutCallRatio` (line 584) — No inline summary.
- `fetchMacroSignals` (line 632) — No inline summary.

## src/lib/market/massive.ts
- `parseNumber` (line 38) — Parses numeric values from Massive payloads.
- `getMassiveApiKeys` (line 47) — Parses and validates Massive API key candidates from environment config.
- `isMassiveConfigured` (line 65) — Indicates whether Massive/Polygon integration is configured.
- `normalizeContractType` (line 111) — Normalizes provider contract type values.
- `sumContractSide` (line 145) — Sums contract-side volume/open-interest from option snapshot rows.
- `parseDirectSnapshotFlow` (line 191) — Converts direct option snapshot payload into put/call flow metrics.
- `buildDirectSnapshotUrl` (line 239) — Builds direct option snapshot URL.
- `buildInitialChainUrl` (line 256) — Builds paged option-chain URL for a single contract side.
- `buildShortInterestUrl` (line 275) — Builds short-interest endpoint URL.
- `buildSnapshotTickerUrl` (line 293) — Builds stock snapshot URL.
- `buildLastTradeUrl` (line 308) — Builds last-trade endpoint URL.
- `extractMassiveQuotePrice` (line 321) — Extracts quote price from Massive snapshot/last-trade payloads.
- `extractMassiveQuoteTimestampMs` (line 365) — Extracts quote timestamp from Massive snapshot/last-trade payloads.
- `attachApiKey` (line 401) — Ensures paged URLs always include API key credentials.
- `aggregateChainSide` (line 419) — Aggregates a paged option-chain side into total volume/open-interest.
- `fetchMassiveOptionFlow` (line 484) — Fetches put/call flow from Massive/Polygon direct snapshot endpoints.
- `fetchMassiveShortInterest` (line 523) — Fetches latest short-interest record from Massive/Polygon.
- `fetchMassiveQuoteSnapshot` (line 585) — Fetches latest stock quote snapshot from Massive/Polygon.
- `fetchMassiveQuotePrice` (line 627) — Fetches only latest quote price from Massive/Polygon.

## src/lib/market/ny-session.ts
- `extractPart` (line 12) — No inline summary.
- `pad2` (line 16) — No inline summary.
- `dayKey` (line 20) — No inline summary.
- `nthWeekdayOfMonth` (line 24) — No inline summary.
- `lastWeekdayOfMonth` (line 30) — No inline summary.
- `observedFixedHoliday` (line 36) — No inline summary.
- `easterSunday` (line 51) — No inline summary.
- `nyseHolidayKeys` (line 69) — No inline summary.
- `isNyHoliday` (line 100) — No inline summary.
- `isNySessionOpen` (line 115) — No inline summary.

## src/lib/market/price-merge.ts
- `toFinitePrice` (line 45) — Validates that a candidate value is a finite positive price.
- `normalizeTimestampMs` (line 58) — Normalizes mixed timestamp units (sec/ms/ns) into epoch milliseconds.
- `median` (line 68) — Computes the statistical median of a numeric list.
- `weightedMedian` (line 84) — Computes weighted median from weighted observations.
- `relativeDiff` (line 113) — Computes absolute relative difference between two values.
- `mergePriceObservations` (line 124) — Merges multi-provider price observations with staleness/divergence/flash-crash protections.

## src/lib/market/sp500.ts
- `stripTags` (line 21) — No inline summary.
- `normalizeSymbol` (line 25) — No inline summary.
- `validSymbol` (line 29) — No inline summary.
- `uniqueSorted` (line 33) — No inline summary.
- `parseConstituentsTable` (line 37) — No inline summary.
- `extractCells` (line 66) — No inline summary.
- `parseConstituentsWithSectorFromHtml` (line 74) — No inline summary.
- `fetchFromFinnhub` (line 105) — No inline summary.
- `parseCsvColumnFirstValue` (line 145) — No inline summary.
- `parseCsvLine` (line 155) — No inline summary.
- `fetchFromDataHub` (line 187) — No inline summary.
- `fetchConstituentsWithSectorFromDataHub` (line 216) — No inline summary.
- `fetchSP500Symbols` (line 271) — No inline summary.
- `fetchSP500SectorMap` (line 305) — No inline summary.
- `parseWikiDirectory` (line 331) — No inline summary.
- `parseDataHubDirectory` (line 363) — No inline summary.
- `fetchSP500Directory` (line 400) — No inline summary.

## src/lib/market/top100.ts
- `getTop100Sp500Symbols` (line 106) — No inline summary.
- `isTop100Sp500Symbol` (line 110) — No inline summary.
- `getTop100Sp500SymbolSet` (line 114) — No inline summary.

## src/lib/market/yahoo.ts
- `filterCloses` (line 86) — Extracts finite close prices from history rows.
- `trailingReturn` (line 92) — No inline summary.
- `rollingZScore` (line 100) — No inline summary.
- `toMonthlyHistory` (line 120) — Collapses daily history to one row per month using the latest day in each month.
- `countRevisions` (line 145) — Counts upgrade/downgrade actions over the trailing 90-day window.
- `fromRawNumber` (line 175) — Extracts numeric values from Yahoo fields that may be plain numbers or { raw } wrappers.
- `fromRawString` (line 189) — Extracts string values from Yahoo fields that may be plain strings or { raw } wrappers.
- `extractDebtToEquity` (line 205) — Extracts and normalizes debt-to-equity ratio from multiple Yahoo modules.
- `hasOptionFlowData` (line 221) — Indicates whether options-flow structure contains usable values.
- `normalizeShareUnits` (line 236) — Converts raw share/volume fields that may be represented in millions into absolute shares.
- `fetchQuoteSummary` (line 273) — Fetches Yahoo quoteSummary payload with selected modules.
- `fetchChartHistory` (line 306) — Fetches Yahoo chart history and maps it to internal history points.
- `fetchYahooQuotePrice` (line 342) — Fetches latest quote price derived from Yahoo chart data.
- `fetchYahooQuoteSnapshot` (line 353) — Fetches Yahoo quote snapshot using recent daily chart history.
- `fetchMarketSnapshot` (line 376) — Builds the full normalized market snapshot by merging Yahoo with all fallback providers.

## src/lib/presentation.ts
- `getConfidence` (line 3) — No inline summary.
- `formatAsOfDate` (line 9) — No inline summary.
- `formatAsOfDateOnly` (line 16) — No inline summary.
- `isStale` (line 23) — No inline summary.

## src/lib/rating.ts
- `toRating` (line 85) — No inline summary.
- `ratingNote` (line 96) — No inline summary.
- `ratingShortNote` (line 100) — No inline summary.
- `ratingColor` (line 104) — No inline summary.
- `ratingDisplayLabel` (line 108) — No inline summary.

## src/lib/realtime/publisher.ts
- `publish` (line 34) — No inline summary.
- `publishWatchlistDelta` (line 75) — No inline summary.
- `publishMarketMovers` (line 92) — No inline summary.
- `publishIndicesYtd` (line 100) — No inline summary.
- `publishEarnings` (line 108) — No inline summary.
- `publishMag7` (line 116) — No inline summary.

## src/lib/scoring/engine.ts
- `r3` (line 33) — No inline summary.
- `factor` (line 35) — No inline summary.
- `missing` (line 55) — No inline summary.
- `sig` (line 61) — No inline summary.
- `posBands` (line 74) — No inline summary.
- `invBands` (line 79) — No inline summary.
- `scorePos` (line 84) — No inline summary.
- `scoreInv` (line 93) — No inline summary.
- `posLabel` (line 102) — No inline summary.
- `invLabel` (line 113) — No inline summary.
- `adjustedValuationP90` (line 134) — No inline summary.
- `epsFactor` (line 147) — No inline summary.
- `revenueFactor` (line 158) — No inline summary.
- `fcfFactor` (line 167) — No inline summary.
- `roicFactor` (line 176) — No inline summary.
- `peOrFfoFactor` (line 198) — No inline summary.
- `evEbitdaFactor` (line 214) — No inline summary.
- `debtFactor` (line 231) — No inline summary.
- `estRevFactor` (line 241) — No inline summary.
- `trendFactor` (line 252) — No inline summary.
- `rs52WeekFactor` (line 283) — 52-WEEK RELATIVE STRENGTH (v8 — replaces RSI-14)
- `zScore52WeekFactor` (line 311) — 52-WEEK PRICE Z-SCORE (v8 — new confirmatory factor)
- `shortInterestFactor` (line 329) — No inline summary.
- `insiderBuyFactor` (line 363) — INSIDER BUY RATIO (v8 — replaces PCR)
- `vixFactor` (line 381) — No inline summary.
- `buildEntryAlert` (line 402) — No inline summary.
- `quantCalibrateScore` (line 439) — No inline summary.
- `scoreSnapshot` (line 498) — No inline summary.

## src/lib/scoring/portfolio-engine.ts
- `clamp` (line 25) — No inline summary.
- `mean` (line 29) — No inline summary.
- `stdDev` (line 34) — No inline summary.
- `toReturns` (line 41) — No inline summary.
- `toCumulativeSeries` (line 54) — No inline summary.
- `computeMaxDrawdown` (line 62) — No inline summary.
- `cvar95` (line 74) — No inline summary.
- `scoreByRange` (line 82) — No inline summary.
- `toPortfolioRating` (line 88) — No inline summary.
- `starsFromPercentile` (line 96) — No inline summary.
- `normalizeHoldings` (line 104) — No inline summary.
- `buildFlags` (line 113) — No inline summary.
- `buildHoldingsTable` (line 134) — No inline summary.
- `formatPercent` (line 147) — No inline summary.
- `formatSignedPercent` (line 151) — No inline summary.
- `formatFixed` (line 155) — No inline summary.
- `scorePortfolio` (line 159) — No inline summary.

## src/lib/scoring/portfolio-gating.ts
- `applyConfidenceGates` (line 14) — No inline summary.

## src/lib/scoring/portfolio-peers.ts
- `normalizeSectorName` (line 3) — No inline summary.
- `classifyPeerGroup` (line 9) — No inline summary.

## src/lib/scoring/sector-config.ts
- `normalizeText` (line 345) — No inline summary.
- `directSectorMatch` (line 349) — No inline summary.
- `yahooIndustryMatch` (line 356) — No inline summary.
- `normalizeSectorName` (line 361) — No inline summary.
- `resolveSectorFromCandidates` (line 373) — No inline summary.
- `getSectorConfig` (line 383) — No inline summary.
- `getSectorWeights` (line 398) — Build sector-adjusted, normalised weights.
- `getGicsSectorMetadata` (line 422) — No inline summary.

## src/lib/security/admin.ts
- `constantTimeEqual` (line 12) — Compares two secrets in constant time.
- `bearerToken` (line 27) — Extracts a bearer token from Authorization header.
- `isAuthorizedAdminRequest` (line 44) — Checks whether request is authorized for privileged diagnostics.
- `requireAdminAccess` (line 66) — Enforces privileged access for sensitive endpoints in production.

## src/lib/security/guard.test.ts
- `restoreEnv` (line 14) — No inline summary.
- `request` (line 22) — No inline summary.

## src/lib/security/guard.ts
- `isGuardBlockedError` (line 28) — Type guard helper so route handlers can safely branch on guard failures.
- `readRateLimitRpm` (line 35) — Reads RPM config from env with a safe default.
- `readMaxBodyBytes` (line 46) — Reads request body-size ceiling from env with a safe default.
- `firstHeaderToken` (line 57) — Extracts a single token from comma-delimited forwarding headers.
- `clientIdentifier` (line 67) — Returns the best-effort client identifier for rate limiting.
- `isProtectedPath` (line 84) — Identifies production-only admin routes to prevent accidental public exposure.
- `pruneLimiterState` (line 97) — Cleans up stale limiter entries to keep memory bounded.
- `enforceGlobalRateLimit` (line 118) — Applies a global rolling per-IP RPM ceiling.
- `enforceBodySizeLimit` (line 152) — Enforces a small body-size ceiling to reduce trivial request-body DoS.

## src/lib/security/rate-limit.ts
- `firstHeaderToken` (line 23) — Extracts first token from a comma-delimited forwarding header.
- `clientKey` (line 38) — Extracts a best-effort client identifier from request headers.
- `prune` (line 56) — Prunes expired buckets to keep memory bounded.
- `enforceRateLimit` (line 77) — Applies a lightweight in-memory rate limit.

## src/lib/share/export-card.ts
- `buildShareFilename` (line 4) — No inline summary.
- `exportCard` (line 14) — No inline summary.

## src/lib/storage/index.ts
- `getCacheWindowMinutes` (line 17) — No inline summary.
- `resolveLocalDbPath` (line 22) — No inline summary.
- `analysisRedisKey` (line 37) — No inline summary.
- `portfolioRedisKey` (line 41) — No inline summary.
- `makeId` (line 45) — No inline summary.
- `normalizePersistedAnalysis` (line 49) — No inline summary.
- `shouldRefreshCachedAnalysis` (line 61) — No inline summary.
- `ensurePostgres` (line 79) — No inline summary.
- `readLocal` (line 141) — No inline summary.
- `writeLocal` (line 218) — No inline summary.
- `saveAnalysis` (line 223) — No inline summary.
- `getRecentAnalyses` (line 252) — No inline summary.
- `getCachedAnalysis` (line 278) — No inline summary.
- `getLastKnownPrice` (line 336) — No inline summary.
- `addToWatchlist` (line 369) — No inline summary.
- `removeFromWatchlist` (line 396) — No inline summary.
- `getWatchlist` (line 410) — No inline summary.
- `saveMag7Scores` (line 452) — No inline summary.
- `getMag7Scores` (line 481) — No inline summary.
- `savePortfolioSnapshot` (line 498) — No inline summary.
- `getLatestPortfolioSnapshot` (line 533) — No inline summary.

## src/lib/ui/command-palette.ts
- `isPaletteOpenShortcut` (line 8) — No inline summary.

## src/lib/ui/recent-tickers.test.ts
- `createMemoryStorage` (line 12) — No inline summary.

## src/lib/ui/recent-tickers.ts
- `sanitizeTicker` (line 4) — No inline summary.
- `getRecentTickers` (line 8) — No inline summary.
- `pushRecentTicker` (line 24) — No inline summary.

## src/lib/utils.ts
- `sanitizeSymbol` (line 1) — No inline summary.
- `safeNumber` (line 5) — No inline summary.
- `normalizeRatio` (line 17) — No inline summary.
- `formatPercent` (line 29) — No inline summary.
- `formatNumber` (line 34) — No inline summary.
- `formatPrice` (line 39) — No inline summary.
- `formatMarketCap` (line 47) — No inline summary.

# ELDAR Adapter Function Trail

Purpose: quick refactor trail for future sessions. This maps each market adapter function to one responsibility.
Scope: shared adapter utilities + Alpha Vantage, EODHD, FMP, Finnhub, Massive adapters.

Temporary patch note: `alpaca.ts`, `twelvedata.ts`, `google-finance.ts`, `marketstack.ts`, and `temporary-fallbacks.ts`
exist only to keep quote/history UX stable while premium data rates are still
pending. They should stay easy to remove later.

## `adapter-utils.ts`
- `readEnvToken(name)`: returns trimmed env token or null.
- `parseOptionalNumber(value, options)`: parses mixed string/number payload values into finite numbers.
- `parseOptionalString(value)`: trims and validates non-empty strings.
- `toRecord(value)`: narrows unknown payloads to object records safely.
- `parseTimestampMs(value)`: normalizes sec/ms/ns/ISO timestamps into epoch ms.
- `pickFirstNumber(record, keys, options)`: first-valid numeric picker across candidate keys.
- `parseApiKeyList(rawValue, options)`: parses delimiter/concatenation mistakes into validated key candidates.
- `setUrlSearchParams(url, params)`: sets query params while skipping null/undefined values.
- `fetchJsonOrNull(url, options)`: shared timed JSON fetch with optional ISR, headers, and payload validation.
- `getFetchSignal(timeoutMs)`: builds AbortSignal timeout when runtime supports it.

## `alpha-vantage.ts`
- `alphaVantageApiKey()`: reads provider key.
- `isAlphaVantageConfigured()`: provider-config check.
- `parseNumeric(raw)`: numeric parsing for Alpha payloads.
- `parseRatio(raw)`: ratio parsing normalized to decimal.
- `fetchAlphaVantage(params)`: authenticated Alpha request wrapper.
- `parseOverview(payload)`: maps OVERVIEW payload into fallback fundamentals.
- `scoreSentiment(score, label)`: converts sentiment score/label into POSITIVE/NEGATIVE/NEUTRAL.
- `parseNews(payload, symbol)`: aggregates bullish/bearish article counts.
- `fetchAlphaVantageFallbackData(symbol)`: returns combined fundamentals + sentiment fallback data.
- `fetchAlphaVantageDailyHistory(symbol)`: full adjusted daily close history.
- `fetchAlphaVantageQuotePrice(symbol)`: quote-price convenience wrapper.
- `parseQuoteTimestampMs(latestTradingDay)`: converts quote day into close-time epoch ms.
- `fetchAlphaVantageQuoteSnapshot(symbol)`: quote snapshot with price + timestamp.

## `eodhd.ts`
- `eodhdApiKey()`: reads provider key.
- `isEodhdConfigured()`: provider-config check.
- `eodSymbol(symbol)`: normalizes ticker into EODHD exchange format.
- `asNumber(value)`: numeric parser for EODHD values.
- `asString(value)`: string parser for EODHD values.
- `fromRecord(record)`: safe object narrowing helper.
- `fetchEodhd(path, params)`: authenticated EODHD request wrapper.
- `extractQuotePrice(payload)`: best-effort quote price extraction.
- `extractQuoteTimestampMs(payload)`: best-effort quote timestamp extraction.
- `emptyFallback()`: null-initialized fallback shape.
- `fetchEodhdQuoteSnapshot(symbol)`: quote snapshot with price + timestamp.
- `fetchEodhdQuotePrice(symbol)`: quote-price convenience wrapper.
- `fetchEodhdFallbackData(symbol)`: fundamentals + quote fallback payload.

## `fmp.ts`
- `fmpApiKey()`: reads provider key.
- `asNumber(value)`: numeric parser for FMP values.
- `asString(value)`: string parser for FMP values.
- `fetchFmp(baseUrl, path, params)`: authenticated FMP request wrapper.
- `fetchSearchSymbol(symbol)`: resolves canonical ticker identity.
- `emptyFallback()`: null-initialized fallback shape.
- `extractFirstPrice(payload)`: best first valid quote price from mixed payload shapes.
- `extractFirstQuoteSnapshot(payload)`: quote snapshot extraction from mixed payload shapes.
- `fetchFmpQuoteSnapshot(symbol)`: stable quote snapshot resolver.
- `fetchFmpQuotePrice(symbol)`: quote-price convenience wrapper.
- `fetchFmpFallbackData(symbol)`: profile + quote fallback fundamentals.
- `normalizeEarningsPeriod(row)`: builds period labels from quarter/year.
- `parseFmpEarningsRows(payload)`: normalizes earnings rows from mixed endpoints.
- `fetchFmpEarningsCalendar(from, to)`: date-window earnings rows.
- `fetchFmpEarningsHistory(symbol, limit)`: symbol earnings history rows.

## `finnhub.ts`
- `getFinnhubApiKeys()`: parses and validates Finnhub key candidates.
- `isFinnhubConfigured()`: provider-config check.
- `fetchFinnhub(endpoint, query)`: authenticated Finnhub request with key rotation.
- `toNumber(value)`: numeric parser for Finnhub values.
- `toStringValue(value)`: string parser for Finnhub values.
- `firstNumeric(record, keys)`: first-valid numeric picker across keys.
- `parseLatestEarnings(payload)`: latest earnings snapshot parser.
- `parseOptionFlow(payload)`: put/call ratio + call/put totals parser.
- `recommendationSignal(rows)`: recommendation trend to sentiment buckets.
- `newsSignal(news)`: news sentiment to sentiment buckets.
- `fetchFinnhubSentiment(symbol)`: combined recommendation + news sentiment.
- `fetchFinnhubOptionFlow(symbol)`: options flow snapshot.
- `fetchFinnhubQuotePrice(symbol)`: quote-price convenience wrapper.
- `fetchFinnhubQuoteSnapshot(symbol)`: quote snapshot with price, dp%, timestamp.
- `fetchFinnhubCompanyProfile(symbol)`: profile fields for sector/industry/share-outstanding.
- `fetchFinnhubMetrics(symbol)`: raw metric payload fetch.
- `fetchFinnhubInsiderSignal(symbol)`: 90-day insider net/buy/sell signal.
- `fetchFinnhubCompanyNews(symbol, days, limit)`: recent company headlines.
- `fetchFinnhubLatestEarnings(symbol)`: latest symbol earnings snapshot.
- `fetchFinnhubEarningsCalendar(from, to, symbols)`: earnings calendar rows.

## `massive.ts`
- `parseNumber(value)`: numeric parser for Massive/Polygon values.
- `getMassiveApiKeys()`: parses and validates Massive key candidates.
- `isMassiveConfigured()`: provider-config check.
- `normalizeContractType(raw)`: normalizes contract side into call/put.
- `fetchMassiveJson(url)`: Massive JSON request wrapper.
- `sumContractSide(rows)`: side-level volume/open-interest aggregation.
- `parseDirectSnapshotFlow(payload)`: direct snapshot flow parser.
- `buildDirectSnapshotUrl(baseUrl, symbol, apiKey)`: direct options snapshot URL builder.
- `buildInitialChainUrl(baseUrl, symbol, contractType, apiKey)`: paged chain URL builder.
- `buildShortInterestUrl(baseUrl, symbol, apiKey)`: short-interest URL builder.
- `buildSnapshotTickerUrl(baseUrl, symbol, apiKey)`: stock snapshot URL builder.
- `buildLastTradeUrl(baseUrl, symbol, apiKey)`: last-trade URL builder.
- `extractMassiveQuotePrice(payload)`: quote-price extraction from mixed payload shapes.
- `extractMassiveQuoteTimestampMs(payload)`: quote timestamp extraction.
- `attachApiKey(nextUrl, baseUrl, apiKey)`: ensures paged URLs keep auth key.
- `aggregateChainSide(baseUrl, symbol, apiKey, contractType)`: paged call/put aggregation.
- `fetchMassiveOptionFlow(symbol)`: options flow with direct-then-paged fallback.
- `fetchMassiveShortInterest(symbol)`: latest short-interest snapshot.
- `fetchMassiveQuoteSnapshot(symbol)`: quote snapshot with fallback between endpoints.
- `fetchMassiveQuotePrice(symbol)`: quote-price convenience wrapper.

## `alpaca.ts`
- `isAlpacaConfigured()`: provider-config check.
- `fetchAlpacaQuoteSnapshot(symbol)`: temporary quote snapshot fallback from Alpaca snapshots.
- `fetchAlpacaDailyHistory(symbol, lookbackDays)`: temporary daily history fallback from Alpaca bars.

## `twelvedata.ts`
- `isTwelveDataConfigured()`: provider-config check.
- `fetchTwelveDataQuoteSnapshot(symbol)`: temporary quote fallback with price, dp%, timestamp.
- `fetchTwelveDataDailyHistory(symbol, outputSize)`: temporary daily history fallback.

## `marketstack.ts`
- `isMarketstackConfigured()`: provider-config check.
- `fetchMarketstackQuoteSnapshot(symbol)`: temporary EOD quote fallback.
- `fetchMarketstackDailyHistory(symbol, lookbackDays)`: temporary EOD history fallback.

## `google-finance.ts`
- `fetchGoogleFinanceQuoteSnapshot(symbol)`: temporary scraped quote fallback from Google Finance pages.

## `temporary-fallbacks.ts`
- `fetchTemporaryQuoteFallback(symbol)`: centralized temporary quote bridge.
- `fetchTemporaryHistoryFallback(symbol, options)`: centralized temporary history bridge.

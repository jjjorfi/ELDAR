import { safeNumber } from "@/lib/utils";

/**
 * Options for numeric parsing from mixed string/number payloads.
 */
export interface ParseNumberOptions {
  /** Removes commas before parsing (e.g. "1,234.5"). */
  allowCommas?: boolean;
  /** Removes percent signs before parsing (e.g. "12.4%"). */
  allowPercent?: boolean;
  /** Additional lowercase literals treated as null values. */
  nullLiterals?: string[];
}

/**
 * Controls how concatenated API keys are split when users paste multiple keys without delimiters.
 */
export interface ConcatenatedTokenOptions {
  /** Minimum raw length required before attempting chunk splitting. */
  minRawLength: number;
  /** Candidate chunk sizes to try in order. */
  chunkLengths: number[];
  /** Optional validation pattern for the full raw string before splitting. */
  rawPattern?: RegExp;
}

/**
 * Options used to parse API keys from environment variables.
 */
export interface ApiKeyParseOptions {
  /** Minimum accepted key length. */
  minLength: number;
  /** Validation pattern for each token. */
  tokenPattern: RegExp;
  /** Optional concatenated-token handling configuration. */
  concatenated?: ConcatenatedTokenOptions;
}

const DEFAULT_NULL_LITERALS = new Set(["", "-", "none", "n/a", "na", "null", "undefined"]);

/**
 * Reads and trims a server-side env var value.
 *
 * @param name Environment variable name.
 * @returns Trimmed value when present, otherwise null.
 */
export function readEnvToken(name: string): string | null {
  const value = (process.env[name] ?? "").trim();
  return value.length > 0 ? value : null;
}

/**
 * Converts unknown payload values into finite numbers.
 *
 * @param value Raw value from upstream payload.
 * @param options Parsing options for separators/null literals.
 * @returns Parsed finite number or null.
 */
export function parseOptionalNumber(value: unknown, options: ParseNumberOptions = {}): number | null {
  if (typeof value === "number") {
    return safeNumber(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  let cleaned = value.trim();
  if (!cleaned) {
    return null;
  }

  if (options.allowCommas) {
    cleaned = cleaned.replace(/,/g, "");
  }

  if (options.allowPercent) {
    cleaned = cleaned.replace(/%/g, "");
  }

  const nullLiterals = new Set(DEFAULT_NULL_LITERALS);
  for (const literal of options.nullLiterals ?? []) {
    nullLiterals.add(literal.toLowerCase());
  }

  if (nullLiterals.has(cleaned.toLowerCase())) {
    return null;
  }

  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Normalizes a non-empty string field.
 *
 * @param value Raw value.
 * @returns Trimmed string or null.
 */
export function parseOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Safely narrows an unknown payload into a key/value record.
 *
 * @param value Unknown input.
 * @returns Object record, or empty record when not object-like.
 */
export function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Parses epoch-like timestamps (seconds/ms/ns) or ISO date strings into epoch milliseconds.
 *
 * @param value Raw timestamp input.
 * @returns Epoch milliseconds or null when not parseable.
 */
export function parseTimestampMs(value: unknown): number | null {
  const numeric = parseOptionalNumber(value, { allowCommas: true });

  if (numeric !== null && numeric > 0) {
    if (numeric > 1e15) return Math.round(numeric / 1e6); // ns
    if (numeric > 1e12) return Math.round(numeric); // ms
    if (numeric > 1e9) return Math.round(numeric * 1000); // sec
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

/**
 * Returns the first parseable numeric field from an object using ordered keys.
 *
 * @param record Object payload.
 * @param keys Ordered candidate keys.
 * @param options Numeric parser options.
 * @returns First finite numeric value or null.
 */
export function pickFirstNumber(
  record: Record<string, unknown>,
  keys: string[],
  options: ParseNumberOptions = {}
): number | null {
  for (const key of keys) {
    const parsed = parseOptionalNumber(record[key], options);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

/**
 * Parses a potentially multi-key env value into validated token candidates.
 *
 * @param rawValue Raw env var string.
 * @param options Parsing and validation options.
 * @returns Unique valid API key candidates.
 */
export function parseApiKeyList(rawValue: string, options: ApiKeyParseOptions): string[] {
  const raw = rawValue.trim();
  if (!raw) {
    return [];
  }

  const splitByDelimiters = raw
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  let tokens = splitByDelimiters.length > 1 ? splitByDelimiters : [raw];

  if (splitByDelimiters.length <= 1 && options.concatenated) {
    const { minRawLength, chunkLengths, rawPattern } = options.concatenated;
    const allowSplit = raw.length >= minRawLength && (!rawPattern || rawPattern.test(raw));

    if (allowSplit) {
      for (const chunkLength of chunkLengths) {
        if (raw.length % chunkLength !== 0) {
          continue;
        }

        const chunked: string[] = [];
        for (let index = 0; index < raw.length; index += chunkLength) {
          chunked.push(raw.slice(index, index + chunkLength));
        }

        if (chunked.length > 1) {
          tokens = [raw, ...chunked];
          break;
        }
      }
    }
  }

  return Array.from(
    new Set(
      tokens
        .map((token) => token.trim())
        .filter((token) => token.length >= options.minLength)
        .filter((token) => options.tokenPattern.test(token))
    )
  );
}

/**
 * Builds an AbortSignal with timeout when supported by the current runtime.
 * Returns undefined on unsupported runtimes so fetch callers can degrade safely.
 *
 * @param timeoutMs Timeout in milliseconds.
 * @returns AbortSignal timeout instance or undefined.
 */
export function getFetchSignal(timeoutMs: number): AbortSignal | undefined {
  const normalized = Number.isFinite(timeoutMs) ? Math.max(1, Math.floor(timeoutMs)) : 0;
  if (normalized <= 0) {
    return undefined;
  }

  const signalCtor = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal };
  if (typeof signalCtor.timeout === "function") {
    return signalCtor.timeout(normalized);
  }

  return undefined;
}

import type { SP500DirectoryEntry } from "@/lib/market/universe/sp500";

export type SP500DirectoryMap = Record<string, SP500DirectoryEntry>;

export function symbolVariants(symbol: string): string[] {
  const upper = symbol.trim().toUpperCase();
  if (!upper) return [];
  return Array.from(
    new Set([upper, upper.replace(/\./g, "-"), upper.replace(/-/g, ".")].filter((value) => value.length > 0))
  );
}

export function resolveSp500DirectorySymbol(symbol: string, directory: SP500DirectoryMap): string | null {
  for (const candidate of symbolVariants(symbol)) {
    if (directory[candidate]) {
      return candidate;
    }
  }
  return null;
}

export function buildSp500SymbolUniverse(directory: SP500DirectoryMap): Set<string> {
  const symbols = new Set<string>();
  for (const key of Object.keys(directory)) {
    for (const candidate of symbolVariants(key)) {
      symbols.add(candidate);
    }
  }
  return symbols;
}

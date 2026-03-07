import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { getRecentTickers, pushRecentTicker, RECENT_TICKERS_KEY } from "@/lib/ui/recent-tickers";

interface MemoryStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  clear: () => void;
}

function createMemoryStorage(): MemoryStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    clear: () => {
      store.clear();
    }
  };
}

const originalWindow = globalThis.window;

beforeEach(() => {
  const localStorage = createMemoryStorage();
  Object.defineProperty(globalThis, "window", {
    value: { localStorage },
    configurable: true,
    writable: true
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    value: originalWindow,
    configurable: true,
    writable: true
  });
});

describe("recent tickers", () => {
  it("stores unique symbols in latest-first order", () => {
    pushRecentTicker("aapl");
    pushRecentTicker("msft");
    pushRecentTicker("aapl");

    assert.deepEqual(getRecentTickers(), ["AAPL", "MSFT"]);
  });

  it("caps recent list to 10", () => {
    for (let i = 0; i < 14; i += 1) {
      pushRecentTicker(`TST${i}`);
    }
    const list = getRecentTickers();
    assert.equal(list.length, 10);
    assert.equal(list[0], "TST13");
  });

  it("ignores malformed payloads", () => {
    globalThis.window.localStorage.setItem(RECENT_TICKERS_KEY, "{bad json");
    assert.deepEqual(getRecentTickers(), []);
  });
});

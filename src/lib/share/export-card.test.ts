import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildShareFilename } from "@/lib/share/export-card";

describe("buildShareFilename", () => {
  it("normalizes and appends suffix", () => {
    assert.equal(buildShareFilename(" NVDA Signal "), "nvda-signal-eldar.png");
  });

  it("removes unsafe symbols", () => {
    assert.equal(buildShareFilename("AAPL vs MSFT #1"), "aapl-vs-msft-1-eldar.png");
  });

  it("falls back to default", () => {
    assert.equal(buildShareFilename("   "), "share-eldar.png");
  });
});

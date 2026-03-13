import assert from "node:assert/strict";
import test from "node:test";

import {
  isUsableIndexYtdRow,
  isUsableIndicesYtdPayload,
  selectPreferredIndexYtdRow,
  type IndexYtdRow,
  type IndicesYtdPayload
} from "@/lib/home/indices-ytd";

function row(overrides: Partial<IndexYtdRow> = {}): IndexYtdRow {
  return {
    code: "US500",
    label: "US500",
    symbol: "^GSPC",
    current: 6123.45,
    ytdChangePercent: 8.4,
    asOf: "2026-03-12",
    points: [6000, 6050, 6123.45],
    pointDates: ["2026-01-02", "2026-02-10", "2026-03-12"],
    ...overrides
  };
}

function payload(indices: IndexYtdRow[]): IndicesYtdPayload {
  return { indices };
}

test("isUsableIndexYtdRow accepts fully populated rows", () => {
  assert.equal(isUsableIndexYtdRow(row()), true);
});

test("isUsableIndexYtdRow rejects rows with missing current value or mismatched samples", () => {
  assert.equal(isUsableIndexYtdRow(row({ current: null })), false);
  assert.equal(isUsableIndexYtdRow(row({ pointDates: ["2026-01-02"] })), false);
  assert.equal(isUsableIndexYtdRow(row({ points: [] })), false);
});

test("selectPreferredIndexYtdRow uses the primary row when it is usable", () => {
  const primary = row({ symbol: "^NDX", label: "US100" });
  const fallback = row({ symbol: "^RUT", label: "RUT" });
  const empty = row({ current: null, points: [], pointDates: [] });

  assert.deepEqual(selectPreferredIndexYtdRow(primary, fallback, empty), primary);
});

test("selectPreferredIndexYtdRow falls back when the primary row is incomplete", () => {
  const primary = row({ current: null, points: [], pointDates: [] });
  const fallback = row({ symbol: "^RUT", label: "RUT" });
  const empty = row({ current: null, points: [], pointDates: [] });

  assert.deepEqual(selectPreferredIndexYtdRow(primary, fallback, empty), fallback);
});

test("isUsableIndicesYtdPayload requires all index rows to be usable", () => {
  assert.equal(
    isUsableIndicesYtdPayload(
      payload([
        row({ code: "US2000", label: "RUT", symbol: "^RUT" }),
        row({ code: "US100", label: "US100", symbol: "^NDX" }),
        row({ code: "US500", label: "US500", symbol: "^GSPC" })
      ])
    ),
    true
  );

  assert.equal(
    isUsableIndicesYtdPayload(
      payload([
        row({ code: "US2000", label: "RUT", symbol: "^RUT" }),
        row({ code: "US100", label: "US100", symbol: "^NDX", current: null }),
        row({ code: "US500", label: "US500", symbol: "^GSPC" })
      ])
    ),
    false
  );
});

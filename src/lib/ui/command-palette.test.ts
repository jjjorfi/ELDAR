import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isPaletteOpenShortcut } from "@/lib/ui/command-palette";

describe("isPaletteOpenShortcut", () => {
  it("accepts cmd+k", () => {
    assert.equal(isPaletteOpenShortcut({ key: "k", metaKey: true }), true);
  });

  it("accepts ctrl+k", () => {
    assert.equal(isPaletteOpenShortcut({ key: "K", ctrlKey: true }), true);
  });

  it("rejects plain k", () => {
    assert.equal(isPaletteOpenShortcut({ key: "k" }), false);
  });

  it("rejects alt modifiers", () => {
    assert.equal(isPaletteOpenShortcut({ key: "k", ctrlKey: true, altKey: true }), false);
  });
});

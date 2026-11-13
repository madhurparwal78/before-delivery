import { describe, expect, it } from "vitest";
import { countText, normalise } from "../src/domain/text";
import { checkSheetBytes, dimensionsInRange } from "../src/domain/sheets";
import { foldText, nameCompare, timeSent } from "../src/domain/services";
import { jsonDepth } from "../src/domain/json";
import { submitWait } from "../src/server/rate";

describe("code-point counting", () => {
  it("counts combining sequences after NFC", () => {
    expect(countText("e\u0301")).toBe(1);
  });

  it("counts single emoji as one", () => {
    expect(countText("\u{1F37A}")).toBe(1);
  });

  it("counts regional indicators as two", () => {
    expect(countText("\u{1F1EC}\u{1F1E7}")).toBe(2);
  });

  it("counts a ZWJ family as five", () => {
    expect(countText("\u{1F468}\u200D\u{1F469}\u200D\u{1F467}")).toBe(5);
  });

  it("counts a sequence with no composed form as its parts", () => {
    expect(countText("q\u0307")).toBe(2);
  });

  it("trims before counting", () => {
    expect(countText("  bjork  ")).toBe(5);
  });

  it("counts sixteen families in the search field as 80", () => {
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    expect(countText(family.repeat(16))).toBe(80);
    expect(countText(family.repeat(16) + "x")).toBe(81);
  });
});

describe("text normalisation", () => {
  it("composes and trims", () => {
    expect(normalise("  cafe\u0301  ")).toBe("café");
  });
});

describe("sheet content checks", () => {
  it("accepts a valid PNG header", () => {
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 200, 0, 0, 0, 200]);
    const result = checkSheetBytes("image/png", png);
    expect(result.ok).toBe(true);
    expect(result.width).toBe(200);
    expect(result.height).toBe(200);
  });

  it("refuses bytes that do not match the declared type", () => {
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 200, 0, 0, 0, 200]);
    const result = checkSheetBytes("image/jpeg", png);
    expect(result.ok).toBe(false);
  });

  it("reads a baseline JPEG start of frame", () => {
    const jpeg = Uint8Array.from([
      255, 216, 255, 224, 0, 2, 0, 0,
      255, 192, 0, 11, 8, 0, 200, 1, 200, 3,
    ]);
    const result = checkSheetBytes("image/jpeg", jpeg);
    expect(result.ok).toBe(true);
    expect(result.width).toBe(456);
    expect(result.height).toBe(200);
  });

  it("applies the dimension range", () => {
    expect(dimensionsInRange(200, 200)).toBe(true);
    expect(dimensionsInRange(199, 400)).toBe(false);
    expect(dimensionsInRange(4000, 4000)).toBe(true);
    expect(dimensionsInRange(4001, 200)).toBe(false);
  });
});

describe("search folding", () => {
  it("folds case and accents", () => {
    expect(foldText("Björk")).toBe("bjork");
  });

  it("treats search text literally", () => {
    expect(foldText("50%")).toBe("50%");
  });
});

describe("table order", () => {
  it("sorts by total then name code points", () => {
    expect(nameCompare("Aardvark", "Zebra")).toBeLessThan(0);
    expect(nameCompare("Zebra", "Aardvark")).toBeGreaterThan(0);
    expect(nameCompare("Same", "Same")).toBe(0);
  });
});

describe("archive time sent", () => {
  it("formats the UTC hour, minute and second", () => {
    expect(timeSent("2026-11-05T20:14:07.381Z")).toBe("20:14:07");
  });
});

describe("json depth", () => {
  it("counts the outer object as level 1", () => {
    expect(jsonDepth({ query: "x" })).toBe(2);
  });

  it("counts nested containers", () => {
    expect(jsonDepth({ a: { b: { c: { d: 1 } } } })).toBe(5);
    expect(jsonDepth({ a: { b: { c: { d: { e: 1 } } } } })).toBe(6);
  });
});

describe("submit wait", () => {
  it("returns the seconds until the oldest counted submit turns 60", () => {
    const now = new Date("2026-11-07T20:00:00Z");
    const oldest = new Date("2026-11-07T19:59:31Z");
    expect(submitWait([oldest], now)).toBe(31);
  });

  it("is at least one second", () => {
    const now = new Date("2026-11-07T20:00:00Z");
    const oldest = new Date("2026-11-07T19:59:00.500Z");
    expect(submitWait([oldest], now)).toBe(1);
  });
});

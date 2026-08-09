import { describe, expect, it } from "vitest";
import { getActiveGuideSectionIndex } from "./scrollSpy";

describe("getActiveGuideSectionIndex", () => {
  it("selects the latest section that crossed the activation line", () => {
    expect(getActiveGuideSectionIndex([-640, -120, 216, 560], 244)).toBe(2);
  });

  it("keeps the first section active before any section crosses the line", () => {
    expect(getActiveGuideSectionIndex([120, 420, 760], 96)).toBe(0);
  });

  it("preserves a clicked item when multiple sections share the same row", () => {
    expect(getActiveGuideSectionIndex([-400, 180, 180, 180, 620], 244, 2)).toBe(2);
  });

  it("uses the first item when entering a shared row by scrolling", () => {
    expect(getActiveGuideSectionIndex([-400, 180, 180, 180, 620], 244, 0)).toBe(1);
  });

  it("selects the final tracked section at the end of the page", () => {
    expect(getActiveGuideSectionIndex([-1200, -800, -200, 240], 180, 1, true)).toBe(3);
  });
});

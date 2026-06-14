import { describe, expect, it } from "vitest";
import { getDashboardDefaultRange, getDashboardRangeFromBr } from "./dashboardDateRange";

describe("dashboard date range", () => {
  it("converts valid BR dates into an ISO range", () => {
    expect(getDashboardRangeFromBr("01/06/2026", "14/06/2026")).toEqual({
      start: "2026-06-01",
      end: "2026-06-14",
    });
  });

  it("swaps the range when the end date comes before the start date", () => {
    expect(getDashboardRangeFromBr("14/06/2026", "01/06/2026")).toEqual({
      start: "2026-06-01",
      end: "2026-06-14",
    });
  });

  it("returns null for incomplete dates", () => {
    expect(getDashboardRangeFromBr("14/06/____", "01/06/2026")).toBeNull();
  });

  it("defaults both dashboard dates to today", () => {
    expect(getDashboardDefaultRange("2026-06-14")).toEqual({
      startBr: "14/06/2026",
      endBr: "14/06/2026",
    });
  });
});

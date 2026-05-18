import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCESS_PASSWORD,
  canUnlockWithAccessPassword,
  isValidAccessPassword,
  normalizeStoredAccessPassword,
  sanitizeAccessPassword,
} from "./accessPassword";

describe("access password rules", () => {
  it("sanitizes to four lowercase alphanumeric characters", () => {
    expect(sanitizeAccessPassword("A1-b2C3")).toBe("a1b2");
  });

  it("accepts only exactly four lowercase letters or digits", () => {
    expect(isValidAccessPassword("a1b2")).toBe(true);
    expect(isValidAccessPassword("123")).toBe(false);
    expect(isValidAccessPassword("abç1")).toBe(false);
  });

  it("falls back to the default password when stored data is invalid", () => {
    expect(normalizeStoredAccessPassword("AB12")).toBe("ab12");
    expect(normalizeStoredAccessPassword("xyz")).toBe(DEFAULT_ACCESS_PASSWORD);
    expect(normalizeStoredAccessPassword("12-")).toBe(DEFAULT_ACCESS_PASSWORD);
  });

  it("allows unlock with normalized configured or master password", () => {
    expect(canUnlockWithAccessPassword("A1B2", "a1b2", "1973")).toBe(true);
    expect(canUnlockWithAccessPassword("1973", "a1b2", "1973")).toBe(true);
    expect(canUnlockWithAccessPassword("zz99", "a1b2", "1973")).toBe(false);
  });
});

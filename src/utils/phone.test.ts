import { describe, expect, it } from "bun:test";

import {
  formatPhoneNumber,
  isLikelyPhoneNumber,
  normalizePhoneNumber,
  normalizePhoneNumberParts,
  splitPhoneNumber,
} from "./phone";

describe("phone number utilities", () => {
  it("normalizes user-entered phone numbers into a plus-prefixed digit string", () => {
    expect(normalizePhoneNumber("  +91 98765-43210  ")).toBe("+919876543210");
    expect(normalizePhoneNumber("(415) 555-2671")).toBe("+4155552671");
    expect(normalizePhoneNumber("not a phone")).toBe("");
  });

  it("combines country code and local number fields into the stored phone identity", () => {
    expect(normalizePhoneNumberParts("+91", "98765 43210")).toBe("+919876543210");
    expect(normalizePhoneNumberParts("91", "98765-43210")).toBe("+919876543210");
    expect(normalizePhoneNumberParts("+91", "")).toBe("");
  });

  it("splits stored phone identities back into editable country code and local number fields", () => {
    expect(splitPhoneNumber("+919876543210")).toEqual({
      countryCode: "+91",
      localNumber: "9876543210",
    });
    expect(splitPhoneNumber("")).toEqual({
      countryCode: "+91",
      localNumber: "",
    });
  });

  it("formats normalized phone identities for display without changing the stored value", () => {
    expect(formatPhoneNumber("+919876543210")).toBe("+91 987 654 3210");
    expect(formatPhoneNumber("+14155552671")).toBe("+1 415 555 2671");
    expect(formatPhoneNumber("")).toBe("");
  });

  it("accepts only plausible phone identities for account and contact matching flows", () => {
    expect(isLikelyPhoneNumber("+919876543210")).toBe(true);
    expect(isLikelyPhoneNumber("1234567")).toBe(false);
  });
});

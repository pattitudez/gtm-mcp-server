import { describe, expect, it } from "vitest";
import { isEmailAllowed, parseAllowedEmails } from "../src/auth/allowlist";

describe("parseAllowedEmails", () => {
  it("splits, trims, and lowercases", () => {
    expect(parseAllowedEmails(" Patrick@RapidWebLaunch.com , va@example.com ,")).toEqual([
      "patrick@rapidweblaunch.com",
      "va@example.com",
    ]);
  });

  it("returns empty for unset or blank", () => {
    expect(parseAllowedEmails(undefined)).toEqual([]);
    expect(parseAllowedEmails("")).toEqual([]);
    expect(parseAllowedEmails(" , ")).toEqual([]);
  });
});

describe("isEmailAllowed", () => {
  it("matches case-insensitively", () => {
    expect(isEmailAllowed("PATRICK@rapidweblaunch.COM", "patrick@rapidweblaunch.com")).toBe(
      true,
    );
  });

  it("fails closed with no allowlist configured", () => {
    expect(isEmailAllowed("patrick@rapidweblaunch.com", undefined)).toBe(false);
    expect(isEmailAllowed("patrick@rapidweblaunch.com", "")).toBe(false);
  });

  it("rejects emails not on the list", () => {
    expect(isEmailAllowed("intruder@evil.com", "patrick@rapidweblaunch.com")).toBe(false);
    expect(isEmailAllowed(undefined, "patrick@rapidweblaunch.com")).toBe(false);
  });

  it("supports multiple entries", () => {
    const list = "patrick@rapidweblaunch.com, va@rapidweblaunch.com";
    expect(isEmailAllowed("va@rapidweblaunch.com", list)).toBe(true);
    expect(isEmailAllowed("other@rapidweblaunch.com", list)).toBe(false);
  });
});

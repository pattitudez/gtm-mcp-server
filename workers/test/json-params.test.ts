import { describe, expect, it } from "vitest";
import { parseJsonParam, splitConsentTypes } from "../src/gtm/json-params";

describe("parseJsonParam", () => {
  it("returns undefined for omitted or empty input", () => {
    expect(parseJsonParam(undefined, "parametersJson")).toBeUndefined();
    expect(parseJsonParam("", "parametersJson")).toBeUndefined();
  });

  it("parses valid JSON", () => {
    expect(parseJsonParam('[{"type":"template","key":"k","value":"v"}]', "x")).toEqual([
      { type: "template", key: "k", value: "v" },
    ]);
  });

  it("names the offending field in the error", () => {
    expect(() => parseJsonParam("{not json", "setupTagJson")).toThrow(
      /^invalid setupTagJson: /,
    );
  });
});

describe("splitConsentTypes", () => {
  it("splits and trims comma-separated types", () => {
    expect(splitConsentTypes("ad_storage, analytics_storage ,")).toEqual([
      "ad_storage",
      "analytics_storage",
    ]);
  });

  it("returns undefined for empty input", () => {
    expect(splitConsentTypes(undefined)).toBeUndefined();
    expect(splitConsentTypes("")).toBeUndefined();
    expect(splitConsentTypes(" , ")).toBeUndefined();
  });
});

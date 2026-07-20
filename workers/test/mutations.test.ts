// Tests for the request-shaping logic ported from gtm/mutations.go: the
// doesNotContain rewrite, autoEventFilter remap, merge-preserve updates,
// consent settings, and the empty-string parameter guarantee.

import { describe, expect, it } from "vitest";
import {
  buildTagCreateBody,
  buildTriggerCreateBody,
  isClickLinkFormTrigger,
  mergeTagUpdate,
  mergeTriggerUpdate,
  toApiConditions,
  toApiConsentSettings,
  toApiParam,
} from "../src/gtm/mutations";
import type { ApiTag, ApiTrigger } from "../src/gtm/types";

describe("isClickLinkFormTrigger", () => {
  it("matches the click-family trigger types only", () => {
    expect(isClickLinkFormTrigger("linkClick")).toBe(true);
    expect(isClickLinkFormTrigger("formSubmission")).toBe(true);
    expect(isClickLinkFormTrigger("click")).toBe(true);
    expect(isClickLinkFormTrigger("pageview")).toBe(false);
    expect(isClickLinkFormTrigger("customEvent")).toBe(false);
  });
});

describe("toApiParam", () => {
  it("always sends type, key, and value, including empty strings", () => {
    // Mirrors Go's ForceSendFields: GA4 tagReference params carry value:"".
    const param = toApiParam({ type: "tagReference", key: "measurementId" });
    expect(JSON.parse(JSON.stringify(param))).toEqual({
      type: "tagReference",
      key: "measurementId",
      value: "",
    });
  });

  it("converts nested list and map parameters", () => {
    const param = toApiParam({
      type: "list",
      key: "eventParameters",
      list: [
        {
          type: "map",
          map: [
            { type: "template", key: "name", value: "currency" },
            { type: "template", key: "value", value: "USD" },
          ],
        },
      ],
    });
    expect(param.list?.[0].map?.[0]).toEqual({
      type: "template",
      key: "name",
      value: "currency",
    });
  });
});

describe("toApiConditions", () => {
  it("rewrites doesNotContain to contains + negate parameter", () => {
    const conds = toApiConditions([
      {
        type: "doesNotContain",
        parameter: [
          { type: "template", key: "arg0", value: "{{Click URL}}" },
          { type: "template", key: "arg1", value: "logout" },
        ],
      },
    ]);
    expect(conds).toHaveLength(1);
    expect(conds![0].type).toBe("contains");
    expect(conds![0].parameter).toContainEqual({
      type: "boolean",
      key: "negate",
      value: "true",
    });
  });

  it("appends negate parameter for negate: true conditions", () => {
    const conds = toApiConditions([
      {
        type: "contains",
        negate: true,
        parameter: [{ type: "template", key: "arg0", value: "{{Page Path}}" }],
      },
    ]);
    expect(conds![0].type).toBe("contains");
    expect(conds![0].parameter?.at(-1)).toEqual({
      type: "boolean",
      key: "negate",
      value: "true",
    });
  });

  it("passes through plain conditions and returns undefined for empty", () => {
    expect(toApiConditions(undefined)).toBeUndefined();
    expect(toApiConditions([])).toBeUndefined();
    const conds = toApiConditions([
      { type: "equals", parameter: [{ type: "template", key: "arg0", value: "x" }] },
    ]);
    expect(conds![0]).toEqual({
      type: "equals",
      parameter: [{ type: "template", key: "arg0", value: "x" }],
    });
  });

  it("does not mutate the caller's condition objects", () => {
    const input = [{ type: "doesNotContain", parameter: [] }];
    toApiConditions(input);
    expect(input[0].type).toBe("doesNotContain");
  });
});

describe("toApiConsentSettings", () => {
  it("returns undefined when no status is provided", () => {
    expect(toApiConsentSettings(undefined, undefined)).toBeUndefined();
    expect(toApiConsentSettings("", [])).toBeUndefined();
  });

  it("builds the consent type list for status needed", () => {
    const cs = toApiConsentSettings("needed", ["ad_storage", "analytics_storage"]);
    expect(cs).toEqual({
      consentStatus: "needed",
      consentType: {
        type: "list",
        list: [
          { type: "template", value: "ad_storage" },
          { type: "template", value: "analytics_storage" },
        ],
      },
    });
  });

  it("omits consent types unless status is needed", () => {
    const cs = toApiConsentSettings("notNeeded", ["ad_storage"]);
    expect(cs).toEqual({ consentStatus: "notNeeded" });
  });
});

describe("buildTriggerCreateBody (autoEventFilter remap)", () => {
  const conditions = [
    {
      type: "contains" as const,
      parameter: [
        { type: "template", key: "arg0", value: "{{Click URL}}" },
        { type: "template", key: "arg1", value: ".pdf" },
      ],
    },
  ];

  for (const triggerType of ["linkClick", "formSubmission", "click"]) {
    it(`moves autoEventFilter into filter for ${triggerType} triggers`, () => {
      const { trigger, remapped } = buildTriggerCreateBody({
        name: "PDF Clicks",
        type: triggerType,
        autoEventFilter: conditions,
      });
      expect(remapped).toBe(true);
      expect(trigger.autoEventFilter).toBeUndefined();
      expect(trigger.filter).toHaveLength(1);
      expect(trigger.filter![0].type).toBe("contains");
      // Companion fields required by the API for click-family triggers.
      expect(trigger.waitForTags).toEqual({ type: "boolean", value: "false" });
      expect(trigger.waitForTagsTimeout).toEqual({ type: "integer", value: "2000" });
      expect(trigger.checkValidation).toEqual({ type: "boolean", value: "false" });
    });
  }

  it("keeps autoEventFilter when filter is already provided", () => {
    const { trigger, remapped } = buildTriggerCreateBody({
      name: "Both",
      type: "linkClick",
      filter: conditions,
      autoEventFilter: conditions,
    });
    // No remap happens, but companions are still set (Go keys them on the
    // original autoEventFilter input, not on whether the remap fired).
    expect(trigger.filter).toHaveLength(1);
    expect(trigger.autoEventFilter).toHaveLength(1);
    expect(remapped).toBe(true);
    expect(trigger.waitForTags).toEqual({ type: "boolean", value: "false" });
  });

  it("leaves autoEventFilter alone for non-click trigger types", () => {
    const { trigger, remapped } = buildTriggerCreateBody({
      name: "History",
      type: "historyChange",
      autoEventFilter: conditions,
    });
    expect(remapped).toBe(false);
    expect(trigger.autoEventFilter).toHaveLength(1);
    expect(trigger.filter).toBeUndefined();
    expect(trigger.waitForTags).toBeUndefined();
  });

  it("sets eventName for customEvent triggers", () => {
    const { trigger } = buildTriggerCreateBody({
      name: "Purchase",
      type: "customEvent",
      eventName: { type: "template", value: "purchase" },
    });
    expect(trigger.eventName).toEqual({ type: "template", key: "", value: "purchase" });
  });
});

describe("mergeTagUpdate", () => {
  const current: ApiTag = {
    tagId: "12",
    name: "GA4 Event",
    type: "gaawe",
    path: "accounts/1/containers/2/workspaces/3/tags/12",
    fingerprint: "abc",
    firingTriggerId: ["5"],
    parameter: [{ type: "template", key: "eventName", value: "purchase" }],
    notes: "existing notes",
    paused: true,
    setupTag: [{ tagName: "Config" }],
    consentSettings: { consentStatus: "needed" },
    monitoringMetadata: { type: "map" },
  };

  it("preserves everything when nothing is provided", () => {
    const merged = mergeTagUpdate(current, {});
    expect(merged.name).toBe("GA4 Event");
    expect(merged.parameter).toEqual(current.parameter);
    expect(merged.firingTriggerId).toEqual(["5"]);
    expect(merged.paused).toBe(true);
    expect(merged.setupTag).toEqual([{ tagName: "Config" }]);
    expect(merged.consentSettings).toEqual({ consentStatus: "needed" });
    // Unknown fields pass through untouched.
    expect(merged.monitoringMetadata).toEqual({ type: "map" });
  });

  it("overrides only provided fields", () => {
    const merged = mergeTagUpdate(current, { name: "GA4 Event v2" });
    expect(merged.name).toBe("GA4 Event v2");
    expect(merged.type).toBe("gaawe");
    expect(merged.parameter).toEqual(current.parameter);
  });

  it("replaces parameters only when hasParameter is set", () => {
    const withoutFlag = mergeTagUpdate(current, {
      parameter: [{ type: "template", key: "eventName", value: "refund" }],
    });
    expect(withoutFlag.parameter).toEqual(current.parameter);

    const withFlag = mergeTagUpdate(current, {
      parameter: [{ type: "template", key: "eventName", value: "refund" }],
      hasParameter: true,
    });
    expect(withFlag.parameter).toEqual([
      { type: "template", key: "eventName", value: "refund" },
    ]);
  });

  it("handles the paused tri-state", () => {
    expect(mergeTagUpdate(current, {}).paused).toBe(true);
    expect(mergeTagUpdate(current, { paused: false, hasPaused: true }).paused).toBe(false);
    expect(mergeTagUpdate(current, { paused: true, hasPaused: true }).paused).toBe(true);
  });

  it("clears setup tags on explicit clear", () => {
    const merged = mergeTagUpdate(current, {
      hasSetupTag: true,
      clearSetupTag: true,
    });
    expect(merged.setupTag).toEqual([]);
  });

  it("replaces firing triggers when provided, including empty array", () => {
    expect(mergeTagUpdate(current, { firingTriggerId: ["9"] }).firingTriggerId).toEqual([
      "9",
    ]);
    expect(mergeTagUpdate(current, { firingTriggerId: [] }).firingTriggerId).toEqual([]);
    expect(mergeTagUpdate(current, {}).firingTriggerId).toEqual(["5"]);
  });

  it("replaces consent settings only when hasConsentSettings is set", () => {
    const merged = mergeTagUpdate(current, {
      consentStatus: "notNeeded",
      hasConsentSettings: true,
    });
    expect(merged.consentSettings).toEqual({ consentStatus: "notNeeded" });
    expect(mergeTagUpdate(current, {}).consentSettings).toEqual({
      consentStatus: "needed",
    });
  });
});

describe("mergeTriggerUpdate", () => {
  const current: ApiTrigger = {
    triggerId: "7",
    name: "Scroll Depth",
    type: "scrollDepth",
    fingerprint: "xyz",
    uniqueTriggerId: { type: "template", value: "u1" },
    filter: [{ type: "equals", parameter: [] }],
    parameter: [{ type: "template", key: "member", value: "t1" }],
    verticalScrollPercentageList: { type: "list", value: "25,50,75" },
    selector: { type: "template", value: ".cta" },
    waitForTags: { type: "boolean", value: "true" },
    eventName: { type: "template", value: "gtm.scrollDepth" },
  };

  it("never sends uniqueTriggerId or fingerprint in the body", () => {
    const { trigger } = mergeTriggerUpdate(current, {
      name: "Scroll Depth v2",
      type: "scrollDepth",
    });
    expect(trigger.uniqueTriggerId).toBeUndefined();
    expect(trigger.fingerprint).toBeUndefined();
  });

  it("preserves filters, params, and trigger-specific fields when omitted", () => {
    const { trigger } = mergeTriggerUpdate(current, {
      name: "Scroll Depth v2",
      type: "scrollDepth",
    });
    expect(trigger.filter).toEqual(current.filter);
    expect(trigger.parameter).toEqual(current.parameter);
    expect(trigger.verticalScrollPercentageList).toEqual(
      current.verticalScrollPercentageList,
    );
    expect(trigger.selector).toEqual(current.selector);
    expect(trigger.waitForTags).toEqual(current.waitForTags);
    expect(trigger.eventName).toEqual(current.eventName);
  });

  it("remaps autoEventFilter for linkClick updates and resets companions", () => {
    const { trigger, remapped } = mergeTriggerUpdate(current, {
      name: "Link Clicks",
      type: "linkClick",
      autoEventFilter: [
        {
          type: "contains",
          parameter: [
            { type: "template", key: "arg0", value: "{{Click URL}}" },
            { type: "template", key: "arg1", value: ".pdf" },
          ],
        },
      ],
    });
    expect(remapped).toBe(true);
    // autoEventFilter was remapped into filter (replacing the current one).
    expect(trigger.filter![0].parameter).toContainEqual({
      type: "template",
      key: "arg1",
      value: ".pdf",
    });
    // Companions are reset to the required values, not preserved.
    expect(trigger.waitForTags).toEqual({ type: "boolean", value: "false" });
    expect(trigger.waitForTagsTimeout).toEqual({ type: "integer", value: "2000" });
    expect(trigger.checkValidation).toEqual({ type: "boolean", value: "false" });
  });

  it("replaces eventName when provided", () => {
    const { trigger } = mergeTriggerUpdate(current, {
      name: "n",
      type: "customEvent",
      eventName: { type: "template", value: "purchase" },
    });
    expect(trigger.eventName).toEqual({ type: "template", key: "", value: "purchase" });
  });
});

describe("buildTagCreateBody", () => {
  it("builds the full tag body with consent settings", () => {
    const body = buildTagCreateBody({
      name: "Meta Pixel",
      type: "html",
      firingTriggerId: ["10"],
      parameter: [{ type: "template", key: "html", value: "<script></script>" }],
      consentStatus: "needed",
      consentTypes: ["ad_storage"],
      paused: false,
      notes: "n",
    });
    expect(body).toEqual({
      name: "Meta Pixel",
      type: "html",
      firingTriggerId: ["10"],
      parameter: [{ type: "template", key: "html", value: "<script></script>" }],
      notes: "n",
      consentSettings: {
        consentStatus: "needed",
        consentType: { type: "list", list: [{ type: "template", value: "ad_storage" }] },
      },
    });
  });
});

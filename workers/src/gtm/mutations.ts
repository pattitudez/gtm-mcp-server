// Pure request-shaping logic ported from gtm/mutations.go: parameter and
// condition conversion (incl. the doesNotContain rewrite), the
// autoEventFilter remap for click-family triggers, consent settings, and
// the merge-preserve bodies for tag/trigger updates. No network calls here
// so everything is unit-testable.

import type {
  ApiCondition,
  ApiConsentSetting,
  ApiParameter,
  ApiSetupTag,
  ApiTag,
  ApiTeardownTag,
  ApiTrigger,
  Condition,
  Parameter,
  SetupTagInput,
  TagInput,
  TeardownTagInput,
  TriggerInput,
} from "./types";

/**
 * Trigger types where the GTM API silently ignores autoEventFilter and
 * requires conditions in the filter field instead.
 */
export function isClickLinkFormTrigger(triggerType: string | undefined): boolean {
  return (
    triggerType === "linkClick" ||
    triggerType === "formSubmission" ||
    triggerType === "click"
  );
}

// Go's toAPIParam force-sends Type/Key/Value so empty strings survive
// (required for e.g. GA4's {"type":"tagReference","key":"measurementId",
// "value":""}). JSON.stringify keeps explicit empty strings, so always set
// all three.
export function toApiParam(p: Parameter): ApiParameter {
  const param: ApiParameter = {
    type: p.type ?? "",
    key: p.key ?? "",
    value: p.value ?? "",
  };
  if (p.list && p.list.length > 0) param.list = toApiParams(p.list);
  if (p.map && p.map.length > 0) param.map = toApiParams(p.map);
  return param;
}

export function toApiParams(params: Parameter[] | undefined): ApiParameter[] | undefined {
  if (!params || params.length === 0) return undefined;
  return params.map((p) => toApiParam(p));
}

/**
 * Convert filter conditions, rewriting doesNotContain → contains + a
 * {type:"boolean",key:"negate",value:"true"} parameter (the GTM API does
 * not accept doesNotContain; the GTM UI represents it as negated contains).
 */
export function toApiConditions(
  conditions: Condition[] | undefined,
): ApiCondition[] | undefined {
  if (!conditions || conditions.length === 0) return undefined;
  return conditions.map((c) => {
    let type = c.type;
    let negate = c.negate ?? false;
    if (type === "doesNotContain") {
      type = "contains";
      negate = true;
    }
    const params = toApiParams(c.parameter) ?? [];
    if (negate) {
      params.push({ type: "boolean", key: "negate", value: "true" });
    }
    return { type, parameter: params };
  });
}

export function toApiConsentSettings(
  status: string | undefined,
  types: string[] | undefined,
): ApiConsentSetting | undefined {
  if (!status) return undefined;
  const cs: ApiConsentSetting = { consentStatus: status };
  if (status === "needed" && types && types.length > 0) {
    cs.consentType = {
      type: "list",
      list: types.map((t) => ({ type: "template", value: t })),
    };
  }
  return cs;
}

export function toApiSetupTags(
  tags: SetupTagInput[] | undefined,
): ApiSetupTag[] | undefined {
  if (!tags || tags.length === 0) return undefined;
  return tags.map((t) => {
    const out: ApiSetupTag = { tagName: t.tagName };
    if (t.stopOnSetupFailure) out.stopOnSetupFailure = true;
    return out;
  });
}

export function toApiTeardownTags(
  tags: TeardownTagInput[] | undefined,
): ApiTeardownTag[] | undefined {
  if (!tags || tags.length === 0) return undefined;
  return tags.map((t) => {
    const out: ApiTeardownTag = { tagName: t.tagName };
    if (t.stopTeardownOnFailure) out.stopTeardownOnFailure = true;
    return out;
  });
}

/** Build the API body for a tag create (gtm/mutations.go CreateTag). */
export function buildTagCreateBody(input: TagInput): ApiTag {
  const tag: ApiTag = {};
  if (input.name) tag.name = input.name;
  if (input.type) tag.type = input.type;
  if (input.firingTriggerId && input.firingTriggerId.length > 0) {
    tag.firingTriggerId = input.firingTriggerId;
  }
  if (input.blockingTriggerId && input.blockingTriggerId.length > 0) {
    tag.blockingTriggerId = input.blockingTriggerId;
  }
  const params = toApiParams(input.parameter);
  if (params) tag.parameter = params;
  if (input.notes) tag.notes = input.notes;
  if (input.paused) tag.paused = true;
  if (input.tagFiringOption) tag.tagFiringOption = input.tagFiringOption;
  const setup = toApiSetupTags(input.setupTag);
  if (setup) tag.setupTag = setup;
  const teardown = toApiTeardownTags(input.teardownTag);
  if (teardown) tag.teardownTag = teardown;
  const consent = toApiConsentSettings(input.consentStatus, input.consentTypes);
  if (consent) tag.consentSettings = consent;
  return tag;
}

/**
 * Merge a tag update onto the current tag (gtm/mutations.go UpdateTag):
 * start from the full current entity and override only explicitly-provided
 * fields, so a partial update never loses parameters, triggers, or consent.
 */
export function mergeTagUpdate(current: ApiTag, input: TagInput): ApiTag {
  const tag: ApiTag = { ...current };

  if (input.name) tag.name = input.name;
  if (input.type) tag.type = input.type;
  if (input.firingTriggerId !== undefined) tag.firingTriggerId = input.firingTriggerId;
  if (input.blockingTriggerId !== undefined) {
    tag.blockingTriggerId = input.blockingTriggerId;
  }
  if (input.hasParameter) tag.parameter = toApiParams(input.parameter);
  if (input.notes) tag.notes = input.notes;
  if (input.hasPaused) tag.paused = input.paused ?? false;
  if (input.tagFiringOption) tag.tagFiringOption = input.tagFiringOption;

  if (input.hasSetupTag) {
    tag.setupTag = input.clearSetupTag ? [] : toApiSetupTags(input.setupTag);
  }
  if (input.hasTeardownTag) {
    tag.teardownTag = input.clearTeardownTag ? [] : toApiTeardownTags(input.teardownTag);
  }
  if (input.hasConsentSettings) {
    tag.consentSettings = toApiConsentSettings(input.consentStatus, input.consentTypes);
  }
  return tag;
}

export interface TriggerBodyResult {
  trigger: ApiTrigger;
  /**
   * True when the tool should mention the autoEventFilter handling in its
   * success message (autoEventFilter provided on a click/link/form trigger).
   */
  remapped: boolean;
}

const COMPANION_WAIT_FOR_TAGS: ApiParameter = { type: "boolean", value: "false" };
const COMPANION_WAIT_TIMEOUT: ApiParameter = { type: "integer", value: "2000" };
const COMPANION_CHECK_VALIDATION: ApiParameter = { type: "boolean", value: "false" };

/** Build the API body for a trigger create (gtm/mutations.go CreateTrigger). */
export function buildTriggerCreateBody(input: TriggerInput): TriggerBodyResult {
  // Remap autoEventFilter → filter for click-family triggers (the API
  // silently drops autoEventFilter for them) unless filter is already set.
  let filter = input.filter;
  let autoEventFilter = input.autoEventFilter;
  if (
    isClickLinkFormTrigger(input.type) &&
    (autoEventFilter?.length ?? 0) > 0 &&
    (filter?.length ?? 0) === 0
  ) {
    filter = autoEventFilter;
    autoEventFilter = undefined;
  }

  const trigger: ApiTrigger = {};
  if (input.name) trigger.name = input.name;
  if (input.type) trigger.type = input.type;
  const filterConds = toApiConditions(filter);
  if (filterConds) trigger.filter = filterConds;
  const autoConds = toApiConditions(autoEventFilter);
  if (autoConds) trigger.autoEventFilter = autoConds;
  const customConds = toApiConditions(input.customEventFilter);
  if (customConds) trigger.customEventFilter = customConds;
  const params = toApiParams(input.parameter);
  if (params) trigger.parameter = params;
  if (input.notes) trigger.notes = input.notes;
  if (input.eventName) trigger.eventName = toApiParam(input.eventName);

  const remapped =
    (input.autoEventFilter?.length ?? 0) > 0 && isClickLinkFormTrigger(input.type);
  if (remapped) {
    trigger.waitForTags = { ...COMPANION_WAIT_FOR_TAGS };
    trigger.waitForTagsTimeout = { ...COMPANION_WAIT_TIMEOUT };
    trigger.checkValidation = { ...COMPANION_CHECK_VALIDATION };
  }

  return { trigger, remapped };
}

/**
 * Build the API body for a trigger update (gtm/mutations.go UpdateTrigger):
 * provided filters/parameters replace, absent ones are preserved from the
 * current trigger, trigger-specific settings (scroll %, timers, selectors,
 * companions) are always preserved, and uniqueTriggerId/fingerprint are
 * never sent in the body.
 */
export function mergeTriggerUpdate(
  current: ApiTrigger,
  input: TriggerInput,
): TriggerBodyResult {
  let filterInput = input.filter;
  let autoEventFilterInput = input.autoEventFilter;
  if (
    isClickLinkFormTrigger(input.type) &&
    (autoEventFilterInput?.length ?? 0) > 0 &&
    (filterInput?.length ?? 0) === 0
  ) {
    filterInput = autoEventFilterInput;
    autoEventFilterInput = undefined;
  }

  const trigger: ApiTrigger = {};
  if (input.name) trigger.name = input.name;
  if (input.type) trigger.type = input.type;

  const filter = toApiConditions(filterInput) ?? current.filter;
  if (filter) trigger.filter = filter;
  const autoEventFilter = toApiConditions(autoEventFilterInput) ?? current.autoEventFilter;
  if (autoEventFilter) trigger.autoEventFilter = autoEventFilter;
  const customEventFilter =
    toApiConditions(input.customEventFilter) ?? current.customEventFilter;
  if (customEventFilter) trigger.customEventFilter = customEventFilter;
  const params = toApiParams(input.parameter) ?? current.parameter;
  if (params) trigger.parameter = params;
  if (input.notes) trigger.notes = input.notes;

  // Preserve trigger-specific fields from the current trigger.
  const preserved: (keyof ApiTrigger)[] = [
    "checkValidation",
    "waitForTags",
    "waitForTagsTimeout",
    "continuousTimeMinMilliseconds",
    "horizontalScrollPercentageList",
    "interval",
    "intervalSeconds",
    "limit",
    "maxTimerLengthSeconds",
    "selector",
    "totalTimeMinMilliseconds",
    "verticalScrollPercentageList",
    "visibilitySelector",
    "visiblePercentageMax",
    "visiblePercentageMin",
  ];
  for (const field of preserved) {
    if (current[field] !== undefined) {
      trigger[field] = current[field];
    }
  }

  trigger.eventName = input.eventName ? toApiParam(input.eventName) : current.eventName;
  if (trigger.eventName === undefined) delete trigger.eventName;

  const remapped =
    (input.autoEventFilter?.length ?? 0) > 0 && isClickLinkFormTrigger(input.type);
  if (remapped) {
    trigger.waitForTags = { ...COMPANION_WAIT_FOR_TAGS };
    trigger.waitForTagsTimeout = { ...COMPANION_WAIT_TIMEOUT };
    trigger.checkValidation = { ...COMPANION_CHECK_VALIDATION };
  }

  return { trigger, remapped };
}

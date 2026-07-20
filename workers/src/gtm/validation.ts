// Ports gtm/validation.go. Errors are thrown (the tool layer converts them
// to isError results) with the same message strings.

function isBlank(s: string | undefined): boolean {
  return !s || s.trim() === "";
}

export function validateTagInput(
  name: string,
  tagType: string,
  firingTriggerIds: string[] | undefined,
): void {
  if (isBlank(name)) throw new Error("tag name is required");
  if (name.length > 256) throw new Error("tag name must be 256 characters or less");
  if (isBlank(tagType)) throw new Error("tag type is required");
  if (!firingTriggerIds || firingTriggerIds.length === 0) {
    throw new Error("at least one firing trigger ID is required");
  }
  for (const id of firingTriggerIds) {
    if (isBlank(id)) throw new Error("firing trigger ID cannot be empty");
  }
}

export function validateTriggerInput(name: string, triggerType: string): void {
  if (isBlank(name)) throw new Error("trigger name is required");
  if (name.length > 256) throw new Error("trigger name must be 256 characters or less");
  if (isBlank(triggerType)) throw new Error("trigger type is required");
}

export function validateVariableInput(name: string, varType: string): void {
  if (isBlank(name)) throw new Error("variable name is required");
  if (name.length > 256) throw new Error("variable name must be 256 characters or less");
  if (isBlank(varType)) throw new Error("variable type is required");
}

export function validateWorkspacePath(
  accountId: string,
  containerId: string,
  workspaceId: string,
): void {
  if (isBlank(accountId)) throw new Error("account ID is required");
  if (isBlank(containerId)) throw new Error("container ID is required");
  if (isBlank(workspaceId)) throw new Error("workspace ID is required");
}

export function validateContainerPath(accountId: string, containerId: string): void {
  if (isBlank(accountId)) throw new Error("account ID is required");
  if (isBlank(containerId)) throw new Error("container ID is required");
}

export function validateClientInput(name: string, clientType: string): void {
  if (isBlank(name)) throw new Error("client name is required");
  if (name.length > 256) throw new Error("client name must be 256 characters or less");
  if (isBlank(clientType)) throw new Error("client type is required");
}

export function validateTransformationInput(
  name: string,
  transformationType: string,
): void {
  if (isBlank(name)) throw new Error("transformation name is required");
  if (name.length > 256) {
    throw new Error("transformation name must be 256 characters or less");
  }
  if (isBlank(transformationType)) {
    throw new Error(
      "transformation type is required (valid values: tf_exclude_params, tf_allow_params, tf_augment_event)",
    );
  }
}

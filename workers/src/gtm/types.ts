// Mirrors gtm/types.go and the simplified output shapes spread across the
// Go client files. Field names must stay identical — they are the tool
// output contract.

// ---------------------------------------------------------------------------
// Input structures (parsed from the tools' JSON-string parameters)
// ---------------------------------------------------------------------------

export interface Parameter {
  type: string; // "template", "boolean", "integer", "list", "map"
  key?: string;
  value?: string;
  list?: Parameter[];
  map?: Parameter[];
}

export interface Condition {
  type: string; // "equals", "contains", "doesNotContain", "startsWith", ...
  negate?: boolean;
  parameter?: Parameter[];
}

export interface SetupTagInput {
  tagName: string;
  stopOnSetupFailure?: boolean;
}

export interface TeardownTagInput {
  tagName: string;
  stopTeardownOnFailure?: boolean;
}

// Undefined fields mean "not provided" (preserve on update); the has*/clear*
// flags mirror the Go TagInput's explicit-presence booleans.
export interface TagInput {
  name?: string;
  type?: string;
  firingTriggerId?: string[];
  blockingTriggerId?: string[];
  parameter?: Parameter[];
  hasParameter?: boolean;
  notes?: string;
  paused?: boolean;
  hasPaused?: boolean;
  tagFiringOption?: string;
  setupTag?: SetupTagInput[];
  teardownTag?: TeardownTagInput[];
  hasSetupTag?: boolean;
  hasTeardownTag?: boolean;
  clearSetupTag?: boolean;
  clearTeardownTag?: boolean;
  consentStatus?: string; // "notSet", "notNeeded", "needed"
  consentTypes?: string[];
  hasConsentSettings?: boolean;
}

export interface TriggerInput {
  name?: string;
  type: string;
  filter?: Condition[];
  autoEventFilter?: Condition[];
  customEventFilter?: Condition[];
  eventName?: Parameter;
  parameter?: Parameter[]; // For trigger groups: member trigger references
  notes?: string;
}

export interface VariableInput {
  name: string;
  type: string;
  parameter?: Parameter[];
  notes?: string;
}

export interface GtmClientInput {
  name: string;
  type: string;
  priority?: number;
  parameter?: Parameter[];
  notes?: string;
}

export interface TransformationInput {
  name: string;
  type: string;
  parameter?: Parameter[];
  notes?: string;
}

export interface VersionInput {
  name?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Raw GTM API entity shapes (fields we read/write; everything else passes
// through untouched on merge-update)
// ---------------------------------------------------------------------------

export interface ApiParameter {
  type?: string;
  key?: string;
  value?: string;
  list?: ApiParameter[];
  map?: ApiParameter[];
}

export interface ApiCondition {
  type?: string;
  parameter?: ApiParameter[];
}

export interface ApiSetupTag {
  tagName?: string;
  stopOnSetupFailure?: boolean;
}

export interface ApiTeardownTag {
  tagName?: string;
  stopTeardownOnFailure?: boolean;
}

export interface ApiConsentSetting {
  consentStatus?: string;
  consentType?: ApiParameter;
}

export interface ApiTag {
  tagId?: string;
  name?: string;
  type?: string;
  path?: string;
  fingerprint?: string;
  firingTriggerId?: string[];
  blockingTriggerId?: string[];
  parameter?: ApiParameter[];
  notes?: string;
  paused?: boolean;
  tagFiringOption?: string;
  setupTag?: ApiSetupTag[];
  teardownTag?: ApiTeardownTag[];
  consentSettings?: ApiConsentSetting;
  [key: string]: unknown;
}

export interface ApiTrigger {
  triggerId?: string;
  name?: string;
  type?: string;
  path?: string;
  fingerprint?: string;
  parentFolderId?: string;
  notes?: string;
  filter?: ApiCondition[];
  autoEventFilter?: ApiCondition[];
  customEventFilter?: ApiCondition[];
  parameter?: ApiParameter[];
  eventName?: ApiParameter;
  checkValidation?: ApiParameter;
  waitForTags?: ApiParameter;
  waitForTagsTimeout?: ApiParameter;
  continuousTimeMinMilliseconds?: ApiParameter;
  horizontalScrollPercentageList?: ApiParameter;
  interval?: ApiParameter;
  intervalSeconds?: ApiParameter;
  limit?: ApiParameter;
  maxTimerLengthSeconds?: ApiParameter;
  selector?: ApiParameter;
  totalTimeMinMilliseconds?: ApiParameter;
  verticalScrollPercentageList?: ApiParameter;
  visibilitySelector?: ApiParameter;
  visiblePercentageMax?: ApiParameter;
  visiblePercentageMin?: ApiParameter;
  uniqueTriggerId?: ApiParameter;
  [key: string]: unknown;
}

export interface ApiVariable {
  variableId?: string;
  name?: string;
  type?: string;
  path?: string;
  fingerprint?: string;
  parameter?: ApiParameter[];
  notes?: string;
  [key: string]: unknown;
}

export interface ApiAccount {
  accountId?: string;
  name?: string;
  path?: string;
  fingerprint?: string;
  [key: string]: unknown;
}

export interface ApiContainer {
  containerId?: string;
  name?: string;
  publicId?: string;
  usageContext?: string[];
  notes?: string;
  domainName?: string[];
  taggingServerUrls?: string[];
  path?: string;
  fingerprint?: string;
  tagManagerUrl?: string;
  [key: string]: unknown;
}

export interface ApiWorkspace {
  workspaceId?: string;
  name?: string;
  description?: string;
  path?: string;
  tagManagerUrl?: string;
  [key: string]: unknown;
}

export interface ApiFolder {
  folderId?: string;
  name?: string;
  path?: string;
  notes?: string;
  [key: string]: unknown;
}

export interface ApiBuiltInVariable {
  name?: string;
  type?: string;
  path?: string;
  [key: string]: unknown;
}

export interface ApiClient {
  clientId?: string;
  name?: string;
  type?: string;
  priority?: number;
  parameter?: ApiParameter[];
  notes?: string;
  parentFolderId?: string;
  path?: string;
  fingerprint?: string;
  [key: string]: unknown;
}

export interface ApiTransformation {
  transformationId?: string;
  name?: string;
  type?: string;
  parameter?: ApiParameter[];
  notes?: string;
  parentFolderId?: string;
  path?: string;
  fingerprint?: string;
  [key: string]: unknown;
}

export interface ApiGalleryReference {
  owner?: string;
  repository?: string;
  version?: string;
  galleryTemplateId?: string;
  [key: string]: unknown;
}

export interface ApiCustomTemplate {
  templateId?: string;
  name?: string;
  templateData?: string;
  galleryReference?: ApiGalleryReference;
  path?: string;
  fingerprint?: string;
  tagManagerUrl?: string;
  [key: string]: unknown;
}

export interface ApiContainerVersionHeader {
  containerVersionId?: string;
  name?: string;
  deleted?: boolean;
  numTags?: string;
  numTriggers?: string;
  numVariables?: string;
  numCustomTemplates?: string;
  path?: string;
  [key: string]: unknown;
}

export interface ApiContainerVersion {
  containerVersionId?: string;
  name?: string;
  path?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Simplified output shapes (tool output contract, field parity with Go)
// ---------------------------------------------------------------------------

export interface Account {
  accountId: string;
  name: string;
  path: string;
}

export interface Container {
  containerId: string;
  name: string;
  publicId: string;
  usageContext?: string[];
  path: string;
}

export interface Workspace {
  workspaceId: string;
  name: string;
  description?: string;
  path: string;
}

export interface TagSequenceRef {
  tagName: string;
  stopOnFailure?: boolean;
}

export interface TagConsentSettings {
  consentStatus: string;
  consentTypes?: string[];
}

export interface Tag {
  tagId: string;
  name: string;
  type: string;
  parameter?: unknown;
  firingTriggerId?: string[];
  blockingTriggerId?: string[];
  setupTag?: TagSequenceRef[];
  teardownTag?: TagSequenceRef[];
  consentSettings?: TagConsentSettings;
  paused?: boolean;
  path: string;
}

export interface Trigger {
  triggerId: string;
  name: string;
  type: string;
  path: string;
  parentFolderId?: string;
  notes?: string;
  filter?: unknown;
  autoEventFilter?: unknown;
  customEventFilter?: unknown;
  parameter?: unknown;
}

export interface Variable {
  variableId: string;
  name: string;
  type: string;
  parameter?: unknown;
  path: string;
}

export interface Folder {
  folderId: string;
  name: string;
  path: string;
  notes?: string;
}

export interface FolderEntities {
  tags?: string[];
  triggers?: string[];
  variables?: string[];
}

export interface BuiltInVariable {
  name: string;
  type: string;
  path: string;
}

export interface GtmClientInfo {
  clientId: string;
  name: string;
  type: string;
  priority?: number;
  parameter?: unknown;
  notes?: string;
  parentFolderId?: string;
  path: string;
  fingerprint: string;
}

export interface TransformationInfo {
  transformationId: string;
  name: string;
  type: string;
  parameter?: unknown;
  notes?: string;
  parentFolderId?: string;
  path: string;
  fingerprint: string;
}

export interface CreatedTag {
  tagId: string;
  name: string;
  type: string;
  path: string;
  fingerprint: string;
}

export interface CreatedTrigger {
  triggerId: string;
  name: string;
  type: string;
  path: string;
  fingerprint: string;
}

export interface CreatedVariable {
  variableId: string;
  name: string;
  type: string;
  path: string;
  fingerprint: string;
}

export interface CreatedVersion {
  containerVersionId: string;
  name: string;
  path: string;
}

export interface PublishedVersion {
  containerVersionId: string;
  name: string;
  path: string;
}

export interface WorkspaceStatus {
  hasChanges: boolean;
  hasConflicts: boolean;
  changeCount: number;
  conflictCount: number;
}

export interface CreatedClient {
  clientId: string;
  name: string;
  type: string;
  path: string;
  fingerprint: string;
}

export interface CreatedTransformation {
  transformationId: string;
  name: string;
  type?: string;
  path: string;
  fingerprint: string;
}

export interface CreatedContainer {
  containerId: string;
  name: string;
  publicId: string;
  usageContext?: string[];
  path: string;
  tagManagerUrl?: string;
}

export interface CreatedWorkspace {
  workspaceId: string;
  name: string;
  description?: string;
  path: string;
  tagManagerUrl?: string;
}

export interface VersionInfo {
  versionId: string;
  name?: string;
  deleted?: boolean;
  numTags?: string;
  numTriggers?: string;
  numVariables?: string;
  numCustomTemplates?: string;
  path: string;
}

export interface GalleryReferenceInfo {
  owner: string;
  repository: string;
  version?: string;
  galleryTemplateId?: string;
}

export interface TemplateInfo {
  templateId: string;
  name: string;
  type: string;
  galleryReference?: GalleryReferenceInfo;
  tagManagerUrl?: string;
}

// ---------------------------------------------------------------------------
// Path builders (mirror gtm/validation.go + gtm/mutations.go)
// ---------------------------------------------------------------------------

export function buildContainerPath(accountId: string, containerId: string): string {
  return `accounts/${accountId}/containers/${containerId}`;
}

export function buildWorkspacePath(
  accountId: string,
  containerId: string,
  workspaceId: string,
): string {
  return `accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}`;
}

export function buildTagPath(
  accountId: string,
  containerId: string,
  workspaceId: string,
  tagId: string,
): string {
  return `${buildWorkspacePath(accountId, containerId, workspaceId)}/tags/${tagId}`;
}

export function buildTriggerPath(
  accountId: string,
  containerId: string,
  workspaceId: string,
  triggerId: string,
): string {
  return `${buildWorkspacePath(accountId, containerId, workspaceId)}/triggers/${triggerId}`;
}

export function buildVariablePath(
  accountId: string,
  containerId: string,
  workspaceId: string,
  variableId: string,
): string {
  return `${buildWorkspacePath(accountId, containerId, workspaceId)}/variables/${variableId}`;
}

export function buildClientPath(
  accountId: string,
  containerId: string,
  workspaceId: string,
  clientId: string,
): string {
  return `${buildWorkspacePath(accountId, containerId, workspaceId)}/clients/${clientId}`;
}

export function buildTransformationPath(
  accountId: string,
  containerId: string,
  workspaceId: string,
  transformationId: string,
): string {
  return `${buildWorkspacePath(accountId, containerId, workspaceId)}/transformations/${transformationId}`;
}

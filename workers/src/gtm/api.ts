// GTM API client: a plain-fetch port of the Go client layer
// (gtm/client.go + the per-entity files). Reads retry with backoff on
// 403/429; updates GET the current entity first and pass its fingerprint as
// a URL query parameter (optimistic concurrency), mirroring the Go code.

import { GtmApiError, retryWithBackoff } from "./errors";
import {
  buildTagCreateBody,
  buildTriggerCreateBody,
  mergeTagUpdate,
  mergeTriggerUpdate,
  toApiParams,
  type TriggerBodyResult,
} from "./mutations";
import type {
  Account,
  ApiAccount,
  ApiBuiltInVariable,
  ApiClient,
  ApiContainer,
  ApiContainerVersion,
  ApiContainerVersionHeader,
  ApiCustomTemplate,
  ApiFolder,
  ApiTag,
  ApiTransformation,
  ApiTrigger,
  ApiVariable,
  ApiWorkspace,
  BuiltInVariable,
  Container,
  CreatedClient,
  CreatedTag,
  CreatedTransformation,
  CreatedTrigger,
  CreatedVariable,
  CreatedVersion,
  Folder,
  FolderEntities,
  GtmClientInfo,
  GtmClientInput,
  PublishedVersion,
  Tag,
  TagInput,
  TransformationInfo,
  TransformationInput,
  Trigger,
  TriggerInput,
  Variable,
  VariableInput,
  VersionInfo,
  VersionInput,
  Workspace,
  WorkspaceStatus,
} from "./types";
import { buildWorkspacePath as workspacePath } from "./types";

const BASE_URL = "https://tagmanager.googleapis.com/tagmanager/v2/";

type Query = Record<string, string | string[]>;

interface RequestOptions {
  query?: Query;
  body?: unknown;
  retry?: boolean;
}

export class GtmClient {
  constructor(private readonly getToken: () => Promise<string>) {}

  private async request<T>(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const url = new URL(BASE_URL + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(k, item);
      } else {
        url.searchParams.set(k, v);
      }
    }

    const attempt = async (): Promise<T> => {
      const token = await this.getToken();
      const res = await fetch(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      if (!res.ok) {
        throw await GtmApiError.fromResponse(res);
      }
      const text = await res.text();
      return (text === "" ? undefined : JSON.parse(text)) as T;
    };

    return opts.retry ? retryWithBackoff(attempt) : attempt();
  }

  private get<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>("GET", path, { query, retry: true });
  }

  private post<T>(path: string, body?: unknown, query?: Query): Promise<T> {
    return this.request<T>("POST", path, { body, query });
  }

  private postWithRetry<T>(path: string, body?: unknown, query?: Query): Promise<T> {
    return this.request<T>("POST", path, { body, query, retry: true });
  }

  // The GTM API takes the fingerprint as a URL parameter on updates, never
  // in the body (optimistic concurrency control).
  private put<T>(path: string, body: unknown, fingerprint?: string): Promise<T> {
    return this.request<T>("PUT", path, {
      body,
      query: fingerprint ? { fingerprint } : undefined,
    });
  }

  private delete(path: string, query?: Query): Promise<void> {
    return this.request<void>("DELETE", path, { query });
  }

  // ---- Accounts (gtm/accounts.go) ----

  async listAccounts(): Promise<Account[]> {
    const resp = await this.get<{ account?: ApiAccount[] }>("accounts");
    return (resp.account ?? []).map((a) => ({
      accountId: a.accountId ?? "",
      name: a.name ?? "",
      path: a.path ?? "",
    }));
  }

  async updateAccount(accountId: string, name: string): Promise<Account> {
    const path = `accounts/${accountId}`;
    const current = await this.get<ApiAccount>(path);
    current.name = name;
    const updated = await this.put<ApiAccount>(path, current, current.fingerprint);
    return {
      accountId: updated.accountId ?? "",
      name: updated.name ?? "",
      path: updated.path ?? "",
    };
  }

  // ---- Containers (gtm/containers.go + tool_create_container.go) ----

  async listContainers(accountId: string): Promise<Container[]> {
    const resp = await this.get<{ container?: ApiContainer[] }>(
      `accounts/${accountId}/containers`,
    );
    return (resp.container ?? []).map((c) => toContainer(c));
  }

  async createContainer(accountId: string, container: ApiContainer): Promise<ApiContainer> {
    return this.post<ApiContainer>(`accounts/${accountId}/containers`, container);
  }

  async updateContainer(
    accountId: string,
    containerId: string,
    name: string,
  ): Promise<Container> {
    const path = `accounts/${accountId}/containers/${containerId}`;
    const current = await this.get<ApiContainer>(path);
    current.name = name;
    const updated = await this.put<ApiContainer>(path, current, current.fingerprint);
    return toContainer(updated);
  }

  async deleteContainer(path: string): Promise<void> {
    return this.delete(path);
  }

  // ---- Workspaces (gtm/workspaces.go + tool_create_workspace.go) ----

  async listWorkspaces(accountId: string, containerId: string): Promise<Workspace[]> {
    const resp = await this.get<{ workspace?: ApiWorkspace[] }>(
      `accounts/${accountId}/containers/${containerId}/workspaces`,
    );
    return (resp.workspace ?? []).map((w) => {
      const out: Workspace = {
        workspaceId: w.workspaceId ?? "",
        name: w.name ?? "",
        path: w.path ?? "",
      };
      if (w.description) out.description = w.description;
      return out;
    });
  }

  async createWorkspace(
    containerPath: string,
    workspace: { name: string; description?: string },
  ): Promise<ApiWorkspace> {
    const body: ApiWorkspace = { name: workspace.name };
    if (workspace.description) body.description = workspace.description;
    return this.post<ApiWorkspace>(`${containerPath}/workspaces`, body);
  }

  // ---- Tags (gtm/tags.go + gtm/mutations.go) ----

  async listTags(
    accountId: string,
    containerId: string,
    workspaceId: string,
  ): Promise<Tag[]> {
    const parent = workspacePath(accountId, containerId, workspaceId);
    const resp = await this.get<{ tag?: ApiTag[] }>(`${parent}/tags`);
    return (resp.tag ?? []).map((t) => toTag(t));
  }

  async getTag(
    accountId: string,
    containerId: string,
    workspaceId: string,
    tagId: string,
  ): Promise<Tag> {
    const path = `${workspacePath(accountId, containerId, workspaceId)}/tags/${tagId}`;
    const tag = await this.get<ApiTag>(path);
    return toTag(tag);
  }

  async createTag(
    accountId: string,
    containerId: string,
    workspaceId: string,
    input: TagInput,
  ): Promise<CreatedTag> {
    const parent = workspacePath(accountId, containerId, workspaceId);
    const result = await this.post<ApiTag>(`${parent}/tags`, buildTagCreateBody(input));
    return toCreatedTag(result);
  }

  async updateTag(path: string, input: TagInput): Promise<CreatedTag> {
    const current = await this.request<ApiTag>("GET", path);
    const body = mergeTagUpdate(current, input);
    const result = await this.put<ApiTag>(path, body, current.fingerprint);
    return toCreatedTag(result);
  }

  async deleteTag(path: string): Promise<void> {
    return this.delete(path);
  }

  // ---- Triggers (gtm/triggers.go + gtm/mutations.go) ----

  async listTriggers(
    accountId: string,
    containerId: string,
    workspaceId: string,
  ): Promise<Trigger[]> {
    const parent = workspacePath(accountId, containerId, workspaceId);
    const resp = await this.get<{ trigger?: ApiTrigger[] }>(`${parent}/triggers`);
    return (resp.trigger ?? []).map((t) => toTrigger(t));
  }

  async getTrigger(
    accountId: string,
    containerId: string,
    workspaceId: string,
    triggerId: string,
  ): Promise<Trigger> {
    const path = `${workspacePath(accountId, containerId, workspaceId)}/triggers/${triggerId}`;
    const t = await this.get<ApiTrigger>(path);
    return toTrigger(t);
  }

  async createTrigger(
    accountId: string,
    containerId: string,
    workspaceId: string,
    input: TriggerInput,
  ): Promise<{ trigger: CreatedTrigger; remapped: boolean }> {
    const parent = workspacePath(accountId, containerId, workspaceId);
    const { trigger, remapped }: TriggerBodyResult = buildTriggerCreateBody(input);
    const result = await this.post<ApiTrigger>(`${parent}/triggers`, trigger);
    return { trigger: toCreatedTrigger(result), remapped };
  }

  async updateTrigger(
    path: string,
    input: TriggerInput,
  ): Promise<{ trigger: CreatedTrigger; remapped: boolean }> {
    const current = await this.request<ApiTrigger>("GET", path);
    const { trigger, remapped } = mergeTriggerUpdate(current, input);
    const result = await this.put<ApiTrigger>(path, trigger, current.fingerprint);
    return { trigger: toCreatedTrigger(result), remapped };
  }

  async deleteTrigger(path: string): Promise<void> {
    return this.delete(path);
  }

  // ---- Variables (gtm/variables.go + gtm/mutations.go) ----

  async listVariables(
    accountId: string,
    containerId: string,
    workspaceId: string,
  ): Promise<Variable[]> {
    const parent = workspacePath(accountId, containerId, workspaceId);
    const resp = await this.get<{ variable?: ApiVariable[] }>(`${parent}/variables`);
    return (resp.variable ?? []).map((v) => toVariable(v));
  }

  async getVariable(
    accountId: string,
    containerId: string,
    workspaceId: string,
    variableId: string,
  ): Promise<Variable> {
    const path = `${workspacePath(accountId, containerId, workspaceId)}/variables/${variableId}`;
    const v = await this.get<ApiVariable>(path);
    return toVariable(v);
  }

  async createVariable(
    accountId: string,
    containerId: string,
    workspaceId: string,
    input: VariableInput,
  ): Promise<CreatedVariable> {
    const parent = workspacePath(accountId, containerId, workspaceId);
    const result = await this.post<ApiVariable>(
      `${parent}/variables`,
      buildVariableBody(input),
    );
    return toCreatedVariable(result);
  }

  async updateVariable(path: string, input: VariableInput): Promise<CreatedVariable> {
    const current = await this.request<ApiVariable>("GET", path);
    const result = await this.put<ApiVariable>(
      path,
      buildVariableBody(input),
      current.fingerprint,
    );
    return toCreatedVariable(result);
  }

  async deleteVariable(path: string): Promise<void> {
    return this.delete(path);
  }

  // ---- Folders (gtm/folders.go) ----

  async listFolders(
    accountId: string,
    containerId: string,
    workspaceId: string,
  ): Promise<Folder[]> {
    const parent = workspacePath(accountId, containerId, workspaceId);
    const resp = await this.get<{ folder?: ApiFolder[] }>(`${parent}/folders`);
    return (resp.folder ?? []).map((f) => {
      const out: Folder = {
        folderId: f.folderId ?? "",
        name: f.name ?? "",
        path: f.path ?? "",
      };
      if (f.notes) out.notes = f.notes;
      return out;
    });
  }

  async getFolderEntities(
    accountId: string,
    containerId: string,
    workspaceId: string,
    folderId: string,
  ): Promise<FolderEntities> {
    const path = `${workspacePath(accountId, containerId, workspaceId)}/folders/${folderId}`;
    // folders:entities is a POST in the GTM API despite being a read.
    const resp = await this.postWithRetry<{
      tag?: ApiTag[];
      trigger?: ApiTrigger[];
      variable?: ApiVariable[];
    }>(`${path}:entities`);
    const entities: FolderEntities = {};
    if (resp.tag?.length) entities.tags = resp.tag.map((t) => t.name ?? "");
    if (resp.trigger?.length) entities.triggers = resp.trigger.map((t) => t.name ?? "");
    if (resp.variable?.length) {
      entities.variables = resp.variable.map((v) => v.name ?? "");
    }
    return entities;
  }

  // ---- Versions & workspace status (gtm/versions.go + tool_list_versions.go) ----

  async createVersion(
    accountId: string,
    containerId: string,
    workspaceId: string,
    input: VersionInput,
  ): Promise<CreatedVersion> {
    const parent = workspacePath(accountId, containerId, workspaceId);
    const body: Record<string, string> = {};
    if (input.name) body.name = input.name;
    if (input.notes) body.notes = input.notes;
    const result = await this.post<{ containerVersion?: ApiContainerVersion }>(
      `${parent}:create_version`,
      body,
    );
    if (!result?.containerVersion) {
      throw new Error("no version created - workspace may have no changes");
    }
    return {
      containerVersionId: result.containerVersion.containerVersionId ?? "",
      name: result.containerVersion.name ?? "",
      path: result.containerVersion.path ?? "",
    };
  }

  async publishVersion(
    accountId: string,
    containerId: string,
    versionId: string,
  ): Promise<PublishedVersion> {
    const path = `accounts/${accountId}/containers/${containerId}/versions/${versionId}`;
    const result = await this.post<{ containerVersion?: ApiContainerVersion }>(
      `${path}:publish`,
    );
    return {
      containerVersionId: result.containerVersion?.containerVersionId ?? "",
      name: result.containerVersion?.name ?? "",
      path: result.containerVersion?.path ?? "",
    };
  }

  async getWorkspaceStatus(
    accountId: string,
    containerId: string,
    workspaceId: string,
  ): Promise<WorkspaceStatus> {
    const path = workspacePath(accountId, containerId, workspaceId);
    const status = await this.get<{
      workspaceChange?: unknown[];
      mergeConflict?: unknown[];
    }>(`${path}/status`);
    const changeCount = status.workspaceChange?.length ?? 0;
    const conflictCount = status.mergeConflict?.length ?? 0;
    return {
      hasChanges: changeCount > 0,
      hasConflicts: conflictCount > 0,
      changeCount,
      conflictCount,
    };
  }

  async listVersions(accountId: string, containerId: string): Promise<VersionInfo[]> {
    const parent = `accounts/${accountId}/containers/${containerId}`;
    const resp = await this.get<{
      containerVersionHeader?: ApiContainerVersionHeader[];
    }>(`${parent}/version_headers`);
    return (resp.containerVersionHeader ?? []).map((v) => {
      const out: VersionInfo = {
        versionId: v.containerVersionId ?? "",
        path: v.path ?? "",
      };
      if (v.name) out.name = v.name;
      if (v.deleted) out.deleted = v.deleted;
      if (v.numTags) out.numTags = v.numTags;
      if (v.numTriggers) out.numTriggers = v.numTriggers;
      if (v.numVariables) out.numVariables = v.numVariables;
      if (v.numCustomTemplates) out.numCustomTemplates = v.numCustomTemplates;
      return out;
    });
  }

  // ---- Built-in variables (gtm/built_in_variables.go) ----

  async listBuiltInVariables(
    accountId: string,
    containerId: string,
    workspaceId: string,
  ): Promise<BuiltInVariable[]> {
    const parent = workspacePath(accountId, containerId, workspaceId);
    const resp = await this.get<{ builtInVariable?: ApiBuiltInVariable[] }>(
      `${parent}/built_in_variables`,
    );
    return toBuiltInVariables(resp?.builtInVariable);
  }

  async enableBuiltInVariables(
    accountId: string,
    containerId: string,
    workspaceId: string,
    types: string[],
  ): Promise<BuiltInVariable[]> {
    const parent = workspacePath(accountId, containerId, workspaceId);
    const resp = await this.postWithRetry<{ builtInVariable?: ApiBuiltInVariable[] }>(
      `${parent}/built_in_variables`,
      undefined,
      { type: types },
    );
    return toBuiltInVariables(resp?.builtInVariable);
  }

  async disableBuiltInVariables(
    accountId: string,
    containerId: string,
    workspaceId: string,
    types: string[],
  ): Promise<void> {
    const path = `${workspacePath(accountId, containerId, workspaceId)}/built_in_variables`;
    return this.delete(path, { type: types });
  }

  // ---- Clients (server-side containers; gtm/clients.go) ----

  async listClients(
    accountId: string,
    containerId: string,
    workspaceId: string,
  ): Promise<GtmClientInfo[]> {
    const parent = workspacePath(accountId, containerId, workspaceId);
    const resp = await this.get<{ client?: ApiClient[] }>(`${parent}/clients`);
    return (resp?.client ?? []).map((c) => toGtmClientInfo(c));
  }

  async getClient(
    accountId: string,
    containerId: string,
    workspaceId: string,
    clientId: string,
  ): Promise<GtmClientInfo> {
    const path = `${workspacePath(accountId, containerId, workspaceId)}/clients/${clientId}`;
    const c = await this.get<ApiClient>(path);
    return toGtmClientInfo(c);
  }

  async createClient(
    accountId: string,
    containerId: string,
    workspaceId: string,
    input: GtmClientInput,
  ): Promise<CreatedClient> {
    const parent = workspacePath(accountId, containerId, workspaceId);
    const result = await this.post<ApiClient>(`${parent}/clients`, buildClientBody(input));
    return {
      clientId: result.clientId ?? "",
      name: result.name ?? "",
      type: result.type ?? "",
      path: result.path ?? "",
      fingerprint: result.fingerprint ?? "",
    };
  }

  async updateClient(path: string, input: GtmClientInput): Promise<CreatedClient> {
    const current = await this.request<ApiClient>("GET", path);
    const result = await this.put<ApiClient>(
      path,
      buildClientBody(input),
      current.fingerprint,
    );
    return {
      clientId: result.clientId ?? "",
      name: result.name ?? "",
      type: result.type ?? "",
      path: result.path ?? "",
      fingerprint: result.fingerprint ?? "",
    };
  }

  async deleteClient(path: string): Promise<void> {
    return this.delete(path);
  }

  // ---- Transformations (server-side containers; gtm/transformations.go) ----

  async listTransformations(
    accountId: string,
    containerId: string,
    workspaceId: string,
  ): Promise<TransformationInfo[]> {
    const parent = workspacePath(accountId, containerId, workspaceId);
    const resp = await this.get<{ transformation?: ApiTransformation[] }>(
      `${parent}/transformations`,
    );
    return (resp?.transformation ?? []).map((t) => toTransformationInfo(t));
  }

  async getTransformation(
    accountId: string,
    containerId: string,
    workspaceId: string,
    transformationId: string,
  ): Promise<TransformationInfo> {
    const path = `${workspacePath(accountId, containerId, workspaceId)}/transformations/${transformationId}`;
    const t = await this.get<ApiTransformation>(path);
    return toTransformationInfo(t);
  }

  async createTransformation(
    accountId: string,
    containerId: string,
    workspaceId: string,
    input: TransformationInput,
  ): Promise<CreatedTransformation> {
    const parent = workspacePath(accountId, containerId, workspaceId);
    const result = await this.post<ApiTransformation>(
      `${parent}/transformations`,
      buildTransformationBody(input),
    );
    return toCreatedTransformation(result);
  }

  async updateTransformation(
    path: string,
    input: TransformationInput,
  ): Promise<CreatedTransformation> {
    const current = await this.request<ApiTransformation>("GET", path);
    const result = await this.put<ApiTransformation>(
      path,
      buildTransformationBody(input),
      current.fingerprint,
    );
    return toCreatedTransformation(result);
  }

  async deleteTransformation(path: string): Promise<void> {
    return this.delete(path);
  }

  // ---- Custom templates (tool_*_template.go) ----

  async listTemplates(
    accountId: string,
    containerId: string,
    workspaceId: string,
  ): Promise<ApiCustomTemplate[]> {
    const parent = workspacePath(accountId, containerId, workspaceId);
    const resp = await this.get<{ template?: ApiCustomTemplate[] }>(
      `${parent}/templates`,
    );
    return resp?.template ?? [];
  }

  async getTemplate(path: string): Promise<ApiCustomTemplate> {
    return this.get<ApiCustomTemplate>(path);
  }

  async createTemplate(
    workspacePathStr: string,
    template: { name: string; templateData: string },
  ): Promise<ApiCustomTemplate> {
    return this.post<ApiCustomTemplate>(`${workspacePathStr}/templates`, template);
  }

  // Note: unlike other updates, the Go server sends the template fingerprint
  // in the body (tool_update_template.go), not as a URL parameter.
  async updateTemplate(
    path: string,
    template: { name: string; templateData: string; fingerprint: string },
  ): Promise<ApiCustomTemplate> {
    return this.put<ApiCustomTemplate>(path, template);
  }

  async deleteTemplate(path: string): Promise<void> {
    return this.delete(path);
  }

  async importGalleryTemplate(
    workspacePathStr: string,
    opts: { galleryOwner: string; galleryRepository: string; gallerySha?: string },
  ): Promise<ApiCustomTemplate> {
    const query: Query = {
      galleryOwner: opts.galleryOwner,
      galleryRepository: opts.galleryRepository,
      acknowledgePermissions: "true",
    };
    if (opts.gallerySha) query.gallerySha = opts.gallerySha;
    return this.post<ApiCustomTemplate>(
      `${workspacePathStr}/templates:import_from_gallery`,
      undefined,
      query,
    );
  }
}

// ---------------------------------------------------------------------------
// Response mappers (simplified output shapes, field parity with Go)
// ---------------------------------------------------------------------------

function toContainer(c: ApiContainer): Container {
  return {
    containerId: c.containerId ?? "",
    name: c.name ?? "",
    publicId: c.publicId ?? "",
    usageContext: c.usageContext,
    path: c.path ?? "",
  };
}

function toTag(t: ApiTag): Tag {
  const tag: Tag = {
    tagId: t.tagId ?? "",
    name: t.name ?? "",
    type: t.type ?? "",
    path: t.path ?? "",
  };
  if (t.firingTriggerId?.length) tag.firingTriggerId = t.firingTriggerId;
  if (t.blockingTriggerId?.length) tag.blockingTriggerId = t.blockingTriggerId;
  if (t.paused) tag.paused = t.paused;
  for (const s of t.setupTag ?? []) {
    (tag.setupTag ??= []).push({
      tagName: s.tagName ?? "",
      ...(s.stopOnSetupFailure ? { stopOnFailure: true } : {}),
    });
  }
  for (const s of t.teardownTag ?? []) {
    (tag.teardownTag ??= []).push({
      tagName: s.tagName ?? "",
      ...(s.stopTeardownOnFailure ? { stopOnFailure: true } : {}),
    });
  }
  if (t.parameter?.length) tag.parameter = t.parameter;
  if (t.consentSettings?.consentStatus) {
    tag.consentSettings = { consentStatus: t.consentSettings.consentStatus };
    const types = (t.consentSettings.consentType?.list ?? [])
      .map((p) => p.value ?? "")
      .filter((v) => v !== "");
    if (types.length > 0) tag.consentSettings.consentTypes = types;
  }
  return tag;
}

function toCreatedTag(t: ApiTag): CreatedTag {
  return {
    tagId: t.tagId ?? "",
    name: t.name ?? "",
    type: t.type ?? "",
    path: t.path ?? "",
    fingerprint: t.fingerprint ?? "",
  };
}

function toTrigger(t: ApiTrigger): Trigger {
  const trigger: Trigger = {
    triggerId: t.triggerId ?? "",
    name: t.name ?? "",
    type: t.type ?? "",
    path: t.path ?? "",
  };
  if (t.parentFolderId) trigger.parentFolderId = t.parentFolderId;
  if (t.notes) trigger.notes = t.notes;
  if (t.filter?.length) trigger.filter = t.filter;
  if (t.autoEventFilter?.length) trigger.autoEventFilter = t.autoEventFilter;
  if (t.customEventFilter?.length) trigger.customEventFilter = t.customEventFilter;
  if (t.parameter?.length) trigger.parameter = t.parameter;
  return trigger;
}

function toCreatedTrigger(t: ApiTrigger): CreatedTrigger {
  return {
    triggerId: t.triggerId ?? "",
    name: t.name ?? "",
    type: t.type ?? "",
    path: t.path ?? "",
    fingerprint: t.fingerprint ?? "",
  };
}

function toVariable(v: ApiVariable): Variable {
  const out: Variable = {
    variableId: v.variableId ?? "",
    name: v.name ?? "",
    type: v.type ?? "",
    path: v.path ?? "",
  };
  if (v.parameter?.length) out.parameter = v.parameter;
  return out;
}

function toCreatedVariable(v: ApiVariable): CreatedVariable {
  return {
    variableId: v.variableId ?? "",
    name: v.name ?? "",
    type: v.type ?? "",
    path: v.path ?? "",
    fingerprint: v.fingerprint ?? "",
  };
}

function buildVariableBody(input: VariableInput): ApiVariable {
  const body: ApiVariable = {};
  if (input.name) body.name = input.name;
  if (input.type) body.type = input.type;
  const params = toApiParams(input.parameter);
  if (params) body.parameter = params;
  if (input.notes) body.notes = input.notes;
  return body;
}

function toBuiltInVariables(vars: ApiBuiltInVariable[] | undefined): BuiltInVariable[] {
  return (vars ?? []).map((v) => ({
    name: v.name ?? "",
    type: v.type ?? "",
    path: v.path ?? "",
  }));
}

function buildClientBody(input: GtmClientInput): ApiClient {
  const body: ApiClient = {};
  if (input.name) body.name = input.name;
  if (input.type) body.type = input.type;
  if (input.priority) body.priority = input.priority;
  const params = toApiParams(input.parameter);
  if (params) body.parameter = params;
  if (input.notes) body.notes = input.notes;
  return body;
}

function toGtmClientInfo(c: ApiClient): GtmClientInfo {
  const info: GtmClientInfo = {
    clientId: c.clientId ?? "",
    name: c.name ?? "",
    type: c.type ?? "",
    path: c.path ?? "",
    fingerprint: c.fingerprint ?? "",
  };
  if (c.priority) info.priority = c.priority;
  if (c.notes) info.notes = c.notes;
  if (c.parentFolderId) info.parentFolderId = c.parentFolderId;
  if (c.parameter?.length) info.parameter = c.parameter;
  return info;
}

function buildTransformationBody(input: TransformationInput): ApiTransformation {
  const body: ApiTransformation = {};
  if (input.name) body.name = input.name;
  if (input.type) body.type = input.type;
  const params = toApiParams(input.parameter);
  if (params) body.parameter = params;
  if (input.notes) body.notes = input.notes;
  return body;
}

function toTransformationInfo(t: ApiTransformation): TransformationInfo {
  const info: TransformationInfo = {
    transformationId: t.transformationId ?? "",
    name: t.name ?? "",
    type: t.type ?? "",
    path: t.path ?? "",
    fingerprint: t.fingerprint ?? "",
  };
  if (t.notes) info.notes = t.notes;
  if (t.parentFolderId) info.parentFolderId = t.parentFolderId;
  if (t.parameter?.length) info.parameter = t.parameter;
  return info;
}

function toCreatedTransformation(t: ApiTransformation): CreatedTransformation {
  const out: CreatedTransformation = {
    transformationId: t.transformationId ?? "",
    name: t.name ?? "",
    path: t.path ?? "",
    fingerprint: t.fingerprint ?? "",
  };
  if (t.type) out.type = t.type;
  return out;
}

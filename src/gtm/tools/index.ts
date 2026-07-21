// Composes all tool registrations in the same order as gtm/tools.go
// RegisterTools (plus the utility tools registered first in main.go).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Props } from "../../types";
import type { GtmClient } from "../api";
import { instrumentToolAudit } from "./audit";
import { registerAccountTools } from "./accounts";
import { registerBuiltInVariableTools } from "./builtins";
import { registerClientTools } from "./clients";
import { registerContainerTools } from "./containers";
import { registerFolderTools } from "./folders";
import { registerStaticTemplateTools } from "./static-templates";
import { registerTagTools } from "./tags";
import { registerTemplateTools } from "./templates";
import { registerTransformationTools } from "./transformations";
import { registerTriggerTools } from "./triggers";
import { registerUtilityTools } from "./utility";
import { registerVariableTools } from "./variables";
import { registerVersionTools } from "./versions";
import { registerWorkspaceTools } from "./workspaces";

export interface ToolRegistrationOptions {
  /** Register delete_container (default: false — see containers.ts). */
  enableContainerDeletion?: boolean;
}

export function registerAllTools(
  server: McpServer,
  getClient: () => GtmClient,
  getProps: () => Props | undefined,
  options: ToolRegistrationOptions = {},
) {
  // Must run first so every tool registered below emits audit log lines.
  instrumentToolAudit(server, getProps);

  registerUtilityTools(server, getProps);
  registerAccountTools(server, getClient);
  registerContainerTools(server, getClient, {
    enableContainerDeletion: options.enableContainerDeletion,
  });
  registerWorkspaceTools(server, getClient);
  registerTagTools(server, getClient);
  registerTriggerTools(server, getClient);
  registerVariableTools(server, getClient);
  registerFolderTools(server, getClient);
  registerTemplateTools(server, getClient);
  registerVersionTools(server, getClient);
  registerBuiltInVariableTools(server, getClient);
  registerClientTools(server, getClient);
  registerTransformationTools(server, getClient);
  registerStaticTemplateTools(server);
}

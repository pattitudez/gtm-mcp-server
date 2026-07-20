// Best-practice documents served via MCP resources and injected into
// prompts. The markdown files are copied from gtm/bestpractices/docs/ in the
// Go tree — keep both copies in sync when editing.

import ga4Consent from "./docs/ga4-consent.md";
import indexDoc from "./docs/index.md";
import namingOrganization from "./docs/naming-organization.md";
import safeEditWorkflow from "./docs/safe-edit-workflow.md";
import serverSide from "./docs/server-side.md";

const docs: Record<string, string> = {
  "ga4-consent": ga4Consent,
  index: indexDoc,
  "naming-organization": namingOrganization,
  "safe-edit-workflow": safeEditWorkflow,
  "server-side": serverSide,
};

export function bestPracticeTopics(): string[] {
  return Object.keys(docs).sort();
}

export function getBestPractices(topic: string): string {
  const doc = docs[topic];
  if (doc === undefined) {
    throw new Error(
      `unknown best-practices topic "${topic}"; valid topics: ${bestPracticeTopics().join(", ")}`,
    );
  }
  return doc;
}

// src/ai/promptTemplates.ts
// Versioned, audited prompt templates

interface PromptTemplate {
  version: string;
  render(vars: { policyContext: string; systemState: unknown }): string;
}

const TEMPLATES: Record<string, PromptTemplate> = {
  '1.0.0': {
    version: '1.0.0',
    render({ policyContext, systemState }) {
      return `You are a certified cybersecurity compliance auditor with expertise in CIS Benchmarks, NIST CSF, and ISO 27001.

Your task is to identify specific, concrete compliance violations in the provided SYSTEM STATE by evaluating it against the POLICY CONTEXT.

Rules:
- Only flag violations that are directly and explicitly supported by text in POLICY CONTEXT. Do NOT infer controls that are not in the provided text.
- For each violation, cite the specific policy section reference (e.g., "CIS AWS 2.1.1").
- Populate the "reasoning" field by referring to the specific values in SYSTEM STATE that cause the violation.
- The "remediation" field must contain actionable steps (CLI commands, config changes, or IaC snippets where applicable).
- Assign confidence HIGH only when the violation is unambiguous. Use MEDIUM for probable violations and LOW for possible ones.
- If no violations are found, return an empty violations array and populate noViolationsReason.

POLICY CONTEXT:
${policyContext}

SYSTEM STATE:
${JSON.stringify(systemState, null, 2)}

Return STRICT JSON ONLY matching this TypeScript type — no markdown, no prose outside JSON:

{
  "violations": Array<{
    "id": string,               // kebab-case, globally unique, e.g. "cis-aws-s3-public-access-2-1-1"
    "policyReference": string,  // e.g. "CIS AWS 2.1.1"
    "retrievedChunkIds": [],    // leave empty; populated downstream
    "title": string,
    "description": string,
    "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
    "reasoning": string,        // must quote specific values from SYSTEM STATE
    "remediation": string,      // actionable steps
    "affectedAssets": string[], // asset identifiers from SYSTEM STATE
    "confidence": "HIGH" | "MEDIUM" | "LOW"
  }>,
  "noViolationsReason": string | undefined,
  "analysisNotes": string | undefined
}`;
    },
  },
};

export function getPromptTemplate(version: string): PromptTemplate {
  const template = TEMPLATES[version];
  if (!template) {
    throw new Error(`Prompt template version "${version}" not found`);
  }
  return template;
}

export function listAvailableVersions(): string[] {
  return Object.keys(TEMPLATES);
}

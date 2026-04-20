// src/compliance/engineAdapter.ts
// EngineRule → OPA Rego adapter

import type { EngineRule } from '../ai/types.js';
import type { ConditionType } from '../ai/ruleGenerator.js';

// The adapter is the only layer that knows about the internal compliance
// engine's DSL or policy language (e.g., OPA Rego, YAML rules, custom AST).
// Swap this layer when upgrading the engine without touching any AI module.

export type RegoFragment = string;

export function toOpaRego(rule: EngineRule): RegoFragment {
  const { id, condition } = rule;
  const c = condition as ConditionType;

  const header = `# Rule: ${id}
# Policy: ${rule.policyReference}
# Severity: ${rule.severity}
# Description: ${rule.description}
`;

  switch (c.type) {
    case 'S3_PUBLIC_ACCESS_FORBIDDEN': {
      const buckets = (c.buckets as string[]).map((b) => `"${b}"`).join(', ');
      return `${header}violation[{"rule": "${id}", "asset": bucket_name, "severity": "${rule.severity}"}] {
  bucket := input.awsS3Buckets[_]
  bucket_name := bucket.bucketName
  {${buckets}}[bucket_name]
  not bucket.blockPublicPolicy
}`;
    }

    case 'IAM_ADMIN_ROLE_RESTRICTED': {
      return `${header}violation[{"rule": "${id}", "asset": role_name, "severity": "${rule.severity}"}] {
  role := input.iamRoles[_]
  role_name := role.roleName
  {${(c.roles as string[]).map(r => `"${r}"`).join(', ')}}[role_name]
  role.hasAdminAccess == true
}`;
    }

    case 'LINUX_SSH_PASSWORD_AUTH_DISABLED': {
      return `${header}violation[{"rule": "${id}", "asset": hostname, "severity": "${rule.severity}"}] {
  host := input.linuxHosts[_]
  hostname := host.hostname
  {${(c.hosts as string[]).map(h => `"${h}"`).join(', ')}}[hostname]
  host.sshPasswordAuthEnabled == true
}`;
    }

    case 'LINUX_AUDITD_ENABLED': {
      return `${header}violation[{"rule": "${id}", "asset": hostname, "severity": "${rule.severity}"}] {
  host := input.linuxHosts[_]
  hostname := host.hostname
  {${(c.hosts as string[]).map(h => `"${h}"`).join(', ')}}[hostname]
  not host.auditdEnabled
}`;
    }

    default:
      return `${header}# Rule ${id}: manual review required — no Rego template for type "${c.type}"`;
  }
}

// Generate a complete Rego module for all rules
export function generateRegoModule(rules: EngineRule[]): string {
  const ruleFragments = rules.map(toOpaRego);
  
  return `package compliance

import future.keywords.if
import future.keywords.in

# Evaluations for ${rules.length} rules

${ruleFragments.join('\n\n')}

# Helper to aggregate all violations
all_violations := [v | v := violation[_]]

# Severity scoring
severity_score := 10 if count(critical_violations) > 0
severity_score := 5 if count(high_violations) > 0
severity_score := 2 if count(medium_violations) > 0
severity_score := 1 if count(low_violations) > 0
severity_score := 0

critical_violations := [v | v := violation[_]; v.severity == "CRITICAL"]
high_violations := [v | v := violation[_]; v.severity == "HIGH"]
medium_violations := [v | v := violation[_]; v.severity == "MEDIUM"]
low_violations := [v | v := violation[_]; v.severity == "LOW"]
`;
}

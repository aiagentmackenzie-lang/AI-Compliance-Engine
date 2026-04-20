// src/compliance/engine.ts
// Deterministic rule evaluator against system state

import type { EngineRule, SystemState, Severity } from '../ai/types.js';
import type { ConditionType } from '../ai/ruleGenerator.js';
import { logger } from '../core/logger.js';

export interface EvaluationFinding {
  ruleId: string;
  policyReference: string;
  title: string;
  severity: Severity;
  status: 'PASS' | 'FAIL';
  reasoning: string;
  remediation: string;
  affectedAssets: string[];
}

export interface EvaluationResult {
  findings: EvaluationFinding[];
  passedCount: number;
  failedCount: number;
  overallRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

// Evaluate a single rule against system state
export function evaluateRule(rule: EngineRule, state: SystemState): EvaluationFinding {
  const condition = rule.condition as ConditionType;
  
  switch (condition.type) {
    case 'S3_PUBLIC_ACCESS_FORBIDDEN':
      return evaluateS3PublicAccessRule(rule, state, condition);
    case 'IAM_ADMIN_ROLE_RESTRICTED':
      return evaluateIamAdminRule(rule, state, condition);
    case 'LINUX_SSH_PASSWORD_AUTH_DISABLED':
      return evaluateSshPasswordRule(rule, state, condition);
    case 'LINUX_AUDITD_ENABLED':
      return evaluateAuditdRule(rule, state, condition);
    case 'GENERIC':
    default:
      return evaluateGenericRule(rule, condition);
  }
}

// Evaluate all active rules against system state
export function evaluateRules(rules: EngineRule[], state: SystemState): EvaluationResult {
  const findings: EvaluationFinding[] = [];
  
  for (const rule of rules) {
    try {
      const finding = evaluateRule(rule, state);
      findings.push(finding);
    } catch (err) {
      logger.error({ err, ruleId: rule.id }, 'Rule evaluation failed');
      // Add as error finding
      findings.push({
        ruleId: rule.id,
        policyReference: rule.policyReference,
        title: rule.description,
        severity: rule.severity,
        status: 'FAIL',
        reasoning: `Evaluation error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        remediation: rule.remediation,
        affectedAssets: [],
      });
    }
  }
  
  const passedCount = findings.filter(f => f.status === 'PASS').length;
  const failedCount = findings.filter(f => f.status === 'FAIL').length;
  const overallRisk = calculateOverallRisk(findings);
  
  return {
    findings,
    passedCount,
    failedCount,
    overallRisk,
  };
}

// S3 Public Access evaluation
function evaluateS3PublicAccessRule(
  rule: EngineRule,
  state: SystemState,
  condition: { type: 'S3_PUBLIC_ACCESS_FORBIDDEN'; buckets: string[] }
): EvaluationFinding {
  const buckets = state.awsS3Buckets ?? [];
  const violatingBuckets: string[] = [];
  
  for (const bucketName of condition.buckets) {
    const bucket = buckets.find(b => b.bucketName === bucketName);
    if (!bucket) {
      violatingBuckets.push(bucketName);
      continue;
    }
    
    // Check if any public access settings are disabled
    if (!bucket.blockPublicAcls || !bucket.ignorePublicAcls || 
        !bucket.blockPublicPolicy || !bucket.restrictPublicBuckets) {
      violatingBuckets.push(bucketName);
    }
  }
  
  const failed = violatingBuckets.length > 0;
  
  return {
    ruleId: rule.id,
    policyReference: rule.policyReference,
    title: rule.description,
    severity: rule.severity,
    status: failed ? 'FAIL' : 'PASS',
    reasoning: failed 
      ? `Buckets with public access enabled: ${violatingBuckets.join(', ')}`
      : 'All specified buckets have public access properly blocked',
    remediation: rule.remediation,
    affectedAssets: violatingBuckets,
  };
}

// IAM Admin Role evaluation
function evaluateIamAdminRule(
  rule: EngineRule,
  state: SystemState,
  condition: { type: 'IAM_ADMIN_ROLE_RESTRICTED'; roles: string[] }
): EvaluationFinding {
  const roles = state.iamRoles ?? [];
  const violatingRoles: string[] = [];
  
  for (const roleName of condition.roles) {
    const role = roles.find(r => r.roleName === roleName);
    if (role?.hasAdminAccess) {
      violatingRoles.push(roleName);
    }
  }
  
  const failed = violatingRoles.length > 0;
  
  return {
    ruleId: rule.id,
    policyReference: rule.policyReference,
    title: rule.description,
    severity: rule.severity,
    status: failed ? 'FAIL' : 'PASS',
    reasoning: failed
      ? `Roles with admin access: ${violatingRoles.join(', ')}`
      : 'No roles with excessive admin access detected',
    remediation: rule.remediation,
    affectedAssets: violatingRoles,
  };
}

// SSH Password Auth evaluation
function evaluateSshPasswordRule(
  rule: EngineRule,
  state: SystemState,
  condition: { type: 'LINUX_SSH_PASSWORD_AUTH_DISABLED'; hosts: string[] }
): EvaluationFinding {
  const hosts = state.linuxHosts ?? [];
  const violatingHosts: string[] = [];
  
  for (const hostname of condition.hosts) {
    const host = hosts.find(h => h.hostname === hostname);
    if (host?.sshPasswordAuthEnabled) {
      violatingHosts.push(hostname);
    }
  }
  
  const failed = violatingHosts.length > 0;
  
  return {
    ruleId: rule.id,
    policyReference: rule.policyReference,
    title: rule.description,
    severity: rule.severity,
    status: failed ? 'FAIL' : 'PASS',
    reasoning: failed
      ? `Hosts with SSH password auth enabled: ${violatingHosts.join(', ')}`
      : 'All hosts have SSH password authentication disabled',
    remediation: rule.remediation,
    affectedAssets: violatingHosts,
  };
}

// Auditd enabled evaluation
function evaluateAuditdRule(
  rule: EngineRule,
  state: SystemState,
  condition: { type: 'LINUX_AUDITD_ENABLED'; hosts: string[] }
): EvaluationFinding {
  const hosts = state.linuxHosts ?? [];
  const violatingHosts: string[] = [];
  
  for (const hostname of condition.hosts) {
    const host = hosts.find(h => h.hostname === hostname);
    if (!host?.auditdEnabled) {
      violatingHosts.push(hostname);
    }
  }
  
  const failed = violatingHosts.length > 0;
  
  return {
    ruleId: rule.id,
    policyReference: rule.policyReference,
    title: rule.description,
    severity: rule.severity,
    status: failed ? 'FAIL' : 'PASS',
    reasoning: failed
      ? `Hosts without auditd enabled: ${violatingHosts.join(', ')}`
      : 'All hosts have auditd enabled',
    remediation: rule.remediation,
    affectedAssets: violatingHosts,
  };
}

// Generic rule evaluation (manual review required)
function evaluateGenericRule(
  rule: EngineRule,
  condition: { type: 'GENERIC'; assets: string[]; hint: string }
): EvaluationFinding {
  return {
    ruleId: rule.id,
    policyReference: rule.policyReference,
    title: rule.description,
    severity: rule.severity,
    status: 'FAIL', // Generic rules require manual verification
    reasoning: `Generic rule requires manual review: ${condition.hint}`,
    remediation: rule.remediation,
    affectedAssets: condition.assets,
  };
}

// Calculate overall risk based on findings
function calculateOverallRisk(findings: EvaluationFinding[]): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  const failedFindings = findings.filter(f => f.status === 'FAIL');
  
  if (failedFindings.length === 0) {
    return 'LOW';
  }
  
  // Check for CRITICAL failures
  if (failedFindings.some(f => f.severity === 'CRITICAL')) {
    return 'CRITICAL';
  }
  
  // Check for HIGH failures
  if (failedFindings.some(f => f.severity === 'HIGH')) {
    return 'HIGH';
  }
  
  // Check for multiple MEDIUM failures
  const mediumFailures = failedFindings.filter(f => f.severity === 'MEDIUM').length;
  if (mediumFailures >= 3) {
    return 'HIGH';
  }
  if (mediumFailures >= 1) {
    return 'MEDIUM';
  }
  
  return 'LOW';
}

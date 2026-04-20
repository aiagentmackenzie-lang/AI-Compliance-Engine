// src/compliance/evaluationReport.ts
// Report generation and risk scoring

import type { EvaluationResult, EvaluationFinding } from './engine.js';
import type { SystemState } from '../ai/types.js';

export interface EvaluationReport {
  evaluationId: string;
  systemId: string;
  framework: string;
  frameworkVersion: string;
  snapshotAt: string;
  status: 'COMPLETED' | 'FAILED';
  overallRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  summary: {
    totalRules: number;
    passed: number;
    failed: number;
    bySeverity: {
      CRITICAL: number;
      HIGH: number;
      MEDIUM: number;
      LOW: number;
    };
  };
  findings: EvaluationFinding[];
  generatedAt: string;
}

export function generateReport(
  evaluationId: string,
  systemId: string,
  framework: string,
  frameworkVersion: string,
  state: SystemState,
  result: EvaluationResult,
): EvaluationReport {
  const now = new Date().toISOString();
  
  const bySeverity = {
    CRITICAL: result.findings.filter(f => f.severity === 'CRITICAL' && f.status === 'FAIL').length,
    HIGH: result.findings.filter(f => f.severity === 'HIGH' && f.status === 'FAIL').length,
    MEDIUM: result.findings.filter(f => f.severity === 'MEDIUM' && f.status === 'FAIL').length,
    LOW: result.findings.filter(f => f.severity === 'LOW' && f.status === 'FAIL').length,
  };
  
  return {
    evaluationId,
    systemId,
    framework,
    frameworkVersion,
    snapshotAt: state.snapshotAt,
    status: 'COMPLETED',
    overallRisk: result.overallRisk,
    summary: {
      totalRules: result.findings.length,
      passed: result.passedCount,
      failed: result.failedCount,
      bySeverity,
    },
    findings: result.findings,
    generatedAt: now,
  };
}

// Generate a human-readable summary for executives
export function generateExecutiveSummary(report: EvaluationReport): string {
  const { summary, overallRisk } = report;
  
  let riskDescription = '';
  switch (overallRisk) {
    case 'CRITICAL':
      riskDescription = 'CRITICAL RISK: Immediate action required. Critical compliance violations detected.';
      break;
    case 'HIGH':
      riskDescription = 'HIGH RISK: Significant compliance gaps identified. Remediation recommended within 7 days.';
      break;
    case 'MEDIUM':
      riskDescription = 'MEDIUM RISK: Some compliance issues present. Remediation recommended within 30 days.';
      break;
    case 'LOW':
      riskDescription = 'LOW RISK: System is largely compliant. Minor improvements suggested.';
      break;
  }
  
  return `COMPLIANCE EVALUATION SUMMARY
==============================

Evaluation ID: ${report.evaluationId}
System: ${report.systemId}
Framework: ${report.framework} v${report.frameworkVersion}
Snapshot Date: ${report.snapshotAt}

${riskDescription}

Results Overview:
- Total Rules Evaluated: ${summary.totalRules}
- Passed: ${summary.passed}
- Failed: ${summary.failed}

Failures by Severity:
- CRITICAL: ${summary.bySeverity.CRITICAL}
- HIGH: ${summary.bySeverity.HIGH}
- MEDIUM: ${summary.bySeverity.MEDIUM}
- LOW: ${summary.bySeverity.LOW}

Report Generated: ${report.generatedAt}
`;
}

// Generate remediation playbook
export function generateRemediationPlaybook(findings: EvaluationFinding[]): string {
  const failures = findings.filter(f => f.status === 'FAIL');
  
  if (failures.length === 0) {
    return '# Remediation Playbook\n\nNo failures detected. No remediation required.\n';
  }
  
  const sections: string[] = ['# Remediation Playbook\n'];
  
  // Group by severity
  const bySeverity = {
    CRITICAL: failures.filter(f => f.severity === 'CRITICAL'),
    HIGH: failures.filter(f => f.severity === 'HIGH'),
    MEDIUM: failures.filter(f => f.severity === 'MEDIUM'),
    LOW: failures.filter(f => f.severity === 'LOW'),
  };
  
  for (const [severity, items] of Object.entries(bySeverity)) {
    if (items.length === 0) continue;
    
    sections.push(`\n## ${severity} Priority (${items.length} items)\n`);
    
    for (const item of items) {
      sections.push(`### ${item.title}`);
      sections.push(`- **Policy Reference:** ${item.policyReference}`);
      sections.push(`- **Affected Assets:** ${item.affectedAssets.join(', ') || 'N/A'}`);
      sections.push(`- **Issue:** ${item.reasoning}`);
      sections.push(`- **Remediation:**\n\n\`\`\`bash\n${item.remediation}\n\`\`\`\n`);
    }
  }
  
  return sections.join('\n');
}

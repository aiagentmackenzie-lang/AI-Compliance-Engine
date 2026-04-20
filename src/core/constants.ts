// src/core/constants.ts
// Framework enums, severity levels, and system constants

// Supported compliance frameworks
export const Frameworks = {
  CIS_AWS: 'CIS_AWS',
  CIS_LINUX: 'CIS_LINUX',
  CIS_KUBERNETES: 'CIS_KUBERNETES',
  NIST_CSF: 'NIST_CSF',
  ISO_27001: 'ISO_27001',
  ISO_42001: 'ISO_42001',
  INTERNAL: 'INTERNAL',
  OTHER: 'OTHER',
} as const;

export type Framework = typeof Frameworks[keyof typeof Frameworks];

// Severity levels
export const Severities = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;

export type Severity = typeof Severities[keyof typeof Severities];

// Rule status lifecycle
export const RuleStatuses = {
  PROPOSED: 'PROPOSED',
  APPROVED: 'APPROVED',
  ACTIVE: 'ACTIVE',
  DEPRECATED: 'DEPRECATED',
  REJECTED: 'REJECTED',
} as const;

export type RuleStatus = typeof RuleStatuses[keyof typeof RuleStatuses];

// Audit event types
export const AuditEventTypes = {
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  DOCUMENT_PARSED: 'DOCUMENT_PARSED',
  EMBEDDING_CREATED: 'EMBEDDING_CREATED',
  RETRIEVAL_PERFORMED: 'RETRIEVAL_PERFORMED',
  AI_ANALYSIS_COMPLETED: 'AI_ANALYSIS_COMPLETED',
  RULE_GENERATED: 'RULE_GENERATED',
  RULE_APPROVED: 'RULE_APPROVED',
  RULE_REJECTED: 'RULE_REJECTED',
  EVALUATION_STARTED: 'EVALUATION_STARTED',
  EVALUATION_COMPLETED: 'EVALUATION_COMPLETED',
  ACCESS_DENIED: 'ACCESS_DENIED',
} as const;

export type AuditEventType = typeof AuditEventTypes[keyof typeof AuditEventTypes];

// RBAC Roles
export const Roles = {
  SECURITY_ENGINEER: 'security_engineer',
  COMPLIANCE_AUDITOR: 'compliance_auditor',
  SYSTEM_COLLECTOR: 'system_collector',
  ADMIN: 'admin',
} as const;

export type Role = typeof Roles[keyof typeof Roles];

// File upload constraints
export const FILE_CONSTRAINTS = {
  MAX_SIZE_BYTES: 50 * 1024 * 1024, // 50MB
  ALLOWED_MIME_TYPES: new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]),
} as const;

// Embedding constraints
export const EMBEDDING_CONSTRAINTS = {
  BATCH_SIZE: 64,
  MAX_CHUNK_TOKENS: 800,
  CHUNK_OVERLAP_TOKENS: 80,
  CHARS_PER_TOKEN: 4, // Approximate for English prose
} as const;

// Retrieval constraints
export const RETRIEVAL_CONSTRAINTS = {
  DEFAULT_MAX_RESULTS: 8,
  DEFAULT_MIN_SIMILARITY: 0.72,
  OVER_FETCH_MULTIPLIER: 2,
} as const;

// API constraints
export const API_CONSTRAINTS = {
  DEFAULT_RATE_LIMIT_REQUESTS: 100,
  DEFAULT_RATE_LIMIT_WINDOW_MS: 60 * 1000, // 1 minute
  CORRELATION_ID_HEADER: 'x-correlation-id',
  TENANT_ID_HEADER: 'x-tenant-id',
} as const;

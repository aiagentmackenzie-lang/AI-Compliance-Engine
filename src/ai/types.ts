// src/ai/types.ts
// Core data models for the AI Compliance Engine

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────
// Framework and severity enumerations
// ─────────────────────────────────────────────────────────────────

export const FrameworkSchema = z.enum([
  'CIS_AWS',
  'CIS_LINUX',
  'CIS_KUBERNETES',
  'NIST_CSF',
  'ISO_27001',
  'ISO_42001',
  'INTERNAL',
  'OTHER',
]);
export type Framework = z.infer<typeof FrameworkSchema>;

export const SeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type Severity = z.infer<typeof SeveritySchema>;

// ─────────────────────────────────────────────────────────────────
// Document and chunk models
// ─────────────────────────────────────────────────────────────────

export const ComplianceDocumentSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  title: z.string().min(1).max(512),
  framework: FrameworkSchema,
  frameworkVersion: z.string().max(64),
  sourcePath: z.string(),       // storage reference; never a public URL
  checksum: z.string(),         // SHA-256 hex of the original file
  createdAt: z.string().datetime(),
  createdBy: z.string().uuid(), // principal ID
});
export type ComplianceDocument = z.infer<typeof ComplianceDocumentSchema>;

export const DocumentChunkSchema = z.object({
  id: z.string(),               // format: `${documentId}:${chunkIndex}`
  documentId: z.string().uuid(),
  tenantId: z.string().uuid(),
  chunkIndex: z.number().int().nonnegative(),
  text: z.string().min(1).max(8000),
  sectionRef: z.string().optional(), // e.g. "CIS-1.1.1" or "A.9.2.3"
  tags: z.array(z.string()),
});
export type DocumentChunk = z.infer<typeof DocumentChunkSchema>;

// ─────────────────────────────────────────────────────────────────
// System state models (extensible per platform)
// ─────────────────────────────────────────────────────────────────

export const AwsS3BucketStateSchema = z.object({
  bucketName: z.string(),
  region: z.string(),
  publicAccessBlockEnabled: z.boolean(),
  blockPublicAcls: z.boolean(),
  blockPublicPolicy: z.boolean(),
  ignorePublicAcls: z.boolean(),
  restrictPublicBuckets: z.boolean(),
  encryptionEnabled: z.boolean(),
  encryptionAlgorithm: z.string().optional(),
  versioningEnabled: z.boolean(),
  mfaDeleteEnabled: z.boolean(),
  loggingEnabled: z.boolean(),
});
export type AwsS3BucketState = z.infer<typeof AwsS3BucketStateSchema>;

export const IamRoleStateSchema = z.object({
  roleName: z.string(),
  arn: z.string(),
  attachedManagedPolicies: z.array(z.string()),
  inlinePolicies: z.array(z.string()),
  trustPolicy: z.unknown(),
  lastUsedDate: z.string().datetime().optional(),
  hasAdminAccess: z.boolean(),
});
export type IamRoleState = z.infer<typeof IamRoleStateSchema>;

export const LinuxHostStateSchema = z.object({
  hostname: z.string(),
  osRelease: z.string(),
  kernelVersion: z.string(),
  sshPasswordAuthEnabled: z.boolean(),
  rootLoginEnabled: z.boolean(),
  auditdEnabled: z.boolean(),
  firewallEnabled: z.boolean(),
  world_writable_files: z.array(z.string()),
  suidFiles: z.array(z.string()),
});
export type LinuxHostState = z.infer<typeof LinuxHostStateSchema>;

export const SystemStateSchema = z.object({
  platform: z.enum(['AWS', 'GCP', 'AZURE', 'ON_PREM', 'KUBERNETES']),
  snapshotAt: z.string().datetime(),
  snapshotVersion: z.string(),
  awsS3Buckets: z.array(AwsS3BucketStateSchema).optional(),
  iamRoles: z.array(IamRoleStateSchema).optional(),
  linuxHosts: z.array(LinuxHostStateSchema).optional(),
});
export type SystemState = z.infer<typeof SystemStateSchema>;

// ─────────────────────────────────────────────────────────────────
// AI analysis output
// ─────────────────────────────────────────────────────────────────

export const AiViolationSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{3,127}$/),
  policyReference: z.string().min(1).max(256),
  retrievedChunkIds: z.array(z.string()),   // traceability: which chunks grounded this
  title: z.string().min(1).max(256),
  description: z.string().min(1).max(2048),
  severity: SeveritySchema,
  reasoning: z.string().min(1).max(4096),  // must reference specific system state values
  remediation: z.string().min(1).max(4096),
  affectedAssets: z.array(z.string()),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']), // AI self-assessment
});
export type AiViolation = z.infer<typeof AiViolationSchema>;

export const AiAnalysisResultSchema = z.object({
  violations: z.array(AiViolationSchema),
  noViolationsReason: z.string().optional(), // populated when violations is empty
  analysisNotes: z.string().optional(),
});
export type AiAnalysisResult = z.infer<typeof AiAnalysisResultSchema>;

// ─────────────────────────────────────────────────────────────────
// Compliance engine rule
// ─────────────────────────────────────────────────────────────────

export const RuleStatusSchema = z.enum(['PROPOSED', 'APPROVED', 'ACTIVE', 'DEPRECATED', 'REJECTED']);
export type RuleStatus = z.infer<typeof RuleStatusSchema>;

export const EngineRuleSchema = z.object({
  id: z.string(),
  policyReference: z.string(),
  description: z.string(),
  severity: SeveritySchema,
  remediation: z.string(),
  condition: z.unknown(),          // engine-specific DSL or OPA Rego fragment
  status: RuleStatusSchema,
  createdFromAi: z.boolean(),
  lineage: z.object({
    documentIds: z.array(z.string().uuid()),
    chunkIds: z.array(z.string()),
    modelId: z.string(),           // e.g. "gpt-4o-2024-08-06"
    promptVersion: z.string(),     // semver of the prompt template used
    promptHash: z.string(),        // SHA-256 of the rendered prompt
    retrievalParams: z.record(z.unknown()),
  }),
  createdAt: z.string().datetime(),
  approvedAt: z.string().datetime().optional(),
  approvedBy: z.string().uuid().optional(),
});
export type EngineRule = z.infer<typeof EngineRuleSchema>;

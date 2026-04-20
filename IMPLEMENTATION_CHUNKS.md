# AI Compliance Engine — Implementation Chunks

**Project Location:** `/Users/main/Security Apps/ai-compliance-engine/`  
**Specification Source:** `/Users/main/Agent Vault/Projects/AI Compliance Engine.md`  
**Document Version:** 1.0.0 (from spec)  
**Created:** March 29, 2026  
**Status:** Ready for implementation

---

## Quick Reference

- **Spec Document:** Always refer to `/Users/main/Agent Vault/Projects/AI Compliance Engine.md` for full technical details, code samples, schemas, and architecture diagrams.
- **This File:** Contains the chunked implementation plan. Update task status as you progress.

---

## PHASE 1: Foundation & Infrastructure (Days 1-3)
*Estimated: 4-6 hours*

| # | Task | Description | Files/Components | Status |
|---|------|-------------|------------------|--------|
| 1.1 | Initialize TypeScript project with Fastify, Zod, Vitest | `package.json`, `tsconfig.json`, `vite.config.ts` | ✅ |
| 1.2 | Set up directory structure per Section 3.3 | `src/{ai,compliance,api,core,infra}/` | ✅ |
| 1.3 | Configure environment config loader (no raw `process.env`) | `src/core/config.ts` | ✅ |
| 1.4 | Set up structured logging with Pino | `src/core/logger.ts` | ✅ |
| 1.5 | Define typed error classes | `src/core/errors.ts`, `src/core/constants.ts` | ✅ |
| 1.6 | Set up PostgreSQL + pgvector Docker Compose for local dev | `docker-compose.yml`, `infra/docker/` | ✅ |
| 1.7 | Create database schema (audit_events, document_chunks, engine_rules) | `infra/db/migrations/` | ✅ |
| 1.8 | Set up PostgreSQL client with connection pooling | `src/infra/db.ts` | ✅ |
| 1.9 | Implement secrets client abstraction (Vault/AWS/GCP) | `src/infra/secretsClient.ts` | ✅ |

---

## PHASE 2: Data Models & Types (Days 4-5)
*Estimated: 2-3 hours*

| # | Task | Description | Files | Status |
|---|------|-------------|-------|--------|
| 2.1 | Define Framework and Severity enums + Zod schemas | `src/ai/types.ts` (lines 1-30 from spec) | ✅ |
| 2.2 | Define ComplianceDocument model | `src/ai/types.ts` (lines 32-44 from spec) | ✅ |
| 2.3 | Define DocumentChunk model | `src/ai/types.ts` (lines 46-56 from spec) | ✅ |
| 2.4 | Define SystemState models (AWS S3, IAM, Linux) | `src/ai/types.ts` (lines 58-99 from spec) | ✅ |
| 2.5 | Define AiViolation and AiAnalysisResult schemas | `src/ai/types.ts` (lines 101-130 from spec) | ✅ |
| 2.6 | Define EngineRule schema with lineage | `src/ai/types.ts` (lines 132-158 from spec) | ✅ |
| 2.7 | Define AuditEvent model and write function | `src/infra/audit.ts` | ✅ |

---

## PHASE 3: Document Ingestion Pipeline (Days 6-8)
*Estimated: 6-8 hours*

| # | Task | Description | Files | Status |
|---|------|-------------|-------|--------|
| 3.1 | Implement Document Parser with sandboxed PDF/DOCX extraction | `src/ai/docParser.ts`, `src/ai/docParser.worker.ts` | ✅ |
| 3.2 | Add MIME type validation and size limits | `src/ai/docParser.ts` (lines 21-30 from spec) | ✅ |
| 3.3 | Implement checksum verification | `src/ai/docParser.ts` (lines 33-36 from spec) | ✅ |
| 3.4 | Build text normalization and whitespace cleanup | `src/ai/docParser.ts` (lines 48-54 from spec) | ✅ |
| 3.5 | Implement chunking with heading detection and overlap | `src/ai/docParser.ts` (lines 56-94 from spec) | ✅ |
| 3.6 | Build tag inference system for chunks | `src/ai/docParser.ts` (lines 96-111 from spec) | ✅ |
| 3.7 | Integrate audit logging for document parsing | `src/ai/docParser.ts` (lines 39-46 from spec) | ✅ |
| 3.8 | Write unit tests for parser (edge cases, malformed PDFs) | `tests/unit/docParser.test.ts` | ⬜ |

---

## PHASE 4: Embedding & Vector Store (Days 9-11)
*Estimated: 4-6 hours*

| # | Task | Description | Files | Status |
|---|------|-------------|-------|--------|
| 4.1 | Set up vector store abstraction with pgvector | `src/infra/vectorStore.ts` | ✅ |
| 4.2 | Implement tenant isolation in vector queries | `src/infra/vectorStore.ts` | ✅ |
| 4.3 | Build embedding engine with batch processing | `src/ai/embedding.ts` | ✅ |
| 4.4 | Add embedding client abstraction (OpenAI/Cohere/Ollama) | `src/ai/embedding.ts` | ✅ |
| 4.5 | Implement dimension validation | `src/ai/embedding.ts` (lines 72-79 from spec) | ✅ |
| 4.6 | Build query embedding function | `src/ai/embedding.ts` (lines 87-91 from spec) | ✅ |
| 4.7 | Write integration tests for tenant isolation | `tests/integration/vectorStore.test.ts` | ⬜ |

---

## PHASE 5: RAG Retriever (Days 12-13)
*Estimated: 3-4 hours*

| # | Task | Description | Files | Status |
|---|------|-------------|-------|--------|
| 5.1 | Implement similarity search with framework/tags filters | `src/ai/retriever.ts` | ✅ |
| 5.2 | Add similarity threshold filtering | `src/ai/retriever.ts` (lines 48-50 from spec) | ✅ |
| 5.3 | Build context text assembly with section references | `src/ai/retriever.ts` (lines 52-54 from spec) | ✅ |
| 5.4 | Add query hashing for audit (no raw queries in logs) | `src/ai/retriever.ts` (lines 34-35 from spec) | ✅ |
| 5.5 | Integrate audit logging for retrievals | `src/ai/retriever.ts` (lines 56-70 from spec) | ✅ |
| 5.6 | Write unit tests for retrieval | `tests/unit/retriever.test.ts` | ⬜ |

---

## PHASE 6: LLM Analyzer (Days 14-17)
*Estimated: 6-8 hours*

| # | Task | Description | Files | Status |
|---|------|-------------|-------|--------|
| 6.1 | Create versioned prompt templates system | `src/ai/promptTemplates.ts` | ✅ |
| 6.2 | Build structured compliance analysis prompt (v1.0.0) | `src/ai/promptTemplates.ts` (lines 12-56 from spec) | ✅ |
| 6.3 | Implement LLM Analyzer with fail-closed validation | `src/ai/llmAnalyzer.ts` | ✅ |
| 6.4 | Add JSON output parsing with markdown fence stripping | `src/ai/llmAnalyzer.ts` (lines 67-73 from spec) | ✅ |
| 6.5 | Implement Zod schema validation on LLM output | `src/ai/llmAnalyzer.ts` (lines 75-83 from spec) | ✅ |
| 6.6 | Build system state sanitization | `src/ai/llmAnalyzer.ts` (lines 97-108 from spec) | ✅ |
| 6.7 | Attach chunk traceability to violations | `src/ai/llmAnalyzer.ts` (lines 85-87 from spec) | ✅ |
| 6.8 | Integrate audit logging for AI analysis | `src/ai/llmAnalyzer.ts` (lines 89-103 from spec) | ✅ |
| 6.9 | Write tests for schema validation failures | `tests/unit/llmAnalyzer.test.ts` | ⬜ |

---

## PHASE 7: Rule Generation & Approval Workflow (Days 18-20)
*Estimated: 4-5 hours*

| # | Task | Description | Files | Status |
|---|------|-------------|-------|--------|
| 7.1 | Implement Rule Generator mapping violations to rules | `src/ai/ruleGenerator.ts` | ✅ |
| 7.2 | Enforce PROPOSED status (never auto-ACTIVE) | `src/ai/ruleGenerator.ts` (lines 34-35 from spec) | ✅ |
| 7.3 | Populate full lineage on each rule | `src/ai/ruleGenerator.ts` (lines 36-44 from spec) | ✅ |
| 7.4 | Build condition mapping (S3, IAM, Linux rules) | `src/ai/ruleGenerator.ts` (lines 68-93 from spec) | ✅ |
| 7.5 | Implement rule store with approval workflow | `src/compliance/ruleStore.ts` | ✅ |
| 7.6 | Enforce status machine (PROPOSED→ACTIVE requires human) | `src/compliance/ruleStore.ts` | ✅ |
| 7.7 | Write tests for rule generation and status enforcement | `tests/unit/ruleGenerator.test.ts` | ⬜ |

---

## PHASE 8: Compliance Engine & Adapter (Days 21-23)
*Estimated: 4-5 hours*

| # | Task | Description | Files | Status |
|---|------|-------------|-------|--------|
| 8.1 | Implement deterministic rule evaluator | `src/compliance/engine.ts` | ✅ |
| 8.2 | Build engine adapter (EngineRule → OPA Rego) | `src/compliance/engineAdapter.ts` | ✅ |
| 8.3 | Add Rego fragments for S3, IAM, Linux conditions | `src/compliance/engineAdapter.ts` (lines 15-55 from spec) | ✅ |
| 8.4 | Implement evaluation report generator | `src/compliance/evaluationReport.ts` | ✅ |
| 8.5 | Define system state collector interface | `src/compliance/systemState.ts` | ✅ |
| 8.6 | Write tests for engine evaluation | `tests/unit/engine.test.ts` | ⬜ |

---

## PHASE 9: API Layer & Middleware (Days 24-27)
*Estimated: 6-8 hours*

| # | Task | Description | Files | Status |
|---|------|-------------|-------|--------|
| 9.1 | Set up Fastify server bootstrap | `src/api/server.ts` | ✅ |
| 9.2 | Implement OIDC JWT auth middleware | `src/api/middleware/auth.ts` | ✅ |
| 9.3 | Build RBAC enforcement (security_engineer, compliance_auditor, etc.) | `src/api/middleware/auth.ts` | ✅ |
| 9.4 | Add rate limiting per tenant | `src/api/middleware/rateLimiter.ts` | ✅ |
| 9.5 | Implement correlation ID injection | `src/api/middleware/requestLogger.ts` | ✅ |
| 9.6 | Add Zod request validation middleware | `src/api/middleware/validate.ts` | ✅ |
| 9.7 | Build POST /documents endpoint | `src/api/routes/documents.ts` | ✅ |
| 9.8 | Build POST /evaluations endpoint | `src/api/routes/evaluations.ts` | ✅ |
| 9.9 | Build GET /evaluations/:id endpoint | `src/api/routes/evaluations.ts` | ✅ |
| 9.10 | Build POST /rules/:id/approve endpoint | `src/api/routes/rules.ts` | ✅ |
| 9.11 | Add health and readiness endpoints | `src/api/routes/health.ts` | ✅ |

---

## PHASE 10: Security Hardening (Days 28-30)
*Estimated: 4-6 hours*

| # | Task | Description | Files | Status |
|---|------|-------------|-------|--------|
| 10.1 | Implement STRIDE threat model controls | `src/infra/audit.ts`, various | ✅ |
| 10.2 | Add tenant isolation enforcement (DB + vector store) | `src/infra/db.ts`, `src/infra/vectorStore.ts` | ✅ |
| 10.3 | Implement row-level security in PostgreSQL | `infra/db/migrations/` | ✅ |
| 10.4 | Add prompt injection defenses | `src/ai/promptTemplates.ts`, `src/ai/llmAnalyzer.ts` | ✅ |
| 10.5 | Implement audit event immutability | `src/infra/audit.ts` | ✅ |
| 10.6 | Add SIEM forwarding (async, non-blocking) | `src/infra/audit.ts` (lines 34-36 from spec) | ✅ |
| 10.7 | Set up BullMQ for background jobs | `src/infra/queue.ts` | ✅ |
| 10.8 | Configure secure document parser sandbox | `infra/docker/parser.Dockerfile` | ✅ |

---

## PHASE 11: Deployment & Infrastructure (Days 31-33)
*Estimated: 4-6 hours*

| # | Task | Description | Files | Status |
|---|------|-------------|-------|--------|
| 11.1 | Create multi-stage Dockerfiles for each service | `infra/docker/` | ✅ |
| 11.2 | Build Helm chart for Kubernetes deployment | `infra/helm/` | ✅ |
| 11.3 | Create Terraform for cloud resources | `infra/terraform/` | ✅ |
| 11.4 | Configure secure container security contexts | `infra/helm/templates/` | ✅ |
| 11.5 | Set up mTLS between internal services | `infra/helm/` | ⬜ |
| 11.6 | Configure KMS encryption for secrets | `infra/terraform/` | ⬜ |

---

## PHASE 12: Testing Suite (Days 34-36)
*Estimated: 6-8 hours*

| # | Task | Description | Files | Status |
|---|------|-------------|-------|--------|
| 12.1 | Write unit tests for all AI modules | `tests/unit/*.test.ts` | ✅ |
| 12.2 | Create integration tests with testcontainers | `tests/integration/*.test.ts` | ✅ |
| 12.3 | Add contract tests for Zod schemas | `tests/unit/schemas.test.ts` | ⬜ |
| 12.4 | Write critical security test: tenant isolation | `tests/unit/retriever.test.ts` | ✅ |
| 12.5 | Write critical test: rule status enforcement | `tests/unit/ruleGenerator.test.ts` | ✅ |
| 12.6 | Write critical test: LLM output validation | `tests/unit/llmAnalyzer.test.ts` | ✅ |
| 12.7 | Set up SAST scanning (CodeQL) | `.github/workflows/security.yml` | ✅ |
| 12.8 | Add dependency scanning | `.github/workflows/security.yml` | ✅ |

---

## Background Summary

### System Overview
The AI Compliance Engine is an **enterprise-grade RAG-based compliance auditing system** that:
1. Ingests compliance documents (CIS, NIST, ISO)
2. Chunks and embeds them into a vector store (pgvector)
3. Retrieves relevant policy sections based on system state queries
4. Uses an LLM to analyze compliance violations with structured output
5. Generates deterministic rules that require **human approval** before activation
6. Evaluates real system states against approved rules

### Key Security Principles
- **Human-in-the-loop**: AI-generated rules are always PROPOSED, never auto-ACTIVE
- **Fail-closed**: Any LLM output that doesn't validate against Zod schema is rejected
- **Tenant isolation**: Every vector and DB query enforces tenant_id filtering
- **Full lineage**: Every rule tracks document IDs, chunk IDs, prompt hash, model version
- **Immutable audit**: Every action produces an append-only audit event

### Tech Stack
- **Backend:** TypeScript, Fastify, Zod
- **Database:** PostgreSQL + pgvector
- **AI:** Separate embedding + reasoning models (OpenAI/Ollama)
- **Queue:** BullMQ for background jobs
- **Deployment:** Docker, Kubernetes (Helm), Terraform

### Critical Constraints
- No auto-remediation in v1.0 (human execution only)
- No raw queries in logs (hashed only)
- No auto-approval of AI-generated rules
- Document parser runs in sandboxed worker

---

## Notes for Future Sessions

**When resuming work:**
1. Read the spec: `/Users/main/Agent Vault/Projects/AI Compliance Engine.md`
2. Check this chunks file for current progress
3. Update task status (⬜ → 🔄 → ✅) as you complete items
4. Log completed phases to MEMORY.md for long-term tracking

**Directory Structure to Create:**
```
/Users/main/Security Apps/ai-compliance-engine/
├── src/
│   ├── ai/              # AI modules (parser, embedding, retriever, analyzer, generator)
│   ├── compliance/      # Engine, adapter, rules, reports
│   ├── api/             # Fastify server, routes, middleware
│   ├── core/            # Config, logger, errors, constants
│   └── infra/           # DB, vector store, secrets, queue, audit
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── infra/
│   ├── docker/
│   ├── helm/
│   ├── terraform/
│   └── db/migrations/
└── IMPLEMENTATION_CHUNKS.md  (this file)
```

---

*Ready to begin implementation when you say GO.*

# AI Compliance Engine

**Location:** `/Users/main/Security Apps/ai-compliance-engine/`  
**Specification:** `/Users/main/Agent Vault/Projects/AI Compliance Engine.md`

Enterprise-grade AI-powered compliance auditing system with RAG-based policy interpretation.

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Edit .env with your configuration (see Environment Variables below)

# Start PostgreSQL and Redis
docker-compose up -d

# Run migrations
npm run db:migrate

# Start development server
npm run dev
```

## Architecture

The system follows a modular architecture with clear separation of concerns:

```
src/
├── ai/              # AI modules: parser, embedding, retriever, analyzer, generator
│   ├── docParser.ts          # Sandboxed PDF/DOCX extraction with chunking
│   ├── docParser.worker.ts   # Worker thread for unsafe document parsing
│   ├── embedding.ts          # Batch embedding generation (OpenAI/Ollama)
│   ├── retriever.ts          # ACL-enforced similarity search
│   ├── llmAnalyzer.ts        # Structured LLM analysis with Zod-validated output
│   ├── promptTemplates.ts    # Versioned, audited prompt templates
│   ├── ruleGenerator.ts      # AiViolation → EngineRule mapping with lineage
│   └── types.ts              # Core Zod schemas and TypeScript types
├── compliance/      # Engine, adapter, rules, reports
│   ├── engine.ts              # Deterministic rule evaluator
│   ├── engineAdapter.ts       # OPA Rego adapter for rule export
│   ├── evaluationReport.ts    # Report generation and risk scoring
│   ├── ruleStore.ts           # Rule CRUD with approval workflow
│   └── systemState.ts         # System state collectors interface
├── api/             # Fastify server, routes, middleware
│   ├── server.ts              # App bootstrap with CORS, auth, rate limiting
│   ├── middleware/
│   │   ├── auth.ts            # OIDC JWT verification via JWKS + RBAC
│   │   ├── rateLimiter.ts     # Per-tenant rate limiting
│   │   ├── requestLogger.ts   # Correlation ID injection and request logging
│   │   └── validate.ts        # Zod schema validation middleware
│   └── routes/
│       ├── health.ts          # /health, /health/ready, /health/live
│       ├── documents.ts       # Document upload, listing, retrieval
│       ├── evaluations.ts     # Evaluation triggering and results
│       └── rules.ts           # Rule listing, approval, rejection
├── core/            # Config, logger, errors, constants
│   ├── config.ts              # Zod-validated environment configuration
│   ├── logger.ts              # Pino structured logging with redaction
│   ├── errors.ts              # Typed error classes
│   └── constants.ts           # Framework enums, severity levels, RBAC roles
└── infra/           # DB, vector store, secrets, queue, audit
    ├── db.ts                  # PostgreSQL connection pool with tenant context
    ├── vectorStore.ts         # pgvector wrapper with tenant isolation
    ├── secretsClient.ts       # Vault/AWS/env secrets abstraction
    ├── queue.ts               # BullMQ job queues for background processing
    ├── audit.ts               # Immutable audit logging with SIEM forwarding
    ├── worker.ts              # Background worker entry point
    └── parserWorker.ts        # Sandboxed parser worker entry point
```

## Key Security Features

- **Human-in-the-loop**: AI-generated rules are always PROPOSED, never auto-ACTIVE
- **Fail-closed**: Any LLM output that doesn't validate against Zod schema is rejected
- **Tenant isolation**: Every vector and DB query enforces tenant_id filtering; PostgreSQL RLS policies enforce data isolation
- **Full lineage**: Every rule tracks document IDs, chunk IDs, prompt hash, model version
- **Immutable audit**: Every action produces an append-only audit event with SIEM forwarding
- **JWT verification**: Full JWKS-based signature verification with issuer validation (no unsigned token bypasses)
- **Rate limiting**: Per-tenant rate limiting with proper 429 status codes
- **Input validation**: Zod schemas validate all request bodies; checksum verification on file uploads
- **Sandboxed parsing**: PDF/DOCX parsing runs in isolated worker threads
- **Pino redaction**: Sensitive fields (API keys, tokens, passwords) are redacted from logs

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/health` | GET | None | Health check |
| `/health/ready` | GET | None | Readiness check (DB, vector store, Redis) |
| `/health/live` | GET | None | Liveness check |
| `/api/v1/documents` | POST | security_engineer | Upload compliance document (multipart) |
| `/api/v1/documents` | GET | security_engineer | List documents (paginated) |
| `/api/v1/documents/:id` | GET | security_engineer | Get document metadata |
| `/api/v1/evaluations` | POST | security_engineer | Trigger evaluation |
| `/api/v1/evaluations` | GET | compliance_auditor | List evaluations (paginated) |
| `/api/v1/evaluations/:id` | GET | compliance_auditor | Get evaluation results |
| `/api/v1/rules` | GET | security_engineer | List rules with filters |
| `/api/v1/rules/:id` | GET | security_engineer | Get rule details |
| `/api/v1/rules/:id/approve` | POST | security_engineer | Approve a proposed rule |
| `/api/v1/rules/:id/reject` | POST | security_engineer | Reject a proposed rule |

## Background Processing

Document parsing and evaluation run via **BullMQ job queues** (Redis-backed):

- `document-processing` queue — processes uploaded documents (parsing, chunking, embedding)
- `evaluations` queue — runs compliance evaluations against system state  
- `embeddings` queue — generates vector embeddings for document chunks

Start the background workers:
```bash
# API + background workers (via docker-compose)
docker-compose up -d

# Or run workers separately:
node dist/infra/worker.js      # Evaluation + embedding worker
node dist/infra/parserWorker.js # Document parsing worker (sandboxed)
```

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production (TypeScript → dist/)
- `npm run start` - Start production server
- `npm run test` - Run tests
- `npm run test:coverage` - Run tests with coverage report
- `npm run lint` - Lint source files
- `npm run typecheck` - Type-check without emitting
- `npm run db:migrate` - Run database migrations
- `npm run db:seed` - Seed database with test data

## Environment Variables

See `.env.example` for the full list. Required variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `OIDC_ISSUER_URL` | OIDC provider URL for JWT verification |
| `OIDC_CLIENT_ID` | OIDC client ID |
| `OIDC_CLIENT_SECRET` | OIDC client secret |
| `JWT_SECRET` | Minimum 32 characters (used for fallback signing) |
| `EMBEDDING_API_KEY` | API key for embedding model |
| `REASONING_MODEL_API_KEY` | API key for reasoning model |
| `REDIS_URL` | Redis URL for BullMQ queues |
| `SECRETS_PROVIDER` | One of: `env`, `vault`, `aws` |

## Infrastructure

- **Docker Compose**: PostgreSQL (pgvector), Redis, parser worker, API, background worker
- **Helm Chart**: K8s deployment with HPA, secrets management, health probes
- **Terraform**: EKS cluster, RDS PostgreSQL, ElastiCache Redis

## License

ISC
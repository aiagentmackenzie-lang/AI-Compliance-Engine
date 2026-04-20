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
# Edit .env with your configuration

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
├── compliance/      # Engine, adapter, rules, reports
├── api/             # Fastify server, routes, middleware
├── core/            # Config, logger, errors, constants
└── infra/           # DB, vector store, secrets, queue, audit
```

## Key Security Features

- **Human-in-the-loop**: AI-generated rules are always PROPOSED, never auto-ACTIVE
- **Fail-closed**: Any LLM output that doesn't validate against Zod schema is rejected
- **Tenant isolation**: Every vector and DB query enforces tenant_id filtering
- **Full lineage**: Every rule tracks document IDs, chunk IDs, prompt hash, model version
- **Immutable audit**: Every action produces an append-only audit event

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/health/ready` | GET | Readiness check |
| `/api/v1/documents` | POST | Upload compliance document |
| `/api/v1/documents` | GET | List documents |
| `/api/v1/documents/:id` | GET | Get document metadata |
| `/api/v1/evaluations` | POST | Trigger evaluation |
| `/api/v1/evaluations` | GET | List evaluations |
| `/api/v1/evaluations/:id` | GET | Get evaluation results |
| `/api/v1/rules` | GET | List rules |
| `/api/v1/rules/:id` | GET | Get rule details |
| `/api/v1/rules/:id/approve` | POST | Approve a proposed rule |
| `/api/v1/rules/:id/reject` | POST | Reject a proposed rule |

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run test` - Run tests
- `npm run db:migrate` - Run database migrations
- `npm run db:seed` - Seed database with test data

## Environment Variables

See `.env.example` for required configuration.

## License

ISC

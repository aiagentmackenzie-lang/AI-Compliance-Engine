-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Audit events table (immutable, append-only)
CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type TEXT NOT NULL,
  tenant_id UUID NOT NULL,
  principal_id UUID NOT NULL,
  correlation_id UUID NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILURE', 'PARTIAL')),
  metadata JSONB NOT NULL DEFAULT '{}',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_ip INET
);

-- Row-level security for audit events
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_audit ON audit_events
  USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_id ON audit_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp ON audit_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_events_correlation_id ON audit_events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_event_type ON audit_events(event_type);

-- Compliance documents table
CREATE TABLE IF NOT EXISTS compliance_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  title TEXT NOT NULL CHECK (length(title) > 0 AND length(title) <= 512),
  framework TEXT NOT NULL,
  framework_version TEXT NOT NULL CHECK (length(framework_version) <= 64),
  source_path TEXT NOT NULL,
  checksum TEXT NOT NULL, -- SHA-256 hex
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL
);

ALTER TABLE compliance_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_documents ON compliance_documents
  USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

CREATE INDEX IF NOT EXISTS idx_compliance_documents_tenant_id ON compliance_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_compliance_documents_framework ON compliance_documents(framework);

-- Document chunks table with vector embeddings
CREATE TABLE IF NOT EXISTS document_chunks (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL,
  document_id UUID NOT NULL REFERENCES compliance_documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  text TEXT NOT NULL CHECK (length(text) > 0 AND length(text) <= 8000),
  section_ref TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  embedding VECTOR(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_chunks ON document_chunks
  USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Vector index for similarity search
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding ON document_chunks 
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_document_chunks_tenant_id ON document_chunks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks(document_id);

-- Engine rules table
CREATE TABLE IF NOT EXISTS engine_rules (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL,
  policy_reference TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  remediation TEXT NOT NULL,
  condition JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'APPROVED', 'ACTIVE', 'DEPRECATED', 'REJECTED')),
  created_from_ai BOOLEAN NOT NULL DEFAULT TRUE,
  lineage JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  approved_by UUID
);

ALTER TABLE engine_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_rules ON engine_rules
  USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

CREATE INDEX IF NOT EXISTS idx_engine_rules_tenant_id ON engine_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_engine_rules_status ON engine_rules(status);
CREATE INDEX IF NOT EXISTS idx_engine_rules_severity ON engine_rules(severity);

-- Evaluations table
CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL,
  system_id TEXT NOT NULL,
  framework TEXT NOT NULL,
  framework_version TEXT NOT NULL,
  system_state JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED')),
  overall_risk TEXT CHECK (overall_risk IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  violations JSONB NOT NULL DEFAULT '[]',
  passed_rules INT DEFAULT 0,
  failed_rules INT DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_evaluations ON evaluations
  USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

CREATE INDEX IF NOT EXISTS idx_evaluations_tenant_id ON evaluations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_status ON evaluations(status);
CREATE INDEX IF NOT EXISTS idx_evaluations_created_at ON evaluations(created_at);

-- Create function to set tenant context
CREATE OR REPLACE FUNCTION set_tenant_context(tenant_id UUID)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.current_tenant_id', tenant_id::TEXT, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

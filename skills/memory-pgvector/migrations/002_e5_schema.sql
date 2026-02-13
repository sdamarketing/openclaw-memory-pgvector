-- OpenClaw Memory Schema for PostgreSQL + pgvector
-- E5-large-v2: 1024 dimensions

-- ============================================================================
-- Table: memories (simplified unified memory store)
-- ============================================================================

CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    session_id TEXT,
    
    -- Memory content
    content TEXT NOT NULL,
    memory_type TEXT NOT NULL DEFAULT 'fact',
    
    -- Embedding (e5-large-v2 = 1024 dims)
    embedding vector(1024),
    
    -- Metadata
    importance REAL DEFAULT 0.7,
    confidence REAL DEFAULT 1.0,
    metadata JSONB DEFAULT '{}',
    
    -- Source tracking
    source_type TEXT,
    source_id TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- HNSW Vector Index (for fast semantic search)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories 
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ============================================================================
-- Regular Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_session_id ON memories(session_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC);

-- ============================================================================
-- Updated_at trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_memories_updated_at 
    BEFORE UPDATE ON memories 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Grant permissions
-- ============================================================================

GRANT ALL ON ALL TABLES IN SCHEMA public TO openclaw;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO openclaw;

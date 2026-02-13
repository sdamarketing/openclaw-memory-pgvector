-- OpenClaw Memory Schema for PostgreSQL + pgvector
-- Migration: 001_init

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

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
    -- Types: 'preference', 'decision', 'fact', 'entity', 'experience', 'session_summary', 'other'
    
    -- Embedding (e5-large-v2 = 1024 dims, OpenAI = 1536 dims)
    embedding vector(1536),
    
    -- Metadata
    importance REAL DEFAULT 0.7,
    confidence REAL DEFAULT 1.0,
    metadata JSONB DEFAULT '{}',
    
    -- Source tracking
    source_type TEXT,  -- 'conversation', 'file', 'manual'
    source_id TEXT,    -- reference to original source
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ  -- optional expiration
    
    -- Constraints
    CONSTRAINT valid_memory_type CHECK (memory_type IN (
        'preference', 'decision', 'fact', 'entity', 
        'experience', 'session_summary', 'file_chunk', 'other'
    )),
    CONSTRAINT valid_importance CHECK (importance >= 0 AND importance <= 1),
    CONSTRAINT valid_confidence CHECK (confidence >= 0 AND confidence <= 1)
);

-- ============================================================================
-- Table: requests (user queries)
-- ============================================================================

CREATE TABLE IF NOT EXISTS requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    session_id TEXT,
    
    message_text TEXT NOT NULL,
    embedding vector(1536),
    
    has_files BOOLEAN DEFAULT FALSE,
    telegram_message_id BIGINT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Table: responses (assistant responses)
-- ============================================================================

CREATE TABLE IF NOT EXISTS responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    
    response_text TEXT NOT NULL,
    embedding vector(1536),
    
    summary TEXT,
    summary_embedding vector(1536),
    
    feedback SMALLINT,  -- 1 = positive, -1 = negative, NULL = no feedback
    model_used TEXT,
    tokens_used INTEGER,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Table: files (uploaded documents)
-- ============================================================================

CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID REFERENCES requests(id) ON DELETE SET NULL,
    user_id TEXT NOT NULL,
    
    file_type TEXT NOT NULL,  -- 'markdown', 'pdf', 'image', 'code', 'text'
    original_name TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    
    extracted_text TEXT,
    embedding vector(1536),
    
    chunk_count INTEGER DEFAULT 0,
    file_size INTEGER,
    mime_type TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Table: file_chunks (chunks of large files)
-- ============================================================================

CREATE TABLE IF NOT EXISTS file_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    embedding vector(1536),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(file_id, chunk_index)
);

-- ============================================================================
-- HNSW Vector Indexes (for fast semantic search)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories 
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_requests_embedding ON requests 
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_responses_embedding ON responses 
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_responses_summary_embedding ON responses 
    USING hnsw (summary_embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_files_embedding ON files 
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_file_chunks_embedding ON file_chunks 
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ============================================================================
-- Regular Indexes (for filtering and sorting)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_session_id ON memories(session_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);

CREATE INDEX IF NOT EXISTS idx_requests_user_id ON requests(user_id);
CREATE INDEX IF NOT EXISTS idx_requests_session_id ON requests(session_id);
CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_responses_request_id ON responses(request_id);
CREATE INDEX IF NOT EXISTS idx_responses_created_at ON responses(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_request_id ON files(request_id);

CREATE INDEX IF NOT EXISTS idx_file_chunks_file_id ON file_chunks(file_id);

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
-- Helper function: semantic search
-- ============================================================================

CREATE OR REPLACE FUNCTION search_memories(
    query_embedding vector(1536),
    p_user_id TEXT DEFAULT NULL,
    p_memory_type TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 10,
    p_threshold REAL DEFAULT 0.3
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    memory_type TEXT,
    importance REAL,
    confidence REAL,
    metadata JSONB,
    created_at TIMESTAMPTZ,
    similarity REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        m.id,
        m.content,
        m.memory_type,
        m.importance,
        m.confidence,
        m.metadata,
        m.created_at,
        (1 - (m.embedding <=> query_embedding))::REAL AS similarity
    FROM memories m
    WHERE 
        (p_user_id IS NULL OR m.user_id = p_user_id)
        AND (p_memory_type IS NULL OR m.memory_type = p_memory_type)
        AND (1 - (m.embedding <=> query_embedding)) >= p_threshold
    ORDER BY m.embedding <=> query_embedding
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Helper function: search responses
-- ============================================================================

CREATE OR REPLACE FUNCTION search_responses(
    query_embedding vector(1536),
    p_user_id TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 5,
    p_threshold REAL DEFAULT 0.3
)
RETURNS TABLE (
    id UUID,
    request_id UUID,
    response_text TEXT,
    summary TEXT,
    similarity REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.id,
        r.request_id,
        r.response_text,
        r.summary,
        (1 - (r.summary_embedding <=> query_embedding))::REAL AS similarity
    FROM responses r
    JOIN requests req ON r.request_id = req.id
    WHERE 
        (p_user_id IS NULL OR req.user_id = p_user_id)
        AND r.summary_embedding IS NOT NULL
        AND (1 - (r.summary_embedding <=> query_embedding)) >= p_threshold
    ORDER BY r.summary_embedding <=> query_embedding
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Helper function: search file chunks
-- ============================================================================

CREATE OR REPLACE FUNCTION search_file_chunks(
    query_embedding vector(1536),
    p_user_id TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 5,
    p_threshold REAL DEFAULT 0.3
)
RETURNS TABLE (
    id UUID,
    file_id UUID,
    chunk_index INTEGER,
    chunk_text TEXT,
    original_name TEXT,
    similarity REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        fc.id,
        fc.file_id,
        fc.chunk_index,
        fc.chunk_text,
        f.original_name,
        (1 - (fc.embedding <=> query_embedding))::REAL AS similarity
    FROM file_chunks fc
    JOIN files f ON fc.file_id = f.id
    WHERE 
        (p_user_id IS NULL OR f.user_id = p_user_id)
        AND (1 - (fc.embedding <=> query_embedding)) >= p_threshold
    ORDER BY fc.embedding <=> query_embedding
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

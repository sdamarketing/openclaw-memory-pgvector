-- Migration: 002_full_conversation
-- Full conversation tracking with reasoning

-- Drop old tables with wrong vector dimensions
DROP TABLE IF EXISTS file_chunks CASCADE;
DROP TABLE IF EXISTS files CASCADE;
DROP TABLE IF EXISTS responses CASCADE;
DROP TABLE IF EXISTS requests CASCADE;
DROP TABLE IF EXISTS reasoning CASCADE;
DROP TABLE IF EXISTS memories CASCADE;

-- ============================================================================
-- Table: memories (facts, preferences, entities)
-- ============================================================================

CREATE TABLE memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    session_id TEXT,
    
    content TEXT NOT NULL,
    memory_type TEXT NOT NULL DEFAULT 'fact',
    embedding vector(1024),
    
    importance REAL DEFAULT 0.7,
    confidence REAL DEFAULT 1.0,
    metadata JSONB DEFAULT '{}',
    
    source_type TEXT,
    source_id TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    
    CONSTRAINT valid_memory_type CHECK (memory_type IN (
        'preference', 'decision', 'fact', 'entity', 
        'experience', 'session_summary', 'file_chunk', 'other'
    ))
);

-- ============================================================================
-- Table: requests (user messages)
-- ============================================================================

CREATE TABLE requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    session_id TEXT,
    
    message_text TEXT NOT NULL,
    embedding vector(1024),
    
    has_files BOOLEAN DEFAULT FALSE,
    telegram_message_id BIGINT,
    telegram_chat_id BIGINT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Table: reasoning (LLM chain of thought)
-- ============================================================================

CREATE TABLE reasoning (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    
    reasoning_text TEXT NOT NULL,
    embedding vector(1024),
    
    thinking_model TEXT,
    thinking_tokens INTEGER,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Table: responses (assistant messages)
-- ============================================================================

CREATE TABLE responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    
    response_text TEXT NOT NULL,
    embedding vector(1024),
    
    summary TEXT,
    summary_embedding vector(1024),
    
    feedback SMALLINT,
    model_used TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Table: files (uploaded documents)
-- ============================================================================

CREATE TABLE files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID REFERENCES requests(id) ON DELETE SET NULL,
    user_id TEXT NOT NULL,
    
    file_type TEXT NOT NULL,
    original_name TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    
    extracted_text TEXT,
    embedding vector(1024),
    
    chunk_count INTEGER DEFAULT 0,
    file_size INTEGER,
    mime_type TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Table: file_chunks (chunks of large files)
-- ============================================================================

CREATE TABLE file_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    embedding vector(1024),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(file_id, chunk_index)
);

-- ============================================================================
-- Vector Indexes (HNSW for fast semantic search)
-- ============================================================================

CREATE INDEX idx_memories_embedding ON memories 
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_requests_embedding ON requests 
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_reasoning_embedding ON reasoning 
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_responses_embedding ON responses 
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_responses_summary_embedding ON responses 
    USING hnsw (summary_embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_files_embedding ON files 
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_file_chunks_embedding ON file_chunks 
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ============================================================================
-- Regular Indexes
-- ============================================================================

CREATE INDEX idx_memories_user_id ON memories(user_id);
CREATE INDEX idx_memories_session_id ON memories(session_id);
CREATE INDEX idx_memories_type ON memories(memory_type);
CREATE INDEX idx_memories_created_at ON memories(created_at DESC);

CREATE INDEX idx_requests_user_id ON requests(user_id);
CREATE INDEX idx_requests_session_id ON requests(session_id);
CREATE INDEX idx_requests_created_at ON requests(created_at DESC);

CREATE INDEX idx_reasoning_request_id ON reasoning(request_id);
CREATE INDEX idx_reasoning_created_at ON reasoning(created_at DESC);

CREATE INDEX idx_responses_request_id ON responses(request_id);
CREATE INDEX idx_responses_created_at ON responses(created_at DESC);

CREATE INDEX idx_files_user_id ON files(user_id);
CREATE INDEX idx_files_request_id ON files(request_id);

CREATE INDEX idx_file_chunks_file_id ON file_chunks(file_id);

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
-- Helper function: unified context search
-- ============================================================================

CREATE OR REPLACE FUNCTION search_context(
    query_embedding vector(1024),
    p_user_id TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 10,
    p_threshold REAL DEFAULT 0.25
)
RETURNS TABLE (
    source TEXT,
    content TEXT,
    similarity REAL,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    -- Memories
    SELECT 
        'memory'::TEXT AS source,
        m.content,
        (1 - (m.embedding <=> query_embedding))::REAL AS similarity,
        m.created_at
    FROM memories m
    WHERE 
        (p_user_id IS NULL OR m.user_id = p_user_id)
        AND m.embedding IS NOT NULL
        AND (1 - (m.embedding <=> query_embedding)) >= p_threshold
    
    UNION ALL
    
    -- Requests
    SELECT 
        'request'::TEXT AS source,
        r.message_text AS content,
        (1 - (r.embedding <=> query_embedding))::REAL AS similarity,
        r.created_at
    FROM requests r
    WHERE 
        (p_user_id IS NULL OR r.user_id = p_user_id)
        AND r.embedding IS NOT NULL
        AND (1 - (r.embedding <=> query_embedding)) >= p_threshold
    
    UNION ALL
    
    -- Responses (using summary)
    SELECT 
        'response'::TEXT AS source,
        COALESCE(resp.summary, resp.response_text) AS content,
        (1 - (COALESCE(resp.summary_embedding, resp.embedding) <=> query_embedding))::REAL AS similarity,
        resp.created_at
    FROM responses resp
    JOIN requests req ON resp.request_id = req.id
    WHERE 
        (p_user_id IS NULL OR req.user_id = p_user_id)
        AND COALESCE(resp.summary_embedding, resp.embedding) IS NOT NULL
        AND (1 - (COALESCE(resp.summary_embedding, resp.embedding) <=> query_embedding)) >= p_threshold
    
    UNION ALL
    
    -- File chunks
    SELECT 
        'file'::TEXT AS source,
        fc.chunk_text AS content,
        (1 - (fc.embedding <=> query_embedding))::REAL AS similarity,
        fc.created_at
    FROM file_chunks fc
    JOIN files f ON fc.file_id = f.id
    WHERE 
        (p_user_id IS NULL OR f.user_id = p_user_id)
        AND fc.embedding IS NOT NULL
        AND (1 - (fc.embedding <=> query_embedding)) >= p_threshold
    
    ORDER BY similarity DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Stats view
-- ============================================================================

CREATE OR REPLACE VIEW conversation_stats AS
SELECT 
    (SELECT COUNT(*) FROM memories) AS total_memories,
    (SELECT COUNT(*) FROM requests) AS total_requests,
    (SELECT COUNT(*) FROM responses) AS total_responses,
    (SELECT COUNT(*) FROM reasoning) AS total_reasoning,
    (SELECT COUNT(*) FROM files) AS total_files,
    (SELECT COUNT(*) FROM file_chunks) AS total_chunks,
    (SELECT COUNT(DISTINCT user_id) FROM requests) AS unique_users;

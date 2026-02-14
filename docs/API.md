# OpenClaw Memory Plugin (PostgreSQL + pgvector) - API Reference

**Version:** 1.1.0
**License:** MIT
**Repository:** [sdamarketing/openclaw-memory-pgvector](https://github.com/sdamarketing/openclaw-memory-pgvector)

---

## Table of Contents

1. [Overview](#overview)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [TypeScript API](#typescript-api)
5. [Database Schema](#database-schema)
6. [SQL Functions](#sql-functions)
7. [Tools API](#tools-api)
8. [CLI Commands](#cli-commands)
9. [Lifecycle Hooks](#lifecycle-hooks)
10. [E5 Embedding Server](#e5-embedding-server)
11. [Error Handling](#error-handling)
12. [Examples](#examples)

---

## Overview

The OpenClaw Memory Plugin provides long-term memory storage with semantic search capabilities for AI conversations. It uses PostgreSQL with the `pgvector` extension for vector similarity search.

### Features

- **Multiple Embedding Providers**: OpenAI, E5-local, Z.AI
- **Semantic Search**: Fast vector similarity search using HNSW indexes
- **Auto-Capture**: Automatically extracts important information from conversations
- **Auto-Recall**: Injects relevant context into new conversations
- **Full Conversation Tracking**: Stores requests, responses, reasoning, and files
- **Multi-language Support**: Supports English, Russian, Czech, and more
- **GDPR Compliant**: Memory forget functionality for data deletion

---

## Installation

```bash
# Install dependencies
npm install

# Build the plugin
npm run build

# Setup PostgreSQL database
psql -U postgres -c "CREATE DATABASE openclaw_memory;"
psql -U postgres -d openclaw_memory -c "CREATE EXTENSION vector;"

# Run migrations (handled automatically by plugin)
```

### Requirements

- Node.js >= 18.0.0
- PostgreSQL with pgvector extension
- Python 3.x (for E5-local embedding provider)

---

## Configuration

### Configuration Schema

The plugin configuration follows the `MemoryConfig` type definition:

```typescript
type MemoryConfig = {
  database: {
    host: string;        // PostgreSQL server hostname
    port: number;        // PostgreSQL server port (default: 5432)
    database: string;    // Database name
    user: string;        // PostgreSQL username
    password?: string;   // PostgreSQL password (or use ${PGPASSWORD})
    ssl?: boolean;       // Use SSL connection
  };
  embedding: {
    provider: "openai" | "e5-local" | "zai";
    model?: string;      // Embedding model name
    apiKey?: string;     // API key for embeddings
    e5Endpoint?: string; // Local E5 service URL
  };
  autoCapture?: boolean;   // Default: true
  autoRecall?: boolean;    // Default: true
  sessionSummaries?: boolean;
  zaiApiKey?: string;
};
```

### Environment Variables

The plugin supports environment variable substitution in configuration values:

```json
{
  "database": {
    "password": "${PGPASSWORD}"
  },
  "embedding": {
    "apiKey": "${OPENAI_API_KEY}"
  }
}
```

### Configuration Options

#### Database Configuration

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `host` | `string` | Yes | `localhost` | PostgreSQL server hostname |
| `port` | `number` | No | `5432` | PostgreSQL server port |
| `database` | `string` | Yes | `openclaw_memory` | Database name |
| `user` | `string` | Yes | `postgres` | PostgreSQL username |
| `password` | `string` | No | - | Database password |
| `ssl` | `boolean` | No | `false` | Use SSL for connection |

#### Embedding Configuration

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `provider` | `string` | Yes | - | One of: `"openai"`, `"e5-local"`, `"zai"` |
| `model` | `string` | No | Varies | Embedding model name |
| `apiKey` | `string` | No | - | API key for the provider |
| `e5Endpoint` | `string` | No | `http://127.0.0.1:8765` | E5 server URL |

#### Feature Flags

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `autoCapture` | `boolean` | No | `true` | Auto-extract memories from conversations |
| `autoRecall` | `boolean` | No | `true` | Auto-inject relevant context |
| `sessionSummaries` | `boolean` | No | `false` | Store session summaries |
| `zaiApiKey` | `string` | No | - | API key for Z.AI summarization |

### Supported Embedding Models

| Provider | Model | Dimensions | Notes |
|----------|-------|------------|-------|
| OpenAI | `text-embedding-3-small` | 1536 | Default for OpenAI |
| OpenAI | `text-embedding-3-large` | 3072 | Higher quality |
| Z.AI | `embedding-3` | 1024 | Z.AI default |
| E5-local | `e5-large-v2` | 1024 | Multilingual support |

---

## TypeScript API

### Exported Types

#### `MemoryConfig`

```typescript
type MemoryConfig = {
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password?: string;
    ssl?: boolean;
  };
  embedding: {
    provider: "openai" | "e5-local" | "zai";
    model?: string;
    apiKey?: string;
    e5Endpoint?: string;
  };
  autoCapture?: boolean;
  autoRecall?: boolean;
  sessionSummaries?: boolean;
  zaiApiKey?: string;
};
```

Configuration object for the memory plugin.

#### `MemoryCategory`

```typescript
type MemoryCategory =
  | "preference"      // User preferences and likes/dislikes
  | "decision"        // Decisions made or actions to take
  | "fact"           // Factual information
  | "entity"         // Named entities (people, organizations)
  | "experience"     // Past experiences
  | "session_summary" // Session summaries
  | "file_chunk"     // File content chunks
  | "other";         // Other information
```

Categories for classifying stored memories.

#### `MEMORY_CATEGORIES`

```typescript
const MEMORY_CATEGORIES: readonly MemoryCategory[];
// = ["preference", "decision", "fact", "entity", "experience", "session_summary", "file_chunk", "other"]
```

Constant array of all valid memory categories.

---

### Configuration Functions

#### `memoryConfigSchema`

Configuration schema with parsing and validation.

```typescript
const memoryConfigSchema = {
  parse(value: unknown): MemoryConfig;
  uiHints: Record<string, {
    label?: string;
    placeholder?: string;
    help?: string;
    sensitive?: boolean;
  }>;
};
```

**Methods:**

- **`parse(value: unknown): MemoryConfig`** - Parses and validates configuration

  **Parameters:**
  - `value` - Raw configuration object

  **Returns:** Validated `MemoryConfig` object

  **Throws:** `Error` if configuration is invalid or missing required fields

  **Example:**
  ```typescript
  const config = memoryConfigSchema.parse({
    database: { host: "localhost", database: "memories", user: "postgres" },
    embedding: { provider: "openai" }
  });
  ```

#### `vectorDimsForModel`

```typescript
function vectorDimsForModel(
  model: string | undefined,
  provider?: string
): number;
```

Returns the vector dimension for a given embedding model.

**Parameters:**
- `model` - Model name (e.g., `"text-embedding-3-small"`)
- `provider` - Embedding provider name

**Returns:** Number of dimensions (1024, 1536, or 3072)

**Example:**
```typescript
const dims = vectorDimsForModel("text-embedding-3-small", "openai");
// Returns: 1536
```

---

### Classes

#### `MemoryDB`

Main database interface for memory storage and retrieval.

```typescript
class MemoryDB {
  constructor(
    config: MemoryConfig["database"],
    vectorDim: number,
    logger: OpenClawPluginApi["logger"]
  );
  // Methods...
}
```

**Constructor Parameters:**
- `config` - Database configuration object
- `vectorDim` - Vector dimension for embeddings
- `logger` - Logger instance for diagnostics

**Methods:**

##### `store()`

```typescript
async store(
  entry: Omit<MemoryEntry, "id" | "createdAt"> & { embedding?: number[] }
): Promise<MemoryEntry>;
```

Stores a new memory entry.

**Parameters:**
```typescript
{
  userId: string;              // User identifier
  sessionId?: string;          // Optional session identifier
  content: string;             // Memory content
  memoryType: MemoryCategory;  // Memory category
  embedding?: number[];         // Optional pre-computed embedding
  importance: number;          // 0-1 importance score
  confidence: number;          // 0-1 confidence score
  metadata: Record<string, unknown>; // Additional metadata
}
```

**Returns:** Complete `MemoryEntry` with generated `id` and `createdAt`

**Example:**
```typescript
const entry = await db.store({
  userId: "user123",
  content: "User prefers TypeScript over JavaScript",
  memoryType: "preference",
  embedding: [0.1, 0.2, ...],
  importance: 0.8,
  confidence: 1.0,
  metadata: { source: "conversation" }
});
```

##### `search()`

```typescript
async search(
  embedding: number[],
  userId: string,
  limit?: number,
  minScore?: number,
  memoryType?: MemoryCategory
): Promise<MemorySearchResult[]>;
```

Searches for similar memories using vector similarity.

**Parameters:**
- `embedding` - Query embedding vector
- `userId` - User identifier to scope search
- `limit` - Maximum results (default: 5)
- `minScore` - Minimum similarity score 0-1 (default: 0.3)
- `memoryType` - Optional filter by memory type

**Returns:** Array of `MemorySearchResult` objects

**Example:**
```typescript
const results = await db.search(
  queryEmbedding,
  "user123",
  10,    // limit
  0.5,   // minScore
  "preference" // memoryType
);
```

##### `delete()`

```typescript
async delete(id: string, userId: string): Promise<boolean>;
```

Deletes a memory by ID (scoped to user).

**Parameters:**
- `id` - Memory UUID to delete
- `userId` - User identifier (for security)

**Returns:** `true` if deleted, `false` if not found

**Example:**
```typescript
const deleted = await db.delete("uuid-here", "user123");
```

##### `count()`

```typescript
async count(userId?: string): Promise<number>;
```

Counts stored memories.

**Parameters:**
- `userId` - Optional user filter (count all if omitted)

**Returns:** Total count of memories

**Example:**
```typescript
const allCount = await db.count();
const userCount = await db.count("user123");
```

##### `close()`

```typescript
async close(): Promise<void>;
```

Closes the database connection pool.

**Example:**
```typescript
await db.close();
```

##### `saveRequest()`

```typescript
async saveRequest(params: {
  userId: string;
  sessionId?: string;
  messageText: string;
  embedding?: number[];
  telegramMessageId?: bigint;
  telegramChatId?: bigint;
  hasFiles?: boolean;
}): Promise<string>;
```

Saves a user request/message.

**Parameters:**
- `userId` - User identifier
- `sessionId` - Optional session identifier
- `messageText` - Message content
- `embedding` - Optional message embedding
- `telegramMessageId` - Optional Telegram message ID
- `telegramChatId` - Optional Telegram chat ID
- `hasFiles` - Whether request includes files

**Returns:** Request UUID

##### `saveResponse()`

```typescript
async saveResponse(params: {
  requestId: string;
  responseText: string;
  embedding?: number[];
  summary?: string;
  summaryEmbedding?: number[];
  modelUsed?: string;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<string>;
```

Saves an assistant response.

**Parameters:**
- `requestId` - Associated request UUID
- `responseText` - Response content
- `embedding` - Optional response embedding
- `summary` - Optional summary text
- `summaryEmbedding` - Optional summary embedding
- `modelUsed` - Model name
- `inputTokens` - Input token count
- `outputTokens` - Output token count

**Returns:** Response UUID

##### `saveReasoning()`

```typescript
async saveReasoning(params: {
  requestId: string;
  reasoningText: string;
  embedding?: number[];
  thinkingModel?: string;
  thinkingTokens?: number;
}): Promise<string>;
```

Saves LLM reasoning/thinking process.

**Parameters:**
- `requestId` - Associated request UUID
- `reasoningText` - Reasoning content
- `embedding` - Optional reasoning embedding
- `thinkingModel` - Model name
- `thinkingTokens` - Token count

**Returns:** Reasoning UUID

##### `searchContext()`

```typescript
async searchContext(
  embedding: number[],
  userId: string,
  limit?: number,
  minScore?: number
): Promise<Array<{
  source: string;
  content: string;
  similarity: number;
}>>;
```

Unified search across all context sources (memories, requests, responses, files).

**Parameters:**
- `embedding` - Query embedding
- `userId` - User identifier
- `limit` - Maximum results (default: 10)
- `minScore` - Minimum similarity (default: 0.25)

**Returns:** Array of context items with source, content, and similarity

##### `getStats()`

```typescript
async getStats(): Promise<{
  totalMemories: number;
  totalRequests: number;
  totalResponses: number;
  totalReasoning: number;
  totalFiles: number;
  totalChunks: number;
  uniqueUsers: number;
}>;
```

Returns database statistics.

---

### Embedding Provider Classes

#### `OpenAIEmbeddings`

```typescript
class OpenAIEmbeddings implements EmbeddingProviderInterface {
  constructor(apiKey: string, model: string, baseUrl?: string);
  async embed(text: string, type: "query" | "passage"): Promise<number[]>;
}
```

OpenAI embeddings provider.

**Constructor Parameters:**
- `apiKey` - OpenAI API key
- `model` - Model name (e.g., `"text-embedding-3-small"`)
- `baseUrl` - Optional custom base URL

**Methods:**
- `embed(text, type)` - Generate embedding for text

**Example:**
```typescript
const provider = new OpenAIEmbeddings("sk-...", "text-embedding-3-small");
const vector = await provider.embed("Hello world", "passage");
```

#### `E5LocalEmbeddings`

```typescript
class E5LocalEmbeddings implements EmbeddingProviderInterface {
  constructor(endpoint: string);
  async embed(text: string, type: "query" | "passage"): Promise<number[]>;
}
```

Local E5 embedding server provider.

**Constructor Parameters:**
- `endpoint` - E5 server URL (default: `"http://127.0.0.1:8765"`)

**Example:**
```typescript
const provider = new E5LocalEmbeddings("http://127.0.0.1:8765");
const vector = await provider.embed("Hello world", "passage");
```

#### `ZAIEmbeddings`

```typescript
class ZAIEmbeddings implements EmbeddingProviderInterface {
  constructor(apiKey: string, model: string);
  async embed(text: string, type: "query" | "passage"): Promise<number[]>;
}
```

Z.AI embeddings provider.

**Constructor Parameters:**
- `apiKey` - Z.AI API key
- `model` - Model name (default: `"embedding-3"`)

**Example:**
```typescript
const provider = new ZAIEmbeddings("zai-key-...", "embedding-3");
const vector = await provider.embed("Hello world", "passage");
```

---

### Helper Functions

#### `createEmbeddingProvider()`

```typescript
function createEmbeddingProvider(
  config: MemoryConfig["embedding"]
): EmbeddingProviderInterface;
```

Factory function to create the appropriate embedding provider.

**Parameters:**
- `config` - Embedding configuration

**Returns:** Instance of embedding provider class

**Example:**
```typescript
const provider = createEmbeddingProvider({
  provider: "openai",
  model: "text-embedding-3-small",
  apiKey: "sk-..."
});
```

#### `shouldCapture()`

```typescript
function shouldCapture(text: string): boolean;
```

Determines if text should be auto-captured as a memory.

**Parameters:**
- `text` - Text content to evaluate

**Returns:** `true` if text should be captured

**Detection Criteria:**
- Length between 10-500 characters
- Contains memory trigger patterns
- Not already a memory-related response
- Low emoji count

#### `detectCategory()`

```typescript
function detectCategory(text: string): MemoryCategory;
```

Detects the appropriate memory category for text.

**Parameters:**
- `text` - Text content

**Returns:** Detected `MemoryCategory`

**Detection Logic:**
- "preference" - contains prefer/radši/like/love/hate/want
- "decision" - contains decided/will use/budeme
- "entity" - contains phone numbers, emails, names
- "fact" - contains is/are/has/have/je/má
- "other" - default fallback

---

## Database Schema

### Tables

#### `memories`

Stores extracted facts, preferences, and entities.

```sql
CREATE TABLE memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    session_id TEXT,
    content TEXT NOT NULL,
    memory_type TEXT NOT NULL DEFAULT 'fact',
    embedding vector(1024),  -- or 1536 for OpenAI
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
    )),
    CONSTRAINT valid_importance CHECK (importance >= 0 AND importance <= 1),
    CONSTRAINT valid_confidence CHECK (confidence >= 0 AND confidence <= 1)
);
```

**Columns:**
- `id` - Unique identifier
- `user_id` - User identifier
- `session_id` - Optional session identifier
- `content` - Memory text content
- `memory_type` - Category (see MemoryCategory)
- `embedding` - Vector embedding for semantic search
- `importance` - Importance score 0-1
- `confidence` - Confidence score 0-1
- `metadata` - Additional JSONB metadata
- `source_type` - Source: 'conversation', 'file', 'manual'
- `source_id` - Reference to source
- `created_at` - Creation timestamp
- `updated_at` - Last update timestamp
- `expires_at` - Optional expiration time

**Indexes:**
- `idx_memories_embedding` - HNSW vector index
- `idx_memories_user_id` - User lookup
- `idx_memories_session_id` - Session lookup
- `idx_memories_type` - Type filter
- `idx_memories_created_at` - Time ordering
- `idx_memories_importance` - Importance ordering

---

#### `requests`

Stores user messages/queries.

```sql
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
```

**Columns:**
- `id` - Unique identifier
- `user_id` - User identifier
- `session_id` - Optional session identifier
- `message_text` - User message content
- `embedding` - Vector embedding
- `has_files` - Whether request includes file attachments
- `telegram_message_id` - Telegram message ID
- `telegram_chat_id` - Telegram chat ID
- `created_at` - Timestamp

**Indexes:**
- `idx_requests_embedding` - HNSW vector index
- `idx_requests_user_id` - User lookup
- `idx_requests_session_id` - Session lookup
- `idx_requests_created_at` - Time ordering

---

#### `responses`

Stores assistant responses.

```sql
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
```

**Columns:**
- `id` - Unique identifier
- `request_id` - Reference to request
- `response_text` - Response content
- `embedding` - Response embedding
- `summary` - Optional summary
- `summary_embedding` - Summary embedding
- `feedback` - User feedback: 1 (positive), -1 (negative), NULL
- `model_used` - Model name
- `input_tokens` - Input token count
- `output_tokens` - Output token count
- `created_at` - Timestamp

**Indexes:**
- `idx_responses_embedding` - HNSW vector index
- `idx_responses_summary_embedding` - HNSW summary index
- `idx_responses_request_id` - Request lookup
- `idx_responses_created_at` - Time ordering

---

#### `reasoning`

Stores LLM reasoning/thinking process.

```sql
CREATE TABLE reasoning (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    reasoning_text TEXT NOT NULL,
    embedding vector(1024),
    thinking_model TEXT,
    thinking_tokens INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Columns:**
- `id` - Unique identifier
- `request_id` - Reference to request
- `reasoning_text` - Reasoning content
- `embedding` - Vector embedding
- `thinking_model` - Model name
- `thinking_tokens` - Token count
- `created_at` - Timestamp

**Indexes:**
- `idx_reasoning_embedding` - HNSW vector index
- `idx_reasoning_request_id` - Request lookup
- `idx_reasoning_created_at` - Time ordering

---

#### `files`

Stores uploaded file metadata.

```sql
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
```

**Columns:**
- `id` - Unique identifier
- `request_id` - Optional reference to request
- `user_id` - User identifier
- `file_type` - Type: 'markdown', 'pdf', 'image', 'code', 'text'
- `original_name` - Original filename
- `storage_path` - File storage path
- `extracted_text` - Extracted text content
- `embedding` - Vector embedding
- `chunk_count` - Number of chunks
- `file_size` - File size in bytes
- `mime_type` - MIME type
- `created_at` - Timestamp

**Indexes:**
- `idx_files_embedding` - HNSW vector index
- `idx_files_user_id` - User lookup
- `idx_files_request_id` - Request lookup

---

#### `file_chunks`

Stores chunks of large files.

```sql
CREATE TABLE file_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    embedding vector(1024),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(file_id, chunk_index)
);
```

**Columns:**
- `id` - Unique identifier
- `file_id` - Reference to file
- `chunk_index` - Chunk index
- `chunk_text` - Chunk content
- `embedding` - Vector embedding
- `created_at` - Timestamp

**Indexes:**
- `idx_file_chunks_embedding` - HNSW vector index
- `idx_file_chunks_file_id` - File lookup

---

### Views

#### `conversation_stats`

Aggregate statistics view.

```sql
CREATE VIEW conversation_stats AS
SELECT
    (SELECT COUNT(*) FROM memories) AS total_memories,
    (SELECT COUNT(*) FROM requests) AS total_requests,
    (SELECT COUNT(*) FROM responses) AS total_responses,
    (SELECT COUNT(*) FROM reasoning) AS total_reasoning,
    (SELECT COUNT(*) FROM files) AS total_files,
    (SELECT COUNT(*) FROM file_chunks) AS total_chunks,
    (SELECT COUNT(DISTINCT user_id) FROM requests) AS unique_users;
```

---

## SQL Functions

### `search_memories()`

Searches memories by semantic similarity.

```sql
CREATE OR REPLACE FUNCTION search_memories(
    query_embedding vector(1024),
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
);
```

**Parameters:**
- `query_embedding` - Query vector
- `p_user_id` - Optional user filter
- `p_memory_type` - Optional memory type filter
- `p_limit` - Maximum results (default: 10)
- `p_threshold` - Minimum similarity threshold (default: 0.3)

**Returns:** Matching memories with similarity scores

**Example:**
```sql
SELECT * FROM search_memories(
    '[0.1, 0.2, ...]'::vector(1024),
    'user123',
    'preference',
    5,
    0.5
);
```

---

### `search_responses()`

Searches response summaries by semantic similarity.

```sql
CREATE OR REPLACE FUNCTION search_responses(
    query_embedding vector(1024),
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
);
```

**Parameters:**
- `query_embedding` - Query vector
- `p_user_id` - Optional user filter
- `p_limit` - Maximum results (default: 5)
- `p_threshold` - Minimum similarity threshold (default: 0.3)

**Returns:** Matching responses with similarity scores

---

### `search_file_chunks()`

Searches file chunks by semantic similarity.

```sql
CREATE OR REPLACE FUNCTION search_file_chunks(
    query_embedding vector(1024),
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
);
```

**Parameters:**
- `query_embedding` - Query vector
- `p_user_id` - Optional user filter
- `p_limit` - Maximum results (default: 5)
- `p_threshold` - Minimum similarity threshold (default: 0.3)

**Returns:** Matching file chunks with similarity scores

---

### `search_context()`

Unified search across all context sources.

```sql
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
);
```

**Parameters:**
- `query_embedding` - Query vector
- `p_user_id` - Optional user filter
- `p_limit` - Maximum results (default: 10)
- `p_threshold` - Minimum similarity threshold (default: 0.25)

**Returns:** Matching context from memories, requests, responses, and files

**Source Values:**
- `"memory"` - From memories table
- `"request"` - From requests table
- `"response"` - From responses table
- `"file"` - From file_chunks table

---

### `update_updated_at_column()`

Trigger function to auto-update `updated_at` timestamp.

```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';
```

---

## Tools API

The plugin registers four tools with OpenClaw for use in agent workflows.

### `memory_recall`

Search through long-term memories.

**Tool Definition:**
```typescript
{
  name: "memory_recall",
  label: "Memory Recall",
  description: "Search through long-term memories. Use when you need context about user preferences, past decisions, or previously discussed topics.",
  parameters: {
    query: string;           // Search query
    limit?: number;          // Max results (default: 5)
    type?: MemoryCategory;   // Optional type filter
  }
}
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | `string` | Yes | Natural language search query |
| `limit` | `number` | No | Maximum results (default: 5) |
| `type` | `MemoryCategory` | No | Filter by memory type |

**Returns:**
```typescript
{
  content: Array<{ type: string; text: string }>;
  details: {
    count: number;
    memories?: MemoryEntry[];
  };
}
```

**Example Usage:**
```typescript
// In agent tool call
const result = await memory_recall.execute(
  toolCallId,
  { query: "What are the user's preferences?", limit: 10, type: "preference" },
  { sender: { id: "user123" } }
);

// Result format:
// "Found 3 memories:\n\n1. [preference] User prefers TypeScript (85%)\n2. [preference] ..."
```

---

### `memory_store`

Save important information in long-term memory.

**Tool Definition:**
```typescript
{
  name: "memory_store",
  label: "Memory Store",
  description: "Save important information in long-term memory. Use for preferences, facts, decisions.",
  parameters: {
    content: string;           // Information to remember
    importance?: number;       // 0-1 (default: 0.7)
    type?: MemoryCategory;     // Memory type (default: "other")
  }
}
```

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `content` | `string` | Yes | - | Information to remember |
| `importance` | `number` | No | 0.7 | Importance score 0-1 |
| `type` | `MemoryCategory` | No | `"other"` | Memory category |

**Returns:**
```typescript
{
  content: Array<{ type: string; text: string }>;
  details: {
    action: "created" | "duplicate";
    id?: string;
    existingId?: string;
  };
}
```

**Example Usage:**
```typescript
const result = await memory_store.execute(
  toolCallId,
  {
    content: "User prefers dark mode in all applications",
    importance: 0.8,
    type: "preference"
  },
  { sender: { id: "user123" }, sessionId: "session456" }
);

// If duplicate exists:
// { content: [{ type: "text", text: "Similar memory already exists: \"...\"" }],
//   details: { action: "duplicate", existingId: "uuid" } }
```

---

### `memory_forget`

Delete specific memories (GDPR compliance).

**Tool Definition:**
```typescript
{
  name: "memory_forget",
  label: "Memory Forget",
  description: "Delete specific memories. GDPR-compliant.",
  parameters: {
    query?: string;      // Search to find memory
    memoryId?: string;   // Specific memory ID
  }
}
```

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | `string` | No* | Search query to find memory |
| `memoryId` | `string` | No* | Specific memory UUID |

*One parameter must be provided.

**Returns:**
```typescript
{
  content: Array<{ type: string; text: string }>;
  details: {
    action: "deleted" | "not_found" | "candidates";
    id?: string;
    found?: number;
    candidates?: MemoryEntry[];
  };
}
```

**Example Usage:**
```typescript
// Delete by ID
await memory_forget.execute(
  toolCallId,
  { memoryId: "abc-123-def" },
  { sender: { id: "user123" } }
);

// Find and delete by query
await memory_forget.execute(
  toolCallId,
  { query: "outdated preference" },
  { sender: { id: "user123" } }
);

// If multiple candidates found:
// { content: [{ type: "text", text: "Found 3 candidates. Specify memoryId:\n..." }],
//   details: { action: "candidates", candidates: [...] } }
```

---

### `search_context`

Search across all stored context: memories, requests, responses, and files.

**Tool Definition:**
```typescript
{
  name: "search_context",
  label: "Search Context",
  description: "Search across all stored context: memories, requests, responses, and files. Returns most relevant matches.",
  parameters: {
    query: string;           // Search query
    limit?: number;          // Max results (default: 10)
  }
}
```

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `query` | `string` | Yes | - | Natural language search query |
| `limit` | `number` | No | 10 | Maximum results |

**Returns:**
```typescript
{
  content: Array<{ type: string; text: string }>;
  details: {
    count: number;
    results: Array<{
      source: "memory" | "request" | "response" | "file";
      content: string;
      similarity: number;
    }>;
  };
}
```

**Example Usage:**
```typescript
const result = await search_context.execute(
  toolCallId,
  { query: "previous discussions about TypeScript", limit: 10 },
  { sender: { id: "user123" } }
);

// Result format:
// "Found 5 context items:\n\n1. [response] The user prefers TypeScript for... (78%)\n..."
```

---

## CLI Commands

The plugin registers CLI commands under the `pgmem` namespace.

### `pgmem count`

Count stored memories.

```bash
openclaw pgmem count [--user <userId>]
```

**Options:**
| Option | Description |
|--------|-------------|
| `--user <userId>` | Filter by user ID |

**Example:**
```bash
openclaw pgmem count
# Output: Total memories: 42

openclaw pgmem count --user user123
# Output: Total memories: 15
```

---

### `pgmem search`

Search memories using semantic similarity.

```bash
openclaw pgmem search <query> [--limit <n>] [--user <userId>]
```

**Arguments:**
| Argument | Description |
|----------|-------------|
| `<query>` | Search query text |

**Options:**
| Option | Default | Description |
|--------|---------|-------------|
| `--limit <n>` | 5 | Maximum results |
| `--user <userId>` | default | User ID |

**Example:**
```bash
openclaw pgmem search "TypeScript preferences" --limit 10 --user user123
```

---

### `pgmem stats`

Show conversation statistics.

```bash
openclaw pgmem stats
```

**Output:**
```
📊 Conversation Statistics:
   Memories:  42
   Requests:  128
   Responses: 125
   Reasoning: 118
   Files:     7
   Chunks:    156
   Users:     3
```

---

## Lifecycle Hooks

The plugin registers lifecycle hooks for automatic memory capture and recall.

### `before_agent_start` (Auto-Recall)

Triggered before an agent starts processing. Automatically injects relevant context.

**Behavior:**
1. Generates embedding for user prompt
2. Saves request to database
3. Searches for relevant context across all sources
4. Prepends context to prompt if found

**Configuration:**
- Enabled by `autoRecall: true` (default)
- Context limit: 5 items
- Similarity threshold: 0.25

**Injected Format:**
```
<relevant-context>
Related information:
[memory] User prefers TypeScript...
[response] In a previous discussion about TypeScript...
[file] The tsconfig.json file specifies...
</relevant-context>
```

---

### `agent_end` (Auto-Capture)

Triggered after an agent completes. Automatically extracts important information.

**Behavior:**
1. Extracts user and assistant messages
2. Detects important facts using trigger patterns
3. Saves response and reasoning to database
4. Stores relevant facts as memories

**Configuration:**
- Enabled by `autoCapture: true` (default)
- Maximum 2 memories per conversation
- Stores response embeddings and summaries

**Capture Triggers:**
- Memory keywords: remember, запомни, preferuji, radši, etc.
- Preference expressions: I like, prefer, love, hate, want
- Decision markers: decided, will use, будем использовать
- Contact info: phone numbers, email addresses
- Entity facts: my name is, is called, jmenuje se
- Importance markers: always, never, important

---

## E5 Embedding Server

The E5 server provides local multilingual embeddings using the `multilingual-e5-large` model (1024 dimensions).

### Running the Server

```bash
# Install dependencies
pip install flask sentence-transformers

# Set optional environment variables
export HF_TOKEN=your_huggingface_token  # For faster downloads
export E5_HOST=127.0.0.1                # Default: 127.0.0.1
export E5_PORT=8765                      # Default: 8765

# Run server
python3 e5-server.py
```

**Startup Output:**
```
Loading E5-large model (this may take a minute on first run)...
Model loaded. Embedding dimension: 1024

🚀 E5 Embedding Server
   Model: multilingual-e5-large
   Dimension: 1024
   Listening: http://127.0.0.1:8765

Endpoints:
   POST /embed  - Single text embedding
   POST /batch  - Batch embeddings
   GET  /health - Health check
```

---

### API Endpoints

#### `POST /embed`

Generate embedding for a single text.

**Request:**
```json
{
  "text": "Your text here",
  "type": "passage"  // or "query"
}
```

**Response:**
```json
{
  "embedding": [0.1, 0.2, ...]  // 1024 dimensions
}
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | `string` | Yes | Text to embed |
| `type` | `string` | No | `"query"` or `"passage"` (default: `"passage"`) |

**Example:**
```bash
curl -X POST http://127.0.0.1:8765/embed \
  -H "Content-Type: application/json" \
  -d '{"text": "Search this content", "type": "query"}'
```

---

#### `POST /batch`

Generate embeddings for multiple texts.

**Request:**
```json
{
  "texts": ["Text 1", "Text 2", "Text 3"],
  "type": "passage"
}
```

**Response:**
```json
{
  "embeddings": [[0.1, 0.2, ...], [0.3, 0.4, ...], ...]
}
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `texts` | `string[]` | Yes | Array of texts to embed |
| `type` | `string` | No | `"query"` or `"passage"` (default: `"passage"`) |

---

#### `GET /health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "model": "intfloat/multilingual-e5-large",
  "dimension": 1024
}
```

---

### Prefix Convention

E5 models require specific prefixes for optimal performance:

| Prefix | Use Case |
|--------|----------|
| `"query: "` | Search queries and questions |
| `"passage: "` | Documents, facts, and stored content |

The plugin automatically adds prefixes when calling the E5 server.

---

## Error Handling

### Configuration Errors

```typescript
// Missing required configuration
Error: memory-pgvector config required

// Unknown keys in configuration
Error: memory-pgvector config has unknown keys: foo, bar

// Missing database config
Error: database config is required

// Unknown embedding provider
Error: Unknown embedding provider: invalid

// Environment variable not set
Error: Environment variable PGPASSWORD is not set
```

### Database Errors

```typescript
// Connection failure (handled by pg pool)
// Logged via api.logger.warn

// Migration errors (handled in runMigrations)
// Logged via api.logger.info on success
```

### Embedding Errors

```typescript
// E5 embedding failure
Error: E5 embedding failed: Connection refused

// OpenAI API errors (thrown by OpenAI SDK)
// Handled by caller

// Unknown provider
Error: Unknown embedding provider: invalid
```

### Memory Operations

```typescript
// No results found (not an error)
// Returns: { content: [{ type: "text", text: "No relevant memories found." }], details: { count: 0 } }

// Duplicate detection (not an error)
// Returns: { content: [{ type: "text", text: "Similar memory already exists: ..." }], details: { action: "duplicate" } }
```

---

## Examples

### Basic Memory Operations

```typescript
// Import plugin
import memoryPlugin from "memory-pgvector";

// Register with OpenClaw
openclaw.registerPlugin(memoryPlugin);

// Use tools in agent
const result = await memory_recall.execute(
  toolCallId,
  { query: "What are my preferences?" },
  { sender: { id: "user123" } }
);
```

---

### Custom Memory Storage

```typescript
// Store a preference
await memory_store.execute(
  toolCallId,
  {
    content: "User prefers dark mode in all applications",
    importance: 0.8,
    type: "preference"
  },
  { sender: { id: "user123" } }
);

// Store a decision
await memory_store.execute(
  toolCallId,
  {
    content: "Team decided to use TypeScript for the new project",
    importance: 0.9,
    type: "decision"
  },
  { sender: { id: "user123" } }
);
```

---

### Searching by Type

```typescript
// Only search preferences
const prefs = await memory_recall.execute(
  toolCallId,
  {
    query: "settings",
    type: "preference",
    limit: 10
  },
  { sender: { id: "user123" } }
);

// Only search facts
const facts = await memory_recall.execute(
  toolCallId,
  {
    query: "project details",
    type: "fact",
    limit: 10
  },
  { sender: { id: "user123" } }
);
```

---

### GDPR Compliance

```typescript
// Find and review memories
const candidates = await memory_forget.execute(
  toolCallId,
  { query: "personal information" },
  { sender: { id: "user123" } }
);

// Delete specific memory
await memory_forget.execute(
  toolCallId,
  { memoryId: "specific-uuid-here" },
  { sender: { id: "user123" } }
);
```

---

### Using Different Embedding Providers

```json
{
  "database": {
    "host": "localhost",
    "database": "memories",
    "user": "postgres"
  },
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "apiKey": "${OPENAI_API_KEY}"
  }
}
```

```json
{
  "database": {
    "host": "localhost",
    "database": "memories",
    "user": "postgres"
  },
  "embedding": {
    "provider": "e5-local",
    "e5Endpoint": "http://127.0.0.1:8765"
  }
}
```

```json
{
  "database": {
    "host": "localhost",
    "database": "memories",
    "user": "postgres"
  },
  "embedding": {
    "provider": "zai",
    "apiKey": "${ZAI_API_KEY}",
    "model": "embedding-3"
  }
}
```

---

### Direct Database Access

```typescript
import pg from "pg";
import { vectorDimsForModel } from "./config.js";

const pool = new pg.Pool({
  host: "localhost",
  database: "openclaw_memory",
  user: "postgres"
});

// Raw SQL query with semantic search
const result = await pool.query(`
  SELECT id, content, memory_type,
         (1 - (embedding <=> $1::vector))::REAL AS similarity
  FROM memories
  WHERE user_id = $2
    AND (1 - (embedding <=> $1::vector)) >= 0.5
  ORDER BY embedding <=> $1::vector
  LIMIT 10
`, [`[${embedding.join(",")}]`, userId]);
```

---

### Custom Auto-Capture Rules

The plugin includes built-in trigger patterns for auto-capture. You can extend `shouldCapture()` and `detectCategory()` in a fork:

```typescript
const CUSTOM_TRIGGERS = [
  // Add your patterns here
  /invoice.*#?\d+/i,
  /order.*#\d+/i,
];

function customShouldCapture(text: string): boolean {
  // Run base checks
  if (!shouldCapture(text)) return false;

  // Add custom checks
  return CUSTOM_TRIGGERS.some(r => r.test(text));
}
```

---

### Statistics and Monitoring

```bash
# Check database stats
openclaw pgmem stats

# Output:
# 📊 Conversation Statistics:
#    Memories:  42
#    Requests:  128
#    Responses: 125
#    Reasoning: 118
#    Files:     7
#    Chunks:    156
#    Users:     3

# Query via SQL
psql -d openclaw_memory -c "SELECT * FROM conversation_stats;"
```

---

## License

MIT License - see LICENSE file for details.

---

## Contributing

Contributions welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Support

- **Issues:** [GitHub Issues](https://github.com/sdamarketing/openclaw-memory-pgvector/issues)
- **Repository:** [sdamarketing/openclaw-memory-pgvector](https://github.com/sdamarketing/openclaw-memory-pgvector)

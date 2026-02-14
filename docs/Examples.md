# Examples

## Basic Usage

### Storing a Memory

```typescript
// Via AI tool
memory_store({
  content: "User prefers dark mode in all applications",
  memoryType: "preference",
  importance: 0.8
});
```

```sql
-- Direct SQL
INSERT INTO memories (user_id, content, memory_type, importance, embedding)
VALUES (
  'user-123',
  'User prefers dark mode in all applications',
  'preference',
  0.8,
  '[0.1, 0.2, ...]'::vector
);
```

### Searching Memories

```typescript
// Via AI tool
const results = await memory_recall({
  query: "dark mode preferences",
  limit: 5
});
```

```sql
-- Direct SQL
SELECT content, similarity
FROM search_memories(
  '[0.1, 0.2, ...]'::vector,
  'user-123',
  5,
  0.25
);
```

### Deleting a Memory

```typescript
// Via AI tool
await memory_forget({
  memoryId: 'memory-uuid-here'
});
```

```sql
-- Direct SQL
DELETE FROM memories WHERE id = 'memory-uuid-here';
```

## Advanced Scenarios

### 1. User Profile Management

```typescript
// Store user information
async function updateUserProfile(userId: string, profile: UserProfile) {
  // Store name
  await memory_store({
    content: `User's name is ${profile.name}`,
    memoryType: 'fact',
    importance: 0.9,
    metadata: { field: 'name' }
  });

  // Store timezone
  await memory_store({
    content: `User is in ${profile.timezone} timezone`,
    memoryType: 'fact',
    importance: 0.7,
    metadata: { field: 'timezone' }
  });

  // Store preferences
  for (const [key, value] of Object.entries(profile.preferences)) {
    await memory_store({
      content: `User prefers ${key}: ${value}`,
      memoryType: 'preference',
      importance: 0.6
    });
  }
}

// Retrieve user context
async function getUserContext(userId: string): Promise<string> {
  const results = await search_context({
    query: 'user profile information',
    limit: 10
  });
  
  return results.map(r => r.content).join('\n');
}
```

### 2. Conversation Context Injection

```typescript
// Auto-inject context before agent response
async function enrichPrompt(userMessage: string, userId: string): Promise<string> {
  // Search for relevant memories
  const memories = await memory_recall({
    query: userMessage,
    limit: 5,
    threshold: 0.3
  });

  // Search for similar past conversations
  const pastConversations = await search_context({
    query: userMessage,
    limit: 3,
    threshold: 0.35
  });

  // Build context string
  let context = '';
  
  if (memories.length > 0) {
    context += '### Relevant Memories:\n';
    context += memories.map(m => `- ${m.content}`).join('\n');
    context += '\n\n';
  }

  if (pastConversations.length > 0) {
    context += '### Similar Past Conversations:\n';
    context += pastConversations.map(c => `- ${c.content}`).join('\n');
  }

  return context;
}
```

### 3. Document Search (RAG)

```typescript
// Store document chunks
async function indexDocument(userId: string, document: Document) {
  const chunks = splitIntoChunks(document.text, 500);
  
  for (let i = 0; i < chunks.length; i++) {
    await pool.query(`
      INSERT INTO file_chunks (file_id, chunk_index, chunk_text, embedding)
      VALUES ($1, $2, $3, $4)
    `, [
      document.id,
      i,
      chunks[i],
      await getEmbedding(chunks[i])
    ]);
  }
}

// Search documents
async function searchDocuments(query: string, limit: number = 5) {
  const embedding = await getEmbedding(query);
  
  const result = await pool.query(`
    SELECT 
      fc.chunk_text,
      f.original_name,
      1 - (fc.embedding <=> $1) as similarity
    FROM file_chunks fc
    JOIN files f ON fc.file_id = f.id
    WHERE 1 - (fc.embedding <=> $1) > 0.3
    ORDER BY fc.embedding <=> $1
    LIMIT $2
  `, [`[${embedding.join(',')}]`, limit]);
  
  return result.rows;
}
```

### 4. Session Summarization

```typescript
// At end of session, create summary
async function summarizeSession(sessionId: string, userId: string) {
  // Get all messages in session
  const messages = await pool.query(`
    SELECT 
      r.message_text as user_message,
      resp.response_text as assistant_response
    FROM requests r
    JOIN responses resp ON r.id = resp.request_id
    WHERE r.session_id = $1
    ORDER BY r.created_at
  `, [sessionId]);

  // Create summary (using LLM)
  const summary = await generateSummary(messages.rows);

  // Store as session memory
  await memory_store({
    content: summary,
    memoryType: 'session_summary',
    importance: 0.5,
    metadata: { 
      sessionId,
      messageCount: messages.rows.length 
    }
  });
}
```

### 5. Memory Importance Decay

```typescript
// Decay importance of old memories
async function decayMemories(userId: string) {
  await pool.query(`
    UPDATE memories
    SET importance = importance * 0.95
    WHERE user_id = $1
      AND created_at < NOW() - INTERVAL '7 days'
      AND importance > 0.3
  `, [userId]);

  // Delete very low importance memories
  await pool.query(`
    DELETE FROM memories
    WHERE user_id = $1
      AND importance < 0.2
      AND created_at < NOW() - INTERVAL '30 days'
  `, [userId]);
}
```

### 6. Multi-User Memory Isolation

```typescript
// Ensure user isolation in queries
class MemoryService {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  async search(query: string) {
    // ALWAYS filter by user_id
    const result = await pool.query(`
      SELECT * FROM search_memories(
        $1::vector,
        $2,
        10,
        0.25
      )
    `, [queryEmbedding, this.userId]);
    
    return result.rows;
  }

  async store(content: string, type: string) {
    await pool.query(`
      INSERT INTO memories (user_id, content, memory_type, embedding)
      VALUES ($1, $2, $3, $4)
    `, [this.userId, content, type, embedding]);
  }
}
```

### 7. Feedback Loop

```typescript
// Store user feedback on responses
async function recordFeedback(
  requestId: string,
  feedback: 'positive' | 'negative'
) {
  await pool.query(`
    UPDATE responses
    SET feedback = $1
    WHERE request_id = $2
  `, [feedback === 'positive' ? 1 : -1, requestId]);

  // Adjust memory importance based on feedback
  if (feedback === 'positive') {
    // Boost importance of memories used in this response
    await pool.query(`
      UPDATE memories m
      SET importance = LEAST(importance * 1.1, 1.0)
      FROM requests r
      WHERE r.id = $1
        AND m.user_id = r.user_id
        AND m.created_at > r.created_at - INTERVAL '1 hour'
    `, [requestId]);
  }
}
```

## CLI Examples

### Search from Terminal

```bash
# Search memories
openclaw pgmem search "user preferences" --limit 5

# Search with JSON output
openclaw pgmem search "api keys" --json

# Count memories
openclaw pgmem count --user user-123

# View stats
openclaw pgmem stats
```

### Bulk Operations

```bash
# Export all memories
psql -U openclaw -d openclaw_memory -c "
  COPY (SELECT * FROM memories ORDER BY created_at DESC)
  TO '/tmp/memories_export.csv' WITH CSV HEADER
"

# Import memories
psql -U openclaw -d openclaw_memory -c "
  COPY memories FROM '/tmp/memories_import.csv' WITH CSV HEADER
"

# Delete old low-importance memories
psql -U openclaw -d openclaw_memory -c "
  DELETE FROM memories
  WHERE importance < 0.3
    AND created_at < NOW() - INTERVAL '90 days'
"
```

## Integration Examples

### Node.js Application

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  host: 'localhost',
  database: 'openclaw_memory',
  user: 'openclaw',
  password: 'password'
});

async function getRelevantContext(query: string, userId: string) {
  const embedding = await getEmbeddingFromE5(query);
  
  const result = await pool.query(`
    SELECT * FROM search_context(
      $1::vector,
      $2,
      5,
      0.25
    )
  `, [`[${embedding.join(',')}]`, userId]);
  
  return result.rows;
}
```

### Python Application

```python
import psycopg2
import requests

def get_embedding(text):
    response = requests.post(
        'http://127.0.0.1:8765/embed',
        json={'text': text, 'type': 'query'}
    )
    return response.json()['embedding']

def search_memories(query, user_id, limit=5):
    embedding = get_embedding(query)
    embedding_str = '[' + ','.join(map(str, embedding)) + ']'
    
    conn = psycopg2.connect(
        host='localhost',
        database='openclaw_memory',
        user='openclaw',
        password='password'
    )
    
    cur = conn.cursor()
    cur.execute("""
        SELECT * FROM search_memories(
            %s::vector,
            %s,
            %s,
            0.25
        )
    """, (embedding_str, user_id, limit))
    
    return cur.fetchall()
```

## Performance Examples

### Batch Insert

```typescript
// Slow: One by one
for (const item of items) {
  await memory_store(item);
}
// ~100ms per item = 10s for 100 items

// Fast: Batch insert
const values = items.map((item, i) => `($${i*4+1}, $${i*4+2}, $${i*4+3}, $${i*4+4})`).join(',');
const params = items.flatMap(item => [
  item.userId,
  item.content,
  item.memoryType,
  item.embedding
]);

await pool.query(`
  INSERT INTO memories (user_id, content, memory_type, embedding)
  VALUES ${values}
`, params);
// ~500ms for 100 items
```

### Parallel Searches

```typescript
// Slow: Sequential
const memories = await searchMemories(query);
const responses = await searchResponses(query);
const files = await searchFiles(query);
// 3 x 50ms = 150ms

// Fast: Parallel
const [memories, responses, files] = await Promise.all([
  searchMemories(query),
  searchResponses(query),
  searchFiles(query)
]);
// ~50ms total
```

# Examples

This guide provides practical examples for common use cases of vector memory with PostgreSQL and pgvector.

## Table of Contents

- [Basic CRUD Operations](#basic-crud-operations)
- [Semantic Search](#semantic-search)
- [Personal Memory System](#personal-memory-system)
- [Learning from Conversations](#learning-from-conversations)
- [Recommendation Engine](#recommendation-engine)
- [Search with Filters](#search-with-filters)
- [Batch Operations](#batch-operations)

## Basic CRUD Operations

### Create Memory

```sql
-- Insert a memory with embedding and metadata
INSERT INTO memory_embeddings (embedding, metadata)
VALUES (
  '[0.1, 0.2, 0.3, ...]'::vector,
  jsonb_build_object(
    'content', 'Meeting notes about Q4 strategy',
    'category', 'work',
    'tags', ARRAY['strategy', 'meeting', 'q4'],
    'source', 'conversation',
    'created_at', NOW()
  )
);

-- Return the inserted record
RETURNING id, created_at;
```

### Read Memory

```sql
-- Simple read by ID
SELECT * FROM memory_embeddings WHERE id = 123;

-- Read with metadata JSON
SELECT
  id,
  content,
  to_jsonb(metadata) as metadata,
  created_at
FROM memory_embeddings
WHERE id = 123;
```

### Update Memory

```sql
-- Update metadata
UPDATE memory_embeddings
SET metadata = metadata || jsonb_build_object('updated_at', NOW())
WHERE id = 123;

-- Update content (requires re-embedding)
UPDATE memory_embeddings
SET
  content = 'Updated meeting notes',
  embedding = '[0.2, 0.3, 0.4, ...]'::vector,
  updated_at = NOW()
WHERE id = 123;
```

### Delete Memory

```sql
-- Delete by ID
DELETE FROM memory_embeddings WHERE id = 123;

-- Delete by category
DELETE FROM memory_embeddings
WHERE metadata->>'category' = 'trash';
```

## Semantic Search

### Find Similar Memories

```sql
-- Find 5 most similar memories using cosine similarity
SELECT
  id,
  content,
  metadata,
  embedding <=> '[0.1, 0.2, 0.3]' AS distance
FROM memory_embeddings
ORDER BY distance
LIMIT 5;
```

### Find Similar by Category

```sql
-- Find similar memories in a specific category
SELECT
  id,
  content,
  metadata->>'tags' as tags,
  embedding <=> '[0.1, 0.2, 0.3]' AS distance
FROM memory_embeddings
WHERE metadata->>'category' = 'work'
ORDER BY distance
LIMIT 10;
```

### Filter by Metadata

```sql
-- Find similar memories with specific tags
SELECT
  id,
  content,
  metadata->>'tags' as tags,
  embedding <=> '[0.1, 0.2, 0.3]' AS distance
FROM memory_embeddings
WHERE metadata->'tags' @> ARRAY['important']
ORDER BY distance
LIMIT 5;
```

## Personal Memory System

### Setup Database Schema

```sql
-- Create tables for personal memory
CREATE TABLE personal_memories (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(768),
  metadata JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  INDEX idx_user_id (user_id),
  INDEX idx_created_at (created_at DESC)
);

CREATE INDEX idx_personal_memories_embedding ON personal_memories
USING hnsw (embedding vector_cosine_ops);
```

### Add Memory from Text

```typescript
async function addMemory(userId: string, text: string, category: string) {
  // 1. Generate embedding
  const embedding = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text
  });

  // 2. Store in database
  const result = await db.personal_memories.insert({
    user_id: userId,
    content: text,
    embedding: embedding.data[0].embedding,
    metadata: {
      category,
      tags: [],
      source: 'manual_entry',
      created_at: new Date().toISOString()
    }
  });

  return result;
}
```

### Recall Memories

```typescript
async function recallMemories(
  userId: string,
  query: string,
  topK: number = 5,
  category?: string,
  minSimilarity?: number
) {
  // 1. Generate query embedding
  const queryEmbedding = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query
  });

  // 2. Build query
  let querySql = `
    SELECT
      id,
      content,
      metadata,
      embedding <=> :query_embedding AS distance
    FROM personal_memories
    WHERE user_id = :user_id
  `;

  // 3. Add filters if provided
  const params: any = { user_id: userId, query_embedding: queryEmbedding.data[0].embedding };

  if (category) {
    querySql += ' AND metadata->>'category = :category';
    params.category = category;
  }

  if (minSimilarity) {
    querySql += ' AND distance < :min_similarity';
    params.min_similarity = minSimilarity;
  }

  // 4. Execute query
  querySql += ' ORDER BY distance LIMIT :top_k';
  params.top_k = topK;

  const results = await db.execute(querySql, params);
  return results;
}
```

### Daily Summary

```typescript
async function getDailySummary(userId: string, date: Date) {
  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);

  const summary = await db.personal_memories.select({
    user_id: userId,
    metadata: {
      created_at: {
        gte: yesterday.toISOString(),
        lt: date.toISOString()
      }
    },
    limit: 50
  });

  return {
    date,
    totalMemories: summary.length,
    categories: summarizeByCategory(summary),
    tags: summarizeTags(summary)
  };
}
```

## Learning from Conversations

### Conversation Processing

```typescript
async function processConversation(userId: string, messages: Message[]) {
  // 1. Extract key information from conversation
  const extracted = await extractKeyPoints(messages);

  // 2. Store each key point as a memory
  for (const point of extracted.points) {
    await addMemory(userId, point.text, point.category, point.tags);
  }

  // 3. Create summary
  await addMemory(userId, extracted.summary, 'summary', ['important', 'recap']);
}

// Extract key points from messages
async function extractKeyPoints(messages: Message[]): Promise<ExtractedPoints> {
  const points: ExtractedPoint[] = [];

  for (const message of messages) {
    // Use AI to extract structured information
    const extraction = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: `Extract key information from this conversation message. Return JSON with:
          - category: 'decision', 'fact', 'preference', 'question'
          - text: The key information as a concise sentence
          - tags: Array of 2-5 relevant tags
          `
        },
        {
          role: 'user',
          content: message.content
        }
      ],
      response_format: { type: 'json_object' }
    });

    const data = JSON.parse(extraction.choices[0].message.content);
    points.push({
      category: data.category,
      text: data.text,
      tags: data.tags
    });
  }

  // Generate summary
  const summary = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      {
        role: 'system',
        content: 'Create a 2-3 sentence summary of the entire conversation.'
      },
      {
        role: 'user',
        content: messages.map(m => m.content).join('\n\n')
      }
    ]
  });

  return {
    points,
    summary: summary.choices[0].message.content
  };
}
```

### Context-Aware Responses

```typescript
async function generateContextualResponse(
  userId: string,
  userQuery: string,
  currentConversation: Message[]
) {
  // 1. Recall relevant memories
  const relevantMemories = await recallMemories(
    userId,
    userQuery,
    5,
    undefined,
    0.7
  );

  // 2. Build context
  const context = relevantMemories.map(m =>
    `[${m.metadata.category}] ${m.content}`
  ).join('\n');

  // 3. Generate response with context
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      {
        role: 'system',
        content: `You are a helpful assistant. Use the following relevant memories to provide context-aware responses.
        Relevant memories:
        ${context}`
      },
      {
        role: 'user',
        content: userQuery
      }
    ]
  });

  return response.choices[0].message.content;
}
```

## Recommendation Engine

### Product Recommendations

```sql
-- Create recommendations table
CREATE TABLE product_recommendations (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  score NUMERIC NOT NULL,
  reason TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  INDEX idx_user_id (user_id),
  INDEX idx_score (score DESC)
);

-- Add recommendation
INSERT INTO product_recommendations (user_id, product_id, score, reason, metadata)
VALUES (
  'user_123',
  'prod_456',
  0.85,
  'High similarity to similar users who liked this product',
  jsonb_build_object(
    'categories', ARRAY['electronics', 'gadgets'],
    'price_range', 'high'
  )
);

-- Get recommendations for a user
SELECT
  p.product_id,
  p.name,
  p.description,
  p.price,
  pr.score,
  pr.reason
FROM product_recommendations pr
JOIN products p ON pr.product_id = p.id
WHERE pr.user_id = 'user_123'
ORDER BY pr.score DESC
LIMIT 10;
```

### Content Recommendations

```typescript
async function recommendContent(userId: string, viewedContentId: string) {
  // 1. Get embedding of viewed content
  const content = await db.content.find({ id: viewedContentId });
  const contentEmbedding = content.embedding;

  // 2. Find similar content
  const similar = await db.content.findMany({
    where: {
      id: { ne: viewedContentId },
      rating: { gt: 4 }
    },
    orderBy: [
      {
        embedding: 'lt',
        embedding: contentEmbedding,
        method: 'cosine'
      }
    ],
    limit: 10
  });

  // 3. Get reasons for each recommendation
  const recommendations = await Promise.all(
    similar.map(async (item) => {
      // Get why this content is recommended
      const reasons = await getRecommendationReasons(
        userId,
        contentEmbedding,
        item.embedding
      );

      return {
        content_id: item.id,
        title: item.title,
        score: 1 - item.distance, // Convert distance to similarity
        reasons
      };
    })
  );

  return recommendations;
}
```

## Search with Filters

### Multi-Factor Search

```sql
-- Search with category and similarity threshold
SELECT
  id,
  content,
  metadata->>'category' as category,
  embedding <=> '[0.1, 0.2, 0.3]' AS distance
FROM memory_embeddings
WHERE
  metadata->>'category' = 'work'
  AND embedding <=> '[0.1, 0.2, 0.3]' < 0.3
ORDER BY distance
LIMIT 10;
```

### Date Range Search

```sql
-- Search in a time range with similarity
SELECT
  id,
  content,
  created_at,
  embedding <=> '[0.1, 0.2, 0.3]' AS distance
FROM memory_embeddings
WHERE
  created_at >= '2024-01-01'::timestamptz
  AND created_at < '2024-02-01'::timestamptz
  AND embedding <=> '[0.1, 0.2, 0.3]' < 0.4
ORDER BY distance
LIMIT 10;
```

### Composite Filters

```sql
-- Multiple metadata filters with similarity
SELECT
  id,
  content,
  metadata,
  embedding <=> '[0.1, 0.2, 0.3]' AS distance
FROM memory_embeddings
WHERE
  metadata->'tags' @> ARRAY['important']
  AND metadata->>'category' IN ('work', 'personal')
  AND embedding <=> '[0.1, 0.2, 0.3]' < 0.3
ORDER BY distance
LIMIT 10;
```

## Batch Operations

### Bulk Insert

```sql
-- Prepare bulk insert data
INSERT INTO memory_embeddings (embedding, metadata)
VALUES
  ('[0.1, 0.2, ...]'::vector, '{"content": "First", "category": "test"}'::jsonb),
  ('[0.2, 0.3, ...]'::vector, '{"content": "Second", "category": "test"}'::jsonb),
  ('[0.3, 0.4, ...]'::vector, '{"content": "Third", "category": "test"}'::jsonb),
  -- ... more rows
  ('[0.9, 0.8, ...]'::vector, '{"content": "Last", "category": "test"}'::jsonb);
```

### Bulk Update

```typescript
async function bulkUpdateMemories(
  memories: { id: string; newContent: string }[]
) {
  const updates = memories.map(m => ({
    content: m.newContent,
    updated_at: new Date().toISOString()
  }));

  return db.memory_embeddings.updateMany({
    where: { id: { in: memories.map(m => m.id) } },
    data: updates
  });
}
```

### Bulk Delete

```sql
-- Delete by condition
DELETE FROM memory_embeddings
WHERE
  metadata->>'category' = 'trash'
  AND created_at < NOW() - INTERVAL '30 days';
```

## Advanced Examples

### Persistent Context Window

```typescript
async function maintainContextWindow(
  userId: string,
  conversationHistory: Message[],
  maxMemories: number = 100
) {
  // 1. Calculate total embeddings
  const totalEmbeddings = await db.memory_embeddings.count({
    where: { user_id: userId }
  });

  // 2. Keep only top memories
  if (totalEmbeddings > maxMemories) {
    await trimMemoryWindow(userId, maxMemories);
  }

  // 3. Process conversation
  await processConversation(userId, conversationHistory);
}

async function trimMemoryWindow(userId: string, keepCount: number) {
  // Keep highest quality memories based on recency and category
  const query = `
    DELETE FROM memory_embeddings
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
               metadata->>'category' as category,
               created_at
        FROM memory_embeddings
        WHERE user_id = :user_id
        ORDER BY
          CASE category
            WHEN 'important' THEN 1
            WHEN 'decision' THEN 2
            ELSE 3
          END ASC,
          created_at DESC
        LIMIT :keep_count
      ) AS keep
      WHERE keep.id IS NULL
    )
  `;

  await db.execute(query, { user_id: userId, keep_count: keepCount });
}
```

### Search with Scoring

```sql
-- Combine similarity score with metadata score
SELECT
  id,
  content,
  metadata,
  -- Similarity score (0-1)
  1 - (embedding <=> '[0.1, 0.2, 0.3]') AS similarity_score,
  -- Metadata score
  CASE
    WHEN metadata->>'category' = 'work' THEN 0.3
    WHEN metadata->>'tags' @> ARRAY['important'] THEN 0.2
    WHEN created_at > NOW() - INTERVAL '7 days' THEN 0.1
    ELSE 0
  END AS metadata_score,
  -- Combined score
  (1 - (embedding <=> '[0.1, 0.2, 0.3]')) * 0.7 +
  CASE
    WHEN metadata->>'category' = 'work' THEN 0.3
    WHEN metadata->>'tags' @> ARRAY['important'] THEN 0.2
    WHEN created_at > NOW() - INTERVAL '7 days' THEN 0.1
    ELSE 0
  END AS final_score
FROM memory_embeddings
WHERE
  metadata->>'category' = 'work'
  AND embedding <=> '[0.1, 0.2, 0.3]' < 0.3
ORDER BY final_score DESC
LIMIT 10;
```

## Full Working Example

```typescript
// Complete example: Personal AI Memory System
class PersonalMemorySystem {
  private db: Database;
  private openai: OpenAI;

  constructor() {
    this.db = new Database();
    this.openai = new OpenAI();
  }

  async addMemory(
    userId: string,
    content: string,
    category: string = 'general',
    tags: string[] = []
  ) {
    // Generate embedding
    const embedding = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: content
    });

    // Store in database
    const result = await this.db.personal_memories.insert({
      user_id: userId,
      content,
      embedding: embedding.data[0].embedding,
      metadata: {
        category,
        tags,
        source: 'manual_entry',
        created_at: new Date().toISOString()
      }
    });

    return result;
  }

  async recall(
    userId: string,
    query: string,
    options: {
      topK?: number;
      category?: string;
      minSimilarity?: number;
    } = {}
  ) {
    const {
      topK = 5,
      category,
      minSimilarity = 0.7
    } = options;

    // Generate query embedding
    const queryEmbedding = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query
    });

    // Build query
    let querySql = `
      SELECT
        id,
        content,
        metadata,
        embedding <=> :query_embedding AS distance
      FROM personal_memories
      WHERE user_id = :user_id
    `;

    const params: any = {
      user_id: userId,
      query_embedding: queryEmbedding.data[0].embedding
    };

    if (category) {
      querySql += ' AND metadata->>'category = :category';
      params.category = category;
    }

    querySql += ' AND distance < :min_similarity ORDER BY distance LIMIT :top_k';
    params.min_similarity = minSimilarity;
    params.top_k = topK;

    const results = await this.db.execute(querySql, params);
    return results;
  }

  async search(
    userId: string,
    query: string,
    filters: {
      categories?: string[];
      tags?: string[];
      dateRange?: { start: Date; end: Date };
    } = {}
  ) {
    // Build SQL with filters
    let querySql = `
      SELECT
        id,
        content,
        metadata,
        embedding <=> :query_embedding AS distance
      FROM personal_memories
      WHERE user_id = :user_id
    `;

    const params: any = {
      user_id: userId,
      query_embedding: queryEmbedding.data[0].embedding
    };

    // Add category filters
    if (filters.categories && filters.categories.length > 0) {
      querySql += ' AND metadata->>'category IN (:categories)';
      params.categories = filters.categories;
    }

    // Add tag filters
    if (filters.tags && filters.tags.length > 0) {
      querySql += ' AND metadata->"tags" @> :tags';
      params.tags = JSON.stringify(filters.tags);
    }

    // Add date range filter
    if (filters.dateRange) {
      querySql += ' AND created_at >= :start AND created_at <= :end';
      params.start = filters.dateRange.start;
      params.end = filters.dateRange.end;
    }

    querySql += ' ORDER BY distance LIMIT 10';

    const results = await this.db.execute(querySql, params);
    return results;
  }
}
```

## Further Reading

- [pgvector Documentation](https://github.com/pgvector/pgvector)
- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)
- [PostgreSQL Patterns](https://wiki.postgresql.org/wiki/Patterns)

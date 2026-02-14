# API Reference

## CLI Commands

### Stats

View database statistics:

```bash
openclaw pgmem stats
```

Output:
```
📊 Conversation Statistics:
   Memories:  15
   Requests: 127
   Responses: 127
   Reasoning: 127
   Files:     3
   Chunks:    42
   Users:     5
```

### Search

Search memories:

```bash
openclaw pgmem search "your query" --limit 5
```

### Count

Count memories for a user:

```bash
openclaw pgmem count --user <user_id>
```

## Tools

The plugin registers these tools for the AI agent:

| Tool | Description |
|------|-------------|
| `memory_store` | Save information to long-term memory |
| `memory_recall` | Search through memories |
| `memory_forget` | Delete specific memories (GDPR) |
| `search_context` | Search across all sources (memories, requests, responses, files) |

## SQL Functions

### search_context

```sql
-- Search all context
SELECT * FROM search_context(
    '[0.1, 0.2, ...]'::vector,  -- query embedding
    'user_id',                   -- optional user filter
    10,                          -- limit
    0.25                         -- threshold
);
```

### search_memories

```sql
-- Search memories only
SELECT * FROM search_memories(
    query_embedding,
    user_id,
    limit,
    threshold
);
```

### search_responses

```sql
-- Search responses
SELECT * FROM search_responses(
    query_embedding,
    user_id,
    limit,
    threshold
);
```

### search_file_chunks

```sql
-- Search file chunks
SELECT * FROM search_file_chunks(
    query_embedding,
    user_id,
    limit,
    threshold
);
```

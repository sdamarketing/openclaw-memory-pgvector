# memory-pgvector

PostgreSQL + pgvector long-term memory plugin for OpenClaw.

## Features

- **Semantic Search**: Uses pgvector for fast vector similarity search
- **Multiple Embedding Providers**: OpenAI, E5-local, Z.AI
- **Auto-Capture**: Automatically stores important information
- **Auto-Recall**: Injects relevant memories into context
- **GDPR Compliant**: Full control over stored memories

## Installation

### 1. Install PostgreSQL + pgvector

```bash
# Ubuntu/Debian
sudo apt install postgresql-16-pgvector

# Or use existing PostgreSQL and install pgvector extension
```

### 2. Setup Database

```bash
cd ~/.openclaw/workspace/skills/memory-pgvector
sudo bash setup-postgres.sh
```

### 3. Install Plugin Dependencies

```bash
cd ~/.openclaw/workspace/skills/memory-pgvector
npm install
npm run build
```

### 4. Configure OpenClaw

Add to `~/.openclaw/openclaw.json`:

```json5
{
  plugins: {
    slots: {
      memory: "memory-pgvector"
    }
  },
  pluginsConfig: {
    "memory-pgvector": {
      database: {
        host: "localhost",
        port: 5432,
        database: "openclaw_memory",
        user: "openclaw",
        password: "openclaw123"
      },
      embedding: {
        provider: "openai",  // or "e5-local", "zai"
        apiKey: "${OPENAI_API_KEY}",
        model: "text-embedding-3-small"
      },
      autoCapture: true,
      autoRecall: true
    }
  }
}
```

### 5. Restart OpenClaw Gateway

```bash
openclaw gateway --port 18789
```

## Configuration

### Database

| Option | Default | Description |
|--------|---------|-------------|
| `host` | `localhost` | PostgreSQL host |
| `port` | `5432` | PostgreSQL port |
| `database` | `openclaw_memory` | Database name |
| `user` | `postgres` | Database user |
| `password` | - | Database password |
| `ssl` | `false` | Use SSL connection |

### Embedding Providers

#### OpenAI (default)

```json5
embedding: {
  provider: "openai",
  apiKey: "${OPENAI_API_KEY}",
  model: "text-embedding-3-small"  // or "text-embedding-3-large"
}
```

#### E5-local (offline)

```json5
embedding: {
  provider: "e5-local",
  e5Endpoint: "http://127.0.0.1:8765"
}
```

Requires a local E5 embedding service running on the endpoint.

#### Z.AI

```json5
embedding: {
  provider: "zai",
  apiKey: "${ZAI_API_KEY}",
  model: "embedding-3"
}
```

### Memory Settings

| Option | Default | Description |
|--------|---------|-------------|
| `autoCapture` | `true` | Auto-store important info from conversations |
| `autoRecall` | `true` | Auto-inject relevant memories into context |
| `sessionSummaries` | `false` | Store session summaries with GLM-4.7 |

## Tools

### memory_recall

Search through long-term memories.

```
memory_recall(query="user preferences about notifications", limit=5)
```

### memory_store

Save important information.

```
memory_store(
  content="User prefers dark mode in all applications",
  type="preference",
  importance=0.8
)
```

### memory_forget

Delete memories (GDPR).

```
memory_forget(memoryId="uuid-here")
memory_forget(query="old notification settings")
```

## CLI Commands

```bash
# Count memories
openclaw pgmem count

# Search memories
openclaw pgmem search "preferences" --limit 5

# Show stats
openclaw pgmem stats
```

## Database Schema

See `migrations/001_init.sql` for the full schema.

Main table: `memories`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Unique identifier |
| `user_id` | TEXT | User/sender ID |
| `content` | TEXT | Memory content |
| `memory_type` | TEXT | Type: preference, decision, fact, entity, etc. |
| `embedding` | vector(1536) | Vector embedding |
| `importance` | REAL | Importance score 0-1 |
| `confidence` | REAL | Confidence score 0-1 |
| `metadata` | JSONB | Additional metadata |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

## Architecture

Based on [memory/plans/vector-memory-schema.md](../../plans/vector-memory-schema.md).

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   OpenClaw      │────▶│ memory-pgvector │────▶│   PostgreSQL    │
│   Gateway       │     │    Plugin       │     │   + pgvector    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │   Embeddings    │
                        │ (OpenAI/E5/ZAI) │
                        └─────────────────┘
```

## License

MIT

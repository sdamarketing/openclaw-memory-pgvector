# Configuration

## Full Configuration Schema

```json
{
  "plugins": {
    "entries": {
      "memory-pgvector": {
        "enabled": true,
        "config": {
          "database": {
            "host": "localhost",
            "port": 5432,
            "database": "openclaw_memory",
            "user": "openclaw",
            "password": "openclaw123"
          },
          "embedding": {
            "provider": "e5-local",
            "e5Endpoint": "http://127.0.0.1:8765"
          },
          "autoCapture": true,
          "autoRecall": true,
          "recallLimit": 5,
          "recallThreshold": 0.25
        }
      }
    }
  }
}
```

## Database Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | string | localhost | PostgreSQL host |
| `port` | number | 5432 | PostgreSQL port |
| `database` | string | openclaw_memory | Database name |
| `user` | string | openclaw | Database user |
| `password` | string | - | Database password |

## Embedding Configuration

### E5-Local (Recommended)

```json
{
  "provider": "e5-local",
  "e5Endpoint": "http://127.0.0.1:8765"
}
```

Free, local, 1024 dimensions.

### OpenAI

```json
{
  "provider": "openai",
  "apiKey": "sk-...",
  "model": "text-embedding-3-small"
}
```

Requires API key, 1536 dimensions.

## Auto-Capture

When enabled (`autoCapture: true`), the plugin automatically stores:
- User preferences
- Important facts
- Entities (names, dates, locations)

## Auto-Recall

When enabled (`autoRecall: true`), the plugin automatically injects relevant context into conversations.

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `recallLimit` | number | 5 | Max memories to recall |
| `recallThreshold` | number | 0.25 | Similarity threshold |

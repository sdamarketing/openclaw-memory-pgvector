# OpenClaw Memory Plugin with PostgreSQL + pgvector

<div align="center">

[![OpenClaw](https://img.shields.io/badge/OpenClaw-Plugin-blue?style=for-the-badge)](https://github.com/sdamarketing/openclaw-memory-pgvector)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-336791?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![pgvector](https://img.shields.io/badge/pgvector-0.7+-orange?style=for-the-badge)](https://github.com/pgvector/pgvector)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

**Production-ready long-term memory for AI agents**

*A fully featured conversation tracking system with semantic search*

</div>

---

## Features

- **Complete Conversation Tracking** - Stores requests, responses, reasoning, files
- **Semantic Search** - pgvector-powered similarity search across all content
- **Auto-Capture** - Automatically extracts and stores important information
- **Auto-Recall** - Injects relevant context into agent conversations
- **Multi-Provider Embeddings** - OpenAI, E5-local, or Z.AI
- **CLI Tools** - `openclaw pgmem stats/search/count`
- **GDPR-Compliant** - Memory forget tool for data deletion

## Architecture

```
User Message (Telegram/CLI/Web)
        │
        ▼
┌─────────────────────────────────────────────────────┐
│                 OpenClaw Gateway                     │
│                                                     │
│  ┌─────────────┐    ┌─────────────────────────┐    │
│  │   Request   │───▶│  memory-pgvector Plugin │    │
│  │   Handler   │    │                         │    │
│  └─────────────┘    │  ┌─────────────────┐   │    │
│                     │  │  E5 Embeddings  │   │    │
│                     │  │  (1024 dims)    │   │    │
│                     │  └────────┬────────┘   │    │
│                     │           │            │    │
│                     │  ┌────────▼────────┐   │    │
│                     │  │  Auto-Recall    │   │    │
│                     │  │  (search context)│  │    │
│                     │  └────────┬────────┘   │    │
│                     └───────────┼────────────┘    │
│                                 │                 │
└─────────────────────────────────┼─────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────┐
                    │     PostgreSQL + pgvector   │
                    │                             │
                    │  ┌─────────┐  ┌─────────┐  │
                    │  │memories │  │requests │  │
                    │  └─────────┘  └─────────┘  │
                    │  ┌─────────┐  ┌─────────┐  │
                    │  │responses│  │reasoning│  │
                    │  └─────────┘  └─────────┘  │
                    │  ┌─────────┐  ┌─────────┐  │
                    │  │ files   │  │ chunks  │  │
                    │  └─────────┘  └─────────┘  │
                    │                             │
                    │  Vector Indexes (HNSW)     │
                    └─────────────────────────────┘
```

## Database Schema

| Table | Purpose | Vector Index |
|-------|---------|--------------|
| `memories` | Facts, preferences, entities | ✅ |
| `requests` | User messages | ✅ |
| `responses` | Assistant replies + summaries | ✅ |
| `reasoning` | LLM chain-of-thought | ✅ |
| `files` | Uploaded documents | ✅ |
| `file_chunks` | Document chunks for RAG | ✅ |

## Installation

### Prerequisites

- OpenClaw installed (`npm install -g openclaw`)
- PostgreSQL 16+ with pgvector extension
- Python 3.10+ (for E5 embeddings)

### Quick Start

```bash
# 1. Clone repository
git clone https://github.com/sdamarketing/openclaw-memory-pgvector.git
cd openclaw-memory-pgvector

# 2. Install dependencies
npm install
npm run build

# 3. Copy to OpenClaw extensions
cp -r . $(npm root -g)/openclaw/extensions/memory-pgvector

# 4. Setup PostgreSQL (see below)

# 5. Start E5 embeddings server
python3 e5-server.py &

# 6. Configure OpenClaw
openclaw config
```

### PostgreSQL Setup

```bash
# Install pgvector
sudo apt install postgresql-16-pgvector

# Create database and user
sudo -u postgres psql << 'EOF'
CREATE DATABASE openclaw_memory;
CREATE USER openclaw WITH PASSWORD 'openclaw123';
GRANT ALL PRIVILEGES ON DATABASE openclaw_memory TO openclaw;
\c openclaw_memory
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
GRANT ALL ON SCHEMA public TO openclaw;
EOF

# Run migrations
sudo -u postgres psql -d openclaw_memory -f migrations/001_init.sql
sudo -u postgres psql -d openclaw_memory -f migrations/002_full_conversation.sql

# Grant ownership
sudo -u postgres psql -d openclaw_memory << 'EOF'
ALTER TABLE memories OWNER TO openclaw;
ALTER TABLE requests OWNER TO openclaw;
ALTER TABLE responses OWNER TO openclaw;
ALTER TABLE reasoning OWNER TO openclaw;
ALTER TABLE files OWNER TO openclaw;
ALTER TABLE file_chunks OWNER TO openclaw;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO openclaw;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO openclaw;
EOF
```

### E5 Embeddings Server

```bash
# Install Python dependencies
pip install flask sentence-transformers --break-system-packages

# Start server (downloads model on first run)
python3 e5-server.py

# Test
curl http://127.0.0.1:8765/health
```

## Configuration

Add to `~/.openclaw/openclaw.json`:

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
          "autoRecall": true
        }
      }
    },
    "slots": {
      "memory": "memory-pgvector"
    }
  }
}
```

### Embedding Providers

| Provider | Config | Dimensions |
|----------|--------|------------|
| E5-local (recommended) | `{"provider": "e5-local", "e5Endpoint": "http://127.0.0.1:8765"}` | 1024 |
| OpenAI | `{"provider": "openai", "apiKey": "sk-...", "model": "text-embedding-3-small"}` | 1536 |

## CLI Commands

```bash
# View statistics
openclaw pgmem stats

# Search memories
openclaw pgmem search "your query" --limit 5

# Count memories
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

## Example Usage

```
User: Remember that my name is Alexey

Bot: I'll save that for you.
[Uses memory_store tool]

--- Later ---

User: What's my name?

Bot: Your name is Alexey.
[Uses memory_recall to find the stored fact]
```

## Stats View

After some conversations:

```
$ openclaw pgmem stats

📊 Conversation Statistics:
   Memories:  15
   Requests:  127
   Responses: 127
   Reasoning: 127
   Files:     3
   Chunks:    42
   Users:     5
```

## API Reference

### SQL Functions

```sql
-- Search all context
SELECT * FROM search_context(
    '[0.1, 0.2, ...]'::vector,  -- query embedding
    'user_id',                   -- optional user filter
    10,                          -- limit
    0.25                         -- threshold
);

-- Search memories only
SELECT * FROM search_memories(...);

-- Search responses
SELECT * FROM search_responses(...);

-- Search file chunks
SELECT * FROM search_file_chunks(...);
```

## Troubleshooting

### Dimension mismatch error

```
expected 1024 dimensions, not 384
```

**Solution**: Ensure E5 server uses `multilingual-e5-large` (1024 dims), not `e5-small` (384).

### Permission denied

```
must be owner of table
```

**Solution**: Run the ownership grants in PostgreSQL setup.

### E5 server connection refused

```
fetch failed
```

**Solution**: Ensure E5 server is running: `curl http://127.0.0.1:8765/health`

## Contributing

Contributions are welcome! Please read our contributing guidelines.

## License

MIT License - see [LICENSE](LICENSE)

---

<div align="center">

**Built with ❤️ for the OpenClaw community**

*AI Assistant: [Aister](https://www.moltbook.com/u/Aister)*

![Star](https://img.shields.io/github/stars/sdamarketing/openclaw-memory-pgvector?style=social)
![Fork](https://img.shields.io/github/forks/sdamarketing/openclaw-memory-pgvector?style=social)

</div>

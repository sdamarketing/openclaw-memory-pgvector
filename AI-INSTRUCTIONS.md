# AI Assistant Installation Guide

> **For AI Assistants**: This guide enables you to independently install and configure the OpenClaw Memory Plugin with PostgreSQL + pgvector.

## Overview

This plugin provides long-term memory for OpenClaw AI agents using:
- **PostgreSQL** for persistent storage
- **pgvector** for semantic similarity search
- **E5 embeddings** (local, no API costs)

## Prerequisites Check

Before starting, verify:

```bash
# Check OpenClaw is installed
which openclaw && openclaw --version

# Check PostgreSQL is installed
which psql && psql --version

# Check Python 3
python3 --version
```

## Installation Steps

### Step 1: Clone and Build Plugin

```bash
# Clone repository
git clone https://github.com/sdamarketing/openclaw-memory-pgvector.git
cd openclaw-memory-pgvector

# Install dependencies
npm install

# Build TypeScript
npm run build

# Copy to OpenClaw extensions
EXT_DIR=$(npm root -g)/openclaw/extensions/memory-pgvector
mkdir -p "$EXT_DIR"
cp -r . "$EXT_DIR"
```

### Step 2: Setup PostgreSQL

```bash
# Install pgvector if not present
sudo apt update
sudo apt install -y postgresql-16-pgvector

# Create database
sudo -u postgres psql << 'SQL'
CREATE DATABASE openclaw_memory;
CREATE USER openclaw WITH PASSWORD 'openclaw123';
GRANT ALL PRIVILEGES ON DATABASE openclaw_memory TO openclaw;
SQL

# Enable extensions
sudo -u postgres psql -d openclaw_memory << 'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
GRANT ALL ON SCHEMA public TO openclaw;
SQL

# Run migrations
cd ~/projects/openclaw-memory-pgvector
sudo -u postgres psql -d openclaw_memory -f migrations/001_init.sql
sudo -u postgres psql -d openclaw_memory -f migrations/002_full_conversation.sql

# Grant ownership (IMPORTANT!)
sudo -u postgres psql -d openclaw_memory << 'SQL'
ALTER TABLE memories OWNER TO openclaw;
ALTER TABLE requests OWNER TO openclaw;
ALTER TABLE responses OWNER TO openclaw;
ALTER TABLE reasoning OWNER TO openclaw;
ALTER TABLE files OWNER TO openclaw;
ALTER TABLE file_chunks OWNER TO openclaw;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO openclaw;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO openclaw;
GRANT ALL ON FUNCTION search_memories TO openclaw;
GRANT ALL ON FUNCTION search_responses TO openclaw;
GRANT ALL ON FUNCTION search_file_chunks TO openclaw;
GRANT ALL ON FUNCTION search_context TO openclaw;
GRANT ALL ON FUNCTION update_updated_at_column TO openclaw;
GRANT ALL ON conversation_stats TO openclaw;
SQL
```

### Step 3: Setup E5 Embeddings Server

```bash
# Install Python dependencies
pip3 install flask sentence-transformers --break-system-packages

# Create E5 server (copy from repository)
mkdir -p ~/.openclaw
cp e5-server.py ~/.openclaw/

# Start server in background
nohup python3 ~/.openclaw/e5-server.py > ~/.openclaw/e5-server.log 2>&1 &

# Wait for model to load (~30-60 seconds on first run)
sleep 60

# Test server
curl http://127.0.0.1:8765/health
# Expected: {"status":"ok","model":"intfloat/multilingual-e5-large","dimension":1024}
```

### Step 4: Configure OpenClaw

Read current config:
```bash
cat ~/.openclaw/openclaw.json
```

Add plugin configuration. The config should include:

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

**Important**: Merge this with existing config, don't replace entirely.

### Step 5: Verify Installation

```bash
# Test CLI
openclaw pgmem stats

# Expected output:
# 📊 Conversation Statistics:
#    Memories:  0
#    Requests:  0
#    ...
```

### Step 6: Restart Gateway

```bash
# Stop existing gateway
pkill -f "openclaw-gateway"

# Start new gateway
openclaw gateway --port 18789
```

## Verification Checklist

- [ ] PostgreSQL database `openclaw_memory` exists
- [ ] Tables created: memories, requests, responses, reasoning, files, file_chunks
- [ ] E5 server running on port 8765
- [ ] `openclaw pgmem stats` returns without error
- [ ] Gateway starts with `[plugins] memory-pgvector: plugin registered`
- [ ] Gateway shows `[plugins] memory-pgvector: database initialized`

## Common Issues

### "must be owner of table"
Run the GRANT and ALTER TABLE OWNER commands from Step 2.

### "expected 1024 dimensions, not 384"
E5 server is using wrong model. Ensure `multilingual-e5-large` not `e5-small`.

### "fetch failed"
E5 server not running. Start with `python3 ~/.openclaw/e5-server.py &`

### "Connection refused" on port 8765
Wait longer for model to load, or check `~/.openclaw/e5-server.log` for errors.

## Testing Memory

After setup, test with the AI agent:

```
User: "Remember that my favorite color is blue"
Bot: [Uses memory_store]

User: "What's my favorite color?"
Bot: [Uses memory_recall] "Your favorite color is blue"
```

Check stats:
```bash
openclaw pgmem stats
# Should show Memories: 1+
```

## Database Queries for Debugging

```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';

-- Check memories
SELECT COUNT(*) FROM memories;

-- Check recent requests
SELECT message_text, created_at FROM requests ORDER BY created_at DESC LIMIT 5;

-- Search context manually
SELECT * FROM search_context(
    (SELECT embedding FROM memories LIMIT 1),
    NULL, 5, 0.2
);
```

---

*This guide is designed for AI assistants to perform autonomous installation.*
*Created by [Aister](https://www.moltbook.com/u/Aister)*

#!/bin/bash
# Setup script for memory-pgvector plugin
# Run with: sudo bash setup-postgres.sh

set -e

echo "==> Creating PostgreSQL database and user..."

# Create database
sudo -u postgres psql -c "CREATE DATABASE openclaw_memory;" || echo "Database may already exist"

# Create user (optional, can use postgres)
sudo -u postgres psql -c "CREATE USER openclaw WITH PASSWORD 'openclaw123';" || echo "User may already exist"

# Grant privileges
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE openclaw_memory TO openclaw;"

# Connect to database and enable extensions
sudo -u postgres psql -d openclaw_memory -c "CREATE EXTENSION IF NOT EXISTS vector;"
sudo -u postgres psql -d openclaw_memory -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"

# Grant schema permissions
sudo -u postgres psql -d openclaw_memory -c "GRANT ALL ON SCHEMA public TO openclaw;"
sudo -u postgres psql -d openclaw_memory -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO openclaw;"
sudo -u postgres psql -d openclaw_memory -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO openclaw;"

echo "==> Running migrations..."
sudo -u postgres psql -d openclaw_memory -f "$(dirname "$0")/migrations/001_init.sql" || echo "Migration may have already run"

echo "==> Done!"
echo ""
echo "Database: openclaw_memory"
echo "User: openclaw"
echo "Password: openclaw123"
echo ""
echo "Add to your openclaw.json:"
echo ""
cat << 'EOF'
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
        provider: "openai",
        apiKey: "${OPENAI_API_KEY}",
        model: "text-embedding-3-small"
      },
      autoCapture: true,
      autoRecall: true
    }
  }
}
EOF

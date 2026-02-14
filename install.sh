#!/bin/bash
#
# OpenClaw Memory Plugin - Full Installation Script
# Run with: bash install.sh
#
# This script installs:
# - PostgreSQL + pgvector
# - E5 embeddings server
# - OpenClaw memory-pgvector plugin
#

set -e

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     OpenClaw Memory Plugin - Full Installation               ║"
echo "║     PostgreSQL + pgvector + E5 Embeddings                    ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; exit 1; }

# Check prerequisites
echo ">>> Checking prerequisites..."

if ! command -v openclaw &> /dev/null; then
    error "OpenClaw not found. Install with: npm install -g openclaw"
fi
success "OpenClaw found"

if ! command -v psql &> /dev/null; then
    warn "PostgreSQL not found. Installing..."
    sudo apt update
    sudo apt install -y postgresql-16-pgvector
fi
success "PostgreSQL found"

if ! command -v python3 &> /dev/null; then
    error "Python 3 not found. Please install Python 3.10+"
fi
success "Python 3 found"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Step 1: Build plugin
echo ""
echo ">>> Building plugin..."
cd "$SCRIPT_DIR"
npm install
npm run build
success "Plugin built"

# Step 2: Copy to OpenClaw extensions
echo ""
echo ">>> Installing to OpenClaw..."
EXT_DIR=$(npm root -g)/openclaw/extensions/memory-pgvector
mkdir -p "$EXT_DIR"
cp -r "$SCRIPT_DIR"/* "$EXT_DIR"/
success "Plugin installed to $EXT_DIR"

# Step 3: Setup PostgreSQL
echo ""
echo ">>> Setting up PostgreSQL..."

# Check if database exists
if sudo -u postgres psql -lqt | cut -d \| -f 1 | grep -qw openclaw_memory; then
    warn "Database openclaw_memory already exists"
else
    sudo -u postgres psql << 'SQL'
CREATE DATABASE openclaw_memory;
CREATE USER openclaw WITH PASSWORD 'openclaw123';
GRANT ALL PRIVILEGES ON DATABASE openclaw_memory TO openclaw;
SQL
    success "Database created"
fi

# Enable extensions
sudo -u postgres psql -d openclaw_memory << 'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
GRANT ALL ON SCHEMA public TO openclaw;
SQL
success "Extensions enabled"

# Run migrations
sudo -u postgres psql -d openclaw_memory -f "$SCRIPT_DIR/migrations/001_init.sql" 2>/dev/null || true
sudo -u postgres psql -d openclaw_memory -f "$SCRIPT_DIR/migrations/002_full_conversation.sql" 2>/dev/null || true
success "Migrations applied"

# Grant ownership
sudo -u postgres psql -d openclaw_memory << 'SQL'
DO $$
BEGIN
    ALTER TABLE memories OWNER TO openclaw;
EXCEPTION WHEN others THEN NULL;
END$$;
DO $$
BEGIN
    ALTER TABLE requests OWNER TO openclaw;
EXCEPTION WHEN others THEN NULL;
END$$;
DO $$
BEGIN
    ALTER TABLE responses OWNER TO openclaw;
EXCEPTION WHEN others THEN NULL;
END$$;
DO $$
BEGIN
    ALTER TABLE reasoning OWNER TO openclaw;
EXCEPTION WHEN others THEN NULL;
END$$;
DO $$
BEGIN
    ALTER TABLE files OWNER TO openclaw;
EXCEPTION WHEN others THEN NULL;
END$$;
DO $$
BEGIN
    ALTER TABLE file_chunks OWNER TO openclaw;
EXCEPTION WHEN others THEN NULL;
END$$;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO openclaw;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO openclaw;
SQL
success "Permissions granted"

# Step 4: Setup E5 server
echo ""
echo ">>> Setting up E5 embeddings server..."

# Install Python dependencies
pip3 install flask sentence-transformers --break-system-packages --quiet 2>/dev/null || \
pip3 install flask sentence-transformers --user --quiet 2>/dev/null || \
warn "Could not install Python packages. Install manually: pip install flask sentence-transformers"

# Copy E5 server
mkdir -p ~/.openclaw
cp "$SCRIPT_DIR/e5-server.py" ~/.openclaw/
success "E5 server installed"

# Check if E5 server is running
if pgrep -f "e5-server.py" > /dev/null; then
    warn "E5 server already running"
else
    echo "Starting E5 server (downloads model on first run, ~60s)..."
    nohup python3 ~/.openclaw/e5-server.py > ~/.openclaw/e5-server.log 2>&1 &
    sleep 5
    success "E5 server started"
fi

# Step 5: Configure OpenClaw
echo ""
echo ">>> Configuring OpenClaw..."

CONFIG_FILE=~/.openclaw/openclaw.json

if [ ! -f "$CONFIG_FILE" ]; then
    echo '{"plugins":{"entries":{},"slots":{}}}' > "$CONFIG_FILE"
fi

# Check if memory-pgvector already configured
if grep -q '"memory-pgvector"' "$CONFIG_FILE"; then
    warn "Plugin already configured in openclaw.json"
else
    # Add plugin config using Node.js
    node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
config.plugins = config.plugins || {};
config.plugins.entries = config.plugins.entries || {};
config.plugins.entries['memory-pgvector'] = {
    enabled: true,
    config: {
        database: {
            host: 'localhost',
            port: 5432,
            database: 'openclaw_memory',
            user: 'openclaw',
            password: 'openclaw123'
        },
        embedding: {
            provider: 'e5-local',
            e5Endpoint: 'http://127.0.0.1:8765'
        },
        autoCapture: true,
        autoRecall: true
    }
};
config.plugins.slots = config.plugins.slots || {};
config.plugins.slots.memory = 'memory-pgvector';
fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2));
"
    success "Configuration updated"
fi

# Final verification
echo ""
echo ">>> Verifying installation..."

sleep 3
if curl -s http://127.0.0.1:8765/health > /dev/null 2>&1; then
    success "E5 server responding"
else
    warn "E5 server not ready yet (may need more time to load model)"
fi

if PGPASSWORD=openclaw123 psql -h localhost -U openclaw -d openclaw_memory -c "SELECT 1" > /dev/null 2>&1; then
    success "Database connection working"
else
    warn "Database connection failed - check credentials"
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                    Installation Complete!                    ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║                                                              ║"
echo "║  Next steps:                                                 ║"
echo "║  1. Wait 60s for E5 model to load                           ║"
echo "║  2. Run: openclaw pgmem stats                                ║"
echo "║  3. Restart gateway: openclaw gateway --port 18789          ║"
echo "║                                                              ║"
echo "║  Check E5 server: curl http://127.0.0.1:8765/health         ║"
echo "║  View logs: cat ~/.openclaw/e5-server.log                    ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "AI Assistant: https://www.moltbook.com/u/Aister"
echo ""

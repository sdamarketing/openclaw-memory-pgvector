# OpenClaw Memory Plugin with PostgreSQL + pgvector

<div align="center">

[![OpenClaw](https://img.shields.io/badge/OpenClaw-Plugin-blue?style=for-the-badge)](https://github.com/aister-khmara/openclaw-memory-pgvector)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-336791?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![pgvector](https://img.shields.io/badge/pgvector-0.7+-orange?style=for-the-badge)](https://github.com/pgvector/pgvector)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

**Production-ready long-term memory for AI agents**

*A fully featured conversation tracking system with semantic search*

**[📚 Documentation (Wiki)](https://github.com/aister-khmara/openclaw-memory-pgvector/wiki)** | **[📖 Документация (RU)](https://github.com/aister-khmara/openclaw-memory-pgvector/wiki/Документация-(RU))**

</div>

---

## Features

- **Complete Conversation Tracking** - Stores requests, responses, reasoning, files
- **Semantic Search** - pgvector-powered similarity search across all content
- **Auto-Capture** - Automatically extracts and stores important information
- **Auto-Recall** - Injects relevant context into agent conversations
- **Multi-Provider Embeddings** - OpenAI, E5-local, or Z.AI
- **CLI Tools** - \`openclaw pgmem stats/search/count\`
- **GDPR-Compliant** - Memory forget tool for data deletion

## Quick Links

| 📚 **Wiki Pages** | |
|---|---|
| [Installation Guide](https://github.com/aister-khmara/openclaw-memory-pgvector/wiki/Installation) | Step-by-step setup instructions |
| [Configuration](https://github.com/aister-khmara/openclaw-memory-pgvector/wiki/Configuration) | All configuration options |
| [API Reference](https://github.com/aister-khmara/openclaw-memory-pgvector/wiki/API-Reference) | SQL functions and CLI commands |
| [Performance Tuning](https://github.com/aister-khmara/openclaw-memory-pgvector/wiki/Performance) | Optimize for your use case |
| [Security Guide](https://github.com/aister-khmara/openclaw-memory-pgvector/wiki/Security) | Best practices for data protection |
| [Examples](https://github.com/aister-khmara/openclaw-memory-pgvector/wiki/Examples) | Code examples and use cases |
| [Troubleshooting](https://github.com/aister-khmara/openclaw-memory-pgvector/wiki/Troubleshooting) | Common issues and solutions |
| [Документация (RU)](https://github.com/aister-khmara/openclaw-memory-pgvector/wiki/Документация-(RU)) | Полная документация на русском |

## Architecture

\`\`\`
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
\`\`\`

## Installation

### Prerequisites

- OpenClaw installed (`npm install -g openclaw`)
- PostgreSQL 16+ with pgvector extension
- Python 3.10+ (for E5 embeddings)
- (Optional) Proxy server for ElevenLabs TTS in restricted regions

### Quick Start

```bash
# 1. Clone repository
git clone https://github.com/aister-khmara/openclaw-memory-pgvector.git
cd openclaw-memory-pgvector

# 2. Install dependencies
npm install
npm run build

# 3. Copy to OpenClaw extensions
cp -r . $(npm root -g)/openclaw/extensions/memory-pgvector

# 4. Setup PostgreSQL (see Wiki for details)

# 5. Start E5 embeddings server
python3 e5-server.py &

# 6. Configure OpenClaw
openclaw config
```

📖 **[Full Installation Guide →](https://github.com/aister-khmara/openclaw-memory-pgvector/wiki/Installation)**

### Systemd Services (Recommended)

For production use, install as systemd services:

```bash
# Copy service files
mkdir -p ~/.config/systemd/user/
cp systemd/*.service ~/.config/systemd/user/

# Enable services
systemctl --user enable e5-embedding
systemctl --user enable openclaw-gateway

# Start services
systemctl --user start e5-embedding
systemctl --user start openclaw-gateway

# Enable autostart
loginctl enable-linger
```

### Proxy Setup (for restricted regions)

If ElevenLabs API is blocked in your region:

```bash
# Setup proxy environment
source setup-proxy.sh

# Or add to ~/.bashrc
export NO_PROXY="localhost,127.0.0.1,0.0.0.0"
export HTTP_PROXY="http://127.0.0.1:10809"
export HTTPS_PROXY="http://127.0.0.1:10809"
```

⚠️ **Important**: Always set `NO_PROXY` to exclude localhost, or E5 server connection will fail.

## CLI Commands

```bash
# View statistics
openclaw pgmem stats

# Search memories
openclaw pgmem search "your query" --limit 5

# Count memories
openclaw pgmem count --user <user_id>
```

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| `fetch failed` | Set `NO_PROXY=localhost,127.0.0.1` before starting gateway |
| `expected 1024 dimensions, not 384` | Use `multilingual-e5-large` (1024 dims), not `e5-small` |
| `must be owner of table` | Run ownership grants in PostgreSQL |
| E5 server crashes | Check RAM (~2GB needed), check logs |
| Memory not captured | Verify `autoCapture: true` and E5 server running |
| TTS not reading Russian | Use `eleven_multilingual_v2` or `eleven_flash_v2_5` model |

### Health Check Commands

```bash
# E5 server
curl http://127.0.0.1:8765/health

# Gateway
curl http://127.0.0.1:18789/health

# Memory stats
openclaw pgmem stats
```

📖 **[Full Troubleshooting Guide →](https://github.com/aister-khmara/openclaw-memory-pgvector/wiki/Troubleshooting)**
3. **Make your changes** and commit with clear messages
   ```bash
   git commit -m "Add: Something amazing"
   ```
4. **Push to your fork**
   ```bash
   git push origin feature/amazing-feature
   ```
5. **Create a Pull Request** targeting the `main` branch

### Development Setup

```bash
# Clone your fork
git clone https://github.com/aister-khmara/openclaw-memory-pgvector.git
cd openclaw-memory-pgvector

# Install dependencies
npm install
npm run build

# Run tests (if available)
npm test
```

### Code Style

- Use TypeScript for new features
- Follow existing code patterns
- Add tests for new functionality
- Update documentation as needed

### Questions?

Open an issue for bugs or feature requests. We're happy to help!

📖 **[Full Documentation →](https://github.com/aister-khmara/openclaw-memory-pgvector/wiki)**

## License

MIT License - see [LICENSE](LICENSE)

---

<div align="center">

**Built with ❤️ for the OpenClaw community**

*AI Assistant: [Aister](https://www.moltbook.com/u/Aister)*

![Star](https://img.shields.io/github/stars/aister-khmara/openclaw-memory-pgvector?style=social)
![Fork](https://img.shields.io/github/forks/aister-khmara/openclaw-memory-pgvector?style=social)

</div>

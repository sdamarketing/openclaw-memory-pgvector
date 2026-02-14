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

- OpenClaw installed (\`npm install -g openclaw\`)
- PostgreSQL 16+ with pgvector extension
- Python 3.10+ (for E5 embeddings)

### Quick Start

\`\`\`bash
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
\`\`\`

📖 **[Full Installation Guide →](https://github.com/aister-khmara/openclaw-memory-pgvector/wiki/Installation)**

## CLI Commands

\`\`\`bash
# View statistics
openclaw pgmem stats

# Search memories
openclaw pgmem search "your query" --limit 5

# Count memories
openclaw pgmem count --user <user_id>
\`\`\`

## Roadmap

- [ ] Support for SQLite with vector extension
- [ ] Web UI for memory management
- [ ] Support for more embedding providers (Cohere, HuggingFace)
- [ ] Batch processing for large files
- [ ] Export/Import memory data
- [ ] Memory sharing between sessions
- [ ] Advanced analytics dashboard

See [GitHub Issues](https://github.com/aister-khmara/openclaw-memory-pgvector/issues) for more details.

---

## Contributing

**Contributions are welcome!** 🎉

### How to Contribute

1. **Fork the repository** on GitHub
2. **Create a feature branch** for your changes
   ```bash
   git checkout -b feature/amazing-feature
   ```
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

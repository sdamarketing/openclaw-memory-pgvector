# Installation Guide

## Prerequisites

- OpenClaw installed (`npm install -g openclaw`)
- PostgreSQL 16+ with pgvector extension
- Python 3.10+ (for E5 embeddings)

## Step 1: Clone and Build

```bash
git clone https://github.com/aister-khmara/openclaw-memory-pgvector.git
cd openclaw-memory-pgvector
npm install
npm run build
```

## Step 2: Install OpenClaw

```bash
npm install -g openclaw
```

## Step 3: Install Plugin

```bash
cp -r . $(npm root -g)/openclaw/extensions/memory-pgvector
```

## Step 4: Setup PostgreSQL

### Install pgvector

```bash
sudo apt install postgresql-16-pgvector
```

### Create Database

```bash
sudo -u postgres psql << 'EOF'
CREATE DATABASE openclaw_memory;
CREATE USER openclaw WITH PASSWORD 'openclaw123';
GRANT ALL PRIVILEGES ON DATABASE openclaw_memory TO openclaw;
\c openclaw_memory
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
GRANT ALL ON SCHEMA public TO openclaw;

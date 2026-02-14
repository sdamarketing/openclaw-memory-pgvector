# Performance Tuning Guide

## HNSW Index Optimization

The plugin uses HNSW (Hierarchical Navigable Small World) indexes for fast vector similarity search.

### Index Parameters

```sql
CREATE INDEX idx_memories_embedding ON memories 
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `m` | 16 | Number of connections per node. Higher = more accurate, slower insert |
| `ef_construction` | 64 | Search depth during index construction. Higher = better quality, slower build |

### Tuning for Your Use Case

**High accuracy (recommended for <100k vectors):**
```sql
WITH (m = 24, ef_construction = 128)
```

**Balanced (default):**
```sql
WITH (m = 16, ef_construction = 64)
```

**Fast inserts (for >1M vectors):**
```sql
WITH (m = 8, ef_construction = 32)
```

## Query Performance

### Search Threshold

Lower threshold = more results, slower query:
```json
{
  "recallThreshold": 0.25  // Default - good balance
}
```

- `0.15-0.20`: More results, some noise
- `0.25-0.30`: Recommended range
- `0.35+`: Only very similar results

### Limit Results

```json
{
  "recallLimit": 5  // Default
}
```

For most use cases, 3-7 results is optimal. More = slower context injection.

## Database Optimization

### Connection Pooling

The plugin uses connection pooling automatically. For high-load scenarios:

```typescript
// In config
pool: {
  max: 20,        // Max connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
}
```

### Vacuum and Analyze

Run periodically for optimal performance:

```bash
# Weekly maintenance
sudo -u postgres psql -d openclaw_memory -c "VACUUM ANALYZE;"
```

### Table Partitioning (Advanced)

For >10M records, consider partitioning by user_id:

```sql
-- Example: partition by user_id hash
CREATE TABLE memories_partitioned (
    LIKE memories INCLUDING INDEXES
) PARTITION BY HASH (user_id);

CREATE TABLE memories_p0 PARTITION OF memories_partitioned FOR VALUES WITH (modulus 4, remainder 0);
CREATE TABLE memories_p1 PARTITION OF memories_partitioned FOR VALUES WITH (modulus 4, remainder 1);
CREATE TABLE memories_p2 PARTITION OF memories_partitioned FOR VALUES WITH (modulus 4, remainder 2);
CREATE TABLE memories_p3 PARTITION OF memories_partitioned FOR VALUES WITH (modulus 4, remainder 3);
```

## Embedding Server Performance

### E5 Server

The E5 embedding server is the bottleneck for memory operations.

**GPU Acceleration:**
```bash
# Install CUDA version of PyTorch
pip install torch --index-url https://download.pytorch.org/whl/cu118

# Start with GPU
CUDA_VISIBLE_DEVICES=0 python3 e5-server.py
```

**CPU Optimization:**
```bash
# Use multiple workers for batch processing
pip install gunicorn
gunicorn -w 4 -b 127.0.0.1:8765 e5-server:app
```

### Batch Processing

For bulk imports, use batch embeddings:

```bash
# Batch embed endpoint
curl -X POST http://127.0.0.1:8765/batch \
  -H "Content-Type: application/json" \
  -d '{"texts": ["text1", "text2", "text3"], "type": "passage"}'
```

## Memory Usage

### PostgreSQL Memory

Edit `/etc/postgresql/16/main/postgresql.conf`:

```ini
# For 16GB RAM server
shared_buffers = 4GB
effective_cache_size = 12GB
maintenance_work_mem = 1GB
work_mem = 64MB
```

### Embedding Cache

Enable embedding caching to avoid recomputation:

```sql
-- Add cache table
CREATE TABLE embedding_cache (
    content_hash TEXT PRIMARY KEY,
    embedding vector(1024),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cache_embedding ON embedding_cache 
    USING hnsw (embedding vector_cosine_ops);
```

## Monitoring

### Query Performance

```sql
-- Check slow queries
SELECT query, mean_exec_time, calls 
FROM pg_stat_statements 
WHERE query LIKE '%memories%' 
ORDER BY mean_exec_time DESC 
LIMIT 10;
```

### Index Usage

```sql
-- Check index usage
SELECT indexrelname, idx_scan, idx_tup_read 
FROM pg_stat_user_indexes 
WHERE schemaname = 'public';
```

### Database Size

```sql
-- Check table sizes
SELECT 
    relname AS table,
    pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_catalog.pg_statio_user_tables 
ORDER BY pg_total_relation_size(relid) DESC;
```

## Benchmarks

### Expected Performance

| Operation | Time (local) | Time (cloud) |
|-----------|--------------|--------------|
| Store memory | 50-100ms | 100-200ms |
| Search (top 5) | 5-20ms | 20-50ms |
| Auto-recall | 30-50ms | 50-100ms |

### Load Testing

```bash
# Install k6
brew install k6  # macOS
# or
sudo apt install k6  # Linux

# Run load test
k6 run --vus 10 --duration 30s load-test.js
```

## Troubleshooting Performance

### Slow Searches

1. Check if vector index exists:
```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'memories';
```

2. Rebuild index if needed:
```sql
REINDEX INDEX idx_memories_embedding;
```

### High Memory Usage

1. Reduce connection pool size
2. Lower `work_mem` in PostgreSQL config
3. Enable embedding cache

### Slow Embeddings

1. Enable GPU acceleration
2. Use batch processing
3. Consider OpenAI API for high volume

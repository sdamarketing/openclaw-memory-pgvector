# Performance

This guide covers optimization strategies for vector memory in PostgreSQL with pgvector.

## Table of Contents

- [Index Types](#index-types)
- [HNSW Tuning](#hnsw-tuning)
- [Query Optimization](#query-optimization)
- [Memory Management](#memory-management)
- [Benchmarks](#benchmarks)

## Index Types

### HNSW (Hierarchical Navigable Small World)

Default index type with good balance between speed and memory.

```sql
CREATE INDEX idx_memory_hnsw ON memory_embeddings
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

**Parameters:**
- `m`: Number of bi-directional links per layer (default 16). Increase for better accuracy.
- `ef_construction`: Index construction time vs accuracy (default 64).

### IVFFlat

Alternative for large datasets where HNSW memory is too high.

```sql
CREATE INDEX idx_memory_ivfflat ON memory_embeddings
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

**Note:** Requires `lists >= 100 * sqrt(number_of_vectors)` for good results.

## HNSW Tuning

### Performance vs Accuracy Tradeoff

Adjust `m` and `ef_construction` based on your use case:

| Use Case | m | ef_construction | Expected Speed | Recall |
|----------|---|-----------------|----------------|--------|
| Production (latency critical) | 12-16 | 32-64 | Fast | 90-95% |
| Development/Testing | 8-12 | 16-32 | Very fast | 80-90% |
| High accuracy required | 16-32 | 64-128 | Slower | 95-99% |

### Live Index Rebuilding

To rebuild an existing index without downtime:

```sql
-- Rebuild in-place
CREATE INDEX CONCURRENTLY idx_memory_hnsw_new ON memory_embeddings
USING hnsw (embedding vector_cosine_ops)
WITH (m = 24, ef_construction = 128);

-- Swap the old index
DROP INDEX CONCURRENTLY idx_memory_hnsw;
ALTER INDEX idx_memory_hnsw_new RENAME TO idx_memory_hnsw;
```

## Query Optimization

### Selective Vector Search

Use distance cutoffs to reduce search space:

```sql
-- Top 5 similar with minimum cosine similarity 0.7
SELECT
  id,
  content,
  metadata,
  embedding <=> '[0.1, 0.2, 0.3]' AS distance
FROM memory_embeddings
WHERE embedding <=> '[0.1, 0.2, 0.3]' < 0.3
ORDER BY distance
LIMIT 5;
```

### Batch Processing

Process multiple queries efficiently:

```sql
-- Single query for all embeddings (postgres 15+)
SELECT
  id,
  content,
  metadata,
  (embedding <=> '[0.1, 0.2]') AS distance1,
  (embedding <=> '[0.5, 0.6]') AS distance2
FROM memory_embeddings
ORDER BY
  embedding <=> '[0.1, 0.2]',
  embedding <=> '[0.5, 0.6]'
LIMIT 10;
```

### Query Planning

Enable EXPLAIN ANALYZE to inspect query performance:

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, content, metadata
FROM memory_embeddings
WHERE embedding <=> '[0.1, 0.2]' < 0.3
ORDER BY distance
LIMIT 5;
```

## Memory Management

### Index Memory Usage

HNSW index memory grows with dataset size:

| Vectors | Approx. Memory (m=16) | Approx. Memory (m=32) |
|---------|----------------------|----------------------|
| 1K      | ~2 MB                 | ~4 MB                |
| 10K     | ~20 MB                | ~40 MB               |
| 100K    | ~200 MB               | ~400 MB              |
| 1M      | ~2 GB                 | ~4 GB                |

### Vacuum and Analyze

Regular maintenance improves performance:

```sql
-- Vacuum to reclaim space and update statistics
VACUUM ANALYZE memory_embeddings;

-- Full vacuum for heavily updated indexes
VACUUM FULL memory_embeddings;
```

Set up autovacuum:

```sql
ALTER TABLE memory_embeddings
SET (autovacuum_analyze_scale_factor = 0.05,
     autovacuum_vacuum_scale_factor = 0.1);
```

## Benchmarks

### Setup

- PostgreSQL 15
- pgvector 0.5.0
- HNSW index, m=16, ef_construction=64
- 100K vectors (768-dim OpenAI embeddings)

### Query Latency

| Query Type | Avg Latency |
|------------|-------------|
| k=5 search  | 2-5 ms      |
| k=10 search | 3-8 ms      |
| k=50 search | 10-20 ms    |
| k=100 search | 20-40 ms   |

### Throughput

| Concurrent Queries | QPS |
|--------------------|-----|
| 10                  | 2,000+ |
| 50                  | 8,000+ |
| 100                 | 12,000+ |

### Recall vs m Parameter

Tested with 100K vectors:

| m | ef_construction | Recall (%) | Index Size |
|---|-----------------|------------|------------|
| 8 | 32              | 82%        | 150 MB     |
| 12 | 64              | 89%        | 200 MB     |
| 16 | 64              | 94%        | 250 MB     |
| 24 | 64              | 96%        | 350 MB     |
| 32 | 128             | 98%        | 450 MB     |

## Troubleshooting Slow Queries

### Common Issues

1. **Slow first query after index creation**
   - Solution: Increase `ef_construction` during index build

2. **High memory usage**
   - Solution: Reduce `m` or switch to IVFFlat

3. **Poor recall**
   - Solution: Increase `m` and `ef_construction`

4. **Index build failure**
   - Solution: Increase `maintenance_work_mem` (default 64MB)

### Monitoring

```sql
-- Check index usage
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE tablename = 'memory_embeddings';

-- Check autovacuum status
SELECT relname, last_autovacuum, last_analyze, n_dead_tup
FROM pg_stat_user_tables
WHERE relname = 'memory_embeddings';
```

## Further Reading

- [pgvector documentation](https://github.com/pgvector/pgvector)
- [PostgreSQL Performance Guide](https://wiki.postgresql.org/wiki/Performance_Optimization)

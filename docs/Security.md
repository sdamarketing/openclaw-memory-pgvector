# Security Best Practices

## Database Security

### 1. Use Strong Passwords

```bash
# Generate strong password
openssl rand -base64 32
```

```sql
-- Update password
ALTER USER openclaw WITH PASSWORD 'your-strong-password-here';
```

### 2. Limit Network Access

Edit `pg_hba.conf`:

```ini
# Only allow local connections
local   openclaw_memory    openclaw                    md5
host    openclaw_memory    openclaw    127.0.0.1/32    md5
host    openclaw_memory    openclaw    ::1/128         md5

# Reject all others
host    all             all             0.0.0.0/0       reject
```

### 3. Use SSL for Remote Connections

```json
{
  "database": {
    "host": "your-server.com",
    "ssl": true
  }
}
```

```sql
-- SSL: configure server (pg_hba.conf hostssl) and client (sslmode=require)
-- Note: PostgreSQL does not have per-user SSL setting
```

### 4. Least Privilege Principle

```sql
-- Create read-only user for analytics
CREATE USER openclaw_readonly WITH PASSWORD 'readonly-pass';
GRANT CONNECT ON DATABASE openclaw_memory TO openclaw_readonly;
GRANT USAGE ON SCHEMA public TO openclaw_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO openclaw_readonly;
```

## User Data Protection

### 1. User Isolation

Each user's data is isolated by `user_id`:

```sql
-- All queries include user_id filter
SELECT * FROM memories 
WHERE user_id = $1 
ORDER BY embedding <=> $2;
```

### 2. Data Encryption at Rest

Enable PostgreSQL encryption:

```sql
-- Enable transparent data encryption (PostgreSQL 15+)
-- Requires pgcrypto extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Encrypt sensitive metadata (use environment variable for key!)
INSERT INTO memories (content, metadata)
VALUES (
  'User prefers dark mode',
  pgp_sym_encrypt('{"sensitive": "data"}', current_setting('app.encryption_key'))::jsonb
);
-- Note: Store encryption key in env/secrets manager, never in code!
```

### 3. GDPR Compliance

#### Right to Erasure

```sql
-- Delete all data for a user
DELETE FROM memories WHERE user_id = 'user-123';
DELETE FROM requests WHERE user_id = 'user-123';
DELETE FROM responses r 
  USING requests req 
  WHERE r.request_id = req.id AND req.user_id = 'user-123';
DELETE FROM files WHERE user_id = 'user-123';
```

#### Right to Access

```sql
-- Export all user data
COPY (
  SELECT 'memories' as source, * FROM memories WHERE user_id = 'user-123'
  UNION ALL
  SELECT 'requests', * FROM requests WHERE user_id = 'user-123'
) TO '/tmp/user-export.csv' WITH CSV HEADER;
```

### 4. Data Retention

```sql
-- Auto-delete old data (run as cron job)
DELETE FROM memories 
WHERE created_at < NOW() - INTERVAL '1 year' 
  AND importance < 0.5;

-- Or use expires_at field
UPDATE memories 
SET expires_at = NOW() + INTERVAL '6 months' 
WHERE memory_type = 'session_summary';
```

## API Security

### 1. Rate Limiting

Implement rate limiting at the gateway level:

```typescript
// In OpenClaw config
{
  "rateLimit": {
    "windowMs": 60000,  // 1 minute
    "max": 100          // 100 requests per minute
  }
}
```

### 2. Input Validation

The plugin validates all inputs:

```typescript
// Memory types are restricted
CONSTRAINT valid_memory_type CHECK (memory_type IN (
  'preference', 'decision', 'fact', 'entity',
  'experience', 'session_summary', 'file_chunk', 'other'
))

// Importance is bounded
CONSTRAINT valid_importance CHECK (importance >= 0 AND importance <= 1)
```

### 3. Embedding Injection Prevention

```typescript
// Sanitize text before embedding
function sanitizeForEmbedding(text: string): string {
  // Remove potential injection attempts
  return text
    .replace(/[<>]/g, '')
    .substring(0, 8000);  // Limit length
}
```

## Embedding Server Security

### 1. Local-Only Binding

```python
# e5-server.py
app.run(host='127.0.0.1', port=8765)  # NOT 0.0.0.0
```

### 2. API Key (Optional)

```python
# Add simple API key protection
from flask import request, jsonify

API_KEY = os.environ.get('E5_API_KEY')

@app.before_request
def check_api_key():
    if API_KEY and request.headers.get('X-API-Key') != API_KEY:
        return jsonify({'error': 'Unauthorized'}), 401
```

```json
// In OpenClaw config
{
  "embedding": {
    "provider": "e5-local",
    "e5Endpoint": "http://127.0.0.1:8765",
    "e5ApiKey": "your-api-key"
  }
}
```

### 3. Request Size Limits

```python
# Limit request size
app.config['MAX_CONTENT_LENGTH'] = 1 * 1024 * 1024  # 1MB max
```

## Logging and Auditing

### 1. Enable Query Logging

```ini
# postgresql.conf
log_statement = 'all'
log_min_duration_statement = 100  # Log queries > 100ms
```

### 2. Audit Trail

```sql
-- Create audit table
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    table_name TEXT,
    record_id UUID,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    ip_address TEXT,
    metadata JSONB
);

-- Audit trigger function
CREATE OR REPLACE FUNCTION audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_log (user_id, action, table_name, record_id)
    VALUES (
        COALESCE(NEW.user_id, OLD.user_id),
        TG_OP,
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add to sensitive tables
CREATE TRIGGER memories_audit
    AFTER INSERT OR UPDATE OR DELETE ON memories
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();
```

### 3. Regular Backups

```bash
# Daily backup script
pg_dump -U openclaw openclaw_memory > /backup/openclaw_memory_$(date +%Y%m%d).sql

# Retain last 30 days
find /backup -name "openclaw_memory_*.sql" -mtime +30 -delete
```

## Security Checklist

- [ ] Strong database password configured
- [ ] Network access restricted (pg_hba.conf)
- [ ] SSL enabled for remote connections
- [ ] Read-only user created for analytics
- [ ] Rate limiting configured
- [ ] E5 server bound to localhost only
- [ ] Audit logging enabled
- [ ] Regular backups configured
- [ ] Data retention policy implemented
- [ ] GDPR erasure function tested

## Incident Response

### Data Breach

1. **Immediate**: Revoke compromised credentials
2. **Within 1 hour**: Identify affected users
3. **Within 24 hours**: Notify affected users
4. **Within 72 hours**: Report to authorities (if required)

### Recovery

```bash
# Restore from backup
psql -U openclaw openclaw_memory < /backup/openclaw_memory_YYYYMMDD.sql

# Regenerate compromised credentials
ALTER USER openclaw WITH PASSWORD 'new-strong-password';
```

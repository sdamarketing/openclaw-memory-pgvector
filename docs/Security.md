# Security

This guide covers security considerations, best practices, and compliance requirements for vector memory in PostgreSQL with pgvector.

## Table of Contents

- [Database Security](#database-security)
- [GDPR Compliance](#gdpr-compliance)
- [Audit Logging](#audit-logging)
- [Access Control](#access-control)
- [Encryption](#encryption)
- [Network Security](#network-security)
- [Incident Response](#incident-response)

## Database Security

### Connection Security

Always use TLS for database connections:

```bash
# PostgreSQL config (postgresql.conf)
ssl = on
ssl_cert_file = '/etc/ssl/certs/server.crt'
ssl_key_file = '/etc/ssl/private/server.key'
```

### Connection Strings

Use connection parameters for security:

```bash
# Use md5 password authentication
PGPASSWORD='your_password' psql -h localhost -U your_user -d your_db -c "SELECT 1"
```

### Authentication Methods

Configure pg_hba.conf for least privilege:

```
# TYPE  DATABASE        USER            ADDRESS                 METHOD
host    openclaw_memory  your_app_user   192.168.1.0/24          scram-sha-256
host    openclaw_memory  admin_user      127.0.0.1/32            scram-sha-256
local   openclaw_memory  admin_user                          scram-sha-256
```

### Least Privilege

Create separate users for different purposes:

```sql
-- Application user (no direct DB access)
CREATE USER app_user WITH PASSWORD 'strong_password';

-- Read-only admin for monitoring
CREATE USER readonly_admin WITH PASSWORD 'strong_password';

-- Full admin access
CREATE USER admin_user WITH PASSWORD 'strong_password';

-- Grant permissions
GRANT CONNECT ON DATABASE openclaw_memory TO app_user, admin_user;
GRANT USAGE ON SCHEMA public TO app_user, admin_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE memory_embeddings TO app_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_admin;
```

## GDPR Compliance

### Data Minimization

Store only necessary metadata:

```sql
-- Only store essential fields
CREATE TABLE memory_embeddings (
  id BIGSERIAL PRIMARY KEY,
  embedding vector(768),
  metadata JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Metadata example: only what's needed
{
  "source": "conversation",
  "category": "decision",
  "tags": ["important", "recurring"]
}
```

### Right to Access

Implement a GDPR data access endpoint:

```sql
-- User data export query
SELECT
  id,
  to_jsonb(metadata) as metadata,
  created_at,
  updated_at
FROM memory_embeddings
WHERE id = :user_id;
```

### Right to Erasure (Deletion)

Provide a clean delete operation:

```sql
-- Delete all data for a user
DELETE FROM memory_embeddings
WHERE metadata->>'user_id' = 'user_123';

-- Delete specific memories
DELETE FROM memory_embeddings
WHERE id = 'memory_id_here';
```

### Data Retention

Set up automatic data expiration:

```sql
-- Delete records older than 1 year
DELETE FROM memory_embeddings
WHERE created_at < NOW() - INTERVAL '1 year';

-- Create a retention policy table
CREATE TABLE retention_policies (
  id SERIAL PRIMARY KEY,
  category TEXT,
  retention_days INTEGER,
  last_cleanup TIMESTAMPTZ
);
```

### Privacy by Design

- Store PII (Personally Identifiable Information) separately
- Use hashing for sensitive metadata
- Implement data anonymization before storage

## Audit Logging

### Database-Level Auditing

Enable PostgreSQL auditing:

```sql
-- Set audit log configuration
ALTER SYSTEM SET log_statement = 'all';
ALTER SYSTEM SET log_duration = on;
ALTER SYSTEM SET log_line_prefix = '%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h ';
```

### Application-Level Logging

Implement comprehensive logging:

```typescript
// Log all memory operations
interface MemoryOperation {
  timestamp: string;
  operation: 'create' | 'read' | 'update' | 'delete';
  userId: string;
  memoryId?: string;
  metadata?: any;
  success: boolean;
  error?: string;
}

async function auditMemoryOperation(op: MemoryOperation) {
  await db.audit_logs.insert({
    timestamp: op.timestamp,
    operation: op.operation,
    user_id: op.userId,
    memory_id: op.memoryId,
    metadata: op.metadata,
    success: op.success,
    error: op.error
  });
}
```

### Security Events

Log security-relevant events:

```typescript
// Password changes, failed logins, etc.
const securityEvents = {
  login_failed: { userId, ip, timestamp, reason },
  password_changed: { userId, timestamp },
  permission_denied: { userId, resource, action, timestamp }
};
```

### Audit Log Storage

Store logs securely with rotation:

```sql
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  details JSONB,
  ip_address INET,
  user_agent TEXT
);

-- Set up log retention (e.g., 90 days)
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
```

## Access Control

### Role-Based Access Control (RBAC)

Define roles for different user levels:

```sql
-- Define roles
CREATE ROLE app_readonly WITH LOGIN PASSWORD 'strong_password';
CREATE ROLE app_writer WITH LOGIN PASSWORD 'strong_password';
CREATE ROLE admin WITH LOGIN PASSWORD 'strong_password';

-- Role hierarchy
ALTER ROLE admin SET ROLE app_writer;

-- Grant permissions per role
GRANT SELECT ON TABLE memory_embeddings TO app_readonly;
GRANT SELECT, INSERT, UPDATE ON TABLE memory_embeddings TO app_writer;
GRANT ALL ON ALL TABLES IN SCHEMA public TO admin;
```

### Row-Level Security (RLS)

Implement RLS for sensitive data:

```sql
-- Enable RLS
ALTER TABLE memory_embeddings ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own memories
CREATE POLICY user_isolation ON memory_embeddings
  FOR SELECT
  USING (
    metadata->>'user_id' = current_setting('app.current_user_id')::text
  );

-- Policy: Users can only modify their own memories
CREATE POLICY user_isolation_update ON memory_embeddings
  FOR UPDATE
  USING (
    metadata->>'user_id' = current_setting('app.current_user_id')::text
  );
```

### API Key Security

Generate and rotate API keys:

```bash
# Generate API key
API_KEY=$(openssl rand -hex 32)

# Store securely (environment variable or secret manager)
export OPENCLAW_API_KEY="$API_KEY"

# Validate API key on each request
async function validateApiKey(req: Request) {
  const apiKey = req.headers.get('X-API-Key');
  const validKey = await db.api_keys.find({ key: apiKey });

  if (!validKey || validKey.revoked) {
    throw new Error('Invalid or revoked API key');
  }
}
```

## Encryption

### At Rest Encryption

Enable PostgreSQL encryption:

```bash
# Generate certificates
openssl req -new -x509 -days 365 -nodes \
  -out server.crt -keyout server.key

# Configure postgresql.conf
ssl = on
ssl_cert_file = '/etc/ssl/certs/server.crt'
ssl_key_file = '/etc/ssl/private/server.key'
ssl_ca_file = '/etc/ssl/certs/ca.crt'
```

### In Transit Encryption

Use TLS for all connections:

```bash
# Database connection string (Docker example)
POSTGRES_URL="postgresql://user:password@localhost:5432/dbname?sslmode=require"
```

### Application-Level Encryption

Encrypt sensitive metadata:

```typescript
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; // 32-byte key
const ALGORITHM = 'aes-256-gcm';

function encrypt(text: string): { iv: string, ciphertext: string } {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return {
    iv: iv.toString('hex'),
    ciphertext: encrypted.toString('hex')
  };
}

function decrypt(iv: string, ciphertext: string): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    Buffer.from(ENCRYPTION_KEY),
    Buffer.from(iv, 'hex')
  );
  let decrypted = decipher.update(Buffer.from(ciphertext, 'hex'));
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}
```

### Environment Variables

Never hardcode secrets:

```bash
# .env file (gitignored)
DB_PASSWORD=strong_password_here
ENCRYPTION_KEY=your_32_byte_encryption_key_here
API_KEY=your_api_key_here

# Load into application
import dotenv from 'dotenv';
dotenv.config();
```

## Network Security

### Firewall Configuration

Restrict database access:

```bash
# UFW (Ubuntu)
ufw allow from 192.168.1.0/24 to any port 5432
ufw deny from 0.0.0.0/0 to any port 5432

# AWS Security Groups
# Only allow IP ranges that need access
```

### Database Exposure

Never expose PostgreSQL directly to the internet:

```bash
# Bad: Direct internet access
psql -h db.example.com -U user -d database  # NO!

# Good: Via application or bastion host
psql -h bastion.example.com -p 22 -U user -d database  # SSH tunnel
```

### VPN Usage

Connect via VPN for remote access:

```bash
# SSH tunnel example
ssh -L 5432:localhost:5432 user@vpn.example.com
# Now access as: psql localhost:5432
```

## Incident Response

### Security Checklist

- [ ] Regular security audits
- [ ] Penetration testing
- [ ] Dependency scanning
- [ ] Vulnerability patching
- [ ] Incident response plan
- [ ] Regular backups

### Backup Strategy

Encrypt and rotate backups:

```bash
# pg_dump with encryption
pg_dump -U user -h localhost dbname | openssl enc -aes-256-cbc -salt > backup.sql.enc

# Verify backup
openssl enc -d -aes-256-cbc -in backup.sql.enc | head -n 5
```

### Incident Reporting

Document security incidents:

```typescript
interface SecurityIncident {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: 'data_breach' | 'unauthorized_access' | 'misconfiguration';
  description: string;
  affected_users: string[];
  timestamp: string;
  status: 'open' | 'investigating' | 'resolved' | 'closed';
  remediation: string;
  reporter: string;
}
```

## Compliance Frameworks

### SOC 2

- Implement access controls
- Regular security assessments
- Change management
- Incident response procedures

### HIPAA

- Privacy controls
- Audit logging
- Encryption at rest and in transit
- Business associate agreements

### ISO 27001

- Information security policy
- Asset management
- Access control
- Cryptography

## Tools and Resources

- [PostgreSQL Security Guide](https://www.postgresql.org/docs/current/security.html)
- [pgvector Security](https://github.com/pgvector/pgvector#security)
- [OWASP Database Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Database_Security_Cheat_Sheet.html)

## Further Reading

- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
- [GDPR Compliance Guide](https://gdpr.eu/)
- [CIS Benchmarks for PostgreSQL](https://www.cisecurity.org/benchmark/postgresql)
